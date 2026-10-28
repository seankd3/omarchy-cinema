// Draws the current theme's live backdrop, shaped around the open windows.
//
// A theme's backdrop is one fragment shader, backdrop.frag.qsb in the theme
// directory, written against contract.glsl. On every screen it is drawn on a
// click-through layer above the wallpaper and below the windows, and is told
// where that screen's windows are: `windows` holds them as shapes (red any
// window, green the focused one) and `halo` the same blurred, a soft falloff
// that reaches into the gaps between them.
//
// A theme switch writes theme.generation once the new theme is in place, so
// the shader and its palette are both read from the theme at that moment and
// never mix two themes. The shell's own palette arrives later, by IPC, timed to
// the wallpaper's reveal.
//
// Hyprland announces opens, closes and focus but not resizes, split changes or
// a special workspace being shown, so while a theme has a backdrop the window
// and monitor lists are re-read ten times a second. Shapes ease toward each
// new reading, a little behind the windows' own animation.

import QtQuick
import QtQuick.Effects
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Ui

Item {
  id: root

  property var shell: null

  readonly property string current: Quickshell.env("HOME") + "/.local/state/omarchy/current"
  property string generation: ""
  property bool hasBackdrop: false
  // Qt keeps a shader by its URL, so each switch gets a URL of its own.
  readonly property string shaderUrl: hasBackdrop ? "file://" + current + "/theme/backdrop.frag.qsb?" + generation : ""

  property color accent: "#ffffff"
  property color background: "#000000"
  property color foreground: "#ffffff"

  function readPalette(raw) {
    var lines = String(raw).split("\n")
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^\s*(accent|background|foreground)\s*=\s*"(#[0-9a-fA-F]{6})"/)
      if (match) root[match[1]] = match[2]
    }
  }

  FileView {
    path: root.current + "/theme.generation"
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      root.generation = text().trim()
      paletteFile.reload()
      shaderFile.reload()
    }
  }

  FileView {
    id: paletteFile
    path: root.current + "/theme/colors.toml"
    printErrors: false
    onLoaded: root.readPalette(text())
  }

  FileView {
    id: shaderFile
    path: root.current + "/theme/backdrop.frag.qsb"
    printErrors: false
    onLoaded: root.hasBackdrop = true
    onLoadFailed: root.hasBackdrop = false
  }

  Timer {
    interval: 100
    repeat: true
    running: root.hasBackdrop
    onTriggered: {
      Hyprland.refreshMonitors()
      Hyprland.refreshToplevels()
    }
  }

  // Every window on a workspace some monitor shows. Each screen draws the ones
  // that cross it, so a floating window dragged across two screens is on both.
  readonly property var shown: {
    var workspaces = {}
    var monitors = Hyprland.monitors.values
    for (var m = 0; m < monitors.length; m++) {
      if (monitors[m].activeWorkspace) workspaces[monitors[m].activeWorkspace.id] = true
      var ipc = monitors[m].lastIpcObject
      if (ipc && ipc.specialWorkspace && ipc.specialWorkspace.id !== 0) workspaces[ipc.specialWorkspace.id] = true
    }
    var windows = []
    var all = Hyprland.toplevels.values
    for (var i = 0; i < all.length; i++) {
      if (all[i].workspace && workspaces[all[i].workspace.id]) windows.push(all[i])
    }
    return windows
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel

      required property var modelData
      readonly property var monitor: Hyprland.monitorFor(modelData)
      readonly property real originX: monitor ? monitor.x : 0
      readonly property real originY: monitor ? monitor.y : 0
      readonly property bool covered: !!monitor && !!monitor.activeWorkspace && monitor.activeWorkspace.hasFullscreen

      // Where attention is: the focused window if it is on this screen, or the
      // middle of the screen when it is not.
      readonly property var focusRect: {
        var windows = root.shown
        for (var i = 0; i < windows.length; i++) {
          var ipc = windows[i].lastIpcObject
          if (!windows[i].activated || !ipc || !ipc.at || !ipc.size) continue
          var x = ipc.at[0] - originX
          var y = ipc.at[1] - originY
          if (x < width && y < height && x + ipc.size[0] > 0 && y + ipc.size[1] > 0)
            return [x, y, ipc.size[0], ipc.size[1]]
        }
        return [width * 0.35, height * 0.35, width * 0.3, height * 0.3]
      }
      property real focusX: focusRect[0]
      property real focusY: focusRect[1]
      property real focusW: focusRect[2]
      property real focusH: focusRect[3]
      Behavior on focusX { NumberAnimation { duration: Style.duration(320); easing.type: Easing.OutCubic } }
      Behavior on focusY { NumberAnimation { duration: Style.duration(320); easing.type: Easing.OutCubic } }
      Behavior on focusW { NumberAnimation { duration: Style.duration(320); easing.type: Easing.OutCubic } }
      Behavior on focusH { NumberAnimation { duration: Style.duration(320); easing.type: Easing.OutCubic } }

      screen: modelData
      visible: root.hasBackdrop && !remapGuard.remapping
      color: "transparent"
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      mask: Region {}
      WlrLayershell.namespace: "sean-backdrop"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      ScreenMoveRemap {
        id: remapGuard
        window: panel
      }

      // The windows as shapes, at half size: the shader reads them through
      // bilinear filtering, which is all the edge it needs.
      Item {
        id: field
        width: panel.width / 2
        height: panel.height / 2

        Repeater {
          model: ScriptModel { values: root.shown }

          delegate: Rectangle {
            required property var modelData
            readonly property var ipc: modelData.lastIpcObject || ({})
            readonly property bool placed: !!ipc.at && !!ipc.size && !ipc.hidden

            visible: placed
            x: placed ? (ipc.at[0] - panel.originX) / 2 : 0
            y: placed ? (ipc.at[1] - panel.originY) / 2 : 0
            width: placed ? ipc.size[0] / 2 : 0
            height: placed ? ipc.size[1] / 2 : 0
            radius: Style.cornerRadius / 2
            color: modelData.activated ? "#ffff00" : "#ff0000"
            opacity: 0
            Component.onCompleted: opacity = 1

            Behavior on x { NumberAnimation { duration: Style.duration(220); easing.type: Easing.OutCubic } }
            Behavior on y { NumberAnimation { duration: Style.duration(220); easing.type: Easing.OutCubic } }
            Behavior on width { NumberAnimation { duration: Style.duration(220); easing.type: Easing.OutCubic } }
            Behavior on height { NumberAnimation { duration: Style.duration(220); easing.type: Easing.OutCubic } }
            Behavior on opacity { NumberAnimation { duration: Style.duration(400); easing.type: Easing.OutCubic } }
            Behavior on color { ColorAnimation { duration: Style.duration(320) } }
          }
        }
      }

      ShaderEffectSource {
        id: windowsTexture
        sourceItem: field
        hideSource: true
        smooth: true
      }

      // The halo is the shapes blurred at an eighth of the screen's size, so a
      // small blur reaches far.
      MultiEffect {
        id: haloEffect
        width: panel.width / 8
        height: panel.height / 8
        source: windowsTexture
        autoPaddingEnabled: false
        blurEnabled: true
        blur: 1.0
        blurMax: 32
      }

      ShaderEffectSource {
        id: haloTexture
        sourceItem: haloEffect
        hideSource: true
        smooth: true
      }

      ShaderEffect {
        id: backdrop
        anchors.fill: parent
        visible: !panel.covered

        // Seconds, wrapping every hour: see contract.glsl.
        property real time: 0
        property vector2d resolution: Qt.vector2d(width, height)
        property vector4d focus: Qt.vector4d(panel.focusX, panel.focusY, panel.focusW, panel.focusH)
        property color accent: root.accent
        property color background: root.background
        property color foreground: root.foreground
        property var windows: windowsTexture
        property var halo: haloTexture

        fragmentShader: root.shaderUrl
      }

      // Time stands still with animations off; the field still follows the
      // windows, one still frame per change.
      FrameAnimation {
        running: panel.visible && !panel.covered && !Style.reduceMotion
        onTriggered: backdrop.time = (backdrop.time + frameTime) % 3600
      }
    }
  }
}
