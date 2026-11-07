#version 300 es
// omarchy-cinema contract 15
// The backdrop contract: everything a film can know and must write. A film
// is an Omarchy theme directory with a backdrop.frag. The engine puts this
// file in front of it; it defines backdrop() and may define frame() (at the
// end). Of its colors.toml, the engine reads accent and background for the
// shader, background and its dark, darker and lighter shades as what turns to
// glass, muted as the text the glass keeps at 4.5:1, mode = "light" to keep
// the frost bright, and three quoted numbers:
//   glass  how much of a window's background stays, 1 solid to 0 clear
//          (0.85); text and the rest of the window keep their opacity
//   frost  how far the glass blurs the world behind it, as Hyprland's blur
//          size (3): fine lettering behind it needs less
//   reach  how far its windows reach, in px (REACH, at window())
//
// The line above is the contract's version, and a film's first line says the
// version it is written for in the same words; an engine draws only a film
// written for its own. Any change to this file's code, or to what it
// promises, is a new version (tools/contract-check catches the code).
//
// Lengths are logical pixels from the screen's top left. The windows are the
// ones Hyprland draws on this screen in this frame, where it draws them
// (mid-animation, mid-drag, sliding between workspaces, fading out after
// closing); window(px, i) says all of each. `focused` is the focused window's
// rect (x, y, w, h), easing to a new window when focus moves and then
// following it exactly; with none it is a rect in the middle of the screen
// (focusAlpha says how present it is). `reserved` is the room panels keep
// along each edge (top, right, bottom, left).
//
// `time` is the world's own clock, in seconds: it runs at the wall clock's
// speed while windows move, open, close, take focus or slide between
// workspaces, and eases to a stop about two seconds after they hold still,
// when the plugin draws nothing. It wraps every hour, so build motion from
// cycle(seconds) with a period that divides 3600 (60, 30, 20, 12, 10, 8, 6,
// ...). What happened lately (below) has its own ages, on the wall's clock.

precision highp float;
precision highp sampler2D;

in vec2 v_px;
layout(location = 0) out vec4 fragColor;

uniform float time;
uniform vec2 resolution;
uniform vec3 accent;
uniform vec3 background;
uniform vec4 focused;
uniform vec4 reserved;
// Three vec4s a window, at most 256 windows: (x, y, w, h), (alpha,
// rounding, lift, depth) and (velocity x, y, windowFlare()'s sums). Read
// them through the window functions. Then, for 32 by 32 tiles of the screen,
// which of windows 0 to 31 reach each (windowsAt()).
layout(std140) uniform Windows {
    vec4 windowTexels[3 * 256];
    uvec4 windowTiles[256];
};
uniform int windowCount;
uniform int focusedIndex;
// How present the focus is, for decorations that follow it: the focused
// window's own opacity (rising as it opens). When it closes and Hyprland
// focuses another window, the focus moves there (the closing window's own
// decorations fade with its alpha); when it closes with nothing else
// focused, focusedIndex and `focused` stay on it as it fades out and this
// falls with it; with no window focused on this screen it eases to 0.
uniform float focusAlpha;

// What happened lately (specs/depth.md): the last 32 things, newest last (so
// a loop from the newest can stop at the first older than its longest
// answer), each a point, its age in seconds (it is gone after 3), a strength
// from 0 to 1 and a kind. Every film answers each kind its own way; while one
// is alive the plugin draws the whole world every frame.
const int OPEN = 1;   // a window opened, at its middle
const int CLOSE = 2;  // a window closed, at its middle
const int LAND = 3;   // a window stopped moving, at its middle; stronger the faster it came
const int FOCUS = 4;  // a window took focus, at its middle
uniform vec4 impulses[32]; // x, y, age, strength
uniform int impulseKinds[32];
// The window each happened to, as its index this frame; -1 for none, a window
// closed or not drawn here.
uniform int impulseWindows[32];
uniform int impulseCount;

// How loud speech is while Voxtype records, 0 to 1 (0 when it does not). Only
// loudness: nothing of what is said reaches the shader.
uniform float voice;

// Text a backdrop can draw: the theme's own backdrop.frag, or, once the user
// turns them on, the newest plaintext of the agents on this machine while any
// is running (specs/agent-rain.md); a ring of 16384 characters 128 to a row,
// of which feedCount are real and the next goes at feedPos. The theme's
// glyphs.png is its lettering for them; without one, feedCount is 0. Read
// them through feedChar() and glyph(). The text changes only when the whole
// world is drawn again, so a world holding still holds the text it shows.
uniform sampler2D feed;
uniform int feedCount;
uniform int feedPos;
uniform sampler2D glyphs;

const float TAU = 6.28318530718;
const float FAR = 1e5;

// The character `i` back from the newest (0 is the newest) as its code, 32 to
// 126; any `i` from 0 up wraps round the characters there are.
int feedChar(int i) {
    int k = feedPos - 1 - i % max(feedCount, 1);
    k = k < 0 ? k + 16384 : k;
    return int(texelFetch(feed, ivec2(k % 128, k / 128), 0).r * 255.0 + 0.5);
}

// How much of glyph `code` covers `uv` (0 to 1 across its cell, y down).
float glyph(int code, vec2 uv) {
    int c = clamp(code - 32, 0, 95);
    vec2 cell = vec2(float(c % 16), float(c / 16));
    vec2 texels = vec2(textureSize(glyphs, 0)) / vec2(16.0, 6.0);
    vec2 inside = clamp(uv * texels, vec2(0.5), texels - 0.5) / texels;
    return texture(glyphs, (cell + inside) / vec2(16.0, 6.0)).r;
}

// 0 to 1 once every `seconds`.
float cycle(float seconds) {
    return fract(time / seconds);
}

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// A point that circles once every `seconds`, so noise can drift without a seam.
vec2 orbit(float seconds, float radius) {
    float a = cycle(seconds) * TAU;
    return vec2(cos(a), sin(a)) * radius;
}

// Distance from px to a rect's edge, rounded by `radius`: negative inside it.
float rectDistance(vec2 px, vec4 rect, float radius) {
    vec2 half_ = rect.zw * 0.5;
    vec2 q = abs(px - rect.xy - half_) - half_ + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// Window i as the point px sees it: everything the plugin says of it, read
// once: its rect, alpha (fading with it), rounding, lift (easing to 1 while
// it has focus and back), depth (its place in the stack, 0 on top), velocity
// (px a second), and d, px's distance to it, pushed away as it fades, so a
// window fading in grows out of nothing and one fading out sinks away. A
// film meets the windows that reach px in one loop, `uint left =
// windowsAt(px); for (int i = -1; next(left, i);) { Window w = window(px, i);
// ... }`, and asks all it needs of each there: at 2880x1800 every further
// loop over three windows cost a draw 0.2 to 0.6 ms.
//
// A film says how far its windows reach as colors.toml's `reach = "<px>"`
// (REACH): past it from a window and from where it was in the last 0.3 s,
// the window moves no point a level. Without REACH every window reaches
// every point.
struct Window {
    int i;
    vec4 rect;
    float alpha, rounding, lift, depth;
    vec2 velocity;
    float d;
};

uint windowsAt(vec2 px) {
    ivec2 t = clamp(ivec2(px / resolution * 32.0), ivec2(0), ivec2(31));
    int k = t.y * 32 + t.x;
    return windowTiles[k / 4][k % 4];
}

// The next window i (-1 before the first) of a set, taken out of `left`, the
// windows left to meet: a bit for each of 0 to 31, as windowsAt() gives, and
// every window from 32 on; false past the last.
bool next(inout uint left, inout int i) {
    i = left == 0u ? max(i + 1, 32) : int(floatBitsToUint(float(left & ~left + 1u)) >> 23) - 127;
    left &= left - 1u;
    return i < windowCount;
}

Window window(vec2 px, int i) {
    vec4 rect = windowTexels[3 * i], a = windowTexels[3 * i + 1];
    return Window(i, rect, a.x, a.y, a.z, a.w, windowTexels[3 * i + 2].xy, rectDistance(px, rect, a.y) + (1.0 - a.x) * 200.0);
}

// The point's distance to window w's edge as it stands, without the push
// its fade gives d.
float edgeDistance(Window w) {
    return w.d - (1.0 - w.alpha) * 200.0;
}

// Window w's rect `seconds` ago, at the velocity it moves at now.
vec4 ago(Window w, float seconds) {
    return w.rect - vec4(w.velocity * seconds, 0.0, 0.0);
}

// How fast the focused window moves, px a second (0 with none).
vec2 focusVelocity() {
    return focusedIndex < 0 ? vec2(0.0) : windowTexels[3 * focusedIndex + 2].xy;
}

// What every film asks of the windows at a point, gathered by see() as its
// loop meets each: the nearest's distance (FAR with none) and index (-1), the
// distance to the focused window (FAR when nothing is), and the window seen
// there, the one on top of those containing the point, whose glass it is
// behind (-1 for none; a window's depth is 0 on top).
struct Seen {
    float nearest;
    int closest;
    float focus;
    int over;
    float top;
};
const Seen UNSEEN = Seen(FAR, -1, FAR, -1, FAR);

void see(inout Seen s, Window w) {
    if (w.d < s.nearest) {
        s.nearest = w.d;
        s.closest = w.i;
    }
    if (w.i == focusedIndex) s.focus = w.d;
    if (w.d < 0.0 && w.depth < s.top) {
        s.over = w.i;
        s.top = w.depth;
    }
}

// Helpers several films share.

// How wide, in logical px, each pixel being drawn takes the mean of the
// world over: 0 at the screen's own size, where a pixel shows its middle.
// The world drawn for the glass's frost is coarser, and a line sized to the
// screen's pixels should cover each of its pixels as much as it covers the
// screen pixels there, or it floods the frost.
uniform float spread;

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow,
// `halo.x` bright and fading over `halo.y` core widths; most films glow
// vec2(0.25, 5.0).
float glowLine(float d, float w, vec2 halo) {
    return (1.0 - smoothstep(0.0, w, d)) + halo.x * exp(-d / (w * halo.y));
}

float glowLine(float d, float w) {
    return glowLine(d, w, vec2(0.25, 5.0));
}

// How far a glow `strength` exp(-d / falloff) reaches: past it, it moves no
// point a twentieth of a display level, so it need not be drawn.
float glowReach(float strength, float falloff) {
    return falloff * log(strength * 5100.0);
}

// Where a film's bar lights (Jarvis's reaches furthest, glowReach()): px in
// it or `below` its lower edge (y = reserved.x) by under BAR px. A film draws
// its bar only within `float below; if (atBar(px, below))`.
const float BAR = 76.0;
bool atBar(vec2 px, out float below) {
    below = px.y - reserved.x;
    return reserved.x > 0.0 && below < BAR;
}

// Distance from p to the segment from a to b.
float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    return length(ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0));
}

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

// The rect of the window impulse k happened to, or an empty rect at its point
// when there is none.
vec4 impulseRect(int k) {
    int i = impulseWindows[k];
    return i < 0 ? vec4(impulses[k].xy, 0.0, 0.0) : window(impulses[k].xy, i).rect;
}

// The distance from px to the window impulse k happened to, rounded as it
// is, or to its point when there is none.
float impulseDistance(vec2 px, int k) {
    int i = impulseWindows[k];
    if (i < 0) return length(px - impulses[k].xy);
    Window w = window(px, i);
    return rectDistance(px, w.rect, w.rounding);
}

// The outward normal of a rounded rect's edge nearest px.
vec2 edgeNormal(vec2 px, vec4 rect, float radius) {
    vec2 p = px - rect.xy - rect.zw * 0.5;
    vec2 q = abs(p) - rect.zw * 0.5 + radius;
    vec2 g = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return g * vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
}

// The shadow window w casts on the world, `offset` px along `away` (any
// length) from its light and `soft` wide: 1 in full shadow. It fades out
// over the window's edge, from 3 px outside it to 2 px inside, so the world
// seen through its own glass stays lit.
float windowShadow(vec2 px, Window w, vec2 away, float offset, float soft) {
    float edge = edgeDistance(w);
    if (edge <= -2.0 || edge - offset >= soft) return 0.0;
    float d = rectDistance(px - normalize(away) * offset, w.rect, w.rounding);
    return (1.0 - smoothstep(-soft, soft, d)) * smoothstep(-2.0, 3.0, edge) * w.alpha;
}

// The light falling on window i's glass, for a backdrop to draw under it (the
// glass shows it, the text stays over it): a soft diagonal streak whose place
// follows the window across the screen, as a real reflection slides.
float glassStreak(vec2 px, vec4 r) {
    float across = dot(px - r.xy, normalize(vec2(1.0, -1.25))) / max(r.z, 1.0) + r.x / resolution.x * 0.8;
    return exp(-pow((fract(across * 0.7 + 0.15) - 0.5) * 9.0, 2.0));
}

// How much window i flares from what just happened to it, within a second:
// focus and opening as a soft swell, landing as `landing` times its strength.
float windowFlare(int i, float landing) {
    return dot(windowTexels[3 * i + 2].zw, vec2(1.0, landing));
}

// How strongly a moving window w leaves its wake: by its speed, in full at
// `full` px a second, and its fade, from just outside it.
float wakeStrength(Window w, float full) {
    return min(length(w.velocity) / full, 1.0) * w.alpha * smoothstep(0.0, 3.0, w.d);
}

// The offset of p from the nearest point of a hexagonal lattice, its rows a
// unit apart.
vec2 hexOffset(vec2 p) {
    vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
    vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
    return dot(a, a) < dot(b, b) ? a : b;
}

// A soft rise over `rise` seconds and fade until `life`, for brief answers.
float swell(float age, float rise, float life) {
    return smoothstep(0.0, rise, age) * (1.0 - smoothstep(rise, life, age));
}

// Answers several films give, each in its own ink: the distance from px to a
// closing window's ring, spreading from 40 px round where it was at 240 px a
// second; from a point d px out from an opening window to its ring, settling
// onto the edge from 60 px out over 0.7 s; and how much a window taking focus
// (impulse e) warms its edge d px out, over 0.9 s.
float closingFront(vec2 px, vec4 e) {
    return abs(length(px - e.xy) - 40.0 - e.z * 240.0);
}

float openingFront(float d, float age) {
    float t = 1.0 - age / 0.7;
    return abs(d - t * t * 60.0);
}

float focusWarmth(float d, vec4 e) {
    return exp(-d / 30.0) * swell(e.z, 0.2, 0.9) * e.w;
}

// For frame(): how much of the glass's side a point `d` px from the window's
// edge is, its outer `width` px, where a frame shows the world bent through.
float glassSide(float d, float width) {
    return (1.0 - smoothstep(0.0, width, d)) * smoothstep(-2.0, 0.0, d);
}

// The world as the backdrop drew it in this frame for the glass's frost,
// filtered, at px: what a frame shows bent
// through the glass's edge, read instead of drawn again. Only frame() reads it.
uniform sampler2D drawnWorld;
uniform mat3 worldProj;
vec4 worldAt(vec2 px) {
    vec3 at = worldProj * vec3(px / resolution, 1.0);
    return textureLod(drawnWorld, at.xy * 0.5 + 0.5, 0.0);
}

// What a film defines. backdrop(px): the colour of the world at px. And,
// optionally, frame(px, w): window w's edge in that world (specs/depth.md,
// part 2), a premultiplied colour over a band reaching 48 px outside the
// window and at most 2 px inside it, drawn above the window in its own pass,
// so it moves and fades with it: return it unfaded. A frame shows the world
// through the glass's thickness with worldAt() at a bent point. Hyprland's
// border and shadow stay on under a frame: the frame program's main colours
// the border ring with the film's edge. A derivative (dFdx, fwidth) is
// undefined in a branch that can differ within a 2x2 quad: take it before
// the branch.
vec4 backdrop(vec2 px);
vec4 frame(vec2 px, Window w);
