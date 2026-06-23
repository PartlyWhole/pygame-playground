# pygame-playground — Redesign Architecture & Seam Map

> Working reference for the UX/visual redesign. Produced 2026-06-23 by fanning out
> per-subsystem readers over `index.html` (2032 lines) + design docs + test batteries,
> then synthesizing. All line references verified against `index.html` on 2026-06-23.
> This is a **reference map**, not a design doc — designs live in `docs/specs/*-design.md`.

_Cross-checked: every header-control id (153-166), every `window.*` test seam, the `run()`
dispatch (1807-1835), the share handler block (1623-1638), the examples handler (1686-1696),
and all lazy-load triggers (armLint 1168, JSZip 1670, jsdiff 1462, Automerge 1851, auto-run 2029)._

## 0. Ground truth & global invariants

- **One file, no build:** the entire app is `index.html` (2032 lines). The only built
  artifact is the vendored `./vendor/automerge-collab.mjs` bundle (lazy). No backend, no
  API keys, no bundler.
- **Verification harness:** `verify.mjs` (engine smoke test, borrows Trellis's
  playwright-core) + **6 batteries** in `test/`: `assets.mjs`, `collab.mjs`, `history.mjs`,
  `lint.mjs`, `multifile.mjs`, `save.mjs`. Plus de-risk **spikes** (`spike-runstop.mjs`,
  `spike-viewer.mjs`, etc.). All must stay green. Run via
  `python3 -m http.server 8923` then `node <test> http://localhost:8923/`.
- **First-paint lazy invariant (load-bearing, tested):** the solo "boot + run a game" path
  must load **zero** of: Automerge (`./vendor/automerge`), ruff-wasm (`esm.sh`), CM lint
  addon (cdnjs), JSZip (cdnjs), jsdiff (cdnjs). Each gated behind a one-shot cached-promise
  loader (`loadAutomerge` 1851, `loadLinter` 1135, `loadJSZip` 1643, `loadDiffLib` 1408).
- **Shell:** column-flex `<body>`: `<header>` toolbar (151-167) / `<main>` two-pane
  (168-180). No `<footer>`, no `<aside>`. ONE responsive media query:
  `@media (max-width:1000px){ .hint{display:none} }`.
- **Design tokens:** one `:root` block, **8 custom properties** (9-12):
  `--bg #14151a, --panel #1c1e26, --edge #2c2f3a, --text #d8dae5, --dim #8a8fa3,
  --accent #7bd88f, --warn #f0a45d, --bad #ff6e7f`. Semantics load-bearing:
  **accent = run/ok green, bad = error red, warn = boot orange**. No test reads token
  *values* (they read class presence); retheming allowed if every `var()` ref stays in sync.

## 1. Shell / IA / Toolbar (CSS 9-147 · header 151-167 · main 168-180 · `setStatus` 1024)

Current toolbar (DOM order): `🐍 title` · `#examples <select>` · `▶ Run #runBtn` ·
`■ Stop #stopBtn` · `🔗 Share #shareBtn` · `💾 Save #saveBtn` · `👥 Collaborate #collabBtn` ·
`#liveDot`+`#peerCount` (hidden until in-room) · `📁 #assetChip` · hidden `#assetInput` ·
`#assetPanel` popover · `🕘 History #historyBtn` · `#historyPanel` popover · `.hint` ·
`#status` pill (`margin-left:auto`).

Main: `#editorPane` (`#tabs` strip + `textarea#code`) · `#splitter` · `#rightPane`
(`#stage`→`canvas#canvas`+`#fsBtn`, `#vsplit`, `#console`) · `#dropOverlay` sibling.

Popovers `#assetPanel`/`#historyPanel` are `position:absolute; top:44px; right:14px`
anchored to `header{position:relative}` — **moving the toolbar requires re-anchoring them.**

`setStatus(cls,text)` (1024) is the ONLY writer of `#status`: `className` drives color
(`.running`→accent, `.error`→bad, `.boot`→warn; `ready`/`finished`/`stopped` have no class →
dim), `textContent` is the token tests gate on. Examples handler (1686-1696) is **explicit
user action only — NEVER fired at boot** (first-paint invariant).

## 2. Cooperative run model + Start/Stop (`BOOT_PY` 561-770 · `PROJECT_PY` 780-999 · `run()` 1807-1835 · clicks 1845-1848 · auto-run 2029)

Two engines, one task slot. `BOOT_PY` (single-file) + `PROJECT_PY` (multi-file, additive)
are concatenated and `runPythonAsync`'d at boot. An AST transform (633-732) rewrites blocking
game-loops into cooperative `async def` with `await __yield__()`; `__yield__` (619-631) drains
a banked frame budget via `asyncio.sleep` so the tab stays responsive.

`run()` (1807): awaits boot → `clearConsole()` → fire-and-forget `captureSnapshot()` → focus
canvas → `resumeAudio()` → **dispatch on `collab.active || !project.isMulti()`**: single-file
`_start(editor.getValue())` else `_start_project(serialize().files, entry)`. Stores thenable in
`runTask` (module-local **stale-run guard**), sets `'running'`, maps result to
`finished`/`stopped`/`error`.

**Stop** (`#stopBtn` → `pyodide.runPython('_stop()')`, 1848) cancels `_state['task']`.
**Stop does NOT clear `#console` and does NOT clear `#canvas`** — last frame frozen, console
intact. `clearConsole` runs ONLY at the top of `run()` — that's what distinguishes Run from
Stop. The `'running'` signal is observable as `#status==='running'` AND live `_state['task']`
(`not None and not done()`) — `spike-runstop.mjs` proves one button can block re-run.

## 3. Project model + tabs (`project` 1077-1123 · `renderTabs` 1509-1523 · persistence 1581-1596 · bootstrap 1568-1579)

`window.project`: `files` = `name→CodeMirror.Doc`, `order`, `entry`, `active`. The active
file's Doc IS the live editor doc (`swapDoc`), so identity
**`project.files[active] === document.querySelector('.CodeMirror').CodeMirror.getDoc()`** always
holds. **Exactly ONE CodeMirror** for all `.py`. Methods: `text`/`isMulti`/`serialize`/`load`/
`setActive`/`add`/`rename`/`remove`/`setEntry`.

`renderTabs()` gates on `isMulti() && !collab.active`. Persistence: `editor.on('change')`
debounces `flushSave` 400ms (seam `window.__flushSave`), early-returns while `collab.active`,
writes `PROJECT_KEY 'pygame-playground:project'` + mirrors legacy `'pygame-playground:code'`
only when `!isMulti()`. Bootstrap precedence: `#room=` > `#project=` > `#code=` > saved
PROJECT_KEY > legacy > default. Uses `project.load`→swapDoc (NOT setValue) → **does not arm lint.**
MEMFS is a single FLAT namespace shared with assets by bare name.

## 4. Assets + type-aware viewer (`assetStore` 1200-1223 · `assetFS` 1274-1308 · `renderAssetPanel` 1351-1366 · wiring 1367-1400 · viewer spike `test/spike-viewer.mjs`)

Three upload paths → `assetFS.add(file)`: hidden `#assetInput`; drop-anywhere (gated on
`dataTransfer.types` includes `'Files'`); `hydrateAll()` at boot. `assetFS.add`:
`arrayBuffer` → `assetStore.put` (IndexedDB `pygame-playground`) → **`pyodide.FS.writeFile(BARE
name, bytes)`** — assets MUST be real MEMFS files (`io.BytesIO` fails). Sets
`warn=UNSUPPORTED_AUDIO.test(name)` (mp3/m4a/aac/flac/wma — SDL_mixer is WAV/OGG only).

UI: `#assetChip` `📁`/`📁 N`, click toggles `#assetPanel`; rows `.asset-row[data-name]` +
`.asset-warn` + `.asset-remove`; `#apStorage` (`navigator.storage.estimate`, `.low` at ≥80%).
Boot audio Proxy (1771-1778) captures `AudioContext`s into `window.__audioContexts` BEFORE
`loadPackage('pygame-ce')`.

**Type-aware viewer (PROVEN by `spike-viewer.mjs`, NOT yet in index.html):** bytes via
`pyodide.FS.readFile(name)`; classify `py→code`, image exts → image (Blob→objectURL→`<img>`),
audio exts → audio (`<audio>`), else → 'unable to open'. **MP3 divergence:** `<audio>` plays
mp3 but pygame's SDL_mixer cannot — viewer must keep the ⚠ messaging.

## 5. Save (`saveProject` 1662-1683 · `loadJSZip` 1643-1653 · `downloadBlob` 1654-1661 · Cmd-S 1042-1043)

2-branch: **A (lone .py fast path, 1664-1667)** `!isMulti() && assetFS.list.length===0` →
`downloadBlob(text(entry), entry)`, no library. **B (zip, 1668-1683)** `loadJSZip()` (cdnjs
**jszip 3.10.1**) → zip `serialize().files` + `assetStore.getAll()` with `asset_`-prefix clash
handling → `pygame-project.zip`. `save.mjs` check 5 asserts `window.JSZip` undefined after a
.py-only save (laziness). The version `3.10.1` is hardcoded in the test's `readZip()` helper.

## 6. Auto-lint (`loadLinter` 1134-1143 · `armLint` 1154-1167 · trigger 1168)

Editor created with NO explicit `gutters` → no lint at first paint. First `change` → `armLint`
(idempotent): injects CM 5.65.16 lint addon + imports `ruff-wasm-web@0.15.18` (esm.sh), sets
gutters incl. `CodeMirror-lint-markers`, `lint:{getAnnotations, delay:350}`. `select:['F']` is
load-bearing (suppresses E/W noise; `lint.mjs` 4/5 assert zero markers on compact code). Lint
is Pyodide-independent. ⚠ **Any programmatic `editor.setValue()` at init/example-load would
eagerly arm lint and break the first-paint invariant** — bootstrap uses `swapDoc`, stay that way.

## 7. History (`historyStore` 1228-1261 · `captureSnapshot` 1264-1272 · `renderHistory` 1435-1453 · `showDiff` 1454-1476 · `restoreSnapshot` 1477-1487 · hook in run() 1810)

On every Run, `captureSnapshot()` fire-and-forget (1810, not awaited): `serialize()`, dedup vs
latest, else `historyStore.add({at, mode:'solo'|'room', project})`. `historyStore`
(`window.historyStore`) wraps IndexedDB **`pygame-playground-history`** store `snapshots`
(autoIncrement, capped 100). `#historyBtn` toggles `#historyPanel`; rows `.hist-row[data-id]`
in a `.hist-rows` sub-container + `#histDiff` pane; `_histSelectedId` preserves open diff across
Run. `showDiff` lazy-loads jsdiff 5.2.0 → `Diff.diffLines(active file)`. `restoreSnapshot`:
confirm → `captureSnapshot` → `project.load` → `renderTabs` → `flushSave`. **Brief item 7 =
placement/restyle only.**

## 8. Collaboration + Share-removal (collab 1500-1502 · `loadAutomerge` 1851 · `bindEditor` 1869 · `startPresence` 1903 · `startRoom` 1966 · `joinRoom` 1985 · `enterRoom` 1999 · `#collabBtn` 2016 · `#shareBtn` handler 1623-1638)

Lazy/opt-in. **CRDT doc shape = `{ code: string }` — SINGLE-FILE.** Entry points:
`#collabBtn`→`startRoom()` (multi-file → confirm, seeds only `entry`; sets `#room=`; copies
link) and page-load `#room=`→`joinRoom()` (retry vs `wss://sync.automerge.org`; adopt
`doc.code`). `enterRoom()` relabels `#collabBtn`→`🔗 Copy room link`, binds editor + presence,
`renderTabs()` (strips tab strip). Remote peers → `.remote-cursor`+`.remote-flag` (name
`/^[A-Z][a-z]+ [A-Z][a-z]+$/`) + selection band (`markText` `background-color`).

**`#shareBtn` (156) + handler (1623-1638) TO BE REMOVED together** (else
`getElementById('shareBtn').addEventListener` throws). **KEEP `#room=`.** Open: drop the
`#code=`/`#project=` LOAD paths (breaks shared links) vs keep read-only.

## Cross-cutting data flow

```
EXAMPLES(189-1011) ──change(1686)──▶ project.load ──▶ renderTabs ──▶ run()
upload/drop/hydrate ──▶ assetFS.add ──▶ pyodide.FS.writeFile(bare name) ──▶ MEMFS (flat)
                              └──▶ assetStore.put ──▶ IndexedDB 'pygame-playground'
project (Docs) ──serialize()──▶ {files,order,entry} ──┬──▶ saveProject ──▶ JSZip ──▶ download
                                                       ├──▶ captureSnapshot ──▶ IDB history
                                                       └──▶ run() ──▶ _start/_start_project ──▶ _state['task']
editor.on('change') ──┬──▶ flushSave(400ms) ──▶ localStorage (paused in collab)
                      └──▶ armLint ──▶ ruff-wasm (lazy)        setStatus ◀── task.then ──▶ #status/#canvas/#console
collab: #collabBtn ──▶ loadAutomerge ──▶ {code:string} CRDT ◀──wss──▶ peers
```

---

## Seam inventory (preserve, or update tests in lockstep)

### DOM
- **`#status`** — only writer `setStatus` (1024). Exact tokens: `starting…`, `loading Python…`,
  `loading pygame…`, `ready`, `running`, `finished`, `error — see console`, `stopped`,
  `boot failed`. Every battery gates on these.
- **`#runBtn`** — click→`run()` (1845). ~50 `page.click('#runBtn')` sites across verify + all
  batteries + spike-runstop. Unified control keeps this id OR updates every caller in lockstep.
- **`#stopBtn`** — click→`pyodide.runPython('_stop()')` (1848). Same lockstep rule.
- **`#saveBtn`** — click→`saveProject` (1684). `save.mjs` check 1 asserts it exists.
- **`#shareBtn`** — TO REMOVE (markup 156 + listener 1623-1638 together). No battery references it.
- **`#collabBtn`** — text `👥 Collaborate`→`🔗 Copy room link`. Lazy-loads Automerge on click.
- **`#historyBtn` / `#historyPanel`** — toggle popover; tests wait for `#historyPanel .hist-row`.
- **`.hist-row`** (`data-id`) — must live in `.hist-rows` sub-container (`:last-child`=oldest);
  exactly one `.hist-row.sel` after click. **`.hp-diffbody`** + `.d-add`/`.d-del`/`.d-ctx`;
  **`.hp-restore`** (`data-id`); **`.hp-clear`**.
- **`#examples`** — `<select>`, options = 6 EXAMPLES keys; change = user action; NEVER at boot.
- **`#liveDot`/`#peerCount`** — `setLive` toggles `[hidden]`+class; peerCount numeric.
- **`.remote-cursor`** / **`.remote-flag`** (name regex, `style.background` shorthand) /
  CM selection span (`background-color` longhand — distinguishable selectors).
- **`#assetChip`** — `📁`/`📁 N`, class `has`, click toggles `#assetPanel`.
- **`#assetInput`** — REAL hidden `<input type=file multiple>`; Playwright `setInputFiles` path;
  a click from it must NOT close `#assetPanel`.
- **`#assetPanel`/`#apStorage`** (`storage`+digit, class `low` ≥80%); **`.asset-row[data-name]`**
  (unescaped real filename incl. `"`), **`.asset-warn`**, **`.asset-remove`** (FS.unlink),
  **`.ap-browse`** (opens `#assetInput`), **`.ap-clear`**; **`#dropOverlay`** (class `show`).
- **`#tabs` + per-file `.tab[data-name]`** (class `active`/`entry`) — explorer replacement MUST
  keep `window.renderTabs` + clickable per-file `data-name` + active/entry states OR change
  `multifile.mjs:259-309` + `lint.mjs` tab section in lockstep.
- **`#canvas`** (`640×480`, `tabindex=0`) — `toDataURL` frame-diff + `getImageData` pixel reads;
  SDL bound to `#canvas`; Stop leaves last frame.
- **`#console`** — `<div>` lines (`out`/`err`/`sys`); survives Stop, cleared on Run.
- **`.CodeMirror`** — ONE live CM5 instance; identity invariant (see §3);
  `getOption('lint')` falsy before first edit, truthy after.
- **`.CodeMirror-lint-marker(-error/-warning/-multiple)`** + gutter id `CodeMirror-lint-markers`
  (added only after first edit — must NOT be pre-included at init).

### window globals
- **`window.project`** (method surface above), **`window.renderTabs`** (zero-arg re-render hook),
  **`window.__flushSave`** (synchronous autosave flush; collab pause), **`window.historyStore`**
  (record `{id, at, mode, project:{files,order,entry}}`), **`window.renderAssetPanel`**,
  **`window.__audioContexts`** (array), **`window.__amLoaded`** (boolean sentinel; falsy on solo),
  **`window.JSZip`** (set after first zip; always-zip inverts the save.mjs assertion),
  **`pyodide`** (bare global: `runPython`, `globals.get`, `FS.*`), **`runTask`** (module-local
  stale-guard — not on window).

### python globals
- **`_stop()`**, **`_state['task']`** (Future; `not None && not done()`=running),
  **`_state['via_project']`**, **`_start`/`_start_project`** dispatch, status-token protocol
  (`error`/`stopped`/`ok`/`exit`), **`pyodide.FS.unlink`** on rename/remove (flat MEMFS).

### storage / network
- localStorage `pygame-playground:project` (JSON) + legacy `pygame-playground:code` (string,
  !isMulti only); IndexedDB `pygame-playground`/`assets` + `pygame-playground-history`/`snapshots`;
  `location.hash` `#room=` (KEEP) + `#code=`/`#project=` (open question).
- Lazy network (MUST be absent at first paint): `./vendor/automerge-collab.mjs` +
  `wss://sync.automerge.org`; `esm.sh ruff-wasm-web@0.15.18`; cdnjs CM 5.65.16 lint addon;
  cdnjs jszip 3.10.1; cdnjs jsdiff 5.2.0; `navigator.storage.estimate`.

### css
- `:root` 8 tokens (semantics load-bearing); `@media (max-width:1000px)` (only breakpoint);
  popover anchoring `top:44px right:14px` to `header{position:relative}`.

---

## Redesign change map (7 PM capabilities)

1. **Hide examples → bottom button → read-only copy popup.** Remove `#examples <select>` +
   destructive handler (1686-1696). Reuse the EXAMPLES object (189-1011) as data source; clipboard
   copy mirrors existing pattern. RISK: must stay user-initiated (never at boot); popup is pure
   read+copy, NO `editor.setValue` (arms lint + violates non-overwrite). `loadedExample` (1560) +
   confirm-on-differs become dead — remove cleanly.
2. **VS-Code explorer (code+assets) + type-aware viewer + save/rename/delete.** Replace `#tabs`
   with a persistent explorer listing project Docs AND asset entries; selecting opens the right
   viewer (`.py`→the one CM; image; audio; else 'unable to open') using the spike-viewer classifier.
   Reuse `window.project` + `window.renderTabs` + single-CM swapDoc + assetFS/MEMFS. RISKS: keep
   per-file `data-name`+active/entry+`renderTabs` (or update tests in lockstep); keep ONE CM;
   data model now spans THREE stores; always-on explorer conflicts with `multifile.mjs:264-269`
   ('tab strip absent in single-file mode') — reconcile; NO subdir MEMFS write paths; keep MP3 ⚠;
   `#assetInput` stays a real hidden input.
3. **Unified Start/Stop; block re-run while running; Stop freezes frame+console.** Collapse
   `#runBtn`+`#stopBtn` into one toggle; block re-run while running (read `#status==='running'`
   OR live `_state['task']`). Reuse the entire engine + stale-guard. RISKS: keep both ids as
   click targets OR update ~50 sites in lockstep; keep `#status` vocab; FORK: finished (done())
   program re-run UX; Cmd/Ctrl-Enter rebinding.
4. **Always-zip download.** Remove Branch A; every Save → zip → `pygame-project.zip`. Reuse
   Branch B + clash logic. RISKS: `save.mjs` checks 2/3/5 change (5 inverts: JSZip now present
   after first save, still absent at first paint); update save design doc + plan; UX change
   (single-file user always gets a zip).
5. **Upload code or assets via explorer.** Route by type: assets→`assetFS.add` (existing),
   `.py`→`project.add` (new wiring). Keep drop-anywhere + `#dropOverlay`. RISKS: keep `#assetInput`
   id + click-not-close-panel rule; validate code filenames via `isModuleName`; code/asset
   name-collision in the single flat MEMFS namespace.
6. **Collaborate kept; REMOVE 🔗 Share; decide room scope.** Delete `#shareBtn` markup+listener
   together; keep `#collabBtn` + `#room=`. Reuse all collab. RISKS: keep `#room=` hashchange
   guard + flushSave collab pause; solo path loads ZERO Automerge; DECISIONS: drop share-link
   load paths vs keep read-only; **single-file vs multi-file room (real rework — `{code:string}`).**
7. **History kept, re-homed.** Placement/restyle only. Reuse everything. RISKS: keep all
   `history.mjs` selectors (esp. `.hist-rows` sub-container + single `.sel`); jsdiff stays lazy;
   `captureSnapshot` stays fire-and-forget; if `#runBtn` is renamed, history's `page.click('#runBtn')`
   breaks in lockstep.

---

## Open forks to brainstorm with the user

1. **Multi-file collab room vs keep single-file** — CRDT doc is `{code:string}`; multi-file is a
   substantial rework (per-file CRDT maps, per-file presence/diff, re-enable explorer-in-room).
2. **Fate of share-link LOAD paths** after removing `#shareBtn` — drop `#code=`/`#project=`
   loaders (breaks already-shared links) vs keep read-only. `#room=` kept regardless.
3. **Re-run UX for a FINISHED program** under unified Start/Stop (done() task would allow Start —
   intended 'run again', or reset to clean Start?).
4. **Cmd/Ctrl-Enter binding** under unified control — keep as Start, toggle, or drop.
5. **Always-zip UX** — single-file student always gets `pygame-project.zip`; acceptable or offer a
   single-.py escape hatch?
6. **Explorer visibility** — always-on (VS-Code style, reconcile `multifile.mjs` single-file
   assertion) vs only-when-multi.
7. **Where History lives** in the new IA — shared sidebar, docked rail, or timeline strip?
8. **Code-file upload routing** — accept `.py`→`project.add`? Disambiguate by extension; handle
   code/asset name collision in the flat MEMFS namespace.
