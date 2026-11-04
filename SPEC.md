# Omarchy Cinema: spec

**Sentence:** six film themes for Omarchy whose live background is drawn around
the open windows, in the same frame as the windows.

Films: Jarvis (Iron Man), Tron Legacy, Oblivion, Evangelion, The Matrix,
Roadster (the 2026 Tesla Roadster's red-on-black fighter-jet UI, 80s retro).
Sean's asks: windows more transparent; the background reacts to the windows
and fills in behind and around them; tied to these themes; no HUD, no screen
shader that makes text harder to read; "if I move a window too fast the box
doesn't catch up with it, it needs to be in the same frame. No lag. Cheap when
it doesn't move and super responsive when things are moving"; Files and its
icons themed too.

Machine: ASUS P16, aarch64, NVIDIA N1X, 2880x1800 at 120 Hz, scale 1.25,
Omarchy 4 (Quickshell shell, Hyprland 0.57.0 with Lua config).

## Shape

A theme stays a theme directory. A film theme adds **`backdrop.frag`**, a
fragment shader written against `plugin/contract.glsl`, which the **backdrop
plugin** draws; the plugin itself belongs to the session, not the theme (see
"Loaded once a session").

The plugin (`plugin/main.cpp`) is a Hyprland plugin. At the render stage after
the wallpaper and before the bottom layers and windows, it draws the theme's
shader over the monitor, with the windows' real geometry for that frame
(animated position and size, workspace slide offset, fade alpha), the focused
window, the palette and a clock. The windows are the ones Hyprland itself
draws on that monitor in that frame (`shouldRenderWindow`), so the backdrop
cannot trail them. Shapes are exact rounded rectangles (signed distance), not
textures. The plugin also makes the glass's frost: it draws the world at half
the monitor's size, softens it through its mipmap as far as the film's
`frost` and puts it in the framebuffer Hyprland's glass reads, so Hyprland
never blurs the screen itself. A frosted window covers what is under it
opaque, and each says so to Hyprland's own occlusion from under its surface,
so at full size the world is drawn only where it is seen as it is, and
nothing under the glass is drawn, the window's shadow included, unless a
live blur will read it (specs/smoothness.md, "Frame budget").

**Same frame, no polling.** Hyprland advances its animations and layout,
emits `render.pre`, then reads the frame's damage. The plugin reads the scene
at `render.pre` (live windows with renderWindow's full fade alpha and their
rounding, plus windows fading out after closing) and, when it differs from what
it last drew, damages the whole monitor and marks the blur cache dirty, so this
very frame redraws the backdrop and the glass. Windows reach the shader as a
float texture, so there is no window limit, and each pixel reads and measures
each window once (contract.glsl's `window()`).

**Cost follows change.** The film says, as data in its own shader, how often
each part of its world changes on its own (contract.glsl, `pace()`): 0 where
it holds still, a few times a second where it drifts, every frame where
something runs past. Each frame shown reads that pace a tile of 32 px at a
time and draws again only the tiles whose turn has come, at most every frame
and on battery 30 a second (`plugin:backdrop:fps`, default 0 = the
display's rate; `plugin:backdrop:battery_fps`, default 30; Sean: "keep it
native? or atleast 30"); with no tile due nothing asks for a frame. The world
at full size and at half size is kept between frames, so the film's shader
runs only where the world changed, and the rest of what Hyprland draws again
is a copy. While a window, the focus, the pointer, voice or an answer
changes, the whole world is drawn every frame. Time stands still, and
nothing asks for frames, with animations off, the session locked, or every
monitor asleep or fullscreen (specs/smoothness.md, "Cost follows change").

**Theme switch.** `omarchy-theme-set` swaps `current/theme` and reloads
Hyprland. The plugin reads `backdrop.frag` and `colors.toml` from
`current/theme` on load and on every config reload, and compiles the program
at the next draw, so the theme directory is the one home of a film's shader
and glass: editing `backdrop.frag` and switching theme shows the edit, and
Omarchy's same-name overlay of a shipped film is drawn as overlaid. The
contract carries a version (`// omarchy-cinema contract N`, its first comment
line) and each `backdrop.frag` says the version it was written for on the same
line; a shader written for another contract, or for none, is not compiled. One
notice names the fix (log in again to run the engine installed now, or update
the theme) and the backdrop draws nothing, so a theme switch after a contract
change never draws a film against a contract it was not written for. A shader
that does not compile is reported once and draws nothing.

**Loaded once a session.** `~/.config/hypr/hyprland.lua` loads the plugin at
login and nothing unloads it while Hyprland runs; a theme without
`backdrop.frag` leaves it idle (no draw, no frames asked for). Native code is never
swapped in a running Hyprland: on 2026-10-28 an unload, load and theme switch
hung the desktop and it took a forced power-off. A new build takes effect at
the next login, and is tried first in the hidden desktop.

**Glass: the background turns to glass, text stays opaque.** Sean: "the
transparency should effect the background but not the text, all text should
stay opauqe"; "the little logo, line, stuff like that, should all remain fully
opaque. Just the background elements should have the transparency." Hyprland's
window opacity fades a whole window, so the plugin adds one step to Hyprland's
own window shader (`surface.frag`, taken from the running build): it un-mixes
each pixel from the theme's background colour (colour-to-alpha), so pure
background becomes glass at the theme's `glass` (`colors.toml`, which the
plugin reads with the palette) and everything drawn over
it keeps its opacity. The step runs only in the shader's blur variant, which
`render:use_shader_blur_blend` selects for windows Hyprland blurs; glass
windows are 0.999 opaque to be blurred, browsers stay at 1 and are never
touched. The patched shader is loaded with Hyprland's `reloadShaders`, only
when it changes; Hyprland's own returns when the theme has no backdrop or the
plugin unloads, and a Hyprland whose shader no longer has the expected shape
gets solid windows and a notice. Glassy mode's 0.75 fade on Files is replaced
by the same glass. The session's `film.lua` sets glow, glass and frost from
the film's `colors.toml`: a film theme holds no Lua.

The same step holds the glass to the palette, so a film draws its world at
full strength behind it: where a pixel composited over Hyprland's frost
would leave `colors.toml`'s muted text under 4.5:1 (WCAG), it moves toward
its background shade drawn solid in linear light until it does not, dimming
in its own hue on a dark theme; where that shade itself gives muted less than
4.5:1 (Oblivion's darker shades), the glass reads as the shade drawn solid,
never worse. The bar, blurred in the same shader, is held the same way.

**Files.** Each film theme ships `gtk.css` (libadwaita variables and Nautilus
selectors) and its folder icons (`tools/folders.py` writes an icon theme,
`Cinema-<Film>`, at install; the theme's `icons.theme` names it and Omarchy
applies it). GTK imports the applied theme's stylesheet through one fixed line
in `~/.config/gtk-4.0/gtk.css`; stock themes get an empty one from
`~/.config/omarchy/themed/gtk.css.tpl`. Icons change live.

**Open, waiting on Sean:** GTK reads the stylesheet once per process, and
Files runs as a resident service, so a running Files keeps the last film's
look until it restarts. Restarting it on a theme switch is his call (it
replaces his Files windows). If yes, the lifecycle must: never quit Files while
a file operation runs (defer until idle, then apply the latest look); capture
each window's locations and canonical workspace before quitting and restore
exactly that record; and mark the look applied only after the restore is
verified. A first draft that did none of this was deleted (Sol pass 4).

**Dictation popup.** Voxtype's Quickshell OSD takes its style from
`~/.local/state/omarchy/current/theme`: the applied theme's `voxtype-osd.toml`.
A film theme ships one naming its own `voxtype-osd-<slug>.qml`, a `FilmOsd`
(`osd/FilmOsd.qml`, copied beside it at install) with the film's drawing on a
canvas: placement, the last 1.2 s of voice, a clock and the light stroke are
shared. Every other theme gets an empty manifest from
`~/.config/omarchy/themed/voxtype-osd.toml.tpl`, which is Voxtype's own popup
in that theme's colours. Voxtype's theme follower re-resolves the style when
the theme changes, so the popup switches live; each film's file has its own
name because the OSD reloads its QML only when the path changes. The popups
are canvas, not shader effects, so `tools/osd-preview` renders them off screen
exactly as they draw live. No HUD text.

**Previews and visual tests.** `tools/hidden-desktop` logs a real Hyprland in
where it is never on screen: Sean's desktop with the checkout's `./install`
and a chosen film applied (Omarchy's own headless theme switch), drawing into
`tools/frameclock`, a Wayland compositor with no screen that takes each frame
and asks for the next. It runs in a sandbox with Sean's configuration and the
checkout as throwaway copies, none of his other files and no route to his
session (no compositor, Hyprland socket, bus, `/run` or network of his), and
every process ends with it. A Hyprland nested in his session drew only while
its window was on his screen, and Hyprland's own headless outputs ask NVIDIA
for linear buffers it cannot render to. `tools/theme-previews` opens the
stock previews' four windows there and writes `themes/<slug>/preview.png` at
their 2560x1440.

## Layout and install

```
plugin/        main.cpp, contract.glsl, Makefile (g++ against installed headers;
               `make install` puts the plugin and film.lua in ENGINE)
PKGBUILD       the engine as one Arch package in /usr/lib/omarchy-cinema,
               pinned to the Hyprland it was built against
osd/           FilmOsd.qml (each film's dictation popup builds on it), the
               stock themes' voxtype-osd.toml template
themes/<slug>/ colors.toml, backdrop.frag, backgrounds/,
               voxtype-osd.toml and voxtype-osd-<slug>.qml, ...
install        the developer's install: the engine into ~/.local/lib/omarchy-cinema
               (a new file, then renamed: Hyprland maps the old one), link each
               theme into ~/.config/omarchy/themes/<slug> (never over a real
               directory), add film.lua's line to the Hyprland config
```

A Hyprland update needs `./install` again, or the package rebuilt for it: the
plugin refuses to load into another version and says so.

## What it deletes

The Quickshell backdrop plugin, its 10 Hz window polling, its texture masks
and blur pass, the `qsb` shader compiler and the per-theme `.qsb` build.

## Non-goals

HUD widgets and data readouts; a full-screen post-process shader.

## Acceptance

1. `./install` builds and links; after a login the plugin is loaded with no
   config errors, and `omarchy theme set jarvis` draws its backdrop.
2. Dragging and resizing a window, workspace slides and focus changes: the
   backdrop follows in the same frame (Sean's eye on the real machine).
3. Workspace 1 before and after screenshots, read for legibility.
4. Idle cost measured against a stock theme (plugin idle), interleaved.
5. Missing and broken shader, and switching between film and stock themes:
   Hyprland survives, in the hidden desktop.
6. Dictating in each film shows its popup, and in a stock theme Voxtype's own;
   switching theme while Voxtype runs switches the popup.
