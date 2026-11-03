
// The backdrop program's main: the world at every point of the screen. Behind
// a window the world shows through only as a veil (the film says so in
// colors.toml, and Hyprland frosts the window's glass), the frost hides
// anything finer than two pixels, so there the world is drawn first at half
// resolution (coarsePass 1, into `coarse`) and then read back (coarsePass 2);
// every other point is drawn at full resolution, as is every point when no
// window is veiled (coarsePass 0).
uniform sampler2D coarse;
uniform int coarsePass;
in vec2 v_uv;

// Whether px is more than `inset` px inside a veiled window.
bool veiled(vec2 px, float inset) {
    for (int i = 0; i < windowCount; i++)
        if (windowTexel(3 * i + 2).z > 0.0 && windowDistance(px, i) < -inset) return true;
    return false;
}

void main() {
    // The coarse world reaches past where it is read, so its filter never
    // reads a point it did not draw.
    bool veil = coarsePass > 0 && veiled(v_px, coarsePass == 1 ? 0.0 : 8.0);
    if (coarsePass == 2 && veil) fragColor = texture(coarse, v_uv);
    else if (coarsePass == 1 && !veil) fragColor = vec4(0.0);
    else fragColor = backdrop(v_px);
}
