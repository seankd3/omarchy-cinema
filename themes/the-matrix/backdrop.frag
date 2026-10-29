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
// The windows stand in the rain (specs/depth.md). The near rain lands on
// them: it stops at a window's top, splashing there, and drips off its lower
// edge, while the far rain falls on behind the glass. Each window shelters
// the rain below it, deeper as focus lifts it, and the rain's light lies on
// its glass. The near columns shift more than the far ones as the pointer
// moves and a window is dragged; the pointer parts and lights the columns
// round it; a moving window drags them aside and leaves a bright wake. And
// the code answers the desktop: landing bursts glyphs out from the window,
// opening writes it into the rain, closing dissolves it into falling code,
// typing drops a column of code from the key, speaking sends a wave through
// the rain and brightens it. With no agent running the answers are a faint
// glow, never rain. Each window's frame is a phosphor edge that catches the
// rain passing behind its glass, traced round when the window opens or takes
// focus.

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
// empty column, so the streams stand apart. The near rain that drips off a
// window's lower edge (`origin` that edge's height, 0 for the open sky) has
// its own phase and short tails.
vec4 drop(float id, float layer, float span, float tail, float origin) {
    vec2 key = vec2(id, layer * 17.0);
    if (hash(key + vec2(0.0, 5.0)) < 0.22) return vec4(0.0);
    vec4 d = vec4(PERIODS[int(layer) + int(hash(key) * 4.0)],
                  span * (0.8 + 0.8 * hash(key + vec2(0.0, 3.0))),
                  hash(key + vec2(0.0, 11.0)),
                  tail * (0.5 + hash(key + vec2(0.0, 7.0))));
    if (origin > 0.0) d.zw = vec2(fract(d.z + origin * 0.0137), d.w * 0.45);
    return d;
}

// The rain's depths: glyph cell in pixels, then the drops' span and tail.
const vec4 FAR_RAIN = vec4(8.0, 11.0, 1500.0, 420.0);
const vec4 MID_RAIN = vec4(12.0, 16.0, 1900.0, 560.0);
const vec4 NEAR_RAIN = vec4(17.0, 23.0, 2400.0, 720.0);

// One depth of rain over the whole screen; `layer` 0 is the nearest, its
// columns shifted `shift` pixels across and falling from `origin`.
vec3 rain(vec2 px, vec4 depth, float layer, float shift, float origin) {
    vec2 at = vec2(px.x + shift, px.y - origin) / depth.xy + vec2(layer * 0.37, 0.0);
    float id = floor(at.x);
    vec4 d = drop(id, layer, depth.z, depth.w, origin);
    if (d.x == 0.0) return vec3(0.0);
    return column(at, depth.xy, id * 3.1 + layer * 101.0, d.y, d.x, d.z, d.w);
}

// Where the near rain falling through px comes from: 0 from the open sky, or
// the lower edge of the lowest window above px in its column, which it
// landed on and drips off; -1 behind a window's glass, where it has landed.
float nearOrigin(vec2 px) {
    float origin = 0.0;
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        if (windowAlpha(i) < 0.5 || px.x < r.x || px.x > r.x + r.z || px.y < r.y) continue;
        if (px.y <= r.y + r.w) return -1.0;
        origin = max(origin, r.y + r.w);
    }
    return origin;
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

// The near rain's glyph cell holding px, its columns shifted `shift` across:
// the point the code is judged at (xy), the cell's middle on the screen so
// it lights glyph by glyph, or px itself with no agent running, so its glow
// is smooth; how much of a character of the agents' text covers px (z); and
// how near px is to its column's middle (w).
vec4 nearGlyph(vec2 px, float shift) {
    vec2 at = vec2(px.x + shift, px.y) / NEAR_RAIN.xy;
    vec2 cell = floor(at);
    vec2 box = NEAR_RAIN.xy * vec2(0.62, 0.7);
    vec2 q = (fract(at) - 0.5) * NEAR_RAIN.xy + box * 0.5;
    float inBox = step(0.0, min(q.x, q.y)) * step(max(q.x - box.x, q.y - box.y), 0.0);
    if (feedCount == 0) return vec4(px, 0.0, 1.0 - abs(fract(at.x) - 0.5) * 2.0);
    float ink = glyph(feedChar(int(hash(cell + 7.7) * float(feedCount))), q / box) * inBox;
    return vec4((cell + 0.5) * NEAR_RAIN.xy - vec2(shift, 0.0), ink, 1.0 - abs(fract(at.x) - 0.5) * 2.0);
}

// The code answering what happened, at px, in the near rain's grid shifted
// `shift` across: glyphs lit glyph by glyph in rings and walls round the
// windows (lit, head), streams of code falling (stream, streamHead), and a
// soft glow under the rings that carries through the glass.
vec3 answers(vec2 px, float shift) {
    vec4 g = nearGlyph(px, shift);
    vec2 c = g.xy;
    float lit = 0.0, head = 0.0, stream = 0.0, streamHead = 0.0, glow = 0.0;
    // Newest first: the ring is in the order things happened, so once one is
    // older than the longest answer (1.8 s) every one before it is too.
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.8) break;
        if (kind == TYPE) {
            // A key drops a column of code from where it was typed: a head
            // falls from the window's lower edge, its tail behind it.
            if (age > 0.9 || abs(px.x - e.x) > NEAR_RAIN.x * 1.5 || px.y < e.y - NEAR_RAIN.y) continue;
            if (floor((px.x + shift) / NEAR_RAIN.x) != floor((e.x + shift) / NEAR_RAIN.x)) continue;
            float fall = e.y + age * 620.0;
            float behind = fall - c.y;
            if (behind < 0.0 || c.y < e.y) continue;
            float fade = smoothstep(0.0, 0.04, age) * exp(-age * 2.4) * e.w * 2.0;
            stream += fade * exp(-behind / 80.0);
            streamHead += fade * (1.0 - step(NEAR_RAIN.y, behind));
        } else if (kind == LAND || kind == OPEN || kind == VOICE) {
            // Landing bursts glyphs out from the window's edge, harder the
            // faster it came; opening writes a band of code round it that
            // settles and fades; speaking sends a slow wave through the rain.
            vec4 r = impulseRect(e.xy);
            float reach = kind == LAND ? age * 1000.0 : kind == OPEN ? 30.0 + 90.0 * (1.0 - exp(-age * 5.0)) : age * 450.0;
            float d = rectDistance(px, r, 0.0);
            if (d < -2.0 || abs(d - reach) > 200.0) continue;
            float fade = kind == LAND ? exp(-age * 2.2) * (0.5 + 0.7 * e.w) : kind == OPEN ? exp(-age * 2.5) : 0.6 * exp(-age * 1.5);
            float dc = rectDistance(c, r, 0.0);
            lit += 2.4 * fade * exp(-abs(dc - reach) / (kind == VOICE ? 50.0 : 30.0));
            head += 2.0 * fade * exp(-abs(dc - reach) / 14.0) * step(age, 0.7);
            glow += fade * exp(-abs(d - reach) / 70.0);
        } else if (kind == CLOSE) {
            // The window dissolves into code: streams fall out of where it
            // was, white-hot at their heads.
            if (age > 1.0 || abs(px.x - e.x) > 320.0) continue;
            float id = floor((px.x + shift) / NEAR_RAIN.x);
            if (hash(vec2(id, 41.0)) < 0.3) continue;
            float fall = e.y - 160.0 + hash(vec2(id, 43.0)) * 320.0 + age * 900.0;
            float behind = fall - c.y;
            if (behind < 0.0) continue;
            float fade = (1.0 - age) * (1.0 - abs(px.x - e.x) / 320.0);
            stream += 1.8 * fade * exp(-behind / 140.0) * step(e.y - 220.0, c.y);
            streamHead += 2.0 * fade * (1.0 - step(NEAR_RAIN.y, behind));
        } else if (kind == FOCUS) {
            // Focus lights the code round the window for a moment.
            if (age > 0.8) continue;
            vec4 r = impulseRect(e.xy);
            float d = rectDistance(px, r, 0.0);
            if (d < 0.0 || d > 160.0) continue;
            float fade = exp(-age * 4.0) * e.w;
            lit += 1.4 * fade * exp(-rectDistance(c, r, 0.0) / 50.0);
            glow += 0.4 * fade * exp(-d / 40.0);
        }
    }
    // Glyphs of the agents' text while they run; with none, the rings are
    // their glow alone and the streams a faint line down their columns,
    // never rain.
    float faint = 0.1 * g.w * g.w;
    return accent * ((lit * g.z * feedPresence + stream * mix(faint, g.z, feedPresence)) * 1.2 + glow * (0.2 + 0.2 * feedPresence))
        + HEAD * (min(head, 2.0) * g.z * feedPresence + min(streamHead, 2.0) * mix(faint * 0.6, g.z, feedPresence)) * 1.4;
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
    // columns shift across more than the far ones. The pointer also parts
    // the columns round it, pushed aside and drawn along as it moves, and
    // lights them; a moving window drags the columns beside it along and
    // leaves a bright wake where it has just been.
    vec2 drag = focusedIndex >= 0 ? windowVelocity(focusedIndex) : vec2(0.0);
    float view = (pointer.x - resolution.x * 0.5) * 0.016 + drag.x * 0.006;
    vec2 toPointer = px - pointer.xy;
    float touch = exp(-dot(toPointer, toPointer) / (2.0 * 90.0 * 90.0));
    float part = (-sign(toPointer.x) * 16.0 - pointer.z * 0.01) * touch;
    float pull = 0.0, wake = 0.0;
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0) continue;
        float pace = min(speed / 1500.0, 1.0) * windowAlpha(i);
        float d = windowDistance(px, i);
        pull -= v.x * 0.02 * exp(-max(d, 0.0) / 80.0) * pace;
        if (d < 0.0) continue;
        for (int k = 1; k <= 4; k++) {
            vec4 ghost = windowRect(i);
            ghost.xy -= v * 0.035 * float(k);
            wake = max(wake, exp(-max(rectDistance(px, ghost, windowRounding(i)), 0.0) / 30.0) * (1.0 - 0.2 * float(k)) * pace);
        }
    }
    float nearShift = view + part + pull;

    // Three depths: far columns small, dim and slow; near ones large and fast.
    // No agents, no rain.
    vec3 far = vec3(0.0), mid = vec3(0.0), close = vec3(0.0);
    if (feedPresence > 0.0) {
        far = rain(px, FAR_RAIN, 2.0, nearShift * 0.2, 0.0) * feedPresence;
        mid = rain(px, MID_RAIN, 1.0, nearShift * 0.5, 0.0) * feedPresence;
        float origin = nearOrigin(px);
        if (origin >= 0.0) close = rain(px, NEAR_RAIN, 0.0, nearShift, origin) * feedPresence;
    }
    // The far rain is cooler and dimmer, as if seen through more air; the
    // heads are white-hot at every depth. The windows shelter the far rain
    // below them; the near rain below a window is its own drips.
    float shade = 1.0 - 0.75 * shadow;
    vec3 code = (green * vec3(0.55, 0.75, 0.7) * (far.x * 0.3 + far.z * 0.04) + HEAD * far.y * 0.4
        + green * (mid.x * 0.62 + mid.z * 0.06) + HEAD * mid.y * 0.9) * shade
        + green * (close.x * 1.0 + close.z * 0.1) + HEAD * close.y * 1.6;

    // Behind the glass, where only the far rain falls, it is brought up so
    // the rain still reads through the windows (under UNDER_GLASS, below).
    // Out in the open the rain is brightest round the focused window, under
    // the pointer, in a moving window's wake and as you speak.
    vec3 light = code * mix(2.6, (1.0 + 0.6 * nearFocus) * (1.0 + 1.2 * touch + 2.5 * wake + 1.2 * voice), open);
    light += green * 0.16 * wake * open;

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
            // Where a near column's head lands on the top edge, it flares
            // and spatters along the edge, which holds a little of its light
            // as the tail goes by.
            float at = (px.x + nearShift) / NEAR_RAIN.x;
            float origin = nearOrigin(vec2(px.x, rect.y - 1.0));
            vec4 d = drop(floor(at), 0.0, NEAR_RAIN.z, NEAR_RAIN.w, origin);
            if (d.x > 0.0) {
                vec3 lit = drops(rect.y - 1.0 - origin, NEAR_RAIN.y, d.y, d.x, d.z, d.w);
                float splash = (lit.y * 1.5 + lit.x * lit.x * 0.4) * exp(-over / 5.0)
                    * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 8.0)
                    + lit.y * exp(-over / 12.0) * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 22.0) * 0.6;
                light += mix(green, HEAD, 0.6) * splash * (0.6 + focus) * fade * feedPresence;
            }
        }
    }

    // What happened lately, in the code; within the blur's reach of a window
    // it keeps to the glass's limit.
    vec3 answer = answers(px, nearShift) * mix(1.0, 1.6, voice);
    float answerPeak = max(answer.r, max(answer.g, answer.b));
    light += answer * mix(1.0, min(1.0, UNDER_GLASS / max(answerPeak, 1e-4)), max(inside, 1.0 - smoothstep(0.0, BLUR_REACH, nearest)));

    // The gaps between windows glow faintly green, more as you speak, and
    // less in the windows' shelter.
    light += green * near * open * (0.07 + 0.08 * voice) * (0.5 + 0.5 * shade);

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
        light += green * glowLine(abs(below), 1.0) * (0.45 + 0.4 * voice);
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

// How far round a rect's edge the point nearest px is, clockwise from the top
// left corner, 0 to 1.
float perimeter(vec2 px, vec4 rect) {
    vec2 p = clamp(px - rect.xy, vec2(0.0), rect.zw);
    float w = rect.z, h = rect.w;
    float m = min(min(p.x, w - p.x), min(p.y, h - p.y));
    float s;
    if (m == p.y) s = p.x;
    else if (m == w - p.x) s = w + p.y;
    else if (m == h - p.y) s = w + h + (w - p.x);
    else s = 2.0 * w + h + (h - p.y);
    return s / (2.0 * (w + h));
}

// Each window's edge (specs/depth.md, part 2): a phosphor line, a crisp
// core in its own bloom, brightest along the top where the rain lands and as
// focus lifts it. The glass's outer pixels show the rain bent from behind
// it, and that light catches on the line, so a drop passing behind the glass
// lights the edge. Opening writes the line in round the window, and taking
// focus sends a white-hot trace once round it. Its light stays within a few
// pixels, so it never lies over the text of a window beneath.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 48.0) return vec4(0.0);
    vec2 n = outward(px, r, rounding);
    bool focus = i == focusedIndex;
    float lift = windowLift(i);

    // What just happened to this window, newest first and all over within a
    // second: how much of the line is written in, and a trace running round
    // it.
    float around = perimeter(px, r);
    float written = 1.0, trace = 0.0, flare = 0.0;
    vec2 middle = r.xy + r.zw * 0.5;
    for (int k = impulseCount - 1; k >= 0; k--) {
        int kind = impulseKinds[k];
        vec4 ev = impulses[k];
        if (ev.z > 1.0) break;
        if (kind == TYPE || kind == CLOSE || kind == VOICE || length(ev.xy - middle) > 2.0 + length(r.zw) * 0.02) continue;
        if (kind == OPEN && ev.z < 0.5) {
            float drawn = ev.z / 0.5;
            written = min(written, step(around, drawn));
            trace += 3.0 * exp(-max(drawn - around, 0.0) * 60.0) * step(around, drawn);
        } else if (kind == FOCUS && ev.z < 0.6) {
            float ahead = fract(ev.z / 0.6 - around);
            trace += 2.5 * exp(-ahead * 25.0) * ev.w * (1.0 - ev.z / 0.6);
            flare += 0.8 * exp(-ev.z * 5.0);
        } else if (kind == LAND) flare += 2.5 * ev.w * exp(-ev.z * 4.0);
    }

    float toward = 0.55 + 0.45 * clamp(dot(n, -LIGHT), 0.0, 1.0);
    float strength = (focus ? 0.9 + 0.6 * lift : 0.45) * toward * (1.0 + flare + (focus ? 1.2 * voice : 0.0)) * written;
    float x = abs(d - 0.5);
    float line = (1.0 - smoothstep(0.0, 1.0, x)) + 0.35 * exp(-x / 2.5);
    vec3 tint = focus ? mix(accent, HEAD, 0.35) : accent * 0.6;

    // The rain just behind the glass's edge, seen bent through its outer
    // pixels and caught by the line.
    float edge = (1.0 - smoothstep(0.0, 6.0, d)) * smoothstep(-2.0, 0.0, d);
    vec3 behind = d < 10.0 ? backdrop(px - n * (max(d, 0.0) + 8.0)).rgb - background : vec3(0.0);
    vec3 glow = (tint * strength + behind * 4.0 * written) * line + HEAD * trace * line;
    float a = clamp(max(edge * 0.85, (1.0 - smoothstep(0.0, 1.0, x)) * min(strength + trace, 1.0)), 0.0, 1.0);
    return vec4((background + behind) * edge * 0.85 + glow, a) * windowAlpha(i);
}
