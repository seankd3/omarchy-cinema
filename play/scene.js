// What the engine gives a film, worked out from a scene: the one model of it
// outside plugin/main.cpp, which it follows. The playground runs it in the
// browser, and tools/preview.py runs it through quickjs, so neither keeps a
// copy. A plain script (not a module) for both: it defines Scene.
//
// A scene: { time, size: [w, h] in logical px, reserved: [top, right, bottom,
// left], windows: [{ rect: [x, y, w, h], alpha, rounding, lift, depth,
// velocity: [x, y] }], focused: index or -1, focus: the eased rect, or none
// for the focused window's own, focusAlpha, impulses: [{ at: [x, y], age,
// strength, kind, window }], newest last, voice }.
var Scene = (function () {
  const OPEN = 1, CLOSE = 2, LAND = 3, FOCUS = 4;
  const WINDOWS = 256, IMPULSES = 32, RING = 16384;

  // colors.toml's colours, "#rrggbb" as 0 to 1, as main.cpp's readTheme().
  function palette(text) {
    const colors = {};
    for (const line of text.split("\n")) {
      const m = /^\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})"/.exec(line);
      if (m) colors[m[1]] = [0, 2, 4].map(i => parseInt(m[2].slice(i, i + 2), 16) / 255);
    }
    return colors;
  }

  // A quoted number colors.toml gives (glass, frost), its first line's, else
  // `otherwise`.
  function setting(text, name, otherwise) {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*"\\s*([^"\\s]*)\\s*"`, "m").exec(text);
    const v = m && m[1] !== "" ? Number(m[1]) : NaN;
    return Number.isNaN(v) ? otherwise : v;
  }

  // The film's reach, as main.cpp's amountOf() reads it: the last line's, up
  // to five ASCII digits and three after a point, else every point.
  function reach(text) {
    const all = [...text.matchAll(/^\s*reach\s*=\s*"\s*([^"\s]*)\s*"/gm)];
    const v = all.length ? all[all.length - 1][1] : "";
    return /^[0-9]{1,5}(\.[0-9]{0,3})?$/.test(v) ? parseFloat(v) : Infinity;
  }

  // Workspace 1 as Omarchy tiles three windows under the bar: one on the
  // left, two stacked on the right.
  function layout(size, bar, gap) {
    const [w, h] = size, top = bar + gap;
    const left = Math.round((w - 3 * gap) * 0.62), right = gap + left + gap;
    const full = h - top - gap, half = (full - gap) / 2;
    return [[gap, top, left, full], [right, top, w - right - gap, half], [right, top + half + gap, w - right - gap, half]];
  }

  // The four moments tools/preview.py --answers shows: at rest, a window
  // dragged, a window just landed while you speak into the focused one, and a
  // window opening, one closing and focus moving. Each is { name, windows,
  // focused, velocity, voice, impulses: [[x, y, age, strength, kind, window]] }.
  function storyboard(size, bar, gap) {
    const windows = layout(size, bar, gap);
    const [[lx, ly, lw, lh], [rx, ry, rw, rh]] = windows;
    const moved = windows.slice();
    moved[1] = [rx - 260, ry + 90, rw, rh];
    return [
      { name: "rest", windows, focused: 0 },
      { name: "drag", windows: moved, focused: 1, velocity: [[0, 0], [-1800, 600], [0, 0]] },
      { name: "land", windows, focused: 0, voice: 0.7, impulses: [[rx + rw / 2, ry + rh / 2, 0.25, 0.8, LAND, 1]] },
      { name: "open", windows: windows.slice(0, 2), focused: 1, impulses: [[rx + rw / 2, ry + rh * 1.5 + gap, 0.3, 1.0, CLOSE, -1],
        [lx + lw / 2, ly + lh / 2, 0.5, 1.0, OPEN, 0], [rx + rw / 2, ry + rh / 2, 0.15, 0.6, FOCUS, 1]] },
    ];
  }

  // Window i's swell and landing in the last second, windowFlare()'s sums.
  function flare(impulses, i) {
    let swell = 0, landing = 0;
    for (const e of impulses) {
      if (e.window !== i || e.age > 1) continue;
      const rise = Math.min(Math.max(e.age / 0.12, 0), 1);
      if (e.kind === LAND) landing += e.strength * Math.exp(-e.age * 4);
      else if (e.kind !== CLOSE) swell += 0.6 * rise * rise * (3 - 2 * rise) * Math.exp(-e.age * 3.5) * (e.kind === OPEN ? 1 : e.strength);
    }
    return [swell, landing];
  }

  // The Windows block as std140 lays it out: three vec4s a window, then for
  // 32 by 32 tiles of the screen which of windows 0 to 31 reach each.
  function block(scene, far) {
    const texels = new Float32Array(3 * WINDOWS * 4), tiles = new Uint32Array(32 * 32);
    const [W, H] = scene.size;
    const tile = (a, across) => Math.min(Math.max(Math.floor(a / across * 32), 0), 31);
    scene.windows.slice(0, WINDOWS).forEach((s, i) => {
      texels.set([...s.rect, s.alpha, s.rounding, s.lift, s.depth, ...s.velocity, ...flare(scene.impulses, i)], 12 * i);
      if (i >= 32) return;
      const r = far + 0.3 * Math.hypot(...s.velocity), [x, y, w, h] = s.rect;
      for (let ty = tile(y - r, H); ty <= tile(y + h + r, H); ty++)
        for (let tx = tile(x - r, W); tx <= tile(x + w + r, W); tx++) tiles[ty * 32 + tx] |= 1 << i;
    });
    return { texels, tiles };
  }

  // Every uniform a film reads but the textures and spread, by its name in
  // contract.glsl, and the Windows block.
  function uniforms(scene, far) {
    const [W, H] = scene.size, n = scene.windows.length;
    const shown = scene.impulses.slice(-IMPULSES);
    const pad = (rows, empty) => rows.concat(Array(IMPULSES - rows.length).fill(empty));
    const focusedRect = scene.focused >= 0 ? scene.windows[scene.focused].rect : [W * 0.3, H * 0.3, W * 0.4, H * 0.4];
    return {
      values: {
        time: scene.time,
        resolution: scene.size,
        reserved: scene.reserved,
        windowCount: Math.min(n, WINDOWS),
        focusedIndex: scene.focused,
        focused: scene.focus || focusedRect,
        focusAlpha: scene.focusAlpha,
        voice: scene.voice || 0,
        impulseCount: shown.length,
        impulses: pad(shown.map(e => [...e.at, e.age, e.strength]), [0, 0, 0, 0]).flat(),
        impulseKinds: pad(shown.map(e => e.kind), 0),
        impulseWindows: pad(shown.map(e => e.window), -1),
      },
      windows: block(scene, far),
    };
  }

  // How wide Hyprland's blur of `size` and `passes` (film.lua sets the
  // film's frost as its size, with 2 passes) spreads a point: a Gaussian's
  // sigma, in the screen's pixels, within 5% for 2 and 3 passes (its dual
  // Kawase measured).
  function frostWidth(size, passes) {
    return passes > 0 ? 2 ** passes * (0.66 * Math.max(size, 0) + 0.2) : 0;
  }

  // The glass's frost for Hyprland's blur of `size` and `passes` on a screen
  // `pixels` in size, as main.cpp's frost() makes it (plugin/frost.glsl): as
  // wide as Hyprland's own (frostWidth()), without its steps. `read` is the
  // level of Hyprland's blur texture the glass reads it at, which the world
  // is drawn at the size of, at most a quarter, so the frost is at least two
  // of its texels wide; `sizes` are the world's and those of the levels it
  // is halved to; and `steps` are in order, { kernel, from, to, sigma,
  // along } between "world", a level 1, 2, ..., "temp" (the size of the
  // last) and "read" (the level the glass reads). Each step spreads the
  // light by a variance (px²) of its source's texel squared times its own:
  // a halving 1.75, a doubling 0.6875, a Gaussian its width squared, and the
  // world drawn a point a texel (1/12) and the glass's B-spline read (1/3)
  // five twelfths. The world is halved while that leaves room under the
  // frost, and a Gaussian takes the rest.
  function frost(size, passes, pixels) {
    const sigma = frostWidth(size, passes);
    const read = Math.min(Math.max(Math.floor(Math.log2(Math.max(sigma / 2, 1))), 1), 2);
    const sizes = [pixels.map(p => Math.ceil(p / 2 ** read))];
    const texel = size => pixels[0] / size[0];
    let spent = texel(sizes[0]) ** 2 * 5 / 12;
    for (;;) {
      const last = sizes[sizes.length - 1], next = last.map(p => Math.ceil(p / 2));
      const cost = 1.75 * texel(last) ** 2 + 0.6875 * texel(next) ** 2;
      if (Math.min(...next) < 2 || spent + cost > sigma * sigma) break;
      sizes.push(next);
      spent += cost;
    }
    const depth = sizes.length - 1, level = k => (k === 0 ? "world" : k);
    const g = Math.max(Math.sqrt(Math.max(sigma * sigma - spent, 0)) / texel(sizes[depth]), 0.25);
    const steps = [];
    for (let k = 1; k <= depth; k++) steps.push({ kernel: 0, from: level(k - 1), to: k });
    steps.push({ kernel: 1, from: level(depth), to: "temp", sigma: g, along: [1, 0] });
    steps.push({ kernel: 1, from: "temp", to: depth === 0 ? "read" : depth, sigma: g, along: [0, 1] });
    for (let k = depth; k >= 1; k--) steps.push({ kernel: 2, from: k, to: k === 1 ? "read" : k - 1 });
    return { read, sizes, steps };
  }

  // The text a film draws with no agent's turned on: its own backdrop.frag as
  // printable ASCII, runs of anything else as one space, its last characters.
  function words(source) {
    return source.replace(/[^!-~]+/g, " ").trim().slice(-RING);
  }

  return { OPEN, CLOSE, LAND, FOCUS, palette, setting, reach, layout, storyboard, flare, uniforms, frostWidth, frost, words };
})();
