#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import struct
import zlib


WIDTH = 640
HEIGHT = 400
SCALE = 2
BACKGROUND = "#f7f7f5"
ARROW = "#b7b7b3"
OUT = Path(__file__).with_name("background.png")


def scaled(value: int | float) -> int:
    return round(value * SCALE)


def color(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def set_pixel(canvas: bytearray, width: int, x: int, y: int, fill: tuple[int, int, int]) -> None:
    if 0 <= x < width and 0 <= y < len(canvas) // (width * 3):
        offset = (y * width + x) * 3
        canvas[offset : offset + 3] = bytes(fill)


def fill_rect(
    canvas: bytearray,
    width: int,
    left: int,
    top: int,
    right: int,
    bottom: int,
    fill: tuple[int, int, int],
) -> None:
    for y in range(top, bottom):
        for x in range(left, right):
            set_pixel(canvas, width, x, y, fill)


def fill_triangle(
    canvas: bytearray,
    width: int,
    points: tuple[tuple[int, int], tuple[int, int], tuple[int, int]],
    fill: tuple[int, int, int],
) -> None:
    min_x = min(point[0] for point in points)
    max_x = max(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_y = max(point[1] for point in points)
    (x1, y1), (x2, y2), (x3, y3) = points

    def edge(ax: int, ay: int, bx: int, by: int, px: int, py: int) -> int:
        return (px - ax) * (by - ay) - (py - ay) * (bx - ax)

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            w1 = edge(x1, y1, x2, y2, x, y)
            w2 = edge(x2, y2, x3, y3, x, y)
            w3 = edge(x3, y3, x1, y1, x, y)
            if (w1 <= 0 and w2 <= 0 and w3 <= 0) or (w1 >= 0 and w2 >= 0 and w3 >= 0):
                set_pixel(canvas, width, x, y, fill)


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
arrow_color = color(ARROW)
fill_rect(canvas, canvas_width, scaled(267), scaled(198), scaled(345), scaled(202), arrow_color)
fill_triangle(
    canvas,
    canvas_width,
    ((scaled(345), scaled(180)), (scaled(373), scaled(200)), (scaled(345), scaled(220))),
    arrow_color,
)

raw = downsample(canvas, canvas_width, canvas_height)
png = b"\x89PNG\r\n\x1a\n"
png += png_chunk(b"IHDR", struct.pack("!IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
png += png_chunk(b"IDAT", zlib.compress(raw, level=9))
png += png_chunk(b"IEND", b"")
OUT.write_bytes(png)
print(f"wrote {OUT} {WIDTH}x{HEIGHT}")
