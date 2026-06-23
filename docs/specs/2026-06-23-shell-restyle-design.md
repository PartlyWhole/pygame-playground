# S1 — Shell Restyle (design only)

> **Slice S1 of the pygame-playground redesign: the SHELL RESTYLE.**
> Design document — **no implementation, no code changes, no commit.** Produced 2026-06-23.
> Drives a later TDD implementation; precision is the point.
>
> **Sources of truth, in priority order:**
> 1. `proto/sandbox.html` — the visual target the team shaped (layout/markup/interaction). Its
>    stage is **visual-only** (canned canvas animation, no engine). We adopt its *chrome*, not its
>    fake engine.
> 2. `proto/shots/*.png` — authoritative final layout = the **vertical icon rail**
>    (`sandbox-rail-full`, `sandbox-rail-history`, `sandbox-rail-tooltip`) + run UI
>    (`run-indicator`, `stage-paused`, `editor-run`, `console-collapsed`). The horizontal-tab shots
>    (`sandbox-2/3/5`) are **superseded** — ignore.
> 3. `docs/specs/2026-06-23-redesign-direction-team.md` — direction; its **Iteration Log**
>    supersedes the "9 points" body.
> 4. `docs/specs/2026-06-23-redesign-architecture-map.md` — **the seam inventory.** Every
>    load-bearing seam must be preserved by this restyle.
> 5. `docs/specs/2026-06-23-redesign-decision-context-map.md` — locked decisions + the three
>    cross-cutting engine landmines: (a) flat MEMFS namespace, (b) the `setValue`/lint-arming trap,
>    (c) lazy-load invariants.
> 6. `docs/design-system/tokens.md` — the token foundation S1 extends.
> 7. `index.html` — the current shell DOM + where the seams physically live.

---

## 0. Orchestrator resolutions (settles §11 — READ FIRST)

The §11 open questions are decided as follows; these are binding for the S1 implementation:

- **Q1 — Folders in S1: option (A) FLAT LIST.** The Explorer renders today's flat file rows (`#tabs`)
  plus the re-homed asset list, distinguished by icon — **no fake folder rows / no visual-only groups.**
  `#newFolderBtn` is present in the header chrome but **hidden** in S1. Real, createable folders + the
  nested tree land in **S2** (honest to the flat model; avoids throwaway folder chrome).
- **Q2 — Start location: EDITOR-PANE HEADER.** Confirmed against `run-indicator.png` + `editor-run.png`
  (the toolbar shots are earlier iterations). Toolbar = title + status pill only. `#runBtn` lives in the
  editor pane header, maps to `run()`.
- **Q3 — Remove the Share BUTTON in S1.** Do the paired deletion (`#shareBtn` markup + its listener,
  together — test-safe, no battery references it) so the toolbar is genuinely minimal. **The legacy
  `#code=`/`#project=` LOAD readers stay** and are removed in **S7** (share-link-load-paths). Do not
  touch the readers in S1.
- **Q4 — Examples in S1: INERT READ-ONLY LIST.** The Examples rail panel shows the example names from
  `EXAMPLES` as a styled, **non-destructive** list (no load-into-editor, no `setValue`, no `change`
  handler at boot). Full editable promote-on-edit + reset + per-file undo = **S4**. (A temporary
  loss of "load an example" between S1 and S4 is acceptable on this review branch.)
- **Q5 — `id="saveBtn"` on the Explorer download control.** One element (the download icon) carries
  `id="saveBtn"` so `save.mjs` check 1 passes and Cmd-S still calls `saveProject`. Save stays the
  existing 2-branch behavior in S1 (always-zip is **S5**).
- **Q6 — Keyboard shortcut: remove the HINT in S1 always.** Then **grep the batteries for an
  Enter→`run()` press**; if none, **remove the ⌘/Ctrl-Enter binding in S1** (CM `extraKeys`). If a
  battery depends on it, keep the binding for now (remove only the hint) and drop the binding in S3.
- **Risk 7 — Assets:** keep `#assetInput`, `#assetChip`, `#assetPanel`, `.asset-row[data-name]`,
  `.asset-warn`, `.asset-remove`, and the click-not-close rule; **re-home them into the Explorer**, do
  NOT redesign the asset model in S1 (that rides S2).
- **Risk 8 — Canvas:** do **not** adopt the proto's `fitCanvas()`; the SDL-bound `#canvas` stays
  640×480 and scales via CSS only.
- **Risk 9 — One CM:** keep the single CodeMirror instance alive across viewer type-switches (hide/show,
  never destroy/recreate; never `editor.setValue`); covered by test §10.1 #6.

---

## 1. Scope & non-goals

### 1.1 What S1 IS

S1 re-skins the **shell chrome** of `index.html` to match `proto/sandbox.html`, and wires the
four side-panel views' container — **without changing the engine, the persistence formats, the
collab CRDT, or any test-observable behavior of the running program.** It is a *visual shell* that
later slices (S2/S3/S4/S6) fill in with deep features.

S1 delivers, all re-skinned around the existing engine:

1. **Vertical activity rail** (far left): 4 icon-only views — Explorer · History · Examples ·
   Collaboration — with one shared hover tooltip; clicking the open view's icon collapses the panel
   (rail stays). Replaces the current toolbar buttons that opened popovers.
2. **Minimal top toolbar:** title + status pill only. The keyboard hint is removed (the run
   shortcut was dropped — decision-context-map `keyboard-shortcut`). `.protoTag`-style header text,
   if any, hides below 1000px (preserving the existing single breakpoint).
3. **Explorer panel** that lists **today's existing files + assets** reorganized into the new tree
   chrome — the explorer is now **always-on** (VS-Code style), replacing the `#tabs` strip. Real
   folders are **S2**; S1 shows the flat project + assets in the new tree styling.
4. **Type-aware viewer** in the editor pane: `.py` → the single CodeMirror editor; image → image
   viewer; audio → player (with the MP3 "plays here but not in pygame" warning); other → "unable to
   open." (The spike-viewer classifier is the basis; viewer is proven by `test/spike-viewer.mjs`.)
5. **`▶ Start` control** in the editor pane header that **maps onto the existing `#runBtn`
   behavior** (today's `run()`), restyled. The status pill reflects existing `#status` tokens.
6. **Four resizable panes** (explorer, editor/viewer, game stage, console) via splitters; **console
   keeps its collapse**; editor + game stage are **not** collapsible (resize only); **fullscreen ⛶
   toggle on editor, game stage, AND console** headers.
7. **History / Examples / Collaboration** content re-homed into rail panels (placement/restyle
   only — they reuse all existing seams: `historyStore`, `EXAMPLES`, collab entry points).
8. **Design tokens** for the new components added to `tokens.md` (semantic aliases over the raws),
   one component group at a time.

### 1.2 Explicit non-goals (what defers, and to which slice)

S1 deliberately stops at *chrome*. The following are **out of scope** and must be designed to *not*
require engine changes in S1:

| Deferred capability | Slice | Why it's not S1 |
|---|---|---|
| **Real folders / true subdirectories / Python packages** (`sprites/ship.png`, `__init__.py`, dotted imports) | **S2** | Largest engine spike (package-aware finder, nested asset bridge, `mkdirTree`, 3 persistence formats). S1 keeps the **flat MEMFS namespace** unchanged; the tree renders the flat file list with new chrome. *Folder rows that appear in the proto are S1-visual-only stand-ins OR are simply omitted from S1 — see §2.4.* |
| **Split run model** — stage `⏸ Pause ⇄ ▶ Resume` + `✕ End`, the `'paused'` status token, the `▶ running: <file>` badge | **S3** | Pause needs the `__yield__` `asyncio.Event` gate (a pre-build spike). S1 ships `▶ Start` mapped to today's `run()` and keeps `■ Stop` as a click target; the stage header reserves *layout space + DOM hooks* for Pause/End/badge but they are inert (or hidden) in S1. The `'paused'` pill state is a **styled placeholder only** — never emitted by `setStatus` in S1. |
| **Examples-as-editable-files** — promote-on-edit, per-file undo, reset-to-default | **S4** | Needs Doc-adoption (`project.add`/`swapDoc`, never `setValue` — landmine b). S1's Examples panel re-homes the existing `EXAMPLES` data into the rail as a **read-only list / current-behavior trigger**; it does **not** change the destructive `change`-handler semantics. (Exact S1 Examples interaction = open question Q4.) |
| **Multi-file collaboration room** (per-file CRDT, per-file presence) | **S6** | CRDT today is `{code:string}` single-file. S1 re-homes the collab UI into the rail panel and keeps the existing single-file room behavior + lazy Automerge. |
| **Always-zip download** / per-item bare download | later | Save's branch logic + `save.mjs` assertions are untouched by S1. The Explorer header *shows* upload/download icons (per proto), but in S1 download maps to the **existing** `saveProject` (2-branch) and upload maps to the **existing** `#assetInput`. No `save.mjs` assertion changes in S1. |
| **`#shareBtn` removal** | later (paired) | `#shareBtn` markup + its listener must be removed *together* (else boot throws). S1 *can* perform this paired removal cleanly since no battery references `#shareBtn` — **but it is optional for S1** and is called out as open question Q3. If S1 does it, it's a pure deletion, not a restyle. |
| **Drag-and-drop reorder / move-into-folder** in the explorer | **S2** | Proto has full DnD; S1 ships the tree *chrome* (rows, icons, selection) without the model-mutating DnD. |
| **Upload routing by extension, name-collision policy** | later | S1 keeps the existing upload path (`#assetInput` → `assetFS.add`); `.py`-vs-asset routing is later. |

**Bounding principle:** if a proto feature requires touching `_run_project`, `_ProjectFinder`,
`isModuleName`, the CRDT shape, the save branches, or any persistence/share format, it is **not
S1**. S1 changes DOM + CSS + the JS that *renders/wires the shell*, and nothing the engine reads.

---

## 2. New shell DOM structure (markup) + seam preservation

The current shell (`index.html` 151–180) is a flat `<header>` toolbar + a two-pane `<main>`. S1
replaces it with the proto's rail + side panel + right stack, **carrying every load-bearing seam
forward.** Below is the target structure, annotated per seam.

### 2.1 Target DOM skeleton

```html
<body>  <!-- column flex, unchanged -->

  <!-- ===== TOOLBAR (minimal) ===== -->
  <header class="toolbar">
    <h1 class="title">🐍 pygame <span>playground</span></h1>
    <span class="spacer"></span>
    <span id="status" class="pill" role="status" aria-live="polite">starting…</span>
    <span class="hint">…optional header hint…</span>      <!-- hidden < 1000px -->
  </header>

  <!-- ===== MAIN: rail + side + right stack ===== -->
  <main class="main">

    <!-- vertical activity rail -->
    <nav class="rail" role="tablist" aria-label="Panels" aria-orientation="vertical">
      <button class="acttab active" data-view="explorer" role="tab" aria-selected="true"
              aria-controls="panel-explorer" id="tab-explorer"
              aria-label="Explorer" data-tip="Explorer" data-tip-side="right">…svg…</button>
      <button class="acttab" data-view="history"  role="tab" aria-selected="false"
              aria-controls="panel-history"  id="tab-history"  …>…</button>
      <button class="acttab" data-view="examples" role="tab" aria-selected="false"
              aria-controls="panel-examples" id="tab-examples" …>…</button>
      <button class="acttab" data-view="collab"   role="tab" aria-selected="false"
              aria-controls="panel-collab"   id="tab-collab"   …>…</button>
    </nav>

    <!-- side panel (one section per view; only the active one is visible) -->
    <aside class="side" id="side" aria-label="Side panel">

      <!-- EXPLORER — replaces #tabs; always-on -->
      <section class="panelview" id="panel-explorer" data-panel="explorer"
               role="tabpanel" aria-labelledby="tab-explorer">
        <div class="side-head">
          <span>Explorer</span>
          <div class="acts">
            <button class="ghost" id="uploadBtn"   data-tip="Upload files">…</button>
            <button class="ghost" id="downloadBtn" data-tip="Download project .zip">…</button>
            <button class="ghost" id="newFileBtn"  data-tip="New file">…</button>
            <!-- newFolderBtn: present visually but inert/hidden in S1 (folders = S2) -->
          </div>
        </div>
        <div class="side-body">
          <div class="tree" id="tabs"></div>          <!-- ⚠ keeps id="tabs" — see §2.3 -->
        </div>
        <input id="assetInput" type="file" multiple hidden>   <!-- REAL hidden input -->
        <div class="storage" id="apStorage"><!-- navigator.storage.estimate readout --></div>
      </section>

      <!-- HISTORY -->
      <section class="panelview" id="panel-history" data-panel="history"
               role="tabpanel" aria-labelledby="tab-history" hidden>
        <div class="side-head"><span>Run snapshots</span></div>
        <div class="side-body" id="historyPanel"><!-- .hist-rows + #histDiff --></div>
      </section>

      <!-- EXAMPLES -->
      <section class="panelview" id="panel-examples" data-panel="examples"
               role="tabpanel" aria-labelledby="tab-examples" hidden>
        <div class="side-head"><span>Examples</span></div>
        <div class="side-body" id="examplesPanel"><!-- list from EXAMPLES --></div>
      </section>

      <!-- COLLABORATION -->
      <section class="panelview" id="panel-collab" data-panel="collab"
               role="tabpanel" aria-labelledby="tab-collab" hidden>
        <div class="side-head"><span>Collaboration</span></div>
        <div class="side-body" id="collabPanel">
          <button id="collabBtn">👥 Collaborate</button>
          <span id="liveDot" hidden>● <span id="peerCount">1</span></span>
        </div>
      </section>
    </aside>

    <div class="split" data-split="side"></div>

    <!-- RIGHT STACK -->
    <div class="stack">
      <div class="toprow" id="toprow">

        <!-- VIEWER (editor pane) -->
        <div class="viewer" id="editorPane">
          <div class="pane-head">
            <span class="name" id="vName">main.py</span>
            <span id="vMeta">· Python · entry point</span>
            <span class="spacer"></span>
            <button id="runBtn" class="btn primary">▶ Start</button>   <!-- maps to run() -->
            <button class="chev-btn" id="viewerFs" aria-label="Fullscreen editor"
                    data-tip="Fullscreen editor">⛶</button>
          </div>
          <div class="vbody" id="viewerBody">
            <textarea id="code"></textarea>      <!-- CM mounts here for .py -->
          </div>
        </div>

        <div class="split" data-split="viewer" id="splitter"></div>   <!-- keep id=splitter? see §6 -->

        <!-- GAME STAGE -->
        <div class="stage" id="rightPane">         <!-- note: id reconciliation, §2.3 -->
          <div class="pane-head">
            <span class="name">🎮 Game stage</span>
            <button id="stageHint" class="stage-hint" type="button">press start to run</button>
            <span class="spacer"></span>
            <!-- S3 reserves: pauseBtn + endBtn here (hidden/inert in S1) -->
            <button id="stopBtn" class="btn stop" hidden>■ Stop</button>  <!-- kept as click target -->
            <button class="chev-btn" id="fsBtn" aria-label="Fullscreen game stage"
                    data-tip="Fullscreen game stage">⛶</button>
          </div>
          <div class="stagewrap" id="stage">
            <canvas id="canvas" width="640" height="480" tabindex="0"></canvas>
          </div>
        </div>
      </div>

      <div class="split h" data-split="console" id="vsplit"></div>   <!-- keep id=vsplit? see §6 -->

      <!-- CONSOLE DRAWER (keeps collapse) -->
      <div class="drawer" id="drawer">
        <div class="drawer-head">
          <button class="chev-btn" id="drawerCollapse" aria-expanded="true"
                  aria-controls="console" data-tip="Collapse console">▾</button>
          <span class="lbl">Console</span>
          <span class="errbadge" id="errBadge" hidden></span>
          <button class="chev-btn fs-end" id="consoleFs" aria-label="Fullscreen console"
                  data-tip="Fullscreen console">⛶</button>
        </div>
        <div class="console" id="console"></div>
      </div>
    </div>
  </main>

  <div id="dropOverlay">Drop files to add them as assets</div>   <!-- kept, drop-anywhere -->

  <!-- existing CM scripts + the big <script> follow, mostly unchanged -->
</body>
```

### 2.2 Load-bearing seam map (preserve / relocate)

Every entry below is from the architecture-map seam inventory. **"Preserved"** = same id/selector,
relocated in the DOM only. **"Relocated"** = lives in a new container but keeps its exact
test-observable contract.

#### DOM seams

| Seam | S1 disposition | Notes / risk |
|---|---|---|
| **`#status`** + tokens (`starting…`, `loading Python…`, `loading pygame…`, `ready`, `running`, `finished`, `error — see console`, `stopped`, `boot failed`) | **Preserved**, moved into `.toolbar`. `setStatus(cls,text)` (1024) stays the **only** writer. `className` still drives color via the new `.pill` + status classes. | Do **not** reword any token. `'paused'` is **not** added in S1. Add `role="status" aria-live="polite"` (additive). |
| **`#runBtn`** → `run()` (1845) | **Preserved as click target**, relabeled `▶ Start`, restyled `.btn.primary`, **relocated** to the editor pane header. ~26 direct `page.click('#runBtn')` sites keep working. | Keeping the id is the decision-context-map `start-stop-ids` verdict: keep both ids behind the chrome → zero lockstep churn. |
| **`#stopBtn`** → `_stop()` (1846–1848) | **Preserved as click target.** In S1 it is **kept in the DOM but visually hidden** (or styled minimally on the stage header). Its listener stays. | `spike-runstop.mjs` proves one control can block re-run; that engine path is untouched. The full Pause/End UI is S3 — S1 just must not remove `#stopBtn`. |
| **`#saveBtn`** → `saveProject` (1684); `save.mjs` check 1 asserts it exists | **Preserved.** Re-homed as the Explorer header **download** affordance (`#downloadBtn`), **but `#saveBtn` id must still exist** for `save.mjs` check 1. Either keep `id="saveBtn"` on the download button, or keep a hidden `#saveBtn` and have `#downloadBtn` delegate to it. | Decision: **put `id="saveBtn"` on `#downloadBtn`** (one element, the proto's download icon) OR keep both — see open question Q5. Cmd-S still calls `saveProject`. |
| **`#canvas`** (640×480, `tabindex=0`) | **Preserved**, moved into `.stagewrap` inside the stage pane. `toDataURL`/`getImageData`/SDL binding unchanged; Stop still leaves last frame. | Canvas keeps fixed 640×480 attributes; CSS `max-width/height:100%` lets it scale visually. Do **not** adopt the proto's `fitCanvas()` resize-to-container (that's a visual-only behavior of the fake engine; the real canvas is SDL-bound at 640×480). |
| **`#console`** (`<div>` lines `out`/`err`/`sys`, survives Stop, cleared on Run) | **Preserved**, moved into the console drawer. `clearConsole`/`logLine` writers unchanged. | Console keeps its **collapse** (drawer). |
| **console collapse** | **New chrome, same intent.** Drawer-head `▾`/`▸` toggles `.drawer.collapsed`. | New seam (no test gates console-collapse yet); S1 adds it. |
| **`#assetInput`** REAL hidden `<input type=file multiple>`; `setInputFiles` path; click must NOT close `#assetPanel` | **Preserved as a real hidden input**, moved into the Explorer section. | `assets.mjs` does `page.setInputFiles('#assetInput', …)` (lines 25/70/101/121/140) and asserts a click from it does not close the asset panel (161–163). Keep id + the not-close rule. See `#assetPanel` below. |
| **`#assetChip`** / **`#assetPanel`** / **`#apStorage`** / `.asset-row[data-name]` / `.asset-warn` / `.asset-remove` / `.ap-browse` / `.ap-clear` | **Reconcile (§7.3).** In the new IA, assets live *in the Explorer tree*, not a popover. But `assets.mjs` heavily gates on `#assetChip` text, `#assetPanel` toggle, and `.asset-row` selectors. **S1 keeps `#assetPanel` + `#assetChip` + the row selectors alive** (the panel can be re-homed as the Explorer's asset section or kept as a hidden compatibility container that mirrors the tree) — **OR** `assets.mjs` is updated in lockstep. **Recommended S1: keep `renderAssetPanel` rendering `.asset-row[data-name]` inside the Explorer**, keep `#assetChip` (can be a storage-summary element), keep `#assetInput`. | This is the **biggest reconciliation in S1.** See §7.3 for the exact assertion list. |
| **`#tabs` + `.tab[data-name]`** (class `active`/`entry`) + `window.renderTabs` | **Relocated → the Explorer tree, but the SEAM IS PRESERVED.** The container keeps **`id="tabs"`**; `renderTabs()` re-renders **per-file rows** that carry `data-name`, `.active`, `.entry` — now styled as tree rows, not a horizontal strip. `window.renderTabs` stays a zero-arg hook. | The single hard conflict: `multifile.mjs:264–269` asserts the tab strip is **absent** in single-file mode. The new explorer is **always-on**. **This assertion must be updated in lockstep** (§7.2). All other tab assertions (render both files, click-to-switch by `data-name`, `.entry` badge) keep passing if rows keep `data-name`/`.active`/`.entry` and remain clickable. `lint.mjs:71` (`#tabs .tab[data-name="good.py"]` click) likewise keeps passing. |
| **`.CodeMirror`** — ONE live instance; identity invariant; `getOption('lint')` falsy before first edit | **Preserved.** Exactly one CM, mounted in the viewer's `.vbody` for `.py`. The type-aware viewer **swaps the viewer body content** for non-`.py` types but **must not destroy/recreate the CM instance** when returning to `.py` — keep CM persistent (hidden) or re-`swapDoc` into the same instance. | **Landmine (b):** the viewer must never call `editor.setValue` to show a file — use `swapDoc`/`project.setActive`. Showing an image/audio must not arm lint. Keep the editor created with **no `gutters`** at first paint. |
| **`#historyBtn`/`#historyPanel`** + `.hist-rows`/`.hist-row[data-id]`/`.hp-diffbody`/`.hp-restore`/`.hp-clear` | **Relocated → History rail panel.** `#historyPanel` keeps its id (now the panel body); rows keep all selectors. `#historyBtn` is replaced by the rail's History `.acttab` — **but tests that `page.click('#historyBtn')` then wait for `#historyPanel .hist-row` must be reconciled** (§7.3). | History is "placement/restyle only" (brief item 7). jsdiff stays lazy. |
| **`#examples` `<select>`** (6 EXAMPLES keys; user-action only; NEVER at boot) | **Relocated → Examples rail panel** as a list. In S1 the list reproduces today's *load-an-example* behavior (still user-initiated, still never at boot). | Full editable-examples = S4. The `change`-at-boot first-paint invariant must hold. |
| **`#collabBtn`** (`👥 Collaborate` → `🔗 Copy room link`) + **`#liveDot`/`#peerCount`** | **Relocated → Collaboration rail panel.** Ids preserved; lazy-loads Automerge on click as today. | `#shareBtn` removal is optional/paired (Q3). |
| `.remote-cursor`/`.remote-flag` + CM selection span | **Preserved** (collab internals untouched). | — |
| `#dropOverlay` (`.show`) | **Preserved**, drop-anywhere kept. | Gated on `dataTransfer.types` includes `Files`. |
| `.CodeMirror-lint-marker*` + gutter id `CodeMirror-lint-markers` (added only after first edit) | **Preserved** — first-paint laziness intact. | Viewer type-switching must not trigger it. |

#### window globals (all preserved verbatim)

`window.project` (full method surface), `window.renderTabs` (now renders explorer rows),
`window.__flushSave`, `window.historyStore`, `window.renderAssetPanel`, `window.__audioContexts`,
`window.__amLoaded` (falsy on solo), `window.JSZip` (unset until first zip), `pyodide`, module-local
`runTask`. **None move; none change shape.**

#### python globals (untouched)

`_stop()`, `_state['task']`, `_state['via_project']`, `_start`/`_start_project`, status-token
protocol, `pyodide.FS.unlink`. **S1 does not touch any Python.**

#### Lazy-load invariants (landmine c) — explicitly preserved

At **first paint**, S1 loads **zero** of: Automerge (`./vendor/automerge` + `wss://sync.automerge.org`),
ruff-wasm (`esm.sh`), CM lint addon (cdnjs), JSZip (cdnjs), jsdiff (cdnjs). The restyle adds **no**
new network at boot. Specifically:
- The rail/explorer/viewer render from existing in-memory data — **no import** triggers a loader.
- Switching to the **History** rail panel must **not** eagerly load jsdiff (jsdiff loads only on
  `showDiff`, as today).
- Switching to the **Collaboration** rail panel must **not** load Automerge (loads only on
  `#collabBtn` click / `#room=`).
- Switching to the **Examples** rail panel must **not** fire the example `change` handler at boot.
- Mounting the type-aware viewer for the default `.py` must **not** call `editor.setValue` (use the
  existing bootstrap `swapDoc` path) — so lint stays unarmed at first paint.

### 2.3 Id reconciliation (important)

The proto renamed several containers. To minimize lockstep test churn, **S1 keeps the *engine-seam*
ids from `index.html`, applying the proto's *classes* for styling.** Concretely:

| Proto id/class | `index.html` id (KEEP) | S1 element |
|---|---|---|
| `.tree #tree` | **`#tabs`** | Explorer tree container = `<div class="tree" id="tabs">`. `renderTabs` renders into it. |
| `#viewerPane` / `.viewer` | **`#editorPane`** | `<div class="viewer" id="editorPane">`. |
| `#stagePane` / `.stage` | **`#rightPane`** (pane) + **`#stage`** (wrap) | The stage *pane* gets the chrome; `#stage` stays the canvas wrapper that SDL/`#fsBtn` logic expects. Reconcile carefully: today `#stage` wraps `#canvas`+`#fsBtn`. |
| `#stageCanvas` | **`#canvas`** | Keep `#canvas` (SDL-bound, test-gated). |
| `#consoleSplit`/`#viewerSplit`/`data-split=side` | `#splitter` (col), `#vsplit` (row) | Keep `#splitter` + `#vsplit` ids if any test/spec references them; add the side splitter as new. (No battery references `#splitter`/`#vsplit` by id — verified — so these *may* be renamed, but keeping them is free.) |
| `#startCollab`/`#copyLink`/`#leaveRoom` (proto collab) | `#collabBtn` | Use the real `#collabBtn` engine entry point, not the proto's mock. |

**Rule:** where the proto's prettier id and a load-bearing `index.html` id collide, **the
`index.html` id wins** (it's the test/engine seam); the proto's *visual treatment* is applied via
class. This keeps ~50 `#runBtn`/`#stopBtn`/`#canvas`/`#console`/`#tabs` test sites green.

### 2.4 Folders in S1 (flat model)

Real folders are **S2**. The proto's seed tree shows `sprites/` and `sounds/` folders. For S1, the
Explorer renders the **flat** project + assets (no real subdir paths — MEMFS stays flat). Two
options for S1 visuals (open question Q1):
- **(A) Flat list, no folder rows** — simplest, honest to the flat model. Files + assets shown as a
  flat sorted list with the new row chrome.
- **(B) Visual-only grouping** — group by type (e.g. a "Code" group and an "Assets" group) using
  the folder-row *chrome* but with **no model paths and no drag-into** — purely a static visual
  header. This matches the proto's look without implying real isolation.

**Recommendation: (B) visual-only type groups**, clearly *not* implying MEMFS isolation (landmine
a: organizational folders do not create real isolation). Real, createable, draggable folders land
in S2. `#newFolderBtn` is present in the header chrome but **inert/hidden** in S1.

---

## 3. The vertical activity rail

Far-left `<nav class="rail" role="tablist" aria-orientation="vertical">`, 48px wide, dark
(`#181a21`-family). Four icon-only `.acttab` buttons (38×38), stroke-SVG icons, in order:
**Explorer · History · Examples · Collaboration**.

### 3.1 Behavior

- **Switch:** clicking a non-active icon shows that view's `.panelview` (others `hidden`), expands
  the side panel if collapsed, sets the icon `active`.
- **Click-collapse:** clicking the **already-open** view's icon **collapses the side panel** (adds
  `.side.collapsed`, hides the side splitter) — **the rail itself stays visible.** Re-clicking any
  icon re-opens.
- Exactly one `.acttab.active` at a time when expanded; **none** active when collapsed.

### 3.2 States

| State | Visual | Tokens |
|---|---|---|
| **default** | dim icon, transparent bg | `--color-text-muted` |
| **hover** | brighter icon, subtle bg | `--color-text-primary` on `--color-rail-item-hover` |
| **active** | accent icon + accent bg tint + 3px accent bar pinned to the rail's left edge (`::before`) | `--color-accent-run-ok` + `--color-rail-item-active` |
| **collapsed** | no icon active; panel hidden; rail + splitter-hidden | — |
| **focus-visible** | 2px accent outline, offset | `--color-border-focus` |

### 3.3 One shared hover tooltip (`data-tip`)

A single floating `.tooltip` element (created once, appended to `<body>`), positioned on
`mouseover`/`focusin` of any `[data-tip]`, hidden on `mouseout`/`focusout`/`mousedown`/`scroll`.
Rail icons use `data-tip-side="right"` (tooltip appears to the right, flips left if no room). This
is the proto's exact `data-tip` mechanism (one delegated listener pair) — reused for **all** icon
controls (rail, explorer header acts, row acts, fullscreen buttons). See §8 for a11y.

---

## 4. Minimal top toolbar

`<header class="toolbar">`: **title** (`🐍 pygame playground`, accent on "playground") + a flex
spacer + the **status pill** (`#status`). Optionally a small right-aligned header hint
(non-essential), which **hides below 1000px** via the existing single media query.

### 4.1 What's removed from the old toolbar

- `#examples <select>` → Examples rail panel.
- `▶ Run`/`■ Stop` → editor `▶ Start` (`#runBtn`) + hidden `#stopBtn` on the stage.
- `🔗 Share` → removal is paired + optional (Q3).
- `💾 Save` → Explorer download icon (id reconciled, §2.2).
- `👥 Collaborate` + `#liveDot`/`#peerCount` → Collaboration rail panel.
- `📁 #assetChip` + `#assetPanel`/`#historyPanel` popovers → Explorer / History rail panels.
- **The keyboard hint (`.hint`) is removed** — the run shortcut was dropped
  (`keyboard-shortcut` verdict: drop ⌘/Ctrl-Enter entirely). *Implementation note: dropping the
  shortcut means removing `Cmd-Enter`/`Ctrl-Enter` from the CM `extraKeys` (1029-ish). This is a
  behavior change — verify no battery presses ⌘-Enter (grep first).* If S1 chooses to keep the
  shortcut bound for now and only remove the *hint text*, call that out (Q6).

### 4.2 Status pill states (the only live indicator)

`#status` keeps `setStatus(cls,text)` as the sole writer. States (load-bearing — do not reword):

| State word (`textContent`) | class | color token |
|---|---|---|
| `starting…`, `loading Python…`, `loading pygame…`, `boot failed` | `.boot` (`boot failed` is `.error`) | `--color-status-warn-boot` / `--color-status-error-bad` |
| `running` | `.running` | `--color-accent-run-ok` |
| `error — see console` | `.error` | `--color-status-error-bad` |
| `ready` / `finished` / `stopped` | *(none)* | `--color-text-muted` (dim) |
| **`paused`** | **`.paused` — STYLED PLACEHOLDER ONLY** | reserve `--color-status-paused` (= `--color-accent-run-ok` or a dimmed accent); **never emitted in S1** (S3 adds the emit). |

Pill chrome: `.pill` = `--color-surface-pill` bg, `--color-border-default` border,
`--radius-pill`, `--font-small`. `.pill.running` border tints accent (proto behavior).

---

## 5. Type-aware viewer

The editor pane's `.vbody` (`#viewerBody`) swaps content by the selected file's kind. Classifier is
the spike-viewer classifier (`test/spike-viewer.mjs`, **proven**), reading bytes via
`pyodide.FS.readFile(name)` for assets and the Doc for `.py`.

| Kind | Viewer | Detail |
|---|---|---|
| **`.py`** | The **single CodeMirror** editor (`swapDoc` into the active file's Doc). | `vMeta` = `· Python` (+ ` · entry point` if entry). Editor header shows `▶ Start`. |
| **image** (png/jpg/gif/webp/bmp/svg) | Image viewer: `Blob` → `objectURL` → `<img>` on a checkerboard, with `name · WxH · TYPE` caption. | `vMeta` = `· PNG` etc. `▶ Start` hidden (non-runnable). |
| **audio** (wav/mp3/ogg/m4a/aac/flac/wma) | Player (`<audio>` + play button + waveform). | **MP3 (and other SDL-unsupported) keeps the ⚠ banner:** *"Plays here, but pygame's audio can't load MP3 — convert to WAV or OGG."* `▶ Start` hidden. |
| **other** (txt, etc.) | "Unable to open" empty state. | *"Can't open `<name>` here — only code, images, and sounds preview in the viewer."* `▶ Start` hidden. |

**`▶ Start` visibility:** shown only for runnable `.py` (proto `updateRunButton`: `display` toggled
by `kind==='py'`). This maps onto `#runBtn` — when hidden, `#runBtn` is `display:none` but **still
in the DOM** (tests that click `#runBtn` operate with `main.py` selected, which is `.py`, so Start
is visible — verify the default-selected file is always a `.py`, which it is: `main.py`).

**Landmine (b) guard:** the audio/image/other branches replace `#viewerBody.innerHTML`; returning
to `.py` must **re-mount/re-show the same CM instance and `swapDoc`**, never `editor.setValue` and
never `CodeMirror.fromTextArea` a second time. Keep one CM for the session.

---

## 6. Panes: resize, collapse, fullscreen

Four panes in the right region + the side panel:

```
[ side ] |split| [ viewer ]|split|[ stage ]
                 [ ───────── console drawer ───────── ]
```

### 6.1 Resize (all four resizable)

Splitters (`.split`, 6px; `.split.h` for row-resize) via mousedown→mousemove drag, writing inline
flex-basis:
- **side splitter** (`data-split="side"`): resizes `.side` width (clamp ~180–440px). Disabled while
  the panel is collapsed.
- **viewer splitter** (`#splitter`, `data-split="viewer"`): resizes `#editorPane` width (col-resize).
- **console splitter** (`#vsplit`, `data-split="console"`): resizes `#drawer` height (row-resize).
- The stage takes remaining space (flex:1).

`body.userSelect=none` + cursor swap during drag, as today. **Do not** wire the proto's
`fitCanvas()` (it resizes the fake canvas to its container); the real `#canvas` is fixed 640×480 and
scales via CSS — leave the SDL canvas size alone.

### 6.2 Collapse

- **Console**: collapsible (drawer). `#drawerCollapse` toggles `.drawer.collapsed` (`flex:0 0 31px`,
  console hidden). **Quirk to carry from the proto:** the console-resize drag writes an inline
  `flex` on `#drawer` that would override `.collapsed{flex:…}`; on collapse, **clear and stash the
  inline flex**, restore it on expand (proto `savedDrawerFlex`). Update `aria-expanded` +
  chevron glyph; hide the console splitter while collapsed.
- **Editor + game stage**: **NOT collapsible** (resize only) — per the Iteration Log.
- **Side panel**: collapsed via the rail click-collapse (§3.1), not a separate button.

### 6.3 Fullscreen (⛶ on editor, stage, AND console)

Each of the three pane headers has a `.chev-btn ⛶` (`#viewerFs`, `#fsBtn`, `#consoleFs`) toggling
the **Fullscreen API** on that pane element:
```
if (document.fullscreenElement) document.exitFullscreen();
else el.requestFullscreen().catch(()=>{});
```
- `#fsBtn` already exists in `index.html` (today fullscreens the stage) — **preserved**, relocated
  to the stage pane header.
- `#viewerFs` (editor) + `#consoleFs` (console) are **new**.
- **Interaction model:** fullscreen is single-pane (browser-native); only one pane can be fullscreen
  at a time (the API enforces this). Exiting returns to the resized layout. Fullscreening the stage
  must keep `#canvas` rendering (it's inside the fullscreened element).

---

## 7. Reconciliation: tests & existing assertions

(Test *plan* for new assertions is §9; this section is the **existing assertions that must change in
lockstep** — the brief's explicit ask.)

### 7.1 The seam-preservation guarantee (no change needed)

Because S1 keeps `#runBtn`, `#stopBtn`, `#canvas`, `#console`, `#status` (+ tokens), `#tabs`
container with per-file `.tab[data-name]`/`.active`/`.entry`, `window.*` globals, `#assetInput`,
and the lazy-load boot path — **the vast majority of the 6 batteries + verify.mjs + spikes pass
unchanged.** That is the whole point of the id-reconciliation rule (§2.3).

### 7.2 Hard conflict — `multifile.mjs:264–269` (tab strip absent in single-file mode)

```js
let tabsHiddenSolo = await page.evaluate(() => {
  const t = document.getElementById('tabs');
  return !t || t.offsetParent === null || t.children.length === 0;
});
if (tabsHiddenSolo) ok('tab strip absent in single-file mode');
else fail('tab strip showing for a single file');
```
The new Explorer is **always-on**, so this assertion **must be updated in lockstep**. Replace with
an assertion that matches the new IA, e.g.:
- *"explorer always shows the project's file(s)"* — assert `#tabs` is visible AND contains exactly
  one row with `data-name="main.py"` in single-file mode (instead of asserting absence).

The rest of `multifile.mjs`'s tab section (render both files, click-switch by `data-name`, `.entry`
badge, non-active edit survives reload) **keeps passing** if the explorer rows keep
`data-name`/`.active`/`.entry` and remain clickable — **no other change**. The `page.click('#tabs
.tab[data-name="enemy.py"]')` switch (282) works against tree rows.

### 7.3 Soft reconciliations (decide explicitly)

| Test site | Today's assumption | S1 reality | Action |
|---|---|---|---|
| `lint.mjs:71` `page.click('#tabs .tab[data-name="good.py"]')` | tab strip click switches file | tree row click switches file | **Passes unchanged** if rows keep `.tab[data-name]` selector. (Or update selector if rows are renamed `.row`.) **Recommend: keep `.tab` class on rows** to avoid touching lint.mjs. |
| `history.mjs` clicks `#historyBtn` then waits `#historyPanel .hist-row` | History is a popover opened by `#historyBtn` | History is a rail panel opened by the History `.acttab` | **Reconcile:** either keep a hidden/aliased `#historyBtn` that opens the History view, or update `history.mjs` to click the rail icon (`[data-view="history"]`) and keep `#historyPanel`+`.hist-row` selectors. **Recommend: update history.mjs to open via the rail icon; keep all `.hist-*` selectors.** |
| `assets.mjs` `#assetChip` text / `#assetPanel` toggle / `.asset-row[data-name]` / `.asset-remove` / click-not-close (161–163) | assets in a popover anchored to header | assets in the Explorer | **Reconcile (largest):** keep `#assetInput` (real), keep `.asset-row[data-name]`/`.asset-warn`/`.asset-remove` rendered by `renderAssetPanel` inside the Explorer; decide the fate of `#assetChip` (storage-summary vs removed) and `#assetPanel` (Explorer asset section vs hidden compat container). **Recommend for S1: keep `#assetPanel` as the Explorer's asset list container (un-hidden, in-flow) + keep `#assetChip` as a small count/storage indicator** so `assets.mjs` passes with minimal edits; the click-not-close rule still applies. Any selector that genuinely can't survive must be updated in lockstep. |
| `save.mjs` check 1 (`#saveBtn` exists) | toolbar Save button | Explorer download icon | **Keep `id="saveBtn"`** on the download control (or a hidden `#saveBtn`). No other `save.mjs` change in S1 (always-zip is deferred). |
| ⌘/Ctrl-Enter run shortcut (if removed) | CM `extraKeys` binds run | shortcut dropped | **Grep batteries for `Enter` key presses to `run()` before removing.** If none, remove from `extraKeys`. (Q6.) |

> **Lockstep rule:** the implementation slice changes the affected test assertion **in the same
> commit** as the DOM change, with the new assertion encoding the new (correct) IA — never delete a
> battery, never weaken an unrelated assertion.

---

## 8. Accessibility

### 8.1 Rail keyboard navigation + ARIA

- `nav.rail[role="tablist"][aria-orientation="vertical"]`; each icon `button[role="tab"]`
  with `aria-selected`, `aria-controls` → its `panelview` id, and an `id` referenced by the
  panel's `aria-labelledby`.
- Each `.panelview[role="tabpanel"][aria-labelledby=<tab id>]`.
- **Roving tabindex** across the tablist: active tab `tabindex=0`, others `tabindex=-1`. **Arrow
  Up/Down** move between tabs (wrap), **Enter/Space** activate (and toggle-collapse on the active
  one), **Home/End** jump to first/last. (Proto today only handles click; S1 adds arrow-key
  roving — additive.)
- Icons are decorative (`aria-hidden="true"` SVG); the accessible name comes from `aria-label` on
  the button.

### 8.2 Tooltip a11y

- The shared `.tooltip` has `role="tooltip"`. It shows on **focus** as well as hover (proto already
  binds `focusin`/`focusout`) so keyboard users get the label.
- Because each icon control also carries a real `aria-label` (not just `data-tip`), screen readers
  get the name independent of the visual tooltip. **Keep both** `aria-label` and `data-tip`.
- Tooltip is `pointer-events:none` (never traps), hides on `mousedown`/scroll/Escape.

### 8.3 Contrast (dark theme)

Reuse `tokens.md` contrast notes. Watch items for S1's new surfaces:
- Rail dim icon `--color-text-muted` (#8a8fa3) on rail bg (#181a21): roughly ~4.6:1 — passes AA for
  UI/large; **hover/active raise it to `--color-text-primary`/accent** (well clear). Flag the *rest*
  state for the later `design:accessibility-review` pass (do not change the raw here).
- Active accent icon `--color-accent-run-ok` (#7bd88f) on rail bg: high contrast.
- Status pill text already covered in tokens.md (dim states borderline — same flag).
- Tooltip text `--color-text-primary` on `--color-surface-panel`: ~11:1, fine.

### 8.4 Focus states

- All interactive controls (rail icons, explorer header acts, row acts, fullscreen buttons, Start,
  pane splitters) get a **`:focus-visible` ring** = `2px solid var(--color-border-focus)` offset
  (the proto already does this for `.acttab`, `.btn`, `.ghost`, `.chev-btn`). This closes the
  tokens.md "no focus ring on buttons" a11y gap.
- Splitters get `role="separator"` + `aria-orientation` (additive; keyboard resize is optional and
  may defer).
- Danger/primary controls keep their **glyph** (`▶`, `■`) as a non-color signal (don't rely on
  color alone).

---

## 9. Design tokens to ADD to `tokens.md`

Follow the existing methodology: **additive semantic aliases over the 8 raws**, one component group
at a time, values identical to the proto's current literals, raws unchanged. These extend §1.2 /
the Appendix `:root` of `tokens.md`. **New groups: `rail`, plus a few component additions.**

### 9.1 Rail (new component group)

| Proposed token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-rail-bg` | `#181a21` | `#181a21` | `.rail` background (darker than panel) |
| `--color-rail-item-hover` | `#23262f` | `#23262f` | `.acttab:hover` bg |
| `--color-rail-item-active` | `rgba(123,216,143,.12)` | accent @12% | `.acttab.active` bg tint |
| `--color-rail-item-active-bar` | `var(--accent)` | `#7bd88f` | the 3px active-edge bar (`::before`) |
| `--color-rail-icon` | `var(--dim)` | `#8a8fa3` | default icon color |
| `--color-rail-icon-active` | `var(--accent)` | `#7bd88f` | active icon color |

### 9.2 Tooltip (new)

| Token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-tooltip-bg` | `var(--panel)` | `#1c1e26` | `.tooltip` bg |
| `--color-tooltip-text` | `var(--text)` | `#d8dae5` | `.tooltip` text |
| `--color-tooltip-border` | `var(--edge)` | `#2c2f3a` | `.tooltip` border |
| `--shadow-tooltip` | `0 6px 18px rgba(0,0,0,.4)` | — | `.tooltip` shadow (reuses `--color-overlay-popover` family) |

### 9.3 Status — paused placeholder (S3 will emit; S1 only styles)

| Token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-status-paused` | `var(--accent)` (or a dimmed accent) | `#7bd88f` | `#status.paused` (reserved; not emitted in S1) |

> Keep the load-bearing trio intact (accent=run/ok, warn=boot, bad=error). `paused` is **additive**
> and conceptually a "live but suspended" state — reusing accent keeps it readable; final hue is a
> §S3 decision.

### 9.4 Pane chrome (new — reused by viewer/stage/console headers)

| Token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-pane-head-bg` | `var(--panel)` | `#1c1e26` | `.pane-head` / `.drawer-head` bg |
| `--color-pane-head-text` | `var(--dim)` | `#8a8fa3` | pane-head label text |
| `--color-pane-name` | `var(--text)` | `#d8dae5` | the file/stage name in a pane head |
| `--color-chev-hover` | `#23262f` | `#23262f` | `.chev-btn:hover` bg |

### 9.5 Run/control tints (promote proto literals; align with existing `--color-tint-run-*`)

The proto adds run-tint hover/border variants and an "on-tint" text. These largely already exist in
tokens.md §1.2 component tints; **add only the missing ones**:

| Token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-tint-run-border-strong` | `#2f6a44` | `#2f6a44` | `.btn.primary` border (already `--color-tint-run-border`) |
| `--color-text-on-tint` | (exists) `#b8f0c6` | `#b8f0c6` | `▶ Start` label, primary buttons |

(If `--color-tint-run-border` already == `#2f6a44`, no new token — just reuse. Audit during impl.)

### 9.6 Explorer/tree row (extend §5.6 file-row primitive)

The file-row primitive in tokens.md §5.6 already covers default/hover/active/entry/warn. **Add tree
affordances:**

| Token | → resolves to | Hex | Used by |
|---|---|---|---|
| `--color-row-hover` | `#23262f` | `#23262f` | `.row:hover` / `.tab:hover` bg |
| `--color-row-selected` | `#23303a` | `#23303a` | selected row bg (proto `.row.sel`) |
| `--color-row-selected-text` | `#cdeccf` | `#cdeccf` | selected row text (greenish) |
| `--color-py-icon` | `#6fb3e0` | `#6fb3e0` | `.py` file icon tint (proto `.pyico`) |

> Methodology reminder: introduce these as aliases in the `:root` (additive). New components
> reference the **semantic** name; the raws stay the physical anchor. Do **not** rename or revalue
> the 8 raws. Each group lands in `tokens.md` as its own table (rail first, then tooltip, then pane
> chrome, then row extensions) — **one group at a time**, matching the doc's existing cadence.

---

## 10. TDD test plan sketch (new headless Playwright assertions)

New shell behaviors get a **new battery** (proposed `test/shell.mjs`) so the existing 6 stay
focused; run via the same harness (`python3 -m http.server 8923` then
`node test/shell.mjs http://localhost:8923/`). Each assertion below is written to be **independent
of the engine** (no game must run) and to **not** trip a lazy-loader.

### 10.1 New assertions (`test/shell.mjs`)

1. **Rail present + 4 views.** `nav.rail [role="tab"]` count === 4; `data-view` order ===
   `['explorer','history','examples','collab']`.
2. **View switching.** Click each rail icon → its `.panelview` is visible and the other three are
   `hidden`; clicked icon has `aria-selected="true"` and exactly one tab is selected.
3. **Click-collapse.** With Explorer open, click the Explorer icon → `#side.collapsed` (panel
   hidden) **and the rail is still visible**; click any icon → panel re-opens.
4. **Status pill reflects `#status`.** Call `setStatus('running','running')` via `page.evaluate`;
   assert `#status.textContent==='running'` and `#status.classList.contains('running')`. Repeat for
   `error`/`boot`/dim states. (Reads the real seam, not a duplicate.)
5. **Viewer type switching.** Seed an image + an audio asset via `setInputFiles('#assetInput', …)`;
   select each in the explorer; assert the viewer body shows `<img>` for image, `<audio>`/player for
   audio (+ the ⚠ banner for `.mp3`), the "unable to open" empty state for `.txt`, and the
   `.CodeMirror` for `.py`. Assert **`#runBtn` is hidden** for non-`.py`, visible for `.py`.
6. **One CM identity preserved across viewer switches.** Capture the CM instance, switch to an
   image then back to `.py`, assert it's the **same** instance (`document.querySelector('.CodeMirror').CodeMirror`
   identity stable) and `getOption('lint')` is still falsy (no eager arm).
7. **Fullscreen toggles exist + call requestFullscreen.** Assert `#viewerFs`, `#fsBtn`, `#consoleFs`
   exist; stub `Element.prototype.requestFullscreen` and assert each button invokes it on the right
   pane element (full fullscreen can't be asserted headless, so assert the call + target).
8. **Console collapse.** Click `#drawerCollapse` → `#drawer.collapsed` (console hidden,
   `aria-expanded="false"`, chevron `▸`); click again → expanded, console visible. Verify the
   inline-flex stash/restore quirk (collapse then expand preserves a previously-dragged height).
9. **Panes present + resizable.** Assert `.split[data-split="side"]`, `#splitter`
   (`data-split="viewer"`), `#vsplit` (`data-split="console"`) exist; simulate a side-splitter drag
   (mousedown→mousemove→mouseup) and assert `#side` width changed within clamp bounds.
10. **Explorer always-on (the IA flip).** In single-file mode, assert `#tabs` is **visible** and
    contains the project's file row(s) (the inverse of the old "absent" assertion — and the canonical
    new statement of the always-on explorer).
11. **First-paint laziness (regression guard, additive).** After boot + opening each rail panel
    (History, Examples, Collaboration) **without** clicking Run/diff/collab-start, assert
    `window.__amLoaded` falsy, `window.JSZip === undefined`, no jsdiff global, and the CM lint
    option still falsy. (Proves rail navigation doesn't eagerly load.)
12. **Tooltip a11y.** Focus a rail icon → the shared `.tooltip[role="tooltip"]` shows its
    `data-tip` text; blur → hides. Assert the icon also has a non-empty `aria-label`.

### 10.2 Existing assertions to reconcile in lockstep

(See §7 for detail.) Concretely, the implementation slice must update, **in the same commit**:

- **`test/multifile.mjs:264–269`** — invert "tab strip absent in single-file mode" → "explorer
  always shows the file row(s)" (the always-on explorer). The remaining tab section (276–308) stays
  valid against tree rows that keep `data-name`/`.active`/`.entry`.
- **`test/lint.mjs:71`** — keep passing by keeping the `.tab[data-name]` selector on explorer rows
  (recommended), else update the selector.
- **`test/history.mjs`** — change the opener from `#historyBtn` to the History rail icon
  (`[data-view="history"]`); keep `#historyPanel`/`.hist-rows`/`.hist-row[data-id]`/`.hp-restore`/
  `.hp-clear`/`.hp-diffbody` selectors.
- **`test/assets.mjs`** — re-home the asset UI into the Explorer while keeping `#assetInput`,
  `.asset-row[data-name]`, `.asset-warn`, `.asset-remove`, and the click-not-close rule; decide
  `#assetChip`/`#assetPanel` fate (recommend: keep both as Explorer-section containers) and adjust
  only the selectors that genuinely move.
- **`test/save.mjs` check 1** — keep `#saveBtn` existing (id on the download control). No other
  save.mjs change in S1.
- **If the ⌘-Enter shortcut is removed** — confirm no battery relies on it (grep), then it's a clean
  removal; otherwise keep it bound and only drop the hint text (Q6).

**Guardrail:** `verify.mjs` (engine smoke) + `spike-runstop.mjs`/`spike-viewer.mjs` must stay green
with **no** changes — they exercise `#runBtn`/`#stopBtn`/`#canvas`/`#console`/the viewer classifier,
all preserved.

---

## 11. Open questions / risks for the orchestrator

1. **Q1 — Folder visuals in S1 (flat model).** Render the Explorer as a flat list (A) or
   visual-only type groups using folder chrome (B)? Recommend **B** (matches proto look) **clearly
   not implying MEMFS isolation** (landmine a). Real folders are S2. `#newFolderBtn` inert/hidden in
   S1 either way.

2. **Q2 — Start button location vs the screenshots.** The proto *markup* (source of truth) puts
   `▶ Start` in the **editor pane header** (and `run-indicator.png` agrees), but
   `sandbox-rail-collapsed.png` / `sandbox-rail-history.png` show Start in the **top toolbar**.
   These shots disagree. This design follows the **markup** (editor-header Start). **Confirm:
   editor-header Start, toolbar stays title+status only.** (If the team prefers toolbar Start,
   `#runBtn` simply moves to the toolbar — still maps to `run()`.)

3. **Q3 — `#shareBtn` removal in S1?** It's a paired deletion (markup + listener, else boot
   throws), test-safe (no battery references it). Do it in S1 (clean) or defer to the
   share-link-load-paths slice? Recommend **defer** unless the orchestrator wants the toolbar
   genuinely minimal now — it's a deletion, not a restyle, and the legacy `#code=`/`#project=`
   loaders (verdict: remove) are a separate slice.

4. **Q4 — Examples panel behavior in S1.** S4 makes examples editable promote-on-edit files. For S1,
   the Examples rail panel should reproduce **today's** load-an-example behavior (user-initiated,
   never at boot). But today's `change`-handler **overwrites the editor destructively** — do we
   (a) keep that exact behavior in the new list, or (b) make S1's Examples list **read-only /
   inert** (just shows names) until S4 wires the promote model? Recommend **(b) inert list in S1**
   to avoid carrying a behavior S4 will rip out, *and* to avoid any `setValue` risk. Needs a call.

5. **Q5 — `#saveBtn` vs `#downloadBtn`.** Put `id="saveBtn"` directly on the Explorer download icon
   (one element), or keep a hidden `#saveBtn` that `#downloadBtn` delegates to? Recommend **id on
   the download icon** (simplest; `save.mjs` check 1 passes; Cmd-S still works).

6. **Q6 — Drop the ⌘/Ctrl-Enter binding now, or just the hint text?** Verdict is "drop the run
   shortcut entirely." Removing the binding is a behavior change in CM `extraKeys`. Confirm S1
   removes the **binding** (grep batteries first) vs S1 only removes the **hint** and the binding
   goes in the run-model/S3 slice. Recommend **remove the hint in S1; grep, then remove the binding
   in S1 if no battery depends on it.**

7. **Risk — assets-in-Explorer reconciliation (biggest test churn).** `assets.mjs` is tightly
   coupled to `#assetChip`/`#assetPanel`/`.asset-row`. Keeping these alive inside the Explorer (vs a
   bigger rewrite of `assets.mjs`) is the lowest-churn path; the orchestrator should confirm we
   **keep the asset selectors and re-home them** rather than redesign the asset model in S1 (asset
   model changes belong to S2's real-folders work).

8. **Risk — canvas sizing.** Do **not** adopt the proto's `fitCanvas()` (it mutates canvas
   width/height to fit the container — correct for the fake engine, **wrong** for the SDL-bound
   640×480 `#canvas`). S1 must scale the canvas via CSS only. Flagging because the proto code is
   tempting to copy wholesale.

9. **Risk — one-CM persistence through the type-aware viewer.** The viewer replaces
   `#viewerBody.innerHTML` for non-`.py` types. The implementation must keep the single CM instance
   alive across switches (hide/show, not destroy/recreate) and never `setValue` — both the
   one-CM-identity invariant and the lint-arming landmine ride on this. Worth an explicit test
   (§10.1 #6).

---

## 12. Summary of what S1 ships (one-paragraph recap)

A re-skinned shell matching `proto/sandbox.html`: a 4-icon **vertical rail** (Explorer/History/
Examples/Collaboration) with click-collapse and one shared tooltip; a **minimal toolbar** (title +
status pill, no keyboard hint); an **always-on Explorer** that replaces the `#tabs` strip while
**keeping `#tabs`/`renderTabs`/per-file `data-name`/active/entry** as the engine seam; a
**type-aware viewer** (code/image/audio/other) over the **one** CodeMirror; an editor-header
**`▶ Start`** mapped to the existing `#runBtn`/`run()`; **four resizable panes** with **console
collapse** and **fullscreen ⛶** on editor/stage/console. Every load-bearing seam from the
architecture map is preserved or relocated id-intact; the lazy-load first-paint invariant holds;
the deep features (real folders S2, split run model S3, editable examples S4, multi-file collab S6)
are explicitly deferred with reserved DOM hooks. New tokens (`rail`, `tooltip`, `pane`, `paused`
placeholder, tree-row extensions) land additively in `tokens.md`. One existing assertion inverts in
lockstep (`multifile.mjs` always-on explorer); a handful re-home their openers/selectors (history,
assets, save) without weakening coverage.

**Doc path:** `docs/specs/2026-06-23-shell-restyle-design.md`
