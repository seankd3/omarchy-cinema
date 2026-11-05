// omarchy-cinema contract 12
// Evangelion: NERV's displays. A honeycomb wakes like an AT field round the
// windows, rings ripple out from the focused one, and far behind lies
// Unit-01's purple lattice. The windows stand in the field, lit from above
// (specs/depth.md), and it holds them.

const vec3 RED = vec3(1.0, 0.16, 0.08);
const vec3 PURPLE = vec3(0.40, 0.20, 0.85);
const vec3 WARM_LIGHT = vec3(1.0, 0.86, 0.62);
const float CELL = 28.0; // honeycomb spacing in pixels: two cells span a gap
// Where NERV's light comes from: above, a little to the left. Shadows fall
// away from it and the frames are brightest facing it.
const vec2 LIGHT = vec2(-0.34, -0.94);

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

// The light on window i's glass at px: NERV's light lying along the upper
// glass, brightest toward it, and a soft diagonal streak that slides across
// the pane as the window moves, as a reflection does. Only the glass shows
// it, so it is never over text.
vec3 sheen(vec2 px, int i) {
    Window w = window(px, i);
    vec4 r = w.rect;
    vec2 at = px - r.xy;
    float upper = exp(-at.y / 70.0) * (1.0 - 0.4 * at.x / r.z);
    float band = glassStreak(px, r);
    return WARM_LIGHT * (0.06 * upper + 0.05 * band) * w.alpha;
}

// The field answering what happened at px, whose honeycomb cell is centred
// at `cell`, briefly and softly: the light of a ring (rgb) and how much the
// cell lights (a).
vec4 answers(vec2 px, vec2 cell) {
    vec3 ring = vec3(0.0);
    float lit = 0.0;
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (kind == LAND) {
            // One full AT field ring flares out from the window's edge,
            // white-hot turning orange then red, harder the faster it came,
            // with a flash where it leaves the window and a wash behind its
            // front that carries through the glass. The cells it crosses
            // burn and stay lit behind it, fading.
            vec4 r = impulseRect(k);
            float f = fieldDistance(px, r);
            float reach = age * 1100.0;
            if (f < -2.0 || f > reach + 120.0) continue;
            float fc = fieldDistance(cell, r);
            float fade = exp(-age * 2.4) * (1.0 - smoothstep(0.8, 1.2, age)) * (0.6 + 0.6 * e.w);
            vec3 tint = mix(mix(WARM_LIGHT, accent, min(age * 4.0, 1.0)), RED, min(age * 0.9, 1.0));
            float behind = reach - f;
            if (abs(behind) < 40.0) ring += tint * fade * 1.2 * glowLine(abs(behind), 1.8);
            ring += tint * fade * 0.35 * exp(-behind / 90.0) * step(0.0, behind);
            ring += WARM_LIGHT * 1.4 * fade * exp(-max(f, 0.0) / 30.0) * exp(-age * 5.0);
            lit += fade * (2.6 * exp(-abs(fc - reach) / 34.0) + 1.4 * exp(-(reach - fc) / 360.0) * step(0.0, fc) * step(fc, reach));
        } else if (kind == OPEN || kind == FOCUS) {
            // The cells along the window's edge glow up and settle.
            if (age > 1.0) continue;
            float fc = fieldDistance(cell, impulseRect(k));
            if (fc < -30.0 || fc > 160.0) continue;
            float fade = smoothstep(0.0, 0.15, age) * exp(-age * 3.0) * (kind == OPEN ? 1.0 : e.w);
            lit += fade * exp(-abs(fc) / 45.0);
        } else if (kind == CLOSE) {
            // The field where the window stood dims out softly.
            if (age > 0.8) continue;
            float fade = smoothstep(0.0, 0.1, age) * (1.0 - age / 0.8);
            lit += 0.6 * fade * exp(-octagon(cell - e.xy) / 260.0);
        }
    }
    return vec4(ring, lit);
}

vec4 backdrop(vec2 px) {
    vec3 orange = accent;

    // The windows at px (see()), their shadows, falling away from the light,
    // further and softer the more focus lifts a window, and the field's hold:
    // the honeycomb packs tighter toward each window's edge and lets go as a
    // window fades and from 250 to 450 px out (held.xy shifts px into the
    // honeycomb, held.z is how tight).
    Seen seen = UNSEEN;
    float shadow = 0.0;
    vec3 held = vec3(0.0);
    uint reached = windowsAt(px), near = 0u;
    for (int i = 0; i < windowCount; i++) {
        if (!reaches(reached, i)) continue;
        Window w = window(px, i);
        see(seen, w);
        // Its wake (below) reaches px's cell, which is within 16.2 px of px.
        if (i < 32 && abs(w.d) < glowReach(0.6, 28.0) + 17.0) near |= 1u << i;
        float beyond = max(w.d, 0.0);
        float grip = exp(-beyond / 70.0) * (1.0 - smoothstep(250.0, 450.0, beyond));
        held += vec3(edgeNormal(px, w.rect, w.rounding) * 0.7 * beyond, 1.0) * grip;
        // Exactly 0 past offset plus softness from the window's edge.
        float soft = 18.0 + 40.0 * w.lift, offset = 24.0 + 44.0 * w.lift;
        if (edgeDistance(w) - offset >= soft) continue;
        float s = rectDistance(px + LIGHT * offset, w.rect, w.rounding);
        shadow = max(shadow, (1.0 - smoothstep(-soft, soft, s)) * w.alpha);
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, seen.nearest);
    // Behind a window's glass, and the bar's, only a trace of the field at
    // rest shows; its answers carry through.
    float glass = max(inside, step(px.y, reserved.x));
    float veil = mix(1.0, 0.14, glass);
    float shade = 1.0 - 0.85 * shadow;
    vec2 centre = focused.xy + focused.zw * 0.5;
    vec3 light = vec3(0.0);

    // A dragged window moves the viewpoint: the honeycomb, the nearer layer,
    // shifts against it by a few pixels, the far lattice by a third of that.
    vec2 view = focusVelocity() * 0.003;

    // Far behind: slow purple haze and a lattice three times the size, offset
    // against the focused window so it reads as deeper than the near one.
    float haze = noise(px * 0.0016 + orbit(180.0, 1.5)) * noise(px * 0.0045 - orbit(120.0, 2.0));
    vec3 far = hexCell(px + (centre - resolution * 0.5) * 0.05 + view * 0.35, CELL * 3.0);
    light += PURPLE * (0.1 * haze * haze + glowLine(far.z, 1.0) * (0.015 + 0.25 * haze) * veil);

    // The honeycomb cell holding px, found in the held, shifted honeycomb and
    // judged where it lies on the screen, so whole cells light.
    vec2 shift = held.xy + view;
    vec3 cell = hexCell(px + shift, CELL);
    cell.xy -= shift;

    // How awake the cell is: near any window's edge (inside or out, so seams
    // between windows add up) and most near the focused one. A moving window
    // sets it rippling: rings of cells light and run outward from the window,
    // and the cells where it has just been stay lit behind it, fading.
    // The cell is a point of its own, so the windows are met again there:
    // those whose wake reaches it, and the moving ones.
    float wake = 0.0, stir = 0.0;
    for (int i = 0; i < windowCount; i++) {
        if (!reaches(near, i) && windowTexels[3 * i + 2].xy == vec2(0.0)) continue;
        Window w = window(cell.xy, i);
        wake += 0.6 * exp(-abs(w.d) / 28.0);
        float speed = length(w.velocity);
        if (speed < 40.0) continue;
        float pace = min(speed / 1400.0, 1.0) * w.alpha;
        float fc = fieldDistance(cell.xy, w.rect);
        if (fc < 0.0) continue;
        stir += 2.2 * pace * exp(-fc / 160.0) * pow(0.5 + 0.5 * cos(fc / 26.0 - cycle(1.0) * TAU * 3.0), 3.0);
        // Its ghosts, 2.6 exp(-d / 26) of a burn, only within their reach of
        // where it was in the last 0.12 s (its last ghost's lag).
        for (int k = 1; k <= (fc < glowReach(2.6, 26.0) + speed * 0.12 ? 4 : 0); k++) {
            stir += (1.4 - 0.3 * float(k)) * pace * exp(-abs(fieldDistance(cell.xy, ago(w, 0.03 * float(k)))) / 26.0);
        }
    }
    float toFocus = focusedIndex < 0 ? FAR : abs(window(cell.xy, focusedIndex).d);
    wake += 2.0 * exp(-toFocus / 40.0) + 0.35 * exp(-toFocus / 500.0);
    // The field breathes gently with your voice round the focused window.
    wake += voice * 0.6 * exp(-toFocus / 80.0);

    // An octagonal ring leaves the focused window's centre every six seconds
    // and spreads for twelve, orange turning to red as it fades, a faint wash
    // behind its front. The cells it crosses light up. (A ring every two
    // seconds, twice as fast, kept the whole field moving: too busy to live
    // with all day.) A ring lights nothing past its cells' reach of its
    // front (1.3 exp(-d / 36), a cell within 16.2 px of px).
    float ringCell = octagon(cell.xy - centre);
    float ringPx = octagon(px - centre);
    float ripple = 0.0;
    vec3 rings = vec3(0.0);
    for (int k = 0; k < 2; k++) {
        float f = fract(cycle(12.0) + float(k) * 0.5);
        float r = f * 1800.0;
        float fade = (1.0 - f) * smoothstep(0.0, 0.05, f);
        float behind = r - ringPx;
        if (abs(behind) > glowReach(1.3, 36.0) + 17.0) continue;
        ripple += exp(-abs(ringCell - r) / 36.0) * fade;
        rings += mix(orange, RED, f) * (glowLine(abs(behind), 1.4) + 0.2 * exp(-behind / 40.0) * step(0.0, behind)) * fade;
    }
    light += rings * 1.3 * veil;
    light *= shade;

    // Each cell is a tile with a bright rim and a dark seam to its
    // neighbours. Awake cells glow steadily and swell together in broad
    // patches that drift slowly, so the field breathes instead of glittering
    // cell by cell. Where the field packs tight round a window its rims glow
    // brighter, as if holding the window. A rim fades out at its cell's
    // edge, so float noise cannot hand an edge pixel to the next cell.
    float swell = smoothstep(0.25, 0.75, noise(cell.xy * 0.006 + orbit(30.0, 1.2)));
    float lit = min(wake, 2.5) * (0.5 + 0.7 * swell) + ripple * 1.6;
    float tile = smoothstep(2.0, 3.5, cell.z);
    float rim = glowLine(abs(cell.z - 3.0), 0.9) * (1.0 + 0.5 * min(held.z, 1.0)) * smoothstep(0.0, 0.5, cell.z);
    light += orange * glowLine(cell.z, 0.8) * 0.035;
    light += orange * (tile * 0.06 + rim * 0.3) * lit * veil * shade;

    // A cell the field's answer or a moving window reaches burns whole, its
    // rim near white, and through the glass too, where its tile carries the
    // light. The answers are the field's own light, so the shadows only half
    // dim them.
    vec4 answer = answers(px, cell.xy);
    float burn = min(answer.a + stir, 3.0);
    light += ((mix(orange, WARM_LIGHT, 0.3) * rim * 0.45 + orange * tile * 0.3) * burn * mix(1.0, 0.7, glass)
              + answer.rgb * mix(1.0, 0.8, glass)) * (0.5 + 0.5 * shade);

    // The bar's lower edge: an orange line, and under it a strip of hazard
    // stripes that crawls along, lit where a bright run sweeps across. Its
    // light ends 40 px below the edge.
    float below = px.y - reserved.x;
    if (reserved.x > 0.0 && below < 40.0) {
        light += orange * glowLine(abs(below), 1.1) * 0.8;
        float stripe = abs(fract((px.x + below - cycle(3.0) * 54.0) / 18.0) - 0.5);
        float hazard = smoothstep(0.22, 0.26, stripe) * smoothstep(3.5, 4.5, below) * (1.0 - smoothstep(9.5, 10.5, below));
        // The run starts and ends well off screen, so its wrap never shows.
        float run = exp(-abs(px.x + 900.0 - cycle(9.0) * (resolution.x + 1800.0)) / 260.0);
        light += mix(orange, RED, 0.35) * hazard * (0.12 + 1.4 * run);
        light += orange * 0.05 * step(px.y, reserved.x);
    }

    if (seen.over >= 0) light += sheen(px, seen.over);

    // Bright light saturates toward white, as it does on film.
    return vec4(background + (1.0 - exp(-light * 1.3)), 1.0);
}

// Each window's edge (specs/depth.md, part 2): its own AT field. A wall of
// orange light hugs the glass a few pixels out, its corners cut at 45
// degrees, brightest facing the light, at its corners and as focus lifts it;
// Unit-01's purple round the windows without focus. The glass's outer pixels
// show the field bent from behind it, and that light catches on the wall, so
// light passing behind the glass lights the edge. The wall flares when the
// window lands and brightens softly for a moment when it opens or takes
// focus. Its light stays within a dozen pixels of the wall, so it never lies
// over the text of a window beneath.
vec4 frame(vec2 px, int i) {
    Window w = window(px, i);
    vec4 r = w.rect;
    float d = edgeDistance(w);
    if (d < -2.0 || d > 48.0) return vec4(0.0);
    vec2 n = edgeNormal(px, r, w.rounding);
    float f = fieldDistance(px, r);
    bool focus = i == focusedIndex;
    float breath = focus ? voice : 0.0;

    // What just happened to this window, all over within a second.
    float flare = windowFlare(i, 1.8);

    vec3 tint = focus ? accent : PURPLE * 1.3;
    vec2 q = abs(px - r.xy - r.zw * 0.5) - r.zw * 0.5;
    float corner = smoothstep(-80.0, -24.0, min(q.x, q.y));
    float toward = 0.5 + 0.5 * clamp(dot(n, LIGHT), 0.0, 1.0);
    float strength = (focus ? 0.8 + 0.6 * w.lift : 0.45) * toward * (1.0 + 1.3 * corner) * (1.0 + flare + 0.4 * breath);
    float onWall = abs(wallDistance(px, r, 6.0, 18.0));
    float wall = (1.0 - smoothstep(0.0, 1.1, onWall) + 0.3 * exp(-onWall / 2.0)) * strength;
    float hairline = glowLine(abs(d - 0.5), 0.8) * 0.5 * strength;
    float wash = 0.12 * exp(-max(f, 0.0) / 5.0) * (1.0 + flare + 0.5 * breath) * (focus ? 1.0 : 0.5);

    // The field just behind the glass's edge, seen bent through its outer
    // pixels and caught by the wall.
    float edge = glassSide(d, 6.0);
    vec3 behind = d < 10.0 ? worldAt(px - n * (max(d, 0.0) + 12.0)).rgb - background : vec3(0.0);
    vec3 glow = tint * (wall + hairline + wash) + behind * 3.0 * (wall + hairline) / max(strength, 0.3);
    float a = clamp(max(edge * 0.9, max(wall, hairline)), 0.0, 1.0);
    return vec4((background + behind) * 1.1 * edge * 0.9 + glow, a) * w.alpha;
}
