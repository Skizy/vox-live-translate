import os
import struct
import zlib

os.makedirs("public/icons", exist_ok=True)

PRIMARY = (198, 84, 200)
DARK_PLUM = (93, 26, 95)
ON_PRIMARY = (255, 240, 251)
SVG_SIZE = 512
SCALE = 4


def chunk(chunk_type, data):
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def set_pixel(canvas, canvas_size, x, y, color):
    if 0 <= x < canvas_size and 0 <= y < canvas_size:
        offset = (y * canvas_size + x) * 4
        canvas[offset : offset + 4] = bytes((*color, 255))


def fill_circle(canvas, canvas_size, center_x, center_y, radius, color):
    scale = canvas_size / SVG_SIZE
    center_x *= scale
    center_y *= scale
    radius *= scale
    radius_squared = radius * radius

    for y in range(
        max(0, int(center_y - radius)), min(canvas_size, int(center_y + radius) + 1)
    ):
        dy = y + 0.5 - center_y
        for x in range(
            max(0, int(center_x - radius)), min(canvas_size, int(center_x + radius) + 1)
        ):
            dx = x + 0.5 - center_x
            if dx * dx + dy * dy <= radius_squared:
                set_pixel(canvas, canvas_size, x, y, color)


def fill_rounded_rectangle(
    canvas, canvas_size, left, top, width, height, radius, color
):
    scale = canvas_size / SVG_SIZE
    left *= scale
    top *= scale
    width *= scale
    height *= scale
    radius *= scale
    right = left + width
    bottom = top + height

    for y in range(max(0, int(top)), min(canvas_size, int(bottom) + 1)):
        nearest_y = min(max(y + 0.5, top + radius), bottom - radius)
        for x in range(max(0, int(left)), min(canvas_size, int(right) + 1)):
            nearest_x = min(max(x + 0.5, left + radius), right - radius)
            dx = x + 0.5 - nearest_x
            dy = y + 0.5 - nearest_y
            if dx * dx + dy * dy <= radius * radius:
                set_pixel(canvas, canvas_size, x, y, color)


def fill_stroke_segment(canvas, canvas_size, start, end, width, color):
    radius = width / 2
    distance = max(abs(end[0] - start[0]), abs(end[1] - start[1]))
    steps = max(1, int(distance * 2))

    for step in range(steps + 1):
        progress = step / steps
        x = start[0] + (end[0] - start[0]) * progress
        y = start[1] + (end[1] - start[1]) * progress
        fill_circle(canvas, canvas_size, x, y, radius, color)


def cubic_point(start, control_one, control_two, end, progress):
    inverse = 1 - progress
    return (
        inverse**3 * start[0]
        + 3 * inverse**2 * progress * control_one[0]
        + 3 * inverse * progress**2 * control_two[0]
        + progress**3 * end[0],
        inverse**3 * start[1]
        + 3 * inverse**2 * progress * control_one[1]
        + 3 * inverse * progress**2 * control_two[1]
        + progress**3 * end[1],
    )


def fill_cubic_stroke(
    canvas, canvas_size, start, control_one, control_two, end, width, color
):
    previous = start
    for step in range(1, 257):
        current = cubic_point(start, control_one, control_two, end, step / 256)
        fill_stroke_segment(canvas, canvas_size, previous, current, width, color)
        previous = current


def downsample(canvas, size):
    canvas_size = size * SCALE
    pixels = bytearray()
    sample_count = SCALE * SCALE

    for y in range(size):
        for x in range(size):
            red = green = blue = alpha = 0
            for sample_y in range(SCALE):
                for sample_x in range(SCALE):
                    offset = (
                        (y * SCALE + sample_y) * canvas_size + x * SCALE + sample_x
                    ) * 4
                    red += canvas[offset]
                    green += canvas[offset + 1]
                    blue += canvas[offset + 2]
                    alpha += canvas[offset + 3]
            opaque_samples = max(1, alpha // 255)
            pixels.extend(
                (
                    red // opaque_samples,
                    green // opaque_samples,
                    blue // opaque_samples,
                    alpha // sample_count,
                )
            )

    return pixels


def write_png(path, size):
    canvas_size = size * SCALE
    canvas = bytearray(canvas_size * canvas_size * 4)

    fill_rounded_rectangle(canvas, canvas_size, 0, 0, SVG_SIZE, SVG_SIZE, 112, PRIMARY)
    fill_circle(canvas, canvas_size, 256, 256, 176, DARK_PLUM)
    fill_rounded_rectangle(canvas, canvas_size, 177, 135, 158, 242, 79, ON_PRIMARY)
    fill_rounded_rectangle(canvas, canvas_size, 221, 181, 70, 150, 35, (244, 183, 239))

    fill_cubic_stroke(
        canvas,
        canvas_size,
        (129, 259),
        (129, 329.1),
        (185.9, 386),
        (256, 386),
        34,
        ON_PRIMARY,
    )
    fill_cubic_stroke(
        canvas,
        canvas_size,
        (256, 386),
        (326.1, 386),
        (383, 329.1),
        (383, 259),
        34,
        ON_PRIMARY,
    )
    fill_stroke_segment(canvas, canvas_size, (256, 386), (256, 441), 34, ON_PRIMARY)

    pixels = downsample(canvas, size)
    rows = [
        b"\x00" + pixels[row * size * 4 : (row + 1) * size * 4] for row in range(size)
    ]
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + chunk(b"IEND", b"")
    )

    with open(path, "wb") as file:
        file.write(png)


write_png("public/icons/icon-192.png", 192)
write_png("public/icons/icon-512.png", 512)
