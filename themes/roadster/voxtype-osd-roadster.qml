// Roadster's dictation popup: the backdrop's lock frame round a bar of red
// segments, as on an eighties dash. The voice lights the segments out from the
// middle as a level meter, with a white mark held at the loudest; while the
// words are worked out a single red light sweeps from end to end and back,
// trailing, and the frame closes in.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(620, 140)

    readonly property int segments: 31

    draw: function (ctx) {
        const t = time, a = appear;
        const cx = box.width / 2, cy = box.height / 2;
        const seg = 15, gap = 3;
        const w = segments * (seg + gap) - gap, x0 = cx - w / 2;

        // The pane and the lock frame: four corner brackets that breathe every
        // two seconds, tighter while thinking.
        const fw = w + 44, fh = 76;
        ctx.fillStyle = tint(background, 0.88 * a);
        ctx.fillRect(cx - fw / 2, cy - fh / 2, fw, fh);
        const pulse = (thinking ? 2 : 4) * (0.5 + 0.5 * Math.cos(t * Math.PI * (thinking ? 2 : 1)));
        const bx = fw / 2 + 6 + pulse, by = fh / 2 + 6 + pulse * 0.6, arm = 16;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            ctx.moveTo(cx + sx * bx, cy + sy * (by - arm));
            ctx.lineTo(cx + sx * bx, cy + sy * by);
            ctx.lineTo(cx + sx * (bx - arm), cy + sy * by);
        }
        light(ctx, accent, 2, a);
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy - by);
        ctx.lineTo(cx + 10, cy - by);
        light(ctx, foreground, 2, a);

        // The bar's segments: how lit each one is. The meter reads the loudest
        // of the last 80 ms, and the mark the loudest of the last second.
        const glow = [];
        const mid = (segments - 1) / 2;
        let now = 0, held = 0;
        for (let j = 0; j < samples; j++) {
            held = Math.max(held, voice(j));
            if (j >= samples - 8) now = Math.max(now, voice(j));
        }
        now *= mid + 1;
        held *= mid + 1;
        for (let i = 0; i < segments; i++) {
            const k = Math.abs(i - mid);
            if (k > mid * a + 0.5) {
                glow.push(-1);
                continue;
            }
            if (thinking) {
                // A light sweeping end to end on a smooth swing, trailing.
                const head = mid + mid * Math.sin(t * 2.6);
                const back = mid * Math.cos(t * 2.6) >= 0 ? -1 : 1;
                const d = (i - head) * back;
                glow.push(d < -0.5 ? 0 : Math.exp(-Math.max(0, d) / 2.2));
            } else {
                glow.push(Math.max(0, Math.min(1, now - k + 0.6)) * (0.6 + 0.4 * k / mid));
            }
        }
        for (let i = 0; i < segments; i++) {
            if (glow[i] < 0) continue;
            const x = x0 + i * (seg + gap), y = cy - 9;
            ctx.beginPath();
            ctx.roundedRect(x, y, seg, 18, 2, 2);
            ctx.fillStyle = tint(accent, (0.1 + 0.8 * glow[i]) * a);
            ctx.fill();
            if (glow[i] > 0.05) light(ctx, accent, 1, glow[i] * a);
        }

        // The white mark at the voice's reach on each side.
        if (!thinking && held > 0.5) {
            ctx.beginPath();
            for (const side of [-1, 1]) {
                const x = cx + side * Math.min(held, mid + 0.5) * (seg + gap);
                ctx.moveTo(x, cy - 14);
                ctx.lineTo(x, cy + 14);
            }
            light(ctx, foreground, 1.6, a);
        }

        // A thin horizon under the bar, the floor's dots below it.
        ctx.beginPath();
        ctx.moveTo(x0, cy + 22);
        ctx.lineTo(x0 + w, cy + 22);
        light(ctx, foreground, 0.8, 0.45 * a);
        ctx.fillStyle = tint(accent, 0.5 * a);
        for (let x = x0 + 4; x < x0 + w; x += 12) ctx.fillRect(x, cy + 28, 1.5, 1.5);
    }
}
