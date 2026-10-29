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
  `render.pre` from Hyprland's pointer.
- **Impulses.** One ring of the last 32 things that happened, each a point,
  an age in seconds, a strength and a kind: `OPEN`, `CLOSE`, `LAND`,
  `FOCUS`, `TYPE`, `VOICE`. Every film reads the same ring and answers each
  kind its own way (Tron's grid ripples, Evangelion's AT field flares, the
  Matrix's rain splashes). This one ring replaces a uniform per event.
  - *Time.* The plugin stamps each impulse on the monotonic clock and uploads
    its age, so the shader never subtracts on the hourly-wrapping `time`. An
    impulse lives 3 s of real time and is then gone. What happens while the
    backdrop's time stands still (animations off, locked, every monitor asleep
    or fullscreen) is not collected and never replays.
  - *Sources.* `OPEN`, `CLOSE`, `FOCUS` from Hyprland's window events. `LAND`
    when a window stops moving: its drawn position was changing last frame
    and is not this frame (the same per-frame position the velocity comes
    from, so a tiling animation, a drag and a keyboard move all land the same
    way, with no event of their own to miss). `TYPE`: typing, defined by what was pressed, not where it went (this
    laptop is aarch64, where Hyprland's function hooks do nothing, so the
    point where a key reaches a client cannot be observed): a key whose
    keysym in the keyboard's current xkb state is printable, pressed with no
    modifier held but Shift, while a client window has keyboard focus, no
    input method holds a grab and the session is not locked. No binding of
    Omarchy's is a printable key without a modifier (that would break
    typing). Placed along the focused window's lower edge; the keycode and
    keysym are used only to decide this and are not kept. `VOICE`: the voice-activity
    edges below.
  - *Disclosure.* Nothing about keys or voice is stored or logged. The
    screen does show that typing or speech is happening, when, and how loud,
    to anyone who sees it, live or in a recording or share, password entry
    included: the plugin cannot tell a password field, and Voxtype's
    loudness shows whether or not a call carries the voice. That is the
    boundary, stated rather than hidden; `plugin:backdrop:depth 0` turns
    every answer off.
- **Voice.** `voice`: Voxtype's speech loudness, 0 to 1. The feed service is
  the one door for outside input to the plugin; voice is its own small
  message on the same socket, independent of the agents' text snapshot and
  of the lettering gate that idles the text: while Voxtype records, the
  service runs `voxtype-audio-bridge` (Voxtype's own protocol: `rms`, `vad`,
  connection status) and sends the latest `rms` at most 60 times a second,
  each `vad` edge at once (never coalesced away), and `voice = 0` with a
  closing edge when recording stops or the bridge disconnects. Amplitude and
  activity only; the bridge carries no audio or transcript.
- **Switch.** `switchProgress` (0 to 1 while a workspace switch plays, -1
  otherwise) and `switchDirection`, so the world moves with the camera
  during a 3D switch (part 5).
- **Light** is not plugin data: each film defines its light (direction,
  colour) as constants in its own `backdrop.frag`, used by `backdrop()` for
  shadows and by `frame()` for rims, so the two always agree.

A helper enters the contract only once two films answer a fact the same
way, so films compose instead of copying without a shared function bending to
films with different rules. Likely first ones: `windowShadow` (the soft
shadow window i casts on the scene, away from the light, longer and softer
with lift) and `impulseWave` (a ring expanding from an impulse, fading with
age).

- **Window light.** `windowColor(i)`: the average colour of what window i
  shows, its own content, so a window lights the world around it the way a
  screen lights a dark room (Sean, 2026-10-29: "I want them to feel
  connected more", across all themes). Measured on the GPU, never read back,
  from the client's content as Hyprland lays it out: the window's surface
  tree (main surface and subsurfaces, each at its place and through its
  viewport's source box), before glass, backdrop or decorations, so the
  world never feeds back into it. The plugin draws that tree, scaled to the
  window, into a small cell of a colour atlas in the backdrop pass, and
  `windowColor(i)` reads the cell.
  - *When.* Every window drawn on the monitor is measured again about four
    times a second, round robin, at most 8 windows a frame, in the frames the
    backdrop draws anyway; no commit tracking. A colour that changed by more
    than 1/255 on any channel is an answer that changed (part 6): the monitor
    draws again, and the glass follows on its own refresh. With animations off,
    when the world holds still, its light holds still too (last colours stay).
    A window not yet measured, with no buffer, or closed and fading has black,
    or keeps its last colour while it fades.
  - Films cast it as light spilling from the window onto the world (on the
    floor in front of it, into cloud, into the rain), strongest near the
    window, fading with distance and with `windowAlpha`.

The other direction, **the world's light on the glass**, is no new fact:
each film draws it in `backdrop()` under the window, and Hyprland's glass
shows it through the glass background only, never over text.

### 2. Frame and thickness: each window's edge belongs to the film

A plugin window decoration (`HyprlandAPI::addWindowDecoration`, on the OVER
layer, which Hyprland draws inside the window's own pass) on every window
draws the film's `frame(px, i)` in a band outside the window's edge and at
most 2 px inside it: a rim lit from the film's light, a bevel, the film's
own edge (IRIX grey bevels for Jurassic Park). Because it is drawn in the
window's pass it tilts, wobbles and fades with the window; fullscreen windows
have no decorations and so no frame, as today.

The glass's **thickness** is the frame band too: `frame()` is compiled in
the same program as `backdrop()`, so it draws the world bent through the
glass's edge by calling `backdrop()` at a coordinate pushed along the edge
normal, plus a specular line from the light. No window-shader change, so no
need for the window's edge or surface identity inside Hyprland's surface
shader, and popups and subsurfaces cannot pick it up.

Films that define `frame()` turn off Hyprland's border and shadow in
`film.lua`; films that do not keep them. Whether a decoration can run the
film's program in the pass's GL state is verified before building.

### 3. Glass that survives motion

Today's glass is decided in the window shader's blur variant, per surface,
from the colour and alpha the app drew (SPEC.md "Glass"). A window drawn
through any transformer (Hyprland's wobble or motion blur, or our tilt) is
first drawn, surface by surface, into its own buffer with blur off, then
composited once with Hyprland's blur behind it where that buffer is
translucent (its matte is the window's box; the blur is weighted by one
minus the buffer's alpha, ElementRenderer.cpp:760 and surface.frag
`USE_BLUR_MATTE`). So the rule is: **glass is decided per surface as each
surface is drawn, in the direct path and in the transformed source path
alike**, by the one glass function, and the composite applies nothing again
(the patch is excluded from the matte composite). The translucent buffer then
carries glass through every transformer stage to Hyprland's own blur.

How the transformed source draw reaches the glass function is verified
before building (candidates: a transformer's `preWindowRender`, which
Hyprland calls with the main pass's render data before the source pass; a
variant flag that pass already sets). If neither holds, glass windows get no
transformer (no tilt, wobble or motion blur on them), the physical tier is
the frame, the world's answers and the 3D switch, and this part is closed as
not buildable on 0.57.

### 4. Motion with mass

- **Wobble and motion blur** are Hyprland 0.57's own (`decoration:wobble:*`,
  `decoration:motion_blur:*`): `film.lua` sets them per film (Evangelion may
  wobble, Roadster stays rigid). No code of ours.
- **Tilt**: a plugin window transformer (`Render::IWindowTransformer`)
  turns a moving window about its centre by its velocity, in perspective, at
  most about 12 degrees, and springs it flat when it stops. A window with a
  popup open is held flat (popups are drawn outside the transformed pass and
  could not follow it).
- **Transformer lifetime** follows Hyprland's list as it is: our
  transformers are attached when needed, owned by the window's list, found
  by type each frame and never held by pointer; when inactive, Hyprland's own
  cleanup (`removeInactive`) deletes them, so at rest the window is drawn
  directly, as today: no extra buffer, text exactly flat. At plugin exit
  every one of ours reports inactive and the plugin runs `removeInactive` on
  each window, so no window keeps an object from the unloaded plugin.
- **Input** is Hyprland's, as with its own wobble and workspace animations:
  a tilted window is clicked where it lies flat; the tilt is small, centred
  and only while moving.
- **Opening and closing** keep Hyprland's own animation styles, with the
  `OPEN` and `CLOSE` impulses as the world's answer.

### 5. Workspaces as 3D panels

A new transition built on Hyprland's scene renderer (it renders any
workspace on its own for screen capture), not on Hyprland's workspace
animation, which Omarchy turns off so a switch is instant.

- **Presence.** Each workspace on a monitor has a presence, easing toward 1
  for the active one and 0 for the rest over the switch's length (about 450
  ms), the way a window's fade eases. A switch only changes targets, so a
  switch during a switch starts from what is on screen and nothing jumps,
  with any number of workspaces in flight.
- **What is drawn.** While any workspace on the monitor has a presence
  between 0 and 1, the plugin draws one opaque layer at
  `RENDER_POST_WINDOWS`: above the wallpaper, the bottom layers and the
  windows, below the top and overlay layers, where Omarchy's bar, dock and
  notifications are (`hyprctl layers`: levels 2 and 3). In it: the backdrop
  as the camera moves (`switchProgress`, `switchDirection`), then each
  workspace in flight as a panel placed by its presence along the film's
  path, rendered **live every frame** from its windows alone
  (`WORKSPACE_WINDOWS`, popups included) and composited over the moving
  backdrop, so its glass shows the film's world, and a menu opened or a
  window changed during the switch shows at once. When only the active
  workspace is left, at presence 1, its panel is exactly where its windows
  are, the layer stops, and the live windows show. How a plugin renders a
  workspace scene into its own buffer (screen capture's isolated scene
  resources and render session) is verified before building; its cost (one
  scene per workspace in flight, for under half a second) is measured.
- **Input** goes where Hyprland sends it: to the active workspace from the
  start, which is the panel arriving and live on screen, exactly as during
  Hyprland's own workspace animations.
- **When no 3D plays** (the switch is instant, as today): a special
  workspace is open on that monitor, a pinned window is on it, either
  workspace has a fullscreen window, a workspace gesture is in progress or
  ending on it, animations are off, or the session is locked. Each monitor
  switches on its own; a workspace moved to another monitor is not a switch.
- **Paths.** Each film names its path in `film.lua` (`switch = "fly" |
  "carousel" | "drop" | "dissolve" | "platform"`): Tron flies down the grid
  to the next sector, Jarvis turns a holo carousel, Oblivion drops through
  cloud, the Matrix dissolves into rain, Jurassic Park flies to the next fsn
  platform.

### 6. Damage and cost

Two kinds of change, two rules, for every fact above:
- **The windows changed** (geometry, fade, lift, a switch frame): damage the
  monitor and the glass in this frame, as today.
- **Only the world's answer changed** (pointer, an impulse alive, voice):
  damage the monitor in this frame, and leave the glass on its 0.2 s
  refresh. A pointer move schedules a frame for its monitor, so the light
  follows the cursor in the same frame.
At rest (no window moving, no impulse alive, pointer and voice still) the
plugin does exactly what it does today. Per-pixel cost (shadows, the impulse
loop) is a budget, measured, not assumed: each film's backdrop at most 1.5 ms
a frame at 2880 x 1800 on the N1X, and idle power at rest within 10% of
today's build.

### 7. Tiers, to try all three

`plugin:backdrop:depth`: `0` today's look; `1` glass (parts 1 and 2, the
world's answers and the frame); `2` physical (adds parts 3 to 5: glass
through motion, tilt, wobble, 3D switches); `3` space (adds a standing
perspective: windows sit at depths by `z` and lean with the pointer through
the same transformer, so text is never quite flat). Default `2`. A key
binding cycles it, so Sean can compare them on his own desktop.

The space tier is a visual experiment Sean asked for: input stays on
Hyprland's flat geometry, so its lean is bounded to keep every drawn edge
within 16 px of where the window lies flat, and a window with a popup open
stands flat. It keeps a transformer active at rest, so its idle cost is
measured on its own and is not held to the budget above.

## What it deletes

- `film.lua`'s border gradient and shadow glow, for every film that defines
  `frame()` (the edge is the film's).
- The plan's own earlier window-shader refraction: thickness is the frame
  calling `backdrop()`.
- Motion composes Hyprland's transformer list, wobble and motion blur; the 3D
  switch is new, built on Hyprland's scene renderer. The eased `focused` rect
  and its interpolation stay as they are; `lift` is a new, per-window fact.

## Non-goals

HUD widgets and readouts; a full-screen post-process shader; tilting or
projecting windows at rest (tiers 1 and 2); reading which key was pressed or
what was said (only that a key was pressed, and how loud); changing apps.

## Order (each its own PR, under the review gate)

1. Contract v2 facts and helpers, and every film answering them: shadows,
   lift, wakes, impulse answers, pointer light; the damage rules.
2. Voice through the feed.
3. Frame and thickness.
4. Workspaces as 3D panels.
5. Glass that survives motion, tilt, and each film's wobble and motion blur.
6. The space tier and the binding.

Jurassic Park (another lane) adopts each part as it lands.

## To verify before building (against Hyprland v0.57.0, scratch/ref/hyprland-057)

- An OVER decoration can run the film's program in the pass's GL state.
- How a plugin renders a workspace scene into its own buffer from a render
  stage (screen capture's isolated scene resources), every frame, and what
  its glass looks like composited over the moving backdrop.
- How the transformed source draw reaches the glass function (part 3), or
  part 3's stated fallback.
- Drawing a window's surface tree (every texture kind Hyprland imports:
  shm, dmabuf, and external-only where 0.57 supports it) into a plugin atlas
  from the backdrop pass; a texture kind that cannot be drawn leaves that
  surface out of the colour.

## Acceptance

Per part: the hidden-desktop harness (the previews lane) renders each film at
rest, with a window dragged, landing, typed into, spoken over, and a
workspace switch mid-way, and those frames are read for legibility; idle power
at rest unchanged within noise against today's build (interleaved, on
workspace 1); both review passes PASS on the exact commit; Sean's eye on his
own desktop at the next login.
