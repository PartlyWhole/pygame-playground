# Refactor-D — Engine Extraction (`vendor/engine.mjs`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the cooperative pygame engine (the two `String.raw` Python source consts plus the run/stop/pause/boot orchestration) out of the ~3827-line `index.html` into a hand-authored, build-free `vendor/engine.mjs`, with **zero behavior change** and the full 17-battery suite green at every phase.

**Architecture:** A thin JS wrapper module loaded by the SAME dynamic-`import()` cached-promise pattern already proven for `vendor/automerge-collab.mjs`. `engine.mjs` knows only Pyodide, a canvas element, a status-token callback, a log sink, and plain string/dict program snapshots — it never imports `project`, `renderTabs`, `collab`, `assetFS`, or any DOM id. The host `index.html` keeps ALL UI orchestration (status tokens, `runFile`/`runTask`, `syncRunControls`, `renderTabs`, CodeMirror, the four other lazy loaders) and delegates only the Python dispatch. Phased: **P1** move the two Python consts → **P2** start/stop/pause/resume behind `createEngine(deps)` → **P3** boot/Pyodide load into `engine.boot(deps)`.

**Tech Stack:** Static `index.html` + Pyodide 0.27.2 + pygame-ce, no build step, classic (non-module) inline `<script>`. Tests: headless Playwright batteries under `test/` driven by `python3 -m http.server`.

---

## ⚠️ Load-bearing invariants (violating any one turns ~40 assertions RED)

1. **The test seam is the BARE-NAME global `pyodide`, NOT `window.pyodide`.** Tests call `page.evaluate(() => pyodide.runPython('_stop()'))`, `pyodide.FS`, `pyodide.globals`, `_state['task']`, `id(_state['task'])`, `_state['via_project']` — by bare name (see `test/upload.mjs:126-127`, every `test/multifile.mjs` / `test/subdirs.mjs` / `test/spike-*.mjs`). This resolves only because (a) the inline `<script>` (index.html:479) is **classic, not `type="module"`**, and (b) `pyodide` is a top-level `let` (index.html:3323) creating a global lexical binding reachable in `page.evaluate`'s classic-script context. **`window.pyodide` is never used by any test** (grep-confirmed). The design doc (`docs/specs/2026-06-24-refactor-option-d-design.md`) says "window.pyodide" throughout — that is INACCURATE; the real seam is the bare-name `let pyodide`. **Never convert the host `<script>` to `type="module"`** (dynamic `import()` works fine inside a classic script, so the extraction does not require it). **Always keep assigning the booted instance to the host's top-level `let pyodide`** (critical in P3). Mirroring to `window.pyodide` is harmless future-proofing but is NOT the seam.

2. **Python namespace byte-identical after boot.** `engine.boot()` must run `await pyodide.runPythonAsync(BOOT_PY); await pyodide.runPythonAsync(PROJECT_PY)` in that strict order (PROJECT_PY reuses BOOT_PY's `_SyncBarrier`/`_is_gameloop`/`_Asyncify`/`_Awaiter`/`_InjectYield`/`_time_names`/`__yield__`/`__sleep__`/`_state`/`_stop`). After boot, `_start`/`_stop`/`_pause`/`_resume`/`_state`/`__yield__`/`_start_project`/`_purge_project_files` live in `pyodide.globals` exactly as today.

3. **String.raw verbatim move.** Move the Python source byte-for-byte; do NOT reformat/re-indent and do NOT introduce a `${` sequence (String.raw still honors `${}` interpolation; the current source has zero `${`, only inert `{}` dict/set literals). A P1 byte-diff must prove the moved strings are unchanged.

4. **First-paint laziness (behavior A — adopted).** Today boot is ALREADY eager (`const booted = boot()` at index.html:3399 fires at script-eval, warming Pyodide on page load). Keep that exact timing. Load `engine.mjs` via dynamic `import(new URL("./vendor/engine.mjs", document.baseURI).href)` on a cached-promise gate (mirrors `loadAutomerge`, index.html:3488) — never a static import, never `<script type=module>`. The four existing lazy loaders (Automerge/ruff/JSZip/jsdiff) stay untouched in `index.html`.

5. **Commit `vendor/engine.mjs` to the branch.** GitHub Pages serves committed files only; a relative `./vendor/...` specifier + `document.baseURI` is required for the `/pygame-playground` project subpath (absolute `/vendor/...` 404s on Pages).

---

## File Structure

| File | Change | Responsibility after this plan |
|------|--------|-------------------------------|
| `vendor/engine.mjs` | **Create** | Exports `BOOT_PY`, `PROJECT_PY` (verbatim Python source) and `createEngine(deps)` → an engine object with `boot/start/startProject/stop/pause/resume/isPaused/purgeProjectFiles`. Pure Pyodide+canvas+callbacks; no DOM/project/collab imports. |
| `index.html` | **Modify** | Drops the two Python consts + the inline `_start`/`_start_project`/`_stop` dispatch + (P3) the Pyodide boot body. Gains `loadEngine()` (cached dynamic import) and thin host wrappers. Keeps the classic `<script>`, the top-level `let pyodide`, `setStatus` + all `#status` token strings, `run()`/`#runBtn`, `#stopBtn`, `#pauseBtn`/`togglePause`, `runFile`/`runTask`, `syncRunControls`, `renderTabs`, the CodeMirror singleton, and the four other lazy loaders. |
| `test/engine-extraction.mjs` | **Create** | New standing battery pinning extraction-specific invariants: `engine.mjs` importable + exports present; post-boot namespace intact via bare-name `pyodide`; `window.__engineLoaded` sentinel; (P2) engine methods drive exactly one `_state['task']`; (P3) no eager static module load. Grows across P1→P3. |

**Suite after this plan = 18 batteries** (the existing 17 + `engine-extraction.mjs`).

---

## How to run the suite (used by every "run tests" step)

```bash
# from /Users/alan/Desktop/pygame-playground
pkill -f "http.server 8923" 2>/dev/null; sleep 1
python3 -m http.server 8923 --directory /Users/alan/Desktop/pygame-playground >/tmp/pp-http.log 2>&1 &
sleep 1
# Run SEQUENTIALLY — concurrent Pyodide/CDN loads flake. URL is argv[2].
for b in verify.mjs \
  test/assets.mjs test/collab.mjs test/collab-multifile.mjs test/collab-multifile-b.mjs \
  test/examples.mjs test/explorer-actions.mjs test/explorer-tree.mjs test/history.mjs \
  test/lint.mjs test/multifile.mjs test/runmodel.mjs test/save.mjs test/share-removed.mjs \
  test/shell.mjs test/subdirs.mjs test/upload.mjs test/engine-extraction.mjs; do
  node "$b" http://localhost:8923/ >/tmp/pp-$(basename "$b").log 2>&1 \
    && echo "PASS  $b" || echo "FAIL  $b"
done
pkill -f "http.server 8923" 2>/dev/null
```

Phase-specific extra gates (NOT part of the canonical count). Note each spike's target URL:
- `node test/spike-runstop.mjs http://localhost:8923/` — targets the live `index.html` (root).
- `node test/spike-pause.mjs http://localhost:8923/test/spike-pause.html` — targets its OWN frozen harness page (`spike-pause.html` copies an engine snapshot; it does NOT exercise the live engine, so it is a weak gate — the real pause coverage is `runmodel`/`multifile`/`subdirs`). Passing the root URL here fails spuriously (`runLoop undefined`).

---

## Task P1: Move `BOOT_PY` / `PROJECT_PY` into `vendor/engine.mjs`

**Files:**
- Create: `vendor/engine.mjs`
- Create: `test/engine-extraction.mjs`
- Modify: `index.html` (remove the two const blocks at `867–1104` and `1106–1432`; add `loadEngine()`; swap the two `runPythonAsync(BOOT_PY/PROJECT_PY)` refs at `3394–3395` to `ENG.*`)

- [ ] **Step 1: Write the failing battery `test/engine-extraction.mjs` (P1 checks)**

```js
// Headless verification of the engine extraction (refactor Option D). Mirrors verify.mjs.
//
// P1 contract: the two cooperative-engine Python source consts now live in
// vendor/engine.mjs (dynamically imported like vendor/automerge-collab.mjs); after the
// eager boot, the Python namespace is byte-identical to before (reachable via the
// BARE-NAME `pyodide` global — NOT window.pyodide; the inline <script> is classic).
import { launch } from './_harness.mjs';
let pass = 0, failn = 0;
const ok = (m) => { console.log('  ok  -', m); pass++; };
const fail = (m) => { console.log('  FAIL-', m); failn++; };
const base = process.argv[2] || 'http://localhost:8923/';

const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(base, { waitUntil: 'load' });

// C1: engine.mjs imports in the page and exports the two non-empty Python consts.
const exports = await page.evaluate(async () => {
  const m = await import(new URL('./vendor/engine.mjs', document.baseURI).href);
  return {
    boot: typeof m.BOOT_PY === 'string' && m.BOOT_PY.includes('def _start(src)'),
    project: typeof m.PROJECT_PY === 'string' && m.PROJECT_PY.includes('def _start_project('),
    bootLen: (m.BOOT_PY || '').length,
    projLen: (m.PROJECT_PY || '').length,
  };
});
if (exports.boot && exports.project && exports.bootLen > 1000 && exports.projLen > 1000)
  ok(`vendor/engine.mjs exports BOOT_PY (${exports.bootLen}b) + PROJECT_PY (${exports.projLen}b)`);
else fail(`engine.mjs exports missing/empty: ${JSON.stringify(exports)}`);

// C2: after the eager boot, the Python namespace is intact and reachable by BARE NAME `pyodide`.
await page.waitForFunction(() => /ready|finished|stopped/.test(
  document.getElementById('status')?.textContent || ''), null, { timeout: 90000 }).catch(() => {});
const ns = await page.evaluate(() => {
  if (typeof pyodide === 'undefined' || !pyodide) return { reachable: false };
  const names = ['_start', '_stop', '_pause', '_resume', '_state', '__yield__',
                 '_start_project', '_purge_project_files'];
  const present = pyodide.runPython(
    `all(n in dict(globals()) for n in [${names.map((n) => `'${n}'`).join(',')}])`);
  return { reachable: true, present: !!present };
});
if (ns.reachable && ns.present)
  ok('post-boot Python namespace intact via bare-name `pyodide` (_start/_stop/_state/__yield__/_start_project)');
else fail(`namespace not intact / pyodide unreachable by bare name: ${JSON.stringify(ns)}`);

// C3: the engine module load is tracked by a sentinel (mirrors window.__amLoaded) and
// window.pyodide is NOT relied upon as the seam.
const sentinel = await page.evaluate(() => ({
  engineLoaded: window.__engineLoaded === true,
  bareWorks: typeof pyodide !== 'undefined' && !!pyodide,
}));
if (sentinel.engineLoaded && sentinel.bareWorks)
  ok('window.__engineLoaded sentinel set; bare-name pyodide is the live seam');
else fail(`sentinel/seam wrong: ${JSON.stringify(sentinel)}`);

await browser.close();
console.log(`\nengine-extraction: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it FAILS for the right reason**

```bash
pkill -f "http.server 8923" 2>/dev/null; sleep 1
python3 -m http.server 8923 --directory /Users/alan/Desktop/pygame-playground >/tmp/pp-http.log 2>&1 &
sleep 1
node test/engine-extraction.mjs http://localhost:8923/
pkill -f "http.server 8923" 2>/dev/null
```
Expected: **FAIL** — C1 errors (`vendor/engine.mjs` 404 / no such module), so `pass < 3`.

- [ ] **Step 3: Create `vendor/engine.mjs` by MOVING the consts verbatim (no retyping)**

Build the module from the *current* `index.html` so the Python bytes are guaranteed identical. The const decl/close lines are: `BOOT_PY` decl at `867`, close `` `; `` at `1104` (body `868–1103`); the `multi-file run model` comment at `1106–1112`; `PROJECT_PY` decl at `1113`, close at `1432` (body `1114–1431`). **Re-confirm these four line numbers with `grep -n "BOOT_PY = String.raw\|PROJECT_PY = String.raw\|^\`;" index.html` before slicing — they shift if index.html was edited.**

```bash
cd /Users/alan/Desktop/pygame-playground
{
  cat <<'HDR'
// vendor/engine.mjs — cooperative pygame engine (hand-authored, no build step).
//
// Refactor Option D. Extracted VERBATIM from index.html. This module is loaded by a
// dynamic import() cached-promise gate (mirrors vendor/automerge-collab.mjs), so it adds
// no first-paint cost. It knows only Pyodide, a canvas element, a status-token callback,
// a log sink, and plain string/dict program snapshots — never project/renderTabs/collab/
// assetFS or any DOM id. The Python below is byte-identical to the original index.html
// source; do not reformat (String.raw stops backslash + brace processing; there are no
// ${ } interpolations). P1 = these two consts only; createEngine() arrives in P2/P3.
//
// CRITICAL: the host (index.html) keeps a classic <script> and a top-level `let pyodide`
// holding the booted instance, because ~40 tests reach the interpreter by BARE NAME
// `pyodide` (not window.pyodide). Do not change that seam.

export const BOOT_PY = String.raw`
HDR
  sed -n '868,1103p' index.html
  printf '`;\n\n'
  # carry the multi-file run-model comment for context (lines 1106-1112)
  sed -n '1106,1112p' index.html
  echo 'export const PROJECT_PY = String.raw`'
  sed -n '1114,1431p' index.html
  printf '`;\n'
} > vendor/engine.mjs
```

- [ ] **Step 4: Prove the moved Python is byte-identical (P1 acceptance gate)**

```bash
cd /Users/alan/Desktop/pygame-playground
# Extract the body BETWEEN the two backtick markers in the new module and diff against the
# pre-edit index.html bodies (index.html is still unedited at this point).
node -e '
const fs=require("fs");
const eng=fs.readFileSync("vendor/engine.mjs","utf8");
const grab=(name)=>{const re=new RegExp("export const "+name+" = String.raw`([\\s\\S]*?)`;");return eng.match(re)[1];};
const html=fs.readFileSync("index.html","utf8").split("\n");
const boot=html.slice(867,1103).join("\n");      // 0-based 867..1102 = lines 868..1103
const proj=html.slice(1113,1431).join("\n");      // lines 1114..1431
const eb=grab("BOOT_PY"), ep=grab("PROJECT_PY");
const norm=(s)=>s.replace(/^\n/,"").replace(/\n$/,"");
console.log("BOOT_PY identical:", norm(eb)===norm(boot));
console.log("PROJECT_PY identical:", norm(ep)===norm(proj));
if(norm(eb)!==norm(boot)||norm(ep)!==norm(proj)){console.error("BYTE-DIFF MISMATCH — abort P1");process.exit(1);}
'
```
Expected: both `identical: true`. If not, the slice line numbers were wrong — fix and rebuild before editing `index.html`.

- [ ] **Step 5: Remove the two const blocks from `index.html`**

Delete lines `867–1104` (the `const BOOT_PY = String.raw\`` … `` `; ``) AND `1113–1432` (the `const PROJECT_PY = String.raw\`` … `` `; ``). Keep the `// ---- python bootstrap` header comment (866) and the `// ---- multi-file run model` comment (1106–1112) only if desired — they are now duplicated in the module, so removing them from `index.html` is cleaner. Use the Edit tool with the exact decl→close text as `old_string` (anchor on the unique `const BOOT_PY = String.raw\`` opening line through the matching `` `; ``). After removal, `grep -n "String.raw" index.html` must show **no** `BOOT_PY`/`PROJECT_PY` decls.

- [ ] **Step 6: Add the cached-promise `loadEngine()` gate**

In the pyodide-boot section (just below `let runTask = null;`, ~index.html:3324), add:

```js
// Engine module (cooperative pygame engine) — lazily imported on a cached promise, the
// SAME pattern as loadAutomerge(): relative + document.baseURI so it resolves under the
// GitHub Pages project subpath. First-paint-neutral (tiny text module). See vendor/engine.mjs.
let _engineCache = null;
function loadEngine() {
  if (_engineCache) return _engineCache;
  _engineCache = import(new URL("./vendor/engine.mjs", document.baseURI).href).then((m) => {
    window.__engineLoaded = true;   // sentinel for tests (mirrors window.__amLoaded)
    return m;
  });
  return _engineCache;
}
```

- [ ] **Step 7: Point `boot()` at the imported consts**

In `boot()` (~index.html:3378), after `setStatus("boot", "loading Python…");` add `const ENG = await loadEngine();`. Change the two run lines (3394–3395) from:

```js
  await pyodide.runPythonAsync(BOOT_PY);
  await pyodide.runPythonAsync(PROJECT_PY);
```
to:
```js
  await pyodide.runPythonAsync(ENG.BOOT_PY);
  await pyodide.runPythonAsync(ENG.PROJECT_PY);
```
Everything else in `boot()` is unchanged. The eager kick `const booted = boot()` (3399) is untouched → identical first-paint timing.

- [ ] **Step 8: Run the engine-extraction battery — expect PASS**

```bash
pkill -f "http.server 8923" 2>/dev/null; sleep 1
python3 -m http.server 8923 --directory /Users/alan/Desktop/pygame-playground >/tmp/pp-http.log 2>&1 &
sleep 1
node test/engine-extraction.mjs http://localhost:8923/
pkill -f "http.server 8923" 2>/dev/null
```
Expected: **3 passed, 0 failed**.

- [ ] **Step 9: Run the FULL suite + the spike gates — all green**

Run the full-suite loop (see "How to run the suite") AND:
```bash
node test/spike-pause.mjs http://localhost:8923/ && node test/spike-runstop.mjs http://localhost:8923/
```
Expected: every battery `PASS`; `spike-pause` / `spike-runstop` exit 0. Pay special attention to `shell.mjs` (first-paint + boot token sequence), `save.mjs` (no eager loader hoisted), `runmodel.mjs`, `multifile.mjs`, `subdirs.mjs` (cooperative import machinery).

- [ ] **Step 10: Commit P1**

```bash
git add vendor/engine.mjs test/engine-extraction.mjs index.html
git commit -m "$(cat <<'EOF'
refactor(engine-D/P1): move BOOT_PY/PROJECT_PY into vendor/engine.mjs (verbatim, dynamic import)

Behavior-neutral: host still owns boot()/run()/stop()/pause() and runs the imported
strings via pyodide.runPythonAsync. Python namespace byte-identical (verified); bare-name
`pyodide` seam preserved; eager boot kick unchanged (behavior A). +engine-extraction battery.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task P2: Move `start`/`startProject`/`stop`/`pause`/`resume` behind `createEngine(deps)`

**Files:**
- Modify: `vendor/engine.mjs` (add `createEngine`)
- Modify: `index.html` (`run()` 3406–3451, `togglePause()` 3454–3463, `#stopBtn` listener 3474–3476, `isPaused()` 3332–3336; create `engine` after `loadEngine()` resolves)
- Modify: `test/engine-extraction.mjs` (add P2 check)

- [ ] **Step 1: Add the P2 check to `test/engine-extraction.mjs`**

```js
// C4 (P2): the host run path delegates to the engine and still produces exactly ONE live
// _state['task']; engine.stop() clears it. Driven through the real #runBtn so the host
// wrapper (clearConsole/snapshot/syncRunControls/renderTabs) is exercised.
await page.waitForSelector('#runBtn', { timeout: 5000 });
await page.click('#runBtn');
await page.waitForFunction(() => {
  try { return pyodide.runPython("_state.get('task') is not None"); } catch { return false; }
}, null, { timeout: 30000 }).catch(() => {});
const live = await page.evaluate(() =>
  pyodide.runPython("1 if (_state.get('task') is not None and not _state['task'].done()) else 0"));
await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });
await page.waitForFunction(() => {
  try { return pyodide.runPython("_state.get('task') is None or _state['task'].done()"); }
  catch { return false; }
}, null, { timeout: 10000 }).catch(() => {});
const stopped = await page.evaluate(() =>
  pyodide.runPython("1 if (_state.get('task') is None or _state['task'].done()) else 0"));
if (live === 1 && stopped === 1) ok('host run() → engine.start drives exactly one task; engine.stop clears it');
else fail(`P2 task lifecycle wrong: live=${live} stopped=${stopped}`);
```
Run it — expect the new check to FAIL (engine has no methods yet; but the host still works, so this check may PASS prematurely since the inline path still runs). **Because P2 is a refactor with no behavior change, this check passes before AND after; its value is as a standing regression guard. Confirm it passes after the refactor.**

- [ ] **Step 2: Add `createEngine(deps)` to `vendor/engine.mjs`**

Append below the two consts:

```js
// createEngine(deps) — thin JS wrapper over the SAME Pyodide globals. deps.getPyodide()
// returns the live (bare-name) pyodide instance the host owns. No DOM/project imports.
export function createEngine(deps) {
  const py = () => deps.getPyodide();
  return {
    // Single-file path: snapshot `src` NOW and schedule the cooperative task.
    start(src) {
      const f = py().globals.get("_start");
      const task = f(src);
      f.destroy();
      return task;
    },
    // Multi-file path: toPy the {path: text} snapshot, schedule, then free the proxies.
    startProject(filesObj, entry) {
      const startP = py().globals.get("_start_project");
      const filesPy = py().toPy(filesObj);
      const task = startP(filesPy, entry);
      startP.destroy(); filesPy.destroy();
      return task;
    },
    // Reset the single-file path's project-import state (mirrors the old inline runPython).
    purgeProjectFiles() {
      py().runPython("_state['via_project'] = False; _purge_project_files()");
    },
    stop() { py().runPython("_stop()"); },
    pause() { return py().runPython("_pause()"); },
    resume() { return py().runPython("_resume()"); },
    isPaused() {
      try { return !!py().runPython("bool(_state.get('paused'))"); } catch { return false; }
    },
  };
}
```

- [ ] **Step 3: Create the `engine` instance once the module is loaded**

The host needs `engine` available by the time `run()` fires (which awaits `booted`). Add a module-scoped `let engine = null;` near `let pyodide = null;`, and assign it inside `boot()` right after `const ENG = await loadEngine();`:

```js
  const ENG = await loadEngine();
  engine = engine || ENG.createEngine({ getPyodide: () => pyodide });
```
(`engine` resolves before the Python runs, so it is ready whenever `await booted` returns in `run()`.)

- [ ] **Step 4: Rewrite `run()`'s dispatch to delegate (keep ALL UI orchestration)**

Replace ONLY the dispatch block (index.html:3423–3433) — keep `clearConsole`/`captureSnapshot`/`canvasEl.focus`/`resumeAudio`/`runTask`/`runFile`/`setStatus`/`syncRunControls`/`renderTabs`/`task.then`/`catch` exactly:

```js
  const isSingle = !project.isMulti();
  if (isSingle) {
    engine.purgeProjectFiles();
    task = engine.start(editor.getValue());         // snapshots the text NOW
  } else {
    task = engine.startProject(project.serialize().files, project.entry);  // snapshots every Doc NOW
  }
```

- [ ] **Step 5: Delegate `#stopBtn`, `togglePause()`, and `isPaused()`**

- `#stopBtn` listener (3474–3476): `if (pyodide) engine.stop();` (guard on `pyodide` so a pre-boot click is inert, as today).
- `togglePause()` (3454–3463): replace `pyodide.runPython("_resume()")` → `engine.resume()`, `pyodide.runPython("_pause()")` → `engine.pause()`; keep the `setStatus`/`syncRunControls`/`renderTabs` lines. Guard stays `if (!pyodide || !runFile) return;`.
- host `isPaused()` (3332–3336): `return engine ? engine.isPaused() : false;` (drop the inline runPython; `engine` is null until boot, matching the old `!pyodide` guard).

- [ ] **Step 6: Run the full suite + spike gates — all green**

Run the full-suite loop AND `spike-runstop.mjs` (task identity), `spike-pause.mjs` (`id(_state['task'])` transitions across pause/resume), focusing on `runmodel.mjs` check 11 (single-file uses `_start`), `multifile.mjs` (repeated project runs — proxy hygiene; a missing `destroy()` would leak/crash).
Expected: all `PASS`, both spikes exit 0.

- [ ] **Step 7: Commit P2**

```bash
git add vendor/engine.mjs index.html test/engine-extraction.mjs
git commit -m "$(cat <<'EOF'
refactor(engine-D/P2): start/stop/pause/resume behind createEngine(deps)

run()/togglePause()/#stopBtn become thin host wrappers that keep all UI orchestration
(console/snapshot/status/syncRunControls/renderTabs/task settle) and delegate only the
Python dispatch to engine.start/startProject/stop/pause/resume. toPy/destroy hygiene moved
verbatim into the engine. Bare-name `pyodide` seam unchanged. Suite green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task P3: Move `boot()` / Pyodide load into `engine.boot(deps)`

**Files:**
- Modify: `vendor/engine.mjs` (add `boot` to the engine object; the consts are already in-module)
- Modify: `index.html` (`boot()` 3366–3398 collapses to a deps-injecting wrapper; keep the eager kick + assign returned instance to `let pyodide`)
- Modify: `test/engine-extraction.mjs` (add P3 first-paint check)

- [ ] **Step 1: Add the P3 first-paint check to `test/engine-extraction.mjs`**

```js
// C5 (P3): engine.mjs is loaded by DYNAMIC import (no static <script type=module> for it),
// and the host <script> stays classic so bare-name `pyodide` survives. Assert no module
// script tag references engine.mjs and the seam still resolves post-boot.
const paint = await page.evaluate(() => ({
  noStaticEngineScript: ![...document.querySelectorAll('script[type="module"]')]
    .some((s) => (s.src || '').includes('engine.mjs')),
  bareSeam: typeof pyodide !== 'undefined' && !!pyodide
    && !!pyodide.runPython("1 if '_start' in dict(globals()) else 0"),
}));
if (paint.noStaticEngineScript && paint.bareSeam)
  ok('engine.mjs is dynamic-imported (no static module script); bare-name seam intact post-boot');
else fail(`P3 first-paint/seam wrong: ${JSON.stringify(paint)}`);
```

- [ ] **Step 2: Add `boot` to the engine object in `vendor/engine.mjs`**

Inside the object returned by `createEngine`, add (preserving the EXACT order of the old `boot()`):

```js
    // Full boot: audio-proxy first, then Pyodide load, canvas+SDL registration, pygame-ce,
    // BOOT_PY then PROJECT_PY (strict order), then host asset hydration. Returns the pyodide
    // instance so the host can assign it to its bare-name `let pyodide`. deps:
    //   loadPyodide: async () => pyodide   (host owns the CDN base + version pin)
    //   canvas: the #canvas element
    //   setStatus: (cls, token) => void    (host owns the exact token strings)
    //   logSink: { out:(s)=>void, err:(s)=>void }
    //   hydrateAssets: async () => void     (host's assetFS.hydrateAll)
    async boot(d) {
      // Capture SDL's Web Audio context(s) BEFORE pygame.mixer loads (autoplay-gesture resume).
      window.__audioContexts = window.__audioContexts || [];
      for (const key of ["AudioContext", "webkitAudioContext"]) {
        const Orig = window[key];
        if (!Orig || Orig.__wrapped) continue;
        const Wrapped = new Proxy(Orig, { construct(T, a) { const c = new T(...a); window.__audioContexts.push(c); return c; } });
        Wrapped.__wrapped = true;
        window[key] = Wrapped;
      }
      d.setStatus("boot", "loading Python…");
      const inst = await d.loadPyodide();
      this._py = inst;
      inst.setStdout({ batched: (s) => d.logSink.out(s) });
      inst.setStderr({ batched: (s) => d.logSink.err(s) });
      if (inst.canvas && inst.canvas.setCanvas2D) inst.canvas.setCanvas2D(d.canvas);
      else inst._module.canvas = d.canvas;
      inst.runPython('import os; os.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"');
      d.setStatus("boot", "loading pygame…");
      await inst.loadPackage("pygame-ce");
      await inst.runPythonAsync(BOOT_PY);
      await inst.runPythonAsync(PROJECT_PY);
      await d.hydrateAssets();
      d.setStatus("ready", "ready");
      return inst;
    },
```
Keep `getPyodide: () => pyodide` injected by the host so `py()` keeps working unchanged. **Do NOT remove the host's `getPyodide` injection.**

**DEVIATION FROM THE DESIGN DEP LIST (discovered during P3, required):** add a `setPyodide(inst)` dep and call it inside `engine.boot()` *immediately* after `const inst = await d.loadPyodide();` (before stdout/canvas/runPython/hydrate). Reason: the original host `boot()` assigned `pyodide` right after `loadPyodide()`, so every later step ran against a live host `pyodide`. If the host only assigns `pyodide = await engine.boot(...)` (after boot returns), then `assetFS.hydrateAll()` → `_memfs` (which guards `if (!pyodide) return;`, index.html:1249) runs mid-boot with `pyodide === null` and silently no-ops every MEMFS write — the asset model rehydrates but MEMFS stays empty (`assets.mjs` persist check fails `treeRow=true memfs=false`, plus the sprite-blit pixel check). The setter restores the exact original ordering. Host injects `setPyodide: (inst) => { pyodide = inst; }`.

- [ ] **Step 3: Collapse the host `boot()` to a deps-injecting wrapper**

Replace the body of `boot()` (3366–3398) with:

```js
async function boot() {
  const ENG = await loadEngine();
  engine = engine || ENG.createEngine({ getPyodide: () => pyodide });
  pyodide = await engine.boot({
    loadPyodide: async () => {
      const mod = await import(PYODIDE_BASE + "pyodide.mjs");
      return mod.loadPyodide({ indexURL: PYODIDE_BASE });
    },
    setPyodide: (inst) => { pyodide = inst; },   // publish to the bare-name seam BEFORE hydrate reads it
    canvas: canvasEl,
    setStatus,                                   // host owns the exact #status token strings
    logSink: { out: (s) => logLine(s, "out"), err: (s) => logLine(s, "err") },
    hydrateAssets: () => assetFS.hydrateAll(),
  });
  return pyodide;
}
const booted = boot().catch((e) => {
  setStatus("error", "boot failed");
  logLine(String(e), "err");
  throw e;
});
```
`PYODIDE_BASE` + the version pin stay in `index.html`. The eager `const booted = boot()` is unchanged → first-paint timing identical. **`pyodide = await engine.boot(...)` is the load-bearing assignment** that keeps the bare-name seam alive.

- [ ] **Step 4: Run the full suite + spike gates — all green**

Run the full-suite loop AND both spikes. Focus: `shell.mjs` (first-paint + boot token sequence `loading Python…`→`loading pygame…`→`ready`), `assets.mjs` (hydrate order — assets in MEMFS before first run), `collab.mjs` (`pyodide.globals` reachable), `save.mjs` check 5 (no eager loader hoisted into first paint), `runmodel.mjs`, `multifile.mjs`, `subdirs.mjs`.
Expected: all `PASS`, both spikes exit 0.

- [ ] **Step 5: Commit P3**

```bash
git add vendor/engine.mjs index.html test/engine-extraction.mjs
git commit -m "$(cat <<'EOF'
refactor(engine-D/P3): move boot()/Pyodide load into engine.boot(deps)

engine.boot() owns audio-proxy→Pyodide load→canvas/SDL→pygame-ce→BOOT_PY/PROJECT_PY→
hydrate, returning the instance; host injects loadPyodide/canvas/setStatus/logSink/
hydrateAssets and assigns the return to its top-level `let pyodide` (bare-name seam).
PYODIDE_BASE + version pin stay host-side. Eager boot kick + first-paint timing unchanged
(behavior A). Full suite + spike-pause/spike-runstop green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after P3)

- [ ] Full 18-battery suite green from a clean server (see "How to run the suite").
- [ ] `spike-pause.mjs` + `spike-runstop.mjs` exit 0.
- [ ] `index.html` no longer contains `BOOT_PY`/`PROJECT_PY` decls (`grep -n "String.raw" index.html` shows only any unrelated uses).
- [ ] `vendor/engine.mjs` committed (Pages serves committed files only).
- [ ] Manual smoke (optional): open the served page, click ▶ on the default example — it runs; Pause/Resume/End work; a multi-file project runs; an uploaded asset loads. (Covered by batteries, but a human glance is cheap.)
- [ ] Update `docs/CURRICULUM-REQUEST-QUEUE.md` CURRENT CURSOR: refactor-D done; next = lesson-UI L1.
- [ ] **Do NOT push.** Merge to local `main` (`--no-ff`) only after the full suite is green; pushing needs explicit per-push auth (`CCD_PUSH_OK=1`).

## Self-review notes (spec coverage)
- Option-D design "Phased extraction" P1/P2/P3 → Tasks P1/P2/P3. ✔
- "Engine public surface" exports (BOOT_PY/PROJECT_PY/createEngine/boot/start/startProject/stop/pause/resume/isPaused/purgeProjectFiles) → all defined across P1–P3. ✔
- "Injected by the host" deps (loadPyodide/canvas/setStatus/logSink/hydrateAssets; fileSource NOT injected) → P3 Step 3. ✔
- "Seams staying in index.html" (run/#runBtn, #stopBtn, #pauseBtn/togglePause, setStatus+tokens, bare `pyodide`, runFile/runTask, syncRunControls, isPaused, CodeMirror, project, renderTabs, collab, assetFS, 4 lazy loaders, PYODIDE_BASE) → preserved; corrected `window.pyodide`→bare-name `pyodide`. ✔
- All six design Risks (direct namespace pokes; String.raw escaping; load-order; MetaPathFinder cwd; Pages CORS specifier; first-paint laziness; AudioContext order; toPy/destroy hygiene) → addressed in Invariants + per-phase gate batteries. ✔
- Adopted defaults (behavior-A first-paint; keep bare `pyodide` seam / defer `window.engine`; host owns status tokens via injected setStatus; sequence after cluster / before lesson-UI) → reflected. ✔
