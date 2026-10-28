#!/usr/bin/env python3
"""Lists the colours in a theme's gtk.css that its glass would turn
see-through but should not.

The plugin turns a window pixel to glass when it matches one of colors.toml's
background shades (background, dark_background, darker_background,
lighter_background) to within 2.5/255 on every channel. Those shades are for
window backgrounds alone: text, icons, panels, cards, fields, popovers and
dialogs in one of them go see-through with the window (Sol, 2026-10-28). So
every solid colour in gtk.css that matches a shade is listed, except on the
window-background properties named below.

    tools/check-glass.py themes/<slug>     exit 1 when anything is listed
"""

import re
import sys
from pathlib import Path

SHADES = ("background", "dark_background", "darker_background", "lighter_background")
TOLERANCE = 2.5 / 255
# The window backgrounds GTK paints the theme's glass in.
WINDOW_BACKGROUNDS = {
    "--window-bg-color",
    "--view-bg-color",
    "--headerbar-bg-color",
    "--sidebar-bg-color",
    "--secondary-sidebar-bg-color",
    "--headerbar-backdrop-color",
}
COLOUR = re.compile(r"#([0-9a-fA-F]{6})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)")


def shades(theme):
    found = {}
    for line in (theme / "colors.toml").read_text().splitlines():
        m = re.match(r'\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})"', line)
        if m and m[1] in SHADES:
            found[m[1]] = tuple(int(m[2][i:i + 2], 16) / 255 for i in (0, 2, 4))
    return found


def main(theme):
    theme = Path(theme)
    keys = shades(theme)
    css = re.sub(r"/\*.*?\*/", "", (theme / "gtk.css").read_text(), flags=re.S)
    problems = []
    for number, line in enumerate(css.splitlines(), 1):
        prop = line.split(":", 1)[0].strip() if ":" in line else ""
        if prop in WINDOW_BACKGROUNDS:
            continue
        for m in COLOUR.finditer(line):
            if m[1]:
                rgb = tuple(int(m[1][i:i + 2], 16) / 255 for i in (0, 2, 4))
            else:
                if m[5] is not None and float(m[5]) < 1:
                    continue  # translucent: blended, so it never equals a shade exactly
                rgb = tuple(int(m[i]) / 255 for i in (2, 3, 4))
            for name, key in keys.items():
                if max(abs(a - b) for a, b in zip(rgb, key)) <= TOLERANCE:
                    problems.append(f"{theme / 'gtk.css'}:{number}: {m[0]} is {name} ({prop or 'in a rule'})")
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(max(main(t) for t in sys.argv[1:]))
