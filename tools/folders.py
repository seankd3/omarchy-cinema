#!/usr/bin/env python3
"""Writes a film theme's folder icons: an icon theme named Cinema-<Film> that
overlays Yaru, with every folder Files shows (plain, the special folders, home,
desktop) drawn in the film's style.

GTK looks for all of an icon's names in this theme before it reads the parent,
so a theme that drew only `folder` would turn Documents, Downloads and the rest
into plain folders too: every name Files uses is drawn here.

    tools/folders.py <theme-dir>
"""

import sys
from pathlib import Path

# One style per film: the folder's outline, its fill, the glyph's colour, the
# glow, and an accent for one detail. Shapes: "hud" chamfers the corners,
# "grid" cuts one corner square to the Grid's lines, "round" softens them.
STYLES = {
    "jarvis": {
        "shape": "hud",
        "stroke": "#5fd8ff",
        "fill": ("#39c8ff", 0.28, 0.06),
        "glyph": "#e6f8ff",
        "glow": "#39c8ff",
        "accent": "#ffb347",
        "inherits": "Yaru-blue-dark,Yaru-dark,Yaru,hicolor",
    },
    "tron-legacy": {
        "shape": "grid",
        "stroke": "#7ff3ff",
        "fill": ("#00d9ff", 0.16, 0.02),
        "glyph": "#f2feff",
        "glow": "#00d9ff",
        "accent": "#ff8a1f",
        "inherits": "Yaru-prussiangreen-dark,Yaru-dark,Yaru,hicolor",
    },
}

# The glyph inside each folder, drawn as strokes in a 20 by 20 box at (22, 28).
GLYPHS = {
    "folder": "",
    "folder-open": "",
    "inode-directory": "",
    "folder-documents": "M2 3h16M2 9h16M2 15h10",
    "folder-download": "M10 1v12M5 8l5 5 5-5M2 18h16",
    "folder-music": "M7 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM7 16V2l11-2v13M18 13a3 3 0 1 1-3-3 3 3 0 0 1 3 3z",
    "folder-pictures": "M1 18l6-8 4 5 3-3 5 6zM15 4a2 2 0 1 1-2-2 2 2 0 0 1 2 2z",
    "folder-videos": "M5 2l13 8-13 8z",
    "folder-templates": "M1 1h7v7H1zM12 1h7v7h-7zM1 12h7v7H1zM12 12h7v7h-7z",
    "folder-publicshare": "M10 1a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM1 10h18M10 1c-4 4-4 14 0 18M10 1c4 4 4 14 0 18",
    "folder-remote": "M5 16a4 4 0 0 1 0-8 6 6 0 0 1 11 1 3.5 3.5 0 0 1 0 7z",
    "folder-projects": "M7 3L1 10l6 7M13 3l6 7-6 7",
    "user-home": "M1 10L10 2l9 8M4 8v10h12V8M8 18v-6h4v6",
    "user-desktop": "M1 2h18v12H1zM7 18h6M10 14v4",
}


def outline(shape):
    """The folder's silhouette in a 64 by 64 box: back tab, then body."""
    if shape == "hud":
        return "M6 14l4-5h14l4 5h26l4 4v32l-5 5H11l-5-5z"
    if shape == "grid":
        return "M6 9h18l5 5h29v34l-6 6H6z"
    return "M8 12a3 3 0 0 1 3-3h13l4 5h25a3 3 0 0 1 3 3v33a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z"


def svg(style, glyph):
    fill, top, bottom = style["fill"]
    accent = "<path d='M10 9h14' stroke='{a}' stroke-width='2.5' stroke-linecap='round'/>".format(a=style["accent"])
    mark = (
        "<path d='{d}' transform='translate(22 28)' fill='none' stroke='{c}' stroke-width='2' "
        "stroke-linecap='round' stroke-linejoin='round' filter='url(#glow)'/>".format(d=glyph, c=style["glyph"])
        if glyph
        else ""
    )
    # A faint scan line across the body, as on a projected panel.
    scan = "<path d='M9 30h46' stroke='{s}' stroke-opacity='0.25' stroke-width='1'/>".format(s=style["stroke"])
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{fill}" stop-opacity="{top}"/>
      <stop offset="1" stop-color="{fill}" stop-opacity="{bottom}"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.6" result="soft"/>
      <feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="{outline(style['shape'])}" fill="url(#fill)" stroke="{style['stroke']}" stroke-width="2" stroke-linejoin="round" filter="url(#glow)"/>
  {scan}
  {accent}
  {mark}
</svg>
"""


def main(theme_dir):
    theme_dir = Path(theme_dir)
    slug = theme_dir.name
    style = STYLES[slug]
    name = "Cinema-" + slug.title()
    places = theme_dir / "icons" / "scalable" / "places"
    places.mkdir(parents=True, exist_ok=True)
    for icon, glyph in GLYPHS.items():
        (places / f"{icon}.svg").write_text(svg(style, glyph))
    (theme_dir / "icons" / "index.theme").write_text(
        f"""[Icon Theme]
Name={name}
Comment=Folders for the {slug.title()} film theme
Inherits={style['inherits']}
Directories=scalable/places

[scalable/places]
Context=Places
Size=64
MinSize=8
MaxSize=512
Type=Scalable
"""
    )
    (theme_dir / "icons.theme").write_text(name + "\n")
    print(name)


if __name__ == "__main__":
    main(sys.argv[1])
