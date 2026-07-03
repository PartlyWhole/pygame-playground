// src/lint.mjs — ruff-wasm auto-lint (spec §3.2 #14). MODULE TEXT is eager (the change
// listener must be armed from first paint); the LIBRARIES are strictly lazy — nothing
// below loads until the first edit (first-paint invariant; test/lint.mjs asserts it).
import { loadScriptTag, loadCssTag } from "./util.mjs";
import { logLine } from "./ui.mjs";

// ---------------------------------------------------------------- auto-lint (lazy, independent of Pyodide)
// ruff-wasm checks Python in its own wasm module — it doesn't use the Pyodide
// interpreter, so it never competes with a running game for the Python runtime
// (and a check is ~2ms). Loaded with the CM lint addon only on the first edit, so
// first paint and running a game stay library-free.
const RUFF_CDN = "https://esm.sh/@astral-sh/ruff-wasm-web@0.15.18";
const CM_LINT_JS = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/lint/lint.min.js";
const CM_LINT_CSS = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/lint/lint.min.css";
const LINT_ERROR = new Set(["invalid-syntax", "F821"]);   // undefined name + syntax = error; other F = warning
let _linter = null;
export function loadLinter() {
  return _linter ??= (async () => {
    await loadCssTag(CM_LINT_CSS);
    await loadScriptTag(CM_LINT_JS);
    const mod = await import(RUFF_CDN);
    await mod.default();                                          // wasm init
    return new mod.Workspace({ lint: { select: ["F"] } });       // F-codes + syntax; no E/W style noise
    // reset -> a later edit retries (do NOT replace with util.importOnce — it caches rejections)
  })().catch((e) => { _linter = null; throw e; });
}
export function lintAnnotations(workspace, text) {
  let diags;
  try { diags = workspace.check(text); } catch { return []; }    // a linter hiccup must never block editing
  return diags.map((d) => ({
    from: CodeMirror.Pos(d.start_location.row - 1, d.start_location.column - 1),   // ruff is 1-based; CM is 0-based
    to: CodeMirror.Pos(d.end_location.row - 1, d.end_location.column - 1),
    message: (d.code ? d.code + ": " : "") + d.message,
    severity: LINT_ERROR.has(d.code) ? "error" : "warning",
  }));
}
let lintArmed = false, lintNoteShown = false;
export function armLint() {
  // window.editor: transitional until src/editor.mjs (next task) — after that this module still reads the same instance through the same seam; Plan 4 converts it to an import.
  const ed = window.editor;
  if (lintArmed) return;
  lintArmed = true;
  loadLinter().then((workspace) => {
    ed.setOption("gutters", ["CodeMirror-linenumbers", "CodeMirror-lint-markers"]);
    ed.setOption("lint", { getAnnotations: (text) => lintAnnotations(workspace, text), delay: 350 });
    ed.performLint();
  }).catch(() => {
    // Re-arm so a later edit retries when the network returns, but only note it once.
    // Two-level retry, deliberately: _linter=null lets loadLinter re-fetch; lintArmed=false
    // lets a later keystroke re-invoke it. Removing either breaks offline recovery.
    lintArmed = false;
    if (!lintNoteShown) { lintNoteShown = true; logLine("Linting unavailable — couldn't load the checker.", "sys"); }
  });
}
