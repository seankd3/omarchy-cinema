// Added to every colour the plugin stores in 8 bits (the world, the frost, the
// glass) so soft gradients do not band: half a level of interleaved gradient
// noise (Jimenez, 2014), fixed per pixel, so a still desktop draws the same
// pixels and a whole level stays whole.
float cinemaDither() {
    return (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
}
