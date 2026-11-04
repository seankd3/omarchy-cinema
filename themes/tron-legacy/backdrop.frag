// omarchy-cinema contract 9
// Tron Legacy: the Grid. A floor of light lines runs out to the horizon under
// a black sky, and light cycles race along it, trailing light. Around every
// window a circuit line is drawn, and pulses run along it; around the focused
// window they run orange, as Clu's do.
//
// The windows stand on the Grid (specs/depth.md), calmly, and shine when they
// move (SPEC.md, "Calm"): lit from the horizon behind them, each casts its shadow toward the
// viewer, further and softer as focus lifts it, and the floor gives under its
// weight; a moving window leaves a bright light-cycle trail of its circuit and
// landing rings out through the grid; closing sends one soft ring, opening
// draws one in; focus warms the circuit; the horizon glows a little with your
// voice.

const vec3 ORANGE = vec3(1.0, 0.52, 0.10);
const float CELL = 40.0; // grid spacing on the floor, in floor units
const vec2 HALO = vec2(0.25, 6.0); // how the Grid's lines glow (glowLine)

// The floor under the point, in floor units: x across, z away from the viewer.
// The viewer glides forward a cell every two seconds; eight cells per sixteen
// seconds, so the hourly wrap moves the floor by whole cells. The viewer
// stands on the middle line, so the Grid stays symmetrical.
vec2 floorAt(vec2 px, float horizon) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 140.0 * resolution.y / dy;
    float x = (px.x - resolution.x * 0.5) * depth / resolution.y;
    return vec2(x, depth + cycle(16.0) * 8.0 * CELL);
}

// A light cycle in lane `lane` (cells from the middle), riding away from the
// viewer and coming round again every `period` seconds, its trail fading
// behind it; `stride` is how far the floor moves across a drawn pixel.
float lightCycle(vec2 world, vec2 stride, float lane, float period, float phase) {
    float laneX = lane * CELL;
    float across = abs(world.x - laneX) / max(stride.x, 1e-3);
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

// Where impulse k touches the floor: the foot of the window it happened to
// (windows stand on the Grid), or its point itself.
vec2 foot(int k) {
    vec4 r = impulseRect(k);
    return vec2(impulses[k].x, r.y + r.w);
}

// How much the grid lights up at px, from everything that happened lately: 0
// when nothing did.
float gridLit(vec2 px) {
    float lit = 0.0;
    for (int i = 0; i < impulseCount; i++) {
        vec4 e = impulses[i];
        int kind = impulseKinds[i];
        // Calm, except where windows move: landing rings out bright, closing is a
        // gentle ring, typing and speech make none.
        if (kind == LAND) lit += 3.2 * e.w * wave(px, foot(i), e.z, 900.0, 45.0);
        else if (kind == CLOSE) lit += 1.0 * wave(px, foot(i), e.z, 900.0, 60.0);
        else if (kind == OPEN && e.z < 0.6) {
            // Drawn in: the ring closes on the window's foot as it opens.
            float r = length((px - foot(i)) * vec2(1.0, 2.4));
            lit += 1.0 * exp(-abs(r - (1.0 - e.z / 0.6) * 900.0) / 50.0);
        }
    }
    return lit;
}

vec4 backdrop(vec2 px) {
    vec3 cyan = accent;
    float horizon = resolution.y * 0.40;
    vec3 col = background;
    vec3 light = vec3(0.0);

    // One pass over the windows: the nearest, for its circuit line and
    // pulses, and the one whose glass this point is behind; the light pooled
    // round them, adding up in the seams; and on the floor, how it gives under
    // them and their shadows.
    //
    // The floor gives under the windows standing on it: points near a window's
    // foot are pulled toward it, so the grid lines bend round its weight, less
    // as focus lifts it off the floor. Lit from the horizon behind them, a
    // pane standing on the Grid throws its shadow forward, onto the floor in
    // front of its foot, longer and softer as focus lifts it; the floor behind
    // it, seen through the glass, stays lit (1 in full shadow).
    //
    // A moving window leaves its circuit behind it as a fading light trail,
    // outside the window itself. Past 80 px from where the window was in the
    // last 0.125 s (its last ghost's lag) the five glows, 1.8 x 0.25
    // exp(-73 / 6.6), move no point a hundredth of a display level, so it is
    // not drawn there.
    bool ground = px.y > horizon;
    Seen seen = UNSEEN;
    float near = 0.0, shadow = 0.0;
    vec2 pull = vec2(0.0);
    vec3 trail = vec3(0.0);
    for (int i = 0; i < windowCount; i++) {
        Window w = window(px, i);
        see(seen, w);
        near += exp(-max(w.d, 0.0) / 90.0);
        vec4 r = w.rect;
        vec2 foot = vec2(clamp(px.x, r.x, r.x + r.z), r.y + r.w);
        vec2 to = foot - px;
        pull += to * 0.18 * (1.0 - 0.7 * w.lift) * w.alpha * exp(-length(to * vec2(1.0, 2.4)) / 70.0);
        if (ground) {
            float reach = 36.0 + 70.0 * w.lift;
            float below = px.y - (r.y + r.w);
            if (below >= -2.0 && below <= reach * 2.0) {
                float across = max(r.x - px.x, px.x - (r.x + r.z));
                float side = 1.0 - smoothstep(-12.0, 14.0 + 20.0 * w.lift, across);
                shadow = max(shadow, side * exp(-max(below, 0.0) / reach) * smoothstep(-2.0, 3.0, below) * w.alpha);
            }
        }
        float speed = length(w.velocity);
        if (speed >= 40.0 && w.d > 0.0 && edgeDistance(w) < 80.0 + speed * 0.125) {
            float outside = smoothstep(0.0, 3.0, w.d);
            vec3 tint = i == focusedIndex ? ORANGE : cyan;
            for (int k = 1; k <= 5; k++) {
                vec4 ghost = r;
                ghost.xy -= w.velocity * 0.025 * float(k);
                float d = rectDistance(px, ghost, w.rounding);
                trail += tint * glowLine(abs(d - 7.0), 1.1, HALO) * (0.75 - 0.13 * float(k)) * min(speed / 1500.0, 1.0) * w.alpha * outside;
            }
        }
    }
    float nearest = seen.nearest;
    int closest = seen.closest;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    // The floor under every point, even above the horizon, so how far it
    // moves across a drawn pixel is taken here, where every pixel of a quad
    // takes it: a derivative in a branch that differs within a quad is
    // undefined on some drivers.
    vec2 world = floorAt(px + pull, horizon);
    vec2 stride = fwidth(world);
    near = clamp(near, 0.0, 1.0);

    if (ground) {
        vec2 cell = world / CELL;
        vec2 aa = max(stride / CELL, vec2(1e-4));
        vec2 lines = abs(fract(cell + 0.5) - 0.5) / aa;
        float grid = max(1.0 - smoothstep(0.0, 1.3, lines.x), 1.0 - smoothstep(0.0, 1.3, lines.y));
        // The floor fades into the distance by its depth on the screen, so
        // its glide never jumps when it comes round.
        float fade = exp(-(world.y - cycle(16.0) * 8.0 * CELL + 4.0 * CELL) / 2600.0);
        float shade = 1.0 - 0.7 * shadow;
        float lit = gridLit(px);
        light += cyan * grid * fade * (0.35 + 0.9 * near) * (1.0 + lit) * shade;
        // The waves carry a soft band of their own, so they read through
        // frosted glass as well as in the seams.
        light += cyan * 0.05 * lit * fade * shade;
        // The floor holds a little light of its own near the horizon.
        light += cyan * 0.05 * exp(-(px.y - horizon) / 90.0);

        light += cyan * lightCycle(world, stride, -3.0, 9.0, 0.0) * fade;
        light += vec3(0.75, 0.97, 1.0) * lightCycle(world, stride, 2.0, 12.0, 0.35) * fade;
        light += ORANGE * lightCycle(world, stride, 6.0, 15.0, 0.7) * fade;
    } else {
        // Black sky, a band of light along the horizon, faint high cloud.
        float above = horizon - px.y;
        // The horizon glows with your voice while you dictate.
        light += cyan * 0.22 * exp(-above / (50.0 + 30.0 * voice)) * (1.0 + 0.8 * voice);
        light += cyan * 0.03 * noise(px * 0.004 + orbit(120.0, 2.0)) * exp(-above / 400.0);
    }

    // A circuit line around every window, just off its edge, with two pulses
    // chasing round it; orange around the focused one.
    if (closest >= 0 && nearest > 0.0 && nearest < 60.0) {
        Window c = window(px, closest);
        vec3 tint = closest == focusedIndex ? ORANGE : cyan;
        float circuit = glowLine(abs(nearest - 7.0), 1.1, HALO);
        float around = around(px, c.rect);
        float pulse = 0.0;
        for (int k = 0; k < 2; k++) {
            float ahead = fract(cycle(closest == focusedIndex ? 4.0 : 8.0) - around + float(k) * 0.5);
            pulse += exp(-ahead * 30.0) * 3.0;
        }
        // Focus taken: the circuit flashes.
        for (int i = 0; i < impulseCount; i++)
            if (impulseKinds[i] == FOCUS && impulseWindows[i] == closest)
                pulse += 1.2 * exp(-impulses[i].z * 3.0);
        light += tint * circuit * (0.45 + pulse) * c.alpha;
    }

    light += trail;

    // The glass catches the Grid's light: behind each window the world draws
    // the sheen that falls on it, a soft diagonal streak whose place follows
    // the window across the screen, as a real reflection slides when the pane
    // moves, and the horizon's glow along its upper glass. Only the glass
    // shows it; the window's text stays over it, opaque.
    int over = seen.over;
    if (over >= 0) {
        Window o = window(px, over);
        vec4 r = o.rect;
        float streak = glassStreak(px, r);
        float top = exp(-(px.y - r.y) / 90.0);
        light += mix(cyan, vec3(1.0), 0.5) * (0.045 * streak + 0.05 * top) * o.alpha;
    }

    // Light pools in the seams between windows.
    light += cyan * near * (1.0 - inside) * 0.12;

    // The bar's lower edge is a line of light, with pulses running along it
    // both ways, and a little of it fills the glass bar above.
    if (reserved.x > 0.0) {
        float edge = glowLine(abs(px.y - reserved.x), 1.2, HALO);
        float along = px.x / resolution.x;
        float pulses = exp(-fract(cycle(6.0) - along) * 25.0) * 2.5 + exp(-fract(along - cycle(10.0)) * 25.0) * 1.5;
        light += cyan * edge * (0.5 + pulses);
        light += cyan * 0.06 * step(px.y, reserved.x);
    }

    return vec4(col + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a slab of glass standing on the
// Grid. Its outer six pixels show the world from behind them, the way the
// side of a thick pane bends it, and its rim is a crisp line of the window's own
// light, brighter toward the horizon it is lit from and as focus lifts it;
// orange on the focused window, as the circuit is.
vec4 frame(vec2 px, int i) {
    Window w = window(px, i);
    vec4 r = w.rect;
    float rounding = w.rounding;
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 30.0) return vec4(0.0);
    vec2 n = edgeNormal(px, r, rounding);
    float lift = w.lift;
    vec3 tint = i == focusedIndex ? ORANGE : accent;
    float edge = (1.0 - smoothstep(0.0, 6.0, d)) * smoothstep(-2.0, 0.0, d);
    float toward = 0.6 + 0.4 * clamp(-n.y, 0.0, 1.0);
    // One look at the world 10 px in behind the glass: what the edge bends
    // into view, and light passing behind the window, a cycle or a wave,
    // which catches its rim.
    vec3 behind = d < 12.0 ? worldAt(px - n * 10.0).rgb : background;
    float passing = smoothstep(0.15, 0.6, dot(behind, vec3(0.3, 0.5, 0.2)));
    float rim = glowLine(abs(d - 0.5), 1.0, HALO) * toward * (0.8 + 0.8 * lift + 1.6 * passing);
    float a = clamp(max(edge * 0.9, rim), 0.0, 1.0);
    vec3 col = behind * 1.15 * edge * 0.9 + tint * rim;
    return vec4(col, a) * w.alpha;
}
