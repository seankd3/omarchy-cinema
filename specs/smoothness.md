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

## Not changed: causes outside this branch

GPU per frame: one backdrop draw at 2880x1800 costs 4.5 to 9 ms per film
(specs/polish.md) against an 8.33 ms frame at 120 Hz, and Sean's Hyprland runs
at about 70% GPU with the clock at 734 of 3003 MHz. A shared window pass in
the contract is the next branch. CPU: Sean's Hyprland waited 0.04 ms a slice
on average, so starvation is not a cause there; the hidden desktop's is its
nice 19.
