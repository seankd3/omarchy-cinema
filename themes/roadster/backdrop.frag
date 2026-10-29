// Roadster: the 2026 Roadster's cockpit, drawn like a fighter jet's display.
// A floor of red dots runs out to a thin white horizon and rushes toward the
// viewer, with streaks of speed along it. A wireframe wedge turns slowly on
// the floor behind the focused window and glides after it. Every window sits
// in faint red corner brackets; a tighter, brighter lock frame holds the
// focused one, slides to the next window when focus moves, and fades as the
// focus does.
//
// The windows stand on the floor in the horizon's light (specs/depth.md):
// each shadows the dots and streaks toward the viewer, further and softer as
// focus lifts it. A moving window throws speed lines back from its trailing
// edge, and a flight path marker rides ahead of it. The floor lights up
// round the pointer. Opening slams target brackets in from far out onto the
// window, focus locks on with a white flash and a ping across the floor,
// landing bounces the horizon and sends a shock through the dots, closing is
// a kill: a ring, a burst of ticks and a flash. Typing leaves small hit
// markers at the window's foot, quiet enough that steady typing never
// flickers.
//
// The windows and the floor are one scene. The floor's lanes bow out round
// each window's foot, so the dots and the speed streaks route round it, and
// the floor's own lines run from each foot's corners toward the viewer. The
// viewer leans toward the pointer and a dragged window pulls the floor after
// it, near rows more than far ones. Behind each window the world draws the
// sheen on its glass, a streak that slides as the window moves and the
// horizon's glow along its upper glass. Each window's edge is the cockpit's
// (frame()): a fine, quiet red line as the border was, lit from the horizon,
// the floor bending through its outer pixels, and light passing behind it,
// a lock flash or a shock, running into it.

const vec3 WHITE = vec3(1.0, 0.94, 0.94);
// The brightest the scene is behind the glass, a channel each. With the glass
// at 0.55 over #070404 and Omarchy's 0.75 blur brightness, colors.toml's muted
// (#a08a8a) keeps 4.8:1 over anything up to this: red lines keep their colour,
// a white flash turns red behind the text.
const vec3 UNDER_GLASS = vec3(0.6, 0.3, 0.3);
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

// What happened lately that the whole cockpit feels: how far a landing
// bounces the horizon (x, pixels), how hard the lock frame flashes (y) and
// the horizon flares (z). The same at every point.
vec3 moments() {
    vec3 m = vec3(0.0);
    // Newest first: the ring is newest last, so past the first one older
    // than the longest answer (a landing's, 1.6 s) every one is.
    for (int k = impulseCount - 1; k >= 0; k--) {
        float age = impulses[k].z, s = impulses[k].w;
        int kind = impulseKinds[k];
        if (age > 1.6) break;
        if (kind == LAND) {
            m.x += sin(age * 38.0) * exp(-age * 5.0) * 24.0 * s;
            m.z += 1.5 * exp(-age * 6.0) * s;
        } else if (kind == FOCUS || kind == OPEN) {
            // The lock closes 0.25 s after focus, 0.45 s after opening.
            float at = kind == FOCUS ? 0.25 : 0.45;
            float flash = step(at, age) * exp(-(age - at) * 6.0);
            m.y += 2.5 * flash * (kind == FOCUS ? s : 1.0);
            m.z += flash;
        }
    }
    return m;
}

// The cockpit answering what happened lately, at px: the light it draws,
// and how much it lights the floor's dots (`lit`).
vec3 answers(vec2 px, vec3 red, float ground, out float lit) {
    vec3 light = vec3(0.0);
    lit = 0.0;
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.6) break;
        if (kind == TYPE) {
            vec2 q = px - e.xy;
            if (age > 0.45 || dot(q, q) > 4900.0) continue;
            // A hit marker: four short ticks on the diagonals, opening out
            // and fading, in a little red glow. Typing is steady, so it does
            // not flash.
            vec2 f = abs(q);
            float along = (f.x + f.y) * 0.7071;
            float off = abs(f.x - f.y) * 0.7071;
            float r0 = 10.0 + age * 50.0;
            float fade = 1.0 - age / 0.45;
            float tick = (1.0 - smoothstep(0.6, 1.6, off)) * smoothstep(r0 - 1.0, r0, along) * (1.0 - smoothstep(r0 + 9.0, r0 + 10.0, along));
            light += mix(red, WHITE, 0.55) * tick * fade * 1.6 * e.w;
            light += red * exp(-length(q) / 22.0) * fade * 0.35 * e.w;
            continue;
        }
        if (kind == CLOSE) {
            vec2 q = px - e.xy;
            float r = length(q);
            if (age > 1.0 || r > age * 1400.0 + 200.0) continue;
            // A kill: a red ring blasting out, four ticks flung out on the
            // diagonals, a white flash where the window was.
            float R = age * 1400.0;
            float fade = exp(-age * 3.0);
            light += red * (glowLine(abs(r - R), 2.0) * 1.4 + 0.4 * exp(-abs(r - R) / 40.0)) * fade;
            vec2 f = abs(q);
            float along = (f.x + f.y) * 0.7071;
            float off = abs(f.x - f.y) * 0.7071;
            float r0 = 20.0 + age * 700.0;
            light += WHITE * (1.0 - smoothstep(0.8, 2.0, off)) * step(r0, along) * step(along, r0 + 40.0) * fade * 1.6;
            light += WHITE * exp(-r / 26.0) * exp(-age * 7.0) * 3.0;
            lit += 3.0 * exp(-abs(r - R) / 50.0) * fade;
            continue;
        }
        if (age > (kind == LAND ? 1.6 : kind == OPEN ? 1.0 : kind == FOCUS ? 1.0 : 0.0)) continue;
        int i = windowAt(e.xy);
        vec4 rect = i < 0 ? vec4(e.xy, 0.0, 0.0) : windowRect(i);
        if (kind == LAND) {
            // Touchdown: a shock runs out through the floor from the
            // window's foot, flaring the dots as it passes.
            // The seams round it flash with the impact.
            float d = rectDistance(px, rect, 0.0);
            light += mix(red, WHITE, 0.3) * exp(-max(d, 0.0) / 45.0) * step(0.0, d) * exp(-age * 5.0) * 1.6 * e.w;
            vec2 foot = vec2(clamp(px.x, rect.x, rect.x + rect.z), rect.y + rect.w);
            float r = length((px - foot) * vec2(1.0, 2.4));
            float front = abs(r - age * 900.0);
            if (front > 400.0 || px.y < ground) continue;
            float fade = exp(-age * 2.2) * e.w;
            lit += 6.0 * exp(-front / 40.0) * fade;
            light += red * (glowLine(front, 2.0) * 1.0 + 0.45 * exp(-front / 60.0)) * fade;
            continue;
        }
        float d = rectDistance(px, rect, 0.0);
        if (d < -2.0 || d > 700.0) continue;
        // Target brackets slamming in onto the window, from far out for a
        // new one, closer for a focus; then a ping rolls out across the
        // floor as the lock closes.
        float at = kind == FOCUS ? 0.25 : 0.45;
        if (age < at) {
            float t = age / at;
            float gap = mix(kind == FOCUS ? 110.0 : 300.0, 12.0, t * t);
            float slam = 0.5 + t;
            if (abs(d - gap) < 60.0) light += mix(red, WHITE, 0.5) * glowLine(brackets(px, rect, gap, mix(90.0, 48.0, t)), 1.6) * slam * 1.4;
            light += red * exp(-max(d - gap, 0.0) / 30.0) * step(d, gap + 4.0) * slam * 0.12;
        } else {
            float since = age - at;
            float front = abs(d - since * 900.0);
            float fade = exp(-since * 3.0) * (kind == FOCUS ? e.w : 1.0);
            if (front < 240.0) {
                light += red * (glowLine(front, 1.6) + 0.35 * exp(-front / 40.0)) * fade;
                lit += 4.0 * exp(-front / 50.0) * fade;
            }
            light += WHITE * exp(-max(d, 0.0) / 20.0) * exp(-since * 8.0) * 1.2;
        }
    }
    return light;
}

// A moving window's speed lines: streaks of light back from its trailing
// edge across its width, and the flight path marker riding ahead of it.
vec3 speedLines(vec2 px, vec3 red) {
    vec3 light = vec3(0.0);
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        // Only a moving window pays for its lines (a loop count, not a
        // branch, so the work is skipped, not merely masked).
        for (int on = 0; on < (speed < 40.0 ? 0 : 1); on++) {
            float k = min(speed / 1200.0, 1.0) * windowAlpha(i) * smoothstep(0.0, 3.0, windowDistance(px, i));
            vec4 r = windowRect(i);
            vec2 n = v / max(speed, 1e-3);
            vec2 side = vec2(-n.y, n.x);
            vec2 q = px - r.xy - r.zw * 0.5;
            float ext = 0.5 * (abs(n.x) * r.z + abs(n.y) * r.w);
            float wide = 0.5 * (abs(side.x) * r.z + abs(side.y) * r.w);
            float u = dot(q, n), w = dot(q, side);
            float back = -u - ext;
            if (back > 0.0 && abs(w) < wide) {
                float lane = floor(w / 18.0);
                float seed = hash(vec2(lane, float(i) + 3.1));
                float start = seed * 40.0;
                float len = speed * (0.06 + 0.14 * hash(vec2(lane, 9.7)));
                float across = abs(fract(w / 18.0) - 0.5) * 18.0;
                float streak = step(0.35, seed) * step(start, back) * (1.0 - smoothstep(start, start + len, back))
                    * (1.0 - smoothstep(0.5, 1.4, across));
                light += mix(red, WHITE, 0.55 + 0.4 * seed) * streak * 1.2 * k;
                light += red * exp(-back / (speed * 0.12)) * 0.22 * k;
            }
            // The flight path marker: a ring with wings and a fin, ahead of the
            // leading edge, as present as the speed.
            vec2 m = px - (r.xy + r.zw * 0.5 + n * (ext + 50.0 + speed * 0.02));
            float ring = abs(length(m) - 9.0);
            float wings = abs(m.y) + max(abs(abs(m.x) - 17.0) - 8.0, 0.0);
            float fin = abs(m.x) + max(abs(m.y + 13.0) - 4.0, 0.0);
            float marker = glowLine(min(ring, min(wings, fin)), 1.4);
            light += mix(red, WHITE, 0.7) * marker * smoothstep(150.0, 600.0, speed) * 1.3 * windowAlpha(i);
        }
    }
    return light;
}

vec4 backdrop(vec2 px) {
    vec3 red = accent;
    float horizon = resolution.y * 0.42;
    vec3 light = vec3(0.0);
    vec3 moment = moments();
    // The floor and the horizon, as a landing bounces them.
    float ground = horizon + moment.x;

    // One pass over the windows: the nearest edge, how near any is, how much
    // window there is, their shadows on the floor (cast toward the viewer
    // from the horizon, further and softer with lift), and faint corner
    // brackets on every window but the focused one, which the lock frame
    // holds.
    // The floor's lanes bow out round each window's foot (`bend`, pixels
    // across), and its lines run from the foot's corners toward the viewer.
    float nearest = FAR, near = 0.0, present = 0.0, shadow = 0.0, bend = 0.0;
    int closest = -1;
    vec2 vanish = vec2(resolution.x * 0.5, ground);
    for (int i = 0; i < windowCount; i++) {
        float a = windowAlpha(i), d = windowDistance(px, i);
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
        near += exp(-max(d, 0.0) / 120.0);
        present += a;
        vec4 r = windowRect(i);
        float lift = windowLift(i);
        shadow = max(shadow, windowShadow(px, i, vec2(0.0, 26.0 + 44.0 * lift), 18.0 + 34.0 * lift));
        if (i != focusedIndex) light += red * glowLine(brackets(px, r, 22.0, 34.0), 1.0) * 0.4 * a;
        float foot = r.y + r.w;
        float side = px.x < r.x + r.z * 0.5 ? -1.0 : 1.0;
        bend += side * 34.0 * exp(-max(d, 0.0) / 60.0) * smoothstep(r.y, foot, px.y) * (1.0 - 0.6 * lift) * a;
        // Only a window standing on the floor (its foot below the horizon)
        // has floor lines, and they run on from the corner, never back.
        for (int k = 0; k < (px.y > foot && foot > ground ? 2 : 0); k++) {
            vec2 corner = vec2(r.x + r.z * float(k), foot);
            vec2 dir = normalize(corner - vanish + vec2(0.0, 1e-3));
            float off = abs(dot(px - corner, vec2(-dir.y, dir.x)));
            float run = dot(px - corner, dir);
            light += red * (glowLine(off, 1.0) * 0.5 + 0.04 * exp(-off / 20.0)) * exp(-max(run, 0.0) / 260.0) * step(0.0, run) * a;
        }
    }
    float shade = 1.0 - 0.85 * shadow;
    float lit;
    vec3 answered = answers(px, red, ground, lit) + speedLines(px, red);
    // The floor lights up round the pointer.
    lit += 1.6 * exp(-length((px - pointer.xy) * vec2(1.0, 1.6)) / 200.0);
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    // Behind a window's glass, and the bar's, only a trace of the light shows.
    float veil = mix(1.0, 0.16, max(inside, step(px.y, reserved.x)));
    near = min(near, 1.0);
    present = min(present, 1.0);

    // The floor: a red dot at every crossing of a grid, in perspective,
    // coming toward the viewer a cell a second (16 cells every 16 seconds,
    // so the hourly wrap moves it by whole cells). Dots too close together to
    // draw cleanly fade out toward the horizon.
    float below = px.y - ground;
    if (below > 0.0) {
        float drive = cycle(16.0) * 16.0;
        float depth = CAMERA * resolution.y / below;
        // The viewer leans toward the pointer and a dragged window pulls the
        // floor after it (in cells, so near rows shift more); the lanes bow
        // round the windows' feet.
        float lean = (pointer.x / resolution.x - 0.5) * 1.2
            + (focusedIndex < 0 ? 0.0 : windowVelocity(focusedIndex).x * 0.0007);
        vec2 fp = vec2(px.x - bend, px.y);
        vec2 cell = vec2((fp.x - resolution.x * 0.5) * CAMERA / below + lean, depth + drive);
        // The nearest dot projected back onto the screen, so every dot is
        // round wherever the floor slants away.
        vec2 c = floor(cell + 0.5);
        float dotBelow = CAMERA * resolution.y / (c.y - drive);
        vec2 dotAt = vec2(resolution.x * 0.5 + (c.x - lean) * dotBelow / CAMERA, ground + dotBelow);
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
    float flare = 1.0 + moment.z;
    light += WHITE * glowLine(toHorizon, 0.9) * 0.55 * veil * flare;
    light += red * (0.18 * exp(-toHorizon / 40.0) + 0.05 * exp(-toHorizon / 300.0)) * veil * flare;

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
        light += mix(red, WHITE, 0.3 + 0.2 * min(moment.y, 1.0)) * glowLine(d, 1.2 + moment.y) * (0.8 + moment.y) * focusAlpha;
    }

    // The answers read through the glass more than the scene does: more than
    // half their light shows behind it.
    light += answered * mix(1.0, 0.6, inside);

    // The glass catches the cockpit's light: behind each window the world
    // draws the sheen on it, the streak and the horizon's glow along its
    // upper glass. Only the glass shows it; the window's text stays over it.
    if (closest >= 0 && nearest < 0.0) {
        vec4 r = windowRect(closest);
        float top = exp(-(px.y - r.y) / 90.0);
        light += mix(red, WHITE, 0.5) * (0.07 * glassStreak(px, r) + 0.09 * top) * windowAlpha(closest);
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

    // Bright light saturates toward white, as it does on film; behind the
    // glass no channel goes past UNDER_GLASS, so secondary text keeps 4.5:1.
    vec3 col = background + (1.0 - exp(-light * 1.3));
    return vec4(mix(col, min(col, UNDER_GLASS), inside), 1.0);
}

// Each window's edge (specs/depth.md, part 2): a cockpit display's bezel. A
// fine, quiet red line traces it, as the border was, brighter on the side
// facing the horizon it is lit from and as focus lifts it; the floor bends
// through its outer pixels; light passing behind the window, a lock flash,
// a shock or a kill, runs into the line; and the window glows a little red,
// as Hyprland's shadow made it.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 20.0) return vec4(0.0);
    bool focus = i == focusedIndex;
    vec3 tint = focus ? vec3(1.0, 0.18, 0.18) : vec3(0.42, 0.12, 0.12);
    vec3 col = accent * exp(-max(d, 0.0) / 8.0) * step(0.0, d) * (focus ? 0.2 : 0.05);
    float a = 0.0;
    if (d < 10.0) {
        vec2 n = edgeNormal(px, r, rounding);
        float horizon = resolution.y * 0.42;
        float toward = 0.55 + 0.45 * max(dot(n, vec2(0.0, r.y + r.w * 0.5 > horizon ? -1.0 : 1.0)), 0.0);
        // One look at the world 12 px in behind the glass: what the edge
        // bends into view, and what light is passing there.
        vec3 behind = backdrop(px - n * 12.0).rgb;
        float passing = smoothstep(0.05, 0.25, dot(behind, vec3(0.3, 0.5, 0.2)));
        float line = glowLine(abs(d - 0.5), 0.9) * toward * (focus ? 0.55 : 0.5) * (1.0 + 0.6 * windowLift(i));
        float edge = (1.0 - smoothstep(0.0, 4.0, d)) * smoothstep(-2.0, 0.0, d);
        col += behind * 1.2 * edge * 0.85 + tint * line + mix(tint, WHITE, 0.5) * line * passing * 2.0;
        a = clamp(max(edge * 0.85, line * (1.0 + passing)), 0.0, 1.0);
    }
    return vec4(col, a) * windowAlpha(i);
}
