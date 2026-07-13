import os
import struct
import zlib

os.makedirs("public/icons", exist_ok=True)


def chunk(chunk_type, data):
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def write_png(path, size):
    rows = []

    for y in range(size):
        row = bytearray([0])

        for x in range(size):
            dx = x - size / 2
            dy = y - size / 2
            radius = (dx * dx + dy * dy) ** 0.5
            in_circle = radius < size * 0.34
            in_mic = abs(x - size / 2) < size * 0.13 and size * 0.25 < y < size * 0.68

            base = (37, 99, 235, 255)
            circle = (29, 78, 216, 255)
            mic = (239, 246, 255, 255)
            color = mic if in_mic else circle if in_circle else base
            row.extend(color)

        rows.append(bytes(row))

    raw = b"".join(rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )

    with open(path, "wb") as file:
        file.write(png)


write_png("public/icons/icon-192.png", 192)
write_png("public/icons/icon-512.png", 512)
