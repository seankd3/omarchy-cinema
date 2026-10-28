# /// script
# dependencies = ["pillow"]
# ///
"""Writes a theme's glyphs.png, the lettering its backdrop draws text in: the
95 printable ASCII characters (32 to 126) in a 16 by 6 grid of equal cells,
white on clear, in reading order. The backdrop plugin loads it with the theme
and the contract's glyph() draws from it (specs/agent-rain.md).

    uv run tools/glyphs.py <theme-dir> [--font FILE] [--mirror] [--cell WxH]

--mirror flips each character left to right, as the film's code is.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

COLUMNS, ROWS = 16, 6


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("theme")
    parser.add_argument("--font", default="/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf")
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--cell", default="32x48")
    args = parser.parse_args()

    width, height = (int(n) for n in args.cell.split("x"))
    font = ImageFont.truetype(args.font, int(height * 0.72))
    atlas = Image.new("RGBA", (COLUMNS * width, ROWS * height), (255, 255, 255, 0))
    for code in range(32, 127):
        cell = Image.new("L", (width, height), 0)
        ImageDraw.Draw(cell).text((width / 2, height / 2), chr(code), fill=255, font=font, anchor="mm")
        if args.mirror:
            cell = ImageOps.mirror(cell)
        index = code - 32
        x, y = (index % COLUMNS) * width, (index // COLUMNS) * height
        atlas.paste(Image.new("RGBA", (width, height), (255, 255, 255, 255)), (x, y), cell)
    out = Path(args.theme) / "glyphs.png"
    atlas.save(out)
    print(out)


if __name__ == "__main__":
    main()
