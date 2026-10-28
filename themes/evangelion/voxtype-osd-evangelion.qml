// Evangelion's dictation popup: a strip of the backdrop's honeycomb over
// hazard stripes. The voice lights the cells orange, the newest in the middle
// and older spreading out, with now and then a cell in Unit-01's green; loud
// speech throws octagonal AT field rings out across it. While the words are
// worked out the rings pulse on their own and the cells run red.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(620, 150)

    readonly property color green: "#7dff4a"
    readonly property color red: "#ff2a1a"
    readonly property real cell: 10      // hexagon radius
    readonly property int columns: 36
    readonly property int rows: 3

    function hash(n) {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // A flat-topped hexagon of radius `r` at (x, y), added to the path.
    function hexagon(ctx, x, y, r) {
        ctx.moveTo(x + r, y);
        for (let k = 1; k < 6; k++)
            ctx.lineTo(x + r * Math.cos(k * Math.PI / 3), y + r * Math.sin(k * Math.PI / 3));
        ctx.closePath();
    }

    // An octagon at (x, y), flat on every side, `rx` from its centre to its
    // left and right sides and `ry` to its top and bottom: regular while the
    // two are equal, drawn out sideways when `rx` is the larger.
    function octagon(ctx, x, y, rx, ry) {
        const c = Math.min(rx, ry) * (2 - Math.SQRT2);
        ctx.moveTo(x + rx, y - ry + c);
        ctx.lineTo(x + rx - c, y - ry);
        ctx.lineTo(x - rx + c, y - ry);
        ctx.lineTo(x - rx, y - ry + c);
        ctx.lineTo(x - rx, y + ry - c);
        ctx.lineTo(x - rx + c, y + ry);
        ctx.lineTo(x + rx - c, y + ry);
        ctx.lineTo(x + rx, y + ry - c);
        ctx.closePath();
    }

    readonly property real dx: cell * 1.5
    readonly property real dy: cell * Math.sqrt(3)
    readonly property real w: (columns - 1) * dx
    readonly property real x0: (box.width - w) / 2
    readonly property real cy: box.height / 2
    readonly property real firstRow: cy - dy * (rows - 1) / 2 - dy / 4
    readonly property rect pane: Qt.rect(x0 - 26, cy - 46, w + 52, 92)

    function cellAt(c, r) {
        return [x0 + c * dx, firstRow + r * dy + (c % 2 ? dy / 2 : 0)];
    }

    // A dark pane between two orange rules, hazard stripes under it, and the
    // honeycomb's outlines.
    still: function (ctx) {
        const p = pane;
        ctx.fillStyle = tint(background, 0.9);
        ctx.fillRect(p.x, p.y, p.width, p.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.x, p.y + p.height - 8, p.width, 8);
        ctx.clip();
        ctx.beginPath();
        for (let x = p.x - 16; x < p.x + p.width + 16; x += 16) {
            ctx.moveTo(x, p.y + p.height);
            ctx.lineTo(x + 8, p.y + p.height - 8);
            ctx.lineTo(x + 16, p.y + p.height - 8);
            ctx.lineTo(x + 8, p.y + p.height);
            ctx.closePath();
        }
        ctx.fillStyle = tint(accent, 0.85);
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.width, p.y);
        ctx.moveTo(p.x, p.y + p.height - 8);
        ctx.lineTo(p.x + p.width, p.y + p.height - 8);
        light(ctx, accent, 1.2, 0.9);
        ctx.beginPath();
        for (let c = 0; c < columns; c++)
            for (let r = 0; r < rows; r++) {
                const [x, y] = cellAt(c, r);
                hexagon(ctx, x, y, cell - 1.5);
            }
        ctx.strokeStyle = tint(accent, 0.22);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    draw: function (ctx) {
        const t = time, a = appear;
        const shown = Math.floor(columns / 2 * a);

        // The cells the voice reaches, lit in four steps of brightness and
        // drawn a step at a time.
        let lit = [[], [], []]; // orange, green, red
        for (let c = 0; c < columns; c++) {
            const k = Math.abs(c - (columns - 1) / 2);
            if (k > shown + 0.5) continue;
            const s = thinking ? 0 : voice(samples - 1 - Math.floor(k * 3.5));
            for (let r = 0; r < rows; r++) {
                const reach = Math.abs(r - (rows - 1) / 2 + (c % 2 ? 0.5 : 0) - 0.25);
                let e = Math.max(0, Math.min(1, s * 2.4 - reach * 0.7));
                let kind = hash(c * 13 + r + Math.floor(t * 3)) < 0.06 ? 1 : 0;
                if (thinking) {
                    e = Math.pow(Math.max(0, Math.sin(k * 0.45 - t * 6)), 6);
                    kind = 2;
                }
                if (e > 0.05) lit[kind].push(cellAt(c, r).concat([Math.ceil(e * 4) / 4]));
            }
        }
        const tones = [accent, green, red];
        for (let kind = 0; kind < 3; kind++) {
            for (const e of [0.25, 0.5, 0.75, 1]) {
                const cells = lit[kind].filter(c => c[2] === e);
                if (!cells.length) continue;
                ctx.beginPath();
                for (const [x, y] of cells) hexagon(ctx, x, y, cell - 1.5);
                ctx.fillStyle = tint(tones[kind], 0.65 * e * a);
                ctx.fill();
                light(ctx, tones[kind], 1.2, (0.4 + 0.6 * e) * a);
            }
        }

        // AT field rings: thrown out by loud speech, or steadily while
        // thinking; each spreads to the pane's ends and fades. Once a ring
        // is as tall as the pane it draws out sideways, so it stays a whole
        // octagon (cut by the pane, a wide one showed only its two sides,
        // which read as dividers).
        const strength = thinking ? 1 : Math.min(1, level * 2);
        if (strength < 0.15) return;
        const beat = thinking ? 0.7 : 0.45;
        for (let k = 0; k < 3; k++) {
            const phase = (t / beat + k / 3) % 1;
            const r = 13 + phase * w / 2;
            ctx.beginPath();
            octagon(ctx, box.width / 2, cy, r, Math.min(r, 34));
            light(ctx, thinking ? red : accent, 1.4, (1 - phase) * strength * a);
        }
    }
}
