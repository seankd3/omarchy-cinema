// Oblivion: Tower 49 at dawn. A high pale sky over a sea of cloud that slides
// slowly toward the tower, the sun low on the horizon and the broken moon faint
// in the daylight. Every window is a pane of the tower's glass, traced by a fine
// blue line and lit along the edges that face the sun; round the focused one a
// drone's sensor ring circles.
//
// The theme is light, so the backdrop paints, not glows: lines are ink mixed
// over the sky, and light is a lift toward white. Under the windows only a
// near white wash of the sky's light shows, so the frosted glass reads as
// white paper with dark text on it.
//
// The panes float in the sun's light (specs/depth.md). Each casts a glass
// shadow on the cloud deck below it, toward the viewer and away from the
// sun: a slate patch, on the cloud rimmed by a gold caustic, further and
// softer as focus lifts the pane, and a lifted pane glows brighter against
// the sky. A moving pane draws vapour trails from its corners and parts the
// cloud behind it. Sunlight gathers round the pointer. Opening sweeps the
// drone's scan ring in onto the pane, landing jolts the sky and sends a
// pressure wave out with
// a bright crest, focus floods the pane's seams with gold, throws a glint of
// sun off it in a long flare and flares the sun across the whole sky,
// closing leaves a puff of vapour, and typing rings small ripples at
// the pane's foot. The blue ink of every answer fades out in the last 16 px
// before a pane, so the frost cannot pull it under text; their light may come
// right up to the glass, since white only raises the text's contrast.
//
// The panes and the sky are one scene. The cloud deck flows round each pane,
// bending and curling at its edges, and piles up white against them where it
// catches the sun. The viewer leans toward the pointer and a dragged pane
// pulls the deck after it, near rows more than far ones; the sky and the moon
// stay put. Under each pane the glass catches a sheen that slides as the
// pane moves and the sun's warm glow along the side facing it. Each pane's
// edge is Tower 49's glass (frame()): a fine blue line, the sky bending
// through the pane's thickness, the sun glinting on the edge that faces it,
// and the light passing by outside, the gold of a focus or the scan ring,
// catching it.

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
const vec3 STREAK = vec3(0.58, 0.78, 0.96); // an anamorphic flare

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

// The cloud deck below the horizon; `lean` moves the viewer across it (in
// the deck's own units), so near rows shift more than far ones.
vec3 cloudDeck(vec2 px, float horizon, vec2 sun, float lean) {
    float dy = max(px.y - horizon, 0.5);
    float depth = 90.0 * resolution.y / dy;
    vec2 world = vec2((px.x - resolution.x * 0.5) * depth / resolution.y + lean, depth);
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

// Distance from p to the segment from a to b.
float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    return length(ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0));
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

// What happened lately that the whole sky feels: how far a landing jolts
// it (x, pixels), how hard the sun flares (y) and the sensor ring flashes
// (z). The same at every point.
vec3 moments() {
    vec3 m = vec3(0.0);
    // Newest first: the ring is newest last, so past the first one older
    // than the longest answer (a landing's, 1.6 s) every one is.
    for (int k = impulseCount - 1; k >= 0; k--) {
        float age = impulses[k].z, s = impulses[k].w;
        int kind = impulseKinds[k];
        if (age > 1.6) break;
        if (kind == LAND) m.x += sin(age * 40.0) * exp(-age * 5.0) * 14.0 * s;
        else if (kind == OPEN) m.y += 0.6 * exp(-pow((age / 0.9 - 0.9) / 0.12, 2.0));
        else if (kind == FOCUS) {
            float fade = exp(-age * 2.6) * s;
            m.y += fade;
            m.z += 2.5 * fade;
        }
    }
    m.y = min(m.y, 1.0);
    return m;
}

// The sky answering what happened lately, at px: how far it lifts toward
// white (x) and toward the sun's gold (y), and how much of the drone's blue
// ink (z) and of a flare's pale blue streak (w) it lays there.
vec4 answers(vec2 px, vec2 sun) {
    vec4 a = vec4(0.0);
    for (int k = impulseCount - 1; k >= 0; k--) {
        vec4 e = impulses[k];
        int kind = impulseKinds[k];
        float age = e.z;
        if (age > 1.6) break;
        if (kind == TYPE) {
            float r = length(px - e.xy);
            if (age > 0.9 || r > 160.0) continue;
            // A ripple at the key's place on the pane's foot.
            float fade = 1.0 - age / 0.9;
            float front = abs(r - age * 110.0);
            a.z += (ink(front, 2.4) + 0.25 * exp(-front / 10.0)) * fade * e.w;
            a.y += exp(-r / 16.0) * exp(-age * 5.0) * 0.6 * e.w;
            continue;
        }
        if (kind == CLOSE) {
            float r = length(px - e.xy);
            if (age > 1.5 || r > 200.0 + age * 650.0) continue;
            // A puff of vapour where the pane was, spreading and thinning,
            // its rim inked blue, and a streak of the light it gave off.
            float R = 60.0 + age * 600.0;
            float fade = exp(-age * 2.0);
            a.x += ((1.0 - smoothstep(R * 0.3, R, r)) * 0.6 + exp(-abs(r - R) / 30.0) * 0.6) * fade;
            a.y += exp(-r / 60.0) * exp(-age * 4.0) * 1.2;
            a.z += (ink(abs(r - R), 3.0) + 0.3 * exp(-abs(r - R) / 24.0)) * fade;
            if (abs(px.y - e.y) < 40.0) a.w += exp(-abs(px.y - e.y) / 4.0) * exp(-abs(px.x - e.x) / 600.0) * exp(-age * 4.0) * 1.2;
            continue;
        }
        if (age > (kind == LAND ? 1.6 : kind == OPEN ? 0.9 : kind == FOCUS ? 1.4 : 0.0)) continue;
        int i = windowAt(e.xy);
        vec4 rect = i < 0 ? vec4(e.xy, 0.0, 0.0) : windowRect(i);
        float d = rectDistance(px, rect, i < 0 ? 0.0 : windowRounding(i));
        if (d < 0.0 || d > 900.0) continue;
        if (kind == LAND) {
            // A bright crest with the pressure line inked just ahead of it,
            // and the sun flashing off the pane as it lands.
            float front = d - age * 380.0;
            if (front > 260.0) continue;
            float fade = exp(-age * 2.0) * e.w;
            a.x += (exp(-abs(front) / 22.0) * 1.1 + exp(-abs(front) / 80.0) * 0.4) * fade;
            a.z += (ink(abs(front - 24.0), 3.0) + 0.35 * exp(-abs(front - 24.0) / 26.0)) * fade;
            a.y += exp(-d / 50.0) * exp(-age * 3.0) * 1.8 * e.w;
            continue;
        }
        // Where the pane faces the sun: its point nearest it, and the glint
        // just off it toward the sun, out in the seam: a bloom there in a
        // long, thin anamorphic flare across the sky.
        vec2 corner = clamp(sun, rect.xy, rect.xy + rect.zw);
        vec2 at = corner + normalize(sun - corner + vec2(0.0, -1e-3)) * 30.0;
        float c = length(px - at);
        float bloom = exp(-c / 36.0) * 1.4 + exp(-c / 220.0) * 0.6;
        float dy = abs(px.y - at.y);
        float line = dy > 120.0 ? 0.0 : exp(-dy / 4.0) * exp(-abs(px.x - at.x) / 800.0) * 1.4
            + exp(-dy / 30.0) * exp(-abs(px.x - at.x) / 500.0) * 0.4;
        if (kind == OPEN) {
            // The drone's scan ring sweeps in onto the pane's edge and the
            // sun catches it as it settles.
            float t = age / 0.9;
            float R = (1.0 - t) * (1.0 - t) * 340.0;
            a.z += (ink(abs(d - R), 3.0) + 0.3 * exp(-abs(d - R) / 30.0)) * (0.3 + 0.7 * t);
            float lock = exp(-pow((t - 0.9) / 0.12, 2.0));
            a.x += exp(-d / 12.0) * lock;
            a.y += (bloom + exp(-d / 50.0)) * lock;
            a.w += line * lock;
        } else {
            // Focus: the sun glints off the pane, floods its seams with gold
            // and a glint races round its edge; a ring rolls out from it.
            float fade = exp(-age * 2.6) * e.w;
            a.y += (bloom + exp(-d / 50.0) * 1.2) * fade * 1.4;
            a.w += line * fade * 1.4;
            a.x += exp(-d / 10.0) * fade;
            if (age < 0.8 && d < 40.0) {
                float head = fract(around(corner, rect) + age * 1.2);
                float behind = fract(head - around(px, rect)) * 2.0 * (rect.z + rect.w);
                float glint = exp(-behind / 90.0) * exp(-d / 6.0) * 1.6 * e.w;
                a.x += glint;
                a.y += glint * 0.5;
            }
            float front = abs(d - age * 460.0);
            a.z += (ink(front, 2.6) + 0.3 * exp(-front / 30.0)) * exp(-age * 2.5) * e.w;
        }
    }
    return a;
}

// A moving pane's wake: vapour trails from its corners (`glow`, with a blue
// fringe in `blue`) and the cloud it parts behind it (`part`).
void wake(vec2 px, out float glow, out float blue, out float part) {
    glow = 0.0;
    blue = 0.0;
    part = 0.0;
    for (int i = 0; i < windowCount; i++) {
        vec2 v = windowVelocity(i);
        float speed = length(v);
        if (speed < 40.0) continue;
        float k = min(speed / 1200.0, 1.0) * windowAlpha(i) * smoothstep(0.0, 3.0, windowDistance(px, i));
        if (k <= 0.0) continue;
        vec4 r = windowRect(i);
        vec2 tail = -v * 0.3;
        // Only a moving pane pays for its wake.
        int corners = speed < 40.0 ? 0 : 4;
        for (int c = 0; c < corners; c++) {
            vec2 a = r.xy + r.zw * vec2(float(c & 1), float(c >> 1));
            float t = clamp(dot(px - a, tail) / max(dot(tail, tail), 1e-3), 0.0, 1.0);
            float dist = segment(px, a, a + tail);
            float w = 2.0 + 16.0 * t;
            glow += exp(-dist / w) * (1.0 - t) * 1.2 * k;
            blue += exp(-dist / (w * 2.6)) * (1.0 - t) * 0.7 * k;
        }
        for (int g = 1; g <= corners - 1; g++) {
            vec4 ghost = r;
            ghost.xy -= v * 0.06 * float(g);
            float d = rectDistance(px, ghost, windowRounding(i));
            part = max(part, (1.0 - smoothstep(-30.0, 30.0, d)) * (1.0 - 0.25 * float(g)) * k);
        }
    }
}

vec4 backdrop(vec2 px) {
    float horizon = horizonY();
    vec2 sun0 = sunAt();
    vec3 moment = moments();
    float burst = moment.y, flash = moment.z;

    // The window nearest this point, for its line and its sunlit edge; how
    // near any is and how near a lifted one; and how the cloud flows round
    // them: pushed out from each edge and curling along it.
    float nearest = FAR;
    int closest = -1;
    float near = 0.0, lifted = 0.0;
    vec2 flow = vec2(0.0);
    for (int i = 0; i < windowCount; i++) {
        float d = windowDistance(px, i);
        near += exp(-max(d, 0.0) / 70.0);
        if (d < nearest) {
            nearest = d;
            closest = i;
        }
        float a = windowAlpha(i);
        lifted = max(lifted, windowLift(i) * exp(-max(d, 0.0) / 120.0) * a);
        vec2 n = edgeNormal(px, windowRect(i), windowRounding(i));
        flow += (n * 26.0 * exp(-max(d, 0.0) / 70.0) + vec2(n.y, -n.x) * 16.0 * exp(-max(d, 0.0) / 45.0)) * a;
    }
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);
    near = clamp(near, 0.0, 1.0);

    // The world as a landing jolts it: sky, cloud and sun, never the panes.
    // The viewer leans toward the pointer and a dragged pane pulls the deck
    // after it.
    vec2 pw = px + vec2(0.0, moment.x);
    vec2 sun = sun0;
    float lean = (pointer.x / resolution.x - 0.5) * 40.0
        + (focusedIndex < 0 ? 0.0 : windowVelocity(focusedIndex).x * 0.015);
    vec3 col = pw.y < horizon ? sky(pw, horizon, sun) : cloudDeck(pw + flow, horizon, sun, lean);
    // The sun itself: a soft white disc in a wide warm bloom, hazy at dawn.
    float ds = length(pw - sun);
    col = mix(col, SUN, 0.45 * exp(-ds / 380.0) + 0.5 * exp(-ds / 70.0));
    col = mix(col, vec3(1.0), 1.0 - smoothstep(14.0, 22.0, ds));
    // Focus taken, or a pane opened, the sun flares: the whole sky warms and
    // brightens for a beat, the bloom spreads and a streak runs through it.
    col = mix(col, mix(vec3(1.0), GOLD, 0.45), burst * (0.22 + 0.5 * exp(-ds / 520.0)));
    col = mix(col, STREAK, burst * exp(-abs(pw.y - sun.y) / 5.0) * exp(-abs(pw.x - sun.x) / 1100.0) * 0.7);

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
        // slate, soft, and on the cloud rimmed by the gold caustic a pane's edge
        // focuses (brightest where the shadow fades).
        float shadow = 0.0;
        for (int i = 0; i < windowCount; i++) {
            vec4 r = windowRect(i);
            float lift = windowLift(i);
            vec2 away = normalize(vec2((r.x + r.z * 0.5 - sun0.x) / resolution.x, 0.6));
            shadow = max(shadow, windowShadow(px, i, away * (24.0 + 56.0 * lift), 22.0 + 46.0 * lift));
        }
        col = mix(col, SLATE, 0.4 * shadow);
        col = mix(col, GOLD, 1.4 * shadow * (1.0 - shadow) * deck);

        // The cloud a moving pane parts: deeper below the deck's tops, and a
        // white haze of its passage in the sky.
        float trail, fringe, part;
        wake(px, trail, fringe, part);
        col = mix(col, mix(vec3(1.0), DEEP, deck), part * mix(0.5, 0.35, deck));

        // Sunlight gathers round the pointer.
        float hand = exp(-length(px - pointer.xy) / 230.0);
        col = mix(col, mix(vec3(1.0), GOLD, 0.6), hand * 0.4);

        if (closest >= 0 && nearest < 60.0) {
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
            float rim = exp(-max(nearest, 0.0) / 2.5);
            float glint = exp(-abs(px.x - rect.x - cycle(20.0) * rect.z) / 140.0) * step(px.y, rect.y + rect.w * 0.5);
            col = mix(col, vec3(1.0), rim * fade * (0.45 * facing + 0.5 * glint));
        }

        // The drone's sensor: a thin ring round the focused window, its arc
        // circling once every 12 seconds with a fading trail. It rides the eased
        // focus rect, so it glides to the next window when focus moves, and is as
        // present as the focus, so it fades with a closing window. Focus taken
        // flashes it.
        float fd = focusAlpha > 0.0 ? rectDistance(px, focused, 0.0) : FAR;
        if (abs(fd - RING) < 12.0) {
            float fade = focusAlpha;
            vec4 ring = focused + vec4(-RING, -RING, 2.0 * RING, 2.0 * RING);
            float behind = fract(cycle(12.0) - around(px, ring)) * 2.0 * (ring.z + ring.w);
            float trail_ = exp(-behind / 380.0);
            float onRing = 1.0 - smoothstep(0.3, 1.0 + flash * 0.4, abs(fd - RING));
            col = mix(col, accent, min(onRing * (0.25 + 0.75 * trail_ + flash), 1.0) * fade);
            col = mix(col, accent, (1.0 - smoothstep(0.0, 6.0, behind)) * exp(-abs(fd - RING) / 3.0) * 0.6 * fade);
            col = mix(col, vec3(1.0), min(flash * 0.25, 1.0) * exp(-abs(fd - RING) / 6.0) * fade);
        }

        // The answers: blue ink and flare, kept off the panes (the frost would
        // pull it under their text), then light.
        vec4 a = answers(px, sun0);
        float clear = smoothstep(6.0, 16.0, nearest);
        col = mix(col, accent, min(a.z + fringe, 1.0) * 0.9 * clear);
        col = mix(col, STREAK, min(a.w, 1.0) * 0.8 * clear);
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
    if (closest >= 0 && nearest < 0.0) {
        vec4 r = windowRect(closest);
        vec2 toSun = normalize(sun0 - r.xy - r.zw * 0.5 + vec2(0.0, -1e-3));
        float facing = exp(-(dot(r.zw * 0.5, abs(toSun)) - dot(px - r.xy - r.zw * 0.5, toSun)) / 90.0);
        float a = windowAlpha(closest) * inside;
        col = mix(col, vec3(1.0), 0.8 * glassStreak(px, r) * a);
        col = max(mix(col, mix(vec3(1.0), GOLD, 0.35), 0.35 * facing * a), background);
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

// Each pane's edge (specs/depth.md, part 2): Tower 49's glass. A fine blue
// line traces it, deeper at the top of the focused pane and paler at its
// foot as the border was, a soft grey-blue on the others; the sky just
// outside bends through the pane's thickness in its outer pixels; the sun
// glints on the edge that faces it; and the light passing by outside, the
// gold of a focus or a landing, catches the edge and warms it.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = rectDistance(px, r, rounding);
    if (d < -2.0 || d > 14.0) return vec4(0.0);
    bool focus = i == focusedIndex;
    vec2 n = edgeNormal(px, r, rounding);
    float down = clamp((px.y - r.y) / max(r.w, 1.0), 0.0, 1.0);
    vec3 tint = focus ? mix(vec3(0.24, 0.60, 0.82), vec3(0.65, 0.85, 0.95), down) : vec3(0.62, 0.70, 0.77);
    // One look at the world 12 px out, beside the glass: what its edge bends
    // into view and what light is passing there.
    vec3 outside = backdrop(px + n * 12.0).rgb;
    float warm = smoothstep(0.04, 0.22, outside.r - outside.b);
    tint = mix(tint, GOLD, warm * 0.85);
    float facing = max(dot(n, normalize(sunAt() - r.xy - r.zw * 0.5 + vec2(0.0, -1e-3))), 0.0);
    float line = (1.0 - smoothstep(0.4, 1.4, abs(d - 0.5))) * (focus ? 0.95 : 0.7) * (1.0 + 0.8 * warm);
    float edge = (1.0 - smoothstep(0.0, 4.0, d)) * smoothstep(-2.0, 0.0, d);
    vec3 bent = mix(outside, vec3(1.0), 0.3);
    float glint = line * facing * (0.5 + 0.5 * windowLift(i));
    float halo = exp(-max(d, 0.0) / 7.0) * step(0.0, d) * (focus ? 0.12 : 0.0) * (1.0 + 2.0 * warm);
    float a = clamp(max(max(edge * 0.8, line), halo), 0.0, 1.0);
    vec3 col = bent * edge * 0.8 * (1.0 - line) + tint * line + vec3(1.0) * glint * 0.6 + tint * halo;
    return vec4(min(col, vec3(a)), a) * windowAlpha(i);
}
