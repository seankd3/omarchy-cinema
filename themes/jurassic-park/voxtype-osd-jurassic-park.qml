// Jurassic Park's dictation popup: the voice as an fsn directory. A rose
// platform floats in the navy void and the voice stands on it as a row of
// azure blocks, the newest at the right under fsn's white spotlight, older
// ones further left. While the words are worked out the blocks settle and
// fsn's gold searchlight sweeps along them.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(600, 200)

    readonly property color platform: "#c87aa8"
    readonly property color block: "#40b8ec"
    readonly property color wire: "#8fe3d6"
    readonly property color spot: "#fffbe8"
    readonly property color search: "#ffe066"

    // The scene in the popup's pixels, seen as fsn sees it, from above and in
    // front: a point `d` deep into the scene sits d * SLANT to the right and
    // d * RISE higher. The platform's top front left corner is (x0, y0).
    readonly property real slant: 0.9
    readonly property real rise: 0.62
    readonly property real x0: 64
    readonly property real y0: 160
    readonly property real width_: 430
    readonly property real deep: 48
    readonly property real thick: 12
    readonly property int count: 16
    // Each block stands `front` into the platform and is `bd` deep.
    readonly property real front: 13
    readonly property real bd: 20

    // A colour `c` with its brightness scaled by `k`, at opacity `a`: fsn's
    // flat shading of a face.
    function shade(c, k, a) {
        const q = Qt.lighter(c, 1);
        return Qt.rgba(Math.min(q.r * k, 1), Math.min(q.g * k, 1), Math.min(q.b * k, 1), a);
    }

    function face(ctx, pts, fill) {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2)
            ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    }

    // A box whose base's front left corner is (x, y), w across, h tall and d
    // deep: its right side, top and front, the faces fsn's view shows.
    function prism(ctx, x, y, w, h, d, c, a) {
        const dx = d * slant, dy = -d * rise;
        face(ctx, [x + w, y, x + w + dx, y + dy, x + w + dx, y + dy - h, x + w, y - h], shade(c, 0.6, a));
        face(ctx, [x, y - h, x + w, y - h, x + w + dx, y + dy - h, x + dx, y + dy - h], shade(c, 0.86, a));
        face(ctx, [x, y, x + w, y, x + w, y - h, x, y - h], shade(c, 1.0, a));
    }

    // The middle of block i's footprint on the platform.
    function foot(i) {
        const pitch = width_ / count;
        const d = front + bd * 0.5;
        return Qt.point(x0 + (i + 0.5) * pitch + d * slant, y0 - d * rise);
    }

    // A light from above on the block at p: the ellipse of light it lands in
    // on the platform, drawn under the blocks.
    function pool(ctx, p, c, a) {
        ctx.beginPath();
        ctx.ellipse(p.x - 26, p.y - 12, 52, 24);
        ctx.fillStyle = tint(c, 0.9 * a);
        ctx.fill();
    }

    // Its cone, drawn over them: a pale veil from the lamp at the top of the
    // popup down to the pool, its two edges drawn.
    function beam(ctx, p, c, a) {
        const top = 14, r = 30;
        ctx.beginPath();
        ctx.moveTo(p.x - 1.5, top);
        ctx.lineTo(p.x + 1.5, top);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fillStyle = tint(c, 0.12 * a);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x, top);
        ctx.lineTo(p.x - r, p.y);
        ctx.moveTo(p.x, top);
        ctx.lineTo(p.x + r, p.y);
        ctx.strokeStyle = tint(c, 0.7 * a);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // What holds still: the void behind it all, so the popup reads over any
    // window, a wire running off to the parent directory, and the platform.
    still: function (ctx) {
        ctx.beginPath();
        ctx.roundedRect(8, 4, box.width - 16, box.height - 8, 6, 6);
        ctx.fillStyle = tint(background, 0.88);
        ctx.fill();
        ctx.strokeStyle = tint(wire, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x0 + width_ * 0.42, y0 + thick);
        ctx.lineTo(x0 + width_ * 0.42 - 70, box.height - 4);
        ctx.strokeStyle = tint(wire, 0.6);
        ctx.stroke();
        prism(ctx, x0, y0 + thick, width_, thick, deep, platform, 1);
    }
    stillKey: [background]

    draw: function (ctx) {
        const a = appear;
        const pitch = width_ / count, w = pitch * 0.62;
        // The light: on the newest block while listening; thinking, the
        // searchlight sweeps along the row and back.
        const s = 0.5 - 0.5 * Math.cos(time * 2.4);
        const lit = foot(thinking ? s * (count - 1) : count - 1);
        const light = thinking ? search : spot;
        pool(ctx, lit, light, a);
        // One row, drawn left to right, so each block's right side goes under
        // its neighbour's front. A block is 30 ms of the voice; thinking, they
        // settle to half.
        for (let i = 0; i < count; i++) {
            const j = samples - 1 - (count - 1 - i) * 3;
            const v = Math.max(voice(j), voice(j - 1)) * (thinking ? 0.5 : 1);
            const x = x0 + i * pitch + (pitch - w) * 0.5 + front * slant;
            prism(ctx, x, y0 - front * rise, w, (6 + v * 96) * a, bd, block, a);
        }
        beam(ctx, lit, light, a);
    }
}
