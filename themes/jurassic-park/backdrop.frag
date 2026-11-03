// Jurassic Park: fsn, the File System Navigator Lex flies through on the
// control room's SGI ("It's a UNIX system! I know this!"). A navy void under
// a black sky that turns green at the horizon. Directories are rose platforms
// on the ground, their files azure blocks on top, as tall as the file is big
// and, as fsn colours by age, now and then teal, blue, gold, red or lavender.
// Thin pale wires run from each directory to its children, and the camera
// glides slowly on through the tree. The focused window is the selected
// item: fsn's spotlight stands on it, a pale cone from above and a white pool
// round its foot. Behind the glass the landscape keeps its shape but not its
// glare.
//
// The windows are objects standing in the landscape (specs/depth.md), calm
// while you work and shining when they move (Sean, 2026-10-29: "nice and
// elegant and give depth to the window"; "Unless like I'm moving windows round
// or whatever, then you can really make things shine"). Lit from behind and
// above, each throws its shadow on the ground in front of its foot, further
// and softer as focus lifts it, and the spotlight spills onto the platforms
// round the focused one's foot. Each is framed in IRIX's grey bevel, the
// landscape bent through it. The green horizon lies on the upper glass with a
// soft streak that slides as the window does. The eye leans a little with the
// pointer, so the near landscape shifts a few pixels against the far. A
// dragged window pulls the camera along a little and its wake lights the wires
// and platforms it crosses; when it lands, the blocks round its foot pop up and
// settle in a wave, as fsn opens a directory. Opening a window raises them
// softly; focus glides the spotlight; the horizon brightens a little with your
// voice. Typing has no answer.

// The film's colours, from its frames and the O2 recreation of the scene.
const vec3 SKY = vec3(0.004, 0.008, 0.024);
const vec3 HORIZON = vec3(0.15, 0.50, 0.42);
const vec3 GROUND = vec3(0.035, 0.055, 0.15);
const vec3 FAR_GROUND = vec3(0.07, 0.13, 0.24);
const vec3 PLATFORM = vec3(0.78, 0.44, 0.61);
const vec3 WIRE = vec3(0.56, 0.89, 0.84);
const vec3 SPOT = vec3(1.0, 0.98, 0.91);
// The files' ages, newest last: mostly the film's azure.
const vec3 AGES[6] = vec3[](vec3(0.25, 0.72, 0.93), vec3(0.13, 0.66, 0.60), vec3(0.29, 0.45, 0.94),
                            vec3(0.72, 0.64, 0.96), vec3(0.94, 0.74, 0.31), vec3(0.91, 0.32, 0.29));

// Whether each block carries its file's name, and each directory its name
// on the ground before it, as the film's do; false draws the landscape with
// no text (Sean, 2026-10-29: "lets try lots of stuff").
const bool LABELS = true;
const vec3 FILE_LABEL = vec3(0.97, 0.87, 0.95);
const vec3 DIR_LABEL = vec3(0.66, 0.94, 0.90);

// The landscape, in world units (a block is about one across). Directories
// stand one to a slot in rows, slots CELL.x across and rows CELL.y deep; a
// directory's files stand on it in a grid PITCH apart, each with its name in
// front of it.
const vec2 CELL = vec2(14.0, 20.0);
const vec2 PITCH = vec2(1.8, 2.0);
const vec2 BLOCK = vec2(1.15, 0.9);
const float MARGIN = 0.5;
// A platform stands LOW to HIGH, as its files are small or big, and a block
// up to TALLEST on it; nothing in the landscape is higher than SLAB.
const float LOW = 0.25;
const float HIGH = 1.75;
const float TALLEST = 3.6;
const float SLAB = HIGH + TALLEST;
// The tree repeats every ROWS rows and the camera glides a row every
// ROW_SECONDS, so the hour's wrap lands on the same landscape.
const float ROWS = 80.0;
const float ROW_SECONDS = 45.0;
const float EYE = 11.0;      // the camera's height
const float FOCAL = 1.0;     // screen heights
const float DOWN = 0.2;      // how far above the middle the horizon sits, in screen heights
const float SIGHT = 240.0;   // how far the landscape reaches before the void takes it
const int STEPS = 24;         // slots a ray crosses at most within SIGHT

// Behind the glass the landscape keeps this share of its light, and no
// channel goes over GLASS_CAP, so secondary text over it keeps 4.5:1.
const float UNDER_GLASS = 0.3;
const float GLASS_CAP = 0.2;
// The horizon's sheen on the glass rides on that cap, at most this much a
// channel, so muted text keeps 4.5:1 with it.
const float SHEEN = 0.05;

// Where the light comes from: the green horizon behind the windows and the
// lamp over the focused one, above and a little to the left, as IRIX lights
// its bevels. Shadows fall away from it, in front of each window's foot, and
// the bevels are bright where they face it.
const vec2 LIGHT = vec2(-0.45, -0.89);
// IRIX's bevel: its lit and shaded faces on the focused window (the theme's
// old active border), and the frame of the others (its inactive one).
const vec3 BEVEL_LIT = vec3(0.894, 0.894, 0.910);
const vec3 BEVEL_SHADED = vec3(0.541, 0.541, 0.580);
const vec3 BEVEL_IDLE = vec3(0.353, 0.369, 0.424);
const float RIM = 6.0; // the bevel's width outside the window, in pixels
const vec2 HALO = vec2(0.25, 6.0); // how the bar's wire glows (glowLine)

// How the blocks round a window's foot answer what happens to it: landing
// pops them up and lets them settle, as fsn opens a directory, harder the
// faster the window came; opening raises them softly; nothing else moves
// them. The wave runs out over the ground at POP_SPEED world units a second
// and fades over POP_REACH, and is over within POP_LIFE seconds. A popping
// block still stands no higher than SLAB.
float popOf(int kind) {
    return kind == LAND ? 1.0 : kind == OPEN ? 0.3 : 0.0;
}
const float POP_SPEED = 40.0;
const float POP_REACH = 30.0;
const float POP_LIFE = 1.2;

float rowKey(float k) {
    return mod(k, ROWS);
}

// Each slot's own number: whether a directory stands there, and which way
// it looks for its parent.
float slotHash(vec2 slot) {
    return hash(vec2(slot.x, rowKey(slot.y)) * 0.731 + 0.17);
}

const float DENSITY = 0.58; // the share of slots with a directory

bool present(vec2 slot) {
    return slotHash(slot) < DENSITY;
}

struct Dir {
    vec2 lo, hi;   // footprint on the ground
    float top;     // the platform's height
    int nx, files; // files across, and how many
    vec2 key;
};

// The directory in a slot: its size from its file count, its height from
// their size. Each straddles the middle of its row, so the wires to its
// parent and children stay within half a row of the boundary between them.
// Three hashes make it, each split into two numbers.
Dir dirAt(vec2 slot) {
    Dir d;
    d.key = vec2(slot.x, rowKey(slot.y));
    vec3 h = vec3(hash(d.key + 3.1), hash(d.key + 7.7), hash(d.key + 11.3));
    vec3 f = fract(h * 13.7);
    d.nx = 2 + int(h.x * 3.99);
    int nz = 1 + int(h.y * 3.99);
    d.files = d.nx * nz - int(f.z * float(d.nx - 1));
    vec2 size = vec2(float(d.nx), float(nz)) * PITCH + 2.0 * MARGIN;
    float cx = (slot.x + 0.5) * CELL.x + (f.x - 0.5) * (CELL.x - size.x) * 0.7;
    float front = (slot.y + 0.5) * CELL.y - size.y * (0.2 + 0.6 * f.y);
    d.lo = vec2(cx - size.x * 0.5, front);
    d.hi = d.lo + size;
    d.top = LOW + (HIGH - LOW) * h.z * h.z;
    return d;
}

// A directory's parent, in the row before: the slot behind it, or one beside
// that; none (x = FAR) for the roots of the forest.
vec2 parentOf(vec2 slot) {
    float side = fract(slotHash(slot) * 37.0) < 0.5 ? -1.0 : 1.0;
    vec2 up = slot - vec2(0.0, 1.0);
    if (present(up)) return up;
    if (present(up + vec2(side, 0.0))) return up + vec2(side, 0.0);
    if (present(up - vec2(side, 0.0))) return up - vec2(side, 0.0);
    return vec2(FAR);
}

// A file's block: as tall as the file is big, most of them small.
float blockHeight(vec2 key, int b) {
    float h = hash(key + vec2(float(b) * 1.37, 5.0));
    return 0.3 + (TALLEST - 0.3) * h * h * h;
}

// And coloured by its age, as fsn does.
vec3 blockColour(vec2 key, int b) {
    float a = hash(key + vec2(float(b) * 2.11, 9.0));
    return AGES[a < 0.62 ? 0 : a < 0.74 ? 1 : a < 0.82 ? 2 : a < 0.89 ? 3 : a < 0.95 ? 4 : 5];
}

// The names the landscape's files and directories carry: the park's own.
const int FILE_NAMES = 32;
const int DIR_NAMES = 16;
const int NAME_START[49] = int[](
    0, 6, 11, 20, 34, 42, 56, 63, 68, 77, 91, 96, 104, 109, 124, 133, 143, 153, 162, 168,
    177, 187, 198, 209, 220, 230, 242, 253, 263, 274, 286, 295, 302, 309, 326, 334, 343, 351, 360, 372,
    386, 394, 409, 416, 430, 444, 453, 461, 469);
const int NAME_CHARS[469] = int[](
    65, 114, 109, 111, 114, 121, 70, 101, 110, 99, 101, 77, 97, 105, 110, 46, 71, 97, 116, 101,
    72, 97, 109, 109, 111, 110, 100, 115, 46, 76, 111, 100, 103, 101, 67, 104, 101, 109, 105, 99,
    97, 108, 80, 104, 97, 114, 109, 97, 99, 101, 117, 116, 105, 99, 97, 108, 72, 101, 108, 105,
    112, 97, 100, 72, 111, 116, 101, 108, 68, 105, 108, 111, 46, 68, 111, 99, 107, 69, 109, 98,
    114, 121, 111, 46, 83, 116, 111, 114, 97, 103, 101, 84, 45, 82, 101, 120, 86, 101, 104, 105,
    99, 108, 101, 115, 86, 105, 100, 101, 111, 86, 105, 115, 105, 116, 111, 114, 115, 46, 67, 101,
    110, 116, 101, 114, 80, 101, 114, 105, 109, 101, 116, 101, 114, 82, 97, 112, 116, 111, 114, 46,
    80, 101, 110, 80, 111, 119, 101, 114, 46, 71, 114, 105, 100, 84, 111, 117, 114, 46, 67, 97,
    114, 115, 65, 118, 105, 97, 114, 121, 80, 97, 100, 100, 111, 99, 107, 46, 55, 71, 97, 108,
    108, 105, 109, 105, 109, 117, 115, 66, 114, 97, 99, 104, 105, 111, 115, 97, 117, 114, 84, 114,
    105, 99, 101, 114, 97, 116, 111, 112, 115, 70, 101, 101, 100, 105, 110, 103, 46, 76, 111, 103,
    115, 99, 104, 101, 100, 117, 108, 101, 46, 55, 112, 101, 114, 115, 111, 110, 110, 101, 108, 46,
    53, 50, 97, 118, 105, 97, 116, 105, 111, 110, 46, 51, 51, 100, 111, 111, 114, 46, 108, 111,
    99, 107, 115, 73, 115, 108, 97, 46, 78, 117, 98, 108, 97, 114, 67, 111, 110, 116, 114, 111,
    108, 46, 82, 111, 111, 109, 71, 101, 110, 101, 114, 97, 116, 111, 114, 68, 111, 100, 103, 115,
    111, 110, 90, 111, 111, 108, 111, 103, 121, 80, 104, 121, 115, 105, 99, 97, 108, 46, 83, 101,
    99, 117, 114, 105, 116, 121, 65, 118, 105, 97, 116, 105, 111, 110, 80, 101, 114, 115, 111, 110,
    110, 101, 108, 83, 99, 104, 101, 100, 117, 108, 101, 84, 101, 108, 101, 112, 104, 111, 110, 101,
    84, 111, 117, 114, 46, 67, 111, 110, 116, 114, 111, 108, 65, 110, 105, 109, 97, 108, 46, 70,
    101, 101, 100, 105, 110, 103, 82, 101, 115, 101, 97, 114, 99, 104, 65, 105, 114, 112, 111, 114,
    116, 46, 70, 108, 105, 103, 104, 116, 115, 65, 110, 105, 109, 97, 108, 115, 80, 104, 121, 115,
    105, 99, 97, 108, 46, 80, 108, 97, 110, 116, 86, 105, 115, 105, 116, 111, 114, 46, 67, 101,
    110, 116, 101, 114, 78, 101, 100, 114, 121, 108, 97, 110, 100, 72, 97, 116, 99, 104, 101, 114,
    121, 71, 101, 110, 101, 116, 105, 99, 115);

int nameLength(int n) {
    return NAME_START[n + 1] - NAME_START[n];
}

// How much of name `n` inks the ground or platform point q: written along x
// from at.x, the tops of its letters at at.y and their feet toward the
// viewer, each letter `cell` (across, deep) in world units.
float writing(int n, vec2 q, vec2 at, vec2 cell) {
    vec2 uv = vec2(q.x - at.x, at.y - q.y) / cell;
    if (uv.y < 0.0 || uv.y >= 1.0 || uv.x < 0.0 || uv.x >= float(nameLength(n))) return 0.0;
    return glyph(NAME_CHARS[NAME_START[n] + int(uv.x)], vec2(fract(uv.x), uv.y));
}

// A name only shows while its letters stand at least a few pixels tall: `deep`
// is their depth on the ground, seen `t` away at a grazing `sine`.
float legible(float deep, float sine, float t) {
    return smoothstep(4.0, 8.0, deep * sine / t * resolution.y);
}

// The name on the platform in front of the file under p, if any.
float fileLabel(Dir d, vec2 p, float sine, float t) {
    vec2 q = p - d.lo - MARGIN;
    ivec2 c = ivec2(floor(q / PITCH));
    int b = c.y * d.nx + c.x;
    if (c.x < 0 || c.x >= d.nx || c.y < 0 || b >= d.files) return 0.0;
    int n = int(hash(d.key + vec2(float(b) * 3.7, 13.0)) * float(FILE_NAMES));
    float len = float(nameLength(n));
    // Letters lie on the platform, so they are drawn deep to read upright
    // from the camera's slant.
    float cw = min(0.2, (PITCH.x - 0.1) / len);
    vec2 cell = vec2(cw, min(cw * 3.3, 0.66));
    // The name sits in the strip before its block, half a unit into the pitch.
    vec2 mid = d.lo + MARGIN + vec2((float(c.x) + 0.5) * PITCH.x, float(c.y) * PITCH.y + 0.5);
    return writing(n, p, vec2(mid.x - cw * len * 0.5, mid.y + cell.y * 0.5), cell) * legible(cell.y, sine, t);
}

// The directory's name on the ground before it, if p is there.
float dirLabel(vec2 p, float sine, float t) {
    vec2 slot = floor(p / CELL);
    if (!present(slot)) return 0.0;
    Dir d = dirAt(slot);
    int n = FILE_NAMES + int(hash(d.key + 19.1) * float(DIR_NAMES));
    float len = float(nameLength(n));
    float cw = min(0.75, (d.hi.x - d.lo.x) / len);
    vec2 cell = vec2(cw, min(cw * 1.6, 2.0));
    return writing(n, p, vec2((d.lo.x + d.hi.x - cw * len) * 0.5, d.lo.y - 0.4), cell) * legible(cell.y, sine, t);
}

// The events the blocks are answering (popOf), the newest POP_COUNT of them:
// the foot of the window each happened to, on the ground (from xy to zw), its
// age and how hard. backdrop() fills them once a pixel, before it casts the ray.
const int POP_COUNT = 4;
vec4 popFoot[POP_COUNT];
vec2 popWhen[POP_COUNT];
int pops = 0;

// How much the blocks of a directory standing at c grow from the events
// round it: a wave out from each window's foot that pops them up and lets
// them settle; 0 at rest.
float popAt(vec2 c) {
    float grow = 0.0;
    for (int k = 0; k < POP_COUNT; k++) {
        if (k >= pops) break;
        float far = segment(c, popFoot[k].xy, popFoot[k].zw);
        float u = popWhen[k].x - far / POP_SPEED;
        if (u > 0.0) grow += popWhen[k].y * exp(-far / POP_REACH - u * 5.0) * sin(u * 14.0);
    }
    return grow;
}

// What a ray meets first: how far along it, the face's normal, what it is,
// and how much its directory's blocks have grown (popAt).
struct Hit {
    float t;
    vec3 n;
    int kind;   // 0 ground, 1 platform, 2 block
    Dir dir;    // the platform's directory, or the block's
    int block;
    float grow;
};

// Ray against a box: (in, out), and the face it enters by.
vec2 box(vec3 ro, vec3 inv, vec3 lo, vec3 hi, out vec3 n) {
    vec3 a = (lo - ro) * inv, b = (hi - ro) * inv;
    vec3 near = min(a, b), far = max(a, b);
    float t0 = max(max(near.x, near.y), near.z);
    float t1 = min(min(far.x, far.y), far.z);
    n = -sign(inv) * step(near.yzx, near) * step(near.zxy, near);
    return vec2(t0, t1);
}

// The directory in `slot` against the ray: its platform, then its files'
// blocks, walked front to back across their grid.
bool directory(vec3 ro, vec3 rd, vec3 inv, vec2 slot, inout Hit hit) {
    if (!present(slot)) return false;
    Dir d = dirAt(slot);
    vec3 n;
    // While blocks pop, any of them may stand as high as anything can.
    vec2 span = box(ro, inv, vec3(d.lo.x, 0.0, d.lo.y), vec3(d.hi.x, pops > 0 ? SLAB : d.top + TALLEST, d.hi.y), n);
    if (span.x > span.y || span.y < 0.0) return false;
    float grow = pops > 0 ? popAt((d.lo + d.hi) * 0.5) : 0.0;
    vec3 pn;
    vec2 base = box(ro, inv, vec3(d.lo.x, 0.0, d.lo.y), vec3(d.hi.x, d.top, d.hi.y), pn);
    float best = base.x <= base.y ? base.x : FAR;
    int kind = 1, block = -1;
    vec3 bestN = pn;

    vec2 origin = d.lo + MARGIN;
    vec2 q = ro.xz + rd.xz * max(span.x, 0.0) - origin;
    ivec2 grid = ivec2(d.nx, (d.files + d.nx - 1) / d.nx);
    ivec2 c = clamp(ivec2(floor(q / PITCH)), ivec2(0), grid - 1);
    ivec2 dir = ivec2(sign(rd.xz));
    vec2 delta = abs(PITCH / rd.xz);
    vec2 next = ((vec2(c) + max(sign(rd.xz), 0.0)) * PITCH + origin - ro.xz) / rd.xz;
    for (int s = 0; s < 9; s++) {
        int b = c.y * d.nx + c.x;
        if (b < d.files) {
            vec2 lo = origin + vec2(c) * PITCH + vec2((PITCH.x - BLOCK.x) * 0.5, PITCH.y - BLOCK.y - 0.15);
            vec3 bn;
            vec2 t = box(ro, inv, vec3(lo.x, d.top, lo.y), vec3(lo.x + BLOCK.x, min(d.top + blockHeight(d.key, b) * (1.0 + grow), SLAB), lo.y + BLOCK.y), bn);
            if (t.x <= t.y && t.x < best) {
                best = t.x;
                bestN = bn;
                kind = 2;
                block = b;
                break;
            }
        }
        float leave = min(next.x, next.y);
        if (leave > min(best, span.y)) break;
        if (next.x < next.y) {
            next.x += delta.x;
            c.x += dir.x;
        } else {
            next.y += delta.y;
            c.y += dir.y;
        }
        if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, grid))) break;
    }
    if (best >= FAR) return false;
    hit.t = best;
    hit.n = bestN;
    hit.kind = kind;
    hit.dir = d;
    hit.block = block;
    hit.grow = grow;
    return true;
}

// The first thing the ray meets: the slots it crosses within the height
// anything stands at, front to back, then the ground.
Hit trace(vec3 ro, vec3 rd, float ground) {
    Hit hit;
    hit.t = ground;
    hit.n = vec3(0.0, 1.0, 0.0);
    hit.kind = 0;
    hit.block = -1;
    hit.grow = 0.0;
    float start = max((ro.y - SLAB) / -rd.y, 0.0);
    float end = min(ground, SIGHT);
    if (start >= end) return hit;
    vec3 inv = 1.0 / rd;
    vec2 p = ro.xz + rd.xz * start;
    vec2 slot = floor(p / CELL);
    vec2 dir = sign(rd.xz);
    vec2 delta = abs(CELL / rd.xz);
    vec2 next = ((slot + max(dir, 0.0)) * CELL - ro.xz) / rd.xz;
    for (int s = 0; s < STEPS; s++) {
        if (directory(ro, rd, inv, slot, hit)) return hit;
        float t = min(next.x, next.y);
        if (t > end) break;
        if (next.x < next.y) {
            next.x += delta.x;
            slot.x += dir.x;
        } else {
            next.y += delta.y;
            slot.y += dir.y;
        }
    }
    return hit;
}

// The wires lying on the ground at g, as coverage: each runs from a
// directory's back to the front of a child in the next row, so only the three
// children nearest g can reach it, and of those beside g's slot only one whose
// parent is in g's slot. `pixel` is the ground's size of a pixel.
float wires(vec2 g, vec2 pixel) {
    vec2 row = vec2(floor(g.x / CELL.x), floor(g.y / CELL.y + 0.5));
    float wire = 0.0;
    for (int k = -1; k <= 1; k++) {
        vec2 slot = row + vec2(float(k), 0.0);
        if (!present(slot)) continue;
        vec2 up = parentOf(slot);
        if (up.x >= FAR || (k != 0 && up.x != row.x)) continue;
        Dir child = dirAt(slot), parent = dirAt(up);
        vec2 a = vec2((parent.lo.x + parent.hi.x) * 0.5, parent.hi.y);
        vec2 b = vec2((child.lo.x + child.hi.x) * 0.5, child.lo.y);
        vec2 across = abs(normalize(vec2(b.y - a.y, a.x - b.x)));
        float w = segment(g, a, b) / max(dot(across, pixel), 1e-5);
        wire = max(wire, 1.0 - smoothstep(0.4, 1.4, w));
    }
    return wire;
}

// The camera, gliding a row every ROW_SECONDS and swaying across the slots,
// turned a little into the sway; pitched down so the horizon sits DOWN
// screen heights above the middle. The eye leans a little toward the pointer
// and is pulled along by a dragged window, so the near landscape shifts a few
// pixels against them and the far hardly at all: perspective is the parallax.
// However fast the window goes, the pull stays within about 20 pixels, and a
// pointer on another screen leans it no further than this screen's edge.
void camera(out vec3 ro, out vec3 forward, out vec3 right, out vec3 up) {
    float sway = cycle(240.0) * TAU;
    vec2 drag = focusedIndex >= 0 ? clamp(windowVelocity(focusedIndex), -3000.0, 3000.0) : vec2(0.0);
    vec2 lean = (clamp(pointer.xy / resolution, 0.0, 1.0) - 0.5) * vec2(0.15, -0.1);
    ro = vec3(CELL.x * 0.5 + 5.0 * sin(sway) + lean.x + drag.x * 6e-5, EYE + lean.y,
              cycle(ROWS * ROW_SECONDS) * ROWS * CELL.y - drag.y * 6e-5);
    float yaw = 0.05 * cos(sway);
    float pitch = atan(DOWN / FOCAL);
    forward = vec3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch));
    right = vec3(cos(yaw), 0.0, -sin(yaw));
    up = cross(forward, right);
}

vec3 rayAt(vec2 px, vec3 forward, vec3 right, vec3 up) {
    vec2 s = vec2(px.x - resolution.x * 0.5, resolution.y * 0.5 - px.y) / (FOCAL * resolution.y);
    vec3 rd = normalize(forward + right * s.x + up * s.y);
    // No component exactly zero, so the walks never divide by it.
    return rd + vec3(1e-6) * (1.0 - abs(sign(rd)));
}

// Where a screen point's ray meets the ground, at most REACH away: a ray that
// meets it further off, or not at all above the horizon, is taken REACH along
// its track, so a light set there still shows before the void takes it.
const float REACH = 0.45 * SIGHT;

vec2 groundAt(vec2 px, vec3 ro, vec3 forward, vec3 right, vec3 up) {
    vec3 rd = rayAt(px, forward, right, up);
    float far = REACH / length(rd.xz);
    return ro.xz + rd.xz * (rd.y < 0.0 ? min(-ro.y / rd.y, far) : far);
}

// Window w's shadow at px: lit from behind and above, a window standing in
// the landscape throws its shadow forward, onto whatever lies in front of its
// foot and a little to the right, away from the light, further and softer as
// focus lifts it; what stands behind it, seen through the glass, stays lit.
// 1 in full shadow.
float shadowOf(vec2 px, Window w) {
    vec4 r = w.rect;
    float lift = w.lift;
    float reach = 30.0 + 50.0 * lift;
    float below = px.y - (r.y + r.w);
    if (below < -2.0 || below > reach * 4.0) return 0.0;
    float slide = max(below, 0.0) * LIGHT.x / LIGHT.y;
    float across = max(r.x + slide - px.x, px.x - (r.x + r.z + slide));
    float side = 1.0 - smoothstep(-8.0 - 12.0 * lift, 8.0 + 24.0 * lift, across);
    return side * exp(-max(below, 0.0) / reach) * smoothstep(-2.0, 2.0, below) * w.alpha;
}

// How much window w's wake lights px: the ground it
// crossed in the last tenth of a second or so, at most 400 pixels of it,
// outside the window itself, brightest just behind it; 0 while it stands
// still.
float wakeOf(vec2 px, Window w) {
    vec2 v = w.velocity;
    float speed = length(v);
    if (speed < 40.0 || w.d < 0.0) return 0.0;
    vec4 r = w.rect;
    float pace = min(speed / 1500.0, 1.0) * w.alpha;
    vec2 back = v * min(0.03, 80.0 / speed);
    float wake = 0.0;
    for (int k = 1; k <= 5; k++) {
        vec4 ghost = r;
        ghost.xy -= back * float(k);
        wake = max(wake, pace * (1.0 - 0.17 * float(k)) * (1.0 - smoothstep(-30.0, 30.0, rectDistance(px, ghost, 0.0))));
    }
    return wake;
}

vec4 backdrop(vec2 px) {
    vec3 ro, forward, right, up;
    camera(ro, forward, right, up);
    vec3 rd = rayAt(px, forward, right, up);
    // The ground under this pixel and its size, taken before anything
    // branches, so the screen derivatives hold.
    float ground = rd.y < 0.0 ? -ro.y / rd.y : FAR;
    vec2 g = (ro + rd * min(ground, 4.0 * SIGHT)).xz;
    vec2 pixel = fwidth(g);

    // The windows at this point: the nearest one's distance, the topmost
    // whose glass it is behind, the shadows they throw on it and their wakes.
    Seen seen = UNSEEN;
    float shadow = 0.0, wake = 0.0;
    for (int i = 0; i < windowCount; i++) {
        Window w = window(px, i);
        see(seen, w);
        shadow = max(shadow, shadowOf(px, w));
        wake = max(wake, wakeOf(px, w));
    }
    float nearest = seen.nearest;
    float inside = 1.0 - smoothstep(-1.0, 1.0, nearest);

    // fsn's spotlight: the focused window is the selected item, so a pool of
    // light lies at its foot and the cone rises from it to a lamp just over
    // its top edge. It glides with the focus from window to window, and is
    // as present as the focus: it fades with a closing window, and with
    // nothing focused there is none. A foot above the horizon, or beyond the
    // void's edge, has no landscape under it, so its pool lands on the
    // nearest landscape below it (groundAt).
    vec2 g0 = groundAt(focused.xy + vec2(0.0, focused.w), ro, forward, right, up);
    vec2 g1 = groundAt(focused.xy + focused.zw, ro, forward, right, up);
    vec2 pool = (g0 + g1) * 0.5;
    float radius = length(g1 - g0) * 0.15 + 0.6;
    vec3 over = rayAt(vec2(focused.x + focused.z * 0.5, focused.y - 30.0), forward, right, up);
    float lampY = max(ro.y + over.y * length(pool - ro.xz) / length(over.xz), 3.0);
    float spill = focusedIndex >= 0 ? windowLift(focusedIndex) * focusAlpha : 0.0;

    // The events the blocks answer, newest first, each at its window's foot.
    // Each slot is filled in turn (its index known when the loop unrolls, so
    // the slots stay in registers).
    int next = impulseCount - 1;
    pops = 0;
    for (int s = 0; s < POP_COUNT; s++) {
        while (next >= 0 && impulses[next].z <= POP_LIFE && popOf(impulseKinds[next]) == 0.0) next--;
        if (next < 0 || impulses[next].z > POP_LIFE) break;
        vec4 e = impulses[next];
        int kind = impulseKinds[next];
        vec4 r = impulseRect(next);
        popFoot[s] = vec4(groundAt(r.xy + vec2(0.0, r.w), ro, forward, right, up), groundAt(r.xy + r.zw, ro, forward, right, up));
        popWhen[s] = vec2(e.z, popOf(kind) * (kind == LAND ? 0.4 + 0.6 * e.w : 1.0));
        pops = s + 1;
        next--;
    }

    vec3 col;
    float t = FAR;
    if (rd.y >= 0.0) {
        // The sky, black overhead and green at the horizon, as fsn's is; the
        // horizon brightens a little with your voice.
        col = mix(HORIZON, SKY, smoothstep(0.0, 0.09, rd.y));
        col += HORIZON * 0.5 * (1.0 + 0.6 * voice) * exp(-rd.y / 0.004);
    } else {
        Hit hit = trace(ro, rd, ground);
        t = hit.t;
        vec3 p = ro + rd * t;
        float wire = 0.0;
        if (hit.kind == 0) {
            // The void, hazier toward the horizon, and its wires.
            col = mix(GROUND, FAR_GROUND, smoothstep(20.0, SIGHT * 1.6, t));
            if (inside < 1.0) {
                wire = wires(p.xz, pixel) * (1.0 - smoothstep(SIGHT * 0.5, SIGHT, t));
                col = mix(col, WIRE * 0.75, wire);
                if (LABELS) col = mix(col, DIR_LABEL, dirLabel(p.xz, -rd.y, t) * 0.8);
            }
        } else {
            vec3 base = hit.kind == 1 ? PLATFORM : blockColour(hit.dir.key, hit.block);
            // fsn's flat shading: faces toward the viewer brightest, the
            // tops a little less, the sides dark.
            float shade = hit.n.y > 0.5 ? 0.86 : hit.n.z < -0.5 ? 1.0 : 0.6;
            if (hit.kind == 1) shade = hit.n.y > 0.5 ? 1.0 : hit.n.z < -0.5 ? 0.72 : 0.55;
            col = base * shade;
            if (LABELS && hit.kind == 1 && hit.n.y > 0.5 && inside < 1.0)
                col = mix(col, FILE_LABEL, fileLabel(hit.dir, p.xz, -rd.y, t) * 0.9);
            // Blocks popping up catch the light as they rise.
            col *= 1.0 + 1.5 * max(hit.grow, 0.0);
        }
        // fsn draws the selected directory in full colour and the rest a
        // shade darker: here the landscape round the focused window.
        float fd = max(rectDistance(px, focused, 0.0), 0.0);
        col *= mix(1.0, mix(0.72, 1.0, exp(-fd / 360.0)), focusAlpha);
        // The windows' shadows lie on the landscape in front of them.
        col *= 1.0 - 0.7 * shadow;
        // The pool of light, on whatever stands inside the cone, and its
        // spill on the platforms and blocks just outside it; the window's own
        // shadow lies across the pool too, fainter than on the dark.
        float r = length(p.xz - pool) - radius * (1.0 - p.y / lampY);
        float lit = (1.0 - smoothstep(-pixel.x * 1.5, pixel.x * 1.5, r)) * focusAlpha;
        col = mix(col, hit.kind == 2 ? min(col * 1.6 + 0.15, vec3(1.0)) : SPOT * (1.0 - 0.35 * shadow), lit * (hit.kind == 2 ? 0.8 : 0.9));
        if (hit.kind > 0) col += SPOT * col * 0.9 * spill * exp(-max(r, 0.0) / radius) * (1.0 - lit);
        // A moving window's wake lights what it crossed, as if the spotlight
        // had swept over it: the wires glow, and the platforms and blocks
        // stand in its light.
        if (hit.kind == 0) col += WIRE * (0.07 + 0.9 * wire) * wake;
        else col = mix(col, min(col * 1.4 + SPOT * 0.3, vec3(1.0)), wake * 0.85);
        // The wave from an event runs out over the ground as a ring of light,
        // bright enough to carry through the glass.
        for (int k = 0; k < POP_COUNT; k++) {
            if (k >= pops) break;
            float far = segment(p.xz, popFoot[k].xy, popFoot[k].zw);
            float u = popWhen[k].x - far / POP_SPEED;
            col += WIRE * 1.2 * popWhen[k].y * exp(-abs(u) * 12.0 - popWhen[k].x * 3.0 - far / POP_REACH);
        }
        // Far things sink into the void.
        col = mix(col, FAR_GROUND, smoothstep(SIGHT * 0.55, SIGHT, t));
    }

    // The cone's pale veil, in front of what the ray meets, with its edges
    // drawn as fine lines: taken where the ray passes closest to the cone's
    // axis, which stands straight up from the pool.
    {
        float flat_ = length(rd.xz);
        vec2 track = rd.xz / flat_, o = pool - ro.xz;
        float tc = dot(o, track) / flat_;
        float yc = ro.y + rd.y * tc;
        float miss = abs(o.x * track.y - o.y * track.x);
        float rc = radius * (1.0 - yc / lampY);
        if (tc > 0.0 && tc < t && yc > 0.0 && miss < rc) {
            float edge = 1.0 - smoothstep(0.0, 1.6, (rc - miss) / tc * resolution.y);
            col = mix(col, SPOT, (0.11 + 0.55 * edge) * focusAlpha);
        }
    }

    // Behind the glass the landscape keeps its shape but not its glare.
    float peak = max(col.r, max(col.g, col.b));
    col = mix(col, col * min(UNDER_GLASS, GLASS_CAP / max(peak, 1e-4)), inside);

    // The glass catches the green horizon: a soft band along its upper edge,
    // and a faint diagonal streak whose place follows the window across the
    // screen, as a reflection slides when the pane moves. Only the glass
    // shows it; the window's text stays over it, opaque.
    int pane = seen.over;
    if (pane >= 0) {
        vec4 r = windowRect(pane);
        vec2 at = px - r.xy;
        float band = exp(-at.y / 80.0);
        float across = dot(at, vec2(0.62, 0.78)) / (r.z + r.w) * 1.4 + r.x / resolution.x * 0.7 + r.y / resolution.y * 0.3;
        float off = (fract(across + 0.3) - 0.5) * 8.0;
        float streak = exp(-off * off);
        col += mix(HORIZON / 0.5, SPOT, 0.4 * streak) * SHEEN * (band + 0.6 * streak) * inside * windowAlpha(pane);
    }

    // The bar's lower edge is a wire, with a warp flash travelling along it,
    // and the landscape is dimmed under the bar so its text reads. The flash
    // runs on 2000 pixels past the right edge before it starts again, so its
    // trail has died away (under 0.2%) when it does.
    if (reserved.x > 0.0) {
        float below = px.y - reserved.x;
        col *= mix(1.0, 0.35, step(below, 0.0));
        float flash = cycle(20.0) * (resolution.x + 2400.0) - 400.0;
        float trail = px.x < flash ? exp(-(flash - px.x) / 300.0) : exp(-(px.x - flash) / 8.0);
        col += WIRE * glowLine(abs(below), 1.0, HALO) * (0.35 + 0.9 * trail);
    }

    return vec4(col, 1.0);
}

// How far px is outside window i's edge, as its frame measures it: IRIX
// mitres a square corner, and a rounded window's frame follows its corner.
float edgeDistance(vec2 px, vec4 r, float rounding) {
    vec2 q = abs(px - r.xy - r.zw * 0.5) - r.zw * 0.5;
    return rounding > 0.0 ? rectDistance(px, r, rounding) : max(q.x, q.y);
}

// `colour` at coverage `a` over a premultiplied layer.
vec4 over(vec4 under, vec3 colour, float a) {
    return vec4(colour * a, a) + under * (1.0 - a);
}

// Each window's edge (specs/depth.md, part 2): IRIX's grey bevel, made of the
// glass's own thickness. Its faces are lit where they turn toward the light
// (the top and left, as IRIX's are) and shaded where they turn away, a thin
// highlight runs along its outer rim, and a crease sinks the glass into it,
// lit the other way round, as IRIX draws a sunken edge. Through the bevel the
// landscape beside the window shows, bent and squeezed, as through the edge
// of a thick pane. The focused window's bevel is IRIX's bright one; the
// others are its dim grey. The bevel catches the light for a moment when its
// window opens or takes focus, and flares when it lands.
vec4 frame(vec2 px, int i) {
    vec4 r = windowRect(i);
    float rounding = windowRounding(i);
    float d = edgeDistance(px, r, rounding);
    if (d < -2.0 || d > RIM + 1.0) return vec4(0.0);
    vec2 e = vec2(1.0, 0.0);
    vec2 n = normalize(vec2(edgeDistance(px + e.xy, r, rounding) - edgeDistance(px - e.xy, r, rounding),
                            edgeDistance(px + e.yx, r, rounding) - edgeDistance(px - e.yx, r, rounding)) + 1e-6);
    float lift = windowLift(i);

    // What just happened to this window, newest first; over within a second.
    float glint = windowFlare(i, 1.5);

    float facing = dot(n, LIGHT);
    float toward = 0.5 + 0.5 * facing;
    vec3 grey = mix(mix(BEVEL_IDLE * 0.45, BEVEL_SHADED, lift), mix(BEVEL_IDLE * 1.2, BEVEL_LIT, lift), toward);
    vec4 edge = vec4(0.0);
    float bevel = smoothstep(-0.5, 0.5, d) * (1.0 - smoothstep(RIM - 0.5, RIM + 0.5, d));
    if (bevel > 0.0) {
        // The landscape beside the window, squeezed into the bevel: at the
        // rim it meets the world beside it, at the glass it shows the world
        // a few bevels further out.
        vec3 bent = backdrop(px + n * (RIM - d) * 3.0).rgb;
        edge = over(edge, mix(bent * (1.0 + 0.5 * toward), grey, 0.55 + 0.15 * lift) + SPOT * 0.35 * glint, bevel);
    }
    float rim = (1.0 - smoothstep(0.0, 1.0, abs(d - RIM + 0.5))) * (0.35 + 0.65 * abs(facing));
    vec3 highlight = facing > 0.0 ? mix(BEVEL_LIT * (0.65 + 0.35 * lift), SPOT, min(glint, 1.0)) : BEVEL_IDLE * 0.25;
    edge = over(edge, highlight, rim);
    float crease = (1.0 - smoothstep(0.0, 1.0, abs(d + 0.5))) * 0.7 * abs(facing);
    edge = over(edge, facing > 0.0 ? vec3(0.02) : mix(BEVEL_IDLE, BEVEL_SHADED, lift), crease);
    return edge * windowAlpha(i);
}
