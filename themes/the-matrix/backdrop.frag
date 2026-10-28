// The Matrix: the code. Columns of glyphs rain down the black screen in three
// depths, nearer columns larger, brighter and faster, each lit by a falling
// white-hot head that leaves a fading phosphor tail. The rain parts round the
// windows: behind the glass it falls dim, drops flare where they strike a
// window's top edge, and streams run down its sides, brightest beside the
// focused window. The gaps between windows glow faintly green.

const vec3 HEAD = vec3(0.78, 1.0, 0.84);
// Periods (seconds) a drop takes to fall one repeat, four to a depth from the
// nearest, slower further back; each divides 3600.
const float PERIODS[6] = float[](3.0, 4.0, 5.0, 6.0, 8.0, 10.0);

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 5.0));
}

// Whether stroke `i` of the glyph `seed` is drawn: about a third of them are,
// and the top bar more often, as in the film's half-width kana.
float stroke(vec2 seed, float i, float chance) {
    return step(1.0 - chance, hash(seed + vec2(i * 1.618, i * 0.731)));
}

// A glyph, drawn without a font: strokes between the nodes of a 3 by 3
// lattice in a box `box` pixels big (the horizontals, the verticals and a
// diagonal in each quarter), picked by hashed bits. `q` is the point in the
// box in pixels, `w` the stroke's half width. Only the three strokes nearest
// the point are tested.
float glyph(vec2 q, vec2 box, vec2 seed, float w) {
    vec2 s = box * 0.5;
    float r = clamp(floor(q.y / s.y + 0.5), 0.0, 2.0);
    float c = clamp(floor(q.x / s.x), 0.0, 1.0);
    float k = clamp(floor(q.x / s.x + 0.5), 0.0, 2.0);
    float rr = clamp(floor(q.y / s.y), 0.0, 1.0);
    float ink = 0.0;
    ink = max(ink, stroke(seed, r * 2.0 + c, r == 0.0 ? 0.6 : 0.3) * (1.0 - smoothstep(w - 0.5, w + 0.5, abs(q.y - r * s.y))));
    ink = max(ink, stroke(seed, 6.0 + k * 2.0 + rr, 0.32) * (1.0 - smoothstep(w - 0.5, w + 0.5, abs(q.x - k * s.x))));
    vec2 l = q - vec2(c, rr) * s;
    float quarter = c + rr * 2.0;
    float down = stroke(seed, 16.0 + quarter, 0.5);
    float d = abs(l.x * s.y - (down > 0.5 ? l.y * s.x : s.x * s.y - l.y * s.x)) / length(s);
    ink = max(ink, stroke(seed, 12.0 + quarter, 0.22) * (1.0 - smoothstep(w - 0.5, w + 0.5, d)));
    return ink;
}

// One column's light at height y: a head falls a repeat of `span` pixels
// every `period` seconds, lighting cell after cell, and the cells behind it
// fade out over `tail` pixels, leaving the rest of the repeat black. Measured
// at the cell's middle, so the light steps from glyph to glyph as it does on
// the film's screens. Returns the light and, in y, how much of it is the head.
vec2 drops(float y, float cellH, float span, float period, float phase, float tail) {
    float mid = (floor(y / cellH) + 0.5) * cellH;
    float behind = fract(cycle(period) + phase - mid / span) * span;
    float fade = max(1.0 - behind / tail, 0.0);
    return vec2(fade * fade * (0.35 + 0.65 * fade), 1.0 - step(cellH, behind));
}

// One column of glyph cells `cell` pixels big, at `at` in cells (x across
// the column, y down it), with its drops. Returns the light in the tail, the
// light in the head and the column's soft glow, which falls to nothing at the
// column's sides.
vec3 column(vec2 at, vec2 cell, float id, float span, float period, float phase, float tail) {
    vec2 lit = drops(at.y * cell.y, cell.y, span, period, phase, tail);
    float across = 1.0 - abs(fract(at.x) - 0.5) * 2.0;
    float glow = lit.x * across * across;
    if (lit.x < 0.01) return vec3(0.0, 0.0, glow);
    // A few glyphs flicker to new ones twice a second.
    vec2 seed = vec2(id, floor(at.y));
    float f = hash(seed + 0.5);
    seed += step(0.9, f) * floor(cycle(30.0) * 60.0 + f * 7.0) * 13.7;
    vec2 box = cell * vec2(0.62, 0.7);
    vec2 q = (fract(at) - 0.5) * cell + box * 0.5;
    float inBox = step(0.0, min(q.x, q.y)) * step(max(q.x - box.x, q.y - box.y), 0.0);
    float ink = glyph(q, box, seed, cell.x * 0.06 + 0.25) * inBox;
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

// One depth of rain over the whole screen; `layer` 0 is the nearest.
vec3 rain(vec2 px, vec4 depth, float layer) {
    vec2 at = px / depth.xy + vec2(layer * 0.37, 0.0);
    float id = floor(at.x);
    vec4 d = drop(id, layer, depth.z, depth.w);
    if (d.x == 0.0) return vec3(0.0);
    return column(at, depth.xy, id * 3.1 + layer * 101.0, d.y, d.x, d.z, d.w);
}

vec4 backdrop(vec2 px) {
    vec3 green = accent;

    // The window nearest this point, and the light pooled in the gaps.
    float nearest = FAR;
    int closest = -1;
    float near = 0.0;
    for (int i = 0; i < windowCount; i++) {
        float d = windowDistance(px, i);
        near += exp(-max(d, 0.0) / 60.0);
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    near = clamp(near, 0.0, 1.0);
    float nearFocus = exp(-max(focusedWindow(px), 0.0) / 160.0);

    // Three depths: far columns small, dim and slow; near ones large and fast.
    vec3 far = rain(px, FAR_RAIN, 2.0);
    vec3 mid = rain(px, MID_RAIN, 1.0);
    vec3 close = rain(px, NEAR_RAIN, 0.0);
    // The far rain is cooler and dimmer, as if seen through more air; the
    // heads are white-hot at every depth.
    vec3 code = green * vec3(0.55, 0.75, 0.7) * (far.x * 0.3 + far.z * 0.04)
        + green * (mid.x * 0.62 + mid.z * 0.06)
        + green * (close.x * 1.0 + close.z * 0.1)
        + HEAD * (far.y * 0.4 + mid.y * 0.9 + close.y * 1.6);

    // Behind the glass the rain falls dim and calm; out in the open it is
    // brighter, and brightest round the focused window.
    float open = 1.0 - inside;
    vec3 light = code * mix(0.18, 1.0 + 0.6 * nearFocus, open);

    // The rain parts round the windows: drops flare where they strike a
    // window's top edge, and streams run down its sides.
    if (closest >= 0 && nearest > 0.0 && nearest < 40.0) {
        vec4 rect = windowRect(closest);
        float fade = windowAlpha(closest);
        float focus = closest == focusedIndex ? 1.0 : 0.45;
        float side = max(rect.x - px.x, px.x - rect.x - rect.z);
        float over = rect.y - px.y;
        if (side > 0.0 && px.y > rect.y - 20.0 && px.y < rect.y + rect.w + 20.0) {
            // Two columns of glyphs hugging the side, anchored to the window
            // so they travel with it, falling faster than the open rain.
            vec2 cell = vec2(13.0, 18.0);
            vec2 at = vec2(side / cell.x, (px.y - rect.y) / cell.y);
            float id = floor(at.x) + float(closest) * 7.0 + (px.x < rect.x ? 0.0 : 3.0);
            // Each runs most of its repeat lit, so the side reads as one
            // stream; the open rain thins where it runs, diverted into it.
            float band = step(at.x, 2.0);
            float period = 2.0 + floor(hash(vec2(id, 91.0)) * 3.0);
            vec3 stream = column(at, cell, id * 5.3, 960.0, period, hash(vec2(id, 93.0)), 700.0) * band;
            light *= 1.0 - 0.6 * band * fade;
            light += (green * (stream.x * 1.3 + stream.z * 0.14) + HEAD * stream.y * 1.8) * focus * fade;
        }
        if (over > 0.0 && px.x > rect.x && px.x < rect.x + rect.z) {
            // Where a near column's head reaches the top edge, it flares and
            // the edge holds a little of its light as the tail goes by.
            float at = px.x / NEAR_RAIN.x;
            vec4 d = drop(floor(at), 0.0, NEAR_RAIN.z, NEAR_RAIN.w);
            if (d.x > 0.0) {
                vec2 lit = drops(rect.y - 1.0, NEAR_RAIN.y, d.y, d.x, d.z, d.w);
                float splash = (lit.y * 1.5 + lit.x * lit.x * 0.4) * exp(-over / 5.0)
                    * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 8.0);
                light += mix(green, HEAD, 0.6) * splash * (0.6 + focus) * fade;
            }
        }
    }

    // The gaps between windows glow faintly green.
    light += green * near * open * 0.07;

    // The bar's lower edge: a phosphor line with a drip of brighter light
    // running along it, and the rain dimmed under the bar so its text reads.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light *= mix(1.0, 0.3, step(below, 0.0));
        light += green * glowLine(abs(below), 1.0) * 0.45;
        float drip = cycle(9.0) * (resolution.x + 600.0) - 300.0;
        float behind = drip - px.x;
        float trail = behind > 0.0 ? exp(-behind / 260.0) : exp(behind / 6.0);
        light += mix(green, HEAD, 0.6) * trail * glowLine(abs(below), 1.6) * 1.4;
        light += green * 0.03 * step(below, 0.0);
    }

    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}
