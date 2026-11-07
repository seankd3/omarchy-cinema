// The contract rendered as a page: each run of // comment lines is prose
// (lines indented past the //'s space stay as written), each run of code is
// code, and each function, struct, uniform and const it declares gets an
// anchor of its name, so the playground's errors and the gallery can link to
// it.

const escape = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const inline = s => escape(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function prose(lines) {
  const out = [];
  let para = [], pre = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    if (pre.length) out.push(`<pre class="keys">${inline(pre.join("\n"))}</pre>`);
    para = []; pre = [];
  };
  for (const line of lines) {
    if (!line.trim()) flush();
    else if (/^ {2,}/.test(line)) { if (para.length) flush(); pre.push(line.slice(2)); }
    else { if (pre.length) flush(); para.push(line.trim()); }
  }
  flush();
  return out.join("");
}

// A top-level line's declared name: the last word before its (, =, ;, [ or {.
const DECLARED = /^(?:layout\([^)]*\)\s*)?(?!precision\b)[^\s#}][^(=;[{]*?\b(\w+)\s*[(=;[{]/;

function code(lines) {
  const ids = lines.map(line => DECLARED.exec(line)?.[1]).filter(Boolean);
  const body = lines.map(escape).join("\n").replace(/^\n+|\n+$/g, "");
  if (!body) return "";
  return [...new Set(ids)].map(id => `<span id="${id}"></span>`).join("") + `<pre class="glsl">${body}</pre>`;
}

export function literate(text) {
  const lines = text.split("\n");
  const version = (/^\/\/ omarchy-cinema contract (\d+)$/.exec(lines[1] || "") || [])[1] || "?";
  const blocks = [];
  let kind = null, run = [];
  const end = () => { if (run.length) blocks.push(kind === "c" ? prose(run) : code(run)); run = []; };
  for (const line of lines.slice(2)) {
    const comment = /^\s*\/\/ ?(.*)$/.exec(line);
    const k = comment ? "c" : "g";
    if (k !== kind) { end(); kind = k; }
    run.push(comment ? comment[1] : line);
  }
  end();
  return { version, html: `<h1>Contract ${version}</h1>` + blocks.join("") };
}
