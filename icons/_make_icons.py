"""Generate Lichen PWA icons via PIL — draws the mycelium mark directly.

Run from the project root:  python3 public/icons/_make_icons.py

Outputs:
  public/icons/icon-32.png
  public/icons/icon-192.png
  public/icons/icon-512.png
  public/icons/apple-touch-icon.png   (180×180)
  public/icons/icon-maskable-512.png  (full-bleed with safe zone)
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(__file__)

MOSS_DARK = (31, 42, 30)
MOSS_DARKER = (24, 34, 24)
LICHEN = (197, 181, 132)
LICHEN_LIGHT = (232, 217, 166)
RUST = (184, 98, 60)


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return m


def draw_mark(size: int, *, full_bleed: bool = False) -> Image.Image:
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    bg_layer = Image.new("RGBA", (s, s), MOSS_DARKER + (255,))
    d_bg = ImageDraw.Draw(bg_layer)
    for r in range(int(s * 0.55), 0, -8):
        alpha = int(60 * (1 - r / (s * 0.55)))
        if alpha <= 0:
            continue
        d_bg.ellipse(
            (s * 0.5 - r, s * 0.35 - r, s * 0.5 + r, s * 0.35 + r),
            fill=(58, 72, 54, alpha),
        )

    img = Image.alpha_composite(img, bg_layer)
    d = ImageDraw.Draw(img)

    def sc(v):
        return v * s / 512

    def bezier(p0, p1, p2, steps=24):
        pts = []
        for i in range(steps + 1):
            t = i / steps
            x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
            pts.append((x, y))
        return pts

    primaries = [
        ((256, 256), (200, 200), (150, 170)),
        ((256, 256), (312, 200), (362, 170)),
        ((256, 256), (200, 312), (150, 342)),
        ((256, 256), (312, 312), (362, 342)),
        ((256, 256), (256, 180), (256, 130)),
        ((256, 256), (256, 332), (256, 382)),
    ]
    secondaries = [
        ((150, 170), (120, 150), (100, 130)),
        ((150, 170), (130, 200), (110, 220)),
        ((362, 170), (392, 150), (412, 130)),
        ((362, 170), (382, 200), (402, 220)),
        ((150, 342), (120, 362), (100, 382)),
        ((362, 342), (392, 362), (412, 382)),
        ((256, 130), (230, 110), (215, 95)),
        ((256, 130), (282, 110), (297, 95)),
        ((256, 382), (230, 402), (215, 417)),
        ((256, 382), (282, 402), (297, 417)),
    ]

    for p0, p1, p2 in primaries:
        d.line(bezier((sc(p0[0]), sc(p0[1])), (sc(p1[0]), sc(p1[1])), (sc(p2[0]), sc(p2[1]))),
               fill=LICHEN + (240,), width=int(sc(8)), joint="curve")
    for p0, p1, p2 in secondaries:
        d.line(bezier((sc(p0[0]), sc(p0[1])), (sc(p1[0]), sc(p1[1])), (sc(p2[0]), sc(p2[1]))),
               fill=LICHEN + (220,), width=int(sc(6)), joint="curve")

    def dot(x, y, r, color):
        rx = sc(r)
        d.ellipse((sc(x) - rx, sc(y) - rx, sc(x) + rx, sc(y) + rx), fill=color + (255,))

    dot(256, 256, 20, LICHEN)
    for x, y in [(150, 170), (362, 170), (150, 342), (362, 342), (256, 130), (256, 382)]:
        dot(x, y, 11, LICHEN_LIGHT)
    for x, y in [(100, 130), (110, 220), (412, 130), (402, 220),
                 (100, 382), (412, 382), (215, 95), (297, 95),
                 (215, 417), (297, 417)]:
        dot(x, y, 7, RUST)

    img = img.resize((size, size), Image.LANCZOS)
    if not full_bleed:
        mask = rounded_mask(size, radius=int(size * 0.22))
        bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        bg.paste(img, (0, 0), mask)
        return bg
    return img


def make_maskable(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), MOSS_DARK + (255,))
    safe = int(size * 0.7)
    inner = draw_mark(safe, full_bleed=True)
    pad = (size - safe) // 2
    img.paste(inner, (pad, pad), inner)
    return img


if __name__ == "__main__":
    for size in (32, 192, 512):
        out = os.path.join(OUT, f"icon-{size}.png")
        draw_mark(size).save(out, "PNG")
        print(f"wrote {out}")
    draw_mark(180).save(os.path.join(OUT, "apple-touch-icon.png"), "PNG")
    make_maskable(512).save(os.path.join(OUT, "icon-maskable-512.png"), "PNG")
    print("done")
