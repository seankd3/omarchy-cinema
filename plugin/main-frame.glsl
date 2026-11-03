
// The frame program's main: window frameWindow's edge in the film's world,
// faded with the window. Hyprland's border ring (frameBorder px outside the
// window) takes the film's edge colour, opaque, so the film's edge replaces
// the border wherever, and only where, a frame draws, and covers what is under
// it just as the border did; with no plugin or no frame, the border shows.
uniform int frameWindow;
uniform float frameAlpha;
uniform float frameBorder;
void main() {
    vec4 edge = frame(v_px, frameWindow);
    Window w = window(v_px, frameWindow);
    float d = rectDistance(v_px, w.rect, w.rounding);
    float ring = smoothstep(-1.0, 0.0, d) * (1.0 - smoothstep(frameBorder, frameBorder + 1.0, d));
    vec3 colour = edge.a > 0.02 ? edge.rgb / edge.a : accent;
    fragColor = mix(edge, vec4(colour, 1.0), ring) * frameAlpha;
}
