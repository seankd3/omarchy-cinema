# Smoothness and cost of the backdrop

**Sentence:** the backdrop moves once per frame the display shows, by that
frame's own time, and each frame draws only what its look needs, so motion is
smooth at the display's rate and a still desktop costs nothing.

The aim is a backdrop as light as it can be while it looks as good as it
can, even on a very slow GPU. The design point is a GPU at about 754 MHz
(this laptop's N1X under load), with weak iGPUs and laptops as the audience: one
default that is cheap everywhere, no quality tiers, no adaptive knobs. A
target is a ceiling; a film that meets one keeps climbing while its look
holds.

## Frames ask for frames

The cause (2026-11-02): time came from a free-running 8 ms timer against
8.33 ms frames, so most frames moved 4% too little and one in 25 moved two
ticks: a hitch 5 times a second at 120 Hz.

Each frame a monitor shows (Hyprland's `presented`) asks for its next while
the world moves there. Only frames the plugin asked for move time, by the
clock at their render.pre. Every event that may start or stop it (a theme
read or config change, a lock, a window going fullscreen, a monitor coming,
going, sleeping or waking) settles it from one idle callback once Hyprland
has finished the change; that callback also applies the glass.

Deleted: the free-running timer and its rate arithmetic, the 0.1 s clamp,
the tick's own copy of "time stands still", the glass's own idle callback.

Measured with `tools/smoothness` (hidden desktop, frameclock's fixed 60 Hz
vblank, frametrace logging each draw's `time`; judder is the RMS of each step
minus one frame, jumps the steps over 1.5 frames), fit against the hidden
desktop's CPU wait at a session's 11 ms/s: main 3.4 ms judder and 3.3% jumps,
this 2.9 ms and 1.0%. The rest is CPU starvation of the nice 19 sandbox.

## Frame budget

**Sentence:** each frame draws the world once where it is seen and once,
small, as the glass's frost; what a frosted window covers is never drawn;
Hyprland only composites.

- **The plugin makes the frost.** The backdrop draws the world at half size
  and puts its mipmap's level as soft as the film's `frost` in Hyprland's
  blur framebuffer, so Hyprland queues no blur. The bar and the
  notifications read the same frost (film.lua's xray rule): their layers
  cover the screen or stay mapped empty down its edge, and a live blur under
  them cost 0.8 ms every frame. A notification over a window shows the
  world's frost through its card.
- **The glass is opaque, and says so.** In a film session a frosted window's
  pixels all come out opaque (frosted() in main.cpp), so each adds, under its
  surface, an element whose opaque region is its glass. Hyprland's own
  occlusion then leaves the backdrop, the window's shadow and the windows
  beneath out of the damage there, and still draws wherever a live blur
  reads it.
- **A frame reads the world drawn this frame** (`worldAt()`), the half-size
  world, instead of drawing `backdrop()` again: 0.45 to 0.79 ms down to 0.15
  to 0.23. In Tron and the Matrix a line crossing a rim turns from a sharp
  glint to a soft dot.
- **The windows are a uniform block** (contract 9), constants to a pixel,
  not a texture it fetches: 1 to 8% of a draw.
- **A wake or a shadow pays only where it reaches.** A moving window's ghosts
  are drawn only outside it and within a reach of where it was; past that
  their light, bounded from the film's falloff and tone map, moves no point a
  twentieth of a display level (a hundredth in Tron) per moving window, as
  each film's comment shows. windowShadow is exactly 0 from 2 px inside the
  window and past its softness: 6 to 22% off a drag.

At 2880x1800, GPU at 754 MHz, windows moving (2026-11-03), ms
a frame: half-size world 0.78 (Tron) to 1.60 (Evangelion), frost 0.62 to
0.76, full-size world 0.72 to 1.44, windows 0.94 to 1.03, frames 0.14 to
0.23, top layers 0.65; whole frame 4.05 (Tron) to 5.66 (Evangelion).
Hyprland's passes and the frost are about 2.4 ms of it.

Measured and not kept: the world at half size under Tron's and the Matrix's
glass (their lines and glyphs are finer than a half-size pixel: up to 15
levels); Oblivion skipping its clouds under the glass (3 levels at the
panes' edges); keeping the full-size world and copying it over Hyprland's
damage (dearer: Jarvis 134 against 112 GPU ms a second at rest, since
Hyprland redraws its last two frames' damage merged into few boxes); a
scissored glBlitFramebuffer (costs a full one here, 0.6 ms at 1440x900:
draw a quad); shrinking Hyprland's blur texture; a quarter-size kept world
(frost off by up to 107 levels); keeping the nearest, focused and over
windows in see() (slower: registers); Evangelion's honeycomb answer met once
per cell (a pass and a texture for one film, and the cell's answer
is not constant over a cell, since the held honeycomb shifts per pixel; up
to 209 levels on a drag).

## Still at rest

**Sentence:** the world's own motion runs on the desktop's clock, so a still
desktop draws nothing.

`time` (contract.glsl) runs at a speed that eases toward 1 over 0.15 s while
the scene (the windows, the focus, the panels' room) changed in the last
0.05 s on some monitor, and toward 0 over 0.5 s after; below 0.005 it stops,
about 2.6 s after the last change, inside the 3 s an answer lives anyway. The
rise ends at a fixed time after the last stir, so a late frame never jumps
it. Any change of the scene or the answers draws the world whole, glass and
frost included; otherwise the half-size world and the frost are kept, a
client's damage gets the full-size world as it was, and nothing asks for a
frame. The agents' text joins the world only when it is drawn whole. Time
stands still with animations off, the session locked, or every monitor
asleep or fullscreen.

It replaced a pace per 32 px tile (contract 6): five films change all over
the screen every frame, so tiles drew most of it anyway (45 to 54 frames a
second at rest). At 1440x900 at rest, frames a second and GPU ms a second,
tiles against this: Jarvis 43.4 and 91.4 against 1.1 and 0.4, Evangelion
50.2 and 114.0 against 1.0 and 0.2, the rest alike; a stock theme with the
plugin idle 1.0 and 0.6, with no plugin 2.0 frames.

## Measuring

- A bench takes frames from the session on the same GPU, and GPU priority
  does not protect it, so benches yield to the person at the screen: every
  tool that draws on the GPU runs in `tools/yield`, which gives a run 15 s
  and 1440x900 at most while someone is there, and a gap as long after it.
  What does not fit waits in its queue for the session locked or every
  monitor asleep, and ends the moment someone is back.
- The GPU clock is not fixed (754 MHz most runs, 2340 seen once while
  another client kept it busy): record it per run and compare only runs at
  one clock.
- A GPU shared with a running session inflates Hyprland's window pass from 0.38
  to 2.5 ms in every film; check the other films' runs before chasing one
  film's outlier. Offscreen ablations (tools/preview.py's storyboard, least
  contended of 15 rounds) hold to about 2% even then.
- Hyprland redraws each frame's damage in the next two and merges more than
  8 scattered rects into one box.
- Each trace build gets its own directory; a rebuilt plugin under a running
  queue changes its runs.
