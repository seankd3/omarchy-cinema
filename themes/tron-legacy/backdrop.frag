// Tron Legacy: the Grid. A floor of light lines runs out to the horizon under
// a black sky, and light cycles race along it, trailing light. Around every
// window a circuit line is drawn, and pulses run along it; around the focused
// window they run orange, as Clu's do.
//
// The windows stand on the Grid (specs/depth.md): lit from the horizon behind
// them, each casts its shadow toward the viewer, further and softer as focus
// lifts it; a moving window leaves its circuit behind it as a light trail;
// landing sends a wave of light out through the grid, typing taps small
// ones, opening draws a ring in, closing derezzes one out, speaking sends one
// and the horizon glows with your voice, focus flashes the circuit, and the
// grid lights up under the pointer.

const vec3 ORANGE = vec3(1.0, 0.52, 0.10);
const float CELL = 40.0; // grid spacing on the floor, in floor units

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 6.0));
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

// The floor under the point, in floor units: x across, z away from the viewer.
// The viewer glides forward a cell every two seconds; eight cells per sixteen
// seconds, so the hourly wrap moves the floor by whole cells.
vec2 floorAt(vec2 px, float horizon) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 140.0 * resolution.y / dy;
    float x = (px.x - resolution.x * 0.5) * depth / resolution.y;
    return vec2(x, depth + cycle(16.0) * 8.0 * CELL);
}

// A light cycle in lane `lane` (cells from the middle), riding away from the
// viewer and coming round again every `period` seconds, its trail fading
// behind it.
float lightCycle(vec2 world, float lane, float period, float phase) {
    float laneX = lane * CELL;
    float across = abs(world.x - laneX) / max(fwidth(world.x), 1e-3);
    float head = fract(cycle(period) + phase) * 1600.0 + 200.0 + cycle(16.0) * 8.0 * CELL;
    float behind = head - world.y;
    if (behind < 0.0) return 0.0;
    float trail = exp(-behind / 320.0);
    return (1.0 - smoothstep(0.0, 2.5, across)) * trail * (behind < 6.0 ? 3.0 : 1.0);
}

// A wave through the grid from an impulse at `at`, `age` seconds old: a ring
// `speed` px a second out, squashed into the floor's perspective, `width`
// soft, fading as it goes.
float wave(vec2 px, vec2 at, float age, float speed, float width) {
    float r = length((px - at) * vec2(1.0, 2.4));
    return exp(-abs(r - age * speed) / width) * exp(-age * 1.6);
}

// Where a window event touches the floor: the foot of the window it happened
// in (windows stand on the Grid), or the point itself.
vec2 foot(vec2 at) {
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        if (rectDistance(at, r, 0.0) < 0.0) return vec2(at.x, r.y + r.w);
    }
    return at;
}

// How much the grid lights up at px, from everything that happened lately and
// the pointer above it: 0 when nothing did.
float gridLit(vec2 px) {
    float lit = 1.4 * exp(-length((px - pointer.xy) * vec2(1.0, 2.4)) / 260.0);
    for (int i = 0; i < impulseCount; i++) {
        vec4 e = impulses[i];
        int kind = impulseKinds[i];
        if (kind == LAND) lit += 4.0 * e.w * wave(px, foot(e.xy), e.z, 900.0, 40.0);
        else if (kind == TYPE) lit += 2.0 * e.w * wave(px, e.xy, e.z, 420.0, 14.0) * step(e.z, 0.8);
        else if (kind == CLOSE) lit += 3.0 * wave(px, foot(e.xy), e.z, 1500.0, 30.0);
        else if (kind == VOICE) lit += 2.5 * wave(px, foot(e.xy), e.z, 700.0, 50.0);
        else if (kind == OPEN && e.z < 0.6) {
            // Drawn in: the ring closes on the window's foot as it opens.
            float r = length((px - foot(e.xy)) * vec2(1.0, 2.4));
            lit += 3.0 * exp(-abs(r - (1.0 - e.z / 0.6) * 900.0) / 30.0);
        }
    }
    return lit;
}

// The windows' shadows on the floor, lit from the horizon behind them: 1 in
// full shadow.
float shadowAt(vec2 px) {
    float s = 0.0;
    for (int i = 0; i < windowCount; i++) {
        float lift = windowLift(i);
        float soft = 26.0 + 40.0 * lift;
        float d = rectDistance(px - vec2(0.0, 18.0 + 34.0 * lift), windowRect(i), windowRounding(i));
        s = max(s, (1.0 - smoothstep(-soft, soft, d)) * windowAlpha(i));
    }
    return s;
}

vec4 backdrop(vec2 px) {
    vec3 cyan = accent;
    float horizon = resolution.y * 0.40;
    vec3 col = background;
    vec3 light = vec3(0.0);

    // The window nearest this point, for its circuit line and pulses.
    float nearest = FAR;
    int closest = -1;
    for (int i = 0; i < windowCount; i++) {
        float d = windowDistance(px, i);
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    float near = clamp(windowGlow(px, 90.0), 0.0, 1.0);

    if (px.y > horizon) {
        vec2 world = floorAt(px, horizon);
        vec2 cell = world / CELL;
        vec2 aa = max(fwidth(cell), vec2(1e-4));
        vec2 lines = abs(fract(cell + 0.5) - 0.5) / aa;
        float grid = max(1.0 - smoothstep(0.0, 1.3, lines.x), 1.0 - smoothstep(0.0, 1.3, lines.y));
        float fade = exp(-world.y / 2600.0);
        float shade = 1.0 - 0.7 * shadowAt(px);
        float lit = gridLit(px);
        light += cyan * grid * fade * (0.35 + 0.9 * near) * (1.0 + lit) * shade;
        // The waves and the pointer's light carry a soft band of their own, so
        // they read through frosted glass as well as in the seams.
        light += cyan * 0.09 * lit * fade * shade;
        // The floor holds a little light of its own near the horizon.
        light += cyan * 0.05 * exp(-(px.y - horizon) / 90.0);

        light += cyan * lightCycle(world, -3.0, 9.0, 0.0) * fade;
        light += vec3(0.75, 0.97, 1.0) * lightCycle(world, 2.0, 12.0, 0.35) * fade;
        light += ORANGE * lightCycle(world, 6.0, 15.0, 0.7) * fade;
    } else {
        // Black sky, a band of light along the horizon, faint high cloud.
        float above = horizon - px.y;
        // The horizon glows with your voice while you dictate.
        light += cyan * 0.22 * exp(-above / (50.0 + 60.0 * voice)) * (1.0 + 2.5 * voice);
        light += cyan * 0.03 * noise(px * 0.004 + orbit(120.0, 2.0)) * exp(-above / 400.0);
    }

    // A circuit line around every window, just off its edge, with two pulses
    // chasing round it; orange around the focused one.
    if (closest >= 0 && nearest > 0.0 && nearest < 60.0) {
        vec3 tint = closest == focusedIndex ? ORANGE : cyan;
        float circuit = glowLine(abs(nearest - 7.0), 1.1);
        float around = perimeter(px, windowRect(closest));
        float pulse = 0.0;
        for (int k = 0; k < 2; k++) {
            float ahead = fract(cycle(closest == focusedIndex ? 4.0 : 8.0) - around + float(k) * 0.5);
            pulse += exp(-ahead * 30.0) * 3.0;
        }
        // Focus taken: the circuit flashes.
        for (int i = 0; i < impulseCount; i++)
            if (impulseKinds[i] == FOCUS && rectDistance(impulses[i].xy, windowRect(closest), 0.0) < 0.0)
                pulse += 4.0 * exp(-impulses[i].z * 5.0);
        light += tint * circuit * (0.45 + pulse) * windowAlpha(closest);
    }

    // A moving window leaves its circuit behind it as a fading light trail,
    // outside the window itself.
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0) continue;
        float outside = smoothstep(0.0, 3.0, windowDistance(px, i));
        vec3 tint = i == focusedIndex ? ORANGE : cyan;
        for (int k = 1; k <= 4; k++) {
            vec4 ghost = windowRect(i);
            ghost.xy -= v * 0.025 * float(k);
            float d = rectDistance(px, ghost, windowRounding(i));
            light += tint * glowLine(abs(d - 7.0), 1.1) * (0.55 - 0.12 * float(k)) * min(speed / 1500.0, 1.0) * windowAlpha(i) * outside;
        }
    }

    // Light pools in the seams between windows.
    light += cyan * near * (1.0 - inside) * 0.12;

    // The bar's lower edge is a line of light, with pulses running along it
    // both ways, and a little of it fills the glass bar above.
    if (reserved.x > 0.0) {
        float edge = glowLine(abs(px.y - reserved.x), 1.2);
        float along = px.x / resolution.x;
        float pulses = exp(-fract(cycle(6.0) - along) * 25.0) * 2.5 + exp(-fract(along - cycle(10.0)) * 25.0) * 1.5;
        light += cyan * edge * (0.5 + pulses);
        light += cyan * 0.06 * step(px.y, reserved.x);
    }

    return vec4(col + (1.0 - exp(-light * 1.3)), 1.0);
}
