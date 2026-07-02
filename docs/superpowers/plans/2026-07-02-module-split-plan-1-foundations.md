# ES-Module Split — Plan 1 of 4: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute Step 0 (seam hardening + seam-audit battery) and the first seven module extractions (`examples-data`, `lessons-data`, `util`, `ui`, `dialogs`, `lint`, `editor`) of the approved design `docs/superpowers/specs/2026-07-01-es-module-decomposition-design.md`, converting index.html to the `import('./src/main.mjs').then(init)` bootstrap with **zero test edits**.

**Architecture:** index.html's single classic `<script>` gets wrapped: a small sync prelude keeps the bare `pyodide` seam; the rest of the legacy body becomes `window.__appMain`, invoked by `src/main.mjs` after it imports the extracted modules and publishes their window seams. Each task moves one subsystem out of `__appMain` into `src/*.mjs`; bare references left in the legacy body keep resolving through transitional `window.*` mirrors that Plan 4 retires.

**Tech Stack:** Vanilla ES modules (no build step, GitHub Pages static), CodeMirror 5.65.16 (classic CDN global), Pyodide 0.27.2 via `vendor/engine.mjs`, Playwright-core headless batteries in `test/*.mjs`.

---

## Context an engineer needs (read before Task 1)

**Repo:** `/Users/alan/Desktop/Projects/pygame-playground`. The whole app is `index.html` (4,069 lines: CSS → markup → CDN `<script>` tags at 561–565 → ONE classic `<script>` from 566 to the end). First-party modules created by this plan live in a new `src/` directory (`vendor/` stays third-party-only; `vendor/engine.mjs` must not move or be edited in this plan).

**Line numbers drift.** Numbers in this plan are anchors into the file AS OF commit `777e3b6`. After each task they shift. Always locate code by the quoted anchor text (section-marker comments like `// ---------------------------------------------------------------- UI plumbing`), not by counting lines. When told to "move verbatim", CUT and PASTE the exact text — never retype code.

**Zero test edits.** No file in `test/` may be modified, except CREATING the new `test/seams.mjs` (Task 1). If a battery goes red, the app change is wrong — fix the app.

**Running the battery.** Terminal 1 (leave running):

```bash
cd /Users/alan/Desktop/Projects/pygame-playground && python3 -m http.server 8923
```

Batteries need Playwright's Chromium. If the default path in `test/_harness.mjs` doesn't exist on this machine, set `PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs`. Full battery (from repo root; every suite prints `ok -` lines and exits 0 on success, prints `FAIL:` and exits 1 on failure):

```bash
FAILED=0
for t in test/seams.mjs test/shell.mjs test/modal.mjs test/examples.mjs test/lint.mjs \
         test/runmodel.mjs test/freeze.mjs test/multifile.mjs test/subdirs.mjs \
         test/assets.mjs test/upload.mjs test/save.mjs test/history.mjs \
         test/explorer-tree.mjs test/explorer-actions.mjs test/explorer-dnd.mjs \
         test/lessons.mjs test/share-removed.mjs test/engine-extraction.mjs \
         test/collab.mjs test/collab-multifile.mjs test/collab-multifile-b.mjs \
         verify.mjs; do
  echo "== $t"; node "$t" || { echo "RED: $t"; FAILED=1; }
done; [ "$FAILED" = 0 ] && echo "BATTERY GREEN" || echo "BATTERY RED"
```

Expected: `BATTERY GREEN`. (`test/spike-*.mjs` are historical one-off proofs — not gates.) The collab suites talk to `wss://sync.automerge.org` and are occasionally flaky — a collab-only failure may be re-run once before being treated as a regression.

**Branch/merge protocol.** Each Task group below states its branch. Work on the branch, commit per task, run the FULL battery, then `git checkout main && git merge --no-ff <branch>`. Main stays green at every merge.

**The transitional-mirror pattern (used by Tasks 7–11).** The legacy body inside `__appMain` refers to helpers by bare name (`esc(...)`, `logLine(...)`). When a helper moves to a module, its definition is deleted from the body; the bare references then resolve via `window.<name>`, which `src/main.mjs` assigns before calling `__appMain()`. Mirrors marked *(pinned)* are permanent test seams; all others are transitional and are retired in Plan 4's consolidation. Every extraction task also DELETES its name's line from the Step-0 seam-export block (main.mjs owns the assignment from then on).

**Roadmap (context only — not this plan):** Plan 2 = `project`, `viewer`, `assets`, `explorer`. Plan 3 = `history`, `save`, `examples-panel`, `layout`, `lessons`. Plan 4 = `collab`, `run`, consolidation (retire mirrors + `__appMain`), engine watchdog accessors, splitter persistence, test-debt issue. Each later plan is written against the file as it exists after the previous one merges.

---

## Task group A — Step 0: seam hardening (branch `refactor/m0-seam-hardening`)

### Task 1: Seam-audit battery (`test/seams.mjs`)

**Files:**
- Create: `test/seams.mjs`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/alan/Desktop/Projects/pygame-playground && git checkout -b refactor/m0-seam-hardening
```

- [ ] **Step 2: Write the failing test — the executable seam inventory**

Create `test/seams.mjs` with exactly this content:

```js
// Seam-audit battery: the EXECUTABLE inventory of every window/bare seam the ES-module
// refactor must preserve (spec 2026-07-01 §4). Read-only — no clicks, no runs — so it is
// safe to run at any point in the extraction. If this battery is green, the seam contract
// holds; if a refactor step silently drops a global, this fails by NAME instead of some
// unrelated suite failing by symptom.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['ready', 'running', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// 1. bare `pyodide` — a classic-script global (NOT necessarily window.pyodide).
const bare = await page.evaluate(() =>
  typeof pyodide !== 'undefined' && pyodide !== null && typeof pyodide.runPython === 'function');
bare ? ok('bare pyodide reachable + booted') : fail('bare pyodide missing/unbooted');

// 2. window.* FUNCTION seams (tests call these via window or bare-name-resolving-to-window).
const fns = ['setStatus', 'run', 'tabMenu', 'newFilePrompt', 'renderHistory', 'restoreSnapshot',
  'renderTabs', 'confirmModal', 'toast', '__closePopMenu', 'uploadFiles', 'openExample',
  'renderLessons', 'lessonClose', '__flushSave', 'runFile', '__engineDiag'];
const missingFns = await page.evaluate(
  (names) => names.filter(n => typeof window[n] !== 'function'), fns);
missingFns.length === 0
  ? ok('all ' + fns.length + ' window function seams present')
  : fail('missing window fns: ' + missingFns.join(', '));

// 3. window.* OBJECT seams.
const objs = ['project', 'assetFS', 'assetStore', 'historyStore', 'EXAMPLES', 'LESSONS',
  'FRIENDLY_ERRORS', 'editor'];
const missingObjs = await page.evaluate(
  (names) => names.filter(n => window[n] == null || typeof window[n] !== 'object' && typeof window[n] !== 'function'),
  objs);
missingObjs.length === 0
  ? ok('all ' + objs.length + ' window object seams present')
  : fail('missing window objects: ' + missingObjs.join(', '));

// 4. project API shape + LIVE CodeMirror Doc values (17 suites pin this).
const proj = await page.evaluate(() => {
  const p = window.project;
  if (!p) return { missing: true };
  const api = ['load', 'setActive', 'add', 'adoptDoc', 'addFolder', 'rename', 'move', 'remove',
    'serialize', 'text', 'isMulti'].filter(k => typeof p[k] !== 'function');
  const doc = p.files && p.files[p.active];
  return { api, liveDoc: !!doc && typeof doc.getValue === 'function',
           entry: typeof p.entry === 'string', order: Array.isArray(p.order) };
});
(!proj.missing && proj.api.length === 0 && proj.liveDoc && proj.entry && proj.order)
  ? ok('project API intact; files[] values are live CodeMirror Docs')
  : fail('project shape: ' + JSON.stringify(proj));

// 5. ONE CodeMirror + the identity invariant files[active] === editor.getDoc().
const cm = await page.evaluate(() => ({
  count: document.querySelectorAll('.CodeMirror').length,
  identity: !!window.project && !!window.editor && window.project.files[window.project.active] === window.editor.getDoc(),
}));
(cm.count === 1 && cm.identity)
  ? ok('ONE CodeMirror; files[active] === editor.getDoc()')
  : fail('CodeMirror invariant: ' + JSON.stringify(cm));

// 6. selectedFolder must LIVE on window and accept BARE writes (upload.mjs:140 assigns it bare).
// Proves residency + writability, NOT that modules read it live — upload.mjs checks 4/4b are the
// behavioral backstop for the live-read half of spec §4.2.
const sf = await page.evaluate(() => {
  if (typeof window.selectedFolder !== 'string') return 'window.selectedFolder is not a string';
  const prev = window.selectedFolder;
  selectedFolder = '__seamtest__';                 // bare write, exactly like upload.mjs
  const landed = window.selectedFolder === '__seamtest__';
  selectedFolder = prev;
  return landed || 'bare write did not land on window.selectedFolder';
});
sf === true ? ok('selectedFolder lives on window and accepts bare writes')
            : fail('selectedFolder: ' + sf);

// closedFolders: bare Set consumed typeof-guarded by upload.mjs/save.mjs. (__engineStallMs
// is a write-seam checked by freeze.mjs; not asserted here — it's undefined until a test sets it.)
const cf = await page.evaluate(() => typeof closedFolders !== 'undefined' && closedFolders instanceof Set);
cf ? ok('closedFolders bare Set present') : fail('closedFolders bare seam missing');

// 7. Laziness sentinels: heavy libs must NOT be loaded at boot; engine IS (eager boot kick).
const lazy = await page.evaluate(() => ({
  jszip: typeof window.JSZip, diff: typeof window.Diff,
  am: typeof window.__amLoaded, engine: window.__engineLoaded === true,
  eager: performance.getEntriesByType('resource').map(r => r.name)
    .filter(n => /automerge-collab\.mjs|jszip|jsdiff|ruff|addon\/lint\//i.test(n)),
}));
(lazy.jszip === 'undefined' && lazy.diff === 'undefined' && lazy.am === 'undefined' && lazy.engine && lazy.eager.length === 0)
  ? ok('lazy gates intact (JSZip/Diff/Automerge unloaded; engine loaded at boot)')
  : fail('laziness: ' + JSON.stringify(lazy));

// 8. #status token vocabulary (quiescent states only — this battery never starts a run).
const tok = await page.evaluate(() => document.getElementById('status').textContent);
['ready', 'running', 'finished', 'stopped', 'paused'].includes(tok)
  ? ok(`status token '${tok}' in vocabulary`)
  : fail('unexpected status token: ' + tok);

// 9. No JS errors during boot — the cheapest detector of "boots to ready but a moved
// module threw or 404'd after boot" during the module split.
jsErrors.length === 0 ? ok('no JS console errors during boot')
                      : fail('JS errors: ' + JSON.stringify(jsErrors.slice(0, 5)));

await browser.close();
console.log(process.exitCode ? 'SEAMS VERIFY FAILED' : 'SEAMS VERIFY OK');
```

- [ ] **Step 3: Run it — expect exactly THREE failures from TWO root causes**

Run: `node test/seams.mjs`
Expected output includes:
- `FAIL: missing window objects: editor` — `editor` is a top-level `const` (index.html:972); consts do NOT become window props.
- `FAIL: CodeMirror invariant: {"count":1,"identity":false}` — a DOWNSTREAM consequence of the same root cause: check 5's identity assertion reads `window.editor`, which doesn't exist yet. (The underlying identity is actually intact; the check turns meaningful after Task 3.)
- `FAIL: selectedFolder: window.selectedFolder is not a string` — `selectedFolder` is a top-level `let` (index.html:1877).
- Every OTHER check `ok -` (the function-seam check passes today because classic-script function *declarations* do create window props — the explicit block in Task 3 exists so they survive Task 5's function-wrapping, which destroys that implicit behavior).
Exit code 1.

- [ ] **Step 4: Commit the red battery (branch-only; it goes green within this group)**

```bash
git add test/seams.mjs
git commit -m "test(seams): executable seam inventory for the module split (red: editor, selectedFolder)"
```

### Task 2: `selectedFolder` → physical `window` residency

**Files:**
- Modify: `index.html` (17 references; anchors below)

Rationale: `test/upload.mjs:140` executes the bare statement `selectedFolder = ''` inside `page.evaluate`. Once explorer code moves into a module, a module-scoped `let` is unreachable and a read-only mirror silently diverges. The state must physically live at `window.selectedFolder`, and every use must read it live.

- [ ] **Step 1: Replace the declaration**

Find (anchor, currently index.html:1877):
```js
let selectedFolder = "";
```
Replace with:
```js
// selectedFolder LIVES on window (not a local): test/upload.mjs writes it BARE from
// page.evaluate, and the ES-module split (spec §4.2) needs the state reachable after the
// explorer moves out of this script. Every read below is a live window lookup.
window.selectedFolder = "";
```

- [ ] **Step 2: Rewrite every other reference to `window.selectedFolder`**

Update each of these lines (find by the quoted text; keep everything else on the line identical):

| Anchor (pre-edit line) | Change |
|---|---|
| 1533 `async function routeUpload(file, destFolder = selectedFolder) {` | default → `destFolder = window.selectedFolder` |
| 1570 `async function uploadFiles(files, destFolder = selectedFolder) {` | default → `destFolder = window.selectedFolder` |
| 1615 `uploadFiles([...e.target.files], selectedFolder); e.target.value = '';` | arg → `window.selectedFolder` |
| 1629 `uploadFiles([...e.dataTransfer.files], selectedFolder);` | arg → `window.selectedFolder` |
| 1910–1911 `if (selectedFolder && !project._fileDirs().has(selectedFolder) && !project.emptyDirs.has(selectedFolder))` / `selectedFolder = "";` | all four → `window.selectedFolder` |
| 1973 `selectedFolder = path;` | → `window.selectedFolder = path;` |
| 1985 `selectedFolder = dirname(name);` | → `window.selectedFolder = dirname(name);` |
| 2206 `const name = (selectedFolder && !leaf.includes("/")) ? selectedFolder + "/" + leaf : leaf;` | both → `window.selectedFolder` |
| 2208 `if (selectedFolder) project.emptyDirs.delete(selectedFolder);` | both → `window.selectedFolder` |
| 2223 `const path = selectedFolder ? selectedFolder + "/" + seg : seg;` | both → `window.selectedFolder` |
| 2236 `if (selectedFolder) closedFolders.delete(selectedFolder);` | both → `window.selectedFolder` |
| 2238 `const depth = selectedFolder ? selectedFolder.split("/").length : 0;` | both → `window.selectedFolder` |
| 2540 `selectedFolder = "";` | → `window.selectedFolder = "";` |
| 2560 `selectedFolder = "";` | → `window.selectedFolder = "";` |

- [ ] **Step 3: Verify no bare references remain**

Run: `grep -n '[^.]\bselectedFolder\b' index.html | grep -v 'window\.selectedFolder'`
Expected: no output (the only hits for `selectedFolder` are `window.selectedFolder` and the comment at old line 1493).

- [ ] **Step 4: Run the directly-affected suites, then seams**

Run: `node test/upload.mjs && node test/explorer-tree.mjs && node test/explorer-actions.mjs && node test/explorer-dnd.mjs && node test/seams.mjs`
Expected: upload/explorer suites GREEN. `seams.mjs` now fails ONLY on `missing window objects: editor`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "refactor(m0): selectedFolder lives on window (bare-write test seam, spec §4.2)"
```

### Task 3: Explicit window seam exports

**Files:**
- Modify: `index.html` (append inside the app script, immediately BEFORE the final `booted.catch(() => {});` line at the script tail)

- [ ] **Step 1: Add the seam-export block**

Find the script tail (anchor):
```js
booted.catch(() => {});
</script>
```
Insert ABOVE `booted.catch(() => {});`:

```js
// ---------------------------------------------------------------- explicit window seams (spec §4.1)
// Every name below is reached by tests via window.* or a bare name that resolves through
// window. Today most resolve implicitly (classic-script function declarations become window
// props). The ES-module split wraps this body in a function (killing that implicit behavior)
// and then moves each definition into src/*.mjs — so the contract is made EXPLICIT here first.
// When a definition moves to a module, DELETE its line here; src/main.mjs assigns it instead.
window.run = run;                        // spike-assets.mjs
window.tabMenu = tabMenu;                // collab-multifile-b.mjs
window.newFilePrompt = newFilePrompt;    // collab-multifile-b.mjs
window.renderHistory = renderHistory;    // collab-multifile-b.mjs
window.restoreSnapshot = restoreSnapshot;// collab-multifile-b.mjs
window.editor = editor;                  // explorer-actions.mjs (bare `editor.getDoc()`)
window.setStatus = setStatus;            // shell.mjs, examples.mjs (bare calls)
```

- [ ] **Step 2: seams.mjs goes green**

Run: `node test/seams.mjs`
Expected: all 8 checks `ok -`, exit 0.

- [ ] **Step 3: Full battery**

Run the full battery loop from the Context section.
Expected: `BATTERY GREEN`.

- [ ] **Step 4: Commit and merge**

```bash
git add index.html
git commit -m "refactor(m0): explicit window assignments for implicitly-global test seams"
git checkout main && git merge --no-ff refactor/m0-seam-hardening -m "merge: step-0 seam hardening + seams.mjs audit battery"
```

---

## Task group B — bootstrap + examples-data (branch `refactor/m1-examples-data`)

### Task 4: Create `src/examples-data.mjs`

**Files:**
- Create: `src/examples-data.mjs`

- [ ] **Step 1: Branch**

```bash
git checkout -b refactor/m1-examples-data
```

- [ ] **Step 2: Create the module**

Create `src/examples-data.mjs` with this skeleton, then CUT-AND-PASTE each example's `String.raw` template literal **verbatim** from index.html (the `const EXAMPLES = {` block, anchor `// ---------------------------------------------------------------- examples`, currently lines 568–937 — six keys: `"Swimming fish"`, `"Bouncy balls"`, `"Arrow-key square"`, `"Mouse painter"`, `"Starfield"`, `"Snake"`). Do not retype or re-indent the Python. The `filename` values come from the `EXAMPLE_FILENAME` table (anchor line 943).

```js
// src/examples-data.mjs — the built-in examples (pure data; ~10% of the old index.html).
// EAGER on purpose: loadInitialProject's fallback seed reads EXAMPLES[DEFAULT_EXAMPLE] at
// boot, and the hidden #examples select (a verify.mjs seam) is populated from the keys.
// One list is the single source of truth so name/filename/source can't drift (spec §3.2 #4).
const LIST = [
  { name: "Swimming fish", filename: "swimming_fish.py", source: String.raw`<VERBATIM from index.html>` },
  { name: "Bouncy balls", filename: "bouncy_balls.py", source: String.raw`<VERBATIM>` },
  { name: "Arrow-key square", filename: "arrow_key_square.py", source: String.raw`<VERBATIM>` },
  { name: "Mouse painter", filename: "mouse_painter.py", source: String.raw`<VERBATIM>` },
  { name: "Starfield", filename: "starfield.py", source: String.raw`<VERBATIM>` },
  { name: "Snake", filename: "snake.py", source: String.raw`<VERBATIM>` },
];

export const EXAMPLES = Object.freeze(Object.fromEntries(LIST.map(e => [e.name, e.source])));
export const EXAMPLE_FILENAME = Object.freeze(Object.fromEntries(LIST.map(e => [e.name, e.filename])));
export const DEFAULT_EXAMPLE = LIST[0].name;   // "Swimming fish" — the boot seed

if (typeof window !== "undefined") {
  window.EXAMPLES = EXAMPLES;                    // PINNED test seam (examples.mjs; verify.mjs 'Snake')
  window.EXAMPLE_FILENAME = EXAMPLE_FILENAME;    // transitional mirror (legacy bare refs) — Plan 4 retires
  window.DEFAULT_EXAMPLE = DEFAULT_EXAMPLE;      // transitional mirror — Plan 4 retires
}
```

(The `<VERBATIM ...>` markers are cut-paste instructions for the six existing template literals — the ONLY placeholders in this plan, and they refer to existing text, not text to invent.)

- [ ] **Step 3: Node smoke test (module is browser-independent by design)**

Run:
```bash
node --input-type=module -e "const m = await import('./src/examples-data.mjs'); \
  if (Object.keys(m.EXAMPLES).length !== 6) throw new Error('want 6 examples'); \
  if (!m.EXAMPLES['Snake']) throw new Error('Snake missing (verify.mjs seam)'); \
  if (m.DEFAULT_EXAMPLE !== 'Swimming fish') throw new Error('wrong default'); \
  if (m.EXAMPLE_FILENAME['Snake'] !== 'snake.py') throw new Error('filename map'); \
  console.log('ok - examples-data module shape');"
```
Expected: `ok - examples-data module shape`.

- [ ] **Step 4: Byte-diff the moved Python (engine-extraction precedent)**

For each example, confirm the template-literal content in `src/examples-data.mjs` is byte-identical to what `index.html` still contains (they coexist until Task 5). Spot-check at minimum the first and last lines of each blob; a stronger check lands in Task 5 Step 6 when the battery runs the real code.

- [ ] **Step 5: Commit**

```bash
git add src/examples-data.mjs
git commit -m "refactor(m1): examples as a data module (src/examples-data.mjs) — not yet wired"
```

### Task 5: Bootstrap conversion — prelude + `__appMain` + `src/main.mjs`; delete host EXAMPLES

**Files:**
- Create: `src/main.mjs`
- Modify: `index.html` (script head, script tail, EXAMPLES deletion)

This is the structural pivot of the whole refactor. Three edits to index.html plus one new file.

- [ ] **Step 1: Create `src/main.mjs`**

```js
// src/main.mjs — the orchestrator (spec §3.2 #19). During the incremental extraction it:
//   1. eagerly imports the extracted modules (pure dependency-free text: one cached fetch
//      each, no network waits — the first-paint invariant, spec §2),
//   2. publishes their window seams / transitional mirrors,
//   3. hands control to the legacy app body still living in index.html (window.__appMain).
// Each extraction moves code out of __appMain into a module imported here. Final shape
// (Plan 4): __appMain is gone and init() owns the boot order outright.
import "./examples-data.mjs";   // self-publishes window.EXAMPLES (+ transitional mirrors)

export async function init(host) {
  // host = { pySeam: { get, set } } — the classic script owns the bare `pyodide` binding;
  // src/run.mjs (Plan 4) will publish the booted interpreter through pySeam.set.
  window.__pySeam = host.pySeam;   // transitional handle until run.mjs exists — Plan 4 retires
  await window.__appMain();
}
```

- [ ] **Step 2: Rewrite the script head — prelude + wrapper open**

Find the opening of the app script (anchor: the `<script>` tag right after the five CodeMirror CDN tags, currently line 566, followed by `// ---------------------------------------------------------------- examples`). Replace the single line `<script>` with:

```html
<script>
// ---------------------------------------------------------------- host prelude (classic, forever)
// THE bare interpreter seam: ~17 suites reach `pyodide` by BARE NAME in page.evaluate, and
// test/engine-extraction.mjs asserts this script stays classic (a module script would hide
// top-level bindings). The binding lives here; modules reach it ONLY through pySeam.
let pyodide = null;
const pySeam = { get: () => pyodide, set: (v) => { pyodide = v; } };

// The legacy app body, wrapped so src/main.mjs controls when it runs. Function declarations
// inside are no longer implicit window props — the explicit seam-export block near the end
// of this function (Step 0, spec §4.1) preserves every pinned name.
window.__appMain = async function () {
```

- [ ] **Step 3: Rewrite the script tail — wrapper close + bootstrap + failure fallback**

Find the script tail (anchor: `booted.catch(() => {});` followed by `</script>`). Replace those two lines with:

```js
booted.catch(() => {});
};   // end window.__appMain

// ---------------------------------------------------------------- bootstrap (spec §3.1)
// Cached-promise dynamic import — the SAME pattern as loadEngine()/loadAutomerge():
// relative + document.baseURI so it resolves under the GitHub Pages project subpath.
// NEVER a <script type=module> tag (engine-extraction.mjs C5; parse-order seams).
import(new URL("./src/main.mjs", document.baseURI).href)
  .then((m) => m.init({ pySeam }))
  .catch((e) => {
    // main.mjs itself failed to load — setStatus/logLine don't exist yet; write the DOM
    // directly. 'boot failed' is an existing pinned status token.
    const st = document.getElementById("status");
    if (st) { st.className = "pill error"; st.textContent = "boot failed"; }
    const con = document.getElementById("console");
    if (con) { const d = document.createElement("div"); d.textContent = "App failed to load: " + e; con.appendChild(d); }
  });
</script>
```

- [ ] **Step 4: Delete the duplicated `let pyodide` from the body**

Inside the (now-wrapped) body, find the anchor `// ---------------------------------------------------------------- pyodide boot` (currently line 3502). Delete ONLY the line `let pyodide = null;` (currently 3504) — the binding moved to the prelude; all `pyodide = ...` assignments in the body now close over it. Keep `const PYODIDE_BASE`, `let runTask`, `let runStderr`, `let engine` exactly where they are.

- [ ] **Step 5: Delete the host EXAMPLES block**

Delete from the anchor `const EXAMPLES = {` (below `// ---------------------------------------------------------------- examples`) through the line `const DEFAULT_EXAMPLE = "Swimming fish";   // boot seed (replaces the removed `loadedExample` var)` inclusive — that is: the EXAMPLES map, the `window.EXAMPLES = EXAMPLES;` line, the `EXAMPLE_FILENAME` table, and the `DEFAULT_EXAMPLE` const (all now provided by the module). Leave the `// ---- examples` section comment with a one-line pointer:

```js
// ---------------------------------------------------------------- examples
// EXAMPLES / EXAMPLE_FILENAME / DEFAULT_EXAMPLE moved to src/examples-data.mjs (imported by
// src/main.mjs, published on window). Bare references below resolve via window.*.
```

- [ ] **Step 6: Full battery (the bootstrap-timing gate)**

Run the full battery loop.
Expected: `BATTERY GREEN`. This run specifically flushes the "init moved from parse-time to microtask+fetch" latent race the spec §5 flags — every suite gates on `#status`/selectors, so green here proves the timing holds. If a suite fails on a missing global at page-load time, the fix is in that code path's ordering inside `init()`/`__appMain` — do NOT touch the test.

- [ ] **Step 7: Commit and merge**

```bash
git add index.html src/main.mjs
git commit -m "refactor(m1): host prelude + __appMain wrapper + src/main.mjs bootstrap; examples out of index.html"
git checkout main && git merge --no-ff refactor/m1-examples-data -m "merge: module-split step 1 — bootstrap + examples-data"
```

---

## Task group C — lessons-data (branch `refactor/m2-lessons-data`)

### Task 6: Create `src/lessons-data.mjs`, delete host block

**Files:**
- Create: `src/lessons-data.mjs`
- Modify: `index.html`, `src/main.mjs`

- [ ] **Step 1: Branch** — `git checkout -b refactor/m2-lessons-data`

- [ ] **Step 2: Create the module**

Cut the entire `window.LESSONS = [ ... ];` assignment (anchor: comment block `// Declarative lesson content (data, not code)…`, currently starting index.html:2934, array 2938–3098) and the entire `window.FRIENDLY_ERRORS = [ ... ];` assignment (anchor comment `// Friendly-error map (declarative)…`, currently 3099–3110) — VERBATIM, including their comment blocks — into:

```js
// src/lessons-data.mjs — declarative lesson + friendly-error content (pure data).
// EAGER and assigned to window EXACTLY ONCE at module eval: test/lessons.mjs REPLACES
// window.LESSONS wholesale and then calls window.renderLessons() — a late (re-)assignment
// would clobber the test's array (spec red-flag §3.2 #5). The renderer re-reads
// window.LESSONS on every call; nothing may capture this module's binding.
// NOT frozen: the whole-array replacement contract implies callers own the value.

<the two verbatim blocks, unchanged>

export const LESSONS = window.LESSONS;                 // module-side handles (same objects)
export const FRIENDLY_ERRORS = window.FRIENDLY_ERRORS;
```

(This module touches `window` unconditionally — it is browser-only by nature; no node smoke test.)

- [ ] **Step 3: Replace the host block with a pointer comment**

At the cut site in index.html leave:
```js
// window.LESSONS / window.FRIENDLY_ERRORS moved to src/lessons-data.mjs (assigned once,
// eagerly, at module eval — see the clobber-hazard note there).
```

- [ ] **Step 4: Wire into main.mjs** — add below the examples-data import:

```js
import "./lessons-data.mjs";    // self-publishes window.LESSONS / window.FRIENDLY_ERRORS (assign-once)
```

- [ ] **Step 5: Targeted suites, then full battery**

Run: `node test/lessons.mjs && node test/seams.mjs`
Expected: GREEN — in particular the lessons.mjs wholesale-replacement checks (this is the clobber-hazard gate).
Then the full battery. Expected: `BATTERY GREEN`.

- [ ] **Step 6: Commit and merge**

```bash
git add index.html src/main.mjs src/lessons-data.mjs
git commit -m "refactor(m2): lessons + friendly-error data module (assign-once window contract)"
git checkout main && git merge --no-ff refactor/m2-lessons-data -m "merge: module-split step 2 — lessons-data"
```

---

## Task group D — util (branch `refactor/m3-util`)

### Task 7: Create `src/util.mjs`, delete host definitions, add mirrors

**Files:**
- Create: `src/util.mjs`
- Modify: `index.html`, `src/main.mjs`

- [ ] **Step 1: Branch** — `git checkout -b refactor/m3-util`

- [ ] **Step 2: Create the module**

`src/util.mjs` — the pure-helper leaf. Bodies marked *(verbatim)* are cut from index.html at the anchors given; the rest is new:

```js
// src/util.mjs — pure helpers + lazy-load primitives. Zero DOM-state, zero app-state:
// everything here is importable from node (the smoke test below relies on it) except the
// two tag injectors, which touch document only when CALLED.

// HTML-escape for interpolating names into innerHTML (verbatim; was `esc` at ~1584 and its
// byte-identical twin `escTab` at ~1758 — one implementation now, two window mirrors).
export const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// CSS attribute-selector-safe value (verbatim from ~2626).
export const cssAttr = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// POSIX-ish path halves (verbatim from ~1959-1960).
export const basename = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); };
export const dirname = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };

// Human-readable byte size (verbatim from ~1580-1581).
export const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(0) + ' KB'
  : n < 1073741824 ? (n/1048576).toFixed(1) + ' MB' : (n/1073741824).toFixed(2) + ' GB';

// URL-safe base64 (verbatim from ~1000-1003). Deliberately NOT modernized to TextEncoder:
// old #project=/#code= share links must keep decoding byte-identically (share-removed.mjs
// hand-produces the legacy encoding), and 2 working lines don't earn churn.
export const b64url = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

// Path-shape validators (verbatim, WITH their explanatory comments, from ~1014-1032).
export const isModuleName = (name) =>
  typeof name === "string" &&
  /^([A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(name) &&
  !name.split("/").includes("..");
export const isFolderSegment = (seg) => /^[A-Za-z_]\w*$/.test(seg);
export const isAssetPath = (path) =>
  typeof path === "string" &&
  /^([^/]+\/)*[^/]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").includes("..") &&
  !path.split("/").includes("");

// Presence helpers (verbatim from ~3927-3928; collab imports these properly in Plan 4).
export const pickFrom = (a) => a[Math.floor(Math.random() * a.length)];
export const before = (a, b) => a.line < b.line || (a.line === b.line && a.ch <= b.ch);

// One-shot cached dynamic import — the loadEngine()/loadAutomerge() pattern, shared.
// NO retry-on-failure (matches both existing callers: a failed engine/collab load is
// surfaced, not silently retried). onFirst runs once, for sentinel side-effects.
const _importCache = new Map();
export function importOnce(url, onFirst) {
  let p = _importCache.get(url);
  if (!p) { p = import(url).then((m) => { onFirst?.(m); return m; }); _importCache.set(url, p); }
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
```

Design deviation, recorded: the spec's `idbStore` factory is DEFERRED to Plan 2 — its only consumers (`assetStore`, `historyStore`) extract there, and shipping an unconsumed factory now would be untested code (YAGNI).

- [ ] **Step 3: Node smoke test**

```bash
node --input-type=module -e "const u = await import('./src/util.mjs'); \
  if (u.esc('<a \"b\">') !== '&lt;a &quot;b&quot;&gt;') throw new Error('esc'); \
  if (u.b64url.dec(u.b64url.enc('héllo/π')) !== 'héllo/π') throw new Error('b64url roundtrip'); \
  if (!u.isModuleName('sprites/enemy.py') || u.isModuleName('../x.py')) throw new Error('isModuleName'); \
  if (u.dirname('a/b/c.py') !== 'a/b' || u.basename('a/b/c.py') !== 'c.py') throw new Error('paths'); \
  if (u.fmtSize(2048) !== '2 KB') throw new Error('fmtSize'); \
  console.log('ok - util module');"
```
Expected: `ok - util module`.

- [ ] **Step 4: Delete the host definitions**

Delete from index.html (each replaced by nothing — bare references now resolve via the mirrors wired in Step 5):
- `const b64url = { ... };` (anchor ~1000–1003)
- the three validators + their comments: `isModuleName`, `isFolderSegment`, `isAssetPath` (anchor ~1014–1032)
- `const fmtSize = ...` and `const esc = ...` + its comment (anchor ~1580–1584)
- `const escTab = ...` (anchor ~1758)
- `const basename = ...` / `const dirname = ...` (anchor ~1959–1960)
- `function cssAttr(s) { ... }` + its comment (anchor ~2624–2626)
- `const pickFrom = ...` / `const before = ...` (anchor ~3927–3928)

Do NOT touch `loadLinter`/`loadEngine`/`loadAutomerge`/`loadJSZip`/`loadDiffLib` — they extract with their modules (lint here in Task 10; the rest Plans 2–4).

- [ ] **Step 5: Wire mirrors in `src/main.mjs`**

Add at top: `import * as util from "./util.mjs";`
Inside `init()`, BEFORE `await window.__appMain()`:

```js
  // Transitional mirrors: the legacy __appMain body references these bare. Each line is
  // deleted in Plan 4 when the last bare consumer has moved into a module. NONE are pinned.
  Object.assign(window, {
    esc: util.esc, escTab: util.esc,            // escTab was a byte-identical twin — one impl now
    basename: util.basename, dirname: util.dirname,
    fmtSize: util.fmtSize, cssAttr: util.cssAttr, b64url: util.b64url,
    isModuleName: util.isModuleName, isFolderSegment: util.isFolderSegment, isAssetPath: util.isAssetPath,
    pickFrom: util.pickFrom, before: util.before,
  });
```

- [ ] **Step 6: Full battery** — Expected: `BATTERY GREEN`. (share-removed.mjs is the b64url-compat gate; explorer suites cover esc/paths; collab suites cover pickFrom/before.)

- [ ] **Step 7: Commit and merge**

```bash
git add index.html src/main.mjs src/util.mjs
git commit -m "refactor(m3): pure-helper util module (esc dedup, paths, validators, lazy-load primitives)"
git checkout main && git merge --no-ff refactor/m3-util -m "merge: module-split step 3 — util"
```

---

## Task group E — ui (branch `refactor/m4-ui`)

### Task 8: Create `src/ui.mjs` (logLine/setStatus/tooltip), delete host definitions

**Files:**
- Create: `src/ui.mjs`
- Modify: `index.html`, `src/main.mjs`

- [ ] **Step 1: Branch** — `git checkout -b refactor/m4-ui`

- [ ] **Step 2: Create the module**

```js
// src/ui.mjs — console/status plumbing + the shared tooltip. DOM-only leaf; nearly every
// later module imports logLine/setStatus, so this extracts early (spec §3.2 #2).
// Module eval runs after HTML parse (dynamic import from the tail script), so the
// getElementById calls below are safe.

export const consoleEl = document.getElementById("console");
export const statusEl = document.getElementById("status");
export const canvasEl = document.getElementById("canvas");

// (verbatim from index.html ~962-970)
export function logLine(text, cls) {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = text;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
export function clearConsole() { consoleEl.textContent = ""; }
// THE single #status writer (spec §4.6): exact token strings are compared with === in ~28
// test files, and shell.mjs asserts the 'pill'/'pill <state>' className on every write.
// Byte-identical to the original. Never add a second writer.
export function setStatus(cls, text) { statusEl.className = "pill" + (cls ? " " + cls : ""); statusEl.textContent = text; }

// Shared hover/focus tooltip (verbatim IIFE body from ~3403-3432, run at module eval —
// same effective timing as the old parse-time IIFE: installed before any interaction).
<the IIFE body, verbatim, NOT wrapped in a function — module scope replaces the IIFE scope>
```

(For the tooltip: paste the body of the `(function () { ... })();` block — the `const tip = ...` through the `window.addEventListener("scroll", hide, true);` lines — directly at module top level. The IIFE existed only to scope `tip`/`cur`/`show`/`hide`; module scope now does that.)

- [ ] **Step 3: Delete host definitions**

- the `// ---------------------------------------------------------------- UI plumbing` block: `consoleEl`/`statusEl`/`canvasEl` consts + `logLine` + `clearConsole` + `setStatus` (anchor ~957–970). Keep the section comment with a pointer: `// consoleEl/statusEl/canvasEl + logLine/clearConsole/setStatus moved to src/ui.mjs.`
- the whole tooltip IIFE incl. its section comment (anchor `// ---------------------------------------------------------------- shared hover/focus tooltip`, ~3402–3432).
- in the Step-0 seam block: delete the `window.setStatus = setStatus;` line (main.mjs owns it now).

- [ ] **Step 4: Wire in `src/main.mjs`**

Add `import * as ui from "./ui.mjs";` and extend the `Object.assign(window, { ... })` with:

```js
    consoleEl: ui.consoleEl, statusEl: ui.statusEl, canvasEl: ui.canvasEl,   // transitional
    logLine: ui.logLine, clearConsole: ui.clearConsole,                       // transitional
    setStatus: ui.setStatus,                                                  // PINNED (shell.mjs, examples.mjs)
```

- [ ] **Step 5: Targeted then full battery**

Run: `node test/shell.mjs && node test/seams.mjs` — shell.mjs is the direct gate (status pill classes, tooltip role, first-paint). Then the full battery.
Expected: `BATTERY GREEN`.

- [ ] **Step 6: Commit and merge**

```bash
git add index.html src/main.mjs src/ui.mjs
git commit -m "refactor(m4): ui module — logLine/clearConsole/setStatus (sole #status writer) + tooltip"
git checkout main && git merge --no-ff refactor/m4-ui -m "merge: module-split step 4 — ui"
```

---

## Task group F — dialogs (branch `refactor/m5-dialogs`)

### Task 9: Create `src/dialogs.mjs` (modal, toast, popmenu, shared inline-edit), rebuild the two host wrappers

**Files:**
- Create: `src/dialogs.mjs`
- Modify: `index.html`, `src/main.mjs`

This is the first extraction with a real deep-cleanup: `startInlineCreate` (~2232–2273) and `startInlineRename` (~2445–2507) duplicate the input-lifecycle machinery (Enter-commit / Esc-or-blur-cancel via `setTimeout(0)` / `.invalid` + `.rename-hint` / async-commit freeze). The shared core moves to dialogs; the two explorer-specific wrappers stay in the host body (they extract with explorer in Plan 2) but shrink to their genuinely-different halves.

- [ ] **Step 1: Branch** — `git checkout -b refactor/m5-dialogs`

- [ ] **Step 2: Create the module**

```js
// src/dialogs.mjs — modal (user choices), toast (notices), the shared popup action menu,
// and the shared inline-edit input machinery. Zero app-model coupling (spec §3.2 #3).
import { esc } from "./util.mjs";

// ============================================================== popup action menu (Slice B)
<VERBATIM move of the block from anchor "// =============================================================== Slice B: popup action menu":
  popMenuEl creation + popAnchor (was ~2279-2284),
  function closePopMenu (was ~2286-2293),
  function openPopMenu (was ~2368-2403)  — change its one `escTab(` call to `esc(`,
  the popMenuEl keydown listener (was ~2406-2419),
  the document Escape-capture, outside-mousedown, resize listeners (was ~2422-2431)>
// Scroll on the explorer tree dismisses the menu. dialogs doesn't import explorer (leaf
// module) — the tree is reached by id; explorer re-wires this via a callback in Plan 2.
document.getElementById("tabs").addEventListener("scroll", () => closePopMenu(false), true);
// (verbatim from ~2435-2438)
export function rowMenuBtn(rowSel) {
  const row = document.querySelector(rowSel);
  return row ? row.querySelector(".tab-menu") : null;
}
export { closePopMenu, openPopMenu };
window.__closePopMenu = closePopMenu;   // PINNED test seam (explorer-actions.mjs)

// ============================================================== modal + toast (#13)
<VERBATIM move: _modalState + function confirmModal (was ~2300-2331) + function closeModal
 (was ~2332-2338) + the capture keydown trap (was ~2340-2350) + _toastHost + function toast
 (was ~2355-2364). Drop the old inline `window.confirmModal = ...` / `window.toast = ...`
 lines — main.mjs assigns them (pinned) in one place.>
export { confirmModal, closeModal, toast };

// ============================================================== shared inline-edit machinery
// Distilled from the formerly-duplicated create/rename rows. Contract (all preserved
// behaviors are load-bearing for explorer-actions.mjs/upload.mjs):
//   - Enter commits; Escape cancels; blur cancels ON THE NEXT TICK (so a commit-triggered
//     repaint doesn't race the blur).
//   - commit(raw, hint) returns: true/undefined = success (row was re-rendered by the
//     handler), false = stay open (hint already shown), Promise<boolean> = async commit.
//   - During an async commit the input is FROZEN via readOnly — NOT disabled: disabling a
//     focused input fires blur, which would race the pending guard (old ~2482-2483).
//   - On async false the calm hint keeps the row in edit; on rejection likewise.
export function inlineInput({ value = "", ariaLabel = "" } = {}) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = value;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  return input;
}
export function wireInlineEdit(input, row, { commit, cancel, asyncFailHint = "invalid or in use" }) {
  let done = false, pending = false;
  const hint = (msg) => {
    input.classList.add("invalid");
    let h = row.querySelector(".rename-hint");
    if (!h) { h = document.createElement("span"); h.className = "rename-hint"; row.appendChild(h); }
    h.textContent = msg; input.focus();
  };
  const doCancel = () => { if (done || pending) return; done = true; cancel(); };
  const tryCommit = () => {
    if (done || pending) return;
    const res = commit(input.value.trim(), hint, doCancel);
    if (res && typeof res.then === "function") {
      pending = true;
      input.readOnly = true;   // freeze, never disable (blur race — see contract above)
      res.then((okd) => {
        pending = false;
        if (done) return;                  // a success repaint already replaced the input
        input.readOnly = false;
        if (okd) { done = true; }
        else hint(asyncFailHint);
      }, () => { pending = false; if (!done) { input.readOnly = false; hint("rename failed"); } });
      return;
    }
    if (res !== false) done = true;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); tryCommit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); doCancel(); }
  });
  input.addEventListener("input", () => {
    input.classList.remove("invalid");
    const h = row.querySelector(".rename-hint"); if (h) h.remove();
  });
  input.addEventListener("blur", () => { setTimeout(() => doCancel(), 0); });
}
```

Listener-order note (document in the commit message): the modal Escape trap and popmenu Escape/outside-click captures now register at module eval — EARLIER relative to host-body listeners than before. Both handlers no-op unless their surface is open, and no other capture handler consumes Escape first, so semantics are unchanged; `test/modal.mjs` + `test/explorer-actions.mjs` gate this.

- [ ] **Step 3: Delete the moved blocks from index.html**

Delete: the popmenu block (~2274–2294 incl. `window.__closePopMenu` line), the modal+toast block (~2296–2365 incl. the two `window.*` assignment lines), the openPopMenu/keyboard/dismiss block (~2367–2438 incl. `rowMenuBtn`). Leave one pointer comment: `// popup menu + modal + toast + inline-edit core moved to src/dialogs.mjs.`

- [ ] **Step 4: Rebuild the two host wrappers on the shared core**

Replace `startInlineCreate` (anchor `function startInlineCreate(kind) {`) ENTIRELY with:

```js
function startInlineCreate(kind) {
  // Guard BEFORE any renderTabs: if a create row is already open, keep it (don't repaint it
  // away or stack a second one). (#9-review: the old guard ran AFTER renderTabs and never fired.)
  if (tabsEl.querySelector(".tab.creating")) return;
  if (window.selectedFolder) closedFolders.delete(window.selectedFolder);   // destination visible
  renderTabs();
  const depth = window.selectedFolder ? window.selectedFolder.split("/").length : 0;
  const pad = 6 + depth * 14 + (kind === "folder" ? 0 : 12);
  const row = document.createElement("div");
  row.className = `tab ${kind === "folder" ? "folder" : "py"} creating`;
  row.style.paddingLeft = pad + "px";
  row.innerHTML = `<span class="ic" aria-hidden="true">${kind === "folder" ? "📁" : "🐍"}</span>`;
  const input = inlineInput({ ariaLabel: kind === "folder" ? "New folder name" : "New file name" });
  row.appendChild(input);
  tabsEl.appendChild(row);
  wireInlineEdit(input, row, {
    // #9-review: a stale deferred blur-cancel on a detached row must not repaint over a newer row.
    cancel: () => { if (row.isConnected) renderTabs(); },
    commit: (raw, hint, cancel) => {
      if (!raw) { cancel(); return false; }                       // empty -> cancel cleanly
      return kind === "folder" ? createFolder(raw, hint) : createFile(raw, hint);
    },
  });
  input.focus();
}
```

Replace `startInlineRename` (anchor `function startInlineRename(rowSel, fullPath, commit) {`) ENTIRELY with:

```js
function startInlineRename(rowSel, fullPath, commit) {
  closePopMenu(false);
  const row = document.querySelector(rowSel);
  if (!row) return;
  const nameSpan = row.querySelector(".tab-name");
  if (!nameSpan || row.querySelector(".rename-input")) return;
  const base = basename(fullPath);
  const dot = base.lastIndexOf(".");
  const input = inlineInput({ value: base, ariaLabel: `Rename ${base}` });
  const cleanup = () => { try { row.classList.remove("renaming"); } catch {} };
  wireInlineEdit(input, row, {
    cancel: () => { cleanup(); renderTabs(); },
    commit: (raw, hint, cancel) => {
      if (!raw || raw === base) { cancel(); return false; }   // no-op / empty -> cancel cleanly
      const dir = dirname(fullPath);
      const next = dir ? dir + "/" + raw : raw;
      const res = commit(next, raw, hint);
      // Async path (asset rename): the shared core freezes the input; on success we still
      // owe the caller-side cleanup if no repaint replaced the row (old ~2488).
      if (res && typeof res.then === "function") return res.then((okd) => { if (okd) cleanup(); return okd; });
      if (res === false) return false;
      cleanup();                     // success -> the handler re-rendered (renderTabs)
      return true;
    },
  });
  nameSpan.replaceWith(input);
  row.classList.add("renaming");
  // select the stem (name without extension) so a quick retype keeps the ext.
  input.focus();
  if (dot > 0) input.setSelectionRange(0, dot); else input.select();
}
```

- [ ] **Step 5: Wire in `src/main.mjs`**

Add `import * as dialogs from "./dialogs.mjs";` and extend the mirror block:

```js
    confirmModal: dialogs.confirmModal,   // PINNED (modal.mjs + _harness acceptModal, ~9 suites)
    toast: dialogs.toast,                 // PINNED (modal.mjs)
    closePopMenu: dialogs.closePopMenu,   // transitional (host bare calls); __closePopMenu pinned in-module
    openPopMenu: dialogs.openPopMenu,     // transitional
    rowMenuBtn: dialogs.rowMenuBtn,       // transitional
    inlineInput: dialogs.inlineInput,     // transitional (host wrappers)
    wireInlineEdit: dialogs.wireInlineEdit,   // transitional
```

- [ ] **Step 6: Targeted suites — the behavioral-parity gate for the inline-edit rebuild**

Run: `node test/modal.mjs && node test/explorer-actions.mjs && node test/explorer-tree.mjs && node test/explorer-dnd.mjs && node test/upload.mjs && node test/assets.mjs`
Expected: all GREEN. explorer-actions.mjs exercises rename (sync AND async/asset paths, Escape/blur/invalid-hint); any red here means the shared core broke a contract line — fix `wireInlineEdit`, not the test.

- [ ] **Step 7: Full battery** — Expected: `BATTERY GREEN`.

- [ ] **Step 8: Commit and merge**

```bash
git add index.html src/main.mjs src/dialogs.mjs
git commit -m "refactor(m5): dialogs module — modal/toast/popmenu + shared inline-edit core (create/rename dedup)"
git checkout main && git merge --no-ff refactor/m5-dialogs -m "merge: module-split step 5 — dialogs"
```

---

## Task group G — lint (branch `refactor/m6-lint`)

### Task 10: Create `src/lint.mjs`, delete host block

**Files:**
- Create: `src/lint.mjs`
- Modify: `index.html`, `src/main.mjs`

- [ ] **Step 1: Branch** — `git checkout -b refactor/m6-lint`

- [ ] **Step 2: Create the module**

```js
// src/lint.mjs — ruff-wasm auto-lint (spec §3.2 #14). MODULE TEXT is eager (the change
// listener must be armed from first paint); the LIBRARIES are strictly lazy — nothing
// below loads until the first edit (first-paint invariant; lint.mjs battery asserts it).
import { loadScriptTag, loadCssTag } from "./util.mjs";
import { logLine } from "./ui.mjs";

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
    await mod.default();                                       // wasm init
    return new mod.Workspace({ lint: { select: ["F"] } });     // F-codes + syntax; no E/W style noise
  })().catch((e) => { _linter = null; throw e; });             // reset -> a later edit retries
}

// (verbatim from the old lintAnnotations; CodeMirror is the classic CDN global)
export function lintAnnotations(workspace, text) {
  let diags;
  try { diags = workspace.check(text); } catch { return []; }   // a linter hiccup must never block editing
  return diags.map((d) => ({
    from: CodeMirror.Pos(d.start_location.row - 1, d.start_location.column - 1),   // ruff 1-based; CM 0-based
    to: CodeMirror.Pos(d.end_location.row - 1, d.end_location.column - 1),
    message: (d.code ? d.code + ": " : "") + d.message,
    severity: LINT_ERROR.has(d.code) ? "error" : "warning",
  }));
}

let lintArmed = false, lintNoteShown = false;
export function armLint() {
  if (lintArmed) return;
  lintArmed = true;
  // window.editor: transitional until src/editor.mjs (next task) — after that this module
  // still reads the same instance through the same seam; Plan 4 converts it to an import.
  const ed = window.editor;
  loadLinter().then((workspace) => {
    ed.setOption("gutters", ["CodeMirror-linenumbers", "CodeMirror-lint-markers"]);
    ed.setOption("lint", { getAnnotations: (text) => lintAnnotations(workspace, text), delay: 350 });
    ed.performLint();
  }).catch(() => {
    // Re-arm so a later edit retries when the network returns, but only note it once.
    lintArmed = false;
    if (!lintNoteShown) { lintNoteShown = true; logLine("Linting unavailable — couldn't load the checker.", "sys"); }
  });
}
```

Cleanup note (spec §3.2 #14 "collapse the two overlapping retry mechanisms"): the two retries were `_linter = null` (loader reset) and `lintArmed = false` (arm reset). Inspection shows they are NOT redundant — the loader reset lets `loadLinter()` re-fetch, the arm reset lets a later keystroke re-invoke it; removing either breaks offline-recovery. Both stay, now with this comment. (Deviation from the design bullet, justified: the "overlap" dissolves under inspection.)

- [ ] **Step 3: Delete the host block, keep the arming line**

Delete the auto-lint block (anchor `// ---------------------------------------------------------------- auto-lint (lazy, independent of Pyodide)`, ~1206–1248) — consts, `_linter`, `loadLinter`, `lintAnnotations`, `armLint`. KEEP (rewritten) the last line of the block so listener registration order is untouched:

```js
// auto-lint moved to src/lint.mjs; the arming hook stays HERE so the editor.on('change')
// registration order (lint -> autosave -> promote) is byte-order-identical to before.
editor.on("change", () => window.armLint());
```

- [ ] **Step 4: Wire in `src/main.mjs`** — `import * as lint from "./lint.mjs";` and add to mirrors: `armLint: lint.armLint,   // transitional (host arming hook)`

- [ ] **Step 5: Targeted then full battery**

Run: `node test/lint.mjs && node test/shell.mjs` — lint.mjs asserts the lazy contract (nothing loads before first edit, gutter markers appear after) and shell.mjs the first-paint invariant. Then full battery.
Expected: `BATTERY GREEN`.

- [ ] **Step 6: Commit and merge**

```bash
git add index.html src/main.mjs src/lint.mjs
git commit -m "refactor(m6): lint module — lazy ruff-wasm loader on util tag primitives"
git checkout main && git merge --no-ff refactor/m6-lint -m "merge: module-split step 6 — lint"
```

---

## Task group H — editor (branch `refactor/m7-editor`)

### Task 11: Create `src/editor.mjs` (the ONE CodeMirror + wrapper-move helpers), delete host block

**Files:**
- Create: `src/editor.mjs`
- Modify: `index.html`, `src/main.mjs`

- [ ] **Step 1: Branch** — `git checkout -b refactor/m7-editor`

- [ ] **Step 2: Create the module**

```js
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
// reference from this keymap to a saveProject defined 1,700 lines later.
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

// Hidden off-screen holder for the wrapper while a non-.py file is shown (verbatim concept
// from the old cmStash block): moving the element — never destroying it — keeps the single
// instance alive AND removes .CodeMirror from #viewerBody so the empty-state assertion holds.
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
```

- [ ] **Step 3: Delete host blocks; inject the save handler**

- Delete the editor-creation block (anchor `const editor = CodeMirror.fromTextArea(...)`, ~972–992). In its place put:

```js
// The CodeMirror instance moved to src/editor.mjs (window.editor). Its Cmd/Ctrl-S needs
// the host's saveProject, injected here (setSaveHandler breaks the old forward reference).
window.__editorMod.setSaveHandler(() => saveProject());
```

(`saveProject` is a function declaration later in `__appMain` — hoisted, so the closure is safe; the handler only runs on keypress, long after init.)

- Delete the cmStash block (anchor `const cmStash = document.createElement("div");`, ~1779–1781) — the module owns it; bare `cmStash` references in the body resolve via the mirror.
- In the Step-0 seam block: delete the `window.editor = editor;` line.

- [ ] **Step 4: Wire in `src/main.mjs`**

`import * as editorMod from "./editor.mjs";` and extend mirrors:

```js
    editor: editorMod.editor,          // PINNED (bare `editor` in explorer-actions.mjs)
    cmStash: editorMod.cmStash,        // transitional (host wrapper-dance callsites)
    __editorMod: editorMod,            // transitional (host injects saveProject)
```

- [ ] **Step 5: Full battery (editor touches everything — no shortcut run)**

Run the full battery.
Expected: `BATTERY GREEN`. Highest-signal suites: seams.mjs check 5 (ONE `.CodeMirror` + identity invariant), explorer-actions (bare `editor`), save.mjs (Cmd-S via the injected handler), lessons/examples (zero setValue), lint.mjs (setOption on the module instance).

- [ ] **Step 6: Commit and merge**

```bash
git add index.html src/main.mjs src/editor.mjs
git commit -m "refactor(m7): editor module — the ONE CodeMirror, cmStash + sanctioned wrapper-move helpers, injected save"
git checkout main && git merge --no-ff refactor/m7-editor -m "merge: module-split step 7 — editor"
```

---

## Task group I — wrap-up

### Task 12: Plan-1 close-out

**Files:**
- Create: `docs/superpowers/plans/2026-07-02-module-split-plan-1-asbuilt.md`

- [ ] **Step 1: Final full battery on main**

`git checkout main`, run the full battery one more time.
Expected: `BATTERY GREEN`.

- [ ] **Step 2: Sanity-check the end state**

```bash
ls src/           # expected: dialogs.mjs editor.mjs examples-data.mjs lessons-data.mjs lint.mjs main.mjs ui.mjs util.mjs
wc -l index.html  # expected: roughly 3,100-3,300 (from 4,069)
grep -c "window.__appMain" index.html   # expected: 2 (definition + none other)
```

- [ ] **Step 3: Write the as-built record**

Create `docs/superpowers/plans/2026-07-02-module-split-plan-1-asbuilt.md` recording: final line counts, every transitional mirror added (the `Object.assign` block in `src/main.mjs` is the authoritative list), the two documented design deviations (b64url not modernized — legacy share-link compat; `idbStore` deferred to Plan 2 — no consumer yet), the lint retry-mechanism finding, and any surprises hit during execution. This file is the input for authoring Plan 2.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-02-module-split-plan-1-asbuilt.md
git commit -m "docs(plan): module-split plan-1 as-built record"
```

---

## Post-plan state (what Plan 2 starts from)

- index.html: markup + CSS + CDN tags + classic script = prelude (`pyodide`/`pySeam`) + `__appMain` (project model, viewer, explorer, assets, history, save, examples-panel, layout, lessons, collab, run — still inline) + Step-0 seam block (minus retired lines) + bootstrap.
- `src/`: 8 modules, all eager pure text, publishing pinned seams + transitional mirrors via `src/main.mjs`.
- All 23 batteries green, zero test-file edits (one test file ADDED: `test/seams.mjs`).
