#version 300 es
// One step of the frost the glass reads (main.cpp, frost(); play/scene.js,
// frost()): `source` read into a target `resolution` pixels in size by one of
// three kernels. The frost is the world under a Gaussian as wide as
// Hyprland's blur of the film's `frost` (play/scene.js, frostWidth()): the
// world halved down to a level as coarse as that allows,
// a Gaussian there for the rest, and doubled back up. Each step spreads the
// light by a known amount and the amounts add (as variances), so the plan
// lands on the frost asked for; every kernel weighs its taps by where they
// fall, so a light moving across the world moves its glow with it, by any
// fraction of a pixel, without it stepping or pulsing.
precision highp float;
uniform sampler2D source;
uniform vec2 resolution;
uniform int kernel; // 0 halves, 1 is a Gaussian along `along`, 2 doubles
uniform vec2 along;
uniform float sigma; // the Gaussian's width, in source texels
layout(location = 0) out vec4 fragColor;

// The source, read bilinear, `p` in its texels (whole numbers are its edges).
vec4 at(vec2 p) {
    return texture(source, p / vec2(textureSize(source, 0)));
}

void main() {
    vec2 size = vec2(textureSize(source, 0)), p = gl_FragCoord.xy / resolution * size;
    if (kernel == 0) {
        // Halving: 13 taps over the 4x4 texels round each target pixel
        // (Jimenez 2014, Next Generation Post Processing in Call of Duty:
        // Advanced Warfare), which every source texel reaches by the same
        // total weight, so nothing it covers flickers as it moves.
        fragColor = at(p) * 0.125 +
            (at(p + vec2(-1.0, -1.0)) + at(p + vec2(1.0, -1.0)) + at(p + vec2(-1.0, 1.0)) + at(p + vec2(1.0, 1.0))) * 0.125 +
            (at(p + vec2(-2.0, 0.0)) + at(p + vec2(2.0, 0.0)) + at(p + vec2(0.0, -2.0)) + at(p + vec2(0.0, 2.0))) * 0.0625 +
            (at(p + vec2(-2.0, -2.0)) + at(p + vec2(2.0, -2.0)) + at(p + vec2(-2.0, 2.0)) + at(p + vec2(2.0, 2.0))) * 0.03125;
    } else if (kernel == 2) {
        // Doubling: a 3x3 tent over the coarser level.
        fragColor = (at(p) * 4.0 + (at(p + vec2(-1.0, 0.0)) + at(p + vec2(1.0, 0.0)) + at(p + vec2(0.0, -1.0)) + at(p + vec2(0.0, 1.0))) * 2.0 +
                     at(p + vec2(-1.0, -1.0)) + at(p + vec2(1.0, -1.0)) + at(p + vec2(-1.0, 1.0)) + at(p + vec2(1.0, 1.0))) / 16.0;
    } else {
        // A Gaussian along one axis, the target the source's size: each
        // texel within three widths, weighed exactly.
        ivec2 c = ivec2(p), last = ivec2(size) - 1, step = ivec2(along);
        int   r = int(ceil(3.0 * sigma));
        vec4  sum = vec4(0.0);
        float total = 0.0;
        for (int k = -r; k <= r; k++) {
            float w = exp(-0.5 * float(k * k) / (sigma * sigma));
            sum += w * texelFetch(source, clamp(c + step * k, ivec2(0), last), 0);
            total += w;
        }
        fragColor = sum / total;
    }
}
