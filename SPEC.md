# Omarchy Cinema: spec

**Sentence:** six film themes for Omarchy whose live background is drawn around
the open windows.

Films: Jarvis (Iron Man), Tron Legacy, Oblivion, Evangelion, The Matrix,
Roadster (the 2026 Tesla Roadster's red-on-black fighter-jet UI, 80s retro).
Sean's ask: "I want the windows to be more transparent and the background should
react to the windows and kinda fill in behind and around them in a super cool
way", tied to these themes. No HUD or data readouts, and no full-screen shader
(scanlines and the like) that makes text harder to read.

Machine: ASUS P16, aarch64, NVIDIA N1X, 2880x1800 at 120 Hz, scale 1.25,
Omarchy 4 (Quickshell 0.3.2 shell, Hyprland 0.56.2 with Lua config).

## Shape

A theme stays a theme directory. It gains one optional file: **`backdrop.frag`,
the theme's live background, a fragment shader** (built to `backdrop.frag.qsb`).

One Omarchy shell plugin, **`sean.backdrop`** (kind `service`), draws on every
screen a click-through layer-shell surface on the `Bottom` layer: above the
wallpaper, below every window. When the current theme has a backdrop it renders
that shader; when it has none the surface is hidden and costs nothing. The
plugin is the only code; every look lives in a shader.

The shader contract (all a backdrop can know):
- `time` (seconds, wrapping every hour so float precision holds over weeks of
  uptime; motion is built from periods that divide 3600), `resolution`
  (logical px).
- `accent`, `background`, `foreground`: read from the applied theme's
  `colors.toml` (overlay included) at the same moment as the shader.
- `windows`: a texture of every window that crosses this screen and sits on a
  workspace some monitor shows (active or special), drawn as rounded
  rectangles at half resolution. Red is any window, green the focused one.
  `halo`: the same blurred at an eighth of the size, a soft falloff (not a
  distance field) for light that pools around and between windows.
- `focus`: the focused window's rect (logical px) when it is on this screen,
  else a rect in the middle of the screen. No cursor: nothing needs it.

**Theme handoff.** `omarchy-theme-set` writes `current/theme.generation` after
the new theme directory is in place. That write is the one commit point: the
plugin then reads the shader and the palette from `current/theme`, and loads
the shader by a URL carrying the generation (Qt caches shaders by URL). The
shell's own palette comes later by IPC, timed to the wallpaper's reveal, so it
is not used. Startup takes the same path.

**Window geometry.** Hyprland's client and monitor lists, refreshed with
`Hyprland.refreshToplevels()` and `refreshMonitors()` by one shared 10 Hz timer
while the theme has a backdrop. Hyprland announces opens, closes and focus but
not resizes, split changes or a special workspace being shown, and the
foreign-toplevel protocol carries no rectangles, so sampling is the source.
Client rects are animation goals, so the field eases after the windows
(about 100 ms of sampling plus a 220 ms ease), not in step with them.

**Pausing.** Observation never stops while the theme has a backdrop; only
rendering does. Time stops (no frames) while this screen shows a fullscreen
window and while animations are off (`Style.reduceMotion`), where the field
still redraws on each window change as a still frame. Lock, idle screensaver
and output sleep: measured first (Hyprland may stop frame callbacks to a
hidden surface on its own); only if frames continue does the plugin observe
the lock through the lock service's existing `isLocked` IPC.

Glass reuses Omarchy's: each theme's `hyprland.lua` calls
`default.hypr.glass` (the frosted blur) and `o.transparent_window` (the tagged
opacity that Appearance > Windows > Window Opacity can still override, since
toggles load after themes), re-asserts Omarchy's terminal rule so terminal text
is never faded, and adds its film's borders and coloured shadow. Terminal and
btop backgrounds go see-through through Omarchy's Glassy mode
(`omarchy hyprland window transparency glassy`), a machine setting the themes
do not change. A theme's own `hyprland.lua` replaces the one Omarchy renders
from `colors.toml`, so it repeats the border gradient.

## Layout and install

```
backdrop/            the shell plugin (manifest.json, Backdrop.qml)
themes/<slug>/       one Omarchy theme each: colors.toml, hyprland.lua,
                     backgrounds/ (a still: lock screen, previews, fallback),
                     backdrop.frag, preview.png
install              compile contract.glsl + each backdrop.frag with qsb
                     (needs qt6-shadertools), link backdrop/ into
                     ~/.config/omarchy/plugins/sean.backdrop and each theme into
                     ~/.config/omarchy/themes/<slug> (never over a real
                     directory), then `omarchy plugin enable sean.backdrop`
```

Themes are linked, not installed with `omarchy theme install`: a theme cloned
from git loses its `hyprland.lua`, which carries the glass.

## What it avoids

- No change to Omarchy's own background plugin or OWE: the still wallpaper
  stays under the backdrop, and remains the lock screen and theme preview.
- No video loops, no second renderer process, no HUD widgets, no screen shader.
- No per-theme code: a new film is a theme directory with one shader.

## Edge cases it must hold

Theme without a backdrop (surface hidden). Switching between two backdrop
themes, and between a backdrop theme and a stock one. A colour overlay on a
backdrop theme. Tiled and floating windows, open, close, move, resize, split
changes, workspace switch, special workspace shown, fullscreen, maximise.
Several monitors, each seeing only its own workspace, at different scales.
Shell restart and Hyprland config reload. Lock, idle screensaver, animations off.
Battery: measure first; lower the frame rate on battery only if the
measurement says so.

## Non-goals

HUD widgets and data readouts. Restyling app internals beyond what Omarchy
already themes. Publishing the themes for `omarchy theme install`.

## Acceptance

1. `./install` compiles every shader (qsb fails on any error) and links.
2. For each theme: `omarchy theme set <slug>`, then a screenshot of workspace 1
   (T3 Code left, btop over Slack right), before and after, read for legibility.
3. GPU and battery draw measured with the backdrop live on workspace 1 and on an
   empty workspace, against the same with a stock theme.
4. `omarchy theme set retro-82`: the backdrop surface draws no frames.
5. Transitions: film to film, film to stock and back, rapid switching, re-apply
   after a rebuild (new shader shows); fullscreen on and off (resumes);
   special workspace shown and hidden; animations off (still frame follows a
   window move); lock and unlock; shell restart.
6. Cost: each theme animated vs frozen, with blur on and off.
