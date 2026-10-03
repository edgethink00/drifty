//! Windows app icon extraction.
//!
//! Windows segments identify apps through bundle_id, which carries the
//! lowercased executable path for unpackaged apps and the AUMID
//! ("PackageFamilyName!AppId") for packaged apps (see the identity model in
//! services/tracker-python/app/tracker/windows_workspace.py). Executables go
//! through icon extraction; packaged apps resolve to the logo PNG shipped in
//! the package's install directory.

use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr;

use windows_sys::core::PWSTR;
use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, GDI_ERROR,
};
use windows_sys::Win32::Storage::Packaging::Appx::{
    FindPackagesByPackageFamily, GetPackagePathByFullName, PACKAGE_FILTER_DIRECT,
    PACKAGE_FILTER_HEAD,
};
use windows_sys::Win32::UI::Shell::{
    SHDefExtractIconW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, PrivateExtractIconsW, DI_NORMAL,
};

use super::{
    encode_png_rgba, is_windows_absolute_path, logo_variant_score, manifest_logo_candidates,
    normalize_packaged_logo_reference, package_identity_from_aumid, packaged_logo_qualifier_score,
    APP_ICON_TARGET_PX, PNG_SIGNATURE,
};
use crate::tracker::TrackerError;

/// Cap on a packaged app's on-disk logo asset. Store logos are small PNGs; a
/// larger "logo" file is not an icon.
const MAX_LOGO_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Bound on AppxManifest.xml so a malformed package cannot force a large
/// read. Real manifests are a few KB.
const MAX_MANIFEST_BYTES: u64 = 512 * 1024;

/// Resolves the app path chosen by resolve_application_path to PNG bytes.
///
/// The path is either an executable (icon extraction) or the logo PNG inside
/// a packaged app's install directory, which is read straight off disk.
pub(super) fn resolve_windows_app_icon_png(
    app_path: &Path,
) -> Result<Option<Vec<u8>>, TrackerError> {
    if app_path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return read_logo_png(app_path);
    }
    executable_icon_png(app_path)
}

/// Resolves a bundle_id carrying a lowercased executable path to that path,
/// provided the file still exists.
pub(super) fn executable_path(bundle_id: &str) -> Option<PathBuf> {
    if !is_windows_absolute_path(bundle_id) {
        return None;
    }
    let path = PathBuf::from(bundle_id);
    path.is_file().then_some(path)
}

/// Resolves a bundle_id carrying an AUMID to the packaged app's logo PNG.
///
/// The lookup goes family name -> package full name -> install directory ->
/// AppxManifest.xml logo reference -> the best-scaled asset on disk. Any link
/// that fails leaves the app with the lettered placeholder.
pub(super) fn packaged_app_logo_path(bundle_id: &str) -> Option<PathBuf> {
    let (family, app_id) = package_identity_from_aumid(bundle_id)?;
    let install_dir = package_install_dir(family)?;
    let manifest_path = install_dir.join("AppxManifest.xml");
    let metadata = fs::metadata(&manifest_path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    let manifest = fs::read_to_string(&manifest_path).ok()?;
    for candidate in manifest_logo_candidates(&manifest, app_id) {
        if let Some(path) = resolve_logo_asset(&install_dir, &candidate) {
            return Some(path);
        }
    }
    None
}

fn read_logo_png(path: &Path) -> Result<Option<Vec<u8>>, TrackerError> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(None);
    };
    if !metadata.is_file() || metadata.len() > MAX_LOGO_FILE_BYTES {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn executable_icon_png(exe_path: &Path) -> Result<Option<Vec<u8>>, TrackerError> {
    // SAFETY: Category 8 - FFI boundary. Every Win32 call uses owned buffers
    // that outlive the call, every nullable return is checked before use, and
    // every HICON/HBITMAP/HDC acquired here is released by a scope guard or an
    // explicit call before return. No raw handle escapes the function.
    unsafe {
        let wide = wide_string(exe_path.as_os_str());
        let Some(icon) = extract_icon_handle(wide.as_ptr()) else {
            return Ok(None);
        };
        let _icon_guard = IconGuard(icon);
        let Some((width, height, mut bgra)) = icon_pixels(icon) else {
            return Ok(None);
        };
        // GDI pixels are BGRA; PNG wants RGBA.
        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        Ok(Some(encode_png_rgba(width, height, &bgra)))
    }
}

struct IconGuard(windows_sys::Win32::UI::WindowsAndMessaging::HICON);
impl Drop for IconGuard {
    fn drop(&mut self) {
        unsafe { DestroyIcon(self.0) };
    }
}

struct BitmapGuard(windows_sys::Win32::Graphics::Gdi::HBITMAP);
impl Drop for BitmapGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { DeleteObject(self.0) };
        }
    }
}

struct DcGuard(windows_sys::Win32::Graphics::Gdi::HDC);
impl Drop for DcGuard {
    fn drop(&mut self) {
        unsafe { DeleteDC(self.0) };
    }
}

/// Pulls the best icon out of an executable, preferring an exact-size
/// resource and falling back to what the shell would show.
///
/// SAFETY: caller guarantees path is a valid null-terminated UTF-16 pointer.
unsafe fn extract_icon_handle(
    path: windows_sys::core::PCWSTR,
) -> Option<windows_sys::Win32::UI::WindowsAndMessaging::HICON> {
    let target = APP_ICON_TARGET_PX as i32;
    let mut icon = ptr::null_mut();

    // PrivateExtractIconsW scales the closest resource to exactly the
    // requested size, which keeps the cached PNG at the 128px contract.
    let extracted = PrivateExtractIconsW(path, 0, target, target, &mut icon, ptr::null_mut(), 1, 0);
    if extracted != 0 && extracted != u32::MAX && !icon.is_null() {
        return Some(icon);
    }

    icon = ptr::null_mut();
    // Some executables expose their icon only through the shell. The size
    // parameter packs the large-icon size in its low word.
    if SHDefExtractIconW(path, 0, 0, &mut icon, ptr::null_mut(), APP_ICON_TARGET_PX) >= 0
        && !icon.is_null()
    {
        return Some(icon);
    }

    let mut info = SHFILEINFOW::default();
    if SHGetFileInfoW(
        path,
        0,
        &mut info,
        std::mem::size_of::<SHFILEINFOW>() as u32,
        SHGFI_ICON | SHGFI_LARGEICON,
    ) != 0
        && !info.hIcon.is_null()
    {
        return Some(info.hIcon);
    }
    None
}

/// Draws an HICON into a 128px top-down BGRA bitmap.
///
/// Reading the icon's own color bitmap with one GetDIBits call fails on
/// current Windows when the header asks for a top-down DIB. Drawing into a
/// DIB section matches what the shell shows and keeps the mask composited.
///
/// SAFETY: caller owns the HICON and guarantees it is a valid icon handle for
/// the duration of the call.
unsafe fn icon_pixels(
    icon: windows_sys::Win32::UI::WindowsAndMessaging::HICON,
) -> Option<(u32, u32, Vec<u8>)> {
    let (width, height) = (APP_ICON_TARGET_PX, APP_ICON_TARGET_PX);
    let hdc = CreateCompatibleDC(ptr::null_mut());
    if hdc.is_null() {
        return None;
    }
    let _dc = DcGuard(hdc);

    let bmi = top_down_dib_header(width, height);
    let mut bits = ptr::null_mut();
    let dib = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0);
    if dib.is_null() || bits.is_null() {
        return None;
    }
    let _dib = BitmapGuard(dib);
    let previous = SelectObject(hdc, dib);
    if previous.is_null() || previous as isize == GDI_ERROR as isize {
        return None;
    }
    let byte_count = (width as usize) * (height as usize) * 4;
    // The DIB section's backing bytes are undefined until written. Clear them
    // first so transparent icon areas cannot inherit allocator contents.
    ptr::write_bytes(bits.cast::<u8>(), 0, byte_count);
    let drawn = DrawIconEx(
        hdc,
        0,
        0,
        icon,
        width as i32,
        height as i32,
        0,
        ptr::null_mut(),
        DI_NORMAL,
    );
    SelectObject(hdc, previous);
    if drawn == 0 {
        return None;
    }

    let pixels = std::slice::from_raw_parts(bits.cast::<u8>(), byte_count).to_vec();
    // SAFETY ends at the copy: the DIB section is released by BitmapGuard.
    let mut pixels = pixels;
    if !pixels.chunks_exact(4).any(|pixel| pixel[3] != 0) {
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }
    Some((width, height, pixels))
}

fn top_down_dib_header(width: u32, height: u32) -> BITMAPINFO {
    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width as i32,
        // Negative height requests a top-down scan order, matching the PNG
        // row order so no flip pass is needed.
        biHeight: -(height as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..Default::default()
    };
    bmi
}

/// Resolves an AUMID's package family to the package install directory.
fn package_install_dir(family: &str) -> Option<PathBuf> {
    // SAFETY: Category 8 - FFI boundary. The wide strings are owned vectors
    // that outlive each call, the two-pass length query allocates the exact
    // buffers the API requires, and only error-checked outputs are read.
    unsafe {
        let wide = wide_string(OsStr::new(family));
        let filters = PACKAGE_FILTER_HEAD | PACKAGE_FILTER_DIRECT;

        let mut count: u32 = 0;
        let mut buffer_len: u32 = 0;
        let status = FindPackagesByPackageFamily(
            wide.as_ptr(),
            filters,
            &mut count,
            ptr::null_mut(),
            &mut buffer_len,
            ptr::null_mut(),
            ptr::null_mut(),
        );
        if status != ERROR_INSUFFICIENT_BUFFER || count == 0 || buffer_len == 0 {
            return None;
        }

        let mut names: Vec<PWSTR> = vec![ptr::null_mut(); count as usize];
        let mut buffer: Vec<u16> = vec![0; buffer_len as usize];
        let status = FindPackagesByPackageFamily(
            wide.as_ptr(),
            filters,
            &mut count,
            names.as_mut_ptr(),
            &mut buffer_len,
            buffer.as_mut_ptr(),
            ptr::null_mut(),
        );
        if status != ERROR_SUCCESS {
            return None;
        }
        let full_name = names.first().copied().filter(|p| !p.is_null())?;

        let mut path_len: u32 = 0;
        if GetPackagePathByFullName(full_name, &mut path_len, ptr::null_mut())
            != ERROR_INSUFFICIENT_BUFFER
            || path_len == 0
        {
            return None;
        }
        let mut path: Vec<u16> = vec![0; path_len as usize];
        if GetPackagePathByFullName(full_name, &mut path_len, path.as_mut_ptr()) != ERROR_SUCCESS {
            return None;
        }
        let end = path.iter().position(|&c| c == 0).unwrap_or(path.len());
        let dir = PathBuf::from(String::from_utf16_lossy(&path[..end]));
        dir.is_dir().then_some(dir)
    }
}

/// Resolves a manifest logo reference like "Assets/logo.png" to a real file,
/// accounting for the scale/targetsize variants Windows writes next to the
/// base name.
fn resolve_logo_asset(install_dir: &Path, reference: &str) -> Option<PathBuf> {
    let relative = normalize_packaged_logo_reference(reference)?;

    let direct = install_dir.join(&relative);
    let rel_path = Path::new(&relative);
    let stem = rel_path.file_stem()?.to_str()?;
    let ext = rel_path.extension()?.to_str()?;
    if !ext.eq_ignore_ascii_case("png") {
        return None;
    }
    let dir = install_dir.join(rel_path.parent().unwrap_or(Path::new("")));

    let mut best: Option<(u64, PathBuf)> = None;
    let mut consider = |score: u64, path: PathBuf| {
        if !is_usable_png(&path) {
            return;
        }
        if best
            .as_ref()
            .map_or(true, |(best_score, _)| score > *best_score)
        {
            best = Some((score, path));
        }
    };
    consider(0, direct);

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let path = entry.path();
            if path.is_dir() {
                let Some(score) = packaged_logo_qualifier_score(name, stem, ext) else {
                    continue;
                };
                consider(score, path.join(format!("{stem}.{ext}")));
                continue;
            }
            if let Some(score) = logo_variant_score(stem, ext, name) {
                consider(score, path);
            }
        }
    }
    best.map(|(_, path)| path)
}

fn is_usable_png(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > MAX_LOGO_FILE_BYTES {
        return false;
    }
    fs::read(path)
        .map(|bytes| bytes.starts_with(&PNG_SIGNATURE))
        .unwrap_or(false)
}

fn wide_string(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::executable_icon_png;
    use crate::app_icons::{APP_ICON_TARGET_PX, PNG_SIGNATURE};
    use std::path::PathBuf;

    fn decode_stored_png_rgba(png: &[u8], width: u32, height: u32) -> Vec<u8> {
        let idat_at = png
            .windows(4)
            .position(|window| window == b"IDAT")
            .expect("PNG should contain IDAT");
        let idat_len = u32::from_be_bytes(png[idat_at - 4..idat_at].try_into().unwrap()) as usize;
        let zlib = &png[idat_at + 4..idat_at + 4 + idat_len];
        assert_eq!(&zlib[..2], &[0x78, 0x01]);

        let mut cursor = 2;
        let mut scanlines = Vec::new();
        loop {
            let is_final = zlib[cursor] & 1 == 1;
            let len = u16::from_le_bytes(zlib[cursor + 1..cursor + 3].try_into().unwrap());
            let not_len = u16::from_le_bytes(zlib[cursor + 3..cursor + 5].try_into().unwrap());
            assert_eq!(not_len, !len);
            cursor += 5;
            scanlines.extend_from_slice(&zlib[cursor..cursor + len as usize]);
            cursor += len as usize;
            if is_final {
                break;
            }
        }
        let expected_adler = u32::from_be_bytes(zlib[cursor..cursor + 4].try_into().unwrap());
        assert_eq!(expected_adler, super::super::png::adler32(&scanlines));

        let stride = width as usize * 4;
        assert_eq!(scanlines.len(), height as usize * (stride + 1));
        let mut rgba = Vec::with_capacity(stride * height as usize);
        for row in 0..height as usize {
            let start = row * (stride + 1);
            assert_eq!(scanlines[start], 0, "PNG rows use the no-filter encoding");
            rgba.extend_from_slice(&scanlines[start + 1..start + 1 + stride]);
        }
        rgba
    }

    #[test]
    fn extracts_a_real_windows_executable_icon_as_a_128px_png() {
        let windows_dir = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let executable = windows_dir.join("System32").join("cmd.exe");
        assert!(
            executable.is_file(),
            "expected Windows executable at {executable:?}"
        );

        let png = executable_icon_png(&executable)
            .expect("icon extraction should not error")
            .expect("cmd.exe should have an extractable shell icon");
        if let Some(output_path) = std::env::var_os("DRIFTY_WINDOWS_ICON_SMOKE_OUTPUT") {
            let output_path = PathBuf::from(output_path);
            std::fs::write(&output_path, &png).unwrap_or_else(|error| {
                panic!(
                    "failed to write Windows icon smoke image {}: {error}",
                    output_path.display()
                )
            });
        }

        assert!(png.starts_with(&PNG_SIGNATURE));
        assert!(png.len() >= 24, "PNG must include its IHDR header");
        let width = u32::from_be_bytes(png[16..20].try_into().expect("four width bytes"));
        let height = u32::from_be_bytes(png[20..24].try_into().expect("four height bytes"));
        assert_eq!(width, APP_ICON_TARGET_PX);
        assert_eq!(height, APP_ICON_TARGET_PX);

        let rgba = decode_stored_png_rgba(&png, width, height);
        assert!(
            rgba.chunks_exact(4).any(|pixel| pixel[3] != 0),
            "extracted executable icon must contain visible pixels"
        );
        assert!(
            rgba.chunks_exact(4).any(|pixel| pixel[3] == 0),
            "extracted executable icon must preserve transparent pixels"
        );
    }
}
