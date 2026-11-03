# Omarchy Cinema: public release plan

**Sentence:** cinema themes for Omarchy, plus what lets any Omarchy theme come
alive the same way: a live backdrop drawn around the windows in the same
frame, glass that keeps text solid, and Files, folders, bar and the Voxtype
popup in the film's style. Published at github.com/seankd3/omarchy-cinema,
then proposed to Omarchy as a Discussion (Sean, 2026-10-28: own repo first,
keep the film names).

Sean on tuning: "think long and hard about what the most elegant solution for
this really would be ... What would DHH do? ... a super elegant, kind of first
party feeling way". Omarchy's own answer is convention over configuration, so
nothing here adds a settings file, a menu or a knob that Omarchy does not
already have.

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
     easing, so with it off the plugin stops waking and redraws only when
     windows change (since specs/smoothness.md, nothing asks for frames).
   - *No gaps*, *Corners*: apply to the cinema spacing and rounding.
   - *Glassy bar*: the bar's glass.
   Finer values are Hyprland keys (`plugin:backdrop:fps`, `battery_fps`, the
   gaps): `film.lua` sets defaults, the user's `~/.config/hypr` and the
   toggles load after it and win.
4. **Anyone can make one.** Copy a cinema theme directory (Omarchy's
   documented way to make a theme), change `colors.toml`, write one GLSL
   function `backdrop(px)` against `plugin/contract.glsl`. One command does the
   rest: `omarchy-cinema new <name> [--from <theme>]`, `omarchy-cinema preview
   <theme>` (backdrop and popup stills, off screen), `omarchy-cinema check
   <theme>` (shader compiles against the contract, `gtk.css` parses, the
   manifests are complete). Omarchy's dispatcher only reads its own bin
   directory, so this is `omarchy-cinema` until it goes upstream.

## Glass

Sol's plan review (2026-10-28) settled it: terminals and GTK can draw their own
translucent background with solid text, but Electron apps (T3 Code, Slack,
LM Studio) create an opaque native window that no theme file can change. So
the compositor glass stays as the one mechanism for every app, keyed on the
theme's background colours, with today's contract stated plainly: Hyprland
blurs only a window it considers translucent, so glass windows are the ones
Omarchy's *Glassy windows* mode makes translucent (near-opaque `0.999`, with
`render:use_shader_blur_blend`), and the glass step runs in Hyprland's blur
pass for those windows. *Opaque windows* turns it off with the rest of glassy
mode; browsers stay solid. Findings 2 to 5 are fixed where the contract
allows (close snapshots and subsurfaces keep their glass, the alpha applies
once, colours compare in the space the app drew them) and the rest are
documented limits. The plugin replaces Hyprland's surface shader only when
the user has none of their own; with one, glass stays off and says so.
Exact opacity 1 would need a per-surface render integration (glass
eligibility read per surface, the blurred backdrop drawn behind a client
that declares itself opaque, occlusion updated); that is a later design, not
this release.

## What it deletes

- **film.lua's late overrides** (the `config.reloaded` callback, the rules
  that make every window transparent outside glassy mode): what stays is
  defaults the user's config and the toggles override.
- **The popup workaround** once a Voxtype release ships `style = "theme"`
  (the supported route is that release from Voxtype's own packages, AUR or
  release binaries, with its Quickshell frontend installed by
  `voxtype setup quickshell`): the stock template, install's copy into the
  applied theme and the per-film file names. Until that release, the
  workaround stays. Install's Voxtype settings shrink to the Quickshell OSD,
  `style = "theme"`, and clearing a pinned `plugin_path` or fixed palette,
  which would win over the style.
- **The preview's fake glass overlay** (Sol finding 7); the two preview tools
  share `omarchy-cinema preview` and keep their own renderers.

## Packaging (coordinator, 2026-11-02; shape settled 2026-11-03)

The engine is one Arch package for x86_64 and aarch64 (`PKGBUILD`, MIT):
the plugin and `film.lua` in `/usr/lib/omarchy-cinema`, built by
`plugin/Makefile`'s install, which `./install` uses too. It depends on exactly
the Hyprland package it was built against, release included. A film is a
theme directory with no code, for `omarchy theme install`: values in
`colors.toml`, borders from Omarchy's template. The plugin compiles whatever
`backdrop.frag` the applied theme has, at every theme switch, against its own
contract, and refuses one written for another contract with a notice that
names the fix (SPEC.md, "Theme switch"). Compiling the shipped films into the
plugin (the first attempt, c521c6e) was rejected: every shader edit needed a
rebuild and a login, and it ignored Omarchy's same-name overlay of a shipped
film's `backdrop.frag` or `colors.toml`.

Still open: a cloned film's popup base (a fixed engine path its QML imports)
and folder icons have no staging point yet (specs/polish.md, item 6), so the
package ships the plugin and `film.lua` only, and `./install`'s popup and icon
steps stay.

**The switch on Sean's machine** (not done; each step waits on Sean). Hyprland
reads `hyprland.lua` again at every config reload, a theme switch included,
and loads and unloads plugins to match it, so the config is changed only while
Sean is logged out (from a TTY), never in a running session:

1. Build and install the package (`makepkg -si` in a clone). From then on
   pacman refuses a Hyprland update until the package is rebuilt for it (see
   below), which keeps the next login from loading a plugin its Hyprland
   refuses.
2. Logged out: in `~/.config/hypr/hyprland.lua`, load
   `"/usr/lib/omarchy-cinema/backdrop.so"` and run
   `dofile("/usr/lib/omarchy-cinema/film.lua")()` in place of the two
   `~/.local/lib/omarchy-cinema` lines; remove `~/.local/lib/omarchy-cinema`
   and `~/.config/omarchy/hooks/post-update.d/omarchy-cinema-rebuild`, the old
   rebuild after `omarchy update`, which the pin replaces. Then log in.
3. From then on `./install` sees the package and leaves its engine alone: it
   builds no plugin, and stops without changing anything while `hyprland.lua`
   still loads the other engine; it still links the themes and the rest.
4. The themes stay links into the checkout until films ship on their own; a
   contract change then needs the package rebuilt and a login before a theme
   switch, and the notice says so if it is missed.

On a fresh config `./install` adds both engine lines after Omarchy's
defaults only while no Hyprland of the user's runs (from a TTY, before the
first login): Hyprland reloads its config whenever the file changes, so a
line added in a session would load the plugin at once. In a session it stops
and says so.

**The pin for other users, without blocking `omarchy update`.** An exact
`hyprland=` dependency makes pacman stop a whole `omarchy update` when Omarchy
ships a new Hyprland and the engine has not been rebuilt. Proposed: the engine
goes into omarchy-pkgs, the repository Hyprland already comes from here
(`pacman -Si hyprland`: repository omarchy, 0.57.0-4), and is rebuilt there in
the same push as each Hyprland it ships, so the two always move together and
the pin never blocks. An AUR build, which no one rebuilds in lockstep, takes
the other side: it depends on `hyprland` without a version, so updates are
never held; after a Hyprland update the plugin refuses to load (Hyprland's own
message) until the user rebuilds the package, and the desktop runs without the
backdrop meanwhile. The PKGBUILD here is the pinned one, for the omarchy-pkgs
route.

## Non-goals

A settings file or a Cinema menu; HUD widgets or data readouts; a full-screen
post-process shader; Omarchy core changes in this repo (they are the
Discussion's job).

## Release gate

- All six themes seen live on the P16 by Sean, with before and after
  screenshots of workspace 1 and Files.
- GPT-6.1 Sol review of each theme's shader, CSS and popup, and of the
  plugin and tooling.
- From empty, on the supported versions (Omarchy 4 as of 2026-10, Hyprland
  0.57, GTK 4.24, named in the README): a fresh user runs the install, logs in
  again (the install adds the plugin's one load line to
  `~/.config/hypr/hyprland.lua`, the only loader; native code never loads or
  unloads in a running Hyprland), applies a cinema theme, and gets the
  backdrop, Files, folders and popup with zero config errors. Voxtype is
  optional; when present, the install selects its Quickshell OSD and
  `style = "theme"`.
- Transitions: glassy, opaque, glassy; film to film to stock; Files already
  running; no animations on and off; a broken shader; a Hyprland update.
- Uninstall removes only what the install added (the two config lines,
  templates, links, Voxtype settings it changed) and keeps the user's own.
- Same-frame motion and idle cost as in SPEC.md's acceptance.
- README: what it is, one screenshot per film, install, the toggles,
  authoring; MIT licence; a note that the themes are fan homages, not
  affiliated with the studios or Tesla.
- The repo is created private for the review flow (PRs from now on) and made
  public at the gate.

## Order (stacked PRs, one sentence each)

1. Glass follows glassy mode and its findings are fixed; film.lua's late
   overrides go.
2. No animations stops the backdrop's clock.
3. Theme assets take colours from `colors.toml`; cinema defaults for themes
   without their own Files styling.
4. `omarchy-cinema` command (new, preview, check, install, uninstall); the
   preview tools share one entry point and keep their own renderers.
5. Popups on Voxtype's `style = "theme"` once a Voxtype release has it,
   workaround deleted.
6. Live review fixes for Oblivion, The Matrix, Evangelion, Roadster.
7. README, licence, screenshots, uninstall; then public, then the Omarchy
   Discussion.
