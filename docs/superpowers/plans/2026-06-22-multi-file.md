# Multi-file support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pygame program span several flat `.py` files (an entry that imports siblings) and run cooperatively in the browser, via editor tabs + a project model, without regressing the single-file path.

**Architecture:** A JS `project` model (files as `CodeMirror.Doc`s, an entry pointer) drives an editor tab strip; an additive `PROJECT_PY` Python block adds a `sys.meta_path` import hook that runs the *proven blanket* cooperative transform on every project module, plus `_start_project`. `run()` dispatches to the new path only when there are ≥2 files and not in a collab room; the existing `_start`/`_run`/`_transform` are untouched. Design: `docs/specs/2026-06-22-multi-file-design.md`. Proven spike: `test/spike-multifile.mjs`.

**Tech Stack:** Pyodide 0.27.2 + pygame-ce, CodeMirror 5.65.16 (`CodeMirror.Doc`/`swapDoc`), Python `ast` + `importlib.abc`, Playwright headless harness.

---

## File structure

- `index.html` — all app code (single static file). New regions, in source order:
  1. **Project model** (`project`, `deserialize`, `loadInitialProject`) — inserted after the `storage` helper (~line 790), before the existing load block.
  2. **Bootstrap** — replace the load block (lines 955–962) with `loadInitialProject()`.
  3. **Autosave** — replace the change/beforeunload writers (lines 964–970) with one project-aware writer.
  4. **`PROJECT_PY`** — a new Python string appended right after `BOOT_PY` (after line 731), run in `boot()` right after `runPythonAsync(BOOT_PY)`.
  5. **`run()` dispatch** (lines 1097–1115) — branch single-file vs project.
  6. **Tabs UI** (`#tabs` strip + handlers) — in the editor pane; CSS in `<style>`.
  7. **Share / examples / collab** handlers — made project-aware.
- `test/multifile.mjs` — new headless battery (mirrors `test/assets.mjs`).
- `README.md` — document multi-file (tabs, entry, limitations).

Each task keeps `verify.mjs` and `test/assets.mjs` green and grows `test/multifile.mjs`.

---

## Task 1: Project model + bootstrap + project-aware autosave

Single-file behavior stays identical; no visible UI yet. Exposes `window.project` as a test seam.

**Files:**
- Modify: `index.html` (insert project model after ~line 790; replace load block 955–962; replace autosave 964–970)
- Test: `test/multifile.mjs` (new)

- [ ] **Step 1: Write the failing test** — create `test/multifile.mjs`:

```js
// Headless verification of multi-file support. Mirrors test/assets.mjs.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const booted = () => page.waitForFunction(
  () => ['running','ready','finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));

// 1. Project model exists with a single main.py whose Doc is the editor's own.
const m = await page.evaluate(() => ({
  has: typeof window.project === 'object' && !!window.project,
  order: window.project?.order,
  entry: window.project?.entry,
  active: window.project?.active,
  multi: window.project?.isMulti(),
  docIsEditors: window.project?.files[window.project.active] === document.querySelector('.CodeMirror').CodeMirror.getDoc(),
}));
if (m.has && JSON.stringify(m.order) === '["main.py"]' && m.entry === 'main.py'
    && m.active === 'main.py' && m.multi === false && m.docIsEditors)
  ok('project model: single main.py, entry=active=main.py, doc adopted');
else fail('project model wrong: ' + JSON.stringify(m));

// 2. Autosave writes the project key; reload restores it.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('persisted_main = 1\n');
  window.__flushSave();              // test seam: force the debounced writer
});
const stored = await page.evaluate(() => localStorage.getItem('pygame-playground:project'));
if (stored && JSON.parse(stored).files['main.py'].includes('persisted_main'))
  ok('project autosaved to pygame-playground:project');
else fail('project key not written: ' + stored);
// legacy mirror present in single-file mode (rollback safety)
const legacy = await page.evaluate(() => localStorage.getItem('pygame-playground:code'));
if (legacy && legacy.includes('persisted_main')) ok('legacy key mirrored in single-file mode');
else fail('legacy key not mirrored: ' + legacy);

await page.reload({ waitUntil: 'load' });
await booted().catch(() => fail('did not reboot'));
const restored = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
if (restored.includes('persisted_main')) ok('reload restored saved project');
else fail('reload lost project: ' + restored);

// 3. Migration: a lone legacy key with no project key seeds a one-file project.
await page.evaluate(() => {
  localStorage.removeItem('pygame-playground:project');
  localStorage.setItem('pygame-playground:code', 'from_legacy = 42\n');
});
await page.reload({ waitUntil: 'load' });
await booted().catch(() => fail('did not reboot (migration)'));
const migrated = await page.evaluate(() => ({
  text: document.querySelector('.CodeMirror').CodeMirror.getValue(),
  order: window.project.order,
}));
if (migrated.text.includes('from_legacy') && JSON.stringify(migrated.order) === '["main.py"]')
  ok('legacy code migrated into a one-file project');
else fail('migration failed: ' + JSON.stringify(migrated));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'MULTIFILE VERIFY FAILED' : 'MULTIFILE VERIFY OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/multifile.mjs`
Expected: FAIL — `window.project` is undefined.

- [ ] **Step 3: Implement the project model + bootstrap + autosave**

In `index.html`, **after** the `storage` object (ends ~line 790) and **before** the assets section, insert:

```js
// ---------------------------------------------------------------- project model (multi-file)
// One source of truth for the set of .py files + which is the entry. Text lives
// in per-file CodeMirror.Doc objects (per-file undo). Zero pyodide dependency.
const PROJECT_KEY = "pygame-playground:project";
const isModuleName = (name) =>
  /^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name);     // identifier stem + .py
const project = {
  files: {}, order: [], entry: "main.py", active: "main.py",
  text(name) { return this.files[name].getValue(); },     // live Doc read, never cached
  isMulti() { return this.order.length > 1; },
  serialize() {
    const files = {};
    for (const name of this.order) files[name] = this.files[name].getValue();
    return { files, order: [...this.order], entry: this.entry };
  },
  // Build docs from a plain record; the `active` doc becomes editor.getDoc() (adopt).
  load(rec) {
    const order = (rec.order && rec.order.length ? rec.order : Object.keys(rec.files));
    this.files = {};
    for (const name of order) this.files[name] = new CodeMirror.Doc(rec.files[name] ?? "", "python");
    this.order = order;
    this.entry = order.includes(rec.entry) ? rec.entry : (order.includes("main.py") ? "main.py" : order[0]);
    this.active = order.includes(rec.active) ? rec.active : this.entry;
    editor.swapDoc(this.files[this.active]);
  },
  setActive(name) { if (this.files[name]) { this.active = name; editor.swapDoc(this.files[name]); editor.refresh(); editor.focus(); } },
  add(name, text = "") {
    if (!isModuleName(name) || this.files[name]) return false;
    this.files[name] = new CodeMirror.Doc(text, "python");
    this.order.push(name);
    return true;
  },
  rename(oldName, newName) {
    if (!isModuleName(newName) || this.files[newName] || !this.files[oldName]) return false;
    this.files[newName] = this.files[oldName]; delete this.files[oldName];
    this.order[this.order.indexOf(oldName)] = newName;
    if (this.entry === oldName) this.entry = newName;
    if (this.active === oldName) this.active = newName;
    if (window.pyodide) try { if (pyodide.FS.analyzePath(oldName).exists) pyodide.FS.unlink(oldName); } catch {}
    return true;
  },
  remove(name) {
    if (this.order.length <= 1 || !this.files[name]) return false;
    delete this.files[name];
    this.order = this.order.filter(n => n !== name);
    if (this.entry === name) this.entry = this.order.includes("main.py") ? "main.py" : this.order[0];
    if (this.active === name) this.setActive(this.entry);
    if (window.pyodide) try { if (pyodide.FS.analyzePath(name).exists) pyodide.FS.unlink(name); } catch {}
    return true;
  },
  setEntry(name) { if (this.files[name]) this.entry = name; },
};
window.project = project;   // test seam

// Tolerant deserialize for saved-project / #project= / migration seed.
function deserializeProject(obj) {
  if (!obj || typeof obj.files !== "object" || !obj.files) return null;
  const names = Object.keys(obj.files);
  if (!names.length) return null;
  for (const n of names) if (!isModuleName(n) || typeof obj.files[n] !== "string") return null;
  return { files: obj.files, order: Array.isArray(obj.order) ? obj.order.filter(n => names.includes(n)) : names,
           entry: obj.entry, active: obj.active };
}
function projectFromHash() {
  try {
    if (!location.hash.startsWith("#project=")) return null;
    return deserializeProject(JSON.parse(b64url.dec(location.hash.slice(9))));
  } catch { return null; }
}
function savedProject() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? deserializeProject(JSON.parse(raw)) : null; }
  catch { return null; }
}
```

Now **replace** the existing load block at lines 955–962:

```js
let loadedExample = EXAMPLES[exampleSel.value];
const roomFromHash = location.hash.startsWith("#room=") ? location.hash.slice(6) : null;
if (roomFromHash) {
  editor.setValue("");                                  // blank until the room's code arrives (no default flash)
  joinRoom(roomFromHash).catch((e) => console.error("join failed", e));
} else {
  editor.setValue(codeFromHash() ?? storage.get() ?? loadedExample);
}
```

with:

```js
let loadedExample = EXAMPLES[exampleSel.value];
const roomFromHash = location.hash.startsWith("#room=") ? location.hash.slice(6) : null;
loadInitialProject();
if (roomFromHash) joinRoom(roomFromHash).catch((e) => console.error("join failed", e));

// Build the initial project. Precedence: #room (single-file, joined async above) >
// #project > #code > saved project > legacy code > default example.
function loadInitialProject() {
  if (roomFromHash) { project.load({ files: { "main.py": "" } }); return; }   // blank until room arrives
  const fromProject = projectFromHash();
  if (fromProject) { project.load(fromProject); return; }
  const fromCode = codeFromHash();
  if (fromCode != null) { project.load({ files: { "main.py": fromCode } }); return; }
  const saved = savedProject();
  if (saved) { project.load(saved); return; }
  const legacy = storage.get();
  if (legacy != null) { project.load({ files: { "main.py": legacy } }); return; }   // migrate
  project.load({ files: { "main.py": loadedExample } });
}
```

Now **replace** the autosave block at lines 964–970:

```js
let saveTimer = null;
editor.on("change", () => {
  if (collab.active) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.set(editor.getValue()), 400);
});
addEventListener("beforeunload", () => { if (!collab.active) storage.set(editor.getValue()); });   // flush latest on close
```

with:

```js
let saveTimer = null;
function flushSave() {
  if (collab.active) return;                              // never clobber the solo draft while in a room
  const rec = project.serialize(); rec.active = project.active;
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(rec)); } catch {}
  // Rollback safety: mirror single-file text into the legacy key so an older
  // cached build still sees recent work. Never write a partial multi-file state.
  if (!project.isMulti()) storage.set(project.text(project.active));
}
window.__flushSave = flushSave;                            // test seam
editor.on("change", () => { if (collab.active) return; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 400); });
addEventListener("beforeunload", flushSave);
```

- [ ] **Step 4: Run the tests**

Run: `node test/multifile.mjs && node verify.mjs && node test/assets.mjs`
Expected: all three print `… OK`. (multifile checks 1–3 pass; solo + assets unaffected.)

- [ ] **Step 5: Commit**

```bash
git add index.html test/multifile.mjs
git commit -m "feat(multi-file): project model, project-aware bootstrap + autosave"
```

---

## Task 2: Python run-model (PROJECT_PY) + run() dispatch

Adds the proven cooperative cross-file transform and wires `run()` to it for ≥2 files. Tested by building a 2-file project via `window.project` (tabs UI comes in Task 3).

**Files:**
- Modify: `index.html` (append `PROJECT_PY` after `BOOT_PY` ~line 731; run it in `boot()` ~line 1086; rewrite `run()` 1097–1115)
- Test: `test/multifile.mjs`

- [ ] **Step 1: Write the failing test** — append to `test/multifile.mjs` (before the final error check):

```js
// Helper: install a project of {name.py: src}, set entry, and Run via the real button.
async function runProject(files, entry, activeName) {
  await page.evaluate(({ files, entry, activeName }) => {
    const order = Object.keys(files);
    window.project.load({ files, order, entry, active: activeName || entry });
  }, { files, entry, activeName });
  await page.click('#runBtn');
}
const frame = () => page.evaluate(() => document.getElementById('canvas').toDataURL());
const consoleText = () => page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));

// 4. Cross-file import runs + cooperative imported loop + main thread responsive.
await runProject({
  'main.py': 'import pygame, gamemod\npygame.init()\nscreen = pygame.display.set_mode((320,240))\ngamemod.run(screen)\n',
  'gamemod.py': [
    'import pygame',
    'def run(screen):',
    '    clock = pygame.time.Clock()',
    '    t = 0',
    '    while True:',
    '        for e in pygame.event.get():',
    '            if e.type == pygame.QUIT: raise SystemExit',
    '        t = (t + 3) % 256',
    '        screen.fill((t, 40, 120))',
    '        pygame.display.flip()',
    '        clock.tick(60)',
  ].join('\n'),
}, 'main.py');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 15_000 }).catch(() => fail('multi-file run did not start'));
const f1 = await frame(); await page.waitForTimeout(500); const f2 = await frame();
if (f1 !== f2) ok('cross-file import: imported game loop animates the canvas');
else fail('imported game loop not animating');
const t0 = Date.now(); await page.evaluate(() => 1 + 1); const dt = Date.now() - t0;
if (dt < 500) ok(`main thread responsive during imported loop (${dt}ms)`);
else fail(`tab frozen during imported loop (${dt}ms)`);
await page.evaluate(() => pyodide.runPython('_stop()'));

// 5. Cross-module await matrix: from-import, alias, returned-then-called all run.
await page.evaluate(() => pyodide.runPython('_stop()'));
await runProject({
  'main.py': [
    'import pygame',
    'from logic import boot, make_tick',     // from-import + returned value
    'import logic as L',                      // alias
    'pygame.init()',
    'screen = pygame.display.set_mode((200,150))',
    'boot(screen)',                           // bare from-imported async fn
    'tick = make_tick()',                     // returns a converted async fn
    'L.loop(screen, tick)',                   // alias.attr async fn
  ].join('\n'),
  'logic.py': [
    'import pygame',
    'def boot(screen):',
    '    screen.fill((10,10,10)); pygame.display.flip()',
    'def make_tick():',
    '    def tick(screen, n):',
    '        screen.fill((n%255, 80, 120)); pygame.display.flip()',
    '    return tick',
    'def loop(screen, tick):',
    '    clock = pygame.time.Clock(); n = 0',
    '    while True:',
    '        for e in pygame.event.get():',
    '            if e.type == pygame.QUIT: raise SystemExit',
    '        n = (n + 4) % 255',
    '        tick(screen, n)',                 // returned-then-called inside a module
    '        clock.tick(60)',
  ].join('\n'),
}, 'main.py');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 15_000 }).catch(() => fail('await-matrix run did not start'));
const g1 = await frame(); await page.waitForTimeout(500); const g2 = await frame();
if (g1 !== g2) ok('cross-module await matrix runs (from-import + alias + returned-then-called)');
else fail('await matrix not animating — a coroutine was likely never awaited');
await page.evaluate(() => pyodide.runPython('_stop()'));

// 9. Friendly error: a game loop inside a class method.
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  'main.py': 'import badmod\nbadmod.Thing().go()\n',
  'badmod.py': [
    'import pygame',
    'class Thing:',
    '    def go(self):',
    '        pygame.init(); s = pygame.display.set_mode((80,80))',
    '        while True:',
    '            s.fill((0,0,0)); pygame.display.flip()',
  ].join('\n'),
}, 'main.py');
await page.waitForFunction(() => /class method/.test(
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n')),
  null, { timeout: 15_000 }).then(() => ok('friendly error for game loop in a class method'))
  .catch(async () => fail('no friendly error for in-method loop: ' + await consoleText()));
await page.evaluate(() => pyodide.runPython('_stop()'));

// 11. Single-file byte-identity: solo run still calls _start, not _start_project.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import pygame\npygame.init()\ns=pygame.display.set_mode((120,90))\nn=0\nwhile True:\n    s.fill((n%255,60,90)); pygame.display.flip(); n+=5\n' } });
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 10_000 }).catch(() => fail('solo re-run did not start'));
const usedProjectPath = await page.evaluate(() =>
  pyodide.runPython("1 if _state.get('via_project') else 0"));
if (!usedProjectPath) ok('single file uses _start (not _start_project)');
else fail('single file wrongly took the project path');
await page.evaluate(() => pyodide.runPython('_stop()'));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/multifile.mjs`
Expected: FAIL — `_start_project` undefined / multi-file run never starts.

- [ ] **Step 3: Implement `PROJECT_PY` + run it in boot + dispatch in run()**

In `index.html`, **after** the closing backtick of `BOOT_PY` (line 731), add a new constant. This is the proven spike transform, plus: friendly loop-placement errors, MEMFS reconcile/unlink, a `via_project` flag, and the entry-source-from-files convention.

```js
// ---------------------------------------------------------------- multi-file run model (additive)
// Appended after BOOT_PY. Adds ONLY new names; reuses BOOT_PY's _SyncBarrier,
// _is_gameloop, _Asyncify, _Awaiter, _InjectYield, _time_names, __yield__,
// __sleep__, _state, _stop. Never touches _start/_run/_transform. The blanket
// transform (every module fn -> async, every call -> await __maybe_await__) is
// the version proven in test/spike-multifile.mjs.
const PROJECT_PY = String.raw`
import sys, ast, importlib, importlib.abc, importlib.util, inspect, traceback, os

class _ProjectError(Exception):
    pass

async def __maybe_await__(value):
    if inspect.iscoroutine(value):
        return await value
    return value

class _AwaitCalls(_SyncBarrier):
    def _wrap(self, call):
        return ast.copy_location(ast.Await(value=ast.Call(
            func=ast.Name('__maybe_await__', ast.Load()), args=[call], keywords=[])), call)
    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id in ('__maybe_await__', '__yield__', '__sleep__'):
            return node
        return self._wrap(node)

class _AsyncifyAll(ast.NodeTransformer):
    def __init__(self):
        self.converted = set()
    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        node.__class__ = ast.AsyncFunctionDef
        self.converted.add(node.name)
        return node
    def visit_ClassDef(self, node):
        return node          # methods stay sync (see friendly-error check below)

def _check_loop_placement(tree, filename):
    for stmt in tree.body:
        if isinstance(stmt, ast.While) and _is_gameloop(stmt):
            raise _ProjectError(filename + ': a game loop must be in the entry file '
                                'or a module-level function — not at module top level.')
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for n in ast.walk(node):
                if isinstance(n, ast.While) and _is_gameloop(n):
                    raise _ProjectError(filename + ': a game loop inside a class method '
                                        "isn't supported — move it to a module-level function or the entry file.")

def _transform_module(src, filename):
    tree = ast.parse(src)
    _check_loop_placement(tree, filename)
    asyncify = _AsyncifyAll()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _AwaitCalls().visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, 'exec')

_PROJECT_FILES = {}      # stem -> abs path in MEMFS
_PROJECT_PATHS = set()   # abs paths written last run (for unlink reconcile)
_MOD_HELPERS = {'__maybe_await__': __maybe_await__, '__yield__': __yield__, '__sleep__': __sleep__}

class _ProjectLoader(importlib.abc.Loader):
    def __init__(self, modname, path):
        self.modname, self.path = modname, path
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        with open(self.path, 'r') as f:
            src = f.read()
        code = _transform_module(src, self.path)
        module.__dict__.update(_MOD_HELPERS)
        exec(code, module.__dict__)

class _ProjectFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname in _PROJECT_FILES:
            return importlib.util.spec_from_loader(fullname, _ProjectLoader(fullname, _PROJECT_FILES[fullname]))
        return None

def _install_finder():
    if not any(isinstance(f, _ProjectFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, _ProjectFinder())

def _transform_entry(src):
    tree = ast.parse(src)
    asyncify = _Asyncify()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _AwaitCalls().visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, '<entry>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

async def _run_project(files, entry):
    cwd = os.getcwd()
    new_paths = set()
    _PROJECT_FILES.clear()
    for fname, msrc in files.items():
        stem = fname[:-3] if fname.endswith('.py') else fname
        path = os.path.join(cwd, fname)
        with open(path, 'w') as f:
            f.write(msrc)
        _PROJECT_FILES[stem] = path
        new_paths.add(path)
    for old in _PROJECT_PATHS - new_paths:
        try:
            if os.path.exists(old): os.unlink(old)
        except Exception:
            pass
    _PROJECT_PATHS.clear(); _PROJECT_PATHS.update(new_paths)

    _install_finder()
    importlib.invalidate_caches()
    for fname in files:
        sys.modules.pop(fname[:-3] if fname.endswith('.py') else fname, None)
    if '' not in sys.path:
        sys.path.insert(0, '')

    glb = {'__name__': '__main__', '__yield__': __yield__, '__sleep__': __sleep__,
           '__maybe_await__': __maybe_await__, '__builtins__': __builtins__}
    try:
        code = _transform_entry(files[entry])
    except SyntaxError:
        traceback.print_exc(limit=0); return 'error'
    try:
        if pygame.get_init():
            pygame.event.clear()
        res = eval(code, glb)
        if asyncio.iscoroutine(res):
            await res
        return 'ok'
    except asyncio.CancelledError:
        return 'stopped'
    except SystemExit:
        return 'exit'
    except _ProjectError as e:
        print(str(e)); return 'error'
    except BaseException:
        traceback.print_exc(); return 'error'

def _start_project(files, entry):
    _stop()
    _state.update(delay=0.0, flipped=False, ticked=False, n=0, via_project=True)
    _state['task'] = asyncio.ensure_future(_run_project(dict(files), str(entry)))
    return _state['task']
`;
```

In `boot()`, after `await pyodide.runPythonAsync(BOOT_PY);` (line 1086), add:

```js
  await pyodide.runPythonAsync(PROJECT_PY);
```

Rewrite `run()` (lines 1097–1115). Note `_state['via_project']` is cleared by `_start` automatically? It is not — `_start` doesn't set it, so set it false on the solo branch via a tiny inline. Replace the body:

```js
async function run() {
  try { await booted; } catch { return; }
  clearConsole();
  canvasEl.focus();
  resumeAudio();
  let task;
  if (collab.active || !project.isMulti()) {
    pyodide.runPython("_state['via_project'] = False");
    const start = pyodide.globals.get("_start");
    task = start(editor.getValue());          // existing single-file path, verbatim
    start.destroy();
  } else {
    const startP = pyodide.globals.get("_start_project");
    const filesPy = pyodide.toPy(project.serialize().files);
    task = startP(filesPy, project.entry);
    startP.destroy(); filesPy.destroy();
  }
  runTask = task;
  setStatus("running", "running");
  task.then((kind) => {
    if (runTask !== task) return;
    if (kind === "error") return setStatus("error", "error — see console");
    setStatus("ready", kind === "stopped" ? "stopped" : "finished");
    logLine(kind === "stopped" ? "— stopped —" : "— program finished —", "sys");
  }).catch(() => {
    if (runTask === task) setStatus("ready", "stopped");
  });
}
```

Also add `via_project` to the initial `_state` dict in `BOOT_PY` (line 526) so `_state.get('via_project')` is always defined:

```python
_state = {"task": None, "delay": 0.0, "flipped": False, "ticked": False, "n": 0, "via_project": False}
```

- [ ] **Step 4: Run the tests**

Run: `node test/multifile.mjs && node verify.mjs && node test/assets.mjs`
Expected: all `… OK`. multifile checks 4, 5, 9, 11 now pass.

- [ ] **Step 5: Commit**

```bash
git add index.html test/multifile.mjs
git commit -m "feat(multi-file): cooperative cross-file run model + run() dispatch"
```

---

## Task 3: Tabs UI (strip, switch, add, per-tab menu)

**Files:**
- Modify: `index.html` (CSS in `<style>`; `#tabs` markup in `#editorPane`; tab handlers near the project model)
- Test: `test/multifile.mjs`

- [ ] **Step 1: Write the failing test** — append to `test/multifile.mjs`:

```js
// 6 + tabs: add a file via the model+renderer, assert a tab appears, switch, edit persists.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' } });    // reset to single
  window.renderTabs();
});
let tabsHiddenSolo = await page.evaluate(() => {
  const t = document.getElementById('tabs');
  return !t || t.offsetParent === null || t.children.length === 0;
});
if (tabsHiddenSolo) ok('tab strip absent in single-file mode');
else fail('tab strip showing for a single file');

await page.evaluate(() => {
  window.project.add('enemy.py', '# enemy\ndef spawn():\n    return 1\n');
  window.project.setActive('main.py');
  window.renderTabs();
});
const tabNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#tabs .tab')).map(t => t.dataset.name));
if (JSON.stringify(tabNames) === '["main.py","enemy.py"]') ok('tabs render both files');
else fail('tabs wrong: ' + JSON.stringify(tabNames));

// Switch to enemy.py by clicking its tab; editor shows enemy source; mode is python.
await page.click('#tabs .tab[data-name="enemy.py"]');
const afterSwitch = await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  return { val: cm.getValue(), active: window.project.active,
           hasComment: !!document.querySelector('.CodeMirror .cm-comment') };
});
if (afterSwitch.val.includes('enemy') && afterSwitch.active === 'enemy.py' && afterSwitch.hasComment)
  ok('tab switch swaps doc + Python highlighting on the new file');
else fail('tab switch wrong: ' + JSON.stringify(afterSwitch));

// Entry badge on main.py; set enemy.py as entry moves it.
await page.evaluate(() => { window.project.setEntry('enemy.py'); window.renderTabs(); });
const entryTab = await page.evaluate(() =>
  document.querySelector('#tabs .tab.entry')?.dataset.name);
if (entryTab === 'enemy.py') ok('set-as-entry moves the entry badge');
else fail('entry badge wrong: ' + entryTab);

// Non-active edit survives reload (serialize reads every Doc).
await page.evaluate(() => {
  window.project.setEntry('main.py');
  window.project.files['enemy.py'].setValue('# enemy edited\nZZ = 9\n');  // edit non-active doc
  window.__flushSave();
});
await page.reload({ waitUntil: 'load' });
await booted().catch(() => fail('did not reboot (tabs persist)'));
const enemyAfter = await page.evaluate(() => window.project.files['enemy.py']?.getValue());
if (enemyAfter && enemyAfter.includes('ZZ = 9')) ok('non-active tab edit survives reload');
else fail('non-active edit lost: ' + enemyAfter);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/multifile.mjs`
Expected: FAIL — `renderTabs` undefined / no `#tabs`.

- [ ] **Step 3: Implement the tabs UI**

CSS — add to `<style>` (near the editor rules, ~line 44):

```css
  #editorPane { flex-direction: column; }
  #tabs { display: none; flex: 0 0 auto; align-items: stretch; background: var(--panel);
          border-bottom: 1px solid var(--edge); overflow-x: auto; }
  #tabs.show { display: flex; }
  #tabs .tab { display: flex; align-items: center; gap: 5px; padding: 5px 9px; font-size: 12px;
               color: var(--dim); border-right: 1px solid var(--edge); cursor: pointer; white-space: nowrap; }
  #tabs .tab:hover { color: var(--text); }
  #tabs .tab.active { color: var(--text); background: #1c1e26; box-shadow: inset 0 -2px 0 var(--accent); }
  #tabs .tab.entry .tab-name::before { content: "▸ "; color: var(--accent); }
  #tabs .tab-menu { color: var(--dim); border: none; background: none; cursor: pointer; font-size: 12px; padding: 0 2px; }
  #tabs .tab-add { padding: 5px 10px; color: var(--accent); cursor: pointer; user-select: none; }
  .CodeMirror { min-height: 0; }
```

The `#editorPane` must contain the tab strip above the editor. Change the markup at line 129 from:

```html
  <div id="editorPane"><textarea id="code"></textarea></div>
```

to:

```html
  <div id="editorPane"><div id="tabs"></div><textarea id="code"></textarea></div>
```

(`CodeMirror.fromTextArea` replaces the textarea in place, leaving `#tabs` as the first child — the column flex stacks tabs over the editor.)

Add the renderer + handlers after the project model (and after `editor` exists). Escape names with the existing `esc` (defined in the assets section) — but the assets `esc` is defined later; add a local one here:

```js
// ---------------------------------------------------------------- tabs UI
const tabsEl = document.getElementById("tabs");
const escTab = (s) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function renderTabs() {
  const show = project.isMulti() && !collab.active;
  tabsEl.classList.toggle("show", show);
  if (!show) { tabsEl.innerHTML = ""; editor.refresh(); return; }
  tabsEl.innerHTML = project.order.map(name => `
    <div class="tab${name === project.active ? " active" : ""}${name === project.entry ? " entry" : ""}" data-name="${escTab(name)}">
      <span class="tab-name">${escTab(name)}</span>
      <button class="tab-menu" title="File actions">⋯</button>
    </div>`).join("") + `<span class="tab-add" title="New file">+</span>`;
  editor.refresh();
}
window.renderTabs = renderTabs;   // test seam
tabsEl.addEventListener("click", (e) => {
  const add = e.target.closest(".tab-add");
  if (add) {
    const name = prompt("New file name (e.g. enemy.py):", "");
    if (name == null) return;
    if (!project.add(name.endsWith(".py") ? name : name + ".py")) { alert("Use a valid, unique name ending in .py"); return; }
    project.setActive(name.endsWith(".py") ? name : name + ".py");
    renderTabs(); flushSave();
    return;
  }
  const menuBtn = e.target.closest(".tab-menu");
  const tab = e.target.closest(".tab");
  if (!tab) return;
  const name = tab.dataset.name;
  if (menuBtn) { tabMenu(name); return; }
  project.setActive(name); renderTabs();
});
function tabMenu(name) {
  const action = prompt(`File "${name}" — type: entry / rename / delete`, "");
  if (!action) return;
  if (action === "entry") { project.setEntry(name); }
  else if (action === "rename") {
    let next = prompt(`Rename "${name}" to:`, name);
    if (next == null) return;
    if (!next.endsWith(".py")) next += ".py";
    if (!project.rename(name, next)) { alert("Invalid or duplicate name."); return; }
    alert(`Renamed. Note: 'import ${name.slice(0, -3)}' references in other files are NOT updated — fix them manually.`);
  } else if (action === "delete") {
    if (project.order.length <= 1) { alert("Can't delete the only file."); return; }
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    project.remove(name);
  }
  renderTabs(); flushSave();
}
```

Call `renderTabs()` once after `loadInitialProject()` (add the line right after it in the bootstrap):

```js
loadInitialProject();
renderTabs();
```

- [ ] **Step 4: Run the tests**

Run: `node test/multifile.mjs && node verify.mjs && node test/assets.mjs`
Expected: all `… OK`. (verify.mjs step 5 still drives a single-file example — tabs stay hidden, layout pixel-identical.)

- [ ] **Step 5: Commit**

```bash
git add index.html test/multifile.mjs
git commit -m "feat(multi-file): editor tabs (switch/add/rename/delete/set-entry)"
```

---

## Task 4: Project-aware Share, examples guard, #project= round-trip, collab single-file

**Files:**
- Modify: `index.html` (share handler 972–978; examples handler 979–987; collab `startRoom` 1246–1254)
- Test: `test/multifile.mjs`

- [ ] **Step 1: Write the failing test** — append to `test/multifile.mjs`:

```js
// 7. Share button emits #project= for multi-file and round-trips on reload.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import helper\nhelper.f()\n', 'helper.py': 'def f():\n    print("HI")\n' },
                        order: ['main.py','helper.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  navigator.clipboard.writeText = () => Promise.resolve();   // avoid clipboard perms
});
await page.click('#shareBtn');
const hash = await page.evaluate(() => location.hash);
if (hash.startsWith('#project=')) ok('Share emits #project= in multi-file mode');
else fail('Share did not emit #project=: ' + hash);
await page.goto(URL + hash, { waitUntil: 'load' });
await booted().catch(() => fail('did not boot from #project='));
const round = await page.evaluate(() => ({ order: window.project.order,
  helper: window.project.files['helper.py']?.getValue() }));
if (JSON.stringify(round.order) === '["main.py","helper.py"]' && round.helper.includes('HI'))
  ok('#project= round-trips the whole project');
else fail('#project= round-trip wrong: ' + JSON.stringify(round));

// 7b. A malformed #project= falls through to the saved project (no clobber).
await page.evaluate(() => localStorage.setItem('pygame-playground:project',
  JSON.stringify({ files: { 'main.py': 'SAVED = 1\n' }, order: ['main.py'], entry: 'main.py' })));
await page.goto(URL + '#project=not%20valid%20base64!!', { waitUntil: 'load' });
await booted().catch(() => fail('did not boot (bad #project=)'));
const fellThrough = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
if (fellThrough.includes('SAVED')) ok('malformed #project= falls through to saved project');
else fail('bad #project= clobbered saved project: ' + fellThrough);

// 8 (perf sanity): a 2-file game with a per-frame cross-module call sustains animation.
await page.goto(URL, { waitUntil: 'load' }); await booted();
await runProject({
  'main.py': 'import pygame, draw\npygame.init()\nscreen=pygame.display.set_mode((240,180))\nclock=pygame.time.Clock()\nn=0\nwhile True:\n    n=(n+2)%255\n    draw.frame(screen, n)\n    pygame.display.flip()\n    clock.tick(60)\n',
  'draw.py': 'import pygame\ndef frame(screen, n):\n    screen.fill((n, 60, 120))\n',
}, 'main.py');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 15_000 }).catch(() => fail('perf run did not start'));
const p1 = await frame(); await page.waitForTimeout(600); const p2 = await frame();
const pr0 = Date.now(); await page.evaluate(() => 1+1); const prdt = Date.now() - pr0;
if (p1 !== p2 && prdt < 500) ok(`per-frame cross-module call sustains animation, responsive (${prdt}ms)`);
else fail(`perf sanity failed (animating=${p1!==p2}, resp=${prdt}ms)`);
await page.evaluate(() => pyodide.runPython('_stop()'));

// 10. No cross-run contamination: drop to one file, solo-import the old module -> ModuleNotFoundError.
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue('import draw\nprint(draw)\n');
  window.project.load({ files: { 'main.py': 'import draw\nprint(draw)\n' } });   // single file now
});
await page.click('#runBtn');
await page.waitForFunction(() => /ModuleNotFoundError|No module named/.test(
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n')),
  null, { timeout: 12_000 }).then(() => ok('no cross-run contamination: stale module unlinked'))
  .catch(() => fail('stale module still importable after dropping to single file'));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/multifile.mjs`
Expected: FAIL — Share emits `#code=`; bad `#project=` may blank the editor; contamination check fails.

- [ ] **Step 3: Implement project-aware Share, examples, collab**

Replace the Share handler (lines 972–978):

```js
document.getElementById("shareBtn").addEventListener("click", async (e) => {
  let url;
  if (project.isMulti()) {
    url = location.origin + location.pathname + "#project=" + b64url.enc(JSON.stringify(project.serialize()));
    if (url.length > 16000) {
      logLine("This project is too large to share by link — use Save or Collaborate instead.", "sys");
      return;
    }
  } else {
    url = location.origin + location.pathname + "#code=" + b64url.enc(editor.getValue());
  }
  history.replaceState(null, "", url);
  const btn = e.currentTarget;
  btn.textContent = await navigator.clipboard.writeText(url).then(() => "✓ copied", () => "✓ in URL bar");
  setTimeout(() => { btn.textContent = "🔗 Share"; }, 1500);
});
```

Replace the examples handler (lines 979–987):

```js
exampleSel.addEventListener("change", () => {
  const dirty = project.isMulti() || editor.getValue() !== loadedExample;
  const msg = project.isMulti()
    ? `Replace your whole project (${project.order.length} files) with this example?`
    : "Replace your current code with the example?";
  if (dirty && !confirm(msg)) return;
  loadedExample = EXAMPLES[exampleSel.value];
  project.load({ files: { "main.py": loadedExample } });   // collapse to a one-file project
  renderTabs();
  run();
});
```

Make starting a room single-file from the entry. Replace `startRoom()`'s create line (line 1249) so a multi-file project shares only the entry, with a notice and the project preserved. Replace the body of `startRoom` (1246–1254):

```js
async function startRoom() {
  collab.lib = await loadAutomerge();
  let seed = editor.getValue();
  if (project.isMulti()) {
    if (!confirm(`Live collaboration is single-file. Share only your entry file (${project.entry})? `
               + `Your full project stays saved locally and returns when you reload.`)) return;
    seed = project.text(project.entry);
  }
  collab.repo = new collab.lib.Repo({ network: [new collab.lib.WebSocketClientAdapter("wss://sync.automerge.org")] });
  collab.handle = collab.repo.create({ code: seed });
  await collab.handle.whenReady();
  location.hash = "#room=" + collab.handle.url;
  await enterRoom();
  copyRoomLink();
}
```

In `enterRoom()` (after `collab.active = true`), hide the tabs so the room is visibly single-file — add `renderTabs();` after line 1271 (it returns early since `collab.active` is now true).

- [ ] **Step 4: Run the tests**

Run: `node test/multifile.mjs && node verify.mjs && node test/assets.mjs && node test/collab.mjs`
Expected: all `… OK`.

- [ ] **Step 5: Commit**

```bash
git add index.html test/multifile.mjs
git commit -m "feat(multi-file): project-aware share/examples, #project= links, single-file collab"
```

---

## Task 5: Docs + full-battery verification

**Files:**
- Modify: `README.md`
- Verify: all four batteries

- [ ] **Step 1: Document multi-file in `README.md`** — add a section after "Images & sounds":

```markdown
## Multiple files

Click **+** in the editor tab strip to add `.py` files. One file is the **entry**
(▸ badge, defaults to `main.py`) — **Run** always runs the entry, which can
`import` the others by name:

```python
# main.py
import enemy
e = enemy.Enemy(100, 80)
```

Cooperative pacing works across files: a game loop or `time.sleep` inside a
*module-level function* of an imported file runs without freezing the tab. Use
the **⋯** menu on a tab to set-as-entry, rename, or delete a file.

Limitations (v1): flat files only (no folders/packages); renaming a file does
**not** update `import` statements in other files; a game loop at a module's top
level or inside a class method isn't supported (you'll get a clear message —
keep loops in the entry or in module-level functions). Multi-file projects are
**solo** — live Collaboration shares only the entry file. Share a whole project
with the 🔗 link (it carries every file); very large projects may exceed the URL
limit (use the browser's save instead).

`test/multifile.mjs` is the headless battery for this feature.
```

- [ ] **Step 2: Run the full suite**

Run: `node verify.mjs && node test/assets.mjs && node test/collab.mjs && node test/multifile.mjs`
Expected: four `… OK` lines, exit 0.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(multi-file): document tabs, entry, imports, and limitations"
```

---

## Self-review notes (author)

- **Spec coverage:** project model, tabs (A), designated entry, flat files, blanket cooperative transform in additive PROJECT_PY, bootstrap precedence + tolerant deserialize, single project-aware autosave + legacy mirror, project-aware Share (+size guard) / examples / `#project=` validation, name-only rename + warning, single-file collab with entry-seed, MEMFS reconcile/unlink, friendly transform-time errors, full test battery — each maps to a task above.
- **Test seams** (`window.project`, `window.renderTabs`, `window.__flushSave`) are intentionally exposed for the headless battery; harmless in production.
- **Byte-identity:** the solo branch calls `_start(editor.getValue())` verbatim; PROJECT_PY adds only new names; `_state` gains one key (`via_project`) defaulted in BOOT_PY. verify.mjs/assets.mjs/collab.mjs run unchanged.
- **Known-unsupported (documented):** higher-order indirection of converted functions (`funcs[0]()`), loops at module top level / in methods, multi-file collaboration.
```
