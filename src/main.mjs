// src/main.mjs — the orchestrator (spec §3.2 #19). During the incremental extraction it:
//   1. eagerly imports the extracted modules (pure dependency-free text: one cached fetch
//      each, no network waits — the first-paint invariant, spec §2),
//   2. publishes their window seams / transitional mirrors,
//   3. hands control to the legacy app body still living in index.html (window.__appMain).
// Each extraction moves code out of __appMain into a module imported here. Final shape
// (Plan 4): __appMain is gone and init() owns the boot order outright.
import "./examples-data.mjs";   // self-publishes window.EXAMPLES (+ transitional mirrors)
import "./lessons-data.mjs";    // self-publishes window.LESSONS / window.FRIENDLY_ERRORS (assign-once)
import * as util from "./util.mjs";
import * as ui from "./ui.mjs";
import * as dialogs from "./dialogs.mjs";
import * as lint from "./lint.mjs";

export async function init(host) {
  // host = { pySeam: { get, set } } — the classic script owns the bare `pyodide` binding;
  // src/run.mjs (Plan 4) will publish the booted interpreter through pySeam.set.
  window.__pySeam = host.pySeam;   // transitional handle until run.mjs exists — Plan 4 retires

  // Transitional mirrors: the legacy __appMain body references these bare. Each line is
  // deleted in Plan 4 when the last bare consumer has moved into a module. NONE are pinned except lines marked PINNED.
  Object.assign(window, {
    esc: util.esc, escTab: util.esc,            // escTab was a behavior-identical twin — one impl now
    basename: util.basename, dirname: util.dirname,
    fmtSize: util.fmtSize, cssAttr: util.cssAttr,
    isModuleName: util.isModuleName, isFolderSegment: util.isFolderSegment,
    pickFrom: util.pickFrom, before: util.before,
    consoleEl: ui.consoleEl, statusEl: ui.statusEl, canvasEl: ui.canvasEl,   // transitional
    logLine: ui.logLine, clearConsole: ui.clearConsole,                       // transitional
    setStatus: ui.setStatus,                                                  // PINNED (shell.mjs, examples.mjs bare calls)
    confirmModal: dialogs.confirmModal,   // PINNED (modal.mjs + _harness acceptModal, ~9 suites)
    toast: dialogs.toast,                 // PINNED (modal.mjs)
    closePopMenu: dialogs.closePopMenu,   // transitional (host bare calls); __closePopMenu pinned in-module
    openPopMenu: dialogs.openPopMenu,     // transitional
    rowMenuBtn: dialogs.rowMenuBtn,       // transitional
    inlineInput: dialogs.inlineInput,     // transitional (host wrappers)
    wireInlineEdit: dialogs.wireInlineEdit,   // transitional
    armLint: lint.armLint,                // transitional (host arming hook)
  });

  if (typeof window.__appMain !== "function") throw new Error("__appMain missing — bootstrap order broken");
  await window.__appMain();
}
