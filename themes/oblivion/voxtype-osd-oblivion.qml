// Oblivion's dictation popup: a capsule of frosted daylight glass, as clean
// as the Tower's desk. The sensor ring at its end turns while it listens and
// the voice flows from it as a fine blue trace; while the words are worked out
// the sensor sweeps and a glint runs back into it.
import QtQuick

FilmOsd {
    id: osd
    box: Qt.size(580, 130)

    draw: function (ctx) {
        const t = time, a = appear, v = level;
        const tau = Math.PI * 2;
        const h = 84, y0 = (box.height - h) / 2, cy = y0 + h / 2;
        const w = (box.width - 40) * (0.35 + 0.65 * a);
        const x0 = (box.width - w) / 2;

        // The capsule, floating on a soft daylight shadow: rings of shade
        // spreading out below it.
        ctx.globalAlpha = a;
        for (let k = 8; k > 0; k--) {
            const e = k * 2.5;
            ctx.beginPath();
            ctx.roundedRect(x0 - e, y0 - e + 7, w + 2 * e, h + 2 * e, h / 2 + e, h / 2 + e);
            ctx.fillStyle = tint(foreground, 0.022);
            ctx.fill();
        }
        ctx.beginPath();
        ctx.roundedRect(x0, y0, w, h, h / 2, h / 2);
        ctx.fillStyle = tint(background, 0.94);
        ctx.fill();
        // A clear blue rim, so the capsule stands off a white window.
        ctx.strokeStyle = tint(accent, 0.65);
        ctx.lineWidth = 1;
        ctx.stroke();

        // The sensor: a fine ring with twelve fixed ticks, an arc going round
        // it, and a core that swells with the voice. Thinking, it sweeps.
        const sx = x0 + h / 2, R = 25;
        ctx.beginPath();
        ctx.arc(sx, cy, R, 0, tau);
        ctx.strokeStyle = tint(accent, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
            const th = i / 12 * tau;
            ctx.moveTo(sx + Math.cos(th) * (R - 5), cy + Math.sin(th) * (R - 5));
            ctx.lineTo(sx + Math.cos(th) * (R - 2), cy + Math.sin(th) * (R - 2));
        }
        ctx.strokeStyle = tint(foreground, 0.35);
        ctx.stroke();
        const turn = t * (thinking ? 5 : 1.6);
        if (thinking) {
            let fan = ctx.createRadialGradient(sx, cy, 0, sx, cy, R);
            fan.addColorStop(0, tint(accent, 0.05));
            fan.addColorStop(1, tint(accent, 0.35));
            ctx.beginPath();
            ctx.moveTo(sx, cy);
            ctx.arc(sx, cy, R - 1, turn - 0.9, turn);
            ctx.closePath();
            ctx.fillStyle = fan;
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(sx, cy, R + 5, turn, turn + tau / 6);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx, cy, 3 + 6 * (thinking ? 0.3 : v), 0, tau);
        ctx.fillStyle = accent;
        ctx.fill();

        // The trace: the voice as a band either side of a centre line, newest
        // at the sensor, drawn through smooth curves and fading to the end.
        const left = sx + R + 22, right = x0 + w - h / 2;
        const n = 64, dx = (right - left) / (n - 1);
        const amp = [];
        for (let j = 0; j < n; j++) {
            const s = thinking ? 0 : voice(samples - 1 - Math.floor(j * 1.6));
            amp.push(2 + 24 * s * (1 - 0.6 * j / n));
        }
        const edge = (sign) => {
            ctx.moveTo(left, cy + sign * amp[0]);
            for (let j = 1; j < n; j++) {
                const xm = left + (j - 0.5) * dx;
                const ym = cy + sign * (amp[j - 1] + amp[j]) / 2;
                ctx.quadraticCurveTo(left + (j - 1) * dx, cy + sign * amp[j - 1], xm, ym);
            }
            ctx.lineTo(right, cy + sign * amp[n - 1]);
        };
        let fade = ctx.createLinearGradient(left, 0, right, 0);
        fade.addColorStop(0, tint(accent, 1));
        fade.addColorStop(1, tint(accent, 0.35));
        ctx.beginPath();
        edge(-1);
        edge(1);
        ctx.fillStyle = tint(accent, 0.12);
        ctx.fill();
        ctx.strokeStyle = fade;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        // The centre line, and a fine scale under the trace.
        ctx.beginPath();
        ctx.moveTo(left, cy);
        ctx.lineTo(right, cy);
        for (let x = left; x <= right; x += 16) {
            ctx.moveTo(x, cy + 31);
            ctx.lineTo(x, cy + (Math.round((x - left) / 16) % 4 ? 33 : 35));
        }
        ctx.strokeStyle = tint(accent, 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();

        if (thinking) {
            const g = right - (right - left) * ((t * 0.8) % 1);
            let glint = ctx.createLinearGradient(g, 0, g + 60, 0);
            glint.addColorStop(0, tint(accent, 1));
            glint.addColorStop(1, tint(accent, 0));
            ctx.beginPath();
            ctx.moveTo(g, cy);
            ctx.lineTo(Math.min(g + 60, right), cy);
            ctx.strokeStyle = glint;
            ctx.lineWidth = 2.4;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
}
