// The glass, in Hyprland's window shader after the theme's CINEMA_ constants
// and dither.glsl (main.cpp, glassShaderSource(); tools/preview.py).
vec3 cinemaLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float cinemaLuminance(vec3 c) {
    return dot(cinemaLinear(c), vec3(0.2126, 0.7152, 0.0722));
}
// The theme's background shade nearest a colour (rgb), and how far off it is
// (w, its largest channel's difference).
vec4 cinemaShade(vec3 rgb) {
    vec4 nearest = vec4(CINEMA_BACKGROUND, 1.0);
    for (int i = 0; i < CINEMA_BACKGROUNDS.length(); i++) {
        vec3  e   = abs(rgb - CINEMA_BACKGROUNDS[i]);
        float off = max(max(e.r, e.g), e.b);
        if (off < nearest.w) nearest = vec4(CINEMA_BACKGROUNDS[i], off);
    }
    return nearest;
}
// A pixel composited over the frost (pix plus k of frost), held so that
// muted text keeps 4.5:1 (WCAG) on it: one past that, as the display shows
// it in whole 8-bit levels, moves in linear light toward its background
// shade drawn solid (a pixel of anything else, toward itself with the
// theme's background in place of the frost), dimming in its own hue on a dark theme, until it meets
// 4.5:1 on a whole level. Where that shade, drawn solid, is itself short of
// 4.5:1, it goes as far as the shade: the glass never reads worse than the
// theme drawn solid.
#if USE_BLUR
vec4 cinemaHold(vec4 pix, vec2 uv, float k) {
    // No frost and nothing of the app's: not drawn (the bar's layer is screen-sized).
    if (k <= 0.0 && pix == vec4(0.0)) discard;
    // Where the frost cannot move a pixel a level (k to 1/255: an opaque
    // pixel of a 0.999 window) it is the app's, so text keeps its exact
    // level; dithered in full from two levels.
    vec4  c     = pix + texture(blurredBG, uv) * k;
    if (k * 255.0 <= 1.0) return c;
    c          += vec4(vec3(cinemaDither() * min(k * 255.0 - 1.0, 1.0)), 0.0);
    float m     = cinemaLuminance(CINEMA_MUTED), side = sign(m - cinemaLuminance(CINEMA_BACKGROUND));
    float limit = side > 0.0 ? (m + 0.05) / 4.5 - 0.05 : 4.5 * (m + 0.05) - 0.05;
    vec3  shown = round(c.rgb * 255.0) / 255.0;
    // A pixel with no frost in it, or every channel of it on the safe side of
    // the grey that is exactly at the limit, is within it: most of the glass,
    // and all of a layer's empty pixels, stop here.
    float grey  = 1.055 * pow(max(limit, 0.0), 1.0 / 2.4) - 0.055;
    if ((side > 0.0 ? max(max(shown.r, shown.g), shown.b) <= grey : min(min(shown.r, shown.g), shown.b) >= grey)) return c;
    float y     = cinemaLuminance(shown);
    if ((y - limit) * side <= 0.0) return c;
    vec4  own  = cinemaShade(pix.a > 0.0 ? pix.rgb / pix.a : CINEMA_BACKGROUND);
    vec3  safe = own.w <= 2.5 / 255.0 ? own.rgb * (pix.a + k) : pix.rgb + CINEMA_BACKGROUND * k;
    float s    = cinemaLuminance(safe);
    vec3  held = mix(cinemaLinear(safe), cinemaLinear(shown), (s - limit) * side < 0.0 ? (limit - s) / (y - s) : 0.0);
    held       = mix(held * 12.92, 1.055 * pow(held, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, held)) * 255.0;
    return vec4((side > 0.0 ? floor(held) : ceil(held)) / 255.0, c.a);
}
#endif
vec4 cinemaGlass(vec4 c) {
    // Nothing to judge where the app drew nothing.
    if (c.a <= 0.0) return c;
    // Judged by colour alone, before the app's own alpha: a terminal that
    // draws its background half see-through gets the same glass as a window
    // that draws it solid.
    vec3  rgb = c.rgb / c.a;
    // Only a background colour itself is background, within a step or two of
    // rounding. Panels, cards, fields, rows and dividers are shaded a few
    // steps off it, and they are interface, not background: they keep their
    // opacity with the text, icons and lines.
    float background = 1.0 - smoothstep(0.5 / 255.0, 2.5 / 255.0, cinemaShade(rgb).w);
    float a = mix(c.a, CINEMA_GLASS, background);
    return vec4(rgb * a, a);
}
