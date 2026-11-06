// The backdrop program's main: the world at every point it draws, small
// for the glass's frost and at full size where no frost covers it.
void main() {
    fragColor = backdrop(v_px) + vec4(vec3(cinemaDither()), 0.0);
}
