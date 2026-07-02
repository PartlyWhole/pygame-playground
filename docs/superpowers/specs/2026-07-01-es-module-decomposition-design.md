# ES-Module Decomposition of index.html — Design

> Status: **approved design** (2026-07-01). Supersedes the deferred parts of
> `docs/specs/2026-06-24-index-refactor-proposal.md` (Options A–D analysis); Option D
> (engine extraction) shipped 2026-06-24 and is the wiring precedent this design copies.
>
> Decisions made by the human during brainstorming:
> **full decomposition** into ES modules · **deep cleanup while moving** ·
> **17 fine-grained modules** with a `projectEvents` emitter · all four scope edges IN
> (CSS micro-cleanups, test-debt follow-up, engine watchdog accessors, splitter persistence).
>
> Grounding: a 12-agent survey (7 line-window mappers over the 4,069-line index.html, an
> engine-wiring reader, an exhaustive test-seam inventory over `test/*.mjs` + `verify.mjs`,
> and CodeMirror 5 / Pyodide 0.27.7 API verification against primary sources).

---

## 1. Context & goal

`index.html` is 4,069 lines: all markup, all CSS, and ~3,000 lines of JS in one classic
`<script>`. Everything else about the platform is healthy — engine extracted to
`vendor/engine.mjs`, ~30 headless test batteries, strong seam documentation — but the
monolith is the bottleneck: navigation cost, merge contention, and every feature landing
in the same file.

**Goal:** index.html keeps only markup, CSS, the CodeMirror CDN tags, and a ~30-line
classic bootstrap. All app JS moves to hand-authored ES modules under **`src/`**
(first-party code; `vendor/` stays strictly third-party/generated). Deep cleanup of each
subsystem's internals happens as it moves.

**Non-goals:** no build step (unchanged), no backend (unchanged), no test edits (hard
requirement — every pinned seam keeps working), no behavior changes except those
explicitly scoped in §9.

## 2. Constraints (unchanged invariants)

- **Static GitHub Pages, no build step.** Modules are hand-authored, committed, served
  as-is. All imports resolve via `new URL('./src/x.mjs', document.baseURI)` (project
  subpath; leading-slash paths break on Pages).
- **First-paint lazy invariant.** Boot+run path loads nothing beyond Pyodide/engine.
  Automerge, ruff-wasm, JSZip, jsdiff stay behind their existing lazy gates. Every eager
  `src/*.mjs` must be dependency-free text (no network waits at import time).
- **Bare-name `pyodide` seam.** ~17 suites reach the interpreter by bare name;
  `test/engine-extraction.mjs` asserts the host script stays classic and engine.mjs is
  dynamic-import-only. The host classic script owns `let pyodide` forever.
- **ONE CodeMirror instance; swapDoc-only; zero `setValue`** (spied by tests).
- **`vendor/engine.mjs` does not move.** Its path, export names, and Python namespace
  (`_start/_stop/_pause/_resume/_state/__yield__/...`) are test-pinned. The only change
  allowed is the additive accessors in §9.3.

## 3. Target architecture

### 3.1 The host (what remains in index.html)

- **All markup** — every DOM id is test-pinned, including the two "dead-looking" hacks:
  the hidden legacy `#examples` select (verify.mjs Snake seam) and the `#collabBtn`
  sr-seam (collab suites click it while the panel is hidden). Both stay.
- **All CSS** in the `<style>` block, with the §9.1 micro-cleanups only.
- **CodeMirror 5.65.16 classic CDN `<script>`/`<link>` tags** — the `el.CodeMirror`
  instance-property idiom (~107 test uses) pins CM5-as-classic-global. Modules use
  `window.CodeMirror`, guaranteed loaded before any module executes.
- **A ~30-line classic bootstrap script:**
  1. `let pyodide = null;` — THE bare seam, global-scoped because the script is classic,
     writable, reachable from `page.evaluate`.
  2. A `pySeam` accessor pair `{ get: () => pyodide, set: v => { pyodide = v; } }`
     passed into the modules — the host owns the binding; modules never do.
  3. Cached-promise bootstrap:
     `import(new URL('./src/main.mjs', document.baseURI).href).then(m => m.init(pySeam))`
     — same pattern as `loadEngine`/`loadAutomerge`. **No `<script type=module>` tags.**
  4. A minimal boot-failure fallback: if the import rejects, write `pill error` +
     message to `#status`/`#console` directly (`setStatus` won't exist yet).

### 3.2 Module inventory

| # | Module | ~Lines | Risk | Contents (→ = deep-cleanup change) |
|---|--------|-------|------|--------------------------------------|
| 1 | `src/util.mjs` | 140 | low | pure helpers; → merge duplicate `esc`/`escTab`; shared path parsers; `b64url` via TextEncoder; `idbStore(db,store,keyOpts)` factory (collapses assetStore/historyStore boilerplate); `importOnce(url, sentinel)` + `loadScriptTag`/`loadCssTag` lazy-load helpers (must preserve exact sentinel behavior — `window.__engineLoaded`/`__amLoaded` are pinned) |
| 2 | `src/ui.mjs` | 90 | low | element refs; `logLine`/`clearConsole`; `setStatus` byte-identical (sole `#status` writer, `.pill` class survival); tooltip controller |
| 3 | `src/dialogs.mjs` | 260 | low | `confirmModal`/`closeModal`/focus trap; `toast`; popmenu (reunified — currently split by the modal block wedged between); → shared `inlineEdit(row,{initial,hint,commit})` extracted from the duplicated create/rename machinery; keep the async-commit readOnly-not-disabled trick verbatim |
| 4 | `src/examples-data.mjs` | 400 | low | EXAMPLES map (~370 lines of String.raw Python, ~10% of the file); → derive map + EXAMPLE_FILENAME from one `[{name, filename, source}]` array; export frozen; eager (boot seed needs `EXAMPLES[DEFAULT_EXAMPLE]`) |
| 5 | `src/lessons-data.mjs` | 185 | low | LESSONS + FRIENDLY_ERRORS; assign `window.LESSONS`/`window.FRIENDLY_ERRORS` exactly once at module eval, eagerly (tests replace `window.LESSONS` wholesale — a late re-assign would clobber it) |
| 6 | `src/editor.mjs` | 80 | med | the ONE CodeMirror instance; `cmStash`; `setSaveHandler(fn)` (breaks the Cmd-S forward reference to saveProject); → `showEditorInViewer`/`stashEditor` wrapper-move helpers shared by viewer/examples/lessons (centralizing the move is how the one-instance invariant survives); **NEW required seam:** `window.editor = editor` (explorer-actions.mjs reads bare `editor`) |
| 7 | `src/project.mjs` | 420 | high | model (exact pinned API; `.files` values stay LIVE `CodeMirror.Doc`s), serialize/deserialize co-located, storage keys + legacy `pygame-playground:code` hydration, autosave, `loadInitialProject` precedence `#room` > saved > legacy > default; → `projectEvents` emitter ('load'/'activeChange'/'renamed'/'removed') replaces the four `typeof`-guards + `setActive` pokes; → `folderRename` absorbs the duplicated descendant re-key loop; → `fsUnlinkStale` dedups 3× FS boilerplate |
| 8 | `src/viewer.mjs` | 130 | med | `renderViewer` + type-aware surfaces; `getViewerSel`/`setViewerSel`; → single ext→{kind,mime} table replaces IMG_EXT/AUD_EXT/MIME_FOR/classifyKind triple-encoding |
| 9 | `src/explorer.mjs` | 620 | high | tree/`renderTabs`, delegated click routing, pointer-DnD controller, inline create, row menus, header buttons; → rebuilt on `dialogs.inlineEdit` + `project.folderRename`; → DnD exposes `consumeSuppressedClick()`; one module because tree/DnD/menus/create share `closedFolders`/`selectedFolder`/row-DOM contracts |
| 10 | `src/assets.mjs` | 370 | med | assetStore (via `idbStore`), assetFS (hydrate/add/remove/rename/move), `memfsBytes`, upload routing, storage readout; → rename emits event instead of poking `viewerSel`; durable-first rename invariant (list name == store key == MEMFS path) preserved verbatim |
| 11 | `src/history.mjs` | 220 | med | snapshots (dedup, cap 100), render/diff (jsdiff stays lazy), restore; → room-sync delegated to `collab.replaceProject` **after** collab extracts (verbatim until then); → standardize on `project.text()` |
| 12 | `src/examples-panel.mjs` | 240 | med | legacy `#examples` select + change handler KEPT VERBATIM (verify.mjs seam: option 'Snake', change event loads AND auto-runs); panel render, preview via fresh `CodeMirror.Doc` + swapDoc, promote-on-edit, reset; → `promotedNameFor(key)` dedups triple scan; preview state moves here from explorer's TDZ-dodge block |
| 13 | `src/lessons.mjs` | 290 | med | stepper/phases/progress (localStorage `lessonProgress`); → predict gate registers into `run.registerRunGate` instead of owning `#runBtn`; → `openLessonDoc` collapses three near-duplicates; renderer re-reads `window.LESSONS` at call time (never captures the module binding) |
| 14 | `src/lint.mjs` | 70 | low | ruff-wasm + CM lint addon lazy loaders (module text eager, libraries strictly lazy on first edit); → collapse the two overlapping retry mechanisms; `performLint` becomes a `projectEvents` 'activeChange' subscriber |
| 15 | `src/layout.mjs` | 200 | med | rail view switching with a **view→callback registry** (replaces hard-coded panel refreshes; panels register in main); splitters + drawer merged (shared inline-flex coupling); fullscreen; → §9.4 splitter persistence |
| 16 | `src/save.mjs` | 170 | med | JSZip lazy CDN loader (stays a classic `<script>` injection — `window.JSZip` typeof-undefined-until-used is pinned by 8 suites), `saveProject`, `downloadItem` (**deliberately synchronous** user-gesture chain — do not make async during cleanup or popup blockers eat downloads), `downloadFolder`; → shared clash-prefix helper |
| 17 | `src/collab.mjs` | 500 | high | state + loaders, roomOp/mirrors, enc/dec boundary, reconcile, presence, room lifecycle; → NEW `replaceProject(proj)` (absorbs restoreSnapshot's inline CRDT logic) and `isLive()` (autosave guard); → peer count held in state, not read from DOM; module text eager, Automerge strictly lazy |
| 18 | `src/run.mjs` | 340 | high | PYODIDE_BASE + `loadEngine` (via `importOnce`, `window.__engineLoaded` sentinel), `boot()` publishing the interpreter through the host-injected `pySeam.set`, run-session state, `syncRunControls`, watchdog (`window.__engineDiag`, live `window.__engineStallMs` read), `clearCanvasBlack`, `run()` with → single `settle(kind)` helper, pause/audio, friendly errors, button wiring with → `registerRunGate(fn)`; **NEW required seam:** explicit `window.run` |
| 19 | `src/main.mjs` | 110 | med | `init(pySeam)`: eager static imports of all modules; explicit init order (publish seams → populate `#examples` → `loadInitialProject` → renders); ALL cross-module injection; the four `editor.on('change')` registrations **in one place, in today's effective order** (collab bindEditor guard → promote-on-edit → autosave → armLint) with a comment saying the order is load-bearing |

### 3.3 Dependency rules

- Leaf modules never import upward. `main.mjs` is the only module that imports everything.
- Knots broken by inversion (all wired in `main.mjs`):
  - `project` never imports `collab` — main injects `collab.isLive` as the autosave live-guard.
  - `collab` gets `renderTabs`/`renderViewer` via `init(deps)`; the forward direction
    (explorer → collab `mirrorMove`/`roomOp`) stays a normal import.
  - `run.mjs` owns `#runBtn` and exposes `registerRunGate(fn)`; lessons registers its
    predict gate. Precedence between the never-disabled-while-live policy and the gate is
    decided and documented in `run.mjs`.
  - `layout` exposes a view→callback registry + `isViewVisible(name)`; lessons and panels
    register instead of back-reaching into `activeView`/`sideEl`.
  - `editor.setSaveHandler(fn)` breaks the Cmd-S → saveProject forward reference.
  - `assets` emits a 'renamed' event instead of writing `viewerSel`; `save` imports
    `memfsBytes` from `assets` (never from `run`).
- `projectEvents` (tiny emitter in `project.mjs`: 'load', 'activeChange', 'renamed',
  'removed') replaces the `typeof x !== 'undefined'` order hacks. Explorer,
  examples-panel, lint, and collab subscribe.

## 4. Seam contract (zero test edits)

The contract in one rule: **every seam a test touches must exist and behave identically
once `#status` reads `ready`.** The classes below are the inventory; the Step-0 seam-audit
script (§7.2) encodes it executably so it can't rot:

1. **Bare/classic globals needing explicit residency** (silently `undefined` in modules
   otherwise): `window.run`, `window.tabMenu`, `window.newFilePrompt`,
   `window.renderHistory`, `window.restoreSnapshot`, `window.editor`, `window.setStatus`.
   Handled in Step 0 (§5) before anything moves.
2. **`selectedFolder` — the write seam.** `test/upload.mjs:140` executes
   `selectedFolder = ''` inside `page.evaluate`. A read-only mirror is insufficient; the
   state must physically live at `window.selectedFolder` and every module read it live.
3. **`pyodide`** — host classic script owns it; `run.mjs` publishes via `pySeam.set` only.
4. **Window objects with pinned APIs:** `project` (live `CodeMirror.Doc` values, 17
   suites), `assetFS`, `assetStore`, `historyStore`, `renderTabs`, `confirmModal`,
   `toast`, `openExample`, `renderLessons`, `lessonClose`, `uploadFiles`, `__flushSave`,
   `__closePopMenu`, `EXAMPLES`, `LESSONS`, `FRIENDLY_ERRORS`, `runFile()` getter,
   `__engineDiag`, `__engineLoaded`, `__amLoaded`.
5. **Typeof-undefined-until-used:** `window.JSZip` (8 suites), `window.Diff` (4 suites),
   Automerge/ruff. These stay lazy classic-script/dynamic loads — never module imports.
6. **Exact strings:** `#status` tokens (`ready`/`running`/`finished`/`stopped`/`paused`/
   `error — see console`, compared with `===` in ~28 files, written only via `setStatus`,
   `.pill` class survival); menu labels `Rename`/`Delete`/`Download`; stall-notice regex
   `/hasn't drawn a new frame/`; download filename `pygame-project.zip`.
7. **DOM/selector contracts:** all existing ids; `.tab[data-name]`, `.CodeMirror`,
   `panel-`+view naming, modal/menu roles and `[data-act]`s, DnD affordance classes,
   `.hist-row`, `.remote-cursor`/`.remote-flag`, `.lesson-*`/`.predict-*` classes.
8. **Storage:** `pygame-playground:project` record shape, legacy `pygame-playground:code`
   hydration + single-file mirroring, `lessonProgress`, history/assets IndexedDB behavior.

## 5. Migration plan

**Step 0 — seam hardening, in place (no files move).** One commit inside index.html:
migrate `selectedFolder` to physical `window.selectedFolder` residency at every use; add
explicit `window.*` assignments for the seven §4.1 seams. Add the seam-audit script
(§7.2). Full battery green.

**Steps 1–18 — one module per merge, safest first, app shippable after every step:**

`examples-data` (also converts the host to the `import().then(init)` bootstrap shape) →
`lessons-data` → `util` → `ui` → `dialogs` → `lint` → `editor` → `project` (keystone;
lands `projectEvents`) → `viewer` → `assets` → `explorer` → `history` → `save` →
`examples-panel` → `layout` → `lessons` → `collab` → `run` (last).

**Step 19 — consolidation.** Collapse the transitional import chain into final
`main.mjs`; delete dead host code; audit: grep the host script for anything that isn't
the pyodide seam + bootstrap + failure fallback.

**Transition semantics:** during extraction, cross-module calls go through the pinned
`window.*` seams, so a half-extracted app works at every merge. Two explicit deferrals:
`history` keeps its inline room-sync until `collab` provides `replaceProject`; lessons
reaches `run()` as `window.run` until `run.mjs` extracts.

**Bootstrap timing note:** init moves from parse-time-synchronous to microtask+fetch.
Every suite gates on `#status` 'ready' or selector waits, so this holds — but the eager
module chain must stay pure text (no network waits at import), and the full battery runs
after the Step-1 bootstrap conversion specifically to flush any latent race.

## 6. Deep-cleanup discipline

- **Low/medium-risk modules:** cleanup rides along with the move (the → items in §3.2).
- **`project`, `collab`, `run` (high-risk):** verbatim move first, cleanup as a separate
  commit within the same step — a regression bisects to "the move" or "the cleanup",
  never both. Collab especially: the two-browser suites are the slowest feedback loop;
  move the 500 lines of ordering-sensitive CRDT glue untouched, then clean.
- **Out of bounds, always** (each kept alive by a pinned test): rewording status tokens;
  deleting the hidden `#examples` select, the `#collabBtn` sr-seam, or the legacy
  `pygame-playground:code` migration; renaming menu labels; any `setValue`; eager-loading
  JSZip/jsdiff/Automerge/ruff; changing `vendor/engine.mjs` beyond §9.3; renaming any
  pinned id/class/key.

## 7. Verification (per step, before merge)

1. **Full battery:** every `test/*.mjs` suite + `verify.mjs` green. No test file edited.
2. **Seam audit (new, Step 0):** a small script/battery check that waits for `ready`
   then asserts every §4 seam exists with the right type (and `JSZip`/`Diff`/Automerge
   sentinels are still absent). Catches silent seam loss instantly.
3. **First-paint gates:** `shell.mjs` + `save.mjs` check 5 confirm no eager module drags
   in a lazy library.
4. **For the verbatim-move commits:** byte-diff discipline where feasible (the
   engine-extraction precedent: stripped of the export prefix, moved text diffs empty).

## 8. Error handling

- Host boot-failure fallback (§3.1.4) covers `src/main.mjs` failing to load.
- Module-internal failure behavior is unchanged: lint silently off if ruff can't load;
  collab errors surface via existing `#liveDot`/toast paths; engine status mapping
  (`ok`/`stopped`/`exit`/`error`) untouched; storage-quota warnings unchanged.

## 9. Scope edges (all four IN, per human decision)

1. **CSS micro-cleanups** (in index.html, unpinned): define/fix the undefined `--ok`
   token, merge duplicate `.asset-warn` rules, drop dead `.pill.paused` and
   `.btn:disabled` rules, collapse byte-identical `.lesson-*` duplicates.
2. **Test-debt follow-up:** file a tracked issue listing seams kept alive solely by
   tests — legacy `#examples` select + change handler, `#collabBtn` sr-seam + `.sr-seam`
   CSS, legacy `pygame-playground:code` key, collabStartBtn synthetic-click delegation —
   for a future test-reconciliation pass. No code change in this refactor.
3. **Engine watchdog accessors:** add `engine.frameCount()` / `engine.pausedFlag()` to
   `vendor/engine.mjs` (additive only; no existing export or Python name changes) so the
   watchdog stops `runPython`-probing `_state` internals. Gated by the full battery +
   `engine-extraction.mjs` specifically. Lands with the `run.mjs` step.
4. **Splitter size persistence:** persist pane sizes (localStorage, new key
   `pygame-playground:layout`) in `layout.mjs`. The one intentional behavior change;
   lands with the `layout` step; must not affect any tested default layout.

## 10. Data-format decision

EXAMPLES and LESSONS stay `.mjs` data modules (single cached fetch, no boot waterfall,
no fetch/CORS edge cases on Pages). If non-engineer lesson authoring becomes real, add a
JSON loader then — managing the `window.LESSONS` assign-once contract at that point.

## 11. Risks & mitigations (top)

| Risk | Mitigation |
|------|------------|
| Silent seam loss (bare globals vanish in modules) | Step 0 hardening while single-file; seam-audit script; battery per step |
| `selectedFolder` write seam broken by a mirror | Physical `window` residency; upload.mjs is the gate |
| Bootstrap async race (test evaluates before init) | Suites gate on 'ready'; pure-text eager imports; full battery after Step 1 |
| Cleanup-while-moving regression in project/collab/run | Verbatim-then-cleanup two-commit rule; bisectable |
| First-paint regression via eager import of a lazy lib | shell.mjs + save.mjs check 5 per step; JSZip/Diff typeof asserts |
| One-CodeMirror invariant dies via independent reparenting | Wrapper-move centralized in `editor.mjs` helpers; all callers use them |
| Collab CRDT ordering bug from restructure | Verbatim move; `replaceProject`/`isLive` land as the separate cleanup commit |
| `window.LESSONS` clobber (late re-assign overwrites test's array) | Data modules eager, assign exactly once; renderer re-reads per call |

## 12. Execution notes

- Each step is its own branch → merge, mirroring the repo's existing PR-per-slice flow.
- The implementation plan (writing-plans skill) will expand steps into tasks with the
  exact code moves, per-step battery lists, and the Step-0 seam checklist.
