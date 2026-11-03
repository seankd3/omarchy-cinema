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
- The clock: during the bench the GPU ran at 734 to 760 of 3003 MHz at 96%
  use, 3.3 W and 39 C, nvidia-smi giving "Reliability" as its clock reason.
  There 64 vec4 multiply-adds a pixel cost 0.66 ms over the 0.35 ms empty
  pass, so the budget is about 110 of them.

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
