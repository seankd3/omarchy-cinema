// Evangelion: NERV's displays. A honeycomb of hexagonal cells lies across
// the dark and wakes like an AT field around the windows: cells light orange
// along every window's edge and in the seams between windows, brightest at
// the focused window, and octagonal rings ripple out from the focused window,
// lighting the cells they pass. Far behind, a larger lattice in Unit-01's
// purple shifts against it as focus moves, for depth.

const vec3 RED = vec3(1.0, 0.16, 0.08);
const vec3 PURPLE = vec3(0.40, 0.20, 0.85);
const vec3 GREEN = vec3(0.55, 0.92, 0.22);
const float CELL = 28.0; // honeycomb spacing in pixels: two cells span a gap

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 5.0));
}

// The flat-topped hexagon of a honeycomb `size` pixels apart that holds px:
// its centre (xy) and how far px is inside its edge (z), in pixels.
vec3 hexCell(vec2 px, float size) {
    vec2 p = px.yx / size;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float inside = 0.5 - max(abs(g.x), dot(abs(g), vec2(0.5, 0.8660254)));
    return vec3((p - g).yx * size, inside * size);
}

// Distance from a centre whose level lines are regular octagons, the shape
// of an AT field.
float octagon(vec2 p) {
    p = abs(p);
    return max(max(p.x, p.y), (p.x + p.y) * 0.70710678);
}

vec4 backdrop(vec2 px) {
    vec3 orange = accent;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearestWindow(px));
    // Behind a window's glass, and the bar's, only a trace of the light shows.
    float veil = mix(1.0, 0.14, max(inside, step(px.y, reserved.x)));
    vec2 centre = focused.xy + focused.zw * 0.5;
    vec3 light = vec3(0.0);

    // Far behind: slow purple haze and a lattice three times the size, offset
    // against the focused window so it reads as deeper than the near one.
    float haze = noise(px * 0.0016 + orbit(180.0, 1.5)) * noise(px * 0.0045 - orbit(120.0, 2.0));
    vec3 far = hexCell(px + (centre - resolution * 0.5) * 0.05, CELL * 3.0);
    light += PURPLE * 0.1 * haze * haze;
    light += PURPLE * glowLine(far.z, 1.0) * (0.015 + 0.25 * haze) * veil;

    // How awake this pixel's cell is, judged at the cell's centre so whole
    // cells light: near any window's edge (inside or out, so seams between
    // windows add up) and most near the focused one.
    vec3 cell = hexCell(px, CELL);
    float wake = 0.0;
    for (int i = 0; i < windowCount; i++) wake += 0.6 * exp(-abs(windowDistance(cell.xy, i)) / 28.0);
    float toFocus = abs(focusedWindow(cell.xy));
    wake += 2.0 * exp(-toFocus / 40.0) + 0.35 * exp(-toFocus / 500.0);

    // An octagonal ring leaves the focused window's centre every six seconds
    // and spreads for twelve, orange turning to red as it fades, a faint wash
    // behind its front. The cells it crosses light up. (A ring every two
    // seconds, twice as fast, kept the whole field moving: too busy to live
    // with all day.)
    float ringCell = octagon(cell.xy - centre);
    float ringPx = octagon(px - centre);
    float ripple = 0.0;
    vec3 rings = vec3(0.0);
    for (int k = 0; k < 2; k++) {
        float f = fract(cycle(12.0) + float(k) * 0.5);
        float r = f * 1800.0;
        float fade = (1.0 - f) * smoothstep(0.0, 0.05, f);
        float behind = r - ringPx;
        ripple += exp(-abs(ringCell - r) / 36.0) * fade;
        rings += mix(orange, RED, f) * (glowLine(abs(behind), 1.4) + 0.2 * exp(-behind / 40.0) * step(0.0, behind)) * fade;
    }
    light += rings * 1.3 * veil;

    // Each cell is a tile with a bright rim and a dark seam to its
    // neighbours. Awake cells glow steadily and swell together in broad
    // patches that drift slowly, so the field breathes instead of glittering
    // cell by cell; a few burn Unit-01 green.
    float seed = hash(cell.xy * 0.0137 + 0.31);
    float swell = smoothstep(0.25, 0.75, noise(cell.xy * 0.006 + orbit(30.0, 1.2)));
    float lit = min(wake, 2.5) * (0.5 + 0.7 * swell) + ripple * 1.6;
    vec3 tint = seed > 0.97 ? GREEN * 0.7 : orange;
    float tile = smoothstep(2.0, 3.5, cell.z);
    float rim = glowLine(abs(cell.z - 3.0), 0.9);
    light += orange * glowLine(cell.z, 0.8) * 0.035;
    light += tint * (tile * 0.06 + rim * 0.3) * lit * veil;

    // The bar's lower edge: an orange line, and under it a strip of hazard
    // stripes that crawls along, lit where a bright run sweeps across.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light += orange * glowLine(abs(below), 1.1) * 0.8;
        float stripe = abs(fract((px.x + below - cycle(3.0) * 54.0) / 18.0) - 0.5);
        float hazard = smoothstep(0.22, 0.26, stripe) * smoothstep(3.5, 4.5, below) * (1.0 - smoothstep(9.5, 10.5, below));
        // The run starts and ends well off screen, so its wrap never shows.
        float run = exp(-abs(px.x + 900.0 - cycle(9.0) * (resolution.x + 1800.0)) / 260.0);
        light += mix(orange, RED, 0.35) * hazard * (0.12 + 1.4 * run);
        light += orange * 0.05 * step(px.y, reserved.x);
    }

    // Bright light saturates toward white, as it does on film.
    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}
