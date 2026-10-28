// Tron Legacy: the Grid. A floor of light lines runs out to the horizon under
// a black sky, and light cycles race along it, trailing light. Around every
// window a circuit line is drawn, and pulses run along it; around the focused
// window they run orange, as Clu's do.

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
        light += cyan * grid * fade * (0.35 + 0.9 * near);
        // The floor holds a little light of its own near the horizon.
        light += cyan * 0.05 * exp(-(px.y - horizon) / 90.0);

        light += cyan * lightCycle(world, -3.0, 9.0, 0.0) * fade;
        light += vec3(0.75, 0.97, 1.0) * lightCycle(world, 2.0, 12.0, 0.35) * fade;
        light += ORANGE * lightCycle(world, 6.0, 15.0, 0.7) * fade;
    } else {
        // Black sky, a band of light along the horizon, faint high cloud.
        float above = horizon - px.y;
        light += cyan * 0.22 * exp(-above / 50.0);
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
        light += tint * circuit * (0.45 + pulse) * windowAlpha(closest);
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
