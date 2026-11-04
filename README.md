# Omarchy Cinema

Six film themes for [Omarchy](https://omarchy.org) whose background is alive
and drawn around your windows, in the same frame as the windows. Windows turn
to glass with their text kept solid, and Files, its folders, the bar and the
dictation popup take the film's look. A still desktop costs nothing; the
film moves while your windows do.

| | |
|---|---|
| ![Jarvis](themes/jarvis/preview.png) **Jarvis** (Iron Man) | ![Tron Legacy](themes/tron-legacy/preview.png) **Tron Legacy** |
| ![Oblivion](themes/oblivion/preview.png) **Oblivion** | ![Evangelion](themes/evangelion/preview.png) **Evangelion** |
| ![The Matrix](themes/the-matrix/preview.png) **The Matrix** | ![Roadster](themes/roadster/preview.png) **Roadster** (the 2026 Tesla Roadster's UI) |

## Install

Needs Omarchy 4 with Hyprland 0.57. This is a beta: it has been built and
used on one aarch64 laptop with an NVIDIA GPU, and x86_64 and other GPUs are
not tested yet. The backdrop is a Hyprland plugin, and a plugin loads only at
login, so the install runs from a console:

1. `git clone https://github.com/seankd3/omarchy-cinema ~/omarchy-cinema`
2. Log out. At the login screen press Ctrl+Alt+F3 and log in there.
3. `~/omarchy-cinema/install` (it builds the plugin, about a minute), then
   `exit`, back to the login screen (Ctrl+Alt+F1 or F2), and log in.
4. Pick a film in the theme menu (Super+Ctrl+T), or `omarchy theme set jarvis`.

After a Hyprland update, run `~/omarchy-cinema/install` again and log in
again: the plugin loads only into the Hyprland it was built for.

Omarchy's own toggles tune it: *Glassy windows* or *Opaque windows*, and
*No animations*, which holds the backdrop still.

The Matrix rains the text your Claude Code and Codex agents write, read from
their logs on this machine and kept only in memory, so whatever an agent
prints can show on your desktop. With no agent running there is no rain.
To turn it off: `systemctl --user disable --now omarchy-cinema-feed`.

## Uninstall

Log out, and from the console (step 2):
`~/omarchy-cinema/install --uninstall`. It takes away what the install added
and only that, keeps what you changed since, and puts back the Voxtype
settings it changed; a film still applied gives way to Tokyo Night.

## Make your own

Copy a film's directory into `~/.config/omarchy/themes/<name>`, change
`colors.toml`, and write `backdrop.frag`: one GLSL function, `backdrop(px)`,
against [`plugin/contract.glsl`](plugin/contract.glsl).
`uv run tools/preview.py <theme-dir>` draws it off screen. SPEC.md is the
design.

## Credits

These themes are fan homages. Iron Man and J.A.R.V.I.S. (Marvel), Tron:
Legacy (Disney), Oblivion (Universal Pictures), Neon Genesis Evangelion
(khara), The Matrix (Warner Bros.) and Tesla Roadster (Tesla) belong to
their owners. This project is not affiliated with or endorsed by any of
them, and it ships no film imagery: every wallpaper
(`themes/*/backgrounds/0-*.png`) is that film's own `backdrop.frag` drawn by
`tools/preview.py`, each `preview.png` is a capture of a hidden desktop by
`tools/theme-previews`, the folder icons are drawn by `tools/folders.py`, and
The Matrix's `glyphs.png` is JetBrains Mono (SIL Open Font License 1.1)
drawn by `tools/glyphs.py`.

MIT licence (LICENSE).
