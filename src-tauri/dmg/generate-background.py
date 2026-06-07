#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import struct
import zlib


WIDTH = 660
HEIGHT = 400
SCALE = 2
BACKGROUND = "#f7f7f5"
OUT = Path(__file__).with_name("background.png")


def scaled(value: int | float) -> int:
    return round(value * SCALE)


def color(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def downsample(canvas: bytearray, width: int, height: int) -> bytes:
    rows: list[bytes] = []
    for y in range(0, height, SCALE):
        row = bytearray()
        for x in range(0, width, SCALE):
            samples = []
            for sample_y in range(y, y + SCALE):
                for sample_x in range(x, x + SCALE):
                    offset = (sample_y * width + sample_x) * 3
                    samples.append(canvas[offset : offset + 3])
            row.extend(sum(sample[channel] for sample in samples) // len(samples) for channel in range(3))
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack("!I", len(data)) + chunk_type + data + struct.pack("!I", checksum)


canvas_width = scaled(WIDTH)
canvas_height = scaled(HEIGHT)
canvas = bytearray(color(BACKGROUND) * canvas_width * canvas_height)

raw = downsample(canvas, canvas_width, canvas_height)
png = b"\x89PNG\r\n\x1a\n"
png += png_chunk(b"IHDR", struct.pack("!IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
png += png_chunk(b"IDAT", zlib.compress(raw, level=9))
png += png_chunk(b"IEND", b"")
OUT.write_bytes(png)
print(f"wrote {OUT} {WIDTH}x{HEIGHT}")
