// Renders a film theme's dictation popup off screen, over the theme's own
// backdrop render, as Voxtype's OSD would show it: over a second of made-up
// speech, then a still mid-word. Run through tools/osd-preview.
import QtQuick

Window {
    id: win
    width: 2304
    height: 1440
    visible: true
    color: "black"

    // tools/osd-preview passes: theme dir, backdrop png, state, output png.
    readonly property var args: Qt.application.arguments.slice(Qt.application.arguments.indexOf("--") + 1)
    readonly property string themeDir: args[0]
    readonly property string slug: themeDir.split("/").filter(s => s.length).pop()

    // Voxtype's runtime style, as its Omarchy palette reads colors.toml.
    QtObject {
        id: style
        property var config: ({ position: "bottom-center", margin_px: 24, colors: {} })
        function color(role, fallback) {
            const c = config.colors[role];
            return c !== undefined ? c : fallback;
        }
        Component.onCompleted: {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", "file://" + win.themeDir + "/colors.toml", false);
            xhr.send();
            const read = {};
            for (const line of xhr.responseText.split("\n")) {
                const m = /^\s*([a-z0-9_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line);
                if (m) read[m[1]] = m[2];
            }
            config = {
                position: "bottom-center",
                margin_px: 24,
                colors: {
                    accent: read.accent,
                    foreground: read.foreground,
                    background: "#d9" + read.background.slice(1),
                    success: read.color2,
                    warning: read.color3,
                    error: read.color1,
                },
            };
        }
    }

    // Speech: syllables three or four a second under a slower phrase swell.
    QtObject {
        id: audio
        signal frameReceived(real peak, real rms, bool vad, var tsMs)
        property real t: 0
    }
    // A frame for every 10 ms of wall time, however late the timer fires.
    Timer {
        interval: 10
        repeat: true
        running: true
        property real start: Date.now()
        onTriggered: {
            while (audio.t < (Date.now() - start) / 1000) {
                audio.t += 0.01;
                const t = audio.t;
                const syllable = Math.pow(Math.max(0, Math.sin(t * 22.0 + Math.sin(t * 5.3) * 2.0)), 2);
                const phrase = 0.6 + 0.4 * Math.sin(t * 2.1);
                const peak = 0.32 * syllable * phrase * (0.75 + 0.25 * Math.random());
                audio.frameReceived(peak, peak * 0.4, peak > 0.02, Math.round(t * 1000));
                // The still is taken mid-word, a second and more in.
                if (t > 1.3 && peak > 0.2 && !grab.running && !grab.done) grab.start();
            }
        }
    }

    Image {
        anchors.fill: parent
        source: "file://" + win.args[1]
        fillMode: Image.Stretch
    }

    Loader {
        id: film
        anchors.fill: parent
        source: "file://" + win.themeDir + "/voxtype-osd-" + win.slug + ".qml"
        onLoaded: {
            item.theme = style;
            item.audio = audio;
            item.daemonState = win.args[2];
        }
    }

    Timer {
        id: grab
        interval: 30
        property bool done: false
        onTriggered: done = true, win.contentItem.grabToImage(function (result) {
            result.saveToFile(win.args[3]);
            Qt.quit();
        })
    }
}
