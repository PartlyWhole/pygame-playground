// src/editor.mjs — THE one CodeMirror instance (spec §3.2 #6). Invariants owned here:
//   - exactly ONE instance, created once at module eval (page is parsed by then; the
//     classic CodeMirror CDN <script> tags are guaranteed already executed);
//   - file switching is swapDoc-only — editor.setValue is NEVER called (lessons/examples
//     suites spy window.__setValueCalls and assert zero);
//   - moving the instance between panes goes through the two helpers below — two modules
//     independently reparenting the wrapper is how the one-instance invariant dies
//     (spec red-flag §3.2 #7).
// CM5 facts (verified against the v5 manual): per-Doc undo history survives swapDoc; mode
// is per-Doc, so every `new CodeMirror.Doc(src, "python")` must pass the mode.

let _saveHandler = () => {};
// The host (and later src/save.mjs) injects the real save; breaks the old forward
// reference from this keymap to a saveProject defined far later in the legacy body.
export function setSaveHandler(fn) { _saveHandler = fn; }

export const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  mode: "python", theme: "material-darker", lineNumbers: true,
  indentUnit: 4, indentWithTabs: false, viewportMargin: Infinity,
  autoCloseBrackets: true, styleActiveLine: true,
  extraKeys: {
    // ⌘/Ctrl-Enter run shortcut dropped in S1 (no battery depends on it; hint removed).
    "Tab": (cm) => cm.somethingSelected()
      ? cm.indentSelection("add")
      : cm.replaceSelection(" ".repeat(cm.getOption("indentUnit")), "end"),
    "Shift-Tab": (cm) => cm.indentSelection("subtract"),
    "Cmd-]": (cm) => cm.indentSelection("add"),
    "Ctrl-]": (cm) => cm.indentSelection("add"),
    "Cmd-[": (cm) => cm.indentSelection("subtract"),
    "Ctrl-[": (cm) => cm.indentSelection("subtract"),
    "Cmd-/": "toggleComment",
    "Ctrl-/": "toggleComment",
    "Cmd-S": () => { _saveHandler(); },
    "Ctrl-S": () => { _saveHandler(); },
    "Cmd-Backspace": "delGroupBefore",
  },
});

// A hidden, off-screen holder for the ONE CodeMirror element while a non-.py file is shown.
// Moving the wrapper element (never destroying it) keeps the single instance alive (identity
// invariant) AND removes .CodeMirror from #viewerBody so the empty-state assertion holds.
export const cmStash = document.createElement("div");
cmStash.id = "cmStash"; cmStash.style.display = "none";
document.body.appendChild(cmStash);

// The ONLY sanctioned ways to move the instance. Callsites in the legacy body adopt these
// as their subsystems extract (viewer/examples-panel/lessons — Plans 2-3).
export function stashEditor() {
  const w = editor.getWrapperElement();
  if (w.parentElement !== cmStash) cmStash.appendChild(w);
}
export function showEditorIn(hostEl) {
  const w = editor.getWrapperElement();
  if (w.parentElement !== hostEl) hostEl.appendChild(w);
  editor.refresh();
}
