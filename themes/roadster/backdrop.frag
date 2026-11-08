// omarchy-cinema contract 16
// Roadster: the 2026 Roadster's cockpit, drawn like a fighter jet's display.
// A floor of red dots runs out to a thin white horizon and rushes toward the
// viewer, with streaks of speed along it. A wireframe wedge turns slowly on
// the floor behind the focused window and glides after it. Every window sits
// in faint red corner brackets; a tighter, brighter lock frame holds the
// focused one, slides to the next window when focus moves, and fades as the
// focus does. The windows stand on the floor in the horizon's light
// (specs/depth.md).

const vec3 WHITE = vec3(1.0, 0.94, 0.94);
const float CAMERA = 15.0; // the eye's height over the floor, in grid cells

// Distance to four corner brackets around a rect pushed out by `gap`, each
// arm `arm` pixels long. Folding into one quadrant draws all four at once.
float brackets(vec2 px, vec4 rect, float gap, float arm) {
    vec2 p = abs(px - rect.xy - rect.zw * 0.5) - rect.zw * 0.5 - gap;
    return min(length(vec2(p.x - clamp(p.x, -arm, 0.0), p.y)), length(vec2(p.x, p.y - clamp(p.y, -arm, 0.0))));
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

// The cockpit answering what happened lately, briefly and softly, at px: the
// light it draws, and how much it lights the floor's dots (`lit`). Typing and
// voice get no answer.
vec3 answers(vec2 px, vec3 red, float horizon, out float lit) {
    vec3 light = vec3(0.0);
    lit = 0.0;
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (age > 1.0 && kind != LAND) continue;
        if (kind == CLOSE) {
            // One red ring spreads where the window was and fades.
            float front = closingFront(px, e);
            if (front > 120.0) continue;
            light += red * (glowLine(front, 1.2) * 0.5 + 0.08 * exp(-front / 30.0)) * swell(age, 0.1, 0.9);
            continue;
        }
        vec4 rect = impulseRect(k);
        if (kind == LAND) {
            // Touchdown, the end of a move, which may shine: the seams round
            // the window flash, and a shock runs out over the floor from its
            // foot, flaring the dots as it passes, all within 1.2 s.
            float d = rectDistance(px, rect, 0.0);
            light += mix(red, WHITE, 0.3) * exp(-max(d, 0.0) / 45.0) * step(0.0, d) * exp(-age * 5.0) * 1.6 * e.w;
            if (px.y < horizon) continue;
            vec2 foot = vec2(clamp(px.x, rect.x, rect.x + rect.z), rect.y + rect.w);
            float front = abs(length((px - foot) * vec2(1.0, 2.4)) - age * 900.0);
            if (front > 400.0) continue;
            float glow = (1.0 - smoothstep(0.0, 1.2, age)) * exp(-age * 1.8) * e.w;
            lit += 6.0 * exp(-front / 40.0) * glow;
            light += red * (glowLine(front, 2.0) + 0.45 * exp(-front / 60.0)) * glow;
            continue;
        }
        float d = rectDistance(px, rect, 0.0);
        if (d < 0.0 || d > 200.0) continue;
        if (kind == OPEN) {
            // Faint target brackets close onto the window from 60 px out.
            if (age > 0.6) continue;
            float t = age / 0.6;
            float gap = mix(60.0, 12.0, t * t);
            if (abs(d - gap) < 60.0) light += mix(red, WHITE, 0.3) * glowLine(brackets(px, rect, gap, 48.0), 1.2) * 0.6 * swell(age, 0.15, 0.6);
        } else if (kind == FOCUS) {
            // The window's edge warms softly.
            light += red * 0.3 * focusWarmth(d, e);
        }
    }
    return light;
}

// A moving window's speed lines, which may shine: streaks of light back from its trailing edge across its width, and the
// flight path marker riding ahead of it, gone as soon as the window stops.
vec3 speedLines(vec2 px, Window w, vec3 red) {
    vec3 light = vec3(0.0);
    vec2 v = w.velocity;
    float speed = length(v);
    // Only a moving window pays for its lines (a loop count, not a
    // branch, so the work is skipped, not merely masked).
    for (int on = 0; on < (speed < 40.0 ? 0 : 1); on++) {
        float k = wakeStrength(w, 1200.0);
        vec4 r = w.rect;
        vec2 n = v / max(speed, 1e-3);
        vec2 side = vec2(-n.y, n.x);
        vec2 q = px - r.xy - r.zw * 0.5;
        float ext = 0.5 * (abs(n.x) * r.z + abs(n.y) * r.w);
        float wide = 0.5 * (abs(side.x) * r.z + abs(side.y) * r.w);
        float off = dot(q, side);
        float back = -dot(q, n) - ext;
        if (back > 0.0 && abs(off) < wide) {
            float lane = floor(off / 18.0);
            float seed = hash(vec2(lane, float(w.i) + 3.1));
            float start = seed * 40.0;
            float len = speed * (0.06 + 0.14 * hash(vec2(lane, 9.7)));
            float across = abs(fract(off / 18.0) - 0.5) * 18.0;
            float streak = step(0.35, seed) * step(start, back) * (1.0 - smoothstep(start, start + len, back))
                * (1.0 - smoothstep(0.5, 1.4, across));
            light += mix(red, WHITE, 0.55 + 0.4 * seed) * streak * 1.2 * k;
            light += red * exp(-back / (speed * 0.12)) * 0.22 * k;
        }
        // The flight path marker: a ring with wings and a fin, ahead of
        // the leading edge, as present as the speed, drawn only within its
        // glow's reach past its 25 px wings.
        vec2 m = px - (r.xy + r.zw * 0.5 + n * (ext + 50.0 + speed * 0.02));
        if (length(m) > 25.0 + glowReach(0.42, 7.0)) continue;
        float ring = abs(length(m) - 9.0);
        float wings = abs(m.y) + max(abs(abs(m.x) - 17.0) - 8.0, 0.0);
        float fin = abs(m.x) + max(abs(m.y + 13.0) - 4.0, 0.0);
        float marker = glowLine(min(ring, min(wings, fin)), 1.4);
        light += mix(red, WHITE, 0.7) * marker * smoothstep(150.0, 600.0, speed) * 1.3 * w.alpha;
    }
    return light;
}


vec4 backdrop(vec2 px) {
    vec3 red = accent;
    float horizon = resolution.y * 0.42;
    vec3 light = vec3(0.0);

    // One pass over the windows: the nearest edge, how near any is, how much
    // window there is, their shadows on the floor (cast toward the viewer
    // from the horizon, further and softer with lift), and faint corner
    // brackets 22 to 31 px out (lit to their glow's 31 px) on every window
    // but the focused one, which the lock frame holds. The floor's lanes bow
    // out round each window's foot (`bend`, pixels across). And a moving
    // window's speed lines.
    Seen seen = UNSEEN;
    float near = 0.0, shadow = 0.0, bend = 0.0;
    vec3 speeding = vec3(0.0);
    vec2 vanish = vec2(resolution.x * 0.5, horizon);
    uint left = windowsAt(px);
    for (int i = -1; next(left, i);) {
        Window w = window(px, i);
        see(seen, w);
        float a = w.alpha, d = w.d;
        float e = exp(-max(d, 0.0) / 120.0);
        near += e;
        vec4 r = w.rect;
        float lift = w.lift;
        shadow = max(shadow, windowShadow(px, w, vec2(0.0, 1.0), 26.0 + 44.0 * lift, 18.0 + 34.0 * lift));
        if (i != focusedIndex && abs(edgeDistance(w) - 22.0) < 54.0 + w.rounding) light += red * glowLine(brackets(px, r, 22.0, 34.0), 1.0) * 0.4 * a;
        float side = px.x < r.x + r.z * 0.5 ? -1.0 : 1.0;
        bend += side * 34.0 * e * e * smoothstep(r.y, r.y + r.w, px.y) * (1.0 - 0.6 * lift) * a;
        speeding += speedLines(px, w, red);
    }
    // Only a window standing on the floor (its foot below the horizon) has
    // floor lines, and they run on from the corner, never back, past its
    // reach: every window is met for them, below the horizon.
    for (int i = 0; i < (px.y > horizon ? windowCount : 0); i++) {
        Window w = window(px, i);
        vec4 r = w.rect;
        float foot = r.y + r.w;
        for (int k = 0; k < (px.y > foot && foot > horizon ? 2 : 0); k++) {
            vec2 corner = vec2(r.x + r.z * float(k), foot);
            vec2 dir = normalize(corner - vanish + vec2(0.0, 1e-3));
            float off = abs(dot(px - corner, vec2(-dir.y, dir.x)));
            if (off > glowReach(0.04, 20.0)) continue;
            float run = dot(px - corner, dir);
            light += red * (glowLine(off, 1.0) * 0.5 + 0.04 * exp(-off / 20.0)) * exp(-max(run, 0.0) / 260.0) * step(0.0, run) * w.alpha;
        }
    }
    float nearest = seen.nearest;
    float shade = 1.0 - 0.85 * shadow;
    float lit;
    vec3 answered = answers(px, red, horizon, lit) + speeding;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    // Behind a window's glass, and the bar's, only a trace of the light shows.
    float veil = mix(1.0, 0.16, max(inside, step(px.y, reserved.x)));
    near = min(near, 1.0);

    // The floor: a red dot at every crossing of a grid, in perspective,
    // coming toward the viewer a cell a second (16 cells every 16 seconds,
    // so the hourly wrap moves it by whole cells). Dots too close together to
    // draw cleanly fade out toward the horizon.
    float below = px.y - horizon;
    if (below > 0.0) {
        float drive = cycle(16.0) * 16.0;
        float depth = CAMERA * resolution.y / below;
        // A dragged window pulls the floor after it (in cells, so near rows
        // shift more); the lanes bow round the windows' feet.
        float lean = focusVelocity().x * 0.0006;
        vec2 fp = vec2(px.x - bend, px.y);
        vec2 cell = vec2((fp.x - resolution.x * 0.5) * CAMERA / below + lean, depth + drive);
        // The nearest dot projected back onto the screen, so every dot is
        // round wherever the floor slants away.
        vec2 c = floor(cell + 0.5);
        float dotBelow = CAMERA * resolution.y / (c.y - drive);
        vec2 dotAt = vec2(resolution.x * 0.5 + (c.x - lean) * dotBelow / CAMERA, horizon + dotBelow);
        float radius = clamp(0.06 * below / CAMERA, 0.6, 2.6);
        float dot_ = 1.0 - smoothstep(radius - 0.6, radius + 0.6, length(fp - dotAt));
        // Where rows crowd closer than a few pixels the dots give way to
        // their average, a faint red sheen running into the horizon.
        float rows = below * below / (CAMERA * resolution.y);
        float clean = smoothstep(1.7, 4.0, rows);
        float fade = exp(-depth / 140.0);
        // What lit the floor flares its dots toward white.
        vec3 tint = mix(red, WHITE, min(lit * 0.25, 0.7));
        light += tint * (dot_ * clean + 0.05 * (1.0 - clean)) * fade * (0.5 + 0.6 * near + lit) * veil * shade;
        light += red * 0.04 * lit * fade * veil * shade;

        // Streaks of speed: in a few lanes between the dots, a white dash
        // races in from the distance every three seconds.
        float lane = floor(cell.x);
        float seed = hash(vec2(lane, 5.3));
        if (seed > 0.86) {
            float head = (1.0 - fract(cycle(3.0) + seed * 9.0)) * 160.0;
            float behind = depth - head;
            float across = abs(fract(cell.x) - 0.5) * below / CAMERA;
            float dash = step(0.0, behind) * exp(-behind / 8.0) * (1.0 - smoothstep(0.4, 1.2, across));
            light += mix(red, WHITE, 0.6) * dash * fade * 0.6 * veil * shade;
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
        float on = focusedIndex < 0 ? inside : 1.0 - smoothstep(-1.0, 1.0, edgeDistance(window(px, focusedIndex)));
        // The windows' summed opacity, a fact of the desktop, not of px.
        float present = 0.0;
        for (int i = 0; i < windowCount; i++) present += window(px, i).alpha;
        float shown = mix(1.0, 0.35 * focusAlpha * on, min(present, 1.0));
        // Off the window it lies on it shows nothing, so it is not worked out.
        if (shown > 0.0) {
            vec2 d = wedge(px, at, size);
            light += mix(red, WHITE, 0.65) * glowLine(d.x, 1.3) * shown;
            light += red * glowLine(d.y, 1.0) * 0.4 * shown;
        }
    }

    // The lock frame: fine light brackets close round the focused window,
    // as present as the focus, so it fades with a closing window.
    if (focusAlpha > 0.0) {
        float d = brackets(px, focused, 12.0, 48.0);
        light += mix(red, WHITE, 0.3) * glowLine(d, 1.2) * 0.8 * focusAlpha;
    }

    // The answers read through the glass more than the scene does: more than
    // half their light shows behind it.
    light += answered * mix(1.0, 0.6, inside);

    // The glass catches the cockpit's light: behind each window the world
    // draws the sheen on it, the streak and the horizon's glow along its
    // upper glass. Only the glass shows it; the window's text stays over it.
    int over = seen.over;
    if (over >= 0) {
        Window o = window(px, over);
        vec4 r = o.rect;
        float top = exp(-(px.y - r.y) / 90.0);
        light += mix(red, WHITE, 0.5) * (0.07 * glassStreak(px, r) + 0.09 * top) * o.alpha;
    }

    // The bar's lower edge: a red line with a white marker sweeping along it,
    // starting and ending off screen so its wrap never shows.
    float underBar;
    if (atBar(px, underBar)) {
        float edge = glowLine(abs(underBar), 1.1);
        float marker = exp(-abs(px.x + 300.0 - cycle(8.0) * (resolution.x + 600.0)) / 45.0);
        light += red * edge * 0.8;
        light += WHITE * edge * marker * 2.5;
        light += red * 0.05 * step(underBar, 0.0);
    }

    // Bright light saturates toward white, as it does on film.
    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a cockpit display's bezel. A
// fine, quiet red line traces it, as the border was, brighter on the side
// facing the horizon it is lit from and as focus lifts it; the floor bends
// through its outer pixels; light passing behind the window, a ring or a
// warming focus, runs into the line; and the window glows a little red, as
// Hyprland's shadow made it.
vec4 frame(vec2 px, Window w) {
    vec4 r = w.rect;
    float d = edgeDistance(w);
    if (d < -2.0 || d > 20.0) return vec4(0.0);
    bool focus = w.i == focusedIndex;
    vec3 tint = focus ? vec3(1.0, 0.18, 0.18) : vec3(0.42, 0.12, 0.12);
    vec3 col = accent * exp(-max(d, 0.0) / 8.0) * step(0.0, d) * (focus ? 0.2 : 0.05);
    float a = 0.0;
    if (d < 10.0) {
        vec2 n = edgeNormal(px, r, w.rounding);
        float horizon = resolution.y * 0.42;
        float toward = 0.55 + 0.45 * max(dot(n, vec2(0.0, r.y + r.w * 0.5 > horizon ? -1.0 : 1.0)), 0.0);
        // One look at the world 12 px in behind the glass: what the edge
        // bends into view, and what light is passing there.
        vec3 behind = worldAt(px - n * 12.0).rgb;
        float passing = smoothstep(0.05, 0.25, dot(behind, vec3(0.3, 0.5, 0.2)));
        float line = glowLine(abs(d - 0.5), 0.9) * toward * (focus ? 0.55 : 0.5) * (1.0 + 0.6 * w.lift);
        float edge = glassSide(d, 4.0);
        col += behind * 1.2 * edge * 0.85 + tint * line + mix(tint, WHITE, 0.5) * line * passing * 2.0;
        a = clamp(max(edge * 0.85, line * (1.0 + passing)), 0.0, 1.0);
    }
    return vec4(col, a);
}
