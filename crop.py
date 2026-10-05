#!/usr/bin/env python3
"""
Crops a PNG produced by shot.mjs down to a maximum height, adding a footer bar
warning that the image was cropped (headless Firefox captures exactly the
viewport, so an unannounced cut would silently lose content).

Usage: crop.py <png_path> <max_height>
Does nothing if the image is already within the limit.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/System/Library/Fonts/Monaco.ttf",
]
FOOTER_HEIGHT = 28


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def main():
    if len(sys.argv) != 3:
        print("usage: crop.py <png_path> <max_height>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    max_height = int(sys.argv[2])

    img = Image.open(path)
    if img.height <= max_height:
        return

    cropped = img.crop((0, 0, img.width, max_height))
    draw = ImageDraw.Draw(cropped)
    bar_top = max_height - FOOTER_HEIGHT
    draw.rectangle([0, bar_top, img.width, max_height], fill=(30, 30, 30))
    draw.line([0, bar_top, img.width, bar_top], fill=(70, 70, 70), width=1)
    text = "⋮ image cropped at {}px -- see the original .png/.html or the raw .txt for the full content".format(max_height)
    font = load_font(13)
    draw.text((12, bar_top + 7), text, fill=(138, 138, 138), font=font)
    cropped.save(path)


if __name__ == "__main__":
    main()
