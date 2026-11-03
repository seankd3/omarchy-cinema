# Polish hillclimb: audit and ranked list (2026-11-03, films/batch-1)

**Sentence:** the six films get cheaper, calmer and more exact without
losing their look, on any desktop they are applied to.

## Evidence

Stills of every film in the hidden desktop at rest, mid-move, landed,
opening, closing, Files focused and a workspace switch, at Sean's 2880x1800
and at 1920x1080 scale 1 with nine windows: scratch/batch1/stills-base and
stills-1080 (out of git). GPU ms a draw at 2880x1800 from tools/gpu-bench,
interleaved, runs with tight ranges only (specs/smoothness.md says why).
Rest, drag, land and open on main 11ae318: Jarvis 4.18 4.53 4.77 4.53, Tron
Legacy 3.17 4.26 3.52 2.97, Oblivion 3.96 4.35 4.32 4.42, The Matrix 5.59 6.03
6.28 5.75, Evangelion 4.28 4.68 4.84 4.69, Roadster 3.62 3.69 4.26 3.88. On
top of that each window's frame, which tools/gpu-bench --frames times over
the whole screen.

Worst muted-text contrast over the glass, estimated (scratch/batch1/contrast.py:
the glass amount of background kept, the rest the world under a Gaussian in
place of Hyprland's Kawase frost, without Omarchy's noise and vibrancy, dimmed
by its blur brightness), over the storyboard's four moments at three times
each, at the edge, 4 px and 16 px in: Jarvis 4.50 4.55 4.55, Tron Legacy
4.12 at every depth, only in the landing moment (0.02 to 0.07% of the glass,
under the landing's wave; 6.3 or more in the other moments), Oblivion 4.17
4.42 4.66, The Matrix 2.11 4.69 4.70 (the outer 4 px, under its side
streams), Evangelion 4.69 5.05 5.26, Roadster 5.38 5.60 5.60. Near 4.5 the
model is not enough; a judge through Hyprland's own blur is the next step.

## Batch 2 (asked by Sean first)

- **Taste. The view does not move with the pointer** (taste sheet 2):
  Jarvis, Oblivion, Evangelion, the Matrix and Roadster lose their pointer
  lean, keeping the pointer's light and a dragged window's pull. Done:
  `films/still-view`.

## Ranked

1. **Performance. A window's frame runs only over its ring.** The frame pass
   drew its quad over the window's whole box grown 48 px, so every pixel of
   every window ran the frame program to return nothing (contract.glsl: a
   frame draws at most 2 px inside). Now the pixels wholly inside that are
   left out, as Hyprland's border does. The three windows' frames, ms, before
   and after, pixel-identical: Jarvis 1.28 0.54, Tron Legacy 1.89 1.02,
   Oblivion 1.60 0.69, The Matrix 1.30 0.53, Evangelion 1.36 0.64, Roadster
   1.21 0.47. Done: `films/frame-ring`.
2. **Performance. The Matrix reads a landing's glyph only where a landing
   reaches.** Every pixel fetched a character and its glyph to multiply by a
   landing's light, zero at rest. 5.55 to 4.98 ms at rest, 6.31 to 5.98
   landing, pixel-identical. Done: `films/matrix-glyph`.
3. **Detail and performance. Tron's frame looks at the world once**, 10 px
   in, as the other five do; the second look was discarded beyond 6 px and
   smeared a grid line meeting the edge into a streak along it. Frames 3.26 to
   2.27 ms over the whole screen. Done: `films/tron-frame`.
4. **Practicality. Gaps scale with the screen** (taste sheet 1): 64 px for
   each 1440 of the smallest screen's shorter side, following the screens as
   they change while the gaps are still film.lua's. Done: `films/gaps`.
5. **Robustness. The glass holds muted text's contrast for any palette.**
   The Matrix, Evangelion and Roadster each derived by hand how bright their
   world may be behind the glass; now the plugin's glass step holds each
   pixel Hyprland composites over its frost so muted text keeps 4.5:1, in the
   palette's direction, or, where the theme's own shade is short of that, no
   less than on that shade drawn solid. Their limits, BLUR_REACH and their derivations went.
   Done: `films/contrast`.
6. **Elegance, next contract version. The contract's per-field readers repeat
   window().** `windowDepth` has no caller; `windowDistance` only the
   backdrop main's. The films share answers' geometry, each in its own ink:
   closing as a ring from 40 px out at 240 px a second (Jarvis, Oblivion,
   Roadster), opening as a ring settling from 60 px over 0.7 s (Jarvis,
   Oblivion; Roadster's brackets close from 60 to 12 px over 0.6 s, their
   own), focus as a 30 px warm swell over 0.9 s (all three). Helpers for what
   is shared. Each is a contract change, so they go together.
7. **Robustness, other drivers.** Derivatives in control flow that differs
   within a 2x2 quad are undefined in GLSL: Oblivion's `dFdy` in the cloud
   deck (under the horizon branch, and the whole backdrop() under the veil's
   branch in main-backdrop.glsl), Tron's `fwidth` under `if (ground)` and in
   the backdrop() its frame calls. It shows nothing on this NVIDIA; another
   driver may draw a wrong pixel along those lines. Shape: derivatives that
   do not depend on the branch: Tron's cell size is a function of the screen
   point and can be computed; Oblivion's slope of its noise cannot, so it
   takes a second sample of the deck a pixel down, or the derivative moves
   out of every branch.
8. **Performance, measured not yet acted on.** Every film loops over the
   windows at every pixel, Evangelion and Oblivion twice; nine windows cost
   about three times what three do. Evangelion's second loop, at the
   honeycomb cell, is about 0.7 ms (a shared run).
9. **Elegance.** The six `gtk.css` share 22 selectors but each film's rules
   differ; only the `:root` roles could come from `colors.toml` (RELEASE.md
   order 3).
10. **Packaging.** A cloned film's popup base and folder icons have no staging
    point yet (RELEASE.md, "Still open").
