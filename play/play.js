// The playground: a film drawn as the engine draws it, in WebGL2, around
// windows you drag, focus, open and close. The film's own GLSL and the
// engine's (../plugin/*.glsl) compile as written; Scene (scene.js) works out
// what they read. What lives here is only what moves: the windows, the
// world's clock and the fades, as plugin/main.cpp moves them.

const $ = id => document.getElementById(id);
const ENGINE = "../plugin/";
const REPO = "seankd3/omarchy-cinema";
const BAR = 26, BORDER = 2, BAND = 48;
const FOCUS_EASE = 0.32, VELOCITY_EASE = 0.08, IMPULSE_LIFE = 3, FADE = 0.2;
const STIR_RISE = 0.15, STIR_FALL = 0.5, STIR_HOLD = 0.05, STIR_STILL = 0.005;

const text = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); };
const engine = Object.fromEntries(await Promise.all(["contract", "dither", "glass", "main-backdrop", "main-frame"].map(async n => [n, await text(ENGINE + n + ".glsl")])));
const version = /^\/\/ omarchy-cinema contract (\d+)/m.exec(engine.contract)[1];

const canvas = $("desk");
const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
if (!gl) $("status").textContent = "This browser has no WebGL2.";

// ---- Programs

const VERTEX = `#version 300 es
uniform vec2 resolution;
uniform vec4 area;
in vec2 pos;
out vec2 v_px;
out vec2 v_texcoord;
void main() {
    v_px = area.xy + pos * area.zw;
    v_texcoord = pos;
    gl_Position = vec4(v_px.x / resolution.x * 2.0 - 1.0, 1.0 - v_px.y / resolution.y * 2.0, 0.0, 1.0);
}`;

function compile(fragment) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(p, 0, "pos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  // Each uniform's location and type, so a value is set the way its own
  // declaration takes it.
  const at = {}, type = {};
  for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) {
    const u = gl.getActiveUniform(p, i), name = u.name.replace(/\[0\]$/, "");
    at[name] = gl.getUniformLocation(p, name);
    type[name] = u.type;
  }
  const block = gl.getUniformBlockIndex(p, "Windows");
  if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0);
  return { p, at, type };
}

const vec3 = c => `vec3(${c.map(v => v.toFixed(6)).join(", ")})`;

// The glass, as glassShaderSource() adds it to Hyprland's window shader in
// the variant for windows it blurs (its other steps off): the app's pixel
// turned to glass, then the frost under it held to the palette.
function glassSource(colors, glass) {
  const shades = ["background", "dark_background", "darker_background", "lighter_background"].filter(n => colors[n]).map(n => colors[n]);
  const held = glass < 1 && shades.length;
  return `#version 300 es
#define USE_BLUR 1
precision highp float;
in vec2 v_px;
in vec2 v_texcoord;
uniform sampler2D tex;
uniform sampler2D blurredBG;
uniform vec2 resolution;
uniform float alpha;
layout(location = 0) out vec4 fragColor;
` + (held ? `const vec3 CINEMA_BACKGROUNDS[${shades.length}] = vec3[](${shades.map(vec3).join(", ")});
const float CINEMA_GLASS = ${Math.min(Math.max(glass, 0), 1).toFixed(4)};
const vec3 CINEMA_BACKGROUND = ${vec3(colors.background)}, CINEMA_MUTED = ${vec3(colors.muted || [0.5, 0.5, 0.5])};
${engine.dither}${engine.glass}` : "") + `
void main() {
    vec4 pix = texture(tex, v_texcoord);
    vec2 blurUV = vec2(v_px.x / resolution.x, 1.0 - v_px.y / resolution.y);
` + (held ? `    pix = cinemaGlass(pix) * alpha;
    fragColor = cinemaHold(pix, blurUV, 1.0 - pix.a);` : `    pix *= alpha;
    fragColor = pix + texture(blurredBG, blurUV) * (1.0 - pix.a);`) + `
}`;
}

// Hyprland's border, which a frame takes over where it draws.
const RING = `#version 300 es
precision highp float;
in vec2 v_px;
uniform vec4 rect;
uniform vec4 colour;
uniform float width;
layout(location = 0) out vec4 fragColor;
void main() {
    vec2 q = abs(v_px - rect.xy - rect.zw * 0.5) - rect.zw * 0.5;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    fragColor = colour * (d > 0.0 && d <= width ? 1.0 : 0.0);
}`;

// ---- The film

let film = null;   // { base, name, source, colors text, glyphs image }
let programs = null;
let glyphTex = null, feedTex = null, feedCount = 0;

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const ubo = gl.createBuffer();
const ring = compile(RING);

function texture(width, height, internal, format, type, data, filter = gl.LINEAR) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// A theme is a base URL: backdrop.frag, colors.toml and glyphs.png under it.
async function loadFilm(base, name) {
  base = base.endsWith("/") ? base : base + "/";
  $("status").textContent = `Loading ${name || base}…`;
  try {
    const [source, colors] = await Promise.all([text(base + "backdrop.frag"), text(base + "colors.toml")]);
    const glyphs = await new Promise(done => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = base + "glyphs.png";
    });
    film = { base, name: name || base.replace(/\/$/, "").split("/").pop(), source, colors, glyphs };
    $("source").value = source;
    history.replaceState(null, "", "?film=" + encodeURIComponent(base));
    $("share").href = location.href;
    build();
  } catch (e) {
    $("status").textContent = `Could not load ${base}: ${e.message}`;
  }
}

function drop() {
  if (programs) for (const p of [programs.backdrop, programs.frame, programs.glass]) if (p) gl.deleteProgram(p.p);
  programs = null;
}

// Everything that follows from the film's files: its programs, its lettering
// and its own text.
function build() {
  const source = film.source;
  const colors = Scene.palette(film.colors);
  const written = (/^\/\/ omarchy-cinema contract (\d+)\s*$/.exec(source.split("\n")[0]) || [])[1];
  $("log").textContent = "";
  try {
    if (written !== version)
      throw new Error(written ? `This film is written for contract ${written}, and this page draws contract ${version}: update its first line and what changed (contract.html).`
                              : `Its first line must say the contract it is written for: // omarchy-cinema contract ${version}`);
    const head = engine.contract + "\n#line 1\n" + source;
    const next = {
      backdrop: compile(head + engine.dither + engine["main-backdrop"]),
      frame: /\bvec4\s+frame\s*\(/.test(source) ? compile(head + engine["main-frame"]) : null,
      glass: compile(glassSource(colors, Scene.setting(film.colors, "glass", 0.85))),
    };
    drop();
    programs = { ...next, base: film.base };
    $("status").textContent = film.name;
  } catch (e) {
    // An edit that does not compile keeps the last good drawing of this
    // film; another film's never stands in for it.
    if (programs && programs.base !== film.base) drop();
    $("log").textContent = e.message.replace(/\0/g, "").trim();
    $("status").textContent = `${film.name}: does not compile`;
  }
  film.palette = colors;
  film.reach = Scene.reach(film.colors);
  film.frost = Scene.setting(film.colors, "frost", 3);
  if (glyphTex) gl.deleteTexture(glyphTex);
  glyphTex = null;
  if (film.glyphs) {
    const c = new OffscreenCanvas(film.glyphs.width, film.glyphs.height), x = c.getContext("2d");
    x.drawImage(film.glyphs, 0, 0);
    const rgba = x.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = rgba[4 * i + 3];
    glyphTex = texture(c.width, c.height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, a);
  }
  const words = glyphTex ? Scene.words(source) : "";
  feedCount = words.length;
  const chars = new Uint8Array(16384).fill(32);
  for (let i = 0; i < words.length; i++) chars[i] = words.charCodeAt(i);
  if (feedTex) gl.deleteTexture(feedTex);
  feedTex = texture(128, 128, gl.R8, gl.RED, gl.UNSIGNED_BYTE, chars, gl.NEAREST);
  apps.clear();
  stir();
}

// ---- The desktop: windows as Hyprland moves them

let size = [1, 1], scale = 1;
let windows = [];     // { id, rect, alpha, rounding, lift, velocity, moving, at, opened, closed, title }
let order = [];       // ids, bottom to top
let focusedId = null, focus = { from: null, moved: -1e9, alphaFrom: 0, source: null };
let impulses = [];    // { at, start, strength, kind, id }
let clock = { time: 12, speed: 0, clocked: 0, stirred: -1e9 };
let voice = 0, speaking = false, nextId = 1;
const now = () => performance.now() / 1000;

function stir() { clock.stirred = now(); wake(); }
function impulse(w, kind, strength) {
  const [x, y, ww, hh] = w.rect;
  impulses.push({ at: [x + ww / 2, y + hh / 2], start: now(), strength, kind, id: w.id });
  if (impulses.length > 32) impulses.shift();
}

function open(rect, title) {
  const w = { id: nextId++, rect, alpha: 0, rounding: 0, lift: 0, velocity: [0, 0], moving: false, at: rect.slice(0, 2), seen: 0, opened: now(), closed: null, title };
  windows.push(w);
  order.push(w.id);
  impulse(w, Scene.OPEN, 1);
  focusOn(w);
  stir();
}
function close(w) {
  if (w.closed) return;
  w.closed = now();
  impulse(w, Scene.CLOSE, 1);
  const rest = order.filter(id => id !== w.id && !byId(id).closed);
  focusedId = null;
  if (rest.length) focusOn(byId(rest[rest.length - 1]));
  stir();
}
function focusOn(w) {
  if (focusedId === w.id) return;
  focusedId = w.id;
  order = order.filter(id => id !== w.id).concat(w.id);
  impulse(w, Scene.FOCUS, 0.6);
  stir();
}
const byId = id => windows.find(w => w.id === id);

function arrange() {
  const rect = canvas.getBoundingClientRect();
  const next = [Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))];
  scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(next[0] * scale);
  canvas.height = Math.round(next[1] * scale);
  const first = !windows.length;
  size = next;
  if (first) {
    const gap = Math.round(Math.min(...size) * 64 / 1440);
    Scene.layout(size, BAR, gap).forEach((r, i) => open(r, ["Terminal", "Files", "Editor"][i]));
    focusOn(windows[0]);
    impulses = [];
  }
  stir();
}

// One frame of motion: velocities ease toward the move, lift toward focus,
// fades run, a window that stops after moving lands; the clock runs on.
function step(t, dt) {
  let changed = false;
  for (const w of windows) {
    const alpha = w.closed ? Math.max(0, 1 - (t - w.closed) / FADE) : Math.min(1, (t - w.opened) / FADE);
    if (alpha !== w.alpha) changed = true;
    w.alpha = alpha;
    const moving = w.rect[0] !== w.at[0] || w.rect[1] !== w.at[1];
    if (dt > 0 && dt < 0.25) {
      const k = 1 - Math.exp(-dt / VELOCITY_EASE);
      w.velocity = w.velocity.map((v, i) => v + ((w.rect[i] - w.at[i]) / dt - v) * k);
      if (!moving && Math.hypot(...w.velocity) < 1) w.velocity = [0, 0];
      const target = w.id === focusedId ? 1 : 0;
      w.lift += (target - w.lift) * (1 - Math.exp(-dt / (FOCUS_EASE / 3)));
      if (Math.abs(target - w.lift) < 0.002) w.lift = target;
      else changed = true;
    }
    if (w.moving && !moving) impulse(w, Scene.LAND, Math.min(Math.max(Math.hypot(...w.velocity) / 3000, 0.25), 1));
    if (moving || Math.hypot(...w.velocity) > 0) changed = true;
    w.moving = moving;
    w.at = w.rect.slice(0, 2);
  }
  windows = windows.filter(w => !w.closed || w.alpha > 0);
  order = order.filter(id => byId(id));
  impulses = impulses.filter(e => t - e.start <= IMPULSE_LIFE);
  voice += ((speaking ? 0.55 + 0.35 * Math.sin(t * 9) * Math.sin(t * 2.3) : 0) - voice) * Math.min(1, dt * 12);
  if (voice < 0.002) voice = 0;
  if (changed) clock.stirred = t;
  // The world's clock, as main.cpp's advance().
  const run = (target, ease, span) => {
    if (span <= 0) return;
    const k = Math.exp(-span / ease);
    clock.time = (clock.time + target * span + (clock.speed - target) * ease * (1 - k)) % 3600;
    clock.speed = target + (clock.speed - target) * k;
  };
  if (clock.clocked) {
    const turn = Math.min(Math.max(clock.stirred + STIR_HOLD, clock.clocked), t);
    run(1, STIR_RISE, turn - clock.clocked);
    run(0, STIR_FALL, t - turn);
  }
  clock.clocked = t;
  if (clock.speed < STIR_STILL && t - clock.stirred >= STIR_HOLD) clock.speed = 0;
  return changed || clock.speed > 0 || impulses.length > 0 || voice > 0;
}

// The scene as the engine hands it to the film.
function scene(t) {
  const shown = order.map(byId);
  const index = new Map(shown.map((w, i) => [w.id, i]));
  const focused = index.has(focusedId) ? index.get(focusedId) : -1;
  const target = focused >= 0 ? shown[focused].rect : [size[0] * 0.3, size[1] * 0.3, size[0] * 0.4, size[1] * 0.4];
  if (focus.source !== focusedId) {
    focus.from = focus.drawn || target;
    focus.alphaFrom = focus.alpha || 0;
    focus.moved = focus.source === null && !focus.drawn ? t - 1 : t;
    focus.source = focusedId;
  }
  const k = 1 - Math.pow(1 - Math.min(1, (t - focus.moved) / FOCUS_EASE), 3);
  focus.drawn = target.map((v, i) => focus.from[i] + (v - focus.from[i]) * k);
  focus.alpha = focused >= 0 ? shown[focused].alpha : focus.alphaFrom * (1 - k);
  return {
    time: clock.time, size, reserved: [BAR, 0, 0, 0], focused, focus: focus.drawn, focusAlpha: focus.alpha, voice,
    windows: shown.map((w, i) => ({ rect: w.rect, alpha: w.alpha, rounding: w.rounding, lift: w.lift, depth: shown.length - 1 - i, velocity: w.velocity })),
    impulses: impulses.map(e => ({ at: e.at, age: t - e.start, strength: e.strength, kind: e.kind, window: index.has(e.id) ? index.get(e.id) : -1 })),
  };
}

// ---- Drawing

let coarse = null;    // { texture, fb, size, levels, frost, frostTex, frostFb, frostSize }
const apps = new Map();

function targets(target) {
  const c = Scene.coarse(film.frost, [target.width, target.height], scale);
  const key = `${c.size} ${c.levels} ${c.frost}`;
  if (coarse && coarse.key === key) return coarse;
  if (coarse) { gl.deleteTexture(coarse.texture); gl.deleteTexture(coarse.frostTex); gl.deleteFramebuffer(coarse.fb); gl.deleteFramebuffer(coarse.read); gl.deleteFramebuffer(coarse.frostFb); }
  const world = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, world);
  gl.texStorage2D(gl.TEXTURE_2D, c.levels, gl.RGB10_A2, ...c.size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, world, 0);
  // The frost: the coarse world's last level, in 8 bits as Hyprland keeps it.
  const frostSize = c.size.map(p => Math.max(1, p >> (c.levels - 1)));
  const read = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, read);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, world, c.levels - 1);
  const frostTex = texture8(frostSize);
  const frostFb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frostFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, frostTex, 0);
  coarse = { key, texture: world, fb, read, frostTex, frostFb, frostSize, ...c };
  return coarse;
}
const texture8 = ([w, h]) => texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);

// A window's contents: the theme's background, a title and lines of text in
// its foreground and muted colours, as tools/preview.py draws them.
function app(w) {
  const [pw, ph] = [Math.max(1, Math.round(w.rect[2] * scale)), Math.max(1, Math.round(w.rect[3] * scale))];
  const key = `${w.id} ${pw} ${ph}`;
  if (apps.has(key)) return apps.get(key);
  for (const [k, t] of apps) if (k.startsWith(w.id + " ")) { gl.deleteTexture(t); apps.delete(k); }
  const c = new OffscreenCanvas(pw, ph), x = c.getContext("2d");
  const css = n => `rgb(${(film.palette[n] || [1, 1, 1]).map(v => Math.round(v * 255)).join(",")})`;
  x.fillStyle = css("background");
  x.fillRect(0, 0, pw, ph);
  x.scale(scale, scale);
  x.fillStyle = css("foreground");
  x.font = "600 13px ui-monospace, monospace";
  x.fillText(w.title, 18, 26);
  x.fillText("×", w.rect[2] - 24, 26);
  for (let row = 0; row < 6; row++) {
    x.fillStyle = css(row % 3 === 2 ? "muted" : "foreground");
    x.fillRect(18, 48 + row * 30, w.rect[2] * (0.75 - 0.08 * (row % 3)) - 18, 9);
  }
  const t = texture(pw, ph, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  apps.set(key, t);
  return t;
}

const SETTERS = {
  [gl.FLOAT]: "uniform1fv", [gl.FLOAT_VEC2]: "uniform2fv", [gl.FLOAT_VEC3]: "uniform3fv", [gl.FLOAT_VEC4]: "uniform4fv",
  [gl.INT]: "uniform1iv", [gl.SAMPLER_2D]: "uniform1iv",
};
function set(prog, values) {
  for (const [name, v] of Object.entries(values)) {
    if (!prog.at[name]) continue;
    if (prog.type[name] === gl.FLOAT_MAT3) gl.uniformMatrix3fv(prog.at[name], false, v);
    else gl[SETTERS[prog.type[name]]](prog.at[name], [v].flat());
  }
}

function filmProgram(prog, u, area, spread) {
  gl.useProgram(prog.p);
  set(prog, {
    ...u.values, area, spread, feedCount, feedPos: feedCount % 16384,
    accent: film.palette.accent || [1, 1, 1], background: film.palette.background || [1, 1, 1],
    glyphs: 0, feed: 1, drawnWorld: 2, worldProj: [2, 0, 0, 0, -2, 0, -1, 1, 1],
  });
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glyphTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, feedTex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, coarse.texture);
}

const draw = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

function render(t, target = { fb: null, width: canvas.width, height: canvas.height }, bare = false) {
  const u = Scene.uniforms(scene(t), film.reach);
  const all = [0, 0, ...size];
  const c = targets(target);
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  const data = new Uint8Array(16384);
  data.set(new Uint8Array(u.windows.texels.buffer), 0);
  data.set(new Uint8Array(u.windows.tiles.buffer), 12288);
  gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STREAM_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  gl.disable(gl.BLEND);

  // The coarse world, its mipmap down to the frost, and the frost in 8 bits.
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
  gl.viewport(0, 0, ...c.size);
  filmProgram(programs.backdrop, u, all, size[0] / c.size[0]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
  draw();
  gl.bindTexture(gl.TEXTURE_2D, c.texture);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, c.read);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, c.frostFb);
  gl.blitFramebuffer(0, 0, ...c.frostSize, 0, 0, ...c.frostSize, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // The world at the screen's size.
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
  gl.viewport(0, 0, target.width, target.height);
  filmProgram(programs.backdrop, u, all, 0);
  draw();
  if (bare) return;

  // Each window from the bottom: its glass, its border, its frame.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const shown = order.map(byId);
  shown.forEach((w, i) => {
    const r = w.rect, k = w.closed ? 1 - 0.1 * (1 - w.alpha) : 0.85 + 0.15 * Math.min(1, w.alpha);
    const box = [r[0] + r[2] * (1 - k) / 2, r[1] + r[3] * (1 - k) / 2, r[2] * k, r[3] * k];
    glassBox(app(w), box, 0.999 * w.alpha);
    const lit = w.id === focusedId;
    const accent = film.palette.accent || [1, 1, 1];
    gl.useProgram(ring.p);
    set(ring, { resolution: size, area: [r[0] - BORDER, r[1] - BORDER, r[2] + 2 * BORDER, r[3] + 2 * BORDER], rect: r, width: BORDER,
                colour: accent.map(v => v * (lit ? 1 : 0.5) * w.alpha).concat(w.alpha) });
    draw();
    if (programs.frame) {
      filmProgram(programs.frame, u, [r[0] - BAND, r[1] - BAND, r[2] + 2 * BAND, r[3] + 2 * BAND], 0);
      set(programs.frame, { frameWindow: i, frameAlpha: w.alpha, frameBorder: BORDER });
      draw();
    }
  });
  // The bar, on the top layer, frosted from the same frost.
  glassBox(bar(), [0, 0, size[0], BAR], 0.999);
}

let barTex = null, barKey = "";
function bar() {
  const minute = new Date().toTimeString().slice(0, 5), key = `${size} ${scale} ${minute} ${film.base}`;
  if (key === barKey) return barTex;
  if (barTex) gl.deleteTexture(barTex);
  const c = new OffscreenCanvas(Math.round(size[0] * scale), Math.round(BAR * scale)), x = c.getContext("2d");
  const css = n => `rgb(${(film.palette[n] || [1, 1, 1]).map(v => Math.round(v * 255)).join(",")})`;
  x.fillStyle = css("background"); x.fillRect(0, 0, c.width, c.height);
  x.scale(scale, scale);
  x.fillStyle = css("foreground"); x.font = "12px ui-monospace, monospace"; x.textAlign = "center";
  x.fillText(minute, size[0] / 2, 17);
  x.textAlign = "left"; x.fillText("1  2  3", 14, 17);
  barTex = texture(c.width, c.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  barKey = key;
  return barTex;
}

function glassBox(tex, box, alpha) {
  gl.useProgram(programs.glass.p);
  set(programs.glass, { resolution: size, area: box, alpha, tex: 0, blurredBG: 1 });
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coarse.frostTex);
  draw();
}

// Frames only while something moves, as the engine asks for them.
let frameAsked = false, last = 0;
function wake() { if (!frameAsked) { frameAsked = true; requestAnimationFrame(frame); } }
function frame() {
  frameAsked = false;
  if (!film || !programs) return;
  const t = now(), dt = last ? t - last : 0;
  last = t;
  const going = step(t, dt);
  render(t);
  if (going) wake(); else last = 0;
}

// ---- Hands on the desktop

let drag = null;
const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const hit = ([x, y]) => order.map(byId).reverse().find(w => !w.closed && x >= w.rect[0] && x < w.rect[0] + w.rect[2] && y >= w.rect[1] && y < w.rect[1] + w.rect[3]);
canvas.addEventListener("pointerdown", e => {
  const p = at(e), w = hit(p);
  if (!w) return;
  if (p[0] > w.rect[0] + w.rect[2] - 30 && p[1] < w.rect[1] + 30) return close(w);
  focusOn(w);
  drag = { w, from: p, rect: w.rect.slice() };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", e => {
  if (!drag) return;
  const p = at(e);
  drag.w.rect = [drag.rect[0] + p[0] - drag.from[0], drag.rect[1] + p[1] - drag.from[1], drag.rect[2], drag.rect[3]];
  wake();
});
canvas.addEventListener("pointerup", () => { drag = null; wake(); });
$("open").onclick = () => {
  const w = Math.round(size[0] * 0.36), h = Math.round(size[1] * 0.42), n = windows.length;
  open([size[0] * 0.2 + (n * 37) % (size[0] * 0.4), BAR + 40 + (n * 29) % (size[1] * 0.3), w, h], "Window " + nextId);
};
const hold = on => { speaking = on; wake(); };
$("speak").onpointerdown = () => hold(true);
$("speak").onpointerup = $("speak").onpointerleave = () => hold(false);
addEventListener("keydown", e => {
  if (e.target === $("source") || e.target === $("url")) return;
  if (e.key === "v" && !e.repeat) hold(true);
  if (e.key === "n") $("open").click();
});
addEventListener("keyup", e => { if (e.key === "v") hold(false); });
new ResizeObserver(() => { arrange(); }).observe(canvas);

// The film as text: edits compile as you type.
let typing = 0;
$("source").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => { film.source = $("source").value; build(); }, 400);
});
$("save").onclick = () => {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([$("source").value], { type: "text/plain" })), download: "backdrop.frag" });
  a.click();
};
// The empty desktop at this screen's size, for the theme's backgrounds/:
// the world with no windows, drawn into a framebuffer of the screen's pixels.
$("still").onclick = async () => {
  const kept = { order, size, scale, focusedId };
  scale = window.devicePixelRatio || 1;
  size = [screen.width, screen.height];
  order = []; focusedId = null;
  const width = Math.round(size[0] * scale), height = Math.round(size[1] * scale);
  const tex = texture8([width, height]), fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  render(now(), { fb, width, height }, true);
  const pixels = new Uint8ClampedArray(width * height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
  ({ order, size, scale, focusedId } = kept);
  // GL's rows run from the bottom up.
  const rows = new Uint8ClampedArray(pixels.length), line = width * 4;
  for (let y = 0; y < height; y++) rows.set(pixels.subarray((height - 1 - y) * line, (height - y) * line), y * line);
  for (let i = 3; i < rows.length; i += 4) rows[i] = 255;
  const c = new OffscreenCanvas(width, height);
  c.getContext("2d").putImageData(new ImageData(rows, width, height), 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `0-${film.name.replace(/ /g, "-")}.png` }).click();
  wake();
};

// ---- Films: this repo's, the gallery's, or any by URL

function toBase(input) {
  const s = input.trim().replace(/\.git$/, "");
  const gh = /^(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)(\/.*)?)?\/?$/.exec(s) || /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3] || "HEAD"}${gh[4] || ""}/`;
  return s;
}

function entry(list, name, base, image, href) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.onclick = () => { $("url").value = href || base; loadFilm(base, name); };
  if (image) { const img = Object.assign(document.createElement("img"), { src: image, alt: "", loading: "lazy" }); b.append(img); }
  const span = document.createElement("span");
  span.textContent = name;
  b.append(span);
  li.append(b);
  list.append(li);
}

$("load").onsubmit = e => { e.preventDefault(); loadFilm(toBase($("url").value)); };

async function lists() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/themes?ref=main`);
    const dirs = (await r.json()).filter(d => d.type === "dir");
    for (const d of dirs) entry($("films"), d.name.replace(/-/g, " "), `../themes/${d.name}/`, `../themes/${d.name}/preview.png`);
  } catch { $("films").textContent = "GitHub did not answer; load a film by its URL."; }
  try {
    const r = await fetch("https://api.github.com/search/repositories?q=topic:omarchy-cinema&sort=updated&per_page=30");
    const found = (await r.json()).items || [];
    for (const repo of found) {
      const base = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/`;
      entry($("gallery"), repo.full_name, base, base + "preview.png", repo.html_url);
    }
    if (!found.length) $("gallery").textContent = "No films have the topic yet.";
  } catch { $("gallery").textContent = "GitHub did not answer."; }
}

arrange();
lists();
const asked = new URLSearchParams(location.search).get("film");
loadFilm(asked || "../themes/tron-legacy/", asked ? undefined : "tron legacy");
