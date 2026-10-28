// Jarvis: an arc reactor turning behind the focused window. Its rings circle
// the window, showing in the gaps and through the glass; its light pools in the
// seams between windows and lights the hex lattice near them; dust drifts
// through the beam.

const vec3 AMBER = vec3(1.0, 0.70, 0.28);

// A thin line at `radius`, `width` pixels wide.
float ring(float r, float radius, float width) {
    return smoothstep(width, 0.0, abs(r - radius));
}

// `count` dashes around a ring, `duty` of each lit, turned by `turn` (0 to 1).
float dashes(float a, float count, float duty, float turn) {
    float f = fract(a / TAU * count + turn);
    float aa = fwidth(f) * 1.5;
    return smoothstep(0.0, aa, f) * smoothstep(duty + aa, duty, f);
}

// Dots on a hexagonal lattice, `size` pixels apart.
float hexDots(vec2 px, float size) {
    vec2 p = px / size;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    return smoothstep(0.075, 0.03, length(g));
}

// Dust: one mote in some cells of a grid that rises a cell every 10 seconds.
// The pattern repeats every 24 cells, so the hourly wrap moves it by whole
// repeats and never shows.
float motes(vec2 px) {
    vec2 p = px / 70.0 + vec2(0.0, cycle(240.0) * 24.0);
    vec2 cell = floor(p);
    vec2 id = vec2(cell.x, mod(cell.y, 24.0));
    float seed = hash(id);
    if (seed < 0.82) return 0.0;
    vec2 at = vec2(hash(id + 7.1), hash(id + 3.7)) * 0.8 + 0.1;
    float twinkle = 0.5 + 0.5 * sin(TAU * (cycle(4.0) + seed * 9.0));
    return smoothstep(0.06, 0.0, length(fract(p) - at)) * twinkle;
}

vec4 backdrop(vec2 px) {
    vec2 uv = px / resolution;
    float inside = texture(windows, uv).r;
    vec4 h = texture(halo, uv);
    float near = clamp(h.r * 1.6, 0.0, 1.0);
    float nearFocus = clamp(h.g * 1.6, 0.0, 1.0);
    float gap = near * (1.0 - inside);

    vec3 cyan = accent.rgb;

    // The reactor sits at the focused window's centre and is sized to it.
    vec2 c = focus.xy + focus.zw * 0.5;
    float reach = length(focus.zw) * 0.5;
    vec2 d = px - c;
    float r = length(d);
    float a = atan(d.y, d.x);

    // Deep navy, lifted around the reactor and darker toward the corners.
    vec3 col = background.rgb * (0.5 + 0.7 * exp(-r / (reach * 1.8)));
    col += cyan * 0.035 * exp(-r / (reach * 0.9));

    // The lattice wakes up near the windows.
    col += cyan * hexDots(px, 26.0) * (0.04 + 0.4 * near);

    // Rings: thin full circles, dashed bands turning both ways, a tick ring.
    float rings = 0.0;
    rings += ring(r, reach * 0.62, 1.4) * 0.6;
    rings += ring(r, reach * 0.74, 5.0) * dashes(a, 3.0, 0.22, cycle(30.0)) * 0.9;
    rings += ring(r, reach * 0.86, 1.2) * 0.5;
    rings += ring(r, reach * 1.04, 2.2) * dashes(a, 48.0, 0.5, -cycle(120.0)) * 0.7;
    rings += ring(r, reach * 1.12, 9.0) * dashes(a, 6.0, 0.08, cycle(20.0)) * 0.8;
    rings += ring(r, reach * 1.22, 1.0) * 0.45;
    rings += ring(r, reach * 1.36, 3.0) * dashes(a, 2.0, 0.3, -cycle(45.0)) * 0.7;
    rings += ring(r, reach * 1.36, 14.0) * dashes(a, 180.0, 0.12, -cycle(45.0)) * 0.35;
    col += cyan * rings * (0.3 + 0.9 * near);

    // One amber arc sweeps the outer ring.
    float sweep = ring(r, reach * 1.12, 3.0) * dashes(a, 1.0, 0.05, -cycle(12.0));
    col += AMBER * sweep * 0.9;

    // Light pools in the seams between windows and runs along them.
    vec2 q = px * 0.0055;
    float flow = noise(q * 2.0 + orbit(60.0, 4.0)) * noise(q * 5.0 - orbit(40.0, 3.0));
    col += cyan * gap * (0.18 + 1.6 * flow);
    col += mix(cyan, AMBER, 0.35) * nearFocus * (1.0 - inside) * 0.18;

    // Seen through the glass, each window is a softly lit panel.
    col += cyan * inside * 0.035;

    col += mix(cyan, vec3(1.0), 0.5) * motes(px) * (0.25 + 0.6 * near);

    return vec4(col, 1.0);
}
