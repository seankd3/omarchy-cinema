# Windows with depth, in a world that answers

**Sentence:** each film's windows are lit, shadowed and edged as glass
inside that film's world, and the world answers what happens on the desktop.

The aim is windows that feel like they have depth and belong to the film's
world, without distracting from work (SPEC.md, "Calm"). Standing rules from
SPEC.md stay: same frame as the windows, cheap at rest, no HUD, no
full-screen post shader, text opaque, and **text flat and sharp whenever
nothing moves**.

## Shape

The problem has two halves, and each gets one home.

**What happened on the desktop** is facts the plugin reads each frame at
`render.pre`, from Hyprland's own state. They reach every film through the
contract (`plugin/contract.glsl`), so a film never measures anything itself.

**How a film answers** is GLSL in the film's `backdrop.frag`: `backdrop(px)`
for the world and an optional `frame(px, i)` for each window's edge. A film
is one file of shader plus data.

### 1. Facts

Each is one fact with one source; nothing is stored that can be computed.

- **Window motion and lift.** Per window: velocity in logical px/s (from the
  drawn position this frame against the last, eased over 80 ms so one late
  frame does not spike it), `lift` (eased to 1 for the focused window, 0 for
  the rest) and `depth` (its place in Hyprland's stacking order, 0 on top).
  Shadows, rims and wakes read these.
- **Impulses.** One ring of the last 32 things that happened, each a point,
  an age in seconds, a strength and a kind: `OPEN`, `CLOSE`, `LAND`,
  `FOCUS`. Every film reads the same ring and answers each kind its own way
  (Tron's grid ripples, Evangelion's AT field flares, the Matrix's rain
  splashes). Typing has no kind: an answer draws the whole world every frame
  while it lives, and the desktop stays calm while you work.
  - *Time.* The plugin stamps each impulse on the monotonic clock and uploads
    its age, so the shader never subtracts on the hourly-wrapping `time`. An
    impulse lives 3 s and is then gone. What happens while time stands still
    (animations off, locked, every monitor asleep or fullscreen) is not
    collected and never replays.
  - *Sources.* `OPEN`, `CLOSE`, `FOCUS` from Hyprland's window events. `LAND`
    when a window's drawn position was changing last frame and is not this
    frame, so a tiling animation, a drag and a keyboard move all land the
    same way.
- **Voice.** `voice`: Voxtype's speech loudness, 0 to 1, through the feed
  service (feed/cinema-feed.py): while Voxtype records it runs
  `voxtype-audio-bridge` and sends the latest `rms` at most 60 times a
  second, each change of speaking at once, and silence when recording stops
  or the bridge goes. Amplitude and activity only; the bridge carries no
  audio or transcript, and nothing is stored or logged. The screen does show
  that speech is happening, and how loud, to anyone who sees it, live or in
  a recording; `plugin:backdrop:depth 0` turns every answer off.
- **Light** is not plugin data: each film defines its light (direction,
  colour) as constants in its own `backdrop.frag`, used by `backdrop()` for
  shadows and by `frame()` for rims, so the two always agree.

A helper enters the contract once two films answer a fact the same way:
`windowShadow`, `closingFront`, `openingFront`, `focusWarmth` and
`impulseDistance`.

### 2. Frame and thickness

A plugin window decoration (`HyprlandAPI::addWindowDecoration`, on the OVER
layer, which Hyprland draws inside the window's own pass) draws the film's
`frame(px, i)` in a band outside the window's edge and at most 2 px inside
it: a rim lit from the film's light, a bevel, the film's own edge. Drawn in
the window's pass, it fades with the window; fullscreen windows have no
decorations and so no frame.

The glass's thickness is the frame band too: `frame()` reads the world bent
through the glass's edge at a coordinate pushed along the edge normal, plus
a specular line from the light. It reads the world as the backdrop drew it
this frame, at half size (`worldAt()`).

### 3. Damage

- **The windows changed** (geometry, fade, lift): damage the monitor and the
  glass in this frame.
- **Only the world's answer changed** (an impulse alive, voice): damage the
  monitor in this frame, and leave the glass to the next frame the world
  moves in.

At rest the plugin draws nothing (specs/smoothness.md, "Still at rest").

### Tiers

`plugin:backdrop:depth`: `0` is the backdrop alone, with no answers, no
frames and no facts moving; above 0 (default `2`) the films answer and frame
their windows.

## Not built

Each was planned and is not in this release:
- **Window light**: a window's average colour lighting the world around it,
  measured on the GPU from its surface tree.
- **Glass through motion**: glass decided per surface in Hyprland's
  transformed-window path too, so a tilted or wobbling window keeps it.
- **Tilt and wobble**: a window transformer that turns a moving window a few
  degrees by its velocity and springs it flat, and Hyprland's own wobble and
  motion blur per film.
- **Workspaces as 3D panels**: a switch drawn from Hyprland's scene renderer,
  each workspace a panel on the film's path (Tron flies down the grid,
  Jarvis turns a carousel).
- **A space tier**: windows standing at depths by `depth` at rest.

## Non-goals

HUD widgets and readouts; a full-screen post-process shader; tilting or
projecting windows at rest; reading which key was pressed or what was said;
changing apps.
