// Jarvis's dictation popup: the holographic core of the backdrop, small. A
// glowing core in a gyroscope of rings, with the voice spun round it as ticks
// and running out either side as a waveform. While the words are worked out
// the rings race and an amber sweep goes round.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(600, 200)

    readonly property color amber: "#ffb347"

    draw: function (ctx) {
        const cx = box.width / 2, cy = box.height / 2;
        const t = time, a = appear, v = level;
        const grow = 0.55 + 0.45 * a;
        const tau = Math.PI * 2;
        const core = thinking ? amber : accent;

        // A dark lens behind the rings, so they read over any window.
        let lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, 98);
        lens.addColorStop(0, tint(background, 0.72 * a));
        lens.addColorStop(0.7, tint(background, 0.5 * a));
        lens.addColorStop(1, tint(background, 0));
        ctx.fillStyle = lens;
        ctx.fillRect(0, 0, box.width, box.height);

        // The core, swelling with the voice.
        const rc = (14 + 12 * v) * grow;
        let glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc * 2.4);
        glow.addColorStop(0, tint("#ffffff", 0.95 * a));
        glow.addColorStop(0.25, tint(core, 0.75 * a));
        glow.addColorStop(1, tint(core, 0));
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, rc * 2.4, 0, tau);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";

        ctx.beginPath();
        ctx.arc(cx, cy, 34 * grow, 0, tau);
        light(ctx, accent, 1.2, 0.8 * a);

        // The voice round the core: 72 ticks, the last 0.7 s mirrored left
        // and right, turning slowly. Thinking, they fall quiet and an amber
        // sweep runs round them.
        const ticks = 72;
        const spin = t * 0.15;
        const r0 = 42 * grow;
        const tick = (th, len) => {
            ctx.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0);
            ctx.lineTo(cx + Math.cos(th) * (r0 + len), cy + Math.sin(th) * (r0 + len));
        };
        ctx.beginPath();
        for (let i = 0; i < ticks; i++) {
            const k = i < ticks / 2 ? i : ticks - 1 - i;
            tick(spin + i / ticks * tau, thinking ? 3 : 3 + 16 * voice(samples - 1 - k * 2));
        }
        light(ctx, accent, 1.4, (thinking ? 0.45 : 0.9) * a);
        if (thinking) {
            ctx.beginPath();
            for (let i = 0; i < ticks; i++) {
                const th = spin + i / ticks * tau;
                const w = Math.pow(Math.max(0, Math.cos(th - t * 5)), 8);
                if (w > 0.03) tick(th, 3 + 13 * w);
            }
            light(ctx, amber, 1.8, a);
        }

        // Three arcs tumbling the other way, faster while thinking.
        const turn = -t * (thinking ? 2.6 : 0.4);
        for (let i = 0; i < 3; i++) {
            const s0 = turn + i * tau / 3;
            ctx.beginPath();
            ctx.arc(cx, cy, 64 * grow, s0, s0 + tau / 5);
            light(ctx, accent, 2, 0.75 * a);
        }

        // A dashed outer ring, and the amber marker running round it.
        const ro = 76 * grow;
        ctx.beginPath();
        for (let i = 0; i < 60; i++) {
            const s0 = t * 0.08 + i / 60 * tau;
            ctx.moveTo(cx + Math.cos(s0) * ro, cy + Math.sin(s0) * ro);
            ctx.arc(cx, cy, ro, s0, s0 + tau / 60 * 0.45);
        }
        light(ctx, accent, 1, 0.35 * a);
        const m = t * (thinking ? 3 : 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, ro, m, m + 0.16);
        light(ctx, amber, 2.4, a);

        // The waveform either side: bars, newest at the rings, running out
        // as the popup opens, on an axis that fades to nothing at the ends.
        // Thinking, the bars settle and amber light runs in to the core.
        const inner = 96, outer = (box.width / 2 - 20) * a;
        const step = 7;
        const n = Math.max(0, Math.floor((outer - inner) / step));
        for (const side of [-1, 1]) {
            let axis = ctx.createLinearGradient(cx + side * inner, 0, cx + side * (inner + n * step), 0);
            axis.addColorStop(0, tint(accent, 0.5 * a));
            axis.addColorStop(1, tint(accent, 0));
            ctx.beginPath();
            ctx.moveTo(cx + side * inner, cy);
            ctx.lineTo(cx + side * (inner + n * step), cy);
            ctx.strokeStyle = axis;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            for (let j = 0; j < n; j++) {
                const i0 = samples - 1 - j * 3;
                const s = thinking ? 0 : Math.max(voice(i0), voice(i0 - 1), voice(i0 - 2));
                const h = 1.5 + 30 * s * (1 - j / n);
                const x = cx + side * (inner + 4 + j * step);
                ctx.moveTo(x, cy - h);
                ctx.lineTo(x, cy + h);
            }
            light(ctx, accent, 1.6, (thinking ? 0.4 : 0.85) * a);

            if (thinking) {
                const run = n * step;
                ctx.beginPath();
                for (let k = 0; k < 3; k++) {
                    const d = run * (1 - ((t * 0.9 + k / 3) % 1));
                    ctx.moveTo(cx + side * (inner + d + 18), cy);
                    ctx.lineTo(cx + side * (inner + d), cy);
                }
                light(ctx, amber, 2, a);
            }
        }
    }
}
