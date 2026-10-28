// Jarvis: a holographic globe in a gyroscope of rings, turning behind the
// focused window and sized to it. It glows through the glass and past the
// window's edges; light pools in the seams between windows and wakes the hex
// lattice near them; dust drifts through the beam.

const vec3 AMBER = vec3(1.0, 0.70, 0.28);

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.28 * exp(-d / (w * 5.0));
}

// `count` dashes around a ring of radius `r` at angle `a`, `duty` of each lit,
// turned by `turn`. The edge is softened by the size of a pixel at that radius.
float dashes(float a, float r, float count, float duty, float turn) {
    float f = fract(a / TAU * count + turn);
    float aa = count / (TAU * max(r, 1.0)) * 1.5;
    return smoothstep(0.0, aa, f) * (1.0 - smoothstep(duty, duty + aa, f));
}

// Dots on a hexagonal lattice, `size` pixels apart.
float hexDots(vec2 px, float size) {
    vec2 p = px / size;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    return 1.0 - smoothstep(0.03, 0.075, length(g));
}

// Dust: a mote in some cells of a grid that rises a cell every 10 seconds.
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
    return (1.0 - smoothstep(0.0, 0.06, length(fract(p) - at))) * twinkle;
}

// The globe: latitude and longitude every 15 degrees on a sphere of radius
// `R`, tilted toward the viewer and turning once a minute. The far side shows
// faintly through the near one. `rim` is the glow at its edge.
float globe(vec2 p, float R, out float rim) {
    vec2 q = p / R;
    float q2 = dot(q, q);
    rim = 0.0;
    if (q2 > 1.0) return 0.0;
    float z = sqrt(1.0 - q2);
    rim = pow(1.0 - z, 3.0);
    float spin = cycle(60.0) * TAU;
    float ct = cos(0.4), st = sin(0.4);
    float step_ = TAU / 24.0;
    float lines = 0.0;
    for (int side = 0; side < 2; side++) {
        vec3 P = vec3(q.x, q.y, side == 0 ? z : -z);
        P = vec3(P.x, P.y * ct - P.z * st, P.y * st + P.z * ct);
        float lon = atan(P.x, P.z) + spin;
        float lat = asin(clamp(P.y, -1.0, 1.0));
        float dLat = abs(fract(lat / step_ + 0.5) - 0.5) * step_;
        float dLon = abs(fract(lon / step_ + 0.5) - 0.5) * step_ * cos(lat);
        // Lines crowd toward the edge, where the surface turns away.
        float d = min(dLat, dLon) * R * max(z, 0.15);
        lines += glowLine(d, 0.9) * (side == 0 ? 1.0 : 0.22);
    }
    return lines;
}

// A ring of radius `R` tipped `tilt` out of the screen and turned `yaw` in it.
// Returns the distance to it in pixels; `angle` is the angle around the ring,
// and `depth` is above zero on the half nearer the viewer.
float gyro(vec2 p, float R, float tilt, float yaw, out float angle, out float depth) {
    float cy = cos(yaw), sy = sin(yaw);
    vec2 r = vec2(cy * p.x + sy * p.y, -sy * p.x + cy * p.y);
    float ct = max(abs(cos(tilt)), 0.12);
    vec2 e = vec2(r.x, r.y / ct);
    angle = atan(e.y, e.x);
    depth = sin(angle) * sin(tilt);
    float len = max(length(e), 1e-3);
    float grad = length(vec2(e.x, e.y / ct)) / len;
    return abs(len - R) / max(grad, 1e-3);
}

vec4 backdrop(vec2 px) {
    float edge = nearestWindow(px);
    float inside = 1.0 - smoothstep(-1.0, 1.0, edge);
    float near = clamp(windowGlow(px, 110.0), 0.0, 1.0);
    float focusEdge = focusedWindow(px);
    float nearFocus = exp(-max(focusEdge, 0.0) / 140.0);
    float gap = near * (1.0 - inside);

    vec3 cyan = accent;

    // Everything is centred on the focused window and sized to it.
    vec2 c = focused.xy + focused.zw * 0.5;
    float reach = length(focused.zw) * 0.5;
    vec2 p = px - c;
    float r = length(p);
    float a = atan(p.y, p.x);
    float Rg = reach * 0.45;

    // Deep navy, lifted around the globe and darker toward the corners.
    vec3 base = background * (0.55 + 0.6 * exp(-r / (reach * 1.8)));
    vec3 light = vec3(0.0);

    light += cyan * hexDots(px, 26.0) * (0.03 + 0.3 * near);

    float rim;
    float g = globe(p, Rg, rim);
    light += cyan * (g * 0.5 + rim * 0.35);
    light += cyan * 0.1 * exp(-max(r - Rg, 0.0) / (Rg * 0.12)) * step(Rg, r);

    // The gyroscope: three rings tumbling about the globe, slowly and at
    // different rates. The far half of each ring is dim, and dimmer still
    // where the globe stands in front of it.
    // Only pixels near the gyroscope pay for it.
    for (int i = 0; i < (r < Rg * 1.75 ? 3 : 0); i++) {
        float fi = float(i);
        float tilt = 1.0 + 0.3 * sin(TAU * cycle(30.0 * (fi + 2.0)) + fi * 1.7);
        float yaw = TAU * cycle(40.0 * (fi + 1.0)) * (i == 1 ? -1.0 : 1.0) + fi * 2.1;
        float R = Rg * (1.22 + 0.2 * fi);
        float angle, depth;
        float d = gyro(p, R, tilt, yaw, angle, depth);
        float shade = depth >= 0.0 ? 1.0 : (r < Rg ? 0.12 : 0.4);
        light += cyan * glowLine(d, 1.3) * shade * 0.75;
        light += cyan * glowLine(d, 4.0) * dashes(angle, R, 12.0, 0.18, cycle(20.0)) * shade * 0.35;
    }

    // Flat rings in the screen's plane, out past the window's edges.
    light += cyan * glowLine(abs(r - reach * 1.04), 1.0) * dashes(a, r, 120.0, 0.45, -cycle(120.0)) * 0.5;
    light += cyan * glowLine(abs(r - reach * 1.12), 6.0) * dashes(a, r, 6.0, 0.06, cycle(24.0)) * 0.5;
    light += AMBER * glowLine(abs(r - reach * 1.12), 2.0) * dashes(a, r, 1.0, 0.05, -cycle(24.0)) * 0.9;
    light += cyan * glowLine(abs(r - reach * 1.24), 0.8) * 0.3;

    // Light pools in the seams between windows and runs along them.
    if (gap > 0.004) {
        vec2 q = px * 0.0055;
        float flow = noise(q * 2.0 + orbit(60.0, 4.0)) * noise(q * 5.0 - orbit(40.0, 3.0));
        light += cyan * gap * (0.1 + 1.1 * flow);
    }
    light += mix(cyan, AMBER, 0.35) * nearFocus * (1.0 - inside) * 0.12;

    light += mix(cyan, vec3(1.0), 0.5) * motes(px) * (0.2 + 0.5 * near);

    // Bright light saturates toward white, as it does on film.
    return vec4(base + (1.0 - exp(-light * 1.4)), 1.0);
}
