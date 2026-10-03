use super::PNG_SIGNATURE;

/// Encodes 8-bit RGBA pixels as a PNG without pulling in an image crate.
///
/// The zlib stream uses stored (uncompressed) deflate blocks: icons are a few
/// hundred KB of pixels and the write is cached on disk, so compression buys
/// nothing over correctness here.
#[cfg(any(target_os = "windows", test))]
pub(super) fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    debug_assert_eq!(rgba.len(), (width as usize) * (height as usize) * 4);

    let stride = width as usize * 4;
    let mut scanlines = Vec::with_capacity((stride + 1) * height as usize);
    for row in 0..height as usize {
        scanlines.push(0);
        scanlines.extend_from_slice(&rgba[row * stride..(row + 1) * stride]);
    }

    let mut png = Vec::with_capacity(scanlines.len() + 128);
    png.extend_from_slice(&PNG_SIGNATURE);

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    push_png_chunk(&mut png, b"IHDR", &ihdr);
    push_png_chunk(&mut png, b"IDAT", &zlib_store(&scanlines));
    push_png_chunk(&mut png, b"IEND", &[]);
    png
}

#[cfg(any(target_os = "windows", test))]
fn push_png_chunk(png: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    png.extend_from_slice(kind);
    png.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    png.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

#[cfg(any(target_os = "windows", test))]
fn zlib_store(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + data.len() / 65_535 * 5 + 16);
    out.extend_from_slice(&[0x78, 0x01]);
    let mut chunks = data.chunks(65_535).peekable();
    if chunks.peek().is_none() {
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xFF, 0xFF]);
    }
    while let Some(block) = chunks.next() {
        out.push(u8::from(chunks.peek().is_none()));
        let len = block.len() as u16;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(!len).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn adler32(data: &[u8]) -> u32 {
    const MOD: u32 = 65_521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = !0;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}
