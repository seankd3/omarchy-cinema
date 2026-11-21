// The glass, in Hyprland's window shader after the theme's CINEMA_ constants
// and dither.glsl (main.cpp, glassShaderSource(); tools/preview.py;
// play/play.js). CINEMA_BACKGROUNDS are colors.toml's background,
// lighter_background, dark_background and darker_background, in that order (a
// shade it does not name is its background), and each is a layer of glass:
// lighter_background as clear as the background's, CINEMA_GLASS; the dark
// shades apps put sidebars and recessed panes in thicker, nearer opaque and
// over a frost twice as wide (CINEMA_FROST_DEEP_LEVEL), so a sidebar reads as
// its own pane of glass however near its shade is to the background's.
const float CINEMA_GLASSES[4] = float[](CINEMA_GLASS, CINEMA_GLASS, mix(CINEMA_GLASS, 1.0, 0.35), mix(CINEMA_GLASS, 1.0, 0.5));
const int   CINEMA_FROSTS[4]  = int[](CINEMA_FROST_LEVEL, CINEMA_FROST_LEVEL, CINEMA_FROST_DEEP_LEVEL, CINEMA_FROST_DEEP_LEVEL);
vec3 cinemaLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
// Its inverse: linear light back to sRGB.
vec3 cinemaEncode(vec3 l) {
    return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}
float cinemaLuminance(vec3 c) {
    return dot(cinemaLinear(c), vec3(0.2126, 0.7152, 0.0722));
}
// The theme's background shade nearest a colour, and how far off it is
// (`off`, its largest channel's difference); of equal ones the first, so a
// shade the theme does not name is the background's layer.
int cinemaShade(vec3 rgb, out float off) {
    int nearest = 0;
    off         = 2.0;
    for (int i = 0; i < 4; i++) {
        vec3  e = abs(rgb - CINEMA_BACKGROUNDS[i]);
        float d = max(max(e.r, e.g), e.b);
        if (d < off) {
            nearest = i;
            off     = d;
        }
    }
    return nearest;
}
// A pixel composited over the frost of its layer (pix plus k of frost), held
// so that muted text keeps 4.5:1 (WCAG) on it: one past that, as the display
// shows it in whole 8-bit levels, moves in linear light toward its background
// shade drawn solid (a pixel of anything else, toward itself with the
// theme's background in place of the frost), dimming in its own hue on a dark theme, until it meets
// 4.5:1 on a whole level. Where that shade, drawn solid, is itself short of
// 4.5:1, it goes as far as the shade: the glass never reads worse than the
// theme drawn solid, over either frost.
#if USE_BLUR
// The frost under a pixel, read at `level` of blurredBG (CINEMA_FROSTS) by a
// cubic B-spline as four bilinear reads: read bilinear, a glow pulses by up
// to 4% as the light under it crosses the frost's texels; read this way, by
// 0.1% (tools/frost-check).
vec4 cinemaFrost(vec2 uv, int level) {
    float lod  = float(level);
    vec2  size = vec2(textureSize(blurredBG, level)), t = uv * size - 0.5, i = floor(t), f = t - i, g = 1.0 - f;
    vec2  w0 = g * g * g / 6.0, w1 = 2.0 / 3.0 - f * f * (1.0 - 0.5 * f), w3 = f * f * f / 6.0;
    vec2  a = w0 + w1, b = 1.0 - a;
    vec2  p = (i - 0.5 + w1 / a) / size, q = (i + 1.5 + w3 / b) / size;
    return a.y * (a.x * textureLod(blurredBG, p, lod) + b.x * textureLod(blurredBG, vec2(q.x, p.y), lod)) +
        b.y * (a.x * textureLod(blurredBG, vec2(p.x, q.y), lod) + b.x * textureLod(blurredBG, q, lod));
}
vec4 cinemaHold(vec4 pix, vec2 uv, float k) {
    // No frost and nothing of the app's: not drawn (the bar's layer is screen-sized).
    if (k <= 0.0 && pix == vec4(0.0)) discard;
    // Its layer: the shade it is drawn in (cinemaGlass() keeps its colour),
    // the background's where the app drew nothing, and the background's
    // frost under a pixel of anything else.
    float off;
    int   own   = cinemaShade(pix.a > 0.0 ? pix.rgb / pix.a : CINEMA_BACKGROUND, off);
    bool  shade = off <= 2.5 / 255.0;
    // Where the frost cannot move a pixel a level (k to 1/255: an opaque
    // pixel of a 0.999 window) it is the app's, so text keeps its exact
    // level; dithered in full from two levels.
    vec4  c     = pix + cinemaFrost(uv, shade ? CINEMA_FROSTS[own] : CINEMA_FROST_LEVEL) * k;
    if (k * 255.0 <= 1.0) return c;
    c          += vec4(vec3(cinemaDither() * min(k * 255.0 - 1.0, 1.0)), 0.0);
    float m     = cinemaLuminance(CINEMA_MUTED), side = sign(m - cinemaLuminance(CINEMA_BACKGROUND));
    float limit = side > 0.0 ? (m + 0.05) / 4.5 - 0.05 : 4.5 * (m + 0.05) - 0.05;
    vec3  shown = round(c.rgb * 255.0) / 255.0;
    // A pixel with no frost in it, or every channel of it on the safe side of
    // the grey that is exactly at the limit, is within it: most of the glass,
    // and all of a layer's empty pixels, stop here.
    float grey  = cinemaEncode(vec3(max(limit, 0.0))).r;
    if ((side > 0.0 ? max(max(shown.r, shown.g), shown.b) <= grey : min(min(shown.r, shown.g), shown.b) >= grey)) return c;
    float y     = cinemaLuminance(shown);
    if ((y - limit) * side <= 0.0) return c;
    vec3  safe = shade ? CINEMA_BACKGROUNDS[own] * (pix.a + k) : pix.rgb + CINEMA_BACKGROUND * k;
    float s    = cinemaLuminance(safe);
    vec3  held = mix(cinemaLinear(safe), cinemaLinear(shown), (s - limit) * side < 0.0 ? (limit - s) / (y - s) : 0.0);
    held       = cinemaEncode(held) * 255.0;
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
    // opacity with the text, icons and lines. Its colour is known to those two
    // steps only where the app drew it at least a fifth opaque (8 bits divided
    // by its alpha), so below that it turns to glass less, and under a tenth
    // (an antialiased edge, a faint shadow) keeps its own alpha: such a pixel
    // would flicker between glass and not, and a shadow in the background's
    // shade would turn to a slab of glass.
    float off;
    int   shade      = cinemaShade(rgb, off);
    float background = (1.0 - smoothstep(0.5 / 255.0, 2.5 / 255.0, off)) * smoothstep(0.1, 0.2, c.a);
    float a          = mix(c.a, CINEMA_GLASSES[shade], background);
    return vec4(rgb * a, a);
}
