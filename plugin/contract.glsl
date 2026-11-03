#version 300 es
// The backdrop contract: everything a theme's backdrop.frag can know. The
// plugin puts this in front of the theme's backdrop.frag, which defines
// backdrop(): the colour of one point of the screen.
//
// Lengths are logical pixels from the screen's top left. The windows are the
// ones Hyprland is drawing on this screen in this frame, where it is drawing
// them: mid-animation, mid-drag, sliding between workspaces, fading out after
// closing. windowAlpha(i) fades with the window; windowVelocity(i) is how it
// moves (px a second), windowLift(i) eases to 1 while it has focus and back,
// windowDepth(i) is its place in the stack (0 on top). `focused` is the focused window's rect
// (x, y, w, h), easing to a new window when focus moves and then following it
// exactly; with no focused window it is a rect in the middle of the screen
// (focusAlpha says how present it is).
// `reserved` is the room the bar and other panels keep along each edge (top,
// right, bottom, left): the bar's lower edge is at y = reserved.x, and a
// backdrop can light it.
//
// `time` is seconds and wraps every hour, because Hyprland runs for weeks and
// a float counting seconds that long loses the precision to animate smoothly.
// So build motion from cycle(seconds) with a period that divides 3600 (1, 2, 3,
// 4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20, 24, 30, 36, 40, 45, 48, 60, ...), and
// the wrap never shows.

precision highp float;
precision highp sampler2D;

in vec2 v_px;
layout(location = 0) out vec4 fragColor;

uniform float time;
uniform vec2 resolution;
uniform vec3 accent;
uniform vec3 background;
uniform vec3 foreground;
uniform vec4 focused;
uniform vec4 reserved;
// Three texels a window, 256 to a row: (x, y, w, h), (alpha, rounding,
// lift, depth) and (velocity x, y, veiled). Read them through the window
// functions; `veiled` is the plugin's own (main-backdrop.glsl).
uniform sampler2D windowData;
uniform int windowCount;
uniform int focusedIndex;
// How present the focus is, for decorations that follow it: the focused
// window's own opacity (rising as it opens). When it closes and Hyprland
// focuses another window, the focus moves there (the closing window's own
// decorations fade with windowAlpha); when it closes with nothing else
// focused, focusedIndex and `focused` stay on it as it fades out and this
// falls with it; with no window focused on this screen it eases to 0.
uniform float focusAlpha;

// The pointer: position (xy) and velocity (zw, px a second) on this screen.
// It moves in the same frame as the cursor.
uniform vec4 pointer;

// What happened lately (specs/depth.md): the last 32 things, newest last, each
// a point, its age in seconds (it is gone after 3), a strength from 0 to 1 and
// a kind. Every film answers each kind its own way. Typing is a printable key
// pressed into a window, placed along that window's lower edge; nothing of the
// key itself reaches the shader.
const int OPEN = 1;   // a window opened, at its middle
const int CLOSE = 2;  // a window closed, at its middle
const int LAND = 3;   // a window stopped moving, at its middle; stronger the faster it came
const int FOCUS = 4;  // a window took focus, at its middle
const int TYPE = 5;   // a key typed into the focused window
const int VOICE = 6;  // speech began (Voxtype)
uniform vec4 impulses[32]; // x, y, age, strength
uniform int impulseKinds[32];
// The window each happened to (typing and speech: the one typed or spoken
// into), as its index this frame; -1 for none, a window closed or not drawn
// here.
uniform int impulseWindows[32];
uniform int impulseCount;

// How loud speech is while Voxtype records, 0 to 1 (0 when it does not). Only
// loudness: nothing of what is said reaches the shader. A VOICE impulse marks
// each start of speech, along the focused window's lower edge, where the
// dictated text arrives.
uniform float voice;

// Text a backdrop can draw: the newest plaintext of the agents on this machine
// (specs/agent-rain.md), a ring of 16384 characters 128 to a row, of which
// feedCount are real and the next goes at feedPos. When the agents stop, the
// last text stays while feedPresence falls, and feedCount is 0 once it is gone.
// The theme's glyphs.png is its lettering for them; without one, feedCount is
// always 0. Read them through feedChar() and glyph().
uniform sampler2D feed;
uniform int feedCount;
uniform int feedPos;
uniform sampler2D glyphs;
// How present the text is: easing to 1 over about three seconds while there is
// text, and back to 0 when there is none (no agent running), so a backdrop
// can let its text drain away rather than vanish.
uniform float feedPresence;

const float TAU = 6.28318530718;
const float FAR = 1e5;

// The character `i` back from the newest (0 is the newest) as its code, 32 to
// 126; any `i` from 0 up wraps round the characters there are. (GLSL leaves %
// of a negative number undefined, so the ring position is wrapped by hand.)
int feedChar(int i) {
    int k = feedPos - 1 - i % max(feedCount, 1);
    k = k < 0 ? k + 16384 : k;
    return int(texelFetch(feed, ivec2(k % 128, k / 128), 0).r * 255.0 + 0.5);
}

// How much of glyph `code` covers `uv` (0 to 1 across its cell, y down).
// The sample stays half a texel inside the cell, so the filter never reaches
// the next character.
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

vec4 windowTexel(int texel) {
    return texelFetch(windowData, ivec2(texel % 256, texel / 256), 0);
}

vec4 windowRect(int i) {
    return windowTexel(3 * i);
}

float windowAlpha(int i) {
    return windowTexel(3 * i + 1).x;
}

float windowRounding(int i) {
    return windowTexel(3 * i + 1).y;
}

float windowLift(int i) {
    return windowTexel(3 * i + 1).z;
}

float windowDepth(int i) {
    return windowTexel(3 * i + 1).w;
}

vec2 windowVelocity(int i) {
    return windowTexel(3 * i + 2).xy;
}

// Distance from px to a rect's edge, rounded by `radius`: negative inside it.
float rectDistance(vec2 px, vec4 rect, float radius) {
    vec2 half_ = rect.zw * 0.5;
    vec2 q = abs(px - rect.xy - half_) - half_ + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// Distance to window i, pushed away as it fades, so a window fading in grows
// out of nothing and one fading out sinks away.
float windowDistance(vec2 px, int i) {
    return rectDistance(px, windowRect(i), windowRounding(i)) + (1.0 - windowAlpha(i)) * 200.0;
}

// Window i as the point px sees it: everything the plugin says of it, read
// once, and d, px's windowDistance to it. A film meets the windows at px in
// one loop, `for (int i = 0; i < windowCount; i++) { Window w = window(px, i);
// ... }`, and asks all it needs of each there: at 2880x1800 every further
// loop over three windows cost a draw 0.2 to 0.6 ms (specs/polish.md).
struct Window {
    int i;
    vec4 rect;
    float alpha, rounding, lift, depth;
    vec2 velocity;
    float d;
};

Window window(vec2 px, int i) {
    vec4 rect = windowRect(i), a = windowTexel(3 * i + 1);
    return Window(i, rect, a.x, a.y, a.z, a.w, windowVelocity(i), rectDistance(px, rect, a.y) + (1.0 - a.x) * 200.0);
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

// Helpers several films share (a helper enters the contract once two films
// answer a fact the same way).

// A line `d` pixels away: a crisp core `w` pixels wide in a soft glow,
// `halo.x` bright and fading over `halo.y` core widths; most films glow
// vec2(0.25, 5.0).
float glowLine(float d, float w, vec2 halo) {
    return (1.0 - smoothstep(0.0, w, d)) + halo.x * exp(-d / (w * halo.y));
}

float glowLine(float d, float w) {
    return glowLine(d, w, vec2(0.25, 5.0));
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
    return i < 0 ? vec4(impulses[k].xy, 0.0, 0.0) : windowRect(i);
}

// The outward normal of a rounded rect's edge nearest px.
vec2 edgeNormal(vec2 px, vec4 rect, float radius) {
    vec2 p = px - rect.xy - rect.zw * 0.5;
    vec2 q = abs(p) - rect.zw * 0.5 + radius;
    vec2 g = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return g * vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
}

// The shadow window w casts on the world, `offset` away from its light and
// `soft` wide, only outside the window itself, so the world seen through its
// own glass stays lit: 1 in full shadow.
float windowShadow(vec2 px, Window w, vec2 offset, float soft) {
    float d = rectDistance(px - offset, w.rect, w.rounding);
    return (1.0 - smoothstep(-soft, soft, d)) * smoothstep(-2.0, 3.0, rectDistance(px, w.rect, w.rounding)) * w.alpha;
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
    float flare = 0.0;
    for (int k = impulseCount - 1; k >= 0; k--) {
        int kind = impulseKinds[k];
        vec4 ev = impulses[k];
        if (ev.z > 1.0) break;
        if ((kind != FOCUS && kind != OPEN && kind != LAND) || impulseWindows[k] != i) continue;
        flare += kind == LAND ? landing * ev.w * exp(-ev.z * 4.0)
            : 0.6 * smoothstep(0.0, 0.12, ev.z) * exp(-ev.z * 3.5) * (kind == OPEN ? 1.0 : ev.w);
    }
    return flare;
}

// A soft rise over `rise` seconds and fade until `life`, for brief answers.
float swell(float age, float rise, float life) {
    return smoothstep(0.0, rise, age) * (1.0 - smoothstep(rise, life, age));
}

// What a film defines. backdrop(px): the colour of the world at px. And,
// optionally, frame(px, i): window i's edge in that world (specs/depth.md,
// part 2), a premultiplied colour over a band reaching 48 px outside the
// window and at most 2 px inside it, drawn above the window in its own pass,
// so it moves, tilts and fades with it. A frame can call backdrop() at a bent
// point to show the world through the glass's thickness. Hyprland's border
// and shadow stay on under a frame: the frame program's main colours the
// border ring with the film's edge.
vec4 backdrop(vec2 px);
vec4 frame(vec2 px, int i);
