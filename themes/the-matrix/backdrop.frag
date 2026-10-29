// The Matrix: the code, and the code is what the agents on this machine are
// writing (specs/agent-rain.md). Their text rains down the black screen in
// mirrored glyphs, in three depths, nearer columns larger, brighter and
// faster, each stream led by a white-hot head carrying the newest characters
// and leaving a fading phosphor tail. When no agent is running there is no
// rain: it drains away, leaving the black, the windows' glow and the line
// under the bar. The rain parts round the
// windows: behind the glass it falls dim, drops flare where they strike a
// window's top edge, and streams run down its sides, brightest beside the
// focused window. The gaps between windows glow faintly green.
//
// The windows stand in the rain (specs/depth.md): each shelters the rain
// below it, deeper and softer as focus lifts it, and the rain's light lies
// on its glass. The near columns shift a few pixels more than the far ones
// as the pointer moves and a window is dragged, and the rain is a little
// brighter under the pointer. The code answers briefly and softly, never
// while you work (Sean, 2026-10-29: "nice and elegant and give depth to the
// window, but we don't need too much crazy movement"): a window landing sends
// one soft wave of light through the rain from its edge, opening or taking
// focus brightens the rain round it for a moment, closing leaves a glow that
// fades, a moving window leaves a short faint wake, and the rain brightens a
// little as you speak. Typing has no answer. Each window's frame is a
// phosphor edge that catches the rain passing behind its glass.

const vec3 HEAD = vec3(0.78, 1.0, 0.84);
// The brightest the rain is behind the glass. colors.toml's muted (#5c9a6c)
// keeps 4.5:1 over a background of relative luminance 0.0199 or less; glass
// 0.2 over #020804 with Omarchy's 0.75 blur brightness stays under that while
// the rain behind is at most 0.19 in every channel.
const float UNDER_GLASS = 0.19;
// How far outside a window Hyprland's blur (frost 1, two passes) gathers
// light into the window's glass, in pixels: the answers keep to the glass's
// limit that close to a window.
const float BLUR_REACH = 10.0;
// Where the light comes from: above, with the rain, a little to the right.
const vec2 LIGHT = vec2(0.12, -0.99);
// Periods (seconds) a drop takes to fall one repeat, four to a depth from the
// nearest, slower further back; each divides 3600. Near drops average about
// 340 px a second, mid 210 and far 130: a screen in four seconds up close,
// the film's pace and calm enough to work beside (twice that read as busy at
// 120 fps).
const float PERIODS[6] = float[](6.0, 8.0, 10.0, 12.0, 16.0, 20.0);

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 5.0));
}

// One column's light at height y: a head falls a repeat of `span` pixels
// every `period` seconds, lighting cell after cell, and the cells behind it
// fade out over `tail` pixels, leaving the rest of the repeat black. Measured
// at the cell's middle, so the light steps from glyph to glyph as it does on
// the film's screens. Returns the light, how much of it is the head (y), and
// how many cells behind the head this one is (z).
vec3 drops(float y, float cellH, float span, float period, float phase, float tail) {
    float mid = (floor(y / cellH) + 0.5) * cellH;
    float behind = fract(cycle(period) + phase - mid / span) * span;
    float fade = max(1.0 - behind / tail, 0.0);
    return vec3(fade * fade * (0.35 + 0.65 * fade), 1.0 - step(cellH, behind), floor(behind / cellH));
}

// One column of glyph cells `cell` pixels big, at `at` in cells (x across
// the column, y down it), with its drops. Returns the light in the tail, the
// light in the head and the column's soft glow, which falls to nothing at the
// column's sides.
vec3 column(vec2 at, vec2 cell, float id, float span, float period, float phase, float tail) {
    vec3 lit = drops(at.y * cell.y, cell.y, span, period, phase, tail);
    float across = 1.0 - abs(fract(at.x) - 0.5) * 2.0;
    float glow = lit.x * across * across;
    if (lit.x < 0.01 || feedCount == 0) return vec3(0.0, 0.0, glow);
    // Each stream carries its own stretch of the agents' text, the newest of
    // it at the head and older characters up its tail, so the text falls
    // with the drop.
    int start = int(hash(vec2(id, 3.3)) * float(feedCount));
    vec2 box = cell * vec2(0.62, 0.7);
    vec2 q = (fract(at) - 0.5) * cell + box * 0.5;
    float inBox = step(0.0, min(q.x, q.y)) * step(max(q.x - box.x, q.y - box.y), 0.0);
    float ink = glyph(feedChar(start + int(lit.z)), q / box) * inBox;
    return vec3(ink * lit.x, ink * lit.y, glow);
}

// A rain column's drops at one depth: (period, span, phase, tail), each
// varied per column round the depth's `span` and `tail`; a zero period is an
// empty column, so the streams stand apart.
vec4 drop(float id, float layer, float span, float tail) {
    vec2 key = vec2(id, layer * 17.0);
    if (hash(key + vec2(0.0, 5.0)) < 0.22) return vec4(0.0);
    return vec4(PERIODS[int(layer) + int(hash(key) * 4.0)],
                span * (0.8 + 0.8 * hash(key + vec2(0.0, 3.0))),
                hash(key + vec2(0.0, 11.0)),
                tail * (0.5 + hash(key + vec2(0.0, 7.0))));
}

// The rain's depths: glyph cell in pixels, then the drops' span and tail.
const vec4 FAR_RAIN = vec4(8.0, 11.0, 1500.0, 420.0);
const vec4 MID_RAIN = vec4(12.0, 16.0, 1900.0, 560.0);
const vec4 NEAR_RAIN = vec4(17.0, 23.0, 2400.0, 720.0);

// One depth of rain over the whole screen; `layer` 0 is the nearest, its
// columns shifted `shift` pixels across.
vec3 rain(vec2 px, vec4 depth, float layer, float shift) {
    vec2 at = vec2(px.x + shift, px.y) / depth.xy + vec2(layer * 0.37, 0.0);
    float id = floor(at.x);
    vec4 d = drop(id, layer, depth.z, depth.w);
    if (d.x == 0.0) return vec3(0.0);
    return column(at, depth.xy, id * 3.1 + layer * 101.0, d.y, d.x, d.z, d.w);
}

// The way out of a rect's edge at px, rounded by `radius`.
vec2 outward(vec2 px, vec4 rect, float radius) {
    vec2 c = px - rect.xy - rect.zw * 0.5;
    vec2 q = abs(c) - rect.zw * 0.5 + radius;
    vec2 n = q.x > 0.0 && q.y > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return n * sign(c + 1e-6);
}

// The window an impulse happened to: the one holding its point whose middle
// is nearest it, or the point itself once the window has gone.
vec4 impulseRect(vec2 at) {
    vec4 found = vec4(at, 0.0, 0.0);
    float best = FAR;
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        float d = length(at - r.xy - r.zw * 0.5);
        if (rectDistance(at, r, 0.0) < 1.0 && d < best) {
            best = d;
            found = r;
        }
    }
    return found;
}

// The rain answering what happened, at px, briefly and softly: a glow of its
// own (x), and how much brighter the rain there is (y).
vec2 answers(vec2 px) {
    vec2 a = vec2(0.0);
    // Newest first: the ring is in the order things happened, so once one is
    // older than the longest answer (1.2 s) every one before it is too.
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (kind == LAND) {
            // One soft wave of light leaves the window's edge, a little
            // brighter the faster it came.
            float d = rectDistance(px, impulseRect(e.xy), 0.0);
            float reach = 40.0 + age * 600.0;
            if (d < -2.0 || abs(d - reach) > 200.0) continue;
            float wave = exp(-abs(d - reach) / 45.0) * exp(-age * 3.0) * (1.0 - smoothstep(0.8, 1.2, age)) * (0.5 + 0.5 * e.w);
            a += vec2(0.12, 0.8) * wave;
        } else if (kind == OPEN || kind == FOCUS) {
            // The rain round the window brightens for a moment.
            if (age > 1.0) continue;
            float d = rectDistance(px, impulseRect(e.xy), 0.0);
            if (d < -2.0 || d > 200.0) continue;
            float near = exp(-max(d, 0.0) / 50.0) * smoothstep(0.0, 0.15, age) * exp(-age * 3.0) * (kind == OPEN ? 1.0 : e.w);
            a += vec2(0.08, 0.6) * near;
        } else if (kind == CLOSE) {
            // Where the window was, a glow that fades.
            if (age > 0.8) continue;
            a += vec2(0.06, 0.4) * exp(-length(px - e.xy) / 250.0) * smoothstep(0.0, 0.1, age) * (1.0 - age / 0.8);
        }
    }
    return a;
}

vec4 backdrop(vec2 px) {
    vec3 green = accent;

    // The windows at px: the nearest, the topmost whose glass px is behind,
    // the light pooled in the gaps, and the shelter each gives the rain
    // below it, deeper and softer the more focus lifts it.
    float nearest = FAR, near = 0.0, shadow = 0.0;
    int closest = -1, pane = -1;
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        float d = windowDistance(px, i);
        near += exp(-max(d, 0.0) / 60.0);
        if (d < 0.0) pane = i;
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
        float lift = windowLift(i);
        float soft = 18.0 + 40.0 * lift;
        float s = rectDistance(px + LIGHT * (26.0 + 46.0 * lift), r, windowRounding(i));
        shadow = max(shadow, (1.0 - smoothstep(-soft, soft, s)) * windowAlpha(i));
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    float open = 1.0 - inside;
    near = clamp(near, 0.0, 1.0);
    float nearFocus = exp(-max(focusedWindow(px), 0.0) / 160.0);

    // The pointer and a dragged window move the viewpoint, so the near
    // columns shift a few pixels more than the far ones.
    vec2 drag = focusedIndex >= 0 ? windowVelocity(focusedIndex) : vec2(0.0);
    float view = (pointer.x - resolution.x * 0.5) * 0.007 + drag.x * 0.003;

    // A moving window leaves a short faint wake where it has just been.
    float wake = 0.0;
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0 || windowDistance(px, i) < 0.0) continue;
        float pace = min(speed / 1500.0, 1.0) * windowAlpha(i);
        for (int k = 1; k <= 2; k++) {
            vec4 ghost = windowRect(i);
            ghost.xy -= v * 0.025 * float(k);
            wake = max(wake, exp(-max(rectDistance(px, ghost, windowRounding(i)), 0.0) / 30.0) * (1.0 - 0.3 * float(k)) * pace);
        }
    }

    // Three depths: far columns small, dim and slow; near ones large and fast.
    // No agents, no rain.
    vec3 far = vec3(0.0), mid = vec3(0.0), close = vec3(0.0);
    if (feedPresence > 0.0) {
        far = rain(px, FAR_RAIN, 2.0, view * 0.2) * feedPresence;
        mid = rain(px, MID_RAIN, 1.0, view * 0.5) * feedPresence;
        close = rain(px, NEAR_RAIN, 0.0, view) * feedPresence;
    }
    // The far rain is cooler and dimmer, as if seen through more air; the
    // heads are white-hot at every depth.
    vec3 code = green * vec3(0.55, 0.75, 0.7) * (far.x * 0.3 + far.z * 0.04)
        + green * (mid.x * 0.62 + mid.z * 0.06)
        + green * (close.x * 1.0 + close.z * 0.1)
        + HEAD * (far.y * 0.4 + mid.y * 0.9 + close.y * 1.6);

    // Out in the open the rain is brightest round the focused window, a
    // little brighter under the pointer, in a moving window's wake, where
    // something just happened and as you speak, and sheltered below the
    // windows. Behind the glass it keeps its shape but not its glare (the
    // limit below).
    vec2 answer = answers(px);
    vec2 toPointer = px - pointer.xy;
    float touch = exp(-dot(toPointer, toPointer) / (2.0 * 90.0 * 90.0));
    float shade = 1.0 - 0.75 * shadow;
    vec3 light = code * mix(1.0, (1.0 + 0.6 * nearFocus) * (1.0 + 0.35 * touch + 0.6 * wake + answer.y + 0.3 * voice) * shade, open);
    light += green * 0.04 * wake * open;

    // The rain parts round the windows: drops flare where they strike a
    // window's top edge, and streams run down its sides.
    if (closest >= 0 && nearest > 0.0 && nearest < 40.0 && feedPresence > 0.0) {
        vec4 rect = windowRect(closest);
        float fade = windowAlpha(closest);
        float focus = closest == focusedIndex ? 1.0 : 0.45;
        float side = max(rect.x - px.x, px.x - rect.x - rect.z);
        float over = rect.y - px.y;
        if (side > 0.0 && px.y > rect.y - 20.0 && px.y < rect.y + rect.w + 20.0) {
            // Two columns of glyphs hugging the side, anchored to the window
            // so they travel with it, at the mid rain's pace: they run beside
            // the text, where fast motion would pull the eye.
            vec2 cell = vec2(13.0, 18.0);
            vec2 at = vec2(side / cell.x, (px.y - rect.y) / cell.y);
            float id = floor(at.x) + float(closest) * 7.0 + (px.x < rect.x ? 0.0 : 3.0);
            // Each runs most of its repeat lit, so the side reads as one
            // stream; the open rain thins where it runs, diverted into it.
            float band = step(at.x, 2.0);
            float period = 4.0 + floor(hash(vec2(id, 91.0)) * 3.0);
            vec3 stream = column(at, cell, id * 5.3, 960.0, period, hash(vec2(id, 93.0)), 700.0) * band;
            light *= 1.0 - 0.6 * band * fade;
            light += (green * (stream.x * 1.3 + stream.z * 0.14) + HEAD * stream.y * 1.8) * focus * fade * feedPresence;
        }
        if (over > 0.0 && px.x > rect.x && px.x < rect.x + rect.z) {
            // Where a near column's head reaches the top edge, it flares and
            // the edge holds a little of its light as the tail goes by.
            float at = (px.x + view) / NEAR_RAIN.x;
            vec4 d = drop(floor(at), 0.0, NEAR_RAIN.z, NEAR_RAIN.w);
            if (d.x > 0.0) {
                vec3 lit = drops(rect.y - 1.0, NEAR_RAIN.y, d.y, d.x, d.z, d.w);
                float splash = (lit.y * 1.5 + lit.x * lit.x * 0.4) * exp(-over / 5.0)
                    * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 8.0);
                light += mix(green, HEAD, 0.6) * splash * (0.6 + focus) * fade * feedPresence;
            }
        }
    }

    // The answers' own glow, with or without rain; within the blur's reach of
    // a window it keeps to the glass's limit.
    vec3 glow = green * answer.x;
    light += glow * mix(1.0, min(1.0, UNDER_GLASS / max(glow.g, 1e-4)), max(inside, 1.0 - smoothstep(0.0, BLUR_REACH, nearest)));

    // The gaps between windows glow faintly green, a little more as you
    // speak, and less in the windows' shelter.
    light += green * near * open * (0.07 + 0.03 * voice) * (0.5 + 0.5 * shade);

    // The rain's light on the glass: a glow along the upper glass, where the
    // rain comes from, and a soft diagonal streak that slides across the pane
    // as the window moves, as a reflection does. Only the glass shows it.
    if (pane >= 0) {
        vec4 r = windowRect(pane);
        vec2 at = px - r.xy;
        float streak = dot(at, vec2(0.70710678)) / (r.z + r.w) * 1.2 + dot(r.xy, vec2(0.70710678)) / (resolution.x + resolution.y) * 0.8;
        float band = exp(-pow((fract(streak + 0.2) - 0.5) * 7.0, 2.0));
        light += HEAD * (0.05 * exp(-at.y / 60.0) + 0.035 * band) * windowAlpha(pane);
    }

    // The bar's lower edge: a phosphor line with a drip of brighter light
    // running along it, and the rain dimmed under the bar so its text reads.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light *= mix(1.0, 0.3, step(below, 0.0));
        light += green * glowLine(abs(below), 1.0) * (0.45 + 0.15 * voice);
        float drip = cycle(9.0) * (resolution.x + 600.0) - 300.0;
        float behind = drip - px.x;
        float trail = behind > 0.0 ? exp(-behind / 260.0) : exp(behind / 6.0);
        light += mix(green, HEAD, 0.6) * trail * glowLine(abs(below), 1.6) * 1.4;
        light += green * 0.03 * step(below, 0.0);
    }

    // Behind the glass the rain keeps its shape but not its glare: no channel
    // goes over UNDER_GLASS, so a drop passing behind secondary text never
    // takes it under 4.5:1 (Sol, 2026-10-28).
    float peak = max(light.r, max(light.g, light.b));
    light *= mix(1.0, min(1.0, UNDER_GLASS / max(peak, 1e-4)), inside);

    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a phosphor line, a crisp
// core in its own bloom, brightest along the top where the rain falls from
// and as focus lifts it, brightening softly for a moment when the window
// opens, lands or takes focus. The glass's outer pixels show the rain bent
// from behind it, and that light catches on the line, so a drop passing
// behind the glass lights the edge. Its light stays within a few pixels, so
// it never lies over the text of a window beneath.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 48.0) return vec4(0.0);
    vec2 n = outward(px, r, rounding);
    bool focus = i == focusedIndex;
    float lift = windowLift(i);

    // What just happened to this window, newest first; all of it is over
    // within a second.
    float flare = 0.0;
    vec2 middle = r.xy + r.zw * 0.5;
    for (int k = impulseCount - 1; k >= 0; k--) {
        int kind = impulseKinds[k];
        vec4 ev = impulses[k];
        if (ev.z > 1.0) break;
        if ((kind != FOCUS && kind != OPEN && kind != LAND) || length(ev.xy - middle) > 2.0 + length(r.zw) * 0.02) continue;
        flare += 0.6 * smoothstep(0.0, 0.12, ev.z) * exp(-ev.z * 3.5) * (kind == OPEN ? 1.0 : ev.w);
    }

    float toward = 0.55 + 0.45 * clamp(dot(n, -LIGHT), 0.0, 1.0);
    float strength = (focus ? 0.9 + 0.6 * lift : 0.45) * toward * (1.0 + flare);
    float x = abs(d - 0.5);
    float line = (1.0 - smoothstep(0.0, 1.0, x)) + 0.35 * exp(-x / 2.5);
    vec3 tint = focus ? mix(accent, HEAD, 0.35) : accent * 0.6;

    // The rain just behind the glass's edge, seen bent through its outer
    // pixels and caught by the line.
    float edge = (1.0 - smoothstep(0.0, 6.0, d)) * smoothstep(-2.0, 0.0, d);
    vec3 behind = d < 10.0 ? backdrop(px - n * (max(d, 0.0) + 8.0)).rgb - background : vec3(0.0);
    vec3 glow = (tint * strength + behind * 4.0) * line;
    float a = clamp(max(edge * 0.85, (1.0 - smoothstep(0.0, 1.0, x)) * min(strength, 1.0)), 0.0, 1.0);
    return vec4((background + behind) * edge * 0.85 + glow, a) * windowAlpha(i);
}
