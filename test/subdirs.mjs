// S2a ENGINE battery (TDD RED) — true subdirectories + full Python packages.
//
// This is the ENGINE half of slice S2 (design: docs/specs/2026-06-23-subdirs-packages-design.md,
// §0.1 execution split). It drives the REAL app engine PROGRAMMATICALLY via window.project
// (add/load/move/serialize) + run() (#runBtn) + reading #status / #console / #canvas. It has
// NO dependency on the nested-tree DOM (that is S2b / test/explorer-tree.mjs).
//
// Today (pre-S2) MANY of these MUST FAIL, for the RIGHT reasons:
//   - isModuleName (index.html:1321) forbids '/', so project.add('sprites/enemy.py') is rejected,
//     so a nested project can't even be installed → package imports can't run.
//   - _run_project (index.html:1188) writes flat (os.path.join(cwd, bare-fname)) and the
//     _ProjectFinder (1168) matches BARE stems only → dotted/from-package imports never resolve.
//   - project.move does not exist; emptyDirs serialize/load does not exist; assetFS writes flat.
// A different subagent implements the engine to make this battery GREEN. THESE TESTS ARE THE
// CONTRACT (design §7.1, the S2a subset).
//
// Run:
//   python3 -m http.server 8923            # repo root, another terminal
//   node test/subdirs.mjs http://localhost:8923/
//
// Style mirrors multifile.mjs / spike-viewer.mjs: ok()/fail() + process.exitCode. Assertions use
// SHORT timeouts so a still-missing capability fails its OWN assertion fast instead of hanging the
// whole battery.

import { launch } from './_harness.mjs';
import { PNG_B64, buf } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const info = (m) => console.log('info -', m);

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

const status = () => page.evaluate(() => document.getElementById('status').textContent);
const consoleText = () => page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
const frame = () => page.evaluate(() => document.getElementById('canvas').toDataURL());

// Install a nested project of {path: src}, set entry/active, and Run via the real button.
// Mirrors multifile.mjs runProject but path-keyed. If project.load can't accept path keys yet
// (today), the install itself will leave the project wrong → the dependent assertion fails RED.
async function runProject(files, entry, activeName) {
  await page.evaluate(({ files, entry, activeName }) => {
    const order = Object.keys(files);
    window.project.load({ files, order, entry, active: activeName || entry });
  }, { files, entry, activeName });
  await page.click('#runBtn');
}
// Wait until #console contains a sentinel (used after a run); short timeout → fast RED.
const waitConsole = (re, ms = 15_000) => page.waitForFunction((src) => {
  const txt = Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n');
  return new RegExp(src).test(txt);
}, re.source, { timeout: ms });
const stop = () => page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));

// A real Python package shared by several assertions. Mirrors test/spike-packages.mjs PROJECT,
// but installed through the REAL window.project + run() rather than the spike harness.
//   sprites/__init__.py  — package marker + re-export (so `import sprites; sprites.Enemy()` works)
//   sprites/util.py      — sibling, imported by enemy via relative AND absolute import
//   sprites/enemy.py     — class Enemy, uses both `from . import util` and `from sprites.util import hp_for`
const PKG = {
  'sprites/__init__.py': '# package marker\nPKG = "sprites"\nfrom .enemy import Enemy\n',
  'sprites/util.py': 'def hp_for(level):\n    return 10 * level\n',
  'sprites/enemy.py': [
    'from . import util',
    'from sprites.util import hp_for',
    'class Enemy:',
    '    def __init__(self, level=3):',
    '        self.level = level',
    '        self.hp = hp_for(level)',
    '    def label(self):',
    '        return f"Enemy(lvl={self.level}, hp={self.hp})"',
  ].join('\n') + '\n',
};

// =====================================================================================
// 1. `from sprites import enemy` RUNS in the real engine (design §7.1 #2).
//    Driven: project.load the nested PKG + a main.py that prints a sentinel, click #runBtn,
//    wait for the sentinel in #console. Negative-control: assert no Traceback/error status.
// =====================================================================================
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  ...PKG,
  'main.py': 'from sprites import enemy\ne = enemy.Enemy(5)\nprint("FROMPKG", e.label())\n',
}, 'main.py');
await waitConsole(/FROMPKG Enemy\(lvl=5, hp=50\)/)
  .then(() => ok('`from sprites import enemy` runs in the real engine (sentinel reached #console)'))
  .catch(async () => fail('from-package import did not run: ' + (await consoleText()).slice(0, 300)));
{
  const c = await consoleText();
  if (!/Traceback|Error|No module named/.test(c)) ok('  ...from-package run is clean (no traceback)');
  else fail('from-package run errored: ' + c.slice(0, 300));
}
await stop();

// =====================================================================================
// 2. Dotted `import sprites.enemy` RUNS + the __init__ re-export path
//    (`import sprites; sprites.Enemy(...)`) (design §7.1 #3; spike claim 1c).
// =====================================================================================
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  ...PKG,
  'main.py': [
    'import sprites.enemy as alias',     // dotted import package.module
    'import sprites',                     // package object
    'a = alias.Enemy(4)',
    'b = sprites.Enemy(1)',              // __init__ re-export
    'print("DOTTED", a.label(), "/", b.label(), "/", sprites.PKG)',
  ].join('\n') + '\n',
}, 'main.py');
await waitConsole(/DOTTED Enemy\(lvl=4, hp=40\) \/ Enemy\(lvl=1, hp=10\) \/ sprites/)
  .then(() => ok('dotted `import sprites.enemy` + `import sprites; sprites.Enemy()` re-export run'))
  .catch(async () => fail('dotted import / re-export did not run: ' + (await consoleText()).slice(0, 300)));
await stop();

// =====================================================================================
// 3. Relative + absolute intra-package imports resolve THROUGH the entry (design §7.1 #4).
//    enemy.py uses BOTH `from . import util` (relative) AND `from sprites.util import hp_for`
//    (absolute). If either failed to resolve, Enemy(...).hp would be wrong / import would raise.
//    We exercise both by constructing an Enemy and asserting hp (proves hp_for resolved both ways).
// =====================================================================================
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  ...PKG,
  'main.py': [
    'from sprites.enemy import Enemy',
    'from sprites import util',                 // absolute import of the sibling at the entry
    'e = Enemy(7)',
    'print("INTRA", e.hp, util.hp_for(2))',     // 70 (via enemy.py imports) + 20 (direct)
  ].join('\n') + '\n',
}, 'main.py');
await waitConsole(/INTRA 70 20/)
  .then(() => ok('relative (from . import util) + absolute (from sprites.util import hp_for) imports resolve'))
  .catch(async () => fail('intra-package relative/absolute imports failed: ' + (await consoleText()).slice(0, 300)));
await stop();

// =====================================================================================
// 4. Imported cooperative loop does NOT freeze — the MetaPathFinder wrapper proof
//    (design §2.2 / §7.1 #5). A NESTED imported module runs a `while True:` game loop called
//    from the entry; the main thread must stay responsive (a 1+1 round-trip < 500ms while
//    status is 'running'). Mirrors multifile.mjs check 2 but with a NESTED module.
// =====================================================================================
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  'engine/__init__.py': '',
  'engine/loop.py': [
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
  ].join('\n') + '\n',
  'main.py': [
    'import pygame',
    'from engine import loop',          // imported NESTED module with a cooperative while-True
    'pygame.init()',
    'screen = pygame.display.set_mode((320, 240))',
    'loop.run(screen)',
  ].join('\n') + '\n',
}, 'main.py');
const coopStarted = await page.waitForFunction(
  () => document.getElementById('status').textContent === 'running',
  null, { timeout: 15_000 }).then(() => true).catch(() => false);
if (coopStarted) {
  const f1 = await frame(); await page.waitForTimeout(500); const f2 = await frame();
  const t0 = Date.now(); await page.evaluate(() => 1 + 1); const dt = Date.now() - t0;
  const st = await status();
  if (f1 !== f2 && dt < 500 && st === 'running')
    ok(`imported NESTED cooperative loop animates without freezing (resp ${dt}ms) — MetaPathFinder wrapper holds`);
  else fail(`nested coop loop not healthy — animating=${f1 !== f2} resp=${dt}ms status=${st}`);
} else {
  fail('nested imported cooperative loop did not start (status never running): ' + (await consoleText()).slice(0, 300));
}
await stop();

// =====================================================================================
// 5. Stdlib import inside a NESTED project module still works (design §7.1 #6) — proves the
//    engine's project-origin gate (_is_project_origin) does NOT over-claim stdlib modules.
//    A nested module does `import json` + `import math` and uses them.
// =====================================================================================
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  'lib/__init__.py': '',
  'lib/calc.py': [
    'import json, math',
    'def encode(d):',
    '    return json.dumps(d, sort_keys=True)',
    'def area(r):',
    '    return round(math.pi * r * r, 2)',
  ].join('\n') + '\n',
  'main.py': [
    'from lib import calc',
    'print("STDLIB", calc.encode({"b": 2, "a": 1}), calc.area(2))',
  ].join('\n') + '\n',
}, 'main.py');
await waitConsole(/STDLIB \{"a": 1, "b": 2\} 12\.57/)
  .then(() => ok('stdlib import (json/math) inside a nested module works — project-origin gate is narrow'))
  .catch(async () => fail('stdlib import inside nested module failed: ' + (await consoleText()).slice(0, 300)));
await stop();

// =====================================================================================
// 6. Nested asset load by path (design §7.1 #7). Seed a PNG at a NESTED path (sounds/sprite.png)
//    and run code that pygame.image.load("sounds/sprite.png") + blits; assert a #canvas pixel
//    (mirrors assets.mjs check 1, nested). Today there is NO public API to write an asset at a
//    nested path (assetFS writes flat → the file lands at "sprite.png", not "sounds/sprite.png"),
//    so this MUST fail RED until the engine supports nested asset writes. We assert the END STATE
//    (the nested path exists in MEMFS AND the blit pixel is magenta) so it fails its own assertion.
// =====================================================================================
{
  // Try the public asset path with a nested name (the S2 mechanism: assetFS.add a File whose
  // name carries a folder). If the engine doesn't honor nested asset paths yet, the file won't
  // exist at the nested MEMFS path and the assertion fails RED.
  await page.evaluate((b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'sounds/sprite.png', { type: 'image/png' });
    // window.assetFS is not a documented seam; use the input/add path if exposed, else best-effort.
    if (window.assetFS && typeof window.assetFS.add === 'function') return window.assetFS.add(file);
  }, PNG_B64).catch(() => {});
  await page.waitForTimeout(250);
  const nestedSeeded = await page.evaluate(() => {
    try { return pyodide.FS.analyzePath('sounds/sprite.png').exists; } catch { return false; }
  });
  if (nestedSeeded) ok('nested asset seeded at sounds/sprite.png (nested write mechanism exists)');
  else fail('nested asset NOT written at sounds/sprite.png (no nested asset-write mechanism yet)');

  await page.evaluate(() => { document.getElementById('console').textContent = ''; });
  await page.evaluate(() => {
    window.project.load({ files: {
      'main.py': [
        'import pygame',
        'pygame.init()',
        'screen = pygame.display.set_mode((200, 150))',
        'screen.fill((0, 0, 0))',
        'sprite = pygame.image.load("sounds/sprite.png").convert_alpha()',
        'screen.blit(sprite, (50, 50))',
        'pygame.display.flip()',
        // #15: the host blanks the canvas when a program ENDS — hold the frame and sample while
        // it is still running (we stop() right after).
        'clock = pygame.time.Clock()',
        'while True:',
        '    clock.tick(30)',
      ].join('\n') + '\n',
    } });
  });
  await page.click('#runBtn');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
    null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(150);   // let the first frame paint
  const px = await page.evaluate(() => {
    const g = document.getElementById('canvas').getContext('2d');
    return Array.from(g.getImageData(58, 58, 1, 1).data);  // inside the blit; fixture is magenta
  });
  if (px[0] > 150 && px[1] < 100 && px[2] > 150)
    ok('nested asset loads by path: pygame.image.load("sounds/sprite.png") blits to canvas: ' + px);
  else fail('nested asset blit pixel wrong (load-by-nested-path not working): ' + px);
  await stop();
}

// =====================================================================================
// 7. Path round-trip: save → reload → import still works (design §7.1 #8; spike claim 4).
//    Build a nested project, __flushSave(), page.reload(), wait for boot; assert the project
//    restored (path keys present) AND a run() of the package import still works.
// =====================================================================================
await page.evaluate(({ pkg }) => {
  window.project.load({
    files: { ...pkg, 'main.py': 'from sprites import enemy\nprint("RELOADED", enemy.Enemy(3).label())\n' },
    order: [...Object.keys(pkg), 'main.py'], entry: 'main.py', active: 'main.py',
  });
  window.__flushSave();
}, { pkg: PKG });
await page.reload({ waitUntil: 'load' });
await booted().catch(() => fail('did not reboot (path round-trip)'));
{
  const restored = await page.evaluate(() => ({
    hasEnemy: !!(window.project.files && window.project.files['sprites/enemy.py']),
    order: window.project.order,
  }));
  if (restored.hasEnemy && Array.isArray(restored.order) && restored.order.includes('sprites/enemy.py'))
    ok('save→reload restored the nested project (path keys present)');
  else fail('save→reload did not restore nested paths: ' + JSON.stringify(restored));
}
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await page.click('#runBtn');
await waitConsole(/RELOADED Enemy\(lvl=3, hp=30\)/)
  .then(() => ok('package import still runs after save→reload (engine recreates dirs from {path:text})'))
  .catch(async () => fail('package import broke after reload: ' + (await consoleText()).slice(0, 300)));
await stop();

// =====================================================================================
// 8. (S7) REMOVED — the `#project=`-with-paths round-trip (the share button PRODUCER +
//    the legacy #project= LOAD reader) was deleted (open-decisions #2, verdict B).
//    Path persistence still rides save→reload + zip, which §7.1 #11 already covers above
//    (the package import that survives save→reload). The button/loader contract now lives
//    in test/share-removed.mjs. The path-shaped deserialize tolerance stays exercised via
//    savedProject() (localStorage), unaffected by the share-reader removal.
// =====================================================================================

// =====================================================================================
// 9. isModuleName path validation (design §7.1 #13). project.add ACCEPTS a/b/c.py and REJECTS
//    (false/no-op) ../x.py, /abs.py, a//b.py, a/.py, a/1bad.py (leading digit), noext.
//    Driven model-level: project.add returns truthy iff the file was added.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
{
  const v = await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' } });   // clean slate
    const tryAdd = (name) => {
      const before = window.project.order.length;
      const ret = window.project.add(name, '# x\n');
      const added = window.project.order.length > before && !!window.project.files[name];
      // accepted iff truthy return AND it actually landed; rejected iff falsy AND no-op
      return { name, ret: !!ret, added };
    };
    return {
      accept: tryAdd('a/b/c.py'),
      reject: ['../x.py', '/abs.py', 'a//b.py', 'a/.py', 'a/1bad.py', 'noext'].map(tryAdd),
    };
  });
  if (v.accept.ret && v.accept.added) ok('isModuleName ACCEPTS a/b/c.py (path-shaped name)');
  else fail('isModuleName rejected a valid nested path a/b/c.py: ' + JSON.stringify(v.accept));
  const badRejected = v.reject.filter(r => !r.ret && !r.added).map(r => r.name);
  const badLeaked = v.reject.filter(r => r.ret || r.added).map(r => r.name);
  if (badLeaked.length === 0) ok('isModuleName REJECTS all bad paths (no-op): ' + badRejected.join(', '));
  else fail('isModuleName admitted invalid path(s): ' + badLeaked.join(', '));
}

// =====================================================================================
// 10. Coexistence: a flat single .py still runs via the BOOT_PY single-file path (!isMulti()) —
//     animates as today AND _start (not _start_project) was used (design §7.1 #14;
//     mirrors multifile.mjs check 11).
// =====================================================================================
await page.evaluate(() => {
  window.project.load({ files: {
    'main.py': 'import pygame\npygame.init()\ns=pygame.display.set_mode((120,90))\nn=0\nwhile True:\n    s.fill((n%255,60,90)); pygame.display.flip(); n+=5\n',
  } });
});
await page.click('#runBtn');
const soloStarted = await page.waitForFunction(
  () => document.getElementById('status').textContent === 'running',
  null, { timeout: 10_000 }).then(() => true).catch(() => false);
if (soloStarted) {
  const c1 = await frame(); await page.waitForTimeout(400); const c2 = await frame();
  const viaProject = await page.evaluate(() => {
    try { return pyodide.runPython("1 if _state.get('via_project') else 0"); } catch { return -1; }
  });
  if (c1 !== c2 && viaProject === 0)
    ok('flat single .py runs via _start (not _start_project) and animates — coexistence intact');
  else fail(`flat coexistence wrong — animating=${c1 !== c2} via_project=${viaProject}`);
} else {
  fail('flat single-file run did not start');
}
await stop();

// =====================================================================================
// 11. emptyDirs serialize/load round-trip (model-level) (design §4.3 / §7.1 #15). Create state
//     with an empty folder (however the model expresses it — the design uses an `emptyDirs`
//     set in serialize/load), serialize, reload, assert it round-trips. The API for empty
//     folders does not exist yet → assert the END STATE so it fails RED now and passes once
//     the engine carries emptyDirs through serialize/load.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
{
  const r = await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' } });
    // The design (§4.3/§5.4) introduces an explicit empty-folder set surfaced via serialize's
    // `emptyDirs`. We probe the contract: if project exposes a way to register an empty folder,
    // it should appear in serialize().emptyDirs and survive load(). We try a couple of plausible
    // surfaces; whichever the engine implements must round-trip.
    let registered = false;
    try {
      if (typeof window.project.addFolder === 'function') { window.project.addFolder('emptyfolder'); registered = true; }
      else if (Array.isArray(window.project.emptyDirs)) { window.project.emptyDirs.push('emptyfolder'); registered = true; }
    } catch {}
    const ser = window.project.serialize();
    return { registered, emptyDirsInSerialize: ser.emptyDirs };
  });
  if (r.registered && Array.isArray(r.emptyDirsInSerialize) && r.emptyDirsInSerialize.includes('emptyfolder')) {
    // Round-trip through load and assert it survives.
    const survived = await page.evaluate(() => {
      const rec = window.project.serialize();
      window.project.load(rec);
      const ser2 = window.project.serialize();
      return Array.isArray(ser2.emptyDirs) && ser2.emptyDirs.includes('emptyfolder');
    });
    if (survived) ok('emptyDirs serialize/load round-trips an empty folder');
    else fail('emptyDirs not preserved through load()');
  } else {
    fail('empty-folder model (emptyDirs in serialize) does not exist yet: ' + JSON.stringify(r));
  }
}

// =====================================================================================
// 12. move re-keys (model-level) (design §4.2 / §7.1 #10 engine side). project.move('enemy.py',
//     'sprites') → project.files['sprites/enemy.py'] exists, old key gone; a folder-prefix move
//     re-keys ALL descendants; a descendant-into-self move is BLOCKED.
//     project.move does not exist yet → RED.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
{
  const hasMove = await page.evaluate(() => typeof window.project.move === 'function');
  if (!hasMove) {
    fail('project.move does not exist yet (model-level move re-key contract unmet)');
  } else {
    // 12a. file move re-keys
    const fileMove = await page.evaluate(() => {
      window.project.load({ files: { 'main.py': 'import enemy\n', 'enemy.py': 'X = 1\n' },
        order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
      const ret = window.project.move('enemy.py', 'sprites');
      return { ret: !!ret, has: !!window.project.files['sprites/enemy.py'],
        oldGone: !window.project.files['enemy.py'], order: window.project.order };
    });
    if (fileMove.has && fileMove.oldGone && fileMove.order.includes('sprites/enemy.py'))
      ok('move re-keys a file: enemy.py → sprites/enemy.py (old key gone)');
    else fail('move did not re-key a file: ' + JSON.stringify(fileMove));

    // 12b. folder-prefix move re-keys all descendants
    const folderMove = await page.evaluate(() => {
      window.project.load({ files: {
        'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/util.py': 'U=1\n' },
        order: ['main.py', 'sprites/enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py' });
      const ret = window.project.move('sprites', 'actors');   // move the folder
      return { ret: !!ret,
        enemy: !!window.project.files['actors/sprites/enemy.py'] || !!window.project.files['actors/enemy.py'],
        util: !!window.project.files['actors/sprites/util.py'] || !!window.project.files['actors/util.py'],
        oldGone: !window.project.files['sprites/enemy.py'] && !window.project.files['sprites/util.py'],
        keys: Object.keys(window.project.files) };
    });
    if (folderMove.enemy && folderMove.util && folderMove.oldGone)
      ok('folder-prefix move re-keys ALL descendants under the new prefix');
    else fail('folder move did not re-key descendants: ' + JSON.stringify(folderMove.keys));

    // 12c. descendant-into-self move is blocked
    const selfMove = await page.evaluate(() => {
      window.project.load({ files: {
        'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/sub/x.py': 'X=1\n' },
        order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py' });
      const ret = window.project.move('sprites', 'sprites/sub');   // into its own descendant → blocked
      return { ret, stillThere: !!window.project.files['sprites/enemy.py'] && !!window.project.files['sprites/sub/x.py'] };
    });
    if (!selfMove.ret && selfMove.stillThere)
      ok('descendant-into-self folder move is blocked (paths unchanged)');
    else fail('descendant-into-self move was not blocked: ' + JSON.stringify(selfMove));
  }
}

// =====================================================================================
// 12d. INCREMENTAL RECONCILE: a DROPPED path is forgotten by sys.modules (cross-run
//      contamination, design §2.6). Run flat main.py+helper.py (so sys.modules['helper']
//      is cached), move helper.py into pkg/ (re-keying it to pkg/helper.py), point the
//      entry at the OLD top-level name `import helper`, and re-run. The stale top-level
//      `helper` must be GONE: its file was unlinked AND its dotted name popped, so
//      `import helper` raises ModuleNotFoundError. Pre-fix _run_project only pops dotted
//      names for the CURRENT files (never for _PROJECT_PATHS - new_paths), so the cached
//      `helper` lingers and the import wrongly succeeds → RED.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  'main.py': 'import helper\nprint("FLAT-A", helper.value())\n',
  'helper.py': 'def value():\n    return 41\n',
}, 'main.py');
await waitConsole(/FLAT-A 41/)
  .then(() => ok('  (setup) flat helper.py imports + runs (sys.modules[\'helper\'] now cached)'))
  .catch(async () => fail('setup run for dropped-path test failed: ' + (await consoleText()).slice(0, 300)));
await stop();
// Move helper.py into pkg/ (re-keys to pkg/helper.py), then aim the entry at the OLD name.
const movedHelper = await page.evaluate(() => {
  const ret = window.project.move('helper.py', 'pkg');
  window.project.files['main.py'].setValue('import helper\nprint("STALE-HELPER-IMPORTED")\n');
  return { ret: !!ret, hasNew: !!window.project.files['pkg/helper.py'],
    oldGone: !window.project.files['helper.py'] };
});
if (!(movedHelper.ret && movedHelper.hasNew && movedHelper.oldGone))
  fail('move(helper.py, pkg) did not re-key as expected: ' + JSON.stringify(movedHelper));
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await page.click('#runBtn');
await page.waitForFunction(() => /finished|error|ready|stopped/.test(document.getElementById('status').textContent),
  null, { timeout: 15_000 }).catch(() => {});
{
  const c = await consoleText();
  const stillImported = /STALE-HELPER-IMPORTED/.test(c);
  const moduleGone = /No module named|ModuleNotFoundError|Traceback/.test(c);
  if (!stillImported && moduleGone)
    ok('dropped path is forgotten: after move, `import helper` (old top-level name) raises ModuleNotFoundError');
  else fail('STALE sys.modules for DROPPED path: `import helper` still resolved after move: ' + c.slice(0, 300));
}
await stop();

// =====================================================================================
// 12e. INCREMENTAL RECONCILE: an emptied package directory becomes UN-importable
//      (orphaned auto-__init__.py is dropped, design §2.6). Run main.py + sprites/enemy.py
//      (auto-creates sprites/__init__.py), then move sprites/enemy.py OUT to root, point the
//      entry at `import sprites`, and re-run. The now-empty sprites/ package must be GONE:
//      its auto-__init__.py is no longer wanted (the dir holds no .py this run), so it is
//      unlinked and the dir prunes → `import sprites` raises ModuleNotFoundError. Pre-fix
//      _run_project unconditionally re-adds EVERY still-existing auto-init, so the emptied
//      package + its __init__.py linger and `import sprites` wrongly succeeds → RED.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await runProject({
  'main.py': 'from sprites import enemy\nprint("PKG-A", enemy.tag())\n',
  'sprites/enemy.py': 'def tag():\n    return "E"\n',
}, 'main.py');
await waitConsole(/PKG-A E/)
  .then(() => ok('  (setup) sprites/enemy.py imports + runs (auto sprites/__init__.py created)'))
  .catch(async () => fail('setup run for emptied-package test failed: ' + (await consoleText()).slice(0, 300)));
await stop();
// Move enemy.py OUT of sprites/ to root, then aim the entry at the now-empty package.
const movedEnemy = await page.evaluate(() => {
  const ret = window.project.move('sprites/enemy.py', '');
  window.project.files['main.py'].setValue('import sprites\nprint("STALE-PKG-IMPORTED", sprites)\n');
  return { ret: !!ret, hasRoot: !!window.project.files['enemy.py'],
    oldGone: !window.project.files['sprites/enemy.py'] };
});
if (!(movedEnemy.ret && movedEnemy.hasRoot && movedEnemy.oldGone))
  fail('move(sprites/enemy.py, "") did not re-key as expected: ' + JSON.stringify(movedEnemy));
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await page.click('#runBtn');
await page.waitForFunction(() => /finished|error|ready|stopped/.test(document.getElementById('status').textContent),
  null, { timeout: 15_000 }).catch(() => {});
{
  const c = await consoleText();
  const stillImported = /STALE-PKG-IMPORTED/.test(c);
  const pkgGone = /No module named|ModuleNotFoundError|Traceback/.test(c);
  if (!stillImported && pkgGone)
    ok('emptied package is gone: after moving its only .py out, `import sprites` raises ModuleNotFoundError');
  else fail('ORPHANED auto-__init__.py lingered: `import sprites` still resolved after emptying it: ' + c.slice(0, 300));
}
await stop();

// =====================================================================================
// 13. First-paint laziness regression (additive) (design §7.1 #16). After boot (no run),
//     window.JSZip === undefined, window.__amLoaded falsy, CM getOption('lint') falsy.
//     This is GREEN today and must STAY green — proves nothing in S2 eagerly loads a lazy
//     library or arms lint at first paint.
// =====================================================================================
await page.goto(URL, { waitUntil: 'load' }); await booted();
{
  const lazy = await page.evaluate(() => ({
    jszip: typeof window.JSZip,
    amLoaded: !!window.__amLoaded,
    lint: !!document.querySelector('.CodeMirror')?.CodeMirror?.getOption('lint'),
  }));
  if (lazy.jszip === 'undefined' && !lazy.amLoaded && !lazy.lint)
    ok('first-paint laziness intact: JSZip undefined, __amLoaded falsy, CM lint off');
  else fail('first-paint laziness regressed: ' + JSON.stringify(lazy));
}

// =====================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) info('JS console errors observed (informational during RED): ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'SUBDIRS ENGINE BATTERY FAILED (expected RED pre-S2a)' : 'SUBDIRS ENGINE BATTERY OK');
