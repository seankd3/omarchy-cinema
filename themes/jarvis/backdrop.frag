// Jarvis: a holographic globe in a gyroscope of rings, turning behind the
// focused window and sized to it. It glows through the glass and past the
// window's edges; light pools in the seams between windows and wakes the hex
// lattice near them; dust drifts through the beam.
//
// The windows stand in the workshop's light (specs/depth.md). The arc reactor
// glows up from the table below the screen, so each window shades the
// lattice, the dust and the light pooled in the seams on its far side, further
// and softer as focus lifts it; the holograms (globe, rings) are light and
// cast no shadow. A moving window leaves a wake of dashed afterimages over
// scanned light, and the rings swing with the focused one like a carousel
// pushed round. The globe turns toward the pointer and the lattice lights up
// under it. Opening assembles a dashed ring from far out onto the window's
// edge, where it locks white-hot; landing jolts the whole hologram and sends
// a shock out through the lattice; focus surges the reactor and throws rays
// of light from the window; closing powers the hologram down to a line and a
// flare; typing taps small soft rings along the window's foot, gentle enough
// that steady typing never flickers.
//
// The windows and the workshop are one scene. Holo lines hold each window:
// they run along its edges in the seams and converge on its corners, light
// flowing in along them. The viewer leans toward the pointer and the hologram,
// nearest, shifts most, the lattice behind it less; a dragged window pulls
// the hologram after it. Behind each window the world draws the sheen on its
// glass, a streak that slides as the window moves and the reactor's glow
// along its lower glass, seen only through the glass. Each window's edge is a
// holographic pane's (frame()): the workshop bends through its outer pixels,
// its rim is cyan running to amber on the focused window as the border was,
// brightest toward the reactor, and light passing behind it runs into the rim.

const vec3 AMBER = vec3(1.0, 0.70, 0.28);
const vec3 HOT = vec3(0.86, 0.97, 1.0); // the reactor's white-hot core

// The arc reactor, below the middle of the screen: the light everything here
// is lit from.
vec2 reactor() {
    return vec2(resolution.x * 0.5, resolution.y * 1.15);
}

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
// `R`, tilted toward the viewer and turning once a minute. `look` (-1 to 1 on
// each axis) turns it toward the pointer. The far side shows faintly through
// the near one. `rim` is the glow at its edge.
float globe(vec2 p, float R, vec2 look, out float rim) {
    vec2 q = p / R;
    float q2 = dot(q, q);
    rim = 0.0;
    if (q2 > 1.0) return 0.0;
    float z = sqrt(1.0 - q2);
    rim = pow(1.0 - z, 3.0);
    float spin = cycle(60.0) * TAU + look.x * 0.7;
    float tilt = 0.4 - look.y * 0.3;
    float ct = cos(tilt), st = sin(tilt);
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

// The window an impulse at `at` happened in, or -1. An impulse is placed at
// its window's middle, so of the windows holding `at` it is the one whose
// middle is nearest (not the one on top: another can float over it).
int windowAt(vec2 at) {
    int found = -1;
    float best = FAR;
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        vec2 off = at - r.xy - r.zw * 0.5;
        if (all(lessThan(abs(off), r.zw * 0.5 + 1.0)) && dot(off, off) < best) {
            found = i;
            best = dot(off, off);
        }
    }
    return found;
}

// How much window i shades px, 1 in full shadow: its rect moved `offset` away
// from the light, `soft` pixels soft, as present as the window is.
float windowShadow(vec2 px, int i, vec2 offset, float soft) {
    float d = rectDistance(px - offset, windowRect(i), windowRounding(i));
    return (1.0 - smoothstep(-soft, soft, d)) * windowAlpha(i);
}

// One pass over the windows: the distance to the nearest (`edge`) and which
// it is (`closest`), the light pooled round them (`near`, 1 at an edge and
// adding up in the seams) and their shadows from the reactor (returned, 1 in
// full shadow).
float windows(vec2 px, out float edge, out int closest, out float near) {
    vec2 light = reactor();
    float s = 0.0;
    edge = FAR;
    closest = -1;
    near = 0.0;
    for (int i = 0; i < windowCount; i++) {
        float d = windowDistance(px, i);
        if (d < edge) {
            edge = d;
            closest = i;
        }
        near += exp(-max(d, 0.0) / 110.0);
        vec4 r = windowRect(i);
        float lift = windowLift(i);
        vec2 away = normalize(r.xy + r.zw * 0.5 - light + vec2(0.0, -1e-3));
        s = max(s, windowShadow(px, i, away * (36.0 + 56.0 * lift), 22.0 + 40.0 * lift));
    }
    near = min(near, 1.0);
    return s;
}

// The outward direction of a rounded rect's edge nearest px.
vec2 edgeNormal(vec2 px, vec4 rect, float radius) {
    vec2 p = px - rect.xy - rect.zw * 0.5;
    vec2 q = abs(p) - rect.zw * 0.5 + radius;
    vec2 g = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return g * vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
}

// The sheen a window's glass catches: a soft diagonal streak, 1 at its
// middle, whose place on the glass moves as the window does across the
// screen, the way a reflection slides over a pane that moves.
float glassStreak(vec2 px, vec4 r) {
    float across = dot(px - r.xy, normalize(vec2(1.0, -1.25))) / max(r.z, 1.0) + r.x / resolution.x * 0.8;
    return exp(-pow((fract(across * 0.7 + 0.15) - 0.5) * 9.0, 2.0));
}

// Holo lines holding window i: they run along its edges 10 px out and
// converge on its corners, brighter toward them, light flowing in along them
// to a small node at each corner.
vec3 holdLines(vec2 px, int i, vec3 cyan) {
    vec4 r = windowRect(i);
    vec2 p = abs(px - r.xy - r.zw * 0.5) - r.zw * 0.5;
    float toCorner = max(-min(p.x, p.y), 0.0);
    float o = abs(rectDistance(px, r, windowRounding(i)) - 10.0);
    float f = fract(toCorner / 26.0 + cycle(3.0));
    float dash = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.5, 0.6, f));
    float node = glowLine(abs(length(p - 10.0) - 4.0), 1.0);
    vec3 tint = i == focusedIndex ? mix(cyan, AMBER, 0.35) : cyan;
    return tint * (glowLine(o, 0.9) * (0.12 + 0.45 * dash) * exp(-toCorner / 150.0) + node * 0.6) * windowAlpha(i);
}

// A moving window's wake: dashed afterimages of it where it just was, over a
// wash of scanned light, outside the window itself; the lattice it sweeps
// across lights up (`lattice`).
vec3 afterimage(vec2 px, vec3 cyan, inout float lattice) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0) continue;
        float k = min(speed / 1200.0, 1.0) * windowAlpha(i) * smoothstep(0.0, 3.0, windowDistance(px, i));
        if (k <= 0.0) continue;
        vec3 tint = i == focusedIndex ? mix(cyan, HOT, 0.35) : cyan;
        float wash = 0.0;
        for (int g = 1; g <= 4; g++) {
            vec4 ghost = windowRect(i);
            ghost.xy -= v * 0.04 * float(g);
            float d = rectDistance(px, ghost, windowRounding(i));
            float fade = 1.0 - 0.22 * float(g);
            // Dashes run along each edge of the outline.
            vec2 q = px - ghost.xy - ghost.zw * 0.5;
            float along = abs(q.x) * ghost.w > abs(q.y) * ghost.z ? q.y : q.x;
            float dash = step(0.4, fract(along / 20.0));
            light += tint * glowLine(abs(d), 1.5) * dash * fade * 1.3 * k;
            wash = max(wash, (1.0 - smoothstep(-30.0, 30.0, d)) * fade);
        }
        float scan = 0.55 + 0.45 * sin(px.y * TAU / 5.0);
        light += tint * wash * scan * 0.5 * k;
        lattice += 3.0 * wash * k;
    }
    return light;
}

// The workshop answering what happened lately: the light it adds, how much
// more the lattice shows (`lattice`), how hard the reactor surges through
// the globe and rings (`surge`), and how far a landing throws the world at
// px (`shake`, pixels).
vec3 answers(vec2 px, vec3 cyan, out float lattice, out float surge, out vec2 shake) {
    vec3 light = vec3(0.0);
    lattice = 0.0;
    surge = 0.0;
    shake = vec2(0.0);
    // Newest first: the ring is newest last, so past the first one older
    // than the longest answer (a landing's, 1.6 s) every one is.
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.6) break;
        if (kind == TYPE) {
            float r = length(px - e.xy);
            if (age > 0.8 || r > 260.0) continue;
            // A tap: a small soft ring spreading from the key's place on the
            // window's foot, and the lattice lit round it. Typing is steady,
            // so a tap is gentle: no flash to flicker.
            float fade = 1.0 - age / 0.8;
            float front = abs(r - age * 150.0);
            light += cyan * (glowLine(front, 1.4) * 1.2 + 0.45 * exp(-front / 18.0)) * fade * e.w;
            light += AMBER * exp(-r / 14.0) * exp(-age * 4.0) * 0.8 * e.w;
            lattice += 3.0 * exp(-r / 60.0) * fade * e.w;
            continue;
        }
        if (kind == CLOSE) {
            float r = length(px - e.xy);
            if (age > 1.4 || (r > age * 1100.0 + 300.0 && abs(px.y - e.y) > 150.0)) continue;
            // Powering down: the hologram folds to a white-hot line that
            // shrinks to a point and flares out, and a dashed ring breaks
            // away outward through the lattice.
            float fold = max(1.0 - age / 0.35, 0.0);
            float half_ = 460.0 * fold;
            float line = length(vec2(max(abs(px.x - e.x) - half_, 0.0), px.y - e.y));
            light += HOT * (glowLine(line, 2.0) * 1.6 + 0.5 * exp(-line / 30.0)) * fold;
            light += HOT * (exp(-r / 16.0) * 2.5 + exp(-r / 120.0) * 0.6) * exp(-max(age - 0.3, 0.0) * 6.0);
            vec2 q = px - e.xy;
            float front = abs(r - age * 1100.0);
            float fade = exp(-age * 2.2);
            light += cyan * glowLine(front, 1.6) * dashes(atan(q.y, q.x), r, 40.0, 0.6 * (1.0 - age / 1.4), age) * fade * 1.4;
            light += cyan * 0.5 * exp(-front / 50.0) * fade;
            lattice += 4.0 * exp(-front / 40.0) * fade;
            continue;
        }
        if (age > (kind == LAND ? 1.6 : kind == OPEN ? 0.8 : kind == FOCUS ? 1.4 : 0.0)) continue;
        int i = windowAt(e.xy);
        vec4 rect = i < 0 ? vec4(e.xy, 0.0, 0.0) : windowRect(i);
        float d = rectDistance(px, rect, i < 0 ? 0.0 : windowRounding(i));
        vec2 q = px - rect.xy - rect.zw * 0.5;
        if (kind == LAND) {
            float s = e.w;
            // The world jolts: a damped shake through the whole hologram,
            // and the shock front bends it outward as it passes.
            vec2 n = px - clamp(px, rect.xy, rect.xy + rect.zw);
            n /= max(length(n), 1e-3);
            float front = d - age * 480.0;
            shake.y += sin(age * 46.0) * exp(-age * 6.0) * 18.0 * s;
            shake += n * 22.0 * s * exp(-front * front / 2500.0) * exp(-age * 2.0);
            if (d < 0.0 || front > 250.0) continue;
            // Light: a white-hot front in a broad cyan band, an echo behind
            // it, the lattice blazing as it passes, and the seam flashing at
            // the impact.
            float fade = exp(-age * 2.0) * s;
            float af = abs(front);
            light += (HOT * glowLine(af, 2.0) * 1.5 + cyan * 0.6 * exp(-af / 50.0)) * fade;
            float echo = abs(d - age * 260.0);
            light += cyan * (glowLine(echo, 1.2) * 0.7 + 0.25 * exp(-echo / 30.0)) * fade;
            lattice += 6.0 * exp(-af / 36.0) * fade;
            light += mix(HOT, cyan, 0.4) * exp(-d / 60.0) * exp(-age * 5.0) * 2.0 * s;
            continue;
        }
        if (d < 0.0 || d > (kind == OPEN ? 520.0 : 1000.0)) continue;
        if (kind == OPEN) {
            // Assembling: a dashed ring closes in on the window's edge from
            // far out, the reactor surging behind it, and flashes white-hot
            // as it locks there.
            float t = age / 0.8;
            float r = (1.0 - t) * (1.0 - t) * 420.0;
            float spin = dashes(atan(q.y, q.x), length(q), 72.0, 0.5, t * 1.5);
            float on = abs(d - r);
            light += cyan * (glowLine(on, 1.8) * spin * 1.4 + 0.45 * exp(-on / 40.0)) * (0.4 + t);
            float lock = exp(-pow((t - 0.88) / 0.12, 2.0));
            light += (HOT * exp(-d / 14.0) * 2.5 + AMBER * exp(-d / 70.0) * 0.6) * lock;
            lattice += 4.0 * exp(-on / 40.0) * (0.4 + t);
            surge += lock;
        } else if (kind == FOCUS) {
            // The reactor surges and throws light: the globe and rings flare,
            // rays burst out from the window, its edge flashes and an amber
            // ring rolls out across the lattice.
            float fade = exp(-age * 3.5) * e.w;
            surge += 2.5 * fade;
            vec3 flare = exp(-d / 16.0) * 2.0 + exp(-d / 140.0) * 0.6 + vec3(0.0);
            if (age < 0.8) {
                // Rays: uneven spokes round the window (whole numbers of
                // waves round the circle, so no seam).
                float ang = atan(q.y, q.x);
                float rays = pow(0.5 + 0.5 * sin(ang * 11.0 + 2.0 * sin(ang * 5.0)), 6.0) * 3.0 + 0.3;
                flare += rays * exp(-d / 420.0) * 0.5;
            }
            light += mix(HOT, AMBER, 0.25) * flare * fade;
            float front = abs(d - age * 520.0);
            float roll = exp(-age * 2.5) * e.w;
            light += AMBER * (glowLine(front, 1.6) * 1.4 + 0.45 * exp(-front / 40.0)) * roll;
            lattice += 4.0 * exp(-front / 40.0) * roll;
        }
    }
    return light;
}

vec4 backdrop(vec2 px) {
    float edge, near;
    int closest;
    // What the reactor reaches: the surfaces and the dust, not the holograms.
    // Its light falls off away from it, so the seams nearest it glow most.
    float shade = 1.0 - 0.85 * windows(px, edge, closest, near);
    float lamp = 0.55 + 0.9 * exp(-length(px - reactor()) / (resolution.y * 0.8));
    float inside = 1.0 - smoothstep(-1.0, 1.0, edge);
    float focusEdge = focusedWindow(px);
    float nearFocus = exp(-max(focusEdge, 0.0) / 140.0);
    float gap = near * (1.0 - inside);

    vec3 cyan = accent;
    float lattice, surge;
    vec2 shake;
    vec3 answered = answers(px, cyan, lattice, surge, shake);
    answered += afterimage(px, cyan, lattice);
    // The world as a landing throws it, the viewer leaning toward the pointer
    // sees it and a dragged window pulls it: the hologram, nearest, moves
    // most; the lattice and the dust behind it less. Never the windows.
    vec2 lean = pointer.xy / resolution - 0.5;
    vec2 pulled = focusedIndex < 0 ? vec2(0.0) : windowVelocity(focusedIndex);
    vec2 world = px + shake + lean * 12.0 + pulled * 0.004;
    vec2 holoAt = px + shake + lean * 44.0 + pulled * 0.014;

    // Everything is centred on the focused window and sized to it.
    vec2 c = focused.xy + focused.zw * 0.5;
    float reach = length(focused.zw) * 0.5;
    vec2 p = holoAt - c;
    float r = length(p);
    float a = atan(p.y, p.x);
    float Rg = reach * 0.45;
    // The rings swing with the focused window as it moves, and settle back
    // when it stops.
    float swing = focusedIndex < 0 ? 0.0 : clamp(windowVelocity(focusedIndex).x * 0.00022, -0.6, 0.6);
    vec2 look = clamp((pointer.xy - c) / max(reach, 1.0), -1.0, 1.0);
    float hand = exp(-length(px - pointer.xy) / 170.0);

    // Deep navy, lifted around the globe and darker toward the corners.
    vec3 base = background * (0.55 + 0.6 * exp(-r / (reach * 1.8)) * mix(1.0, shade, 0.6));
    vec3 light = vec3(0.0);

    light += cyan * hexDots(world, 26.0) * (0.03 + 0.3 * near + 0.9 * hand + lattice) * shade;
    light += cyan * 0.05 * hand;

    float rim;
    float g = globe(p, Rg, look, rim);
    float holo = 1.0 + surge;
    light += cyan * (g * 0.5 + rim * 0.35) * holo;
    light += cyan * 0.1 * exp(-max(r - Rg, 0.0) / (Rg * 0.12)) * step(Rg, r) * holo;

    // The gyroscope: three rings tumbling about the globe, slowly and at
    // different rates. The far half of each ring is dim, and dimmer still
    // where the globe stands in front of it.
    // Only pixels near the gyroscope pay for it.
    for (int i = 0; i < (r < Rg * 1.75 ? 3 : 0); i++) {
        float fi = float(i);
        float tilt = 1.0 + 0.3 * sin(TAU * cycle(30.0 * (fi + 2.0)) + fi * 1.7);
        float yaw = TAU * cycle(40.0 * (fi + 1.0)) * (i == 1 ? -1.0 : 1.0) + fi * 2.1 + swing * (1.0 + fi);
        float R = Rg * (1.22 + 0.2 * fi);
        float angle, depth;
        float d = gyro(p, R, tilt, yaw, angle, depth);
        float shade_ = depth >= 0.0 ? 1.0 : (r < Rg ? 0.12 : 0.4);
        light += cyan * glowLine(d, 1.3) * shade_ * 0.75 * holo;
        light += cyan * glowLine(d, 4.0) * dashes(angle, R, 12.0, 0.18, cycle(20.0)) * shade_ * 0.35 * holo;
    }

    // Flat rings in the screen's plane, out past the window's edges.
    float turned = a - swing;
    light += cyan * glowLine(abs(r - reach * 1.04), 1.0) * dashes(turned, r, 120.0, 0.45, -cycle(120.0)) * 0.5 * holo;
    light += cyan * glowLine(abs(r - reach * 1.12), 6.0) * dashes(a + swing * 2.0, r, 6.0, 0.06, cycle(24.0)) * 0.5 * holo;
    light += AMBER * glowLine(abs(r - reach * 1.12), 2.0) * dashes(turned, r, 1.0, 0.05, -cycle(24.0)) * 0.9 * holo;
    light += cyan * glowLine(abs(r - reach * 1.24), 0.8) * 0.3 * holo;

    // Light pools in the seams between windows and runs along them.
    if (gap > 0.004) {
        vec2 q = px * 0.0055;
        // One soft, wide layer: finer, stronger noise showed its grid as
        // blocks once the gaps widened to 64 px.
        float flow = noise(q * 0.9 + orbit(60.0, 3.0));
        light += cyan * gap * (0.08 + 0.4 * flow * flow) * shade * lamp;
    }
    light += mix(cyan, AMBER, 0.35) * nearFocus * (1.0 - inside) * 0.12 * shade;

    light += mix(cyan, vec3(1.0), 0.5) * motes(world) * (0.2 + 0.5 * near) * shade;

    light += answered;
    if (closest >= 0 && edge > 0.0 && edge < 30.0) light += holdLines(px, closest, cyan);

    // The glass catches the workshop's light: behind each window the world
    // draws the sheen on it, the streak and the reactor's glow along its
    // lower glass. Only the glass shows it; the window's text stays over it,
    // opaque.
    if (closest >= 0 && edge < 0.0) {
        vec4 r = windowRect(closest);
        float low = exp(-(r.y + r.w - px.y) / 90.0);
        light += mix(cyan, HOT, 0.5) * (0.22 * glassStreak(px, r) + 0.3 * low) * windowAlpha(closest);
    }

    // The bar's lower edge: a thin holographic line, a tick every 40 pixels
    // hanging from it, and an amber marker sweeping across.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light += cyan * glowLine(abs(below), 1.0) * 0.6;
        float tick = 1.0 - smoothstep(0.5, 1.5, abs(fract(px.x / 40.0 + 0.5) - 0.5) * 40.0);
        light += cyan * tick * step(0.0, below) * step(below, 6.0) * 0.45;
        float marker = exp(-abs(px.x - cycle(12.0) * resolution.x) / 50.0);
        light += AMBER * marker * glowLine(abs(below), 2.0) * 0.9;
        light += cyan * 0.04 * step(px.y, reserved.x);
    }

    // Bright light saturates toward white, as it does on film.
    return vec4(base + (1.0 - exp(-light * 1.4)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a holographic pane. Its outer
// five pixels bend the workshop behind them, the way the side of a thick pane
// does; its rim is a crisp line of projected light, cyan running to amber
// across the focused window as its border did, a dim blue on the others,
// brightest on the side facing the reactor and as focus lifts it. Light
// passing behind the window, a ring, a wave or the rays, runs into the rim,
// and the window glows a little in the reactor's light, as Hyprland's shadow
// made it.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 24.0) return vec4(0.0);
    bool focus = i == focusedIndex;
    float diag = clamp(dot(px - r.xy, vec2(0.7071)) / max((r.z + r.w) * 0.7071, 1.0), 0.0, 1.0);
    vec3 tint = focus ? mix(vec3(0.37, 0.85, 1.0), AMBER, diag) : vec3(0.15, 0.36, 0.52);
    vec3 col = tint * exp(-max(d, 0.0) / 9.0) * step(0.0, d) * (focus ? 0.22 : 0.05);
    float a = 0.0;
    if (d < 12.0) {
        vec2 n = edgeNormal(px, r, rounding);
        float toward = 0.55 + 0.45 * max(dot(n, normalize(reactor() - r.xy - r.zw * 0.5 + vec2(0.0, 1e-3))), 0.0);
        // One look at the world 12 px in behind the glass: what the edge
        // bends into view, and what light is passing there.
        vec3 behind = backdrop(px - n * 12.0).rgb;
        float passing = smoothstep(0.12, 0.5, dot(behind, vec3(0.3, 0.5, 0.2)));
        float rim = glowLine(abs(d - 0.5), 1.0) * toward * (focus ? 0.95 : 0.6) * (1.0 + 0.6 * windowLift(i));
        float edge = (1.0 - smoothstep(0.0, 5.0, d)) * smoothstep(-2.0, 0.0, d);
        col += behind * 1.1 * edge * 0.9 + tint * rim + mix(tint, behind, 0.5) * rim * passing * 1.8;
        a = clamp(max(edge * 0.9, rim), 0.0, 1.0);
    }
    return vec4(col, a) * windowAlpha(i);
}
