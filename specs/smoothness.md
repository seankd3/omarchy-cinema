# Smoothness and cost of the backdrop

**Sentence:** the backdrop moves once per frame the display shows, by that
frame's own time, and each frame draws only what its look needs, so motion is
smooth at the display's rate at the least cost that keeps the look.

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

Measured with `tools/smoothness` (hidden desktop, frameclock's fixed 60 Hz
vblank, frametrace logging each draw's `time`; judder is the RMS of each step
minus one frame, jumps the steps over 1.5 frames), fit against the hidden
desktop's CPU wait at a session's 11 ms/s: main 3.4 ms judder and 3.3% jumps,
this 2.9 ms and 1.0%. The rest is CPU starvation of the nice 19 sandbox.

## Frame budget

**Sentence:** each frame draws the world once where it is seen and once,
small, as the glass's frost; what a frosted window covers is never drawn;
Hyprland only composites.

- **The plugin makes the frost.** The backdrop draws the world at twice
  the size of the level as soft as the film's `frost` (Tron's grid takes
  the mean over each pixel's width, contract.glsl's `spread`, or it floods
  the frost), and makes that level, at its own size, the one level of Hyprland's blur texture that is read:
  every reader samples it where it reads the screen, so Hyprland queues no
  blur and nothing is copied screen-sized (0.35 to 0.45 ms). The bar and the
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
- **A pixel meets only the windows that reach it.** A film says how far
  its windows reach (`REACH`, contract 11), the plugin marks in the
  windows' block which of them reach each of 32 by 32 tiles, and a film's
  loop reads its tile once and walks only the windows it holds
  (contract.glsl's next(): against testing each window's bit, the world
  passes at full size cost 3 to 7% less at 10 windows and the same within 2%
  at 3, with identical pixels). Moving frame, world passes
  at full size: the same at 3 windows, 5 to 14% less at 6, 15 to 24% less
  at 10 (Tron's runs disagreed: 3.17 ms to 3.50, and to 2.88).
  Evangelion's honeycomb hold lets go 450 px out and a rim fades out
  at its cell's edge, so float noise moves no cell (one ulp had moved
  75,000 pixels up to 86 levels); culled, it is within a level and its
  world passes at rest 3% (3 windows) to 23% (10) cheaper.
- **A wake or a shadow pays only where it reaches.** A moving window's ghosts
  are drawn only outside it and within a reach of where it was; past that
  their light moves no point a twentieth of a display level (a hundredth in
  Tron) per moving window, contract.glsl's glowReach() of its glow. windowShadow is exactly 0 from 2 px inside the
  window and past its softness: 6 to 22% off a drag.

At 2880x1800, 10 windows moving, GPU at about 1000 MHz, ms:
half-size world 1.21 (Tron) to 2.04 (Evangelion), full-size 1.52 to
2.64, frost 0.38 to 0.45, windows 1.15, frames 0.13 to 0.21, top layers
0.36; a frame 4.89 to 6.69, at 754 MHz an estimated 5.95 to 8.14 (by the
clocks, 6.53 to 8.93).

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

## The world keeps moving

**Sentence:** the world's own motion runs on the wall clock wherever it is
seen, so it never stops and starts.

`time` (contract.glsl) runs at the wall clock's speed, read at each frame's
render.pre, on every monitor where the world moves; each frame shown there
asks for the next, and draws the world whole. With animations off, the
session locked, or every monitor asleep or fullscreen, time stands still and
nothing asks: the world is drawn again only when the scene or the answers
change, the half-size world and its frost are kept, and a client's damage
gets the full-size world as it was. When the world is seen again, time goes
on from where it stood. The agents' text joins the world only when it is
drawn whole.

It replaced a clock that ran only while the desktop changed and eased to a
stop 2.6 s after (contract 7 to 15): a window streaming text made the film
move, stop and move again. A film rate below the display's at rest was
weighed and not built: every film moves something at 190 to 1200 logical px
a second (Tron's runner round the focused window the fastest), which at 60
frames on a 120 Hz screen steps 3 to 20 px a shown frame, and a rate below
the display's needs a timer held to its vblanks.

## Measuring

- A bench takes frames from the session on the same GPU, and GPU priority
  does not protect it, so benches yield to the person at the screen: every
  tool that draws on the GPU runs in `tools/yield`, which gives a run 15 s
  and 1440x900 at most while someone is there, and a gap as long after it.
  What does not fit waits in its queue for the session locked or every
  monitor asleep, and ends the moment someone is back.
- The GPU clock is not fixed (754 MHz to 2026-11-04, about 1000 since,
  2340 once under load): record it per run and compare
  only runs at one clock. One build's runs at both, 3 windows: at 754 a
  frame took 1.21 to 1.23 times as long, a pass 1.18 to 1.24, not 1.33.
  The 10-window figures at 754 scale each pass by its mean, untested.
- A GPU shared with a running session inflates Hyprland's window pass from 0.38
  to 2.5 ms in every film; check the other films' runs before chasing one
  film's outlier. Offscreen ablations (tools/preview.py's storyboard, least
  contended of 15 rounds) hold to about 2% even then.
- Hyprland redraws each frame's damage in the next two and merges more than
  8 scattered rects into one box.
- Each trace build gets its own directory; a rebuilt plugin under a running
  queue changes its runs.
