# Polish hillclimb: audit and ranked list (2026-11-02)

**Sentence:** the seven films get calmer, cheaper and smaller without losing
their look, and each can ship as a plain Omarchy theme.

## Evidence

Stills: each film's theme preview in the hidden desktop
(`tools/theme-previews`, kept out of git in
`/home/sean/Projects/omarchy-cinema-polish/scratch/audit/<slug>-before.png`).

GPU, one full-screen backdrop draw at 2880x1800, at rest on workspace 1's
layout (tools/preview.py's setup timed with a GL query, five interleaved
rounds, medians; the machine also ran CI and Sean's desktop):

| film | ms | | film | ms |
|---|---|---|---|---|
| Jarvis | 9.02 | | Roadster | 7.16 |
| Jurassic Park | 8.86 | | Oblivion | 6.21 |
| Evangelion | 7.80 | | Tron Legacy | 5.28 |
| an empty pass | 0.43 | | The Matrix | 6.72 raining, 4.50 not |

specs/depth.md budgets 1.5 ms. Sean's own Hyprland on Tron used about 70% of
the GPU's SM time at idle, with the clock held at 734 of 3003 MHz. Jarvis
with parts switched off: its wake loop at rest 1.6 ms, the gyroscope 1.4, the
window-under-pixel lookup 1.0, shadows 0.9, the globe 0.2. The cost is spread
over per-pixel loops over every window, each helper looping again.

Worst muted-text contrast over the glass (scratch/edge-judge.py, three times
of day), at the window's edge and 4 px in: Jarvis 6.7 and 6.7, Tron 5.3 and
6.4, Evangelion 5.6 and 6.0, Roadster 5.9 and 6.0, Jurassic Park 4.0 and 6.1,
The Matrix 3.6 and 5.4, Oblivion 4.0 and 4.0. The judge models a dark film's
dimmed frost, so Oblivion's light frost reads better than that. The judge
packed two texels a window after the contract went to three; fixed copy in
the worktree's scratch/.

## Ranked

1. **Elegance. Jurassic Park keeps one landscape.** `backdrop-plain.frag`
   was `backdrop.frag` with `LABELS = false`; nothing loaded it. Deletes 713
   lines. Done: `polish/jp-one-landscape`. Which look ships: taste sheet 1.
2. **Packaging. Film themes hold no Hyprland code.** Glass and frost are data
   in `colors.toml`, the session runs `film.lua` after Omarchy's defaults,
   borders come from Omarchy's template, install ends with
   `omarchy-theme-refresh`. Deletes seven `hyprland.lua`, film.lua's border
   copy, install's popup copy. Done: `polish/films-as-data`.
3. **Performance. A still window's wake costs nothing.** Jarvis and Oblivion
   measured a window's distance before checking that it moves. Jarvis 9.02 to
   8.09 ms, Oblivion 6.21 to 6.08, pixel-identical. The whole hidden desktop
   (tools/smoothness, three interleaved rounds, at load 70 to 90) cannot see
   it: Jarvis 12.78 and 12.80 ms a frame, Oblivion 11.99 and 11.84. Done:
   `polish/still-wakes`.
4. **Performance, waits for plugin/. Each window's distance at a pixel,
   measured once.** `nearestWindow`, `windowGlow`, `windowOver` and each
   film's own loops (Jarvis's `windows()`, its wake, its edge lines) measure
   the same rounded-rect distance to every window again. The shape: the
   contract measures it once a pixel and the helpers and films read it,
   while each film's per-window answers (shadows, wakes, flow) stay its own.
   To be measured on Jarvis before any loop is claimed; the draw rate at rest
   is the smoothness lane's.
5. **Elegance, waits for plugin/.** `glowLine` is copied in six films and
   `segment` in three, with one constant apart: contract helpers.
6. **Packaging, waits for plugin/. The engine package.** PKGBUILD for x86_64
   and aarch64 pinned to its Hyprland, the engine reading its own shaders,
   the plugin reading `glass` from `colors.toml`. Deletes install's per-SDK
   build, rebuild hook and notice, and film.lua's late glass write. Open: a
   cloned film's popup base (a fixed engine path the QML imports) and its
   folder icons, which have no staging point yet: Omarchy applies icons
   before its theme-set hooks run, so the first application of a cloned film
   needs a step before that (or an Omarchy change, for the Discussion).
   Install's icon loop stays until one exists.
7. **Docs, waits for plugin/.** contract.glsl says Hyprland's border and
   shadow are off for a film with `frame()`; since 70ce3d6 both stay on.
8. **Taste.** Jurassic Park's labels, Jarvis's glass: specs/taste-sheet.md.
9. **Elegance, next.** The seven `gtk.css` share 22 selectors but each
   film's rules differ (Roadster's brackets, Oblivion's soft frames), so they
   are not copies; only the `:root` roles could come from `colors.toml`
   (RELEASE.md order 3), which moves literal colours a little.
10. **Docs, next.** SPEC.md and RELEASE.md count six films; seven ship.
