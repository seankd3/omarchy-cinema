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
     windows change (today the timer keeps rearming; to fix).
   - *No gaps*, *Corners*: apply to the cinema spacing and rounding.
   - *Glassy bar*: the bar's glass.
   Finer values are Hyprland keys (`plugin:backdrop:fps`, `battery_fps`, the
   theme's gaps), which a theme's `hyprland.lua` sets as defaults and the
   user's own `~/.config/hypr` overrides, like any Hyprland setting. Toggles
   load after the theme, so they win without the theme checking them.
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

- **film.lua's late overrides**: the `config.reloaded` callback that rewrites
  blur and Files opacity after the user's config and the toggles, and the
  rules that make every window transparent outside glassy mode. What stays is
  per-film defaults (borders and glow from `colors.toml`, the glass amount,
  the spacing), which the user's config and the toggles override.
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

## Non-goals

A settings file or a Cinema menu; HUD widgets or data readouts; a full-screen
post-process shader; publishing through `omarchy theme install` (a cloned
theme loses its `hyprland.lua`); Omarchy core changes in this repo (they are
the Discussion's job).

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
  running; no animations on and off; a broken shader; a Hyprland update
  (rebuild hook) and a failed rebuild.
- Uninstall removes only what the install added (the load line, templates,
  links, hook, Voxtype settings it changed) and keeps the user's own.
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
