#version 440
// The backdrop contract: everything a theme's backdrop.frag can know. The
// install step puts this file in front of each theme's backdrop.frag, which
// defines backdrop(): the colour of one point of the screen.
//
// Lengths are logical pixels from the screen's top left. `windows` and `halo`
// are read with uv = px / resolution: red is any window, green the focused
// one. `windows` is crisp, `halo` blurred far into the gaps around them.
// `focus` is the focused window's rect (x, y, w, h), or a rect in the middle of
// the screen when it has none.
//
// `time` is seconds and wraps every hour, because the shell runs for weeks and
// a float counting seconds that long loses the precision to animate smoothly.
// So build motion from cycle(seconds) with a period that divides 3600 (1, 2, 3,
// 4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20, 24, 30, 36, 40, 45, 48, 60, ...), and
// the wrap never shows.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    vec2 resolution;
    vec4 focus;
    vec4 accent;
    vec4 background;
    vec4 foreground;
};

layout(binding = 1) uniform sampler2D windows;
layout(binding = 2) uniform sampler2D halo;

const float TAU = 6.28318530718;

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

vec4 backdrop(vec2 px);

void main() {
    fragColor = backdrop(qt_TexCoord0 * resolution) * qt_Opacity;
}
