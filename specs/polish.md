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
| an empty pass | 0.43 | | The Matrix | 4.50 |

specs/depth.md budgets 1.5 ms. Sean's own Hyprland on Tron used about 70% of
the GPU's SM time at idle, with the clock held at 734 of 3003 MHz. Jarvis
with parts switched off: its wake loop at rest 1.6 ms, the gyroscope 1.4, the
window-under-pixel lookup 1.0, shadows 0.9, the globe 0.2. The cost is spread
over per-pixel loops over every window, each helper looping again.

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
4. **Performance, waits for plugin/. The windows at a pixel, measured once.**
   Every film and contract helper (`nearestWindow`, `windowGlow`,
   `windowOver`, `focusedWindow`, shadows, wakes) loops over all windows
   again. One contract pass that gives a film the nearest window, the one on
   top and the pooled glow deletes those loops in the contract and in the
   films; it is the lever toward the 1.5 ms budget. The draw rate at rest is
   the smoothness lane's.
5. **Elegance, waits for plugin/.** `glowLine` is copied in six films and
   `segment` in three, with one constant apart: contract helpers.
6. **Packaging, waits for plugin/. The engine package.** PKGBUILD for x86_64
   and aarch64 pinned to its Hyprland, the engine reading its own shaders,
   the plugin reading `glass` from `colors.toml`. A fixed engine path lets a
   cloned film import `FilmOsd` and get folder icons built from
   `folders.json` when it is staged. Deletes install's per-SDK build, rebuild
   hook and notice, film.lua's late glass write, the per-theme `FilmOsd`
   copies and icon loop.
7. **Docs, waits for plugin/.** contract.glsl says Hyprland's border and
   shadow are off for a film with `frame()`; since 70ce3d6 both stay on.
8. **Taste.** Jurassic Park's labels, Jarvis's glass: specs/taste-sheet.md.
9. **Elegance, next.** The seven `gtk.css` share 22 selectors but each
   film's rules differ (Roadster's brackets, Oblivion's soft frames), so they
   are not copies; only the `:root` roles could come from `colors.toml`
   (RELEASE.md order 3), which moves literal colours a little.
10. **Docs, next.** SPEC.md and RELEASE.md count six films; seven ship.
