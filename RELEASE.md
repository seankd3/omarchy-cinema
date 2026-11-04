# Omarchy Cinema: release shape

**Sentence:** cinema themes for Omarchy, plus what lets any Omarchy theme come
alive the same way: a live backdrop drawn around the windows in the same
frame, glass that keeps text solid, and Files, folders, bar and the Voxtype
popup in the film's style. Published at github.com/seankd3/omarchy-cinema,
then to be proposed to Omarchy as a Discussion.

Omarchy's answer to tuning is convention over configuration, so nothing here
adds a settings file, a menu or a knob that Omarchy does not already have.

## The shape

1. **A preset is a theme.** A cinema theme is an ordinary Omarchy theme
   directory: it shows in Omarchy's theme picker with its preview and is
   applied with `omarchy theme set`. Six ship: Jarvis, Tron Legacy, Oblivion,
   The Matrix, Evangelion, Roadster.
2. **Optional files override documented defaults**, the way Omarchy fills a
   theme's missing files from its themed templates:
   - `backdrop.frag`: the live backdrop; without it, none.
   - `voxtype-osd.toml` and its QML: the dictation popup; without it,
     Voxtype's own (Voxtype's `[osd] style = "theme"`, upstream PR).
   - `gtk.css`, `folders.json`: Files and the folder icons; without them, the
     cinema defaults rendered from `colors.toml`.
   - `shell.bar.toml`: the bar; without it, Omarchy's generated bar.
   Anything a theme ships as literal colours (its `gtk.css`, `folders.json`)
   takes them from `colors.toml` roles instead, so a copied theme with a new
   palette is recoloured everywhere.
3. **Tuning is Omarchy's own toggles, then Hyprland config.** The toggles
   Omarchy's menu already flips decide the cinema features too:
   - *Glassy windows* on: windows are glass, at the theme's amount; *Opaque
     windows*: solid.
   - *No animations*: the backdrop holds still and costs nothing: Hyprland's
     `animations:enabled` is the one authority for decorative time and focus
     easing, so with it off the plugin redraws only when windows change.
   - *No gaps*, *Corners*: apply to the cinema spacing and rounding.
   - *Glassy bar*: the bar's glass.
   Finer values are Hyprland keys (`plugin:backdrop:depth`, the gaps):
   `film.lua` sets defaults, the user's `~/.config/hypr` and the toggles load
   after it and win.
4. **Anyone can make one.** Copy a cinema theme directory (Omarchy's
   documented way to make a theme), change `colors.toml`, write one GLSL
   function `backdrop(px)` against `plugin/contract.glsl`. Planned: one
   command for the rest, `omarchy-cinema new <name> [--from <theme>]`,
   `omarchy-cinema preview <theme>` (backdrop and popup stills, off screen)
   and `omarchy-cinema check <theme>` (the shader compiles against the
   contract, `gtk.css` parses, the manifests are complete).

## Glass

Terminals and GTK can draw their own translucent background with solid
text, but Electron apps create an opaque native window that no theme file
can change. So the compositor glass is the one mechanism for every app,
keyed on the theme's background colours. Hyprland blurs only a window it
considers translucent, so glass windows are the ones Omarchy's *Glassy
windows* mode makes translucent (near-opaque `0.999`, with
`render:use_shader_blur_blend`), and the glass step runs in Hyprland's blur
pass for those windows. *Opaque windows* turns it off with the rest of
glassy mode; browsers stay solid. Close snapshots and subsurfaces keep their
glass, the alpha applies once, and colours compare in the space the app drew
them. The plugin replaces Hyprland's surface shader only when the user has
none of their own; with one, glass stays off and says so. Exact opacity 1
would need a per-surface render integration (glass eligibility read per
surface, the blurred backdrop drawn behind a client that declares itself
opaque, occlusion updated); that is a later design.

## What it deletes, once built

- **film.lua's late overrides** (the `config.reloaded` callback, the rules
  that make every window transparent outside glassy mode): what stays is
  defaults the user's config and the toggles override.
- **The popup workaround** once a Voxtype release ships `style = "theme"`:
  the stock template, install's copy into the applied theme and the per-film
  file names. Install's Voxtype settings shrink to the Quickshell OSD,
  `style = "theme"`, and clearing a pinned `plugin_path` or fixed palette,
  which would win over the style.
- **The preview's fake glass overlay**; the two preview tools share
  `omarchy-cinema preview` and keep their own renderers.

## Packaging

The engine is one Arch package for x86_64 and aarch64 (`PKGBUILD`, MIT):
the plugin and `film.lua` in `/usr/lib/omarchy-cinema`, built by
`plugin/Makefile`'s install, which `./install` uses too. It depends on exactly
the Hyprland package it was built against, release included. A film is a
theme directory with no code, for `omarchy theme install`: values in
`colors.toml`, borders from Omarchy's template. The plugin compiles whatever
`backdrop.frag` the applied theme has, at every theme switch, against its own
contract, and refuses one written for another contract with a notice that
names the fix (SPEC.md, "Theme switch"). Films are not compiled into the
plugin: every shader edit would need a rebuild and a login, and Omarchy's
same-name overlay of a shipped film's `backdrop.frag` or `colors.toml` would
be ignored.

Still open: a cloned film's popup base (a fixed engine path its QML imports)
and folder icons have no staging point yet, so the package ships the plugin
and `film.lua` only, and `./install`'s popup and icon steps stay.

**From the developer's install to the package.** Hyprland reads
`hyprland.lua` again at every config reload, a theme switch included, and
loads and unloads plugins to match it, so the switch is made logged out,
from a TTY:

1. Build and install the package (`makepkg -si` in a clone).
2. In `~/.config/hypr/hyprland.lua`, load
   `"/usr/lib/omarchy-cinema/backdrop.so"` and run
   `dofile("/usr/lib/omarchy-cinema/film.lua")()` in place of the two
   `~/.local/lib/omarchy-cinema` lines, and remove
   `~/.local/lib/omarchy-cinema`. Then log in.

From then on `./install` leaves the package's engine alone and still links
the themes and the rest; while `hyprland.lua` still loads the other engine,
it stops without changing anything. On a fresh config `./install` adds both
engine lines after Omarchy's defaults only while no Hyprland of the user's
runs: a line added in a session would load the plugin at once, so there it
stops and says so.

**The pin, without blocking `omarchy update`.** An exact `hyprland=`
dependency makes pacman stop a whole `omarchy update` when Omarchy ships a
new Hyprland and the engine has not been rebuilt. Proposed: the engine goes
into omarchy-pkgs, the repository Omarchy's Hyprland comes from, and is
rebuilt there in the same push as each Hyprland it ships, so the two always
move together and the pin never blocks. An AUR build, which no one rebuilds
in lockstep, takes the other side: it depends on `hyprland` without a
version, so updates are never held; after a Hyprland update the plugin
refuses to load until the user rebuilds the package, and the desktop runs
without the backdrop meanwhile. The PKGBUILD here is the pinned one.

## Non-goals

A settings file or a Cinema menu; HUD widgets or data readouts; a full-screen
post-process shader; Omarchy core changes in this repo (they are the
Discussion's job).

## Release gate

Held: the README (install, the toggles, uninstall, authoring, the
fan-homage note and where every image comes from; MIT);
`./install --uninstall`, which takes away only what the install added and
puts back the Voxtype settings it changed; `tools/fresh-user`, a new Omarchy
user from /etc/skel, logged in once for Omarchy's first-run setup, in a
hidden desktop: install, a login whose own config loads the engine with zero
config errors, a film applied and drawing, Omarchy's first theme again, an
uninstall refused in the session and run after logging out, and every path
the install changed back as it was.

Not yet tested:
- x86_64 and GPUs other than NVIDIA's.
- Transitions on a real desktop: glassy, opaque, glassy; film to film to
  stock; Files already running; no animations on and off; a broken shader;
  a Hyprland update.
- An install from before 2026-11-04 has no record, so its uninstall leaves
  its two config lines and two templates, to take out by hand.

Plan items not built: glass follows glassy mode with film.lua's late
overrides gone; theme assets from `colors.toml` roles; the `omarchy-cinema`
command; popups on Voxtype's `style = "theme"` once a release has it.
