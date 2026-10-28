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
// exactly; with no focused window it is a rect in the middle of the screen.
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
// Two texels a window, 256 to a row: (x, y, w, h) and (alpha, rounding).
uniform sampler2D windowData;
uniform int windowCount;
uniform int focusedIndex;

const float TAU = 6.28318530718;
const float FAR = 1e5;

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
