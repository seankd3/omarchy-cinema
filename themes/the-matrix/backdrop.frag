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

const vec3 HEAD = vec3(0.78, 1.0, 0.84);
// The brightest the rain is behind the glass. colors.toml's muted (#5c9a6c)
// keeps 4.5:1 over a background of relative luminance 0.0199 or less; glass
// 0.2 over #020804 with Omarchy's 0.75 blur brightness stays under that while
// the rain behind is at most 0.19 in every channel.
const float UNDER_GLASS = 0.19;
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
    // No agents, no rain.
    vec3 far = vec3(0.0), mid = vec3(0.0), close = vec3(0.0);
    if (feedPresence > 0.0) {
        far = rain(px, FAR_RAIN, 2.0) * feedPresence;
        mid = rain(px, MID_RAIN, 1.0) * feedPresence;
        close = rain(px, NEAR_RAIN, 0.0) * feedPresence;
    }
    // The far rain is cooler and dimmer, as if seen through more air; the
    // heads are white-hot at every depth.
    vec3 code = green * vec3(0.55, 0.75, 0.7) * (far.x * 0.3 + far.z * 0.04)
        + green * (mid.x * 0.62 + mid.z * 0.06)
        + green * (close.x * 1.0 + close.z * 0.1)
        + HEAD * (far.y * 0.4 + mid.y * 0.9 + close.y * 1.6);

    // Behind the glass the rain keeps its shape but not its glare: no channel
    // goes over UNDER_GLASS, so a drop passing behind secondary text never
    // takes it under 4.5:1 (Sol, 2026-10-28). Out in the open it is brightest
    // round the focused window.
    float open = 1.0 - inside;
    float peak = max(code.r, max(code.g, code.b));
    vec3 light = mix(code * min(1.0, UNDER_GLASS / max(peak, 1e-4)), code * (1.0 + 0.6 * nearFocus), open);

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
            float at = px.x / NEAR_RAIN.x;
            vec4 d = drop(floor(at), 0.0, NEAR_RAIN.z, NEAR_RAIN.w);
            if (d.x > 0.0) {
                vec3 lit = drops(rect.y - 1.0, NEAR_RAIN.y, d.y, d.x, d.z, d.w);
                float splash = (lit.y * 1.5 + lit.x * lit.x * 0.4) * exp(-over / 5.0)
                    * exp(-abs(fract(at) - 0.5) * NEAR_RAIN.x / 8.0);
                light += mix(green, HEAD, 0.6) * splash * (0.6 + focus) * fade * feedPresence;
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
