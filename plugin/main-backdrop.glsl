// The backdrop program's main: the world at every point it draws. The plugin
// draws it at half the monitor's size over all of it, for the glass's frost,
// and at full size outside the windows that show it only through the frost.
void main() {
    fragColor = backdrop(v_px) + vec4(vec3(cinemaDither()), 0.0);
}
