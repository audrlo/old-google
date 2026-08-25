#!/usr/bin/env python3
"""Generate the extension icons with no third-party dependencies.

A four-colour ring in the classic blue/red/yellow/green order, drawn with 4x
supersampling. Deliberately not the Google mark - just the palette.
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")

QUADRANTS = [
    (0.66, 0.75, (66, 133, 244)),   # blue
    (0.16, 0.50, (234, 67, 53)),    # red
    (0.00, 0.16, (251, 188, 5)),    # yellow
    (0.50, 0.66, (52, 168, 83)),    # green
]


def color_at(angle_frac):
    for start, end, rgb in QUADRANTS:
        if start <= angle_frac < end:
            return rgb
    return QUADRANTS[0][2]


def render(size):
    ss = 4  # supersample factor
    big = size * ss
    cx = cy = (big - 1) / 2.0
    outer = big * 0.46
    inner = big * 0.26

    # accumulate RGBA in floats
    acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(size * size)]

    for py in range(big):
        for px in range(big):
            dx = px - cx
            dy = py - cy
            dist = math.hypot(dx, dy)
            if not (inner <= dist <= outer):
                continue
            # angle: 0 at 12 o'clock, increasing clockwise
            ang = (math.atan2(dx, -dy) / (2 * math.pi)) % 1.0
            r, g, b = color_at(ang)
            idx = (py // ss) * size + (px // ss)
            cell = acc[idx]
            cell[0] += r
            cell[1] += g
            cell[2] += b
            cell[3] += 255

    samples = ss * ss
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            r, g, b, a = acc[y * size + x]
            if a == 0:
                raw += bytes((0, 0, 0, 0))
                continue
            # colour averaged over covered samples only, alpha over all samples
            covered = a / 255.0
            raw += bytes((
                int(round(r / covered)),
                int(round(g / covered)),
                int(round(b / covered)),
                int(round(a / samples)),
            ))
    return bytes(raw)


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, size):
    raw = render(size)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, f"icon{size}.png")
        n = write_png(path, size)
        print(f"{path}  {size}x{size}  {n} bytes")


if __name__ == "__main__":
    main()
