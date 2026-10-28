// Oblivion: Tower 49 at dawn. A high pale sky over a sea of cloud that slides
// slowly toward the tower, the sun low on the horizon and the broken moon faint
// in the daylight. Every window is a pane of the tower's glass, traced by a fine
// blue line and lit along the edges that face the sun; round the focused one a
// drone's sensor ring circles, sweeping a fan of pale blue light through the
// gaps.
//
// The theme is light, so the backdrop paints, not glows: lines are ink mixed
// over the sky, and light is a lift toward white. Everything stays pale, so
// the frosted white glass of the windows reads as white with dark text on it.

const vec3 ZENITH = vec3(0.60, 0.70, 0.81);
const vec3 SKY = vec3(0.80, 0.86, 0.91);
const vec3 HAZE = vec3(0.95, 0.945, 0.93);
const vec3 SUN = vec3(1.0, 0.95, 0.86);
const vec3 CLOUD = vec3(0.975, 0.98, 0.985);
const vec3 SHADE = vec3(0.71, 0.77, 0.84);
const vec3 DEEP = vec3(0.56, 0.64, 0.74);
const vec3 MOON = vec3(0.90, 0.93, 0.96);

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

vec3 sky(vec2 px, float horizon, vec2 sun) {
    float up = clamp((horizon - px.y) / horizon, 0.0, 1.0);
    vec3 col = mix(HAZE, SKY, smoothstep(0.0, 0.3, up));
    col = mix(col, ZENITH, smoothstep(0.25, 1.0, up));
    // High cirrus, combed sideways by the wind, drifting on a slow circle.
    vec2 q = px * vec2(0.0011, 0.009) + orbit(1800.0, 3.0);
    float wisp = smoothstep(0.55, 0.95, noise(q) * 0.7 + noise(q * 2.7 + 1.3) * 0.4);
    col = mix(col, vec3(0.98), wisp * 0.35 * smoothstep(0.08, 0.35, up) * (1.0 - smoothstep(0.6, 0.95, up)));
    float moon = brokenMoon(px, vec2(resolution.x * 0.21, resolution.y * 0.19), resolution.y * 0.045);
    col = mix(col, MOON, moon * 0.6);
    return col;
}

vec3 cloudDeck(vec2 px, float horizon, vec2 sun) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 90.0 * resolution.y / dy;
    vec2 world = vec2((px.x - resolution.x * 0.5) * depth / resolution.y, depth);
    // The deck slides toward the tower one tile of noise every 15 minutes.
    vec2 p = world * 0.011 + vec2(0.0, 16.0 * cycle(900.0));
    // Broad banks of heavier cloud with thin valleys between, for depth.
    float banks = smoothstep(0.15, 0.85, tiledNoise(p * 0.25 + 2.7, 4.0));
    float d = clouds(p, 3) * mix(0.6, 1.15, banks);
    // The sun is low beyond the deck, so each puff's far rim catches it: where
    // the tops climb going down the screen. The slope comes free from the
    // screen derivative, so no second noise lookup.
    float slope = dFdy(d) / max(abs(dFdy(p.y)), 1e-4);
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

// How far round a rect's edge the point nearest px is, clockwise from the top
// left corner, 0 to 1.
float around(vec2 px, vec4 rect) {
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

// The point `s` of the way round a rect's edge, the inverse of around().
vec2 pointAround(float s, vec4 rect) {
    float w = rect.z, h = rect.w;
    float t = s * 2.0 * (w + h);
    if (t < w) return rect.xy + vec2(t, 0.0);
    if (t < w + h) return rect.xy + vec2(w, t - w);
    if (t < 2.0 * w + h) return rect.xy + vec2(2.0 * w + h - t, h);
    return rect.xy + vec2(0.0, 2.0 * (w + h) - t);
}

vec4 backdrop(vec2 px) {
    float horizon = resolution.y * 0.56;
    vec2 sun = vec2(resolution.x * 0.74, horizon - resolution.y * 0.035);
    vec3 col = px.y < horizon ? sky(px, horizon, sun) : cloudDeck(px, horizon, sun);
    // The sun itself: a soft white disc in a wide warm bloom, hazy at dawn.
    float ds = length(px - sun);
    col = mix(col, SUN, 0.45 * exp(-ds / 380.0) + 0.5 * exp(-ds / 70.0));
    col = mix(col, vec3(1.0), 1.0 - smoothstep(14.0, 22.0, ds));

    // The window nearest this point, for its line and its sunlit edge.
    float nearest = FAR;
    int closest = -1;
    float near = 0.0;
    for (int i = 0; i < windowCount; i++) {
        float d = windowDistance(px, i);
        near += exp(-max(d, 0.0) / 70.0);
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    near = clamp(near, 0.0, 1.0);

    // Behind the glass the sky stays, softened, so the pane reads as calm white.
    col = mix(col, mix(col, HAZE, 0.5), inside);

    // The gaps between panes are lit a little, as glass gathers daylight.
    col = mix(col, vec3(1.0), near * (1.0 - inside) * 0.18);

    if (closest >= 0 && nearest > -1.0 && nearest < 60.0) {
        float fade = windowAlpha(closest);
        vec4 rect = windowRect(closest);
        // A fine blue line traced a little off each pane.
        float line = 1.0 - smoothstep(0.35, 1.05, abs(nearest - 12.0));
        col = mix(col, accent, line * 0.55 * fade);
        // Light catches the edge facing the sun, and a glint runs along it.
        vec2 q = px - clamp(px, rect.xy, rect.xy + rect.zw);
        vec2 n = q / max(length(q), 1e-3);
        vec2 toSun = normalize(sun - (rect.xy + rect.zw * 0.5));
        float facing = 0.35 + 0.65 * max(dot(n, toSun), 0.0);
        float rim = exp(-max(nearest, 0.0) / 2.5) * (1.0 - inside);
        float glint = exp(-abs(px.x - rect.x - cycle(20.0) * rect.z) / 140.0) * step(px.y, rect.y + rect.w * 0.5);
        col = mix(col, vec3(1.0), rim * fade * (0.45 * facing + 0.5 * glint));
    }

    // The drone's sensor: a thin ring round the focused window, its arc
    // circling once every 12 seconds and lighting fine ticks as it passes,
    // and a fan of pale blue light sweeping behind it through the gaps.
    float fd = focusedWindow(px);
    if (fd > -1.0 && fd < 200.0) {
        float fade = windowAlpha(focusedIndex);
        vec4 ring = windowRect(focusedIndex) + vec4(-RING, -RING, 2.0 * RING, 2.0 * RING);
        float length_ = 2.0 * (ring.z + ring.w);
        float head = cycle(12.0);
        float at = around(px, ring);
        float behind = fract(head - at) * length_;
        float trail = exp(-behind / 380.0);
        float onRing = 1.0 - smoothstep(0.3, 1.0, abs(fd - RING));
        col = mix(col, accent, onRing * (0.25 + 0.75 * trail) * fade);
        col = mix(col, accent, (1.0 - smoothstep(0.0, 6.0, behind)) * exp(-abs(fd - RING) / 3.0) * 0.6 * fade);
        // The ticks stay put on the ring; the arc lights them as it passes.
        float tick = (1.0 - smoothstep(0.4, 1.0, abs(fract(at * length_ / 14.0 + 0.5) - 0.5) * 14.0))
            * step(RING, fd) * step(fd, RING + 6.0);
        col = mix(col, accent, tick * trail * 0.7 * fade);
        // The fan turns about the window's middle, pointing at the arc's head,
        // and is lit outside the window only.
        vec2 c = ring.xy + ring.zw * 0.5;
        vec2 h = pointAround(head, ring) - c;
        float sweep = fract((atan(h.y, h.x) - atan(px.y - c.y, px.x - c.x)) / TAU);
        float fan = exp(-sweep * 12.0) * (1.0 - smoothstep(0.985, 1.0, sweep))
            * exp(-max(fd, 0.0) / 90.0) * smoothstep(0.0, 4.0, fd) * step(reserved.x, px.y);
        col = mix(col, mix(accent, vec3(1.0), 0.5), fan * 0.4 * fade);
    }

    // The bar's lower edge: a fine pale blue line with a soft glint gliding
    // along it, and the frosted bar above lifted toward white.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        col = mix(col, vec3(1.0), 0.3 * step(below, 0.0));
        col = mix(col, accent, (1.0 - smoothstep(0.3, 1.0, abs(below))) * 0.6);
        float gx = cycle(15.0) * (resolution.x + 800.0) - 400.0;
        float glint = exp(-abs(px.x - gx) / 120.0);
        col = mix(col, vec3(1.0), glint * exp(-abs(below) / 2.0) * 0.9);
        col = mix(col, mix(accent, vec3(1.0), 0.6), glint * exp(-abs(below) / 9.0) * 0.35);
    }

    return vec4(col, 1.0);
}
