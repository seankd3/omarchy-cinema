// The Matrix's dictation popup: a strip of the rain, hanging from a phosphor
// line. The voice pulls the streams down, the newest in the middle and older
// spreading out to the ends, each led by a white-hot glyph; while the words
// are worked out the rain falls on its own through the whole strip.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(600, 150)

    readonly property int columns: 40
    readonly property int rows: 8
    readonly property real cellW: 13
    readonly property real cellH: 15

    function hash(n) {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // A glyph: strokes picked by `seed` from the edges and diagonals of a
    // 3 by 3 lattice in the cell at (x, y), as the backdrop draws them.
    readonly property var strokes: [
        [0, 0, 1, 0], [1, 0, 2, 0], [0, 1, 1, 1], [1, 1, 2, 1], [0, 2, 1, 2], [1, 2, 2, 2],
        [0, 0, 0, 1], [0, 1, 0, 2], [1, 0, 1, 1], [1, 1, 1, 2], [2, 0, 2, 1], [2, 1, 2, 2],
        [0, 0, 1, 1], [2, 0, 1, 1], [0, 2, 1, 1], [1, 1, 2, 2]
    ]
    function glyph(ctx, x, y, seed) {
        const sx = (cellW - 4) / 2, sy = (cellH - 4) / 2;
        let drawn = 0;
        for (let k = 0; k < strokes.length; k++) {
            if (hash(seed * 17.0 + k) < 0.68 && !(drawn < 2 && k > 12)) continue;
            const s = strokes[k];
            ctx.moveTo(x + 2 + s[0] * sx, y + 2 + s[1] * sy);
            ctx.lineTo(x + 2 + s[2] * sx, y + 2 + s[3] * sy);
            drawn++;
        }
    }

    draw: function (ctx) {
        const t = time, a = appear;
        const w = columns * cellW, x0 = (box.width - w) / 2, y0 = 22;
        const h = rows * cellH;

        // A dark pane under the rain, so it reads over any window, fading
        // out at its ends; on it, a dim wall of code that turns over slowly.
        let pane = ctx.createLinearGradient(x0 - 16, 0, x0 + w + 16, 0);
        pane.addColorStop(0, tint(background, 0));
        pane.addColorStop(0.08, tint(background, 0.94 * a));
        pane.addColorStop(0.92, tint(background, 0.94 * a));
        pane.addColorStop(1, tint(background, 0));
        ctx.fillStyle = pane;
        ctx.fillRect(x0 - 16, y0 - 8, w + 32, h + 18);
        ctx.beginPath();
        for (let c = 0; c < columns; c++)
            for (let r = 0; r < rows; r++)
                glyph(ctx, x0 + c * cellW, y0 + r * cellH, c * 31 + r * 7 + Math.floor(t * 0.7 + hash(c * 5 + r)) * 101);
        ctx.strokeStyle = tint(accent, 0.1 * a);
        ctx.lineWidth = 1.1;
        ctx.stroke();

        // How far down each stream reaches, and the row of its head.
        const reach = [];
        for (let c = 0; c < columns; c++) {
            if (thinking) {
                const speed = 6 + 6 * hash(c * 3.1);
                reach.push(((t * speed + hash(c) * rows * 2) % (rows * 2)) - 2);
            } else {
                const k = Math.abs(c - (columns - 1) / 2);
                const s = voice(samples - 1 - Math.floor(k * 4));
                reach.push(Math.min(rows, Math.round(s * rows * 1.2 + (hash(c * 7.7) < 0.3 ? 1 : 0))) - 1);
            }
        }

        // The tails, a row at a time so each row fades a step further from
        // its head; then the heads, white.
        for (let back = rows - 1; back >= 1; back--) {
            ctx.beginPath();
            for (let c = 0; c < columns; c++) {
                const r = Math.floor(reach[c]) - back;
                if (r < 0 || r >= rows || (thinking && back > 4)) continue;
                glyph(ctx, x0 + c * cellW, y0 + r * cellH, c * 31 + r * 7 + Math.floor(t * 9 + hash(c) * 50) % 6);
            }
            light(ctx, accent, 1.2, Math.pow(0.78, back) * (thinking ? 0.7 : 1) * a);
        }
        ctx.beginPath();
        for (let c = 0; c < columns; c++) {
            const r = Math.floor(reach[c]);
            if (r < 0 || r >= rows) continue;
            glyph(ctx, x0 + c * cellW, y0 + r * cellH, c * 31 + r * 7 + Math.floor(t * 14 + c));
        }
        light(ctx, Qt.tint(foreground, "#a0ffffff"), 1.3, a);

        // The phosphor line the rain hangs from, a drip of light running
        // along it.
        ctx.beginPath();
        ctx.moveTo(x0 - 16, y0 - 6);
        ctx.lineTo(x0 + w + 16, y0 - 6);
        light(ctx, accent, 1, 0.8 * a);
        const d = x0 - 16 + (w + 32) * ((t * (thinking ? 0.9 : 0.3)) % 1);
        ctx.beginPath();
        ctx.moveTo(d - 24, y0 - 6);
        ctx.lineTo(d, y0 - 6);
        light(ctx, foreground, 2, a);
    }
}
