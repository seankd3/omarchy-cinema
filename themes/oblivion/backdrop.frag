// omarchy-cinema contract 16
// Oblivion: Tower 49 at dawn. A high pale sky over a sea of cloud that slides
// slowly toward the tower, the sun low on the horizon and the broken moon faint
// in the daylight. Every window is a pane of the tower's glass, traced by a fine
// blue line and lit along the edges that face the sun; round the focused one a
// drone's sensor ring circles. The panes float in the sun's light
// (specs/depth.md).
//
// The theme is light, so the backdrop paints, not glows: lines are ink mixed
// over the sky, and light is a lift toward white. Under the windows only a
// near white wash of the sky's light shows, so the frosted glass reads as
// white paper with dark text on it.

const vec3 ZENITH = vec3(0.60, 0.70, 0.81);
const vec3 SKY = vec3(0.80, 0.86, 0.91);
const vec3 HAZE = vec3(0.95, 0.945, 0.93);
const vec3 SUN = vec3(1.0, 0.95, 0.86);
const vec3 CLOUD = vec3(0.975, 0.98, 0.985);
const vec3 SHADE = vec3(0.71, 0.77, 0.84);
const vec3 DEEP = vec3(0.56, 0.64, 0.74);
const vec3 MOON = vec3(0.90, 0.93, 0.96);
const vec3 SLATE = vec3(0.50, 0.58, 0.69); // a pane's shadow
const vec3 GOLD = vec3(1.0, 0.82, 0.55);   // the sun caught on glass

// Value noise whose lattice repeats every `period` cells in y, so the cloud
// deck can slide by a whole period each cycle and the wrap never shows.
float tiledNoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float y0 = mod(i.y, period), y1 = mod(i.y + 1.0, period);
    return mix(mix(hash(vec2(i.x, y0)), hash(vec2(i.x + 1.0, y0)), u.x),
               mix(hash(vec2(i.x, y1)), hash(vec2(i.x + 1.0, y1)), u.x), u.y);
}

// Cloud tops, `octaves` deep: billowed noise, round puffs parted by soft
// creases. Each octave doubles exactly so the y period holds for all of them.
float clouds(vec2 p, int octaves) {
    const float PERIOD = 16.0;
    // One broad warp bends the lattice, so no grid shows through the creases.
    p.x += 0.9 * tiledNoise(p * 0.5 + 4.1, PERIOD * 0.5);
    float sum = 0.0, amp = 0.5, scale = 1.0;
    for (int k = 0; k < octaves; k++) {
        float n = 2.0 * tiledNoise(p * scale + vec2(float(k) * 7.3, 0.0), PERIOD * scale) - 1.0;
        // abs() makes the puffs; rounding it keeps the creases soft.
        sum += amp * sqrt(n * n + 0.015);
        amp *= 0.5;
        scale *= 2.0;
    }
    return sum;
}

// The broken moon: a pale disc with a hollow blown out of its lower left,
// rough at the fracture, and a stream of debris curving away from the wound.
// Low contrast, as a moon is by day.
float brokenMoon(vec2 px, vec2 at, float R) {
    vec2 p = px - at;
    float r = length(p);
    if (r > R * 3.2) return 0.0;
    vec2 cut = normalize(vec2(-0.62, 0.78));
    // The hollow is a second disc bitten out; its rim is rough rock.
    float rough = (noise(p * 0.16) - 0.5) * R * 0.16 + (noise(p * 0.5 + 7.0) - 0.5) * R * 0.05;
    float hollow = length(p - cut * R * 0.95) - R * 0.62 + rough;
    float body = (1.0 - smoothstep(R - 1.0, R + 0.5, r)) * smoothstep(-0.8, 0.8, hollow);
    // Seas on its face, the limb darker toward the edge, and the fresh
    // fracture a shade brighter than the old face.
    float face = 0.78 + 0.22 * noise(p * 0.045 + 3.0);
    float limb = mix(0.72, 1.0, sqrt(max(1.0 - r * r / (R * R), 0.0)));
    float moon = body * (face * limb + 0.25 * exp(-max(hollow, 0.0) / 2.5));
    // Debris: chips thinning along a stream that bends as it trails away.
    float along = dot(p, cut), across = dot(p, vec2(-cut.y, cut.x));
    float arc = across + 0.004 * along * along - R * 0.1;
    float width = R * (0.25 + 0.006 * max(along, 0.0));
    if (along > R * 0.3 && abs(arc) < width) {
        vec2 cell = floor(p / 5.0);
        float fall = exp(-max(along - R * 0.4, 0.0) / (R * 1.1)) * (1.0 - abs(arc) / width);
        if (hash(cell + 11.0) > 1.0 - 0.5 * fall) {
            vec2 c = (cell + 0.25 + 0.5 * vec2(hash(cell + 2.0), hash(cell + 5.0))) * 5.0;
            float s = 0.4 + 1.2 * hash(cell + 9.0) * fall;
            moon = max(moon, (1.0 - smoothstep(s - 0.6, s + 0.6, length(p - c))) * 0.85);
        }
        // and the fine dust between them, a faint haze along the stream.
        moon = max(moon, 0.18 * fall * fall);
    }
    return moon;
}

// The sky's broad light: haze at the horizon deepening to blue overhead.
vec3 daylight(vec2 px, float horizon) {
    float up = clamp((horizon - px.y) / horizon, 0.0, 1.0);
    return mix(mix(HAZE, SKY, smoothstep(0.0, 0.3, up)), ZENITH, smoothstep(0.25, 1.0, up));
}

vec3 sky(vec2 px, float horizon, vec2 sun) {
    float up = clamp((horizon - px.y) / horizon, 0.0, 1.0);
    vec3 col = daylight(px, horizon);
    // High cirrus, combed sideways by the wind, drifting on a slow circle.
    vec2 q = px * vec2(0.0011, 0.009) + orbit(1800.0, 3.0);
    float wisp = smoothstep(0.55, 0.95, noise(q) * 0.7 + noise(q * 2.7 + 1.3) * 0.4);
    col = mix(col, vec3(0.98), wisp * 0.35 * smoothstep(0.08, 0.35, up) * (1.0 - smoothstep(0.6, 0.95, up)));
    float moon = brokenMoon(px, vec2(resolution.x * 0.21, resolution.y * 0.19), resolution.y * 0.045);
    col = mix(col, MOON, moon * 0.6);
    return col;
}

// The cloud deck's tops seen at px (x) and how far into the deck that is,
// in noise tiles (y); `lean` moves the viewer across it (in the deck's own
// units), so near rows shift more than far ones.
vec2 deckTops(vec2 px, float horizon, float lean) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 90.0 * resolution.y / dy;
    vec2 world = vec2((px.x - resolution.x * 0.5) * depth / resolution.y + lean, depth);
    // The deck slides toward the tower one tile of noise every 15 minutes.
    vec2 p = world * 0.011 + vec2(0.0, 16.0 * cycle(900.0));
    // Broad banks of heavier cloud with thin valleys between, for depth.
    float banks = smoothstep(0.15, 0.85, tiledNoise(p * 0.25 + 2.7, 4.0));
    return vec2(clouds(p, 3) * mix(0.6, 1.15, banks), p.y);
}

// The cloud deck below the horizon, its tops `d` there and their `slope`
// going down the screen.
vec3 cloudDeck(vec2 px, float horizon, vec2 sun, float d, float slope) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 90.0 * resolution.y / dy;
    float lit = clamp(slope * 0.6, 0.0, 1.0);
    float body = smoothstep(0.25, 0.75, d);
    vec3 col = mix(DEEP, SHADE, smoothstep(0.05, 0.35, d));
    col = mix(col, CLOUD, body);
    col = mix(col, mix(vec3(1.0), SUN, 0.4), lit * 0.6);
    // Haze thickens toward the horizon until the deck melts into it.
    col = mix(col, HAZE, 1.0 - exp(-depth / 2400.0));
    // The sun's path across the cloud tops.
    float path = exp(-abs(px.x - sun.x) / (60.0 + dy * 0.9)) * exp(-dy / 260.0);
    return mix(col, SUN, path * 0.55);
}

const float RING = 30.0; // the sensor ring's distance from the focused window

// Where the horizon lies and the sun stands, for the sky and the panes' edges.
float horizonY() {
    return resolution.y * 0.56;
}

vec2 sunAt() {
    return vec2(resolution.x * 0.74, horizonY() - resolution.y * 0.035);
}

// A thin line `d` pixels away, `w` wide: 1 on it.
float ink(float d, float w) {
    return 1.0 - smoothstep(w * 0.4, w * 1.4, d);
}

// The sky answering what happened lately, briefly and softly, at px: how far
// it lifts toward white (x) and toward the sun's gold (y), and how much of
// the drone's blue ink it lays there (z).
vec3 answers(vec2 px) {
    vec3 a = vec3(0.0);
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.2) break;
        if (age > 1.0 && kind != LAND) continue;
        if (kind == CLOSE) {
            // A faint ring of vapour spreads where the pane was and thins.
            float front = closingFront(px, e);
            if (front > 120.0) continue;
            float glow = swell(age, 0.1, 0.9);
            a.x += exp(-front / 30.0) * 0.35 * glow;
            a.z += ink(front, 1.8) * 0.45 * glow;
            continue;
        }
        float d = impulseDistance(px, k);
        if (d < 0.0 || d > 320.0) continue;
        if (kind == OPEN) {
            // The drone's scan ring settles onto the pane from 60 px out.
            if (age > 0.7) continue;
            float on = openingFront(d, age);
            float glow = swell(age, 0.15, 0.7);
            a.z += ink(on, 1.8) * 0.6 * glow;
            a.x += exp(-on / 20.0) * 0.3 * glow;
        } else if (kind == LAND) {
            // The end of a move, which may shine: a pressure wave runs out
            // with a bright crest and the drone's blue line just ahead of
            // it, and the sun flashes gold off the pane's edges, all within
            // 1.2 s.
            float f = d - age * 380.0;
            float glow = (1.0 - smoothstep(0.0, 1.2, age)) * exp(-age * 1.5) * e.w;
            a.x += (exp(-abs(f) / 22.0) * 1.1 + exp(-abs(f) / 80.0) * 0.4) * glow;
            a.z += (ink(abs(f - 24.0), 3.0) + 0.35 * exp(-abs(f - 24.0) / 26.0)) * glow;
            a.y += exp(-d / 50.0) * exp(-age * 3.0) * 1.8 * e.w;
        } else if (kind == FOCUS) {
            // The pane's edge warms softly, as if the sun caught it.
            a.y += 0.45 * focusWarmth(d, e);
        }
    }
    return a;
}

// A moving pane's wake, which may shine: vapour
// trails from its corners (`glow`, with a blue fringe in `blue`) and the
// cloud it parts behind it (`part`), gone as soon as the pane stops.
void wake(vec2 px, Window w, inout float glow, inout float blue, inout float part) {
    vec2 v = w.velocity;
    float speed = length(v);
    // Only a moving pane pays for its wake.
    if (speed >= 40.0) {
        float k = wakeStrength(w, 1200.0);
        vec4 r = w.rect;
        vec2 tail = -v * 0.3;
        for (int c = 0; c < 4; c++) {
            vec2 a = r.xy + r.zw * vec2(float(c & 1), float(c >> 1));
            float t = clamp(dot(px - a, tail) / max(dot(tail, tail), 1e-3), 0.0, 1.0);
            float dist = segment(px, a, a + tail);
            float w = 2.0 + 16.0 * t;
            glow += exp(-dist / w) * (1.0 - t) * 1.2 * k;
            blue += exp(-dist / (w * 2.6)) * (1.0 - t) * 0.7 * k;
        }
        for (int g = 1; g <= 3; g++) {
            float d = rectDistance(px, ago(w, 0.06 * float(g)), w.rounding);
            part = max(part, (1.0 - smoothstep(-30.0, 30.0, d)) * (1.0 - 0.25 * float(g)) * k);
        }
    }
}


vec4 backdrop(vec2 px) {
    float horizon = horizonY();
    vec2 sun = sunAt();

    // The window nearest this point, for its line and its sunlit edge; how
    // near any is and how near a lifted one; and how the cloud flows round
    // them: pushed out from each edge and curling along it.
    Seen seen = UNSEEN;
    float near = 0.0, lifted = 0.0;
    vec2 flow = vec2(0.0);
    uint left = windowsAt(px);
    for (int i = -1; next(left, i);) {
        Window w = window(px, i);
        see(seen, w);
        float d = w.d;
        near += exp(-max(d, 0.0) / 70.0);
        float a = w.alpha;
        lifted = max(lifted, w.lift * exp(-max(d, 0.0) / 120.0) * a);
        vec2 n = edgeNormal(px, w.rect, w.rounding);
        flow += (n * 26.0 * exp(-max(d, 0.0) / 70.0) + vec2(n.y, -n.x) * 16.0 * exp(-max(d, 0.0) / 45.0)) * a;
    }
    float nearest = seen.nearest;
    int closest = seen.closest;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    near = clamp(near, 0.0, 1.0);

    // A dragged pane pulls the deck after it, near rows more than far ones;
    // the sky and the sun stay put.
    float lean = focusVelocity().x * 0.012;
    // The sun is low beyond the deck, so each puff's far rim catches it: where
    // its tops climb going down the screen. Their slope is a derivative, which
    // some drivers leave undefined unless every pixel of a 2x2 quad takes it,
    // so sky and deck are worked out a quad's reach past the horizon and past
    // the wash under the panes (inside 1, where neither shows). Down the
    // screen, in px, so any monitor rotation lights the same rim.
    mat2 toScreen = inverse(mat2(dFdx(px), dFdy(px)));
    float quad = abs(dFdx(px).y) + abs(dFdy(px).y); // how far down the screen a quad reaches
    bool open = nearest > -1.0 - 2.0 * quad;
    vec2 tops = vec2(0.0);
    float slope = 0.0;
    if (open && px.y > horizon - quad) {
        tops = deckTops(px + flow, horizon, lean);
        vec2 climb = vec2(dFdx(tops.x), dFdy(tops.x)) * toScreen, away = vec2(dFdx(tops.y), dFdy(tops.y)) * toScreen;
        slope = climb.y / max(abs(away.y), 1e-4);
    }
    vec3 col = !open ? vec3(0.0) : px.y < horizon ? sky(px, horizon, sun) : cloudDeck(px + flow, horizon, sun, tops.x, slope);
    // The sun itself: a soft white disc in a wide warm bloom, hazy at dawn.
    float ds = length(px - sun);
    col = mix(col, SUN, 0.45 * exp(-ds / 380.0) + 0.5 * exp(-ds / 70.0));
    col = mix(col, vec3(1.0), 1.0 - smoothstep(14.0, 22.0, ds));

    // The gaps between panes are lit a little, as glass gathers daylight,
    // and a lifted pane, nearer the sun, more; on the deck the cloud piles
    // up white against each pane and catches the sun.
    float deck = smoothstep(horizon - 10.0, horizon + 40.0, px.y);
    float piled = exp(-max(nearest - 3.0, 0.0) / 22.0) * deck;
    col = mix(col, vec3(1.0), near * 0.18 + lifted * 0.3);
    col = mix(col, mix(vec3(1.0), SUN, 0.5), piled * 0.5);

    // What follows shows only outside the panes (under them is the wash
    // below), so a point well under one does not pay for it.
    if (nearest > -1.0) {
        // The panes' shadows, cast toward the viewer and away from the sun:
        // slate, soft, and on the cloud rimmed by the gold caustic a pane's
        // edge focuses (brightest where the shadow fades); and the wakes of the
        // moving ones. A second look at the windows, which only the points
        // outside them take: under a pane it would cost more than it saves.
        float shadow = 0.0, trail = 0.0, fringe = 0.0, part = 0.0;
        left = windowsAt(px);
        for (int i = -1; next(left, i);) {
            Window w = window(px, i);
            shadow = max(shadow, windowShadow(px, w, vec2((w.rect.x + w.rect.z * 0.5 - sun.x) / resolution.x, 0.6), 24.0 + 56.0 * w.lift, 22.0 + 46.0 * w.lift));
            wake(px, w, trail, fringe, part);
        }
        col = mix(col, SLATE, 0.4 * shadow);
        col = mix(col, GOLD, 1.4 * shadow * (1.0 - shadow) * deck);

        // The cloud a moving pane parts: deeper below the deck's tops, and a
        // white haze of its passage in the sky.
        col = mix(col, mix(vec3(1.0), DEEP, deck), part * mix(0.5, 0.35, deck));

        if (closest >= 0 && nearest < 60.0) {
            Window c = window(px, closest);
            float fade = c.alpha;
            vec4 rect = c.rect;
            // A fine blue line traced a little off each pane.
            float line = 1.0 - smoothstep(0.35, 1.05, abs(nearest - 12.0));
            col = mix(col, accent, line * 0.55 * fade);
            // Light catches the edge facing the sun, and a glint runs along it.
            vec2 q = px - clamp(px, rect.xy, rect.xy + rect.zw);
            vec2 n = q / max(length(q), 1e-3);
            vec2 toSun = normalize(sun - (rect.xy + rect.zw * 0.5));
            float facing = 0.35 + 0.65 * max(dot(n, toSun), 0.0);
            float rim = exp(-max(nearest, 0.0) / 2.5);
            float glint = exp(-abs(px.x - rect.x - cycle(20.0) * rect.z) / 140.0) * step(px.y, rect.y + rect.w * 0.5);
            col = mix(col, vec3(1.0), rim * fade * (0.45 * facing + 0.5 * glint));
        }

        // The drone's sensor: a thin ring round the focused window, its arc
        // circling once every 12 seconds with a fading trail. It rides the eased
        // focus rect, so it glides to the next window when focus moves, and is as
        // present as the focus, so it fades with a closing window.
        float fd = focusAlpha > 0.0 ? rectDistance(px, focused, 0.0) : FAR;
        if (abs(fd - RING) < 12.0) {
            float fade = focusAlpha;
            vec4 ring = focused + vec4(-RING, -RING, 2.0 * RING, 2.0 * RING);
            float behind = fract(cycle(12.0) - around(px, ring)) * 2.0 * (ring.z + ring.w);
            float trail_ = exp(-behind / 380.0);
            float onRing = 1.0 - smoothstep(0.3, 1.0, abs(fd - RING));
            col = mix(col, accent, onRing * (0.25 + 0.75 * trail_) * fade);
            col = mix(col, accent, (1.0 - smoothstep(0.0, 6.0, behind)) * exp(-abs(fd - RING) / 3.0) * 0.6 * fade);
        }

        // The answers: blue ink, kept off the panes (the frost would pull it
        // under their text), then light.
        vec3 a = answers(px);
        float clear = smoothstep(6.0, 16.0, nearest);
        col = mix(col, accent, min(a.z + fringe, 1.0) * 0.9 * clear);
        col = mix(col, GOLD, min(a.y, 1.0) * 0.75);
        col = mix(col, vec3(1.0), min(a.x + trail, 1.0));
    }

    // Under the glass only the sky's broad light shows, lifted near white:
    // no cloud, moon, line or sweep behind text, and never darker than the
    // background the apps chose their text colours against, so the glass
    // cannot lower their contrast.
    if (inside > 0.0) col = mix(col, mix(daylight(px, horizon), vec3(1.0), 0.95), inside);

    // The glass catches the sky's light: behind each pane the world draws
    // the sheen on it, a streak lifted to white that slides as the pane
    // moves, and the sun's warm glow along the side facing it. Only the glass
    // shows it, the text stays over it, and it is never darker than the
    // background (colors.toml's), so it cannot lower the text's contrast.
    int over = seen.over;
    if (over >= 0) {
        Window o = window(px, over);
        vec4 r = o.rect;
        vec2 toSun = normalize(sun - r.xy - r.zw * 0.5 + vec2(0.0, -1e-3));
        float facing = exp(-(dot(r.zw * 0.5, abs(toSun)) - dot(px - r.xy - r.zw * 0.5, toSun)) / 90.0);
        float a = o.alpha * inside;
        col = mix(col, vec3(1.0), 0.8 * glassStreak(px, r) * a);
        col = max(mix(col, mix(vec3(1.0), GOLD, 0.35), 0.35 * facing * a), background);
    }

    // The bar's lower edge: a fine pale blue line with a soft glint gliding
    // along it, and the frosted bar above lifted toward white.
    float below;
    if (atBar(px, below)) {
        col = mix(col, vec3(1.0), 0.3 * step(below, 0.0));
        col = mix(col, accent, (1.0 - smoothstep(0.3, 1.0, abs(below))) * 0.6);
        float gx = cycle(15.0) * (resolution.x + 800.0) - 400.0;
        float glint = exp(-abs(px.x - gx) / 120.0);
        col = mix(col, vec3(1.0), glint * exp(-abs(below) / 2.0) * 0.9);
        col = mix(col, mix(accent, vec3(1.0), 0.6), glint * exp(-abs(below) / 9.0) * 0.35);
    }

    return vec4(col, 1.0);
}

// Each pane's edge (specs/depth.md, part 2): Tower 49's glass. A fine blue
// line traces it, deeper at the top of the focused pane and paler at its
// foot as the border was, a soft grey-blue on the others; the sky just
// outside bends through the pane's thickness in its outer pixels; the sun
// glints on the edge that faces it; and the light passing by outside, the
// gold of a focus or a landing, catches the edge and warms it.
vec4 frame(vec2 px, Window w) {
    vec4 r = w.rect;
    float d = edgeDistance(w);
    if (d < -2.0 || d > 14.0) return vec4(0.0);
    bool focus = w.i == focusedIndex;
    vec2 n = edgeNormal(px, r, w.rounding);
    float down = clamp((px.y - r.y) / max(r.w, 1.0), 0.0, 1.0);
    vec3 tint = focus ? mix(vec3(0.24, 0.60, 0.82), vec3(0.65, 0.85, 0.95), down) : vec3(0.62, 0.70, 0.77);
    // One look at the world 12 px out, beside the glass: what its edge bends
    // into view and what light is passing there.
    vec3 outside = worldAt(px + n * 12.0).rgb;
    float warm = smoothstep(0.04, 0.22, outside.r - outside.b);
    tint = mix(tint, GOLD, warm * 0.85);
    float facing = max(dot(n, normalize(sunAt() - r.xy - r.zw * 0.5 + vec2(0.0, -1e-3))), 0.0);
    float line = (1.0 - smoothstep(0.4, 1.4, abs(d - 0.5))) * (focus ? 0.95 : 0.7) * (1.0 + 0.8 * warm);
    float edge = glassSide(d, 4.0);
    vec3 bent = mix(outside, vec3(1.0), 0.3);
    float glint = line * facing * (0.5 + 0.5 * w.lift);
    float halo = exp(-max(d, 0.0) / 7.0) * step(0.0, d) * (focus ? 0.12 : 0.0) * (1.0 + 2.0 * warm);
    float a = clamp(max(max(edge * 0.8, line), halo), 0.0, 1.0);
    vec3 col = bent * edge * 0.8 * (1.0 - line) + tint * line + vec3(1.0) * glint * 0.6 + tint * halo;
    return vec4(min(col, vec3(a)), a);
}
