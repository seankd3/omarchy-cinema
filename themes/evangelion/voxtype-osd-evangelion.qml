// Evangelion's dictation popup: a strip of the backdrop's honeycomb between
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

    // A regular octagon of radius `r` at (x, y), flat on every side.
    function octagon(ctx, x, y, r) {
        for (let k = 0; k < 8; k++) {
            const th = (k + 0.5) * Math.PI / 4;
            if (k === 0) ctx.moveTo(x + r * Math.cos(th), y + r * Math.sin(th));
            else ctx.lineTo(x + r * Math.cos(th), y + r * Math.sin(th));
        }
        ctx.closePath();
    }

    draw: function (ctx) {
        const t = time, a = appear;
        const dx = cell * 1.5, dy = cell * Math.sqrt(3);
        const w = (columns - 1) * dx, x0 = (box.width - w) / 2;
        const cy = box.height / 2, top = cy - dy * (rows - 1) / 2 - dy / 4;
        const shown = Math.floor(columns / 2 * a);

        // A dark pane between two orange rules, hazard stripes under it.
        const px0 = x0 - 26, pw = w + 52, py0 = cy - 46, ph = 92;
        ctx.fillStyle = tint(background, 0.9 * a);
        ctx.fillRect(px0, py0, pw, ph);
        ctx.save();
        ctx.beginPath();
        ctx.rect(px0, py0 + ph - 8, pw, 8);
        ctx.clip();
        ctx.beginPath();
        const scroll = (t * (thinking ? 40 : 12)) % 16;
        for (let x = px0 - 16 + scroll; x < px0 + pw + 16; x += 16) {
            ctx.moveTo(x, py0 + ph);
            ctx.lineTo(x + 8, py0 + ph - 8);
            ctx.lineTo(x + 16, py0 + ph - 8);
            ctx.lineTo(x + 8, py0 + ph);
            ctx.closePath();
        }
        ctx.fillStyle = tint(accent, 0.85 * a);
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(px0 + pw, py0);
        ctx.moveTo(px0, py0 + ph - 8);
        ctx.lineTo(px0 + pw, py0 + ph - 8);
        light(ctx, accent, 1.2, 0.9 * a);

        // The cells: outlines throughout, filled where the voice reaches.
        let dim = [], lit = [[], [], []]; // orange, green, red
        for (let c = 0; c < columns; c++) {
            const k = Math.abs(c - (columns - 1) / 2);
            if (k > shown + 0.5) continue;
            const s = thinking ? 0 : voice(samples - 1 - Math.floor(k * 3.5));
            for (let r = 0; r < rows; r++) {
                const x = x0 + c * dx, y = top + r * dy + (c % 2 ? dy / 2 : 0);
                const reach = Math.abs(r - (rows - 1) / 2 + (c % 2 ? 0.5 : 0) - 0.25);
                let e = Math.max(0, Math.min(1, s * 2.4 - reach * 0.7));
                let kind = hash(c * 13 + r + Math.floor(t * 3)) < 0.06 ? 1 : 0;
                if (thinking) {
                    e = Math.pow(Math.max(0, Math.sin(k * 0.45 - t * 6)), 6);
                    kind = 2;
                }
                if (e > 0.05) lit[kind].push([x, y, e]);
                else dim.push([x, y]);
            }
        }
        ctx.beginPath();
        for (const [x, y] of dim) hexagon(ctx, x, y, cell - 1.5);
        ctx.strokeStyle = tint(accent, 0.22 * a);
        ctx.lineWidth = 1;
        ctx.stroke();
        const tones = [accent, green, red];
        for (let kind = 0; kind < 3; kind++) {
            for (const [x, y, e] of lit[kind]) {
                ctx.beginPath();
                hexagon(ctx, x, y, cell - 1.5);
                ctx.fillStyle = tint(tones[kind], 0.65 * e * a);
                ctx.fill();
                light(ctx, tones[kind], 1.2, (0.4 + 0.6 * e) * a);
            }
        }

        // AT field rings: thrown out by loud speech, or steadily while
        // thinking; each spreads and fades.
        const beat = thinking ? 0.7 : 0.45;
        ctx.save();
        ctx.beginPath();
        ctx.rect(px0, py0, pw, ph - 8);
        ctx.clip();
        for (let k = 0; k < 3; k++) {
            const phase = ((t / beat + k / 3) % 1);
            const strength = thinking ? 1 : Math.min(1, level * 2);
            if (strength < 0.15) continue;
            ctx.beginPath();
            octagon(ctx, box.width / 2, cy, 14 + phase * w * 0.55);
            light(ctx, thinking ? red : accent, 1.4, (1 - phase) * strength * a);
        }
        ctx.restore();
    }
}
