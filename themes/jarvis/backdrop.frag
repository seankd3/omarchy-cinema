// omarchy-cinema contract 11
// Jarvis: a holographic globe in a gyroscope of rings, turning behind the
// focused window and sized to it. It glows through the glass and past the
// window's edges; light pools in the seams between windows and wakes the hex
// lattice near them; dust drifts through the beam.
//
// The windows stand in the workshop's light (specs/depth.md), calmly
// (SPEC.md, "Calm"). The arc reactor glows up from the
// table below the screen, so each window shades the lattice, the dust and
// the light pooled in the seams on its far side, further and softer as focus
// lifts it; the holograms (globe, rings) are light and cast no shadow. Holo
// lines hold each window, running along its edges in the seams and
// converging on its corners. Moving a window is where the workshop
// shines: the window pulls the hologram after it and the lattice less,
// swings the rings like a carousel and leaves dashed afterimages over
// scanned light; when it lands a white-hot shock runs out through the
// lattice and its seams flash, gone within 1.2 s. Behind each window the world draws the sheen on its glass, a
// streak that slides as the window moves and the reactor's glow along its
// lower glass, seen only through the glass. Each window's edge is a
// holographic pane's (frame()): the workshop bends through its outer pixels,
// its rim is cyan running to amber on the focused window as the border was,
// brightest toward the reactor, and light passing behind it runs into the rim.
//
// Everything else is answered briefly and softly: opening settles a dashed
// ring onto the window's edge, closing lets one spread and fade where it
// was, focus warms the window's edge. Typing gets no answer, so nothing moves
// while you work.

const vec3 AMBER = vec3(1.0, 0.70, 0.28);
const vec3 HOT = vec3(0.86, 0.97, 1.0); // the reactor's white-hot core
const vec2 HALO = vec2(0.28, 5.0); // how the holograms' lines glow (glowLine)

// The arc reactor, below the middle of the screen: the light everything here
// is lit from.
vec2 reactor() {
    return vec2(resolution.x * 0.5, resolution.y * 1.15);
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
// `R`, tilted toward the viewer and turning once a minute. The far side
// shows faintly through the near one. `rim` is the glow at its edge.
float globe(vec2 p, float R, out float rim) {
    vec2 q = p / R;
    float q2 = dot(q, q);
    rim = 0.0;
    if (q2 > 1.0) return 0.0;
    float z = sqrt(1.0 - q2);
    rim = pow(1.0 - z, 3.0);
    float spin = cycle(60.0) * TAU;
    const float ct = cos(0.4), st = sin(0.4);
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
        lines += glowLine(d, 0.9, HALO) * (side == 0 ? 1.0 : 0.22);
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

// Holo lines holding window i: they run along its edges 10 px out and
// converge on its corners, brighter toward them, to a small node at each
// corner. They stand still.
vec3 holdLines(vec2 px, int i, vec3 cyan) {
    Window w = window(px, i);
    vec4 r = w.rect;
    vec2 p = abs(px - r.xy - r.zw * 0.5) - r.zw * 0.5;
    float toCorner = max(-min(p.x, p.y), 0.0);
    float o = abs(rectDistance(px, r, w.rounding) - 10.0);
    float f = fract(toCorner / 26.0);
    float dash = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.5, 0.6, f));
    float node = glowLine(abs(length(p - 10.0) - 4.0), 1.0, HALO);
    vec3 tint = i == focusedIndex ? mix(cyan, AMBER, 0.35) : cyan;
    return tint * (glowLine(o, 0.9, HALO) * (0.1 + 0.3 * dash) * exp(-toCorner / 150.0) + node * 0.45) * w.alpha;
}

// A moving window's wake, which may shine: dashed afterimages of it where it just was over a wash of scanned light,
// outside the window itself, and the lattice it sweeps across lit up
// (`lattice`). It is gone as soon as the window stops. Past 70 px from
// where the window was in the last 0.16 s (its last afterimage's lag) the
// wash is 0 and the dashes' glow, 4 x 0.28 exp(-70 / 7.5), moves no point
// a twentieth of a display level, so it is not drawn there.
vec3 afterimage(vec2 px, Window w, vec3 cyan, inout float lattice) {
    vec3 light = vec3(0.0);
    vec2 v = w.velocity;
    float speed = length(v);
    // Only a moving window pays for its wake, and only where it reaches.
    if (speed >= 40.0 && w.d > 0.0 && edgeDistance(w) < 70.0 + speed * 0.16) {
        vec3 tint = w.i == focusedIndex ? mix(cyan, HOT, 0.35) : cyan;
        float wash = 0.0;
        float k = min(speed / 1200.0, 1.0) * w.alpha * smoothstep(0.0, 3.0, w.d);
        for (int g = 1; g <= 4; g++) {
            vec4 ghost = w.rect;
            ghost.xy -= v * 0.04 * float(g);
            float d = rectDistance(px, ghost, w.rounding);
            float fade = 1.0 - 0.22 * float(g);
            // Dashes run along each edge of the outline.
            vec2 q = px - ghost.xy - ghost.zw * 0.5;
            float along = abs(q.x) * ghost.w > abs(q.y) * ghost.z ? q.y : q.x;
            float dash = step(0.4, fract(along / 20.0));
            light += tint * glowLine(abs(d), 1.5, HALO) * dash * fade * 1.3 * k;
            wash = max(wash, (1.0 - smoothstep(-30.0, 30.0, d)) * fade);
        }
        light += tint * wash * (0.55 + 0.45 * sin(px.y * TAU / 5.0)) * 0.5 * k;
        lattice += 3.0 * wash * k;
    }
    return light;
}

// The workshop answering what happened lately, briefly and softly: the light
// it adds, and how much more the lattice shows (`lattice`). Typing and voice
// get no answer.
vec3 answers(vec2 px, vec3 cyan, out float lattice) {
    vec3 light = vec3(0.0);
    lattice = 0.0;
    // Newest first: the ring is newest last, so past the first one older
    // than the longest answer (a landing's, 1.2 s) every one is.
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (age > 1.0 && kind != LAND) continue;
        if (kind == CLOSE) {
            // A faint dashed ring spreads from where the window was and fades.
            vec2 q = px - e.xy;
            float r = length(q);
            float front = closingFront(px, e);
            if (front > 120.0) continue;
            float glow = swell(age, 0.1, 0.9);
            light += cyan * (glowLine(front, 1.2, HALO) * dashes(atan(q.y, q.x), r, 40.0, 0.5, 0.0) * 0.5 + 0.1 * exp(-front / 24.0)) * glow;
            continue;
        }
        vec4 rect = impulseRect(k);
        float d = impulseDistance(px, k);
        if (d < 0.0 || d > 320.0) continue;
        if (kind == OPEN) {
            // A dashed ring settles onto the window's edge from 60 px out.
            if (age > 0.7) continue;
            float on = openingFront(d, age);
            vec2 q = px - rect.xy - rect.zw * 0.5;
            float dash = dashes(atan(q.y, q.x), length(q), 72.0, 0.5, 0.0);
            light += cyan * (glowLine(on, 1.2, HALO) * dash * 0.6 + 0.12 * exp(-on / 20.0)) * swell(age, 0.15, 0.7);
        } else if (kind == LAND) {
            // The end of a move, which may shine: a white-hot front in a
            // broad band runs out through the lattice, blazing it as it
            // passes, and the seams round the window flash, all within 1.2 s.
            float front = abs(d - age * 480.0);
            float glow = (1.0 - smoothstep(0.0, 1.2, age)) * exp(-age * 1.5) * e.w;
            light += (HOT * glowLine(front, 2.0, HALO) * 1.5 + cyan * 0.6 * exp(-front / 50.0)) * glow;
            lattice += 6.0 * exp(-front / 36.0) * glow;
            light += mix(HOT, cyan, 0.4) * exp(-d / 60.0) * exp(-age * 5.0) * 2.0 * e.w;
        } else if (kind == FOCUS) {
            // The window's edge warms softly in the reactor's light.
            light += mix(cyan, AMBER, 0.35) * 0.35 * focusWarmth(d, e);
        }
    }
    return light;
}

// Past REACH a window moves no point a level: its pooled light, exp(-d / 110),
// reaches furthest.
const float REACH = 800.0;

vec4 backdrop(vec2 px) {
    vec3 cyan = accent;
    // One pass over the windows: the nearest, the focused and the one whose
    // glass this point is behind, the light pooled round them (`near`, 1 at
    // an edge and adding up in the seams), their shadows from the reactor (1
    // in full shadow) and the wakes of the moving ones.
    vec2 arc = reactor();
    Seen seen = UNSEEN;
    float near = 0.0, shadow = 0.0, swept = 0.0;
    vec3 after = vec3(0.0);
    uint reached = windowsAt(px);
    for (int i = 0; i < windowCount; i++) {
        if (!reaches(reached, i)) continue;
        Window w = window(px, i);
        see(seen, w);
        near += exp(-max(w.d, 0.0) / 110.0);
        vec2 away = normalize(w.rect.xy + w.rect.zw * 0.5 - arc + vec2(0.0, -1e-3));
        shadow = max(shadow, windowShadow(px, w, away * (36.0 + 56.0 * w.lift), 22.0 + 40.0 * w.lift));
        after += afterimage(px, w, cyan, swept);
    }
    near = min(near, 1.0);
    float edge = seen.nearest;
    int closest = seen.closest;
    // What the reactor reaches: the surfaces and the dust, not the holograms.
    // Its light falls off away from it, so the seams nearest it glow most.
    float shade = 1.0 - 0.85 * shadow;
    float lamp = 0.55 + 0.9 * exp(-length(px - arc) / (resolution.y * 0.8));
    float inside = 1.0 - smoothstep(-1.0, 1.0, edge);
    float nearFocus = exp(-max(seen.focus, 0.0) / 140.0);
    float gap = near * (1.0 - inside);

    float lattice;
    vec3 answered = answers(px, cyan, lattice);
    answered += after;
    lattice += swept;
    // The world as a dragged window pulls it: the hologram, nearest, moves
    // most; the lattice and the dust behind it less. Never the windows.
    vec2 pulled = focusedIndex < 0 ? vec2(0.0) : window(px, focusedIndex).velocity;
    vec2 world = px + pulled * 0.003;
    vec2 holoAt = px + pulled * 0.01;

    // Everything is centred on the focused window and sized to it.
    vec2 c = focused.xy + focused.zw * 0.5;
    float reach = length(focused.zw) * 0.5;
    vec2 p = holoAt - c;
    float r = length(p);
    float Rg = reach * 0.45;
    // The rings swing with the focused window as it moves, like a carousel
    // pushed round, and settle back when it stops.
    float swing = focusedIndex < 0 ? 0.0 : clamp(window(px, focusedIndex).velocity.x * 0.00016, -0.4, 0.4);

    // Deep navy, lifted around the globe and darker toward the corners.
    vec3 base = background * (0.55 + 0.6 * exp(-r / (reach * 1.8)) * mix(1.0, shade, 0.6));
    vec3 light = vec3(0.0);

    light += cyan * hexDots(world, 26.0) * (0.03 + 0.3 * near + lattice) * shade;

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
        float yaw = TAU * cycle(40.0 * (fi + 1.0)) * (i == 1 ? -1.0 : 1.0) + fi * 2.1 + swing * (1.0 + fi);
        float R = Rg * (1.22 + 0.2 * fi);
        float angle, depth;
        float d = gyro(p, R, tilt, yaw, angle, depth);
        float shade_ = depth >= 0.0 ? 1.0 : (r < Rg ? 0.12 : 0.4);
        light += cyan * glowLine(d, 1.3, HALO) * shade_ * 0.75;
        light += cyan * glowLine(d, 4.0, HALO) * dashes(angle, R, 12.0, 0.18, cycle(20.0)) * shade_ * 0.35;
    }

    // Flat rings in the screen's plane, out past the window's edges, paid for
    // within 250 px of them: past that their glows, 0.14 exp(-d / 30), move
    // no point a twentieth of a level.
    if (abs(r - reach * 1.12) < reach * 0.12 + 250.0) {
        float a = atan(p.y, p.x);
        float turned = a - swing;
        light += cyan * glowLine(abs(r - reach * 1.04), 1.0, HALO) * dashes(turned, r, 120.0, 0.45, -cycle(120.0)) * 0.5;
        light += cyan * glowLine(abs(r - reach * 1.12), 6.0, HALO) * dashes(a + swing * 2.0, r, 6.0, 0.06, cycle(24.0)) * 0.5;
        light += AMBER * glowLine(abs(r - reach * 1.12), 2.0, HALO) * dashes(turned, r, 1.0, 0.05, -cycle(24.0)) * 0.9;
        light += cyan * glowLine(abs(r - reach * 1.24), 0.8, HALO) * 0.3;
    }

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
    int over = seen.over;
    if (over >= 0) {
        Window o = window(px, over);
        vec4 r = o.rect;
        float low = exp(-(r.y + r.w - px.y) / 90.0);
        light += mix(cyan, HOT, 0.5) * (0.22 * glassStreak(px, r) + 0.3 * low) * o.alpha;
    }

    // The bar's lower edge: a thin holographic line, a tick every 40 pixels
    // hanging from it, and an amber marker sweeping across.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light += cyan * glowLine(abs(below), 1.0, HALO) * 0.6;
        float tick = 1.0 - smoothstep(0.5, 1.5, abs(fract(px.x / 40.0 + 0.5) - 0.5) * 40.0);
        light += cyan * tick * step(0.0, below) * step(below, 6.0) * 0.45;
        float marker = exp(-abs(px.x - cycle(12.0) * resolution.x) / 50.0);
        light += AMBER * marker * glowLine(abs(below), 2.0, HALO) * 0.9;
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
    Window w = window(px, i);
    vec4 r = w.rect;
    float rounding = w.rounding;
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
        vec3 behind = worldAt(px - n * 12.0).rgb;
        float passing = smoothstep(0.12, 0.5, dot(behind, vec3(0.3, 0.5, 0.2)));
        float rim = glowLine(abs(d - 0.5), 1.0, HALO) * toward * (focus ? 0.95 : 0.6) * (1.0 + 0.6 * w.lift);
        float edge = (1.0 - smoothstep(0.0, 5.0, d)) * smoothstep(-2.0, 0.0, d);
        col += behind * 1.1 * edge * 0.9 + tint * rim + mix(tint, behind, 0.5) * rim * passing * 1.8;
        a = clamp(max(edge * 0.9, rim), 0.0, 1.0);
    }
    return vec4(col, a) * w.alpha;
}
