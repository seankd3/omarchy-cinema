# Taste sheet

Questions for Sean, one line each, with stills and a recommendation, and the
coordinator's rulings he has not overridden. The 2026-11-03 answers (films as
data, Jarvis's glass 0.6) are in git history.

1. Gaps scale with the screen (coordinator, 2026-11-03): 64 px for each 1440
   of the smallest screen's shorter side, so 64 on your 2304x1440 as before,
   48 at 1920x1080, 34 at 1366x768; between windows half that a side. Nine
   windows at 1080: the smallest terminals 380x427 before, 404x451 now.
   Stills, before and after: scratch/batch2/gaps/{base,after}/.
2. The world's view does not move with the pointer, in any film
   (coordinator, 2026-11-03, after your "I liked how it stayed symmetrical"
   on Tron): the pointer may light things, and a dragged window still pulls
   or leans the view. Jarvis's globe no longer turns toward the pointer.
   Moving the pointer corner to corner changed 28, 4, 40, 20 and 7% of the
   screen in Jarvis, Oblivion, Evangelion, the Matrix and Roadster, now 2.6,
   1.3, 0, 0 and 0.2% (its light). Stills: scratch/batch2/view/sheet-*.png.
3. The Matrix's depth (films/matrix-depth): the far rain goes soft, letters
   lost to focus, and the near rain never shows through the glass, so text
   sits on calmer glass. Recommend keeping it. Stills:
   scratch/batch2/depth/matrix-{empty,windows}-12-before-after.png,
   matrix-swap-{before,after}.png.
4. The glass's frost (films/frame-budget): the plugin makes it now, so the
   glass shows the world brighter and a little sharper than Hyprland's frost
   did (no 0.75 dimming, noise or vibrancy); muted text still holds 4.5:1.
   Keep, or dim the frost to match the old look? Recommend keeping.
   Stills: scratch/batch2/frame-budget/*-before-after.png.
5. A window's rim shows the world at half size (films/budget): the bent
   world in each frame's edge is read from the world already drawn, not drawn
   again, which takes 0.3 to 0.6 ms off every frame. Jarvis, Oblivion,
   Evangelion and Roadster look the same; in Tron and the Matrix a grid line
   or glyph crossing a rim turns from a sharp bent glint into a soft dot.
   Keep, or draw the rim at full size in those two (Tron 0.3 ms, the Matrix
   0.35 ms a frame)? Recommend keeping. Stills, 3x, before and after:
   scratch/batch3/taste/rim-{tron-legacy,the-matrix}-before-after.png.
6. The notifications frost the world, as the bar does (films/budget):
   their layer stays on screen, empty, down the right edge, and its live
   blur cost 0.8 ms every frame. A notification over a window now shows the
   film's frost through its card, not the window under it. Recommend keeping.
   Stills: scratch/batch3/taste/notify-{before,after}.png.
7. The films' own motion at rest (coordinator, 2026-11-04, on your "as
   lightweight as it can possibly be while still looking as good as it
   can"; built in films/still-at-rest): the world's own motion runs on the
   desktop's clock. It moves while windows move, open, close, take focus or
   slide between workspaces, and eases to still about two seconds after;
   a still desktop draws nothing of its own. At 1440x900 at rest the films
   presented 1.0 to 1.4 frames a second at 0.2 to 0.7 GPU ms a second
   (Roadster 1.3 and 1.7, on a GPU then shared with your session), against
   1.0 and 0.6 for a stock theme with the plugin idle and 2.0 frames with no
   plugin; before, 43 to 50 frames and 83 to 114 ms. The small parts hold
   still at rest too: Tron's light cycles and pulses, the bar's markers, the
   drone's ring, the streaks, and the Matrix's rain (its text changes only
   while the world moves). What keeping them alive cost before, measured:
   batch 4's tiles (about 8k tokens of plugin and a pace in every film)
   presented 43 to 50 frames a second at rest in every film, and the
   Matrix's whole scene with the agents writing cost 88 to 113 GPU ms a
   second. What one small part alone would cost is not measured.
   Recommend: all of it still at rest, as built. Decided (coordinator,
   2026-11-04): as built.
8. The pointer (coordinator, 2026-11-04: let it go; built in films/pointer,
   contract 8): the five films' faint light round the pointer is gone, and
   with it the whole-world redraw every mouse move asked for, so a mouse
   move draws what a stock theme's does. Stills, before and after with the
   pointer at the screen's middle: scratch/batch6/taste/pointer/. Asked:
   in every film, each mouse move drew the whole world again
   (the plugin damaged the monitor for the pointer's light), as moving a
   window does: 1.65 ms a frame in the Matrix, 1.86 in Oblivion and 1.93 in
   Evangelion at 1440x900, every frame the pointer moves. Five films light
   the world round the pointer (Jarvis, Tron, Oblivion, the Matrix,
   Roadster), faintly. Keep it, or let the light go with the redraw it
   asks for, so moving the mouse draws only what a stock theme draws
   (to be measured once built)? Recommend letting it go: the mouse moves
   most of the day.
