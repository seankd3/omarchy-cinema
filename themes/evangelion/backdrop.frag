// Evangelion: NERV's displays. A honeycomb of hexagonal cells lies across
// the dark and wakes like an AT field around the windows: cells light orange
// along every window's edge and in the seams between windows, brightest at
// the focused window, and octagonal rings ripple out from the focused window,
// lighting the cells they pass. Far behind, a larger lattice in Unit-01's
// purple shifts against it as focus moves, for depth.
//
// The windows stand in the field (specs/depth.md). It holds them: its cells
// pack tighter and glow brighter toward each window's edge. Lit from above,
// each window casts a shadow on the honeycomb, further and softer as focus
// lifts it, and the light lies on its glass. Each is edged by its own AT
// field, which catches the light passing behind the glass. The honeycomb is
// nearer than the far lattice, so it shifts more as the pointer moves and as
// a window is dragged. And the field answers the desktop: a window landing or
// opening flares AT field rings out from its edge, closing collapses one into
// where it was, focus throws a field round the window, a moving window sets
// the honeycomb rippling and lighting cell by cell round it and in its wake,
// typing pulses the cells under the window, and the field breathes with your
// voice.

const vec3 RED = vec3(1.0, 0.16, 0.08);
const vec3 PURPLE = vec3(0.40, 0.20, 0.85);
const vec3 GREEN = vec3(0.55, 0.92, 0.22);
const vec3 WHITE_HOT = vec3(1.0, 0.86, 0.62);
const float CELL = 28.0; // honeycomb spacing in pixels: two cells span a gap
// Where NERV's light comes from: above, a little to the left. Shadows fall
// away from it and the frames are brightest facing it.
const vec2 LIGHT = vec2(-0.34, -0.94);
// The brightest any light is behind the glass, in every channel. colors.toml's
// muted (#b38c72) keeps 4.5:1 over a glass of relative luminance 0.0268 or
// less; glass 0.5 over #0c090e with Omarchy's 0.75 blur brightness stays under
// that while the light behind it is at most 0.36 a channel, whatever its hue.
const float UNDER_GLASS = 0.36;
// How far outside a window Hyprland's blur (frost 3, two passes) gathers
// light into the window's glass, in pixels: the field's answers are held to
// the glass's limit that close to it, and the frame, drawn over the window
// rather than blurred into it, carries the light at the edge.
const float BLUR_REACH = 22.0;

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow.
float glowLine(float d, float w) {
    return (1.0 - smoothstep(0.0, w, d)) + 0.25 * exp(-d / (w * 5.0));
}

// The flat-topped hexagon of a honeycomb `size` pixels apart that holds px:
// its centre (xy) and how far px is inside its edge (z), in pixels.
vec3 hexCell(vec2 px, float size) {
    vec2 p = px.yx / size;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float inside = 0.5 - max(abs(g.x), dot(abs(g), vec2(0.5, 0.8660254)));
    return vec3((p - g).yx * size, inside * size);
}

// Distance from a centre whose level lines are regular octagons, the shape
// of an AT field.
float octagon(vec2 p) {
    p = abs(p);
    return max(max(p.x, p.y), (p.x + p.y) * 0.70710678);
}

// Distance from a rect's edge whose level lines outside it are the rect with
// its corners cut at 45 degrees: the AT field a window throws. Negative
// inside.
float fieldDistance(vec2 px, vec4 rect) {
    vec2 q = abs(px - rect.xy - rect.zw * 0.5) - rect.zw * 0.5;
    return max(q.x, q.y) > 0.0 ? octagon(max(q, 0.0)) : max(q.x, q.y);
}

// Distance from the outline of a rect grown by `grow`, its corners cut at 45
// degrees `cut` pixels along each side: an AT field's wall round a window.
float wallDistance(vec2 px, vec4 rect, float grow, float cut) {
    vec2 q = abs(px - rect.xy - rect.zw * 0.5) - rect.zw * 0.5 - grow;
    return max(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0), (q.x + q.y + cut) * 0.70710678);
}

// The way out of a rect's edge at px, rounded by `radius`.
vec2 outward(vec2 px, vec4 rect, float radius) {
    vec2 c = px - rect.xy - rect.zw * 0.5;
    vec2 q = abs(c) - rect.zw * 0.5 + radius;
    vec2 n = q.x > 0.0 && q.y > 0.0 ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return n * sign(c + 1e-6);
}

// The window an impulse happened to: the one holding its point whose middle
// is nearest it (an impulse is at a window's middle or on its lower edge),
// or the point itself once the window has gone.
vec4 impulseRect(vec2 at) {
    vec4 found = vec4(at, 0.0, 0.0);
    float best = FAR;
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        float d = length(at - r.xy - r.zw * 0.5);
        if (rectDistance(at, r, 0.0) < 1.0 && d < best) {
            best = d;
            found = r;
        }
    }
    return found;
}

// The light on window i's glass at px: NERV's light lying along the upper
// glass, brightest toward it, and a soft diagonal streak that slides across
// the pane as the window moves, as a reflection does. Only the glass shows
// it, so it is never over text.
vec3 sheen(vec2 px, int i) {
    vec4 r = windowRect(i);
    vec2 at = px - r.xy;
    float upper = exp(-at.y / 70.0) * (1.0 - 0.4 * at.x / r.z);
    float streak = dot(at, vec2(0.70710678)) / (r.z + r.w) * 1.2 + dot(r.xy, vec2(0.70710678)) / (resolution.x + resolution.y) * 0.8;
    float band = exp(-pow((fract(streak + 0.2) - 0.5) * 7.0, 2.0));
    return WHITE_HOT * (0.06 * upper + 0.05 * band) * windowAlpha(i);
}

// The field answering what happened at px, whose honeycomb cell is centred
// at `cell`: the light of its rings and walls (rgb) and how much the cell
// itself lights (a).
vec4 answers(vec2 px, vec2 cell) {
    vec3 ring = vec3(0.0);
    float lit = 0.0;
    // Newest first: the ring is in the order things happened, so once one is
    // older than the longest answer (1.5 s) every one before it is too.
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.5) break;
        if (kind == TYPE) {
            // The cells round the key pulse, and a small ring leaves them.
            if (age > 0.7 || length(px - e.xy) > 220.0) continue;
            float pulse = smoothstep(0.0, 0.06, age) * exp(-age * 4.5) * e.w;
            lit += 5.0 * pulse * exp(-length(cell - e.xy) / 26.0);
            ring += accent * 0.5 * pulse * glowLine(abs(octagon(px - e.xy) - 40.0 - age * 220.0), 1.2);
        } else if (kind == LAND || kind == OPEN || kind == VOICE) {
            // AT field rings flare out from the window's edge: three on
            // landing, harder the faster it came; one as it opens, slowing as
            // the field unfolds; a broad slow one as you start to speak.
            vec4 r = impulseRect(e.xy);
            float f = fieldDistance(px, r);
            float reach = kind == LAND ? age * 1300.0 : kind == OPEN ? 340.0 * (1.0 - exp(-age * 3.2)) : age * 520.0;
            if (f < -2.0 || f > reach + 120.0) continue;
            float fc = fieldDistance(cell, r);
            float fade = exp(-age * (kind == VOICE ? 1.6 : 2.0)) * (kind == LAND ? 0.6 + 0.6 * e.w : 1.0) * (1.0 - smoothstep(1.0, 1.5, age));
            vec3 tint = mix(mix(WHITE_HOT, accent, min(age * 4.0, 1.0)), RED, min(age * 0.8, 1.0));
            float width = kind == VOICE ? 3.0 : 1.6;
            // Behind the outer front a soft wash, so the field carries
            // through frosted glass as well as in the seams, and the cells
            // it has crossed stay lit, fading.
            float behind = reach - f;
            ring += tint * fade * 0.35 * exp(-behind / 90.0) * step(0.0, behind);
            lit += 1.8 * fade * exp(-(reach - fc) / 420.0) * step(0.0, fc) * step(fc, reach);
            // Each front is a crisp ring, and the cells it crosses burn.
            int count = kind == LAND ? 3 : 1;
            for (int j = 0; j < count; j++) {
                float at = reach - float(j) * 70.0;
                if (at < 0.0) break;
                float strength = fade * (1.0 - 0.25 * float(j));
                if (abs(at - f) < 40.0) ring += tint * strength * glowLine(abs(at - f), width);
                if (abs(at - fc) < 140.0) lit += 2.6 * strength * exp(-abs(fc - at) / 34.0);
            }
            // The flash where the field leaves the window.
            if (kind != VOICE) ring += WHITE_HOT * 1.6 * fade * exp(-max(f, 0.0) / 30.0) * exp(-age * 4.0);
        } else if (kind == CLOSE) {
            // The field collapses into where the window was, red, and the
            // cells it crosses flicker out.
            if (age > 0.9) continue;
            float left = 1.0 - age / 0.9;
            float at = 760.0 * left * left;
            float f = octagon(px - e.xy);
            if (f > at + 200.0) continue;
            float fc = octagon(cell - e.xy);
            ring += mix(RED, accent, left) * left * (glowLine(abs(f - at), 1.6) + 0.3 * exp(-abs(f - at) / 60.0));
            lit += 2.0 * left * exp(-abs(fc - at) / 30.0);
            ring += RED * 2.0 * exp(-f / 50.0) * exp(-abs(age - 0.85) * 14.0);
        } else if (kind == FOCUS) {
            // Focus throws a field round the window: a wall springs out from
            // its edge and the cells along it flare.
            if (age > 1.2) continue;
            vec4 r = impulseRect(e.xy);
            float f = fieldDistance(px, r);
            if (f < -2.0 || f > 400.0) continue;
            float fc = fieldDistance(cell, r);
            float at = 20.0 + 150.0 * (1.0 - exp(-age * 6.0));
            float fade = exp(-age * 3.0) * e.w;
            ring += mix(WHITE_HOT, accent, min(age * 5.0, 1.0)) * fade * (1.6 * glowLine(abs(f - at), 1.8) + 0.4 * exp(-abs(f - at) / 40.0) * step(f, at));
            lit += 2.4 * fade * exp(-abs(fc - at) / 40.0) + 1.2 * fade * exp(-max(fc, 0.0) / 60.0);
        }
    }
    return vec4(ring, lit);
}

vec4 backdrop(vec2 px) {
    vec3 orange = accent;

    // The windows at px: the nearest one's distance, the topmost whose glass
    // px is behind, their shadows, falling away from the light, further and
    // softer the more focus lifts a window, and the field's hold on them: the
    // honeycomb packs tighter toward each window's edge, its cells smallest
    // there, and lets go as a window fades (held.xy is the shift from the
    // screen to the honeycomb, held.z how tightly it packs).
    float nearest = FAR, shadow = 0.0;
    int pane = -1;
    vec3 held = vec3(0.0);
    for (int i = 0; i < windowCount; i++) {
        vec4 r = windowRect(i);
        float d = windowDistance(px, i);
        nearest = min(nearest, d);
        if (d < 0.0) pane = i;
        float beyond = max(d, 0.0);
        float grip = exp(-beyond / 70.0);
        held += vec3(outward(px, r, windowRounding(i)) * 0.7 * beyond, 1.0) * grip;
        float lift = windowLift(i);
        float soft = 18.0 + 40.0 * lift;
        float s = rectDistance(px + LIGHT * (24.0 + 44.0 * lift), r, windowRounding(i));
        shadow = max(shadow, (1.0 - smoothstep(-soft, soft, s)) * windowAlpha(i));
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    // Behind a window's glass, and the bar's, only a trace of the field at
    // rest shows; its answers carry through.
    float glass = max(inside, step(px.y, reserved.x));
    float veil = mix(1.0, 0.14, glass);
    float shade = 1.0 - 0.85 * shadow;
    vec2 centre = focused.xy + focused.zw * 0.5;
    vec3 light = vec3(0.0);

    // The pointer and a dragged window move the viewpoint: the honeycomb, the
    // nearer layer, shifts against them by up to a few tens of pixels, the far
    // lattice by a third of that.
    vec2 drag = focusedIndex >= 0 ? windowVelocity(focusedIndex) : vec2(0.0);
    vec2 view = (pointer.xy - resolution * 0.5) * 0.012 + drag * 0.006;

    // Far behind: slow purple haze and a lattice three times the size, offset
    // against the focused window so it reads as deeper than the near one.
    float haze = noise(px * 0.0016 + orbit(180.0, 1.5)) * noise(px * 0.0045 - orbit(120.0, 2.0));
    vec3 far = hexCell(px + (centre - resolution * 0.5) * 0.05 + view * 0.35, CELL * 3.0);
    light += PURPLE * 0.1 * haze * haze;
    light += PURPLE * glowLine(far.z, 1.0) * (0.015 + 0.25 * haze) * veil;

    // The honeycomb cell holding px, found in the held, shifted honeycomb and
    // judged where it lies on the screen, so whole cells light.
    vec2 shift = held.xy + view;
    vec3 cell = hexCell(px + shift, CELL);
    cell.xy -= shift;

    // How awake the cell is: near any window's edge (inside or out, so seams
    // between windows add up) and most near the focused one. A moving window
    // sets it rippling: rings of cells light and run outward from the window,
    // and the cells where it has just been stay lit behind it, fading.
    float wake = 0.0, stir = 0.0;
    for (int i = 0; i < windowCount; i++) {
        wake += 0.6 * exp(-abs(windowDistance(cell.xy, i)) / 28.0);
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0) continue;
        float pace = min(speed / 1400.0, 1.0) * windowAlpha(i);
        vec4 r = windowRect(i);
        float fc = fieldDistance(cell.xy, r);
        if (fc < 0.0) continue;
        stir += 2.2 * pace * exp(-fc / 160.0) * pow(0.5 + 0.5 * cos(fc / 26.0 - cycle(1.0) * TAU * 3.0), 3.0);
        for (int k = 1; k <= 4; k++) {
            vec4 ghost = r;
            ghost.xy -= v * 0.03 * float(k);
            stir += (1.4 - 0.3 * float(k)) * pace * exp(-abs(fieldDistance(cell.xy, ghost)) / 26.0);
        }
    }
    float toFocus = abs(focusedWindow(cell.xy));
    wake += 2.0 * exp(-toFocus / 40.0) + 0.35 * exp(-toFocus / 500.0);
    // The field breathes with your voice, swelling out from the focused
    // window as you speak.
    wake += voice * (2.2 * exp(-toFocus / (60.0 + 140.0 * voice)) + 0.4 * exp(-toFocus / 600.0));

    // An octagonal ring leaves the focused window's centre every six seconds
    // and spreads for twelve, orange turning to red as it fades, a faint wash
    // behind its front. The cells it crosses light up. (A ring every two
    // seconds, twice as fast, kept the whole field moving: too busy to live
    // with all day.)
    float ringCell = octagon(cell.xy - centre);
    float ringPx = octagon(px - centre);
    float ripple = 0.0;
    vec3 rings = vec3(0.0);
    for (int k = 0; k < 2; k++) {
        float f = fract(cycle(12.0) + float(k) * 0.5);
        float r = f * 1800.0;
        float fade = (1.0 - f) * smoothstep(0.0, 0.05, f);
        float behind = r - ringPx;
        ripple += exp(-abs(ringCell - r) / 36.0) * fade;
        rings += mix(orange, RED, f) * (glowLine(abs(behind), 1.4) + 0.2 * exp(-behind / 40.0) * step(0.0, behind)) * fade;
    }
    light += rings * 1.3 * veil;
    light *= shade;

    // Each cell is a tile with a bright rim and a dark seam to its
    // neighbours. Awake cells glow steadily and swell together in broad
    // patches that drift slowly, so the field breathes instead of glittering
    // cell by cell; a few burn Unit-01 green. Where the field packs tight
    // round a window its rims glow brighter, as if holding the window.
    float seed = hash(cell.xy * 0.0137 + 0.31);
    float swell = smoothstep(0.25, 0.75, noise(cell.xy * 0.006 + orbit(30.0, 1.2)));
    float lit = min(wake, 2.5) * (0.5 + 0.7 * swell) + ripple * 1.6;
    vec3 tint = seed > 0.97 ? GREEN * 0.7 : orange;
    float tile = smoothstep(2.0, 3.5, cell.z);
    float rim = glowLine(abs(cell.z - 3.0), 0.9) * (1.0 + 0.5 * min(held.z, 1.0));
    light += orange * glowLine(cell.z, 0.8) * 0.035;
    light += tint * (tile * 0.06 + rim * 0.3) * lit * veil * shade;

    // A cell the field's answer reaches burns whole, its rim near white, and
    // through the glass too, where its tile carries the light. The answers
    // are the field's own light, so the shadows only half dim them; within
    // the blur's reach of a window they keep to the glass's limit.
    vec4 answer = answers(px, cell.xy);
    float burn = min(answer.a + stir, 3.0);
    vec3 flare = ((mix(orange, WHITE_HOT, 0.3) * rim * 0.45 + orange * tile * 0.34) * burn * mix(1.0, 0.7, glass)
                  + answer.rgb * mix(1.0, 0.8, glass)) * (0.5 + 0.5 * shade);
    float close = 1.0 - smoothstep(0.0, BLUR_REACH, nearest);
    float flarePeak = max(flare.r, max(flare.g, flare.b));
    light += flare * mix(1.0, min(1.0, UNDER_GLASS / max(flarePeak, 1e-4)), max(close, glass));

    // The bar's lower edge: an orange line, and under it a strip of hazard
    // stripes that crawls along, lit where a bright run sweeps across.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        light += orange * glowLine(abs(below), 1.1) * 0.8;
        float stripe = abs(fract((px.x + below - cycle(3.0) * 54.0) / 18.0) - 0.5);
        float hazard = smoothstep(0.22, 0.26, stripe) * smoothstep(3.5, 4.5, below) * (1.0 - smoothstep(9.5, 10.5, below));
        // The run starts and ends well off screen, so its wrap never shows.
        float run = exp(-abs(px.x + 900.0 - cycle(9.0) * (resolution.x + 1800.0)) / 260.0);
        light += mix(orange, RED, 0.35) * hazard * (0.12 + 1.4 * run);
        light += orange * 0.05 * step(px.y, reserved.x);
    }

    if (pane >= 0) light += sheen(px, pane);

    // Behind the glass no channel goes over UNDER_GLASS, so the field passing
    // behind muted text never takes it under 4.5:1.
    float peak = max(light.r, max(light.g, light.b));
    light *= mix(1.0, min(1.0, UNDER_GLASS / max(peak, 1e-4)), glass);

    // Bright light saturates toward white, as it does on film.
    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): its own AT field. A wall of
// orange light hugs the glass a few pixels out, its corners cut at 45
// degrees, brightest facing the light, at its corners, as focus lifts it and
// as you speak; Unit-01's purple round the windows without focus. The glass's
// outer pixels show the field bent from behind it, and that light catches on
// the wall, so a ring passing behind the glass lights the edge. The wall
// flares when the window opens, lands or takes focus, springing out as focus
// arrives. Its light stays within a dozen pixels of the wall, so it never
// lies over the text of a window beneath.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 48.0) return vec4(0.0);
    vec2 n = outward(px, r, rounding);
    float f = fieldDistance(px, r);
    bool focus = i == focusedIndex;
    float lift = windowLift(i);
    float breath = focus ? voice : 0.0;

    // What just happened to this window, newest first; all of it is over
    // within a second.
    float flare = 0.0;
    vec3 thrown = vec3(0.0);
    vec2 middle = r.xy + r.zw * 0.5;
    for (int k = impulseCount - 1; k >= 0; k--) {
        int kind = impulseKinds[k];
        vec4 ev = impulses[k];
        if (ev.z > 1.0) break;
        if (kind == TYPE || kind == CLOSE || length(ev.xy - middle) > 2.0 + length(r.zw) * 0.02) continue;
        if (kind == FOCUS) {
            flare += 1.6 * exp(-ev.z * 4.0) * ev.w;
            float at = 6.0 + 40.0 * sqrt(min(ev.z / 0.45, 1.0));
            thrown += mix(WHITE_HOT, accent, min(ev.z * 4.0, 1.0)) * 1.8 * exp(-ev.z * 5.0) * glowLine(abs(f - at), 1.4);
        } else if (kind == OPEN) flare += 2.2 * exp(-ev.z * 3.0);
        else if (kind == LAND) flare += 1.8 * ev.w * exp(-ev.z * 5.0);
    }

    vec3 tint = focus ? accent : PURPLE * 1.3;
    vec2 q = abs(px - middle) - r.zw * 0.5;
    float corner = smoothstep(-80.0, -24.0, min(q.x, q.y));
    float toward = 0.5 + 0.5 * clamp(dot(n, LIGHT), 0.0, 1.0);
    float strength = (focus ? 0.8 + 0.6 * lift : 0.45) * toward * (1.0 + 1.3 * corner) * (1.0 + flare + 1.5 * breath);
    float w = abs(wallDistance(px, r, 6.0 + 4.0 * breath, 18.0));
    float wall = (1.0 - smoothstep(0.0, 1.1, w) + 0.3 * exp(-w / 2.0)) * strength;
    float hairline = glowLine(abs(d - 0.5), 0.8) * 0.5 * strength;
    float wash = 0.12 * exp(-max(f, 0.0) / 5.0) * (1.0 + 2.0 * flare + 2.0 * breath) * (focus ? 1.0 : 0.5);

    // The field just behind the glass's edge, seen bent through its outer
    // pixels and caught by the wall.
    float edge = (1.0 - smoothstep(0.0, 6.0, d)) * smoothstep(-2.0, 0.0, d);
    vec3 behind = d < 10.0 ? backdrop(px - n * (max(d, 0.0) + 12.0)).rgb - background : vec3(0.0);
    vec3 glow = tint * (wall + hairline + wash) + thrown + behind * 3.0 * (wall + hairline) / max(strength, 0.3);
    float a = clamp(max(edge * 0.9, max(wall, hairline)), 0.0, 1.0);
    return vec4((background + behind) * 1.1 * edge * 0.9 + glow, a) * windowAlpha(i);
}
