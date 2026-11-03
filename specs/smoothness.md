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

Each frame a monitor shows (Hyprland's `presented`) asks for the next while
the world moves there: at once, or, with a capped rate (`fps`,
`battery_fps`), from a one-shot timer once the last moved frame started an
interval ago. Only frames the plugin asked for move time on, by the clock at
their render.pre, which on hardware is just after the vblank before the one
they are shown at. While the world stands still (animations off, locked,
asleep, fullscreen) nothing asks, so the no-animations toggle stops all
waking. Any frame shown restarts it; a theme read or config reload wakes it.

Deleted: the free-running timer and its rate arithmetic (fastest monitor, ms
rounding), and the tick's own copy of "time stands still" (`answering` and
the clock now share `moves`).

## Measurement

`tools/smoothness [--rounds N] [--theme SLUG] [--size WxH] CHECKOUT...`:
a film (Tron Legacy) with two glass terminals in the hidden desktop. frameclock
shows frames on a fixed 60 Hz vblank (Hyprland's Wayland backend reports 60 Hz
whatever the mode; 16 against 16.67 ms is the same 4% beat as 8 against 8.33).
frameclock logs each commit, and tools/frametrace.c, preloaded into the hidden
Hyprland, logs the `time` each backdrop draw uses. Per vblank, the time on
screen should step by exactly one frame: **judder** is the RMS of each step
minus 16.67 ms, **held** and **jumps** the vblanks that did not move or moved
over 1.5 frames. GPU comes after, in its own 6 s: sampling nvidia-smi pmon
during the motion window raised judder from 2.0 and 2.7 ms to 3.7 and 4.2.

The hidden desktop runs at nice 19 under the floor CI (load 25 to 77), and
waits 50 to 360 ms a second for a CPU, against about 11 for Sean's Hyprland
(schedstat, 2026-11-02): starved frames are this measurement's noise floor.
At Sean's 2880x1800 the hidden Hyprland took 83 to 92% of the GPU (14 to
15 ms a frame) beside his session after the 0.57.0-4 update, so every arm
missed frames for GPU alone; the timing rounds run at 1440x900 (4.5 ms).

## Log

2026-11-02, Hyprland 0.57.0-4, judder / held / jumps per round, interleaved.

1. Baseline, main, 1440x900: 14.9 / 16.9 / 6.1, 6.1 / 4.0 / 4.3,
   5.9 / 3.8 / 3.7; then 5.9 / 3.3 / 3.1, 5.4 / 4.0 / 4.3, 6.0 / 2.9 / 2.8.
   Speed 0.96 to 1.00. GPU 4.1 to 4.7 ms a frame.
2. Frames ask for frames, time at the predicted vblank (last presented plus
   whole frames): 7.4 / 7.6 / 5.6, 5.7 / 5.0 / 4.2, 7.7 / 6.9 / 4.7. Lost to
   step 3: under the Wayland backend `presented` is when Hyprland handled the
   frame callback, not a vblank, so the prediction carried its jitter.
   Deleted.
3. Frames ask for frames, time at render.pre: 9.1 / 8.7 / 4.8,
   3.5 / 1.8 / 1.4, 3.5 / 1.8 / 1.5 (against step 1's first three).
   Kept.
4. The capped wait still took a frame off for the predicted vblank, so at
   `fps = 30` every vblank moved (56 frames a second). Fixed; at 30 it renders
   30 a second, time 12.04 s over 12.0 s, cadence like main's.
5. Final, against main: 6.0 / 5.3 / 4.9 (its desktop waited 101 ms/s, main
   85), 3.8 / 2.2 / 1.6, 3.7 / 1.8 / 1.2. GPU 4.4 to 4.6 ms a frame, equal.
   Animations off: both stand still (time 0.000 s, one frame a second from a
   cursor blink).

## Next

GPU per frame is the other cause: one backdrop draw at 2880x1800 costs 4.5 to
9 ms per film (specs/polish.md), against an 8.33 ms frame at 120 Hz, and
Sean's Hyprland runs at about 70% GPU with the clock at 734 of 3003 MHz. A
shared window pass in the contract is the next branch.
