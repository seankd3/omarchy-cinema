#version 300 es
// The frost the glass reads (main.cpp, frost()): the coarse world's level
// `frostLevel` over a `resolution`-sized level of the glass's texture, by a
// cubic B-spline where that is finer, so a reader's bilinear shows no crease
// on the frost's texels.
precision highp float;
uniform sampler2D drawnWorld;
uniform int frostLevel;
uniform vec2 resolution;
layout(location = 0) out vec4 fragColor;

void main() {
    vec2  size = vec2(textureSize(drawnWorld, frostLevel)), at = gl_FragCoord.xy / resolution;
    float lod  = float(frostLevel);
    if (size.x >= resolution.x) {
        fragColor = textureLod(drawnWorld, at, lod);
        return;
    }
    // Four texels a side, as two bilinear reads each between its pair.
    vec2 t = at * size - 0.5, i = floor(t), f = t - i, g = 1.0 - f;
    vec2 w0 = g * g * g / 6.0, w1 = 2.0 / 3.0 - f * f * (1.0 - 0.5 * f), w3 = f * f * f / 6.0;
    vec2 a = w0 + w1, b = 1.0 - a;
    vec2 p = (i - 0.5 + w1 / a) / size, q = (i + 1.5 + w3 / b) / size;
    fragColor = a.y * (a.x * textureLod(drawnWorld, p, lod) + b.x * textureLod(drawnWorld, vec2(q.x, p.y), lod)) +
                b.y * (a.x * textureLod(drawnWorld, vec2(p.x, q.y), lod) + b.x * textureLod(drawnWorld, q, lod));
}
