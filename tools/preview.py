# /// script
# dependencies = ["moderngl", "numpy", "pillow"]
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

import re
import sys
from pathlib import Path

import moderngl
import numpy as np
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
BACKDROP_MAIN = (ROOT / "plugin/dither.glsl").read_text() + (ROOT / "plugin/main-backdrop.glsl").read_text()
FRAME_MAIN = (ROOT / "plugin/main-frame.glsl").read_text()


def palette(theme):
    colors = {}
    for line in (theme / "colors.toml").read_text().splitlines():
        m = re.match(r'\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})"', line)
        if m:
            colors[m[1]] = tuple(int(m[2][i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colors


def layout():
    w, h = LOGICAL
    top = BAR + GAP
    left_w = round((w - 3 * GAP) * 0.62)
    right_x = GAP + left_w + GAP
    right_w = w - right_x - GAP
    full_h = h - top - GAP
    half_h = (full_h - GAP) / 2
    return [
        (GAP, top, left_w, full_h),
        (right_x, top, right_w, half_h),
        (right_x, top + half_h + GAP, right_w, half_h),
    ]


# Impulse kinds, as contract.glsl names them.
OPEN, CLOSE, LAND, FOCUS = range(1, 5)


def framed(theme):
    return re.search(r"\bvec4\s+frame\s*\(", (theme / "backdrop.frag").read_text()) is not None


def scene(ctx, theme, t, windows, focused, velocity=None, impulses=(), frame=None, voice=0.0, world=None, feed=True):
    """The film's program in `ctx` with everything the plugin would give it,
    as a function that draws it over the bound framebuffer. velocity: (vx, vy)
    per window; impulses: (x, y, age, strength, kind,
    window), newest last, window -1 for none. With `frame` set to a window's
    index, it draws that window's frame (premultiplied) instead of the
    backdrop, reading `world`, the backdrop drawn at half size, as the
    plugin's frames do. `feed` False is a film that writes text with no agent
    running."""
    contract = (ROOT / "plugin/contract.glsl").read_text().replace("#version 300 es", "#version 330 core")
    source = contract + "\n#line 1\n" + (theme / "backdrop.frag").read_text() + (BACKDROP_MAIN if frame is None else FRAME_MAIN)
    program = ctx.program(vertex_shader=VERTEX, fragment_shader=source)
    if frame is not None:
        program["frameWindow"].value = frame
        program["frameAlpha"].value = 1.0
        if "frameBorder" in program:
            program["frameBorder"].value = 2.0

    colors = palette(theme)
    for name in ("accent", "background", "foreground"):
        if name in program:
            program[name].value = colors.get(name, (1, 1, 1))
    values = {
        "time": float(t),
        "resolution": LOGICAL,
        "reserved": (BAR, 0.0, 0.0, 0.0),
        "windowCount": len(windows),
        "focusedIndex": focused if windows else -1,
        "focused": windows[focused] if windows else (LOGICAL[0] * 0.3, LOGICAL[1] * 0.3, LOGICAL[0] * 0.4, LOGICAL[1] * 0.4),
        "focusAlpha": 1.0 if windows else 0.0,
    }
    for name, value in values.items():
        if name in program:
            program[name].value = value
    if "voice" in program:
        program["voice"].value = voice
    if "impulseCount" in program:
        program["impulseCount"].value = len(impulses)
        rows = [tuple(i[:4]) for i in impulses] + [(0.0, 0.0, 0.0, 0.0)] * (32 - len(impulses))
        program["impulses"].write(np.array(rows, dtype="f4").tobytes())
        kinds = [int(i[4]) for i in impulses] + [0] * (32 - len(impulses))
        program["impulseKinds"].write(np.array(kinds, dtype="i4").tobytes())
        owners = [int(i[5]) for i in impulses] + [-1] * (32 - len(impulses))
        program["impulseWindows"].write(np.array(owners, dtype="i4").tobytes())

    data = np.zeros((3 * 256, 4), dtype="f4")
    for i, rect in enumerate(windows):
        data[3 * i] = rect
        data[3 * i + 1] = (1.0, 0.0, 1.0 if i == focused else 0.0, float(len(windows) - 1 - i))
        data[3 * i + 2] = (*(velocity[i] if velocity else (0.0, 0.0)), 0.0, 0.0)
    window_data = ctx.buffer(data.tobytes())
    if "Windows" in program:
        program["Windows"].binding = 0
    textures = []

    # A theme's lettering, for whatever it writes, and the agents' text for a
    # film that rains it: the preview fills the feed with this repository's
    # spec, as if agents were writing it.
    glyphs_png = theme / "glyphs.png"
    lettered = glyphs_png.exists()
    if lettered and "glyphs" in program:
        atlas = Image.open(glyphs_png).convert("RGBA").getchannel("A")
        glyphs = ctx.texture(atlas.size, 1, atlas.tobytes())
        glyphs.filter = (moderngl.LINEAR, moderngl.LINEAR)
        text = " ".join("".join(c if " " <= c <= "~" else " " for c in (ROOT / "SPEC.md").read_text()).split())
        ring = (text * (16384 // max(len(text), 1) + 1))[:16384].encode("ascii")
        letters = ctx.texture((128, 128), 1, ring)
        letters.filter = (moderngl.NEAREST, moderngl.NEAREST)
        textures += [glyphs, letters]
        for name, value in {"glyphs": 0, "feed": 1}.items():
            if name in program:
                program[name].value = value
    for name, value in {"feedCount": 16384 if lettered and feed else 0, "feedPos": 0, "feedPresence": 1.0 if lettered and feed else 0.0}.items():
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
        window_data.bind_to_uniform_block(0)
        for unit, texture in enumerate(textures):
            texture.use(unit)
        vao.render(moderngl.TRIANGLE_STRIP)
    return draw


def render(theme, t, windows, focused, frame=None, **answers):
    """One scene() drawn off screen: the backdrop as RGB, or a frame as
    premultiplied RGBA."""
    ctx = moderngl.create_standalone_context(backend="egl", require=330)
    world = None
    if frame is not None:
        world = ctx.texture((PIXELS[0] // 2, PIXELS[1] // 2), 4)
        world.filter = (moderngl.LINEAR, moderngl.LINEAR)
        world.repeat_x = world.repeat_y = False
        ctx.framebuffer([world]).use()
        scene(ctx, theme, t, windows, focused, **answers)()
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


def glass(image, windows, colors, focused, border=True):
    """The windows as the film's glass would show them: their background a
    darkened, blurred view of the backdrop, a lit border on the focused one,
    and a block of text lines that stay opaque."""
    from PIL import ImageDraw, ImageFilter

    scale = PIXELS[0] / LOGICAL[0]
    out = image.copy()
    blurred = image.filter(ImageFilter.GaussianBlur(6))
    background = tuple(int(c * 255) for c in colors.get("background", (0, 0, 0)))
    foreground = tuple(int(c * 255) for c in colors.get("foreground", (1, 1, 1)))
    accent = tuple(int(c * 255) for c in colors.get("accent", (1, 1, 1)))
    for i, (x, y, w, h) in enumerate(windows):
        box = tuple(int(v * scale) for v in (x, y, x + w, y + h))
        region = blurred.crop(box)
        tint = Image.new("RGB", region.size, background)
        out.paste(Image.blend(region, tint, 0.55), box[:2])
        draw = ImageDraw.Draw(out)
        if border:
            draw.rectangle(box, outline=accent if i == focused else tuple(c // 2 for c in accent), width=3)
        for row in range(6):
            ty = box[1] + 60 + row * 44
            draw.rectangle((box[0] + 50, ty, box[0] + 50 + int((box[2] - box[0]) * (0.75 - 0.08 * (row % 3))), ty + 14), fill=foreground)
    return out


def storyboard():
    """The four moments --answers shows, as (name, windows, focused, answers):
    at rest, a window dragged, a window just landed
    while you speak into the focused one, and a window opening, one closing
    and focus moving."""
    windows = layout()
    (lx, ly, lw, lh), (rx, ry, rw, rh) = windows[0], windows[1]
    moved = list(windows)
    moved[1] = (rx - 260, ry + 90, rw, rh)  # mid-drag, down and to the left
    return [
        ("rest", windows, 0, {}),
        ("drag", moved, 1, dict(velocity=[(0, 0), (-1800, 600), (0, 0)])),
        ("land", windows, 0, dict(voice=0.7,
                                  impulses=[(rx + rw / 2, ry + rh / 2, 0.25, 0.8, LAND, 1)])),
        ("open", windows[:2], 1, dict(impulses=[(rx + rw / 2, ry + rh * 1.5 + GAP, 0.3, 1.0, CLOSE, -1), (lx + lw / 2, ly + lh / 2, 0.5, 1.0, OPEN, 0),
                                                (rx + rw / 2, ry + rh / 2, 0.15, 0.6, FOCUS, 1)])),
    ]


def answers(theme, t, out):
    """The four storyboard frames side by side, two by two, at half size."""
    tiles = []
    for _, wins, f, extra in storyboard():
        image, colors = render(theme, t, wins, f, **extra)
        shown = with_frames(theme, glass(image, wins, colors, f, border=not framed(theme)), t, wins, f, **extra)
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
        backdrop, colors = render(theme, t, windows, 0)
        with_frames(theme, glass(backdrop, windows, colors, 0, border=not framed(theme)), t, windows, 0).save(out / f"{theme.name}-windows-{t:g}.png")
        print(out / f"{theme.name}-empty-{t:g}.png")
        print(out / f"{theme.name}-windows-{t:g}.png")


if __name__ == "__main__":
    main()
