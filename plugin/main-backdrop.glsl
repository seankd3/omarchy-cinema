// The backdrop program's main: the world at every point it draws, small
// for the glass's frost with where it is fine() as its alpha, and at full
// size where no frost covers it: the film round a fine point, the small
// world read bilinear elsewhere.
void main() {
    vec4 kept = spread > 0.0 ? vec4(1.0) : worldAt(v_px);
    if (kept.a > 0.0) {
        vec3 world = backdrop(v_px).rgb;
        kept = vec4(world, spread > 0.0 ? marked : 1.0);
    }
    fragColor = vec4(kept.rgb, spread > 0.0 ? kept.a : 1.0) + vec4(vec3(cinemaDither()), 0.0);
}
