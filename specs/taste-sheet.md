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
