// A film theme's dictation popup. Voxtype's Quickshell OSD loads the theme's
// voxtype-osd-<film>.qml, which is one of these with the film's drawing in
// `draw`; this holds what every film needs: where the popup sits, the voice
// over the last second, a clock, and a canvas redrawn each frame it shows.
// ./install copies it into each film theme, beside the file that uses it.
import QtQuick

Item {
    id: osd

    // Set by Voxtype's OSD: its state (recording, streaming, transcribing,
    // idle), the audio bridge, and the resolved style with the theme's colours.
    property string daemonState: "idle"
    property var audio: null
    property var theme: null

    // The film's popup: its box in logical pixels, and `draw(ctx)`, which
    // paints one frame into a cleared canvas of that size.
    property size box: Qt.size(560, 180)
    property var draw: function (ctx) {}

    readonly property bool shown: daemonState !== "idle" && daemonState !== ""
    // Transcribing: the voice is in and the words are being worked out.
    readonly property bool thinking: daemonState === "transcribing"
    readonly property real time: clock.elapsedTime
    // 0 to 1 over the popup's first 0.4 s, for an entrance.
    property real appear: 0

    readonly property color accent: role("accent", "#5ce1ff")
    readonly property color foreground: role("foreground", "#ffffff")
    readonly property color background: role("background", "#000000")

    // A colour of the theme's, by Voxtype's role name.
    function role(name, fallback) {
        return theme && theme.color ? theme.color(name, fallback) : fallback;
    }

    // `c` (a colour or its name) at opacity `a`, for the canvas.
    function tint(c, a) {
        const k = Qt.lighter(c, 1);
        return Qt.rgba(k.r, k.g, k.b, a);
    }

    // The voice: loudness 0 to 1 of the last `samples` audio frames (100 a
    // second), oldest first through `voice(i)`; `level` follows it smoothly.
    readonly property int samples: 120
    property var ring: new Array(samples).fill(0)
    property int head: 0
    property real level: 0

    function voice(i) {
        return ring[(head + i) % samples];
    }

    Connections {
        target: osd.audio
        enabled: osd.audio !== null
        function onFrameReceived(peak, rms, vad, tsMs) {
            // Speech peaks sit low on a linear scale; a power curve spreads
            // them over the range without clipping a shout.
            const v = Math.min(1, Math.pow(Math.max(peak, 0), 0.6) * 1.5);
            osd.ring[osd.head] = v;
            osd.head = (osd.head + 1) % osd.samples;
            osd.level += (v - osd.level) * 0.25;
        }
    }

    onShownChanged: {
        if (!shown) {
            ring = new Array(samples).fill(0);
            level = 0;
            return;
        }
        entrance.restart();
    }
    NumberAnimation {
        id: entrance
        target: osd
        property: "appear"
        from: 0
        to: 1
        duration: 400
        easing.type: Easing.OutCubic
    }

    FrameAnimation {
        id: clock
        running: osd.shown
        onTriggered: canvas.requestPaint()
    }

    // Strokes the current path as light: a wide faint halo, a softer one, then
    // the line itself, all adding to what is under them.
    function light(ctx, color, width, alpha) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.lineWidth = width * 7;
        ctx.globalAlpha = 0.06 * alpha;
        ctx.stroke();
        ctx.lineWidth = width * 2.6;
        ctx.globalAlpha = 0.22 * alpha;
        ctx.stroke();
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }

    readonly property string position: theme && theme.config && theme.config.position ? theme.config.position : "bottom-center"
    readonly property real margin: theme && theme.config && theme.config.margin_px !== undefined ? theme.config.margin_px : 24

    Canvas {
        id: canvas
        width: osd.box.width
        height: osd.box.height
        x: osd.position.indexOf("left") >= 0 ? osd.margin
            : osd.position.indexOf("right") >= 0 ? osd.width - width - osd.margin
            : (osd.width - width) / 2
        y: osd.position.indexOf("top") >= 0 ? osd.margin : osd.height - height - osd.margin
        onPaint: {
            const ctx = getContext("2d");
            ctx.reset();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            osd.draw(ctx);
        }
    }
}
