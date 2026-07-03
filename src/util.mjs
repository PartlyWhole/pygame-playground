// src/util.mjs — pure helpers + lazy-load primitives. Zero DOM-state, zero app-state:
// everything here is importable from node except the
// two tag injectors, which touch document only when CALLED.

// HTML-escape for interpolating names into innerHTML (verbatim; was `esc` and its
// behavior-identical twin `escTab` — one implementation now, two window mirrors).
export const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// CSS attribute-selector-safe value (verbatim).
export const cssAttr = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// POSIX-ish path halves (verbatim).
export const basename = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); };
export const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// Human-readable byte size (verbatim).
export const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(0) + ' KB'
  : n < 1073741824 ? (n/1048576).toFixed(1) + ' MB' : (n/1073741824).toFixed(2) + ' GB';

// URL-safe base64 (verbatim). Deliberately NOT modernized to TextEncoder:
// old #project=/#code= share links must keep decoding byte-identically (share-removed.mjs
// hand-produces the legacy encoding), and 2 working lines don't earn churn.
export const b64url = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

// Path-shape validators (verbatim, WITH their explanatory comments — copy those too).
// S2: a code path is a relative POSIX path of identifier segments ending in a
// `.py` leaf (e.g. `main.py`, `sprites/enemy.py`). The regex forbids `..`, leading
// `/`, empty segments and a non-identifier leading digit; the defensive split-check
// rejects `..` segments belonging to odd encodings the regex might admit.
export const isModuleName = (name) =>
  typeof name === "string" &&
  /^([A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(name) &&
  !name.split("/").includes("..");
// A single folder segment: Python-identifier-safe so `import folder.x` works.
export const isFolderSegment = (seg) => /^[A-Za-z_]\w*$/.test(seg);
// An asset path: same path shape as a module but the leaf needn't be an identifier
// stem (`sounds/jump-1.wav` is fine); still relative, no `..`, no leading `/`, no
// empty segment, non-empty leaf.
export const isAssetPath = (path) =>
  typeof path === "string" &&
  /^([^/]+\/)*[^/]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").includes("..") &&
  !path.split("/").includes("");

// Presence helpers (verbatim; collab imports these properly in Plan 4).
export const pickFrom = (a) => a[Math.floor(Math.random() * a.length)];
export const before = (a, b) => a.line < b.line || (a.line === b.line && a.ch <= b.ch);   // a <= b in doc order

// One-shot cached dynamic import — the loadEngine() pattern, shared.
// NO retry-on-failure, which matches loadEngine ONLY. NOTE for Plan 4: loadAutomerge
// caches its module only on SUCCESS, so a failed first click retries on the next click —
// do NOT recompose it on importOnce as-is (add reset-on-rejection or keep its own cache).
// onFirst runs once, awaited, for sentinel side-effects.
const _importCache = new Map();
export function importOnce(url, onFirst) {
  let p = _importCache.get(url);
  if (!p) { p = import(url).then(async (m) => { await onFirst?.(m); return m; }); _importCache.set(url, p); }
  return p;
}

// CDN tag injectors (extracted from loadLinter's inline Promises; lint.mjs re-composes them).
// NOT cached here — callers own caching/retry policy (loadLinter resets on failure).
export const loadScriptTag = (src) => new Promise((res, rej) => {
  const s = document.createElement("script"); s.src = src;
  s.onload = res; s.onerror = () => rej(new Error("script load failed: " + src));
  document.head.appendChild(s);
});
export const loadCssTag = (href) => new Promise((res, rej) => {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
  l.onload = res; l.onerror = () => rej(new Error("css load failed: " + href));
  document.head.appendChild(l);
});
