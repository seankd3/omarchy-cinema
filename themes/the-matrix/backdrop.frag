// omarchy-cinema contract 14
// The Matrix: the code, and the code is this very shader, or what the agents
// on this machine are writing once the user turns that on
// (specs/agent-rain.md). It rains down the black screen in mirrored glyphs,
// each stream led by a white-hot head carrying the newest characters and
// leaving a fading phosphor tail. The rain stands at three
// distances, nearer columns larger, brighter and faster: the far rain out of
// focus, soft dots whose letters are lost in the air, and the mid rain, both
// behind the windows, so the glass shows them and the windows shade them;
// the near rain at the windows' own depth, falling round them, so it never
// shows through their glass and no window shades it. The rain parts round
// the windows: drops flare where they strike a window's top edge, and streams run down its sides, brightest beside the
// focused window. The gaps between windows glow faintly green. The windows
// stand in the rain, lit from above with it (specs/depth.md).

const vec3 HEAD = vec3(0.78, 1.0, 0.84);
// Where the light comes from: above, with the rain, a little to the right.
const vec2 LIGHT = vec2(0.12, -0.99);
// Periods (seconds) a drop takes to fall one repeat, four to a depth from the
// nearest, slower further back; each divides 3600. Near drops average about
// 340 px a second, mid 210 and far 130: a screen in four seconds up close,
// the film's pace and calm enough to work beside (twice that read as busy at
// 120 fps).
const float PERIODS[6] = float[](6.0, 8.0, 10.0, 12.0, 16.0, 20.0);

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

// How much of character `code` covers the glyph cell, `cell` pixels big, at
// `at` (in cells).
float inCell(vec2 at, vec2 cell, int code) {
    vec2 box = cell * vec2(0.62, 0.7);
    vec2 q = (fract(at) - 0.5) * cell + box * 0.5;
    float inBox = step(0.0, min(q.x, q.y)) * step(max(q.x - box.x, q.y - box.y), 0.0);
    return glyph(code, q / box) * inBox;
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
    // Each stream carries its own stretch of the text, the newest of
    // it at the head and older characters up its tail, so the text falls
    // with the drop.
    int start = int(hash(vec2(id, 3.3)) * float(feedCount));
    float ink = inCell(at, cell, feedChar(start + int(lit.z)));
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

// The same depth seen out of focus: each glyph a soft dot of its light, the
// letters lost. The tail's light (x) and the head's (y).
vec2 blurred(vec2 px, vec4 depth, float layer, float shift) {
    vec2 at = vec2(px.x + shift, px.y) / depth.xy + vec2(layer * 0.37, 0.0);
    vec4 d = drop(floor(at.x), layer, depth.z, depth.w);
    if (d.x == 0.0) return vec2(0.0);
    vec2 c = 1.0 - abs(fract(at) - 0.5) * 2.0;
    return drops(px.y, depth.y, d.y, d.x, d.z, d.w).xy * c.x * c.y;
}

// The near rain's glyph cell holding px, its columns shifted `shift` across:
// the cell's middle on the screen, so a burst lights glyph by glyph.
vec2 nearCell(vec2 px, float shift) {
    return (floor(vec2(px.x + shift, px.y) / NEAR_RAIN.xy) + 0.5) * NEAR_RAIN.xy - vec2(shift, 0.0);
}

// How much of a character of the agents' text covers px in that cell.
float nearInk(vec2 px, float shift) {
    vec2 at = vec2(px.x + shift, px.y) / NEAR_RAIN.xy;
    return inCell(at, NEAR_RAIN.xy, feedChar(int(hash(floor(at) + 7.7) * float(feedCount))));
}

// The rain answering what happened, at px, whose near glyph cell is centred
// at `cell`: a glow of its own (x), how much brighter the rain there is (y),
// and the glyphs a landing bursts, their light (z) and how white-hot (w).
vec4 answers(vec2 px, vec2 cell) {
    vec4 a = vec4(0.0);
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (kind == LAND) {
            // Glyphs burst out from the window's edge in a ring, white-hot at
            // its front, harder the faster it came, with a broad wave of light
            // under it that carries through the glass; brief, then calm.
            vec4 r = impulseRect(k);
            float d = rectDistance(px, r, 0.0);
            float reach = age * 1000.0;
            if (d < -2.0 || abs(d - reach) > 200.0) continue;
            float fade = exp(-age * 2.8) * (1.0 - smoothstep(0.7, 1.1, age)) * (0.5 + 0.7 * e.w);
            float dc = rectDistance(cell, r, 0.0);
            a += vec4(0.35 * exp(-abs(d - reach) / 70.0), 0.8 * exp(-abs(d - reach) / 45.0),
                      2.4 * exp(-abs(dc - reach) / 30.0), 2.0 * exp(-abs(dc - reach) / 14.0) * step(age, 0.6)) * fade;
        } else if (kind == OPEN || kind == FOCUS) {
            // The rain round the window brightens for a moment.
            if (age > 1.0) continue;
            float d = rectDistance(px, impulseRect(k), 0.0);
            if (d < -2.0 || d > 200.0) continue;
            float near = exp(-max(d, 0.0) / 50.0) * smoothstep(0.0, 0.15, age) * exp(-age * 3.0) * (kind == OPEN ? 1.0 : e.w);
            a.xy += vec2(0.08, 0.6) * near;
        } else if (kind == CLOSE) {
            // Where the window was, a glow that fades.
            if (age > 0.8) continue;
            a.xy += vec2(0.06, 0.4) * exp(-length(px - e.xy) / 250.0) * smoothstep(0.0, 0.1, age) * (1.0 - age / 0.8);
        }
    }
    return a;
}


vec4 backdrop(vec2 px) {
    vec3 green = accent;

    // The windows at px: the nearest, the focused, the topmost whose glass px
    // is behind, the light pooled in the gaps, and the shelter each gives the
    // rain below it, deeper and softer the more focus lifts it. A moving
    // window drags the columns beside it along, bending them, and leaves a
    // bright wake where it has just been.
    Seen seen = UNSEEN;
    float near = 0.0, shadow = 0.0, pull = 0.0, wake = 0.0;
    uint reached = windowsAt(px);
    for (int i = 0; i < windowCount; i++) {
        if (!reaches(reached, i)) continue;
        Window w = window(px, i);
        see(seen, w);
        float d = w.d;
        near += exp(-max(d, 0.0) / 60.0);
        float soft = 18.0 + 40.0 * w.lift;
        float s = rectDistance(px + LIGHT * (26.0 + 46.0 * w.lift), w.rect, w.rounding);
        shadow = max(shadow, (1.0 - smoothstep(-soft, soft, s)) * w.alpha);
        vec2 v = w.velocity;
        float speed = length(v);
        if (speed < 40.0) continue;
        float pace = min(speed / 1500.0, 1.0) * w.alpha;
        pull -= v.x * 0.02 * exp(-max(d, 0.0) / 80.0) * pace;
        // The wake, 0.8 exp(-d / 30) of the rain's light, only within its
        // reach of where the window was in the last 0.14 s (its last ghost's lag).
        if (d < 0.0 || edgeDistance(w) > glowReach(0.8, 30.0) + speed * 0.14) continue;
        for (int k = 1; k <= 4; k++) {
            wake = max(wake, exp(-max(rectDistance(px, ago(w, 0.035 * float(k)), w.rounding), 0.0) / 30.0) * (1.0 - 0.2 * float(k)) * pace);
        }
    }
    float nearest = seen.nearest;
    int closest = seen.closest;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    float open = 1.0 - inside;
    near = clamp(near, 0.0, 1.0);
    float nearFocus = exp(-max(seen.focus, 0.0) / 160.0);

    // A dragged window moves the viewpoint, so the near columns shift a few
    // pixels more than the far ones.
    float shift = focusVelocity().x * 0.003 + pull;

    // Three distances: far columns small, slow and out of focus; near ones
    // large and fast, at the windows' depth, so never behind their glass.
    vec2 far = blurred(px, FAR_RAIN, 2.0, shift * 0.2);
    vec3 mid = rain(px, MID_RAIN, 1.0, shift * 0.5), close = vec3(0.0);
    if (open > 0.0) close = rain(px, NEAR_RAIN, 0.0, shift) * open;
    // The far rain is cooler and dimmer, as if seen through more air; the
    // heads are white-hot at every depth.
    vec3 behind = green * vec3(0.55, 0.75, 0.7) * (far.x * 0.3 + far.y * 0.35)
        + green * (mid.x * 0.62 + mid.z * 0.06) + HEAD * mid.y * 0.9;
    vec3 front = green * (close.x * 1.0 + close.z * 0.1) + HEAD * close.y * 1.6;

    // Out in the open the rain is brightest round the focused window, in a
    // moving window's wake, where something just happened and as you speak;
    // the rain behind the windows is sheltered below them.
    vec4 answer = answers(px, nearCell(px, shift));
    float shade = 1.0 - 0.75 * shadow;
    float lit = (1.0 + 0.6 * nearFocus) * (1.0 + 2.5 * wake + answer.y + 0.3 * voice);
    vec3 light = behind * mix(1.0, lit * shade, open) + front * lit;
    light += green * 0.16 * wake * open;

    // The rain parts round the windows: drops flare where they strike a
    // window's top edge, and streams run down its sides.
    if (closest >= 0 && nearest > 0.0 && nearest < 40.0) {
        Window c = window(px, closest);
        vec4 rect = c.rect;
        float fade = c.alpha;
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
            light += (green * (stream.x * 1.3 + stream.z * 0.14) + HEAD * stream.y * 1.8) * focus * fade;
        }
        if (over > 0.0 && px.x > rect.x && px.x < rect.x + rect.z) {
            // Where a near column's head reaches the top edge, it flares and
            // the edge holds a little of its light as the tail goes by.
            float at = (px.x + shift) / NEAR_RAIN.x;
            vec4 d = drop(floor(at), 0.0, NEAR_RAIN.z, NEAR_RAIN.w);
            if (d.x > 0.0) {
                vec3 lit = drops(rect.y - 1.0, NEAR_RAIN.y, d.y, d.x, d.z, d.w);
                float splash = (lit.y * 1.5 + lit.x * lit.x * 0.4) * exp(-over / 5.0)
                    * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 8.0);
                light += mix(green, HEAD, 0.6) * splash * (0.6 + focus) * fade;
            }
        }
    }

    // The answers' own glow, and a landing's glyphs, read only where a
    // landing reaches.
    float ink = answer.z > 0.0 && feedCount > 0 ? nearInk(px, shift) : 0.0;
    light += green * answer.x + (green * answer.z * 1.2 + HEAD * min(answer.w, 2.0) * 1.4) * ink;

    // The gaps between windows glow faintly green, a little more as you
    // speak, and less in the windows' shelter.
    light += green * near * open * (0.07 + 0.03 * voice) * (0.5 + 0.5 * shade);

    // The rain's light on the glass: a glow along the upper glass, where the
    // rain comes from, and a soft diagonal streak that slides across the pane
    // as the window moves, as a reflection does. Only the glass shows it.
    int pane = seen.over;
    if (pane >= 0) {
        Window o = window(px, pane);
        vec4 r = o.rect;
        vec2 at = px - r.xy;
        float band = glassStreak(px, r);
        light += HEAD * (0.05 * exp(-at.y / 60.0) + 0.035 * band) * o.alpha;
    }

    // The bar's lower edge: a phosphor line with a drip of brighter light
    // running along it, and the rain dimmed under the bar so its text reads.
    float below;
    if (atBar(px, below)) {
        light *= mix(1.0, 0.3, step(below, 0.0));
        light += green * glowLine(abs(below), 1.0) * (0.45 + 0.15 * voice);
        float drip = cycle(9.0) * (resolution.x + 600.0) - 300.0;
        float behind = drip - px.x;
        float trail = behind > 0.0 ? exp(-behind / 260.0) : exp(behind / 6.0);
        light += mix(green, HEAD, 0.6) * trail * glowLine(abs(below), 1.6) * 1.4;
        light += green * 0.03 * step(below, 0.0);
    }

    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a phosphor line, a crisp
// core in its own bloom, brightest along the top where the rain falls from
// and as focus lifts it, flaring when the window lands and brightening softly
// for a moment when it opens or takes focus. The glass's outer pixels show the rain bent
// from behind it, and that light catches on the line, so a drop passing
// behind the glass lights the edge. Its light stays within a few pixels, so
// it never lies over the text of a window beneath.
vec4 frame(vec2 px, Window w) {
    float d = edgeDistance(w);
    if (d < -2.0 || d > 48.0) return vec4(0.0);
    vec2 n = edgeNormal(px, w.rect, w.rounding);
    bool focus = w.i == focusedIndex;
    float lift = w.lift;

    // What just happened to this window, all over within a second.
    float flare = windowFlare(w.i, 2.0);

    float toward = 0.55 + 0.45 * clamp(dot(n, -LIGHT), 0.0, 1.0);
    float strength = (focus ? 0.9 + 0.6 * lift : 0.45) * toward * (1.0 + flare);
    float x = abs(d - 0.5);
    float line = (1.0 - smoothstep(0.0, 1.0, x)) + 0.35 * exp(-x / 2.5);
    vec3 tint = focus ? mix(accent, HEAD, 0.35) : accent * 0.6;

    // The rain just behind the glass's edge, seen bent through its outer
    // pixels and caught by the line.
    float edge = glassSide(d, 6.0);
    vec3 behind = d < 10.0 ? worldAt(px - n * (max(d, 0.0) + 8.0)).rgb - background : vec3(0.0);
    vec3 glow = (tint * strength + behind * 4.0) * line;
    float a = clamp(max(edge * 0.85, (1.0 - smoothstep(0.0, 1.0, x)) * min(strength, 1.0)), 0.0, 1.0);
    return vec4((background + behind) * edge * 0.85 + glow, a);
}
