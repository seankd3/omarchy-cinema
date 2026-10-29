# Windows with depth, in a world that answers

**Sentence:** each film's windows are lit, shadowed and moved as physical
glass inside that film's world, and the world answers what happens on the
desktop.

Sean, 2026-10-29: "can we make the window effects more 3d and intereactive
with the envioment? like I really wanna go super hard with this, its 2026
computer UIs should be mind blowing"; "how can we make the programs feel like
they have depth?"; "could we make the workspace changes live as 3d items?";
"lets try lots of stuff". Asked how far windows go in 3D (glass only,
physical glass that tilts with momentum, a full 3D desktop): "lets try all".
Asked what the world reacts to: window motion, the pointer, typing and voice.

Standing rules from SPEC.md stay: same frame as the windows, cheap at rest,
no HUD, no full-screen post shader, text opaque. New one, implied by the
above: **text is flat and sharp whenever nothing moves**, in every tier but
the full 3D one, which Sean asked to try knowing it is not.

## Shape

The problem has two halves, and each gets one home.

**What happened on the desktop** is facts the plugin already reads each frame
at `render.pre`, from Hyprland's own state, plus the ones it adds below. They
reach every film through the contract (`plugin/contract.glsl`), so a film
never measures anything itself.

**How a film answers** is GLSL in the film's `backdrop.frag`: `backdrop(px)`
for the world (exists today), and a new optional `frame(px, i)` for each
window's edge. A film is still one file of shader plus data.

### 1. Facts (contract v2)

Each is one fact with one source; nothing is stored that can be computed.

- **Window motion and lift.** A third texel per window: velocity in logical
  px/s (from the drawn position this frame against the last, over the frame
  time, eased over 80 ms so one late frame does not spike it), `lift`
  (eased to 1 for the focused window, 0 for the rest, over FOCUS_EASE) and
  `z` (its place in Hyprland's stacking order, 0 on top). Shadows, rims,
  wakes and tilt all read these.
- **Pointer.** `pointer`: position and velocity in logical px, read at
  `render.pre` from Hyprland's pointer. It does not ask for frames: the
  backdrop's own tick (display rate plugged in, 30 on battery) carries pointer
  effects, so moving the mouse costs what idle costs today.
- **Impulses.** One ring of the last 32 things that happened, each a point,
  a start time on the backdrop clock, a strength and a kind: `OPEN`, `CLOSE`,
  `LAND` (a window's position animation ended, or a drag of it ended),
  `FOCUS`, `KEY` (a key was pressed in the focused window: at a point along
  its lower edge; never which key), `VOICE` (Voxtype's voice activity turned
  on). Every film reads the same ring and answers each kind its own way
  (Tron's grid ripples, Evangelion's AT field flares, the Matrix's rain
  splashes). An impulse arms the backdrop timer until it has run out (3 s);
  with none alive the plugin idles exactly as today. This one ring replaces a
  uniform per event.
- **Voice.** `voice`: Voxtype's speech loudness, 0 to 1. The feed service
  already carries outside input to the plugin over its socket; it gains this
  field (version `CFD2`) from `voxtype-audio-bridge`'s `rms` frames (run
  while Voxtype records, read from its daemon's `audio.sock`), and the
  feed's voice-activity edges become `VOICE` impulses.
- **Switch.** `switchProgress` (0 to 1 while a workspace switch plays, -1
  otherwise) and `switchDirection`, so the world moves with the camera
  during a 3D switch (part 5).
- **Light** is not plugin data: each film defines its light (direction,
  colour) as constants in its own `backdrop.frag`, used by `backdrop()` for
  shadows and by `frame()` for rims, so the two always agree.

Helpers in the contract, so films compose instead of copying: `windowShadow`
(the soft shadow window i casts on the scene, away from the light, longer and
softer with lift), `impulseWave` (a ring expanding from an impulse at a
speed, fading with age), `parallax` (a point's offset for a scene depth, from
the pointer and the switch camera).

### 2. Frame: each window's edge belongs to the film

A plugin window decoration (`HyprlandAPI::addWindowDecoration`) on every
window draws the film's `frame(px, i)` in a band around the window and a few
pixels inside its edge: a rim lit from the film's light, a bevel, the
film's own edge (IRIX grey bevels for Jurassic Park). Hyprland draws
decorations inside the window's own pass, so the edge tilts, wobbles and
fades with the window. Films that define `frame()` turn off Hyprland's border
and shadow in `film.lua`; films that do not keep them.

### 3. Thickness

The glass bends what is behind it at its edges: inside a band along the
window's edge, the glass step in the window shader (already ours, see SPEC.md
"Glass") samples the blurred backdrop offset along the edge normal, by a
refraction profile, and adds a specular line from the film's light. Content
is untouched; only background pixels that are already glass are bent.

### 4. Motion with mass

- **Wobble and motion blur** are Hyprland 0.57's own (`decoration:wobble:*`,
  `decoration:motion_blur:*`): `film.lua` sets them per film (Evangelion may
  wobble, Roadster stays rigid). No code of ours.
- **Tilt**: a plugin window transformer (`Render::IWindowTransformer`,
  attached per window through its transformer list) turns a moving window
  about its centre by its velocity, in perspective, at most about 12
  degrees, and springs it flat when it stops. At rest it is inactive, so the
  window is drawn directly, as today: no extra buffer, text exactly flat.
- **Opening and closing** keep Hyprland's own animation styles, with the
  `OPEN` and `CLOSE` impulses as the world's answer.

### 5. Workspaces as 3D panels

Omarchy turns Hyprland's workspace animation off, so a switch is instant.
When the active workspace changes, the plugin renders the workspace left and
the one arriving into two buffers (Hyprland 0.57 renders any workspace on its
own for screen capture: `renderWorkspace(ctx, workspace, now,
WORKSPACE_WINDOWS)`), then for the switch's length (about 450 ms) draws over
the windows, below the bar: the backdrop as the camera moves, the two panels
moving along the film's path, ending with the new panel exactly where its
windows are, at which point it stops drawing and the real windows show. Each
film names its path in `film.lua` (`switch = "fly" | "carousel" | "drop" |
"dissolve" | "platform"`): Tron flies down the grid to the next sector, Jarvis
turns a holo carousel, Oblivion drops through cloud, the Matrix dissolves into
rain, Jurassic Park flies to the next fsn platform. A switch during a swipe
gesture, with animations off or while the session is locked plays no 3D.

### 6. Tiers, to try all three

`plugin:backdrop:depth`: `0` today's look; `1` glass (parts 1 to 3 and the
world's answers); `2` physical (adds part 4 and part 5); `3` space (adds a
standing perspective: windows sit at depths by `z` and lean with the pointer
through the same transformer, so text is never quite flat). Default `2`. A
key binding cycles it, so Sean can compare them on his own desktop.

## What it deletes

- `film.lua`'s border gradient and shadow glow, for every film that defines
  `frame()` (the edge is the film's).
- Each film's own focus-follow code for its focus decoration (the eased
  `focused` rect stays for decorations around the window; height, rim and
  shadow move onto `lift`, per window, which also deletes the single-window
  limit of `focusAlpha`-driven effects).
- No other mechanism is replaced; parts 4 and 5 compose Hyprland's
  transformer list, wobble, motion blur and workspace rendering instead of
  building them.

## Non-goals

HUD widgets and readouts; a full-screen post-process shader; tilting or
projecting windows at rest (tiers 1 and 2); reading which key was pressed or
what was said (only that a key was pressed, and how loud); changing apps.

## Order (each its own PR, under the review gate)

1. Contract v2 facts and helpers, and every film answering them: shadows,
   lift, wakes, impulse answers, pointer light, voice.
2. Frame decoration.
3. Thickness.
4. Tilt, and each film's wobble and motion blur.
5. Workspaces as 3D panels.
6. The space tier and the binding.

Jurassic Park (another lane) adopts each part as it lands.

## To verify before building (against Hyprland v0.57.0, scratch/ref/hyprland-057)

- `input.keyboard.key` carries no key identity the plugin keeps, and fires
  for the focused window's keys; what fires for a drag ending and a position
  animation ending.
- Decorations from `addWindowDecoration` are drawn inside the transformed
  window pass, and can run a plugin shader with the film's program.
- A plugin can attach an `IWindowTransformer` to a window and remove it
  safely at unload (the plugin is never unloaded live, but Hyprland unloads
  at exit).
- `renderWorkspace(..., WORKSPACE_WINDOWS)` into plugin buffers from a render
  stage, for a workspace not shown, and what glass looks like there.
- Whether the window shader's blur variant knows the main surface's size and
  edge (for part 3), and that popups and subsurfaces can be told apart.

## Acceptance

Per part: the hidden-desktop harness (the previews lane) renders each film at
rest, with a window dragged, landing, typed into, spoken over, and a
workspace switch mid-way, and those frames are read for legibility; idle power
at rest unchanged within noise against today's build (interleaved, on
workspace 1); both review passes PASS on the exact commit; Sean's eye on his
own desktop at the next login.
