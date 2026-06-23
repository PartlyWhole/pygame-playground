// SPIKE (throwaway de-risking): MULTI-FILE cooperative pygame run.
//
// Proves, in REAL headless Chromium against the live index.html, that several
// .py files (entry imports a sibling module) can run cooperatively on the
// browser main thread WITHOUT freezing — even when the imported module contains
// a real pygame game loop or a time.sleep / pygame.time.wait.
//
// We do NOT modify index.html. The proposed run-model is injected at runtime via
// pyodide.runPythonAsync, reusing index.html's already-booted _transform / __yield__
// / __sleep__ / _state machinery from BOOT_PY. The injected Python:
//   1. writes project files into MEMFS (bare names -> cwd /home/pyodide),
//   2. installs a sys.meta_path finder that runs an EXTENDED _transform on the
//      source of project modules at import time (loop-fns -> async def), and
//      wraps call expressions so a returned coroutine is transparently awaited,
//   3. clears sys.modules for project modules each run so edits are picked up,
//   4. runs the entry buffer with the SAME entry transform + the await-wrapper.
//
// Run:  node test/spike-multifile.mjs   (server must be on :8923)

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));

let failures = 0;
const fail = (msg) => { console.error('FAIL:', msg); failures++; };
const ok = (msg) => console.log('ok   -', msg);
const info = (msg) => console.log('info -', msg);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('index.html never booted'));
ok('index.html booted (pyodide + pygame ready)');

// Stop the auto-run default example so it doesn't compete for the event loop.
await page.evaluate(() => pyodide.runPython('_stop()'));

// ---------------------------------------------------------------------------
// The injected run-model. This is the candidate design for the real feature.
// It is pure Python, eval'd once into pyodide.globals via runPythonAsync. It
// REUSES the names already defined by BOOT_PY: _transform's building blocks
// (_Asyncify, _Awaiter, _InjectYield, _is_gameloop, _shallow, _time_names),
// __yield__, __sleep__, _state, asyncio, ast, copy, sys.
// ---------------------------------------------------------------------------
const RUN_MODEL_PY = String.raw`
import sys, ast, copy, types, asyncio, inspect, importlib, importlib.abc, importlib.util, traceback

# ---- generic cross-module await helper -------------------------------------
# In an async context a call into a project module may return a coroutine
# (because that module's loop-function was converted to async def by the import
# hook). The entry transform can't know that statically, so every call site in
# an async context is wrapped: await __maybe_await__(<call>). If the result is a
# coroutine we await it; otherwise we pass the plain value straight through.
async def __maybe_await__(value):
    if inspect.iscoroutine(value):
        return await value
    return value

# ---- transform pass: wrap calls so cross-module coroutines get awaited -------
# Only applied inside async scopes (the entry top-level, and converted async
# defs). _SyncBarrier (from BOOT_PY) stops us descending into sync defs/classes
# where 'await' is illegal. We wrap *every* Call node value (not just known
# names), which subsumes the entry's existing converted-name / asyncio.run
# special-cases for cross-module robustness.
class _AwaitCalls(_SyncBarrier):
    def _wrap(self, call):
        return ast.copy_location(
            ast.Await(value=ast.Call(
                func=ast.Name('__maybe_await__', ast.Load()),
                args=[call], keywords=[])),
            call)
    def visit_Call(self, node):
        self.generic_visit(node)            # rewrite nested calls first
        # don't double-wrap our own helpers / awaitables
        if isinstance(node.func, ast.Name) and node.func.id in (
                '__maybe_await__', '__yield__', '__sleep__'):
            return node
        return self._wrap(node)

# ---- module-level asyncify: convert EVERY function to async ------------------
# KEY DIFFERENCE from the entry's _Asyncify (which only converts functions that
# contain a game loop): a project module may have a function that PAUSES
# (time.sleep / pygame.time.wait) but has NO while-loop. For that pause to be
# cooperative it must run as an await, which requires the function to be async.
# So at module scope we make ALL functions async and register their names, so
# (a) _Awaiter rewrites time.sleep/pygame.time.wait inside them to await __sleep__,
# and (b) callers await the returned coroutine via __maybe_await__. Converting a
# function to async is safe at import time because it's only DEFINED, not called.
class _AsyncifyAll(ast.NodeTransformer):
    def __init__(self):
        self.converted = set()
    def visit_FunctionDef(self, node):
        self.generic_visit(node)            # convert nested defs too
        node.__class__ = ast.AsyncFunctionDef
        self.converted.add(node.name)
        return node
    def visit_ClassDef(self, node):
        # methods inside classes: leave sync (awaiting self.method() generically
        # is out of scope for the spike; module-level functions cover the proof).
        return node

def _transform_module(src, filename):
    tree = ast.parse(src)
    asyncify = _AsyncifyAll()
    tree = asyncify.visit(tree)
    time_mods, sleep_names = _time_names(tree)
    tree = _Awaiter(asyncify.converted, time_mods, sleep_names).visit(tree)
    tree = _AwaitCalls().visit(tree)          # cross-module await wrapping
    tree = _InjectYield().visit(tree)         # yields inside async while-bodies
    ast.fix_missing_locations(tree)
    return compile(tree, filename, 'exec'), asyncify.converted

# ---- the import hook -------------------------------------------------------
# A meta_path finder/loader that, for names registered in _PROJECT_FILES, loads
# the (already-in-MEMFS) source, transforms it, and execs the transformed code
# as the module body. Because import is synchronous and we only DEFINE async
# defs (never call/await at module top level), exec is a normal sync exec.
_PROJECT_FILES = {}     # modname -> /abs/path in MEMFS

# The cooperative helpers the transformed module body references. They must be
# present in the imported module's own globals (exec uses module.__dict__ as
# globals; these names are NOT builtins).
_MOD_HELPERS = {'__maybe_await__': __maybe_await__,
                '__yield__': __yield__, '__sleep__': __sleep__}

class _ProjectLoader(importlib.abc.Loader):
    def __init__(self, modname, path):
        self.modname, self.path = modname, path
    def create_module(self, spec):
        return None     # default module creation
    def exec_module(self, module):
        with open(self.path, 'r') as f:
            src = f.read()
        code, _converted = _transform_module(src, self.path)
        module.__dict__.update(_MOD_HELPERS)     # inject cooperative helpers
        exec(code, module.__dict__)

class _ProjectFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname in _PROJECT_FILES:
            return importlib.util.spec_from_loader(
                fullname, _ProjectLoader(fullname, _PROJECT_FILES[fullname]))
        return None

def _install_finder():
    if not any(isinstance(f, _ProjectFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, _ProjectFinder())

# ---- the project-aware entry transform -------------------------------------
# Same as BOOT_PY's _transform, but adds _AwaitCalls so the entry can call into
# project modules and transparently await any coroutine they return.
def _transform_entry(src):
    tree = ast.parse(src)
    asyncify = _Asyncify()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _AwaitCalls().visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, '<entry>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

# ---- run management for the multi-file model -------------------------------
async def _run_project(entry_src, modules):
    # modules: dict {modname: source}. Write each to MEMFS as <modname>.py.
    import os
    _PROJECT_FILES.clear()
    for name, msrc in modules.items():
        path = os.path.join(os.getcwd(), name + '.py')
        with open(path, 'w') as f:
            f.write(msrc)
        _PROJECT_FILES[name] = path

    _install_finder()
    importlib.invalidate_caches()

    # CRITICAL per-run cache clear: drop any previously-imported project modules
    # so edited source is re-read & re-transformed (else sys.modules serves stale).
    for name in list(modules):
        sys.modules.pop(name, None)

    # Ensure cwd is importable. /home/pyodide is cwd; '' resolves to it.
    if '' not in sys.path:
        sys.path.insert(0, '')

    glb = {'__name__': '__main__', '__yield__': __yield__, '__sleep__': __sleep__,
           '__maybe_await__': __maybe_await__, '__builtins__': __builtins__}
    try:
        code = _transform_entry(entry_src)
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
    except BaseException:
        traceback.print_exc(); return 'error'

def _start_project(entry_src, modules):
    _stop()
    _state.update(delay=0.0, flipped=False, ticked=False, n=0)
    _state['task'] = asyncio.ensure_future(_run_project(entry_src, dict(modules)))
    return _state['task']

print('RUN_MODEL_INSTALLED')
`;

// Inject the run-model. Convert the JS object of modules to a Python dict via a
// small wrapper so we can call _start_project(entry, {modname: src}).
await page.evaluate(async (src) => {
  await pyodide.runPythonAsync(src);
  // Expose a JS-friendly launcher: takes entry string + a {name: source} object.
  // NOTE: we must NOT return the task here. _start_project returns a pyodide
  // Future/PyProxy; if it escapes back through page.evaluate, Playwright tries to
  // serialize a live, self-referential proxy across the CDP bridge, which hangs
  // until the renderer watchdog kills the page. We destroy it and return nothing.
  window.__startProject = (entrySrc, modulesObj) => {
    const start = pyodide.globals.get('_start_project');
    const pyModules = pyodide.toPy(modulesObj);
    const task = start(entrySrc, pyModules);
    start.destroy(); pyModules.destroy();
    if (task && typeof task.destroy === 'function') task.destroy();
  };
}, RUN_MODEL_PY);
ok('run-model injected (import hook + cross-module await + per-run cache clear)');

// Helper to read the page console div.
const readConsole = () => page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
const frame = () => page.evaluate(() => document.getElementById('canvas').toDataURL());
const clearConsole = () => page.evaluate(() => { document.getElementById('console').textContent = ''; });

// ===========================================================================
// Q1 — does cross-file import resolve from MEMFS, and what is required?
// ===========================================================================
console.log('\n===== Q1: cross-file import from MEMFS =====');

// Q1a. Baseline probe done in raw Python (no transform): write helper.py to
// MEMFS, import it, call a function. Report cwd, sys.path[:3], success.
const q1a = await page.evaluate(async () => {
  const probe = String.raw`
import os, sys, importlib, json
res = {}
res['cwd'] = os.getcwd()
# Write a sibling module by bare name into cwd.
with open('helperA.py', 'w') as f:
    f.write('VALUE = 41\ndef add_one(x):\n    return x + 1\n')
res['empty_in_path'] = '' in sys.path
res['cwd_in_path'] = os.getcwd() in sys.path
# Save & strip cwd/'' from sys.path so we test resolution WITHOUT a path fix.
_saved = list(sys.path)
sys.path[:] = [p for p in sys.path if p not in ('', os.getcwd())]
sys.modules.pop('helperA', None)
try:
    import helperA
    res['import_no_pathfix'] = helperA.add_one(helperA.VALUE)
except Exception as e:
    res['import_no_pathfix'] = 'ERR: ' + repr(e)
# Restore, then prove the fix works.
sys.path[:] = _saved
if '' not in sys.path:
    sys.path.insert(0, '')
sys.modules.pop('helperA', None)
try:
    import helperA as h2
    res['import_with_pathfix'] = h2.add_one(h2.VALUE)
except Exception as e:
    res['import_with_pathfix'] = 'ERR: ' + repr(e)
json.dumps(res)
`;
  return JSON.parse(await pyodide.runPythonAsync(probe));
}).catch(e => ({ error: String(e) }));
info('Q1a probe: ' + JSON.stringify(q1a));
if (String(q1a.import_no_pathfix) === '42') {
  ok(`bare import resolved from cwd MEMFS WITHOUT sys.path edits (cwd=${q1a.cwd}, '' in default path=${q1a.empty_in_path}, cwd in default path=${q1a.cwd_in_path})`);
} else {
  info(`without '' or cwd on sys.path, import fails: ${q1a.import_no_pathfix}`);
  if (String(q1a.import_with_pathfix) === '42')
    ok(`sys.path.insert(0, '') makes the cwd-MEMFS import resolve (returns ${q1a.import_with_pathfix})`);
  else
    fail(`even with sys.path.insert(0, '') import failed: ${q1a.import_with_pathfix}`);
}
if (String(q1a.import_with_pathfix) === '42' && (q1a.empty_in_path || q1a.cwd_in_path))
  ok(`cwd/'' is present on the default sys.path (empty=${q1a.empty_in_path}, cwd=${q1a.cwd_in_path})`);

// Q1b. Stale-module test: import a module, then edit its source on disk, then
// re-import WITHOUT clearing sys.modules (should serve stale), then WITH a
// sys.modules.pop (should pick up the edit). Proves the cache-clear requirement.
const q1b = await page.evaluate(async () => {
  const probe = String.raw`
import sys, importlib, json
res = {}
with open('helperB.py', 'w') as f:
    f.write('def version():\n    return "v1"\n')
sys.modules.pop('helperB', None)
import helperB
res['first'] = helperB.version()
# Edit the file on disk.
with open('helperB.py', 'w') as f:
    f.write('def version():\n    return "v2"\n')
importlib.invalidate_caches()
import helperB as hb2          # no pop -> module object cached
res['reimport_no_pop'] = hb2.version()
# Now clear the cache and re-import.
sys.modules.pop('helperB', None)
import helperB as hb3
res['reimport_after_pop'] = hb3.version()
json.dumps(res)
`;
  return JSON.parse(await pyodide.runPythonAsync(probe));
}).catch(e => ({ error: String(e) }));
info('Q1b probe: ' + JSON.stringify(q1b));
if (q1b.first === 'v1' && q1b.reimport_no_pop === 'v1' && q1b.reimport_after_pop === 'v2') {
  ok('module cache: re-import serves STALE v1 without a pop; sys.modules.pop makes re-run pick up v2 (cache-clear is REQUIRED)');
} else {
  fail('Q1b cache behavior unexpected: ' + JSON.stringify(q1b));
}

// ===========================================================================
// Q2 — cooperative async ACROSS files (THE HARD ONE)
// ===========================================================================
console.log('\n===== Q2: cooperative async across files =====');

// Q2 control (negative control): prove that WITHOUT the hook, an imported
// module whose function has a real game loop would block. We exec a normal
// (untransformed) import of a module with a bounded busy loop and time the main
// thread. We bound it (range, not while True) so the spike itself can't hang.
const q2control = await page.evaluate(async () => {
  // Write a module with a sync function that "spins" (bounded) like a frozen loop.
  const probe = String.raw`
import sys, time as _t
with open('blockmod.py', 'w') as f:
    f.write('def spin():\n'
            '    t = 0\n'
            '    for _ in range(40_000_000):\n'   # a few hundred ms of pure CPU
            '        t += 1\n'
            '    return t\n')
sys.modules.pop('blockmod', None)
import blockmod
# NOTE: use a private local name, NOT '_start'. This probe runs at pyodide global
# scope, so binding '_start' here would CLOBBER index.html's _start() function in
# pyodide.globals and break the page's Run button. (The real run-model must
# likewise never eval into the BOOT_PY global namespace — see findings.)
_t0 = _t.time()
blockmod.spin()             # runs synchronously on the main thread, no yields
(_t.time() - _t0) * 1000.0
`;
  const t0 = performance.now();
  await pyodide.runPythonAsync(probe);
  return performance.now() - t0;
});
info(`Q2 negative control: a sync imported busy-loop blocked the thread for ${q2control.toFixed(0)}ms (this is the freeze the hook must prevent)`);

// ---- Q2 main proof: entry main.py imports game.py with a REAL pygame loop ----
const ENTRY = [
  'import pygame',
  'import gamemod',
  'pygame.init()',
  'screen = pygame.display.set_mode((320, 240))',
  'gamemod.run(screen)',          // call into the imported module's game loop
].join('\n');

// gamemod.run contains a real, infinite pygame game loop. Under the hook it is
// converted to async def, a yield is injected into its while body, and the
// entry's call is wrapped as await __maybe_await__(gamemod.run(screen)).
const GAMEMOD_V1 = [
  'import pygame',
  '',
  'def run(screen):',
  '    clock = pygame.time.Clock()',
  '    t = 0',
  '    while True:',
  '        for e in pygame.event.get():',
  '            if e.type == pygame.QUIT:',
  '                raise SystemExit',
  '        t = (t + 3) % 256',
  '        screen.fill((t, 40, 120))',          // animates frame-to-frame
  '        pygame.display.flip()',
  '        clock.tick(60)',
].join('\n');

clearConsole();
await page.evaluate(({ entry, game }) => window.__startProject(entry, { gamemod: game }),
  { entry: ENTRY, game: GAMEMOD_V1 });

// Give it a moment to start animating.
await page.waitForTimeout(600);

// Assertion 1: canvas animates (two frames differ).
const a1 = await frame();
await page.waitForTimeout(500);
const a2 = await frame();
if (a1 !== a2) ok('A1: canvas ANIMATES — imported-module game loop drives the canvas (two frames differ)');
else fail('A1: canvas frames identical — imported game loop not animating');

// Assertion 2: main thread responsive during the imported loop.
const tResp0 = Date.now();
await page.evaluate(() => 1 + 1);
const respDt = Date.now() - tResp0;
if (respDt < 500) ok(`A2: main thread RESPONSIVE during imported loop — round-trip ${respDt}ms (<500ms, did NOT freeze)`);
else fail(`A2: main thread blocked — round-trip ${respDt}ms`);

// Status should still be running (loop is infinite + cooperative).
const runningStatus = await page.evaluate(() => pyodide.runPython(
  "'running' if (_state['task'] and not _state['task'].done()) else 'done'"));
if (runningStatus === 'running') ok('A2b: cooperative task still running (infinite imported loop did not exit/crash)');
else fail('A2b: task ended unexpectedly: ' + runningStatus);

// Stop the infinite loop before the next test.
await page.evaluate(() => pyodide.runPython('_stop()'));
await page.waitForTimeout(100);

// ---- Assertion 3: time.sleep / pygame.time.wait inside an IMPORTED function
// is honored as a real pause WITHOUT freezing (mirror verify.mjs steps 9/10). --
console.log('\n--- A3: sleep/wait inside an imported module function ---');

const ENTRY_SLEEP = [
  'import pygame',
  'import sleepmod',
  'pygame.init()',
  'screen = pygame.display.set_mode((200, 150))',
  'sleepmod.sequence(screen)',
].join('\n');

// sleepmod.sequence: draw red, wait via BOTH pygame.time.wait and time.sleep
// inside this imported (non-entry) function, then draw green and finish. No
// while loop -> the only way these pauses are honored cooperatively is the
// _Awaiter rewrite running on the MODULE source via the import hook.
const SLEEPMOD = [
  'import pygame, time',
  '',
  'def sequence(screen):',
  '    screen.fill((200, 60, 60))',
  '    pygame.display.flip()',
  '    pygame.time.wait(800)',        // -> await __sleep__(800/1000) via module transform
  '    time.sleep(0.8)',              // -> await __sleep__(0.8) via module transform
  '    screen.fill((60, 200, 60))',
  '    pygame.display.flip()',
  '    print("SLEEPMOD_DONE")',
].join('\n');

clearConsole();
const tStart = Date.now();
await page.evaluate(({ entry, mod }) => window.__startProject(entry, { sleepmod: mod }),
  { entry: ENTRY_SLEEP, mod: SLEEPMOD });

// We should be inside the ~1.6s of pauses now.
await page.waitForTimeout(500);
const redFrame = await frame();
const tSleep0 = Date.now();
await page.evaluate(() => 1 + 1);
const sleepResp = Date.now() - tSleep0;
if (sleepResp < 500) ok(`A3a: RESPONSIVE during imported sleep/wait — round-trip ${sleepResp}ms (no busy-wait freeze)`);
else fail(`A3a: tab frozen during imported sleep/wait — ${sleepResp}ms`);

// Wait for completion (DONE printed) and assert the pauses were real (~1.6s).
await page.waitForFunction(() =>
  document.getElementById('console').textContent.includes('SLEEPMOD_DONE'),
  null, { timeout: 10_000 }).catch(() => fail('A3: sleepmod never finished (sleep not honored / froze?)'));
const elapsed = Date.now() - tStart;
const greenFrame = await frame();
if (redFrame !== greenFrame) ok('A3b: second draw after the imported pauses is visible (frame changed)');
else fail('A3b: post-pause draw not visible');
if (elapsed >= 1400) ok(`A3c: imported pauses HONORED as real time — total ${elapsed}ms (expected ~1600ms, not instant)`);
else fail(`A3c: finished too fast (${elapsed}ms) — pauses were skipped, not honored`);
const sleepConsole = await readConsole();
info('sleepmod console: ' + sleepConsole.replace(/\n/g, ' | ').slice(0, 120));

// ---- Assertion 4: editing a project module and re-running picks up new code. --
console.log('\n--- A4: edit a project module and re-run (cache clear) ---');

// V2 of gamemod fills with a clearly different base color AND prints a version
// marker we can detect. Re-run with edited source; the marker must update.
const GAMEMOD_V2 = GAMEMOD_V1
  .replace("screen.fill((t, 40, 120))", "screen.fill((40, t, 200))")
  .replace("def run(screen):", "def run(screen):\n    print('GAMEMOD_V2_RUNNING')");
const GAMEMOD_V1_MARKED = GAMEMOD_V1
  .replace("def run(screen):", "def run(screen):\n    print('GAMEMOD_V1_RUNNING')");

// First run with V1-marked.
clearConsole();
await page.evaluate(({ entry, game }) => window.__startProject(entry, { gamemod: game }),
  { entry: ENTRY, game: GAMEMOD_V1_MARKED });
await page.waitForFunction(() =>
  document.getElementById('console').textContent.includes('GAMEMOD_V1_RUNNING'),
  null, { timeout: 8_000 }).catch(() => fail('A4: V1 marker never printed'));
await page.evaluate(() => pyodide.runPython('_stop()'));
await page.waitForTimeout(100);

// Now re-run with EDITED (V2) source for the same module name.
clearConsole();
await page.evaluate(({ entry, game }) => window.__startProject(entry, { gamemod: game }),
  { entry: ENTRY, game: GAMEMOD_V2 });
const sawV2 = await page.waitForFunction(() =>
  document.getElementById('console').textContent.includes('GAMEMOD_V2_RUNNING'),
  null, { timeout: 8_000 }).then(() => true).catch(() => false);
const consoleNow = await readConsole();
const sawV1Again = consoleNow.includes('GAMEMOD_V1_RUNNING');
if (sawV2 && !sawV1Again) ok('A4: edited project module re-run picked up V2 (cache clear works; no stale V1)');
else fail(`A4: edit not picked up (sawV2=${sawV2}, staleV1=${sawV1Again})`);
await page.evaluate(() => pyodide.runPython('_stop()'));

// ---- Known-unsupported edge: module-level game loop in a non-entry file. -----
console.log('\n--- Edge: module-level (top-level) loop in a NON-entry file ---');

// A project module with a game loop at MODULE TOP LEVEL (not inside a function).
// Importing executes the module body synchronously; top-level await is illegal
// in an imported module, so the injected yields can't be awaited -> this is the
// known gap. We confirm the transform compiles the module but the top-level
// loop cannot run cooperatively (it would block). We test it bounded so we
// don't hang: a top-level FOR loop with a flip, imported, and we just confirm
// the framework's expected behavior (it runs synchronously / blocks).
const edge = await page.evaluate(async () => {
  const probe = String.raw`
import sys, ast, json
# Module with a TOP-LEVEL game loop + flip (the unsupported shape).
src = ('import pygame\n'
       'pygame.init()\n'
       'screen = pygame.display.set_mode((80,80))\n'
       'n = 0\n'
       'while n < 3:\n'                       # top-level loop in a module
       '    screen.fill((n*40, 0, 0))\n'
       '    pygame.display.flip()\n'
       '    n += 1\n')
res = {}
try:
    # Build the transformed tree (same pipeline _transform_module uses).
    tree = ast.parse(src)
    asyncify = _Asyncify()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _AwaitCalls().visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    res['has_await_at_toplevel'] = any(
        isinstance(n, ast.Await) for stmt in tree.body for n in ast.walk(stmt))
    # Try to compile WITHOUT the top-level-await flag (exactly as exec_module does).
    try:
        compile(tree, 'edgemod.py', 'exec')
        res['sync_compile_ok'] = True
    except SyntaxError as e:
        res['sync_compile_ok'] = False
        res['sync_compile_err'] = str(e)
except Exception as e:
    res['err'] = repr(e)
json.dumps(res)
`;
  return JSON.parse(await pyodide.runPythonAsync(probe));
}).catch(e => ({ error: String(e) }));
info('Edge (module-level loop) probe: ' + JSON.stringify(edge));
if (edge.has_await_at_toplevel && edge.sync_compile_ok === false) {
  ok('EDGE CONFIRMED: a module-level loop forces an await at module top level, which a synchronous import cannot compile (SyntaxError) — this is the known-unsupported gap. Loops inside functions are fine.');
} else if (!edge.has_await_at_toplevel) {
  info('Edge: this module-level loop did not require a top-level await (no game-loop markers at top level), so it imports fine but runs synchronously/blocking — still the documented limitation.');
} else {
  info('Edge result: ' + JSON.stringify(edge));
}

// ---------------------------------------------------------------------------
// Non-regression sanity: the SOLO single-file path (_start) still works after
// our injection — we touched only NEW names, never _start/_run/_transform.
// ---------------------------------------------------------------------------
console.log('\n--- Non-regression: solo single-file path still animates ---');
clearConsole();
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue([
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((200, 150))',
    'clock = pygame.time.Clock()',
    'n = 0',
    'while True:',
    '    n = (n + 5) % 255',
    '    screen.fill((n, 60, 90))',
    '    pygame.display.flip()',
    '    clock.tick(60)',
  ].join('\n'));
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 10_000 }).catch(() => fail('solo path did not start'));
const solo1 = await frame();
await page.waitForTimeout(400);
const solo2 = await frame();
if (solo1 !== solo2) ok('NON-REG: solo single-file path still animates (existing _start untouched)');
else fail('NON-REG: solo path not animating');
await page.evaluate(() => pyodide.runPython('_stop()'));

// ---------------------------------------------------------------------------
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors throughout');

await browser.close();
console.log('\n' + (failures ? `SPIKE FAILED (${failures} failures)` : 'SPIKE OK — multi-file cooperative run PROVEN'));
process.exitCode = failures ? 1 : 0;
