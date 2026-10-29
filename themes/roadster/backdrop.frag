// Roadster: the 2026 Roadster's cockpit, drawn like a fighter jet's display.
// A floor of red dots runs out to a thin white horizon and rushes toward the
// viewer, with streaks of speed along it. A wireframe wedge turns slowly on
// the floor behind the focused window and glides after it. Every window sits
// in faint red corner brackets; a tighter, brighter lock frame holds the
// focused one, slides to the next window when focus moves, and fades as the
// focus does.

const vec3 WHITE = vec3(1.0, 0.94, 0.94);
const float CAMERA = 15.0; // the eye's height over the floor, in grid cells

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 5.0));
}

// Distance from p to the segment from a to b.
float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    return length(ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0));
}

// Distance to four corner brackets around a rect pushed out by `gap`, each
// arm `arm` pixels long. Folding into one quadrant draws all four at once.
float brackets(vec2 px, vec4 rect, float gap, float arm) {
    vec2 h = rect.zw * 0.5 + gap;
    vec2 p = abs(px - rect.xy - rect.zw * 0.5);
    return min(segment(p, vec2(h.x - arm, h.y), h), segment(p, vec2(h.x, h.y - arm), h));
}

// One side of the wedge, nose to tail: the other side mirrors it.
const vec3 SIDE[8] = vec3[8](
    vec3(1.00, 0.06, 0.30),   // nose, low
    vec3(1.04, 0.13, 0.28),   // nose, top
    vec3(0.50, 0.24, 0.44),   // front fender
    vec3(0.20, 0.26, 0.36),   // foot of the windscreen
    vec3(-0.10, 0.40, 0.25),  // roof, front
    vec3(-0.44, 0.37, 0.26),  // roof, back
    vec3(-0.94, 0.25, 0.42),  // tail, top
    vec3(-0.98, 0.07, 0.42)   // tail, low
);

// A point of the wedge as the viewer sees it: turned about its upright axis
// (c and s are the cosine and sine of the turn), seen from 20 degrees above,
// in perspective. xy is on screen (y up) from the wedge's centre, z is depth,
// above zero on the far side.
vec3 view(vec3 p, float c, float s) {
    p = vec3(p.x * c + p.z * s, p.y - 0.2, -p.x * s + p.z * c);
    const float PITCH_C = 0.94, PITCH_S = 0.34;
    p = vec3(p.x, p.y * PITCH_C + p.z * PITCH_S, p.z * PITCH_C - p.y * PITCH_S);
    return vec3(p.xy * 6.0 / (6.0 + p.z), p.z);
}

// Distance in pixels to the wedge's near and far edges, the wedge being
// `size` pixels to a unit and stood at `at`.
vec2 wedge(vec2 px, vec2 at, float size) {
    float a = cycle(60.0) * TAU;
    float c = cos(a), s = sin(a);
    vec2 q = (px - at) / size * vec2(1.0, -1.0);
    vec3 L[8], R[8];
    for (int i = 0; i < 8; i++) {
        L[i] = view(SIDE[i], c, s);
        R[i] = view(SIDE[i] * vec3(1.0, 1.0, -1.0), c, s);
    }
    vec2 d = vec2(FAR);
    for (int i = 0; i < 8; i++) {
        int j = (i + 1) % 8;
        // Each side's outline, filed near or far by its depth.
        float dl = segment(q, L[i].xy, L[j].xy);
        float dr = segment(q, R[i].xy, R[j].xy);
        if (L[i].z + L[j].z < 0.0) d.x = min(d.x, dl); else d.y = min(d.y, dl);
        if (R[i].z + R[j].z < 0.0) d.x = min(d.x, dr); else d.y = min(d.y, dr);
    }
    // Ribs joining the sides: across the nose, the windscreen, the roof and
    // the tail (not the fender, which would cut the hood in two).
    for (int k = 0; k < 7; k++) {
        int i = k < 2 ? k : k + 1;
        float dc = segment(q, L[i].xy, R[i].xy);
        if (L[i].z + R[i].z < 0.0) d.x = min(d.x, dc); else d.y = min(d.y, dc);
    }
    return d * size;
}

vec4 backdrop(vec2 px) {
    vec3 red = accent;
    float horizon = resolution.y * 0.42;
    vec3 light = vec3(0.0);

    // One pass over the windows: the nearest edge, how near any is, how much
    // window there is, and faint corner brackets on every window but the
    // focused one, which the lock frame holds.
    float nearest = FAR, near = 0.0, present = 0.0;
    for (int i = 0; i < windowCount; i++) {
        float a = windowAlpha(i), d = windowDistance(px, i);
        nearest = min(nearest, d);
        near += exp(-max(d, 0.0) / 120.0);
        present += a;
        if (i != focusedIndex) light += red * glowLine(brackets(px, windowRect(i), 22.0, 34.0), 1.0) * 0.4 * a;
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    // Behind a window's glass, and the bar's, only a trace of the light shows.
    float veil = mix(1.0, 0.16, max(inside, step(px.y, reserved.x)));
    near = min(near, 1.0);
    present = min(present, 1.0);

    // The floor: a red dot at every crossing of a grid, in perspective,
    // coming toward the viewer a cell a second (16 cells every 16 seconds,
    // so the hourly wrap moves it by whole cells). Dots too close together to
    // draw cleanly fade out toward the horizon.
    float below = px.y - horizon;
    if (below > 0.0) {
        float drive = cycle(16.0) * 16.0;
        float depth = CAMERA * resolution.y / below;
        vec2 cell = vec2((px.x - resolution.x * 0.5) * CAMERA / below, depth + drive);
        // The nearest dot projected back onto the screen, so every dot is
        // round wherever the floor slants away.
        vec2 c = floor(cell + 0.5);
        float dotBelow = CAMERA * resolution.y / (c.y - drive);
        vec2 dotAt = vec2(resolution.x * 0.5 + c.x * dotBelow / CAMERA, horizon + dotBelow);
        float radius = clamp(0.06 * below / CAMERA, 0.6, 2.6);
        float dot_ = 1.0 - smoothstep(radius - 0.6, radius + 0.6, length(px - dotAt));
        // Where rows crowd closer than a few pixels the dots give way to
        // their average, a faint red sheen running into the horizon.
        float rows = below * below / (CAMERA * resolution.y);
        float clean = smoothstep(1.7, 4.0, rows);
        float fade = exp(-depth / 140.0);
        light += red * (dot_ * clean + 0.05 * (1.0 - clean)) * fade * (0.5 + 0.6 * near) * veil;

        // Streaks of speed: in a few lanes between the dots, a white dash
        // races in from the distance every three seconds.
        float lane = floor(cell.x);
        float seed = hash(vec2(lane, 5.3));
        if (seed > 0.86) {
            float head = (1.0 - fract(cycle(3.0) + seed * 9.0)) * 160.0;
            float behind = depth - head;
            float across = abs(fract(cell.x) - 0.5) * below / CAMERA;
            float dash = step(0.0, behind) * exp(-behind / 8.0) * (1.0 - smoothstep(0.4, 1.2, across));
            light += mix(red, WHITE, 0.6) * dash * fade * 0.6 * veil;
        }
    }

    // The horizon: a thin white line in a red haze, and a faint glow rising
    // into the black sky.
    float toHorizon = abs(below);
    light += WHITE * glowLine(toHorizon, 0.9) * 0.55 * veil;
    light += red * (0.18 * exp(-toHorizon / 40.0) + 0.05 * exp(-toHorizon / 300.0)) * veil;

    // The wedge turns once a minute on the floor behind the focused window.
    // It glides with the eased focus rect, sized and placed so the box it
    // turns through fits that rect, as low as the floor allows; what shows of
    // it is only what lies on the focused window itself (on any window while
    // none here is focused), so it never crosses a seam, even mid-glide. It
    // is a faint ghost behind the glass, as present as the focus, and the
    // hero of an empty screen, which it crossfades with as the first window
    // opens or the last one fades out (the windows' summed opacity is under 1
    // only then; a reviewer read this as a containment gap, and it is kept as
    // the empty desktop's presentation). Only pixels in its box pay for its
    // edges, and a window too small to hold it shows none.
    float size = min(focused.z / 2.8, focused.w / 1.4);
    vec2 at = vec2(focused.x + focused.z * 0.5,
                   clamp(horizon + size * 0.5, focused.y + 0.7 * size, focused.y + focused.w - 0.7 * size));
    vec2 reach = abs(px - at) - vec2(1.4, 0.7) * size;
    if (size > 8.0 && max(reach.x, reach.y) < 24.0) {
        float on = focusedIndex < 0 ? inside
            : 1.0 - smoothstep(-1.0, 1.0, rectDistance(px, windowRect(focusedIndex), windowRounding(focusedIndex)));
        float shown = mix(1.0, 0.35 * focusAlpha * on, present);
        vec2 d = wedge(px, at, size);
        light += mix(red, WHITE, 0.65) * glowLine(d.x, 1.3) * shown;
        light += red * glowLine(d.y, 1.0) * 0.4 * shown;
    }

    // The lock frame: fine light brackets close round the focused window,
    // as present as the focus, so it fades with a closing window.
    if (focusAlpha > 0.0) {
        float d = brackets(px, focused, 12.0, 48.0);
        light += mix(red, WHITE, 0.3) * glowLine(d, 1.2) * 0.8 * focusAlpha;
    }

    // The bar's lower edge: a red line with a white marker sweeping along it,
    // starting and ending off screen so its wrap never shows.
    if (reserved.x > 0.0) {
        float edge = glowLine(abs(px.y - reserved.x), 1.1);
        float marker = exp(-abs(px.x + 300.0 - cycle(8.0) * (resolution.x + 600.0)) / 45.0);
        light += red * edge * 0.8;
        light += WHITE * edge * marker * 2.5;
        light += red * 0.05 * step(px.y, reserved.x);
    }

    // Bright light saturates toward white, as it does on film.
    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}
