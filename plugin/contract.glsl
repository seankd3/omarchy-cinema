#version 300 es
// The backdrop contract: everything a theme's backdrop.frag can know. The
// plugin puts this in front of the theme's backdrop.frag, which defines
// backdrop(): the colour of one point of the screen.
//
// Lengths are logical pixels from the screen's top left. The windows are the
// ones Hyprland is drawing on this screen in this frame, where it is drawing
// them: mid-animation, mid-drag, sliding between workspaces, fading out after
// closing. windowAlpha(i) fades with the window. `focused` is the focused window's rect
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
// Two texels a window, 256 to a row: (x, y, w, h) and (alpha, rounding).
uniform sampler2D windowData;
uniform int windowCount;
uniform int focusedIndex;
// How present the focus is, for decorations that follow it: the focused
// window's own opacity (rising as it opens); when it closes, focusedIndex and
// `focused` stay on it as it fades out and this falls with it; with no window
// focused on this screen it eases to 0.
uniform float focusAlpha;

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
    return windowTexel(2 * i);
}

float windowAlpha(int i) {
    return windowTexel(2 * i + 1).x;
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
    vec4 extra = windowTexel(2 * i + 1);
    return rectDistance(px, windowTexel(2 * i), extra.y) + (1.0 - extra.x) * 200.0;
}

// Distance to the nearest window: negative inside one.
float nearestWindow(vec2 px) {
    float d = FAR;
    for (int i = 0; i < windowCount; i++) d = min(d, windowDistance(px, i));
    return d;
}

// Distance to the focused window, FAR when nothing is focused.
float focusedWindow(vec2 px) {
    return focusedIndex < 0 ? FAR : windowDistance(px, focusedIndex);
}

// Light that pools around the windows, `radius` pixels deep, and adds up in
// the seams where they sit close: 1 at a window's edge.
float windowGlow(vec2 px, float radius) {
    float glow = 0.0;
    for (int i = 0; i < windowCount; i++) glow += exp(-max(windowDistance(px, i), 0.0) / radius);
    return glow;
}

vec4 backdrop(vec2 px);

void main() {
    fragColor = backdrop(v_px);
}
