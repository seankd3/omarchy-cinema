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
4. **Performance. Each pixel meets the windows once.** Done:
   `perf/window-pass`. On Tron every further loop over the three windows
   cost a draw 0.2 to 0.65 ms (the window under the pixel alone 0.65), a
   recent impulse's `windowAt` another loop per pixel, and the texture each
   look fetched about 0.4 ms. Now the contract reads and measures each window
   once (`window()`, `see()`), each film folds its own answers into one loop,
   and an impulse names its window. The windows stay a texture: as uniforms
   they drew 0.3 ms faster but capped a monitor at 128 windows.
   `tools/gpu-bench` against its first commit, ms a draw, before and after:

   | film | rest | drag | land | open | frames |
   |---|---|---|---|---|---|
   | Jarvis | 7.90 6.72 | 8.27 6.94 | 9.35 7.67 | 7.79 6.22 | 3.19 2.58 |
   | Tron Legacy | 5.15 3.15 | 6.39 4.23 | 5.96 3.53 | 4.92 2.99 | 5.72 3.28 |
   | Oblivion | 5.91 5.23 | 6.31 5.61 | 6.32 5.50 | 5.94 5.18 | 3.41 3.06 |
   | Evangelion | 7.59 6.71 | 8.14 7.25 | 9.01 7.56 | 7.97 6.58 | 3.23 2.65 |
   | Roadster | 6.98 5.64 | 6.94 5.43 | 8.95 6.82 | 7.03 5.23 | 2.81 2.47 |
   | The Matrix | 6.72 5.59 | 7.38 6.08 | 8.10 6.46 | 7.51 5.88 | 3.25 2.66 |
   | Jurassic Park | 8.59 7.66 | 9.16 8.14 | 11.23 9.57 | 10.18 9.16 | 4.40 4.03 |

   Frames are the three windows' frame passes, each drawn over the whole
   screen (about 1.3 ms of that is the early-out floor). Still over the
   1.5 ms budget; measured next: windows past 400 px skipped (Roadster -0.9,
   Evangelion -0.4, not pixel-exact), Jurassic Park's trace (7.0 ms with no
   windows at all).
5. **Elegance.** `glowLine` (six films, its halo a film's own), `segment`
   (three) and `around` (two): contract helpers. Done: `perf/window-pass`.
6. **Packaging, waits for plugin/. The engine package.** PKGBUILD for x86_64
   and aarch64 pinned to its Hyprland, the engine reading its own shaders,
   the plugin reading `glass` from `colors.toml`. Deletes install's per-SDK
   build, rebuild hook and notice, and film.lua's late glass write. Open: a
   cloned film's popup base (a fixed engine path the QML imports) and its
   folder icons, which have no staging point yet: Omarchy applies icons
   before its theme-set hooks run, so the first application of a cloned film
   needs a step before that (or an Omarchy change, for the Discussion).
   Install's icon loop stays until one exists.
7. **Docs.** contract.glsl said Hyprland's border and shadow are off for a
   film with `frame()`; since 70ce3d6 both stay on. Done: `perf/window-pass`.
8. **Taste.** Jurassic Park's labels, Jarvis's glass: answered, specs/taste-sheet.md.
9. **Elegance, next.** The seven `gtk.css` share 22 selectors but each
   film's rules differ (Roadster's brackets, Oblivion's soft frames), so they
   are not copies; only the `:root` roles could come from `colors.toml`
   (RELEASE.md order 3), which moves literal colours a little.
10. **Docs, next.** SPEC.md and RELEASE.md count six films; seven ship.
