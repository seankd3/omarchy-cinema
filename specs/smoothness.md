# Smoothness of the backdrop

**Sentence:** the backdrop moves once per frame the display shows, by that
frame's own time, so its motion and the glass behind windows are smooth at
the display's rate.

Sean, 2026-11-02, once the glass followed every tick: "its still a bit laggy
and not super smooth".

## Cause

The backdrop's time came from a free-running wl_event_loop timer, rearmed at
`int(1000 / rate)` ms: 8 ms against an 8.33 ms frame at 120 Hz. Each tick
added the clock since the last tick, whatever frame it landed in, so most
frames moved 4% too little and about one in 25 moved two ticks at once: a
hitch about 5 times a second at 120 Hz. The timer's phase against the vblank
was arbitrary too, so a frame was sometimes asked for late in the interval.

## Shape

Each frame a monitor shows (Hyprland's `presented`) asks for its next while
the world moves there: at once, or, with a capped rate (`fps`,
`battery_fps`), from that monitor's own one-shot timer once its last moved
frame started an interval ago. Only frames the plugin asked for move time,
by the clock at their render.pre, which on hardware is just after the vblank
before the one they are shown at. Time counts only while the world moves:
when it moves on no monitor (animations off, locked, asleep, fullscreen),
the clock forgets its last move, and the next moved frame starts from there.
Nothing asks while it stands still, so the no-animations toggle stops all
waking. Every event that may start or stop it (a theme read or config change,
a lock, a window going fullscreen, a monitor coming, going, sleeping or
waking) settles it once Hyprland has finished the change, from one idle
callback that also applies the glass: Hyprland announces a lock and a
monitor leaving before it marks them. Any frame shown starts it too.

Deleted: the free-running timer, its rate arithmetic (fastest monitor, ms
rounding), the 0.1 s clamp that stood in for pause accounting (and halved
the speed at `fps = 5`), and the tick's own copy of "time stands still"
(`answering` and the clock share `moves`), and the glass's own idle
callback: `settleAnswers`, the wake and the glass are one `settle`.

## Measurement

`tools/smoothness [--rounds N] [--theme SLUG] [--size WxH] [REVISION...]`
builds each revision's plugin and runs it on this checkout's hidden desktop:
a film (Tron Legacy) with two glass terminals. frameclock shows frames on a
fixed 60 Hz vblank (Hyprland's Wayland backend reports 60 Hz whatever the
mode; 16 against 16.67 ms is the same 4% beat as 8 against 8.33). frameclock
logs each commit, and tools/frametrace.c, preloaded into the hidden Hyprland,
logs the `time` each backdrop draw uses. **missed** is the vblanks with no
new frame; between frames on consecutive vblanks, the backdrop's time should
step by one frame: **judder** is the RMS of each step minus 16.67 ms,
**jumps** the steps over 1.5 frames. GPU comes after, in its own 6 s:
sampling nvidia-smi pmon during the motion raised judder from 2.0 and 2.7 ms
to 3.7 and 4.2.

The hidden desktop runs at nice 19 under the floor CI (load 25 to 77) and
waits 40 to 280 ms a second for a CPU, against about 11 for Sean's Hyprland
(schedstat, 2026-11-02, mean 0.04 ms a slice). Rounds swing with that wait
more than with the plugin, so the verdict is a fit of each measure against
the wait, read at Sean's 11 ms/s. At Sean's 2880x1800 the hidden Hyprland took
83 to 92% of the GPU (14 to 15 ms a frame) beside his session after the
0.57.0-4 update, so every arm missed frames for GPU alone; the timing runs at
1440x900 (4.5 ms a frame).

## Log

2026-11-02, Hyprland 0.57.0-4, Tron Legacy, 1440x900, interleaved rounds.

1. Baseline, main: jumps 3 to 5% a round, the timer's beat; speed 0.96 to
   1.00. GPU 4.1 to 4.7 ms a frame.
2. Frames ask for frames, time at the predicted vblank (last presented plus
   whole frames). Measured twice against step 3, three rounds each; neither
   won beyond the CPU wait. Under the Wayland backend `presented` is when
   Hyprland handled the frame callback, not a vblank, so the hidden desktop
   cannot show what it would gain on hardware. Not kept: it adds code with
   no evidence.
3. Frames ask for frames, time at render.pre. Kept.
4. A capped wait still took a frame off, so at `fps = 30` every vblank
   moved. Fixed: 30 rendered a second, 12.07 s of motion in 12.1 s.
5. Review (Terra): per-monitor timers; the clock forgets its last move when
   the world stops instead of clamping each step to 0.1 s; every stop,
   lock and monitor removal included, settles from the loop. At `fps = 5`,
   main moves 6.0 s in 12.1 s, this 12.10 s. Animations off: both 0.000 s.
6. Final, 8 rounds of main and 11 of this, fit against CPU wait:

   | at 11 ms/s CPU wait | missed | judder | jumps |
   |---------------------|--------|--------|-------|
   | main                | 0%     | 3.4 ms | 3.3%  |
   | this                | 0.5%   | 2.9 ms | 1.0%  |

   At 150 ms/s both miss about 9% of vblanks and judder about 6 ms: the
   remaining roughness in the hidden desktop is CPU starvation. GPU per frame
   equal (4.1 to 4.7 ms).

## GPU per draw (2026-11-03, perf/gpu-2)

**Sentence:** the backdrop draws each pixel only as finely as its look needs:
behind a window whose glass shows the world only as a veil, at half
resolution, which the frost hides.

Where the time goes, at 2880x1800 (tools/gpu-bench and ablations, five
rounds interleaved). The GPU is shared with Sean's session and sits in one of
two states, about 25% apart (Jarvis 5.29 or 6.63 ms), so every comparison is
within one run.
- Every pixel is costly, and the windows' answers as much as the world:
  without windows, Jarvis 3.55 against 6.61 ms with workspace 1's three,
  Tron 1.60 and 3.10, Oblivion 3.34 and 5.17, Evangelion 4.03 and 6.63,
  Roadster 2.00 and 5.58, the Matrix 3.79 and 5.52; Jurassic Park's trace
  7.49 either way.
- 82% of workspace 1 is behind glass. Even a pixel there returning at once
  (a bound, not a look) leaves Jarvis 1.97, Tron 1.28, Oblivion 2.11,
  Evangelion 2.05, Roadster 1.61, the Matrix 2.33, Jurassic Park 3.79 ms:
  the 1.5 ms budget is out of reach at this GPU's clock without less work
  everywhere.
- The clock (measured again 2026-11-03, films/batch-1, nothing changed to
  look): the GPU held 754 MHz of 3003 idle at 1.6 W and under the bench at
  95% use, 2.6 to 3.3 W and 41 to 44 C, in P0, on mains with the
  "performance" platform profile, with "Reliability" the active clock reason
  and no power cap or thermal slowdown active (driver 615.78). Load did not
  raise it, so it is not the driver idling down under a light load; what
  sets the limit is not known. The batch's sampled benches ran at 754 MHz and
  perf/gpu-2's at 734 to 760, about a quarter of the rated clock; the other
  timings here were not sampled. There 64 vec4 multiply-adds a pixel cost
  0.66 ms over the 0.35 ms empty pass, so the budget is about 110 of them.
- The bench shares the GPU with Sean's session, whose Hyprland drew at 65
  to 72% of the GPU at moments of the same morning; a time query counts the
  other context's slices too, and the veil's two passes suffer most (Jarvis
  read 8.5 ms, then 4.2 alone). A run whose fastest and slowest rounds are
  more than a few percent apart was shared, and is run again.

**Shape.** Hyprland's frost (blur size 3, two passes) blurs what is behind a
glass window over about a dozen pixels, so a world drawn there at half
resolution and filtered back up looks the same, where the film lets only a
veil of its world through. That is the film's own fact, so it is data:
`behind_glass = "veil"` in colors.toml, for Jarvis, Oblivion, Evangelion
and Roadster (and Jurassic Park until Sean removed it on 2026-11-03). The plugin marks each window whose world reaches
the screen only through Hyprland's frost (frosted() in main.cpp, below); with
any marked, the backdrop program draws the world inside them into a half-size
texture first,
then the screen, reading that texture more than 8 px inside them
(main-backdrop.glsl). Frames, the bar, every other point and every point of
Tron and the Matrix stay full resolution.

Judged (scratch/prof/judge.py): every film over the seven scenes of
scratch/bench/same.py, main against this, through Hyprland 0.57's own Kawase
blur (blur1/blur2.glsl) at the film's frost, its brightness and its glass, in
levels of 255 on screen. Outside the windows every pixel is identical, and
so is every frame. Inside, the worst pixel and the pixels at 2 levels or
more, of about 4 million: Jarvis 4.8 and at most 2344, Jurassic Park 2.25 and
8, Evangelion 2.25 and 22, Roadster 1.7 and none, Oblivion under 1. At 1:1,
the worst spot of each beside main's cannot be told apart, nor can Jarvis's
glass in the hidden desktop. With clear glass and no dimming, the most any
compositing can let through, the worst is Jarvis's 16 levels on a blurred
line core and 3 to 6 for the rest, and at 1:1 it still cannot be told apart:
so the glass amount, an app's own alpha and the blur's brightness only make
it smaller.

Which windows (coordinator, 2026-11-03: decide from what the plugin's own
setup makes true, not a copy of Hyprland's blur formula). Nothing the plugin
owns says, before the windows are drawn, which pixels Hyprland will replace
by frost, and a wrong guess shows the half-resolution world sharp through a
translucent window (Omarchy's glassy terminals draw their own background at
0.65). What the plugin's setup does settle: a film session blends the frost in
the window's own shader (render:use_shader_blur_blend, which film.lua sets and
the glass runs in), where every pixel of a blurred surface comes out opaque,
its colour plus the frost under the rest, whatever its opacity, fade or alpha
modifier, and no client blur region clips it. So what is left to ask is
whether Hyprland draws the window that way over all of its rect (blurred,
untransformed, not proportional, no client visible region leaving part of it
undrawn) and whether the frost is the one measured (Kawase, size 3 or more,
two passes or more, contrast 1, brightness at most 1).

Not kept: Tron's grid at half resolution differs by up to 15 levels at the
horizon, where its far rows are finer than a half-size pixel, and blending
those rows into their average changed Tron's own horizon by up to 103 levels
and still left 8; the Matrix's frost is 1. Oblivion skipping its clouds under
the glass, which its daylight wash replaces, came to 8% and was not exact: 3
levels along the panes' edges, from the clouds' screen derivatives.

| ms a draw, main and this | rest | drag |
|---|---|---|
| Jarvis | 5.29 3.39 | 5.47 3.67 |
| Oblivion | 4.13 3.21 | 4.41 3.54 |
| Evangelion | 5.30 3.47 | 5.69 3.77 |
| Roadster | 4.44 2.96 | 4.24 2.99 |
| Jurassic Park | 5.80 5.38 | 6.20 5.59 |
| Tron Legacy | 2.45 2.50 | 3.29 3.38 |
| The Matrix | 4.37 4.44 | 4.72 4.80 |

Jurassic Park gains least: at half resolution neighbouring rays cross
different directories, so its trace runs as long as before for a quarter of
the pixels. Tron and the Matrix pay about 0.06 ms for the shared main.
tools/smoothness at 1440x900, three rounds each, GPU a frame rendered: Jarvis
3.60 to 3.72 ms on main, 3.43 to 3.47 here; Tron 3.22 to 3.32 and 3.12 to
3.28. Missed frames and judder follow the CPU wait, as before.

CPU: Sean's Hyprland waited 0.04 ms a slice on average, so starvation is not
a cause there; the hidden desktop's is its nice 19.

## Frame budget (2026-11-03, films/frame-budget)

**Sentence:** each frame draws the world once where it is seen and once,
small, as the glass's frost, and Hyprland only composites.

Sean, 12:25: hold 120 Hz at the GPU's 750 MHz, about 6 ms a frame at
2880x1800. Measured with Sean at the machine, so at 1440x900 (a quarter of
his pixels; full-size times below are four times these, which assumes the
work is all per pixel) in the hidden desktop, three terminals, GPU timestamps
between Hyprland's render stages (scratch, not shipped). Median ms a frame at
rest, main against this:

| film | backdrop | Hyprland's blur | windows | bar and top | whole frame |
|---|---|---|---|---|---|
| Jarvis | 1.16 / 0.91 | 0.96 / 0 | 0.80 / 0.53 | 1.61 / 0.51 | 4.64 / 1.98 |
| Tron Legacy | 0.83 / 0.64 | 0.97 / 0 | 0.71 / 0.47 | 1.62 / 0.58 | 4.24 / 2.01 |
| Oblivion | 1.18 / 1.11 | 0.96 / 0 | 0.87 / 0.72 | 1.77 / 0.63 | 4.90 / 2.58 |
| The Matrix | 1.14 / 0.92 | 0.96 / 0 | 0.74 / 0.57 | 1.71 / 0.63 | 4.71 / 2.20 |
| Evangelion | 1.24 / 1.16 | 0.96 / 0 | 0.83 / 0.68 | 1.61 / 0.28 | 4.76 / 2.59 |
| Roadster | 1.09 / 1.01 | 0.96 / 0 | 0.77 / 0.60 | 1.71 / 0.72 | 4.64 / 2.40 |

So at full size about 17 to 20 ms before (Sean measured 53 fps on Tron) and
8 to 10 ms now. What it takes: Hyprland blurred the whole screen every frame
the world moved, and blurred the bar again on its own: the bar's layer
covers the whole screen. Now the backdrop draws the world at half size over
the screen and blits its mipmap's level as soft as the film's frost into
Hyprland's blur framebuffer, so Hyprland queues no blur; the bar reads the
same frost (its layer rule's xray); inside a window that shows the world
through the frost the full-size world is not drawn, since Hyprland's glass
composites over all of it. Deleted: the veil (`behind_glass`), its two
passes and its frost conditions. Blur off altogether came to 1.34 ms for Tron.

After any config reload (a theme switch is one) Hyprland's blur in the same
session cost about three times as much (Tron 4.24 to 11.0 ms, blur settings
unchanged); with this the blur is not Hyprland's, so that does not apply.

## Frame budget 2 (2026-11-03, films/budget)

**Sentence:** what a frosted window covers is never drawn, said through
Hyprland's own occlusion, and a frame reads the world already drawn.

Measured with every monitor asleep, so at Sean's 2880x1800 at 1.25, in the
hidden desktop with three terminals, GPU at 754 to 760 MHz, the GPU shared
with Sean's other clients (about 30% busy) and a load of 55 to 100. Medians
of the moving part (windows swapping round), ms a frame; the parts repeat to
0.01 ms run to run, the whole frame's clean floor (10th percentile) is within
0.05 of these. f6111be against this branch:

| film | world half / frost / full | windows | frames | top layers | whole frame |
|---|---|---|---|---|---|
| Jarvis | 1.43 0.74 2.04 / 1.43 0.74 1.28 | 0.99 / 0.98 | 0.65 / 0.15 | 1.45 / 0.66 | 7.42 / 5.28 |
| Tron Legacy | 0.78 0.74 1.47 / 0.78 0.74 0.72 | 0.99 / 0.98 | 0.45 / 0.15 | 1.45 / 0.66 | 6.01 / 4.05 |
| Oblivion | 1.31 0.71 2.15 / 1.31 0.70 1.44 | 1.04 / 1.03 | 0.79 / 0.15 | 1.46 / 0.67 | 7.60 / 5.33 |
| The Matrix | 1.10 0.63 1.82 / 1.10 0.62 1.08 | 0.99 / 0.97 | 0.52 / 0.18 | 1.43 / 0.65 | 6.62 / 4.63 |
| Evangelion | 1.60 0.74 2.13 / 1.60 0.76 1.37 | 0.99 / 1.01 | 0.75 / 0.23 | 1.45 / 0.66 | 7.79 / 5.66 |
| Roadster | not run / 1.30 0.72 1.04 | / 0.94 | / 0.14 | / 0.66 | / 4.81 |

So every film fits the 6 ms a frame of 120 Hz at this clock, with 0.3 to
2 ms to spare. At rest the same, but the top layers stepped between 0.66,
0.91 and 1.07 ms as the shell's layers changed (a notification shown at
start, most likely), which puts Evangelion at 6.11 while a notification is up.

What it took:
- **The glass is opaque, and says so.** In a film session a frosted window's
  pixels all come out opaque (frosted()), so each adds, in its own pass under
  its surface, an element whose opaque region is its glass. Hyprland then
  leaves out of the damage of everything drawn before it what the glass
  covers, the backdrop, the window's shadow and the windows beneath, as it
  does for any opaque surface, and still draws there wherever a live blur
  will read it. Deleted: the plugin's own inside region, its blit of the
  half-size world under the glass (0.8 ms) and the `veiled` flag. This also
  settles the open point of f6111be: under a live blur the world is the
  full-size one.
- **A frame reads the world drawn this frame** (contract 5, `worldAt()`), the
  half-size world, instead of drawing `backdrop()` again at its bent point:
  0.45 to 0.79 ms down to 0.15 to 0.23. In Jarvis, Oblivion, Evangelion and
  Roadster the rims cannot be told apart at 2x (preview: 3 to 61 thousand
  rim pixels at 2 levels or more of 5.2 million, the worst 56 to 87); in
  Tron and the Matrix, whose
  lines and glyphs are finer than a half-size pixel, a line crossing a rim
  turns from a sharp bent glint to a soft dot (taste sheet 5).
- **The notifications read the backdrop's frost.** Omarchy's glassy mode
  blurs the `omarchy-notifications` layer, which stays mapped, empty, down
  the right edge (426x1440). Without xray Hyprland blurred under it live
  every frame and drew the full-size world under it again: 0.8 ms. film.lua
  gives it xray, as the bar has; a notification over a window shows the
  world's frost through its card, not the window's (taste sheet 6).

Measured and not kept: a glass-step discard of the bar's empty pixels (the
bar's 0.66 ms is its full-screen surface; without blur at all it was the
same), shrinking Hyprland's blur texture to the frost's size (UVs come from
the texture's size; it would misplace the frost of motion-blurred windows).

Window answers are now the largest part left: without them Jarvis's
half-size world was 0.92 ms against 1.44 and its full-size 0.74 against
1.28. Drawn once into a texture while the windows hold still, they would
take about 1 ms off at rest, nothing while windows move (polish.md, item 8).

After a config reload (a theme switch is one) a film session costs the same
(Tron 4.07 ms before `hyprctl reload`, 4.02 after): Hyprland's own blur, which
grew about three times dearer after a reload, no longer runs in one.

## Cost follows change (2026-11-04, films/batch-4, contract 6)

**Sentence:** the world is drawn only where and as often as it changes on
its own, at a pace each film states.

Coordinator's direction (Sean: "insanely light weight and use next to
nothing"): what does not change is drawn once and kept; ambient motion is
small moving parts or slow changes, damaging only their own pixels.

What the films' ambient motion is, measured off screen (scratch/batch4/
change.py: each film at t and t + 1/120 s, workspace 1): the pixels that
change in a frame are few, Tron 9.1%, Jarvis 10.7%, Oblivion 0.1%,
Evangelion 3.5%, the Matrix 3.0% with the agents' rain, Roadster 2.5%, but
in five films they are spread over the screen: Tron's and Roadster's floors
glide toward the viewer over the lower screen, Jarvis's rings and globe and
Evangelion's octagonal rings sweep large areas, and the Matrix's rain falls
everywhere. Only Oblivion, and the Matrix with no agent running, are small
parts and slow drifts. So the direction holds for the mechanism, and for
most films "next to nothing" at rest needs their rest motion to change
(taste sheet 7).

Shape:
- **pace().** Each film says how often its world changes at a point, in
  frames a second (contract.glsl: `pace`, `moving`, `changing`, `passing`).
  The plugin reads it a 32 px tile at a time after every frame shown (a
  small draw read back while the GPU is idle) and damages the tiles whose
  turn has come, grown by how far the frost and the frames carry a change.
  A tile's rate is its pace rounded up to 60 halved a whole number of
  times, on shared slots of the clock: Hyprland draws each frame's damage
  again in the next two (its three buffers rotate) and merges scattered
  damage into one box, so turns spread over every frame drew the screen
  every frame. With no tile due, nothing asks for a frame; the pace is read
  again within PACE_AHEAD (0.1 s).
- **Kept.** The world at half size, which the frost and the frames read,
  is kept per monitor and drawn again only where the world changed, and so
  is each level of its mipmap and the frost made from it; the frost's
  copies are drawn, not blitted (a blit cost 0.31 ms against 0.24). The
  full-size world is drawn over Hyprland's damage as before. Kept too, and
  copied over that damage, it cost more than it saved (Jarvis at rest 134
  against 112 ms/s, moving 1.96 against 1.82 ms a frame): Hyprland's damage
  is the last three frames' merged into few boxes, so most of it must be
  drawn anyway.
- **Whole while things move.** A scene or answer change draws the whole
  world in that frame, and the frame after it too, since easing goes on
  after a change; while an answer is alive (3 s) every frame is whole.
  A world holding still everywhere asks for no frame and reads no pace
  until something changes (the agents' text coming or going included).
  The rates are the cap halved (60 with none), so a cap is never passed.
- **tools/pace-check** samples each film's pace against its world: at
  sampled times each tile, drawn only at its pace, is compared with the
  world at the end of its wait (and every PACE_AHEAD for slow tiles), within
  half a pixel of motion or two levels. It samples; a change that came and
  went inside one wait, the plugin's rounding of rates and caps, are not
  checked (rounding only shortens the wait, caps lengthen it on purpose).
  All six pass it at full size (a random time and nine of the films' cycle
  wraps). It set what the estimates had wrong: thin lines and dots need a
  quarter pixel a step, so Tron's and Roadster's floors, whose lines and
  dots are everywhere below the horizon, are every frame; a ring born or a
  sweep jumping back as its cycle comes round needs every frame then
  (`wrapping()`).

Deleted: typing and speech-start impulses (no film answered them, and now
each keystroke would have drawn the whole world for 3 s), the key listener,
`asked`, the per-monitor rate timer arithmetic.

Found on the way: Tron's floor brightness jumped every 16 s (its fade read
the gliding floor, so it dropped 12% as the glide came round: 17% of pixels
changed at the wrap against 5% a frame); its fade now follows depth on the
screen alone, at the old mean.

Measured at 1440x900 in the hidden desktop (Sean at the machine all
night), its 60 Hz, three terminals, 8 s at rest after the windows' answers
end, then the focused window swapping round; 5ecdd5c against 4e8619d,
interleaved (scratch/batch4/runs/r6). GPU busy is the frames' GPU time
summed over a second; frames presented at rest were 45 to 54 a second in
every film both ways, since each always has a part running every frame.

| film | rest, GPU ms/s | whole frame at rest, ms | whole frame moving, ms |
|---|---|---|---|
| stock (Tokyo Night) | 4 / 9 | | |
| Jarvis | 147 / 123 | 1.81 / 1.83 | 1.82 / 1.82 |
| Tron Legacy | 159 / 99 | 1.51 / 1.46 | 1.56 / 1.46 |
| Oblivion | 163 / 110 | 1.85 / 1.59 | 1.85 / 1.61 |
| The Matrix (agents writing) | 164 / 113 | 1.61 / 1.57 | 1.60 / 1.57 |
| Evangelion | 194 / 125 | 1.89 / 1.87 | 1.89 / 1.88 |
| Roadster | 161 / 109 | 1.70 / 1.60 | 1.69 / 1.60 |

Not reached: next to nothing at rest (the films' own motion, taste sheet
7), and 3 ms a frame at 2880x1800 while windows move (still Frame budget
2's 4.05 to 5.66 ms there: at this size moving frames are no dearer than
before, Tron and Oblivion a little cheaper, and every pixel is drawn while
windows move).
Not yet measured: full size, 120 Hz and power, which need Sean away.

## Still at rest (2026-11-04, films/still-at-rest, contract 7)

**Sentence:** the world's own motion runs on the desktop's clock, so a still
desktop draws nothing.

Taste sheet 7, decided by the coordinator on Sean's words ("as lightweight as
it can possibly be while still looking as good as it can"): at rest the big
ambient motion holds still, and it moves while windows move and settles
smoothly to still after them. Batch 4 found its question had no cheap answer:
five films change all over the screen every frame, so a pace per tile drew
most of it anyway (45 to 54 frames a second at rest in every film).

Shape: `time` (contract.glsl) runs at a speed that eases toward 1 over
0.15 s while the scene (the windows, the focus, the panels' room) changed in
the last 0.05 s on some monitor, and toward 0 over 0.5 s after; below 0.005
it stops, about 2.6 s after the last change, inside the 3 s an answer to that
change lives anyway. Time is the exact integral of the speed, so it never
jumps, whatever the frames between. Each frame reads it at render.pre with
the scene and the answers (SAnswer), and any change of them draws the world
whole, glass and frost included; a frame shown asks for the next while the
world changed or the clock runs. Otherwise the half-size world and the frost
are kept, a client's damage gets the full-size world drawn as it was, and
nothing asks for a frame. The agents' text joins the world only when it is
drawn whole, so a part drawn again at rest never shows newer text than the
kept world round it.

Deleted: pace() and its helpers (moving, changing, passing, wrapping,
EVERY_FRAME, PACE_REACH, PACE_AHEAD) in the contract and each film's pace;
main-pace.glsl; the tiles, their readback and slots, the due timer, the
world's changed region and the frost's partial levels (its mipmap is
generated whole, 0.21 against 0.24 ms at 1440x900); tools/pace-check; the
`fps` and `battery_fps` caps and the power check, which only capped the
world's motion at rest. Films draw exactly as at a90a212 for the same time
(previews at 7.5 s identical, pixel for pixel).

Found on the way: the pass-trace scenes of batches 3 and 4 swapped the focused
window right while it was already rightmost, so their "moving" frames moved
no window (Hyprland: "No window to swap with in that direction"); those
numbers are the world's own motion with the windows still. The scene now
swaps left and back.

Measured at 1440x900 in the hidden desktop (Sean at the machine), its 60 Hz,
three terminals, GPU at 754 to 760 MHz: 6 s at rest once the clock has
stopped (8 s after the windows open), then the focused window swapping left
and back for 3 s; a90a212 against this, interleaved (scratch/batch5/runs/q2).
Frames presented a second and GPU busy ms a second at rest, whole frame ms
moving (median):

| | rest, frames/s | rest, GPU ms/s | moving, ms a frame |
|---|---|---|---|
| stock (Tokyo Night), no plugin | 2.0 | | |
| stock, plugin idle | 1.0 | 0.6 | 2.62 |
| Jarvis | 43.4 / 1.1 | 91.4 / 0.4 | 2.43 / 2.38 |
| Tron Legacy | 45.7 / 1.4 | 82.7 / 0.7 | 1.89 / 1.84 |
| Oblivion | 43.8 / 1.0 | 90.5 / 0.3 | 2.19 / 2.15 |
| The Matrix (agents writing) | 45.2 / 1.0 | 88.5 / 0.2 | 1.90 / 1.92 |
| Evangelion | 50.2 / 1.0 | 114.0 / 0.2 | 2.32 / 2.28 |
| Roadster | 43.9 / 1.3 | 97.2 / 1.7 | shared, see below |

At rest every film now presents what a stock theme does (btop's own redraw
every 2 s, the cursor's blink) and the backdrop draws only what those
clients damage. Moving costs what it did, a little less (the frost's whole
mipmap). A stock theme's moving frame costs more than any film's here: its
bar is a live blur (1.82 ms), where a film's reads the backdrop's frost.
From 10:24 the GPU was shared with Sean's session (Hyprland's window pass
took 2.4 to 2.7 ms in every film, 0.38 before), so Roadster's runs, which
came after it, say nothing about its moving frame. Full size, 120 Hz and
power need Sean away.

