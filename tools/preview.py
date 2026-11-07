# /// script
# dependencies = ["moderngl", "numpy", "pillow", "quickjs"]
# ///
"""Renders a film theme's backdrop off screen, so a backdrop can be designed and
checked without a live session: an empty workspace, and workspace 1's layout
(a window on the left focused, two stacked on the right, the bar on top) with
the windows drawn as glass over it.

    uv run tools/preview.py <theme-dir> [seconds ...]
    uv run tools/preview.py <theme-dir> --answers [seconds]

Writes <theme-dir>/../../scratch/preview/<theme>-{empty,windows}-<t>.png at
2880 x 1800 (2304 x 1440 logical at 1.25). With --answers it writes
<theme>-answers-<t>.png instead: the film answering the desktop
(specs/depth.md) in four frames, at rest, a window dragged, a window just
landed while you speak into the focused one, and a window opening, one
closing and focus moving.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import moderngl
import numpy as np
import quickjs
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGICAL = (2304, 1440)
PIXELS = (2880, 1800)
BAR = 26.0
GAP = 64.0

VERTEX = """#version 330 core
uniform vec2 resolution;
in vec2 pos;
out vec2 v_px;
out vec2 v_uv;
void main() {
    gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
    v_px = pos * resolution;
    v_uv = gl_Position.xy * 0.5 + 0.5;
}
"""
# The plugin links one of these after the film's shader (plugin/main-*.glsl).
DITHER = (ROOT / "plugin/dither.glsl").read_text()
BACKDROP_MAIN = DITHER + (ROOT / "plugin/main-backdrop.glsl").read_text()
FRAME_MAIN = (ROOT / "plugin/main-frame.glsl").read_text()
# Hyprland's own window shader, from the installed build's headers, as the
# plugin takes it from the running build (main.cpp, glassShaderSource()).
SHADERS = Path("/usr/include/hyprland/src/render/shaders")


DOOR = str(ROOT / "tools/yield")


def enter():
    """GPU runs go through tools/yield, which yields them to the person at
    the screen: outside a run this process starts again inside one. The
    run's largest drawing size (w, h), or None."""
    within = subprocess.run([DOOR, "--within"], stdout=subprocess.PIPE, text=True)
    if within.returncode:
        os.execv(DOOR, [DOOR, sys.executable, *sys.orig_argv[1:]])
    return tuple(map(int, within.stdout.split("x"))) if within.stdout.strip() else None


CAP = enter()


def fits(size):
    """Drawing at `size` (w, h) larger than the run allows queues the run
    (exit 75). Checked for every framebuffer made in this process from here
    on, by whatever code, and for the target of every scene() draw."""
    if CAP and (size[0] > CAP[0] or size[1] > CAP[1]):
        sys.exit(subprocess.run([DOOR, "--within", "%dx%d" % tuple(size)]).returncode)


def checked(make):
    def framebuffer(self, *args, **kwargs):
        fb = make(self, *args, **kwargs)
        fits(fb.size)
        return fb
    return framebuffer


moderngl.Context.framebuffer = checked(moderngl.Context.framebuffer)


# The scene model is play/scene.js, which the playground runs too: what the
# engine gives a film, worked out from a scene. Called with JSON both ways.
JS = quickjs.Context()
JS.eval((ROOT / "play/scene.js").read_text() + """
function given(scene, colors) {
  const g = Scene.uniforms(JSON.parse(scene), Scene.reach(colors));
  return JSON.stringify(g, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v);
}
function call(name, args) {
  return JSON.stringify(Scene[name](...JSON.parse(args)), (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v);
}""")


def model(name, *args):
    return json.loads(JS.get("call")(name, json.dumps(args)))


def colors_toml(theme):
    return (theme / "colors.toml").read_text()


def palette(theme):
    return {k: tuple(v) for k, v in model("palette", colors_toml(theme)).items()}


def setting(theme, name, default):
    return model("setting", colors_toml(theme), name, default)


def layout():
    return [tuple(r) for r in model("layout", LOGICAL, BAR, GAP)]


# Impulse kinds, as contract.glsl names them.
OPEN, CLOSE, LAND, FOCUS = range(1, 5)


def framed(theme):
    return re.search(r"\bvec4\s+frame\s*\(", (theme / "backdrop.frag").read_text()) is not None


def scene(ctx, theme, t, windows, focused, velocity=None, impulses=(), frame=None, voice=0.0, world=None):
    """The film's program in `ctx` with everything the plugin would give it,
    as a function that draws it over the bound framebuffer. velocity: (vx, vy)
    per window; impulses: (x, y, age, strength, kind,
    window), newest last, window -1 for none. With `frame` set to a window's
    index, it draws that window's frame (premultiplied) instead of the
    backdrop, reading `world`, the backdrop drawn at half size, as the
    plugin's frames do."""
    contract = (ROOT / "plugin/contract.glsl").read_text().replace("#version 300 es", "#version 330 core")
    source = contract + "\n#line 1\n" + (theme / "backdrop.frag").read_text() + (BACKDROP_MAIN if frame is None else FRAME_MAIN)
    program = ctx.program(vertex_shader=VERTEX, fragment_shader=source)
    if frame is not None:
        program["frameWindow"].value = frame
        program["frameAlpha"].value = 1.0
        if "frameBorder" in program:
            program["frameBorder"].value = 2.0

    colors = palette(theme)
    for name in ("accent", "background"):
        if name in program:
            program[name].value = colors.get(name, (1, 1, 1))
    # Each window whole and still unless dragged, the first focused, on top
    # of the ones after it.
    shapes = [dict(rect=rect, alpha=1.0, rounding=0.0, lift=1.0 if i == focused else 0.0, depth=float(len(windows) - 1 - i),
                   velocity=velocity[i] if velocity else (0.0, 0.0)) for i, rect in enumerate(windows)]
    told = dict(time=float(t), size=LOGICAL, reserved=(BAR, 0.0, 0.0, 0.0), windows=shapes, focused=focused if windows else -1,
                focusAlpha=1.0 if windows else 0.0, voice=voice,
                impulses=[dict(at=(x, y), age=age, strength=strength, kind=kind, window=owner) for x, y, age, strength, kind, owner in impulses])
    given = JS.get("given")(json.dumps(told), colors_toml(theme))
    given = json.loads(given)
    for name, value in given["values"].items():
        if name not in program:
            continue
        if name in ("impulses", "impulseKinds", "impulseWindows"):
            program[name].write(np.array(value, dtype="f4" if name == "impulses" else "i4").tobytes())
        else:
            program[name].value = tuple(value) if isinstance(value, list) else value
    window_data = ctx.buffer(np.array(given["windows"]["texels"], dtype="f4").tobytes() + np.array(given["windows"]["tiles"], dtype="u4").tobytes())
    if "Windows" in program:
        program["Windows"].binding = 0
    textures = []

    # A theme's lettering, and the text it writes with no agent's text turned
    # on: its own backdrop.frag, as the plugin cuts it (main.cpp, readTheme()).
    glyphs_png = theme / "glyphs.png"
    count = 0
    if glyphs_png.exists():
        atlas = Image.open(glyphs_png).convert("RGBA").getchannel("A")
        glyphs = ctx.texture(atlas.size, 1, atlas.tobytes())
        glyphs.filter = (moderngl.LINEAR, moderngl.LINEAR)
        text = model("words", (theme / "backdrop.frag").read_text())
        count = len(text)
        letters = ctx.texture((128, 128), 1, text.ljust(16384).encode("ascii"))
        letters.filter = (moderngl.NEAREST, moderngl.NEAREST)
        textures += [glyphs, letters]
        for name, value in {"glyphs": 0, "feed": 1}.items():
            if name in program:
                program[name].value = value
    for name, value in {"feedCount": count, "feedPos": count % 16384}.items():
        if name in program:
            program[name].value = value

    if world is not None and "drawnWorld" in program:
        textures.append(world)
        program["drawnWorld"].value = len(textures) - 1
        # The plugin's projection of the screen in this VERTEX's terms.
        program["worldProj"].write(np.array([2, 0, 0, 0, -2, 0, -1, 1, 1], dtype="f4").tobytes())

    quad = ctx.buffer(np.array([0, 0, 1, 0, 0, 1, 1, 1], dtype="f4").tobytes())
    vao = ctx.vertex_array(program, [(quad, "2f", "pos")])

    def draw():
        fits(ctx.viewport[2:])
        # Drawn coarser than the screen, a pixel takes the mean over its
        # width (contract.glsl's spread).
        if "spread" in program:
            program["spread"].value = 0.0 if ctx.viewport[2] >= PIXELS[0] else LOGICAL[0] / ctx.viewport[2]
        window_data.bind_to_uniform_block(0)
        for unit, texture in enumerate(textures):
            texture.use(unit)
        vao.render(moderngl.TRIANGLE_STRIP)
    return draw


def coarse(theme):
    """The coarse world's size and levels, and its frost's level at the
    screen's size, as main.cpp's coarse() works them out."""
    c = model("coarse", setting(theme, "frost", 3), PIXELS, PIXELS[0] / LOGICAL[0])
    return tuple(c["size"]), c["levels"], c["frost"]


def coarse_world(ctx, theme, t, windows, focused, **answers):
    """The coarse world as the plugin keeps it (RGB10_A2), with its mipmap."""
    size, levels, _ = coarse(theme)
    world = ctx.texture(size, 4, internal_format=0x8059)
    world.repeat_x = world.repeat_y = False
    ctx.framebuffer([world]).use()
    scene(ctx, theme, t, windows, focused, **answers)()
    world.build_mipmaps(0, levels - 1)
    world.filter = (moderngl.LINEAR_MIPMAP_NEAREST, moderngl.LINEAR)
    return world


def render(theme, t, windows, focused, frame=None, **answers):
    """One scene() drawn off screen: the backdrop as RGB, or a frame as
    premultiplied RGBA."""
    ctx = moderngl.create_standalone_context(backend="egl", require=330)
    world = coarse_world(ctx, theme, t, windows, focused, **answers) if frame is not None else None
    draw = scene(ctx, theme, t, windows, focused, frame=frame, world=world, **answers)
    target = ctx.simple_framebuffer(PIXELS, components=4)
    target.use()
    target.clear(0.0, 0.0, 0.0, 0.0)
    draw()
    # GL reads rows from the bottom up.
    mode = "RGB" if frame is None else "RGBA"
    image = Image.frombytes(mode, PIXELS, target.read(components=len(mode))).transpose(Image.FLIP_TOP_BOTTOM)
    ctx.release()
    return image, palette(theme)


def with_frames(theme, image, t, windows, focused, **answers):
    """`image` with each window's frame over it, as the plugin draws them
    above the windows (premultiplied, so added over what is beneath scaled by
    one minus its alpha)."""
    if not framed(theme):
        return image
    out = np.asarray(image.convert("RGB"), dtype="f4") / 255
    for i in range(len(windows)):
        edge, _ = render(theme, t, windows, focused, frame=i, **answers)
        rgba = np.asarray(edge, dtype="f4") / 255
        out = rgba[..., :3] + out * (1 - rgba[..., 3:4])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype("uint8"))


def hyprland(name, defines):
    """One of Hyprland's shaders with its includes in place, defines.h as
    `defines`."""
    text = (SHADERS / f"{name}.inc").read_text()
    out = []
    for line in text[text.index('R"#(') + 4: text.rindex(')#"')].splitlines():
        m = re.match(r'\s*#include "(.+)"', line)
        if m:
            out.append(defines if m[1] == "defines.h" else hyprland(m[1], defines))
        elif line.strip() != "#define ALLOW_INCLUDES" and "GL_ARB_shading_language_include" not in line:
            out.append(line)
    return "\n".join(out)


def surface(theme, colors):
    """Hyprland's window shader as it draws a window it blurs (its blur
    variant, without colour management, rounding, tint or discard), with
    the plugin's glass added where glassShaderSource() adds it."""
    source = hyprland("surface.frag", "")
    used = set(re.findall(r"\b(USE_\w+)", " ".join(l for l in source.splitlines() if l.lstrip().startswith(("#if", "#elif")))))
    defines = "".join(f"#define {u} {int(u in ('USE_RGBA', 'USE_BLUR'))}\n" for u in sorted(used)) + "#define SOURCE_TF 9\n#define TARGET_TF 9\n"
    source = source.replace("#version 300 es", "#version 300 es\n" + defines, 1)
    names = ("background", "dark_background", "darker_background", "lighter_background")
    shades = [c for n, c in colors.items() if n in names]
    glass = setting(theme, "glass", 0.85)
    if glass >= 1 or not shades:
        return source
    vec3 = lambda c: "vec3({:.6f}, {:.6f}, {:.6f})".format(*c)
    out = "layout(location = 0) out vec4 fragColor;"
    source = source.replace(out, f"""const vec3  CINEMA_BACKGROUNDS[{len(shades)}] = vec3[]({", ".join(map(vec3, shades))});
const float CINEMA_GLASS = {min(max(glass, 0.0), 1.0):.4f};
const vec3  CINEMA_BACKGROUND = {vec3(colors["background"])}, CINEMA_MUTED = {vec3(colors.get("muted", (0.5, 0.5, 0.5)))};
""" + DITHER + (ROOT / "plugin/glass.glsl").read_text() + out, 1)
    read = "#if USE_DISCARD && !USE_BLUR"
    source = source.replace(read, "float cinemaOwn = pixColor.a, cinemaCard = 1.0;\n#if USE_BLUR\n#if USE_DISCARD\n    if (discardAlpha) cinemaCard = smoothstep(discardAlphaValue, 0.95, cinemaOwn);\n#endif\n    pixColor = mix(pixColor, cinemaGlass(pixColor), cinemaCard);\n#endif\n\n" + read, 1)
    source = re.sub(r"\w+\.a <= discardAlphaValue", "cinemaOwn <= discardAlphaValue", source)
    return re.sub(r"(pixColor|mirrorColor) \+= (blurred\w+) \* (\w+);", r"\1 = cinemaHold(\1, blurUV, \3 * cinemaCard);", source)


WINDOW = """#version 300 es
uniform vec4 box;
uniform vec2 size;
in vec2 pos;
out vec2 v_texcoord;
void main() {
    v_texcoord = pos;
    vec2 px = box.xy + pos * box.zw;
    gl_Position = vec4(px.x / size.x * 2.0 - 1.0, 1.0 - px.y / size.y * 2.0, 0.0, 1.0);
}
"""


def glass(theme, image, t, windows, focused, border=True, **answers):
    """`image` with the windows over it as the film's glass shows them: the
    plugin's frost (the coarse world softened through its mipmap as far as
    the film's frost, that level read in 8 bits, frost() in main.cpp),
    then each window, 0.999 opaque, drawn by Hyprland's window shader with
    the glass in it: its background the theme's, a block of text lines in
    the foreground and muted colours, and a lit border on the focused one
    where the film draws no frame."""
    from PIL import ImageDraw

    colors = palette(theme)
    scale = PIXELS[0] / LOGICAL[0]
    ctx = moderngl.create_standalone_context(backend="egl", require=330)
    quad = ctx.buffer(np.array([0, 0, 1, 0, 0, 1, 1, 1], dtype="f4").tobytes())
    _, levels, level = coarse(theme)
    world = coarse_world(ctx, theme, t, windows, focused, **answers)
    frost = ctx.texture((PIXELS[0] >> level, PIXELS[1] >> level), 4, world.read(level=levels - 1))

    shown = ctx.texture(PIXELS, 4, image.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM).tobytes())
    ctx.framebuffer([shown]).use()
    program = ctx.program(vertex_shader=WINDOW, fragment_shader=surface(theme, colors))
    vao = ctx.vertex_array(program, [(quad, "2f", "pos")])
    program["size"].value = PIXELS
    program["tex"].value, program["blurredBG"].value, program["alpha"].value = 0, 1, 0.999
    frost.use(1)
    ink = lambda name: tuple(int(c * 255) for c in colors.get(name, (1, 1, 1))) + (255,)
    for x, y, w, h in windows:
        x, y, w, h = (round(v * scale) for v in (x, y, w, h))
        app = Image.new("RGBA", (w, h), ink("background"))
        draw = ImageDraw.Draw(app)
        for row in range(6):
            ty = 60 + row * 44
            draw.rectangle((50, ty, 50 + int(w * (0.75 - 0.08 * (row % 3))), ty + 14), fill=ink("muted" if row % 3 == 2 else "foreground"))
        tex = ctx.texture((w, h), 4, app.tobytes())
        tex.use(0)
        program["box"].value = (x, y, w, h)
        program["uvSize"].value, program["uvOffset"].value = (w / PIXELS[0], -h / PIXELS[1]), (x / PIXELS[0], 1 - y / PIXELS[1])
        vao.render(moderngl.TRIANGLE_STRIP)
    out = Image.frombytes("RGBA", PIXELS, shown.read()).transpose(Image.FLIP_TOP_BOTTOM).convert("RGB")
    ctx.release()
    if border:
        draw = ImageDraw.Draw(out)
        accent = ink("accent")[:3]
        for i, (x, y, w, h) in enumerate(windows):
            box = tuple(int(v * scale) for v in (x, y, x + w, y + h))
            draw.rectangle(box, outline=accent if i == focused else tuple(c // 2 for c in accent), width=3)
    return out


def storyboard():
    """The four moments --answers shows, as (name, windows, focused, answers),
    from scene.js."""
    return [(m["name"], [tuple(r) for r in m["windows"]], m["focused"],
             {k: [tuple(v) for v in m[k]] if k != "voice" else m[k] for k in ("velocity", "voice", "impulses") if k in m})
            for m in model("storyboard", LOGICAL, BAR, GAP)]


def answers(theme, t, out):
    """The four storyboard frames side by side, two by two, at half size."""
    tiles = []
    for _, wins, f, extra in storyboard():
        image, _ = render(theme, t, wins, f, **extra)
        shown = with_frames(theme, glass(theme, image, t, wins, f, border=not framed(theme), **extra), t, wins, f, **extra)
        tiles.append(shown.resize((PIXELS[0] // 2, PIXELS[1] // 2)))
    sheet = Image.new("RGB", PIXELS)
    for k, tile in enumerate(tiles):
        sheet.paste(tile, ((k % 2) * PIXELS[0] // 2, (k // 2) * PIXELS[1] // 2))
    path = out / f"{theme.name}-answers-{t:g}.png"
    sheet.save(path)
    print(path)


def main():
    theme = Path(sys.argv[1]).resolve()
    out = ROOT / "scratch/preview"
    out.mkdir(parents=True, exist_ok=True)
    if "--answers" in sys.argv:
        for t in [float(a) for a in sys.argv[2:] if a != "--answers"] or [12.0]:
            answers(theme, t, out)
        return
    times = [float(t) for t in sys.argv[2:]] or [12.0]
    for t in times:
        empty, _ = render(theme, t, [], 0)
        empty.save(out / f"{theme.name}-empty-{t:g}.png")
        windows = layout()
        backdrop, _ = render(theme, t, windows, 0)
        with_frames(theme, glass(theme, backdrop, t, windows, 0, border=not framed(theme)), t, windows, 0).save(out / f"{theme.name}-windows-{t:g}.png")
        print(out / f"{theme.name}-empty-{t:g}.png")
        print(out / f"{theme.name}-windows-{t:g}.png")


if __name__ == "__main__":
    main()
