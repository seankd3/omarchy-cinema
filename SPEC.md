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
Omarchy 4 (Quickshell shell, Hyprland 0.56.2 with Lua config).

## Shape

A theme stays a theme directory. A film theme adds **`backdrop.frag`**, a
fragment shader written against `plugin/contract.glsl`, and loads the
**backdrop plugin** from its `hyprland.lua`.

The plugin (`plugin/main.cpp`) is a Hyprland plugin. At the render stage after
the wallpaper and before the bottom layers and windows, it draws the theme's
shader over the monitor, with the windows' real geometry for that frame
(animated position and size, workspace slide offset, fade alpha), the focused
window, the palette and a clock. The windows are the ones Hyprland itself
draws on that monitor in that frame (`shouldRenderWindow`), so the backdrop
cannot trail them. Shapes are exact rounded rectangles (signed distance), not
textures.

**Same frame, no polling.** Hyprland advances its animations and layout,
emits `render.pre`, then reads the frame's damage. The plugin reads the scene
at `render.pre` (live windows with renderWindow's full fade alpha and their
rounding, plus windows fading out after closing) and, when it differs from what
it last drew, damages the whole monitor and marks the blur cache dirty, so this
very frame redraws the backdrop and the glass. Windows reach the shader as a
float texture, so there is no window limit.

**Cheap at rest.** The backdrop's own motion ticks at `plugin:backdrop:fps`
(default 15). A tick redraws the whole monitor over Hyprland's cached blur;
every sixth tick refreshes the blur too. The whole frame always agrees with
itself, and only the glass trails, by at most five ticks of slow, blurred
motion. Idle on workspace 1 this costs about 1.7 W (GPU 4%), measured
2026-10-28, interleaved against the plugin unloaded. Time stands still with
animations off, the session locked, or every monitor asleep or fullscreen.

**Theme switch.** `omarchy-theme-set` swaps `current/theme` and reloads
Hyprland. The plugin reads `backdrop.frag` and `colors.toml` from
`current/theme` on load and on every config reload, and compiles the program
at the next draw. A theme that does not load the plugin unloads it. A shader
that does not compile is reported once and draws nothing.

**Glass** reuses Omarchy's: the theme's `hyprland.lua` calls
`default.hypr.glass` and `o.transparent_window` (Window Opacity can still
override it, since toggles load after themes), re-asserts the terminal rule so
terminal text is never faded, and sets its borders and shadow. Terminals get
their see-through background from Omarchy's Glassy mode.

**Files** (next): each theme ships `gtk.css` (libadwaita variables and
Nautilus selectors), `icons.theme` and an `icons/` overlay theme, applied by
Omarchy's own switch; one fixed `@import` in `~/.config/gtk-4.0/gtk.css` and an
empty `gtk.css.tpl` for stock themes.

## Layout and install

```
plugin/        main.cpp, contract.glsl, Makefile (g++ against installed headers)
themes/<slug>/ colors.toml, hyprland.lua, backdrop.frag, backgrounds/, ...
install        build the plugin into ~/.local/lib/omarchy-cinema/backdrop.so
               (a new file, then renamed: Hyprland maps the old one), link each
               theme into ~/.config/omarchy/themes/<slug> (never over a real
               directory)
```

A Hyprland update needs `./install` again: the plugin refuses to load into
another version and says so.

## What it deletes

The Quickshell backdrop plugin, its 10 Hz window polling, its texture masks
and blur pass, the `qsb` shader compiler and the per-theme `.qsb` build.

## Non-goals

HUD widgets and data readouts; a full-screen post-process shader; publishing
for `omarchy theme install` (a git-installed theme loses its `hyprland.lua`).

## Acceptance

1. `./install` builds and links; `omarchy theme set jarvis` loads the plugin
   with no config errors.
2. Dragging and resizing a window, workspace slides and focus changes: the
   backdrop follows in the same frame (Sean's eye on the real machine).
3. Workspace 1 before and after screenshots, read for legibility.
4. Idle cost measured against the plugin unloaded, interleaved.
5. Unload while drawing, reload, missing and broken shader: Hyprland survives
   (nested instance first).
