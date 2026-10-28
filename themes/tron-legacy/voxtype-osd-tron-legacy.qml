// Tron Legacy's dictation popup: an identity disc, its rim brightening with
// the voice, and the voice itself running out either side as a light-cycle
// trail that turns only at right angles. While the words are worked out the
// disc spins up and Clu's orange chases round it.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(640, 170)

    readonly property color orange: "#ff8519"

    draw: function (ctx) {
        const cx = box.width / 2, cy = box.height / 2;
        const t = time, a = appear, v = level;
        const tau = Math.PI * 2;
        const R = 56 * (0.6 + 0.4 * a);

        // The disc's dark body, so it reads over any window.
        ctx.beginPath();
        ctx.arc(cx, cy, R + 8, 0, tau);
        ctx.fillStyle = tint(background, 0.82 * a);
        ctx.fill();

        // The rim: four arcs between notches, turning; brighter as the voice
        // rises, spun up while thinking.
        const spin = t * (thinking ? 4.5 : 0.35);
        for (let i = 0; i < 4; i++) {
            const s0 = spin + i * tau / 4 + 0.09;
            ctx.beginPath();
            ctx.arc(cx, cy, R, s0, s0 + tau / 4 - 0.18);
            light(ctx, accent, 2.6, (0.55 + 0.45 * v) * a);
        }
        if (thinking) {
            const s0 = -t * 3;
            ctx.beginPath();
            ctx.arc(cx, cy, R + 5, s0, s0 + 1.1);
            light(ctx, orange, 2.4, a);
        }

        // The inner ring in eight cells that light with the voice, and the hub.
        const lit = thinking ? 8 * ((t * 1.5) % 1) : Math.round(v * 8 + 0.4);
        for (let i = 0; i < 8; i++) {
            const s0 = -Math.PI / 2 + i * tau / 8 + 0.06;
            ctx.beginPath();
            ctx.arc(cx, cy, R * 0.68, s0, s0 + tau / 8 - 0.12);
            const on = thinking ? Math.max(0, 1 - Math.abs(i - lit) / 1.5) : (i < lit ? 1 : 0);
            light(ctx, thinking && on > 0 ? orange : accent, 1.6, (0.22 + 0.78 * on) * a);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.24, 0, tau);
        light(ctx, foreground, 1.4, (0.6 + 0.4 * v) * a);

        // The trail either side: the newest voice at the disc, older further
        // out, each step a straight run with square corners, fading at its
        // tail. Thinking, it lies flat and an orange pulse runs in.
        const cell = 9;
        const reach = (box.width / 2 - R - 30) * a;
        const n = Math.max(0, Math.floor(reach / cell));
        for (const side of [-1, 1]) {
            const x0 = cx + side * (R + 12);
            let trail = ctx.createLinearGradient(x0, 0, x0 + side * n * cell, 0);
            trail.addColorStop(0, tint(accent, a));
            trail.addColorStop(0.7, tint(accent, 0.45 * a));
            trail.addColorStop(1, tint(accent, 0));
            ctx.beginPath();
            ctx.moveTo(x0, cy);
            for (let j = 0; j < n; j++) {
                const i0 = samples - 1 - j * 2;
                const s = thinking ? 0 : Math.max(voice(i0), voice(i0 - 1));
                const ny = cy - Math.round(s * 5) * 7 * (j % 2 ? 1 : -1) * (1 - j / n);
                const x = x0 + side * (j + 1) * cell;
                ctx.lineTo(x - side * cell, ny);
                ctx.lineTo(x, ny);
            }
            light(ctx, trail, 2, 1);

            if (thinking) {
                const d = n * cell * (1 - (t * 1.2) % 1);
                ctx.beginPath();
                ctx.moveTo(x0 + side * (d + 26), cy);
                ctx.lineTo(x0 + side * d, cy);
                light(ctx, orange, 2.4, a);
            }
        }
    }
}
