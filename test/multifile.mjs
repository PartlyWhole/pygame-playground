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
// Harden (I1): a C2 double-await crash leaves status 'error' + a Traceback while the
// one-shot boot paint still differs frame-to-frame. Require all three to be healthy.
const awaitStatus = await page.evaluate(() => document.getElementById('status').textContent);
const awaitConsole = await consoleText();
if (g1 !== g2 && awaitStatus === 'running' && !/Error|Traceback/.test(awaitConsole))
  ok('cross-module await matrix runs (from-import + alias + returned-then-called)');
else fail(`await matrix not healthy — animating=${g1 !== g2} status=${awaitStatus} console=${awaitConsole}`);
await page.evaluate(() => pyodide.runPython('_stop()'));

// C1 regression: a module with module-LEVEL calls (run at import time) must import + run.
await page.evaluate(() => pyodide.runPython('_stop()'));
await runProject({
  'main.py': 'import pygame, conf\npygame.init()\nscreen=pygame.display.set_mode((200,150))\nscreen.fill(conf.BG)\npygame.display.flip()\nprint("MAIN_OK", conf.SIZE)\n',
  'conf.py': 'import math\nSIZE = len("hello")\nBG = (int(math.pi*10) % 255, 40, 90)\n_table = list(range(3))\n',   // module-level CALLS at import time
}, 'main.py');
await page.waitForFunction(() => /MAIN_OK 5/.test(
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n')),
  null, { timeout: 15_000 }).then(() => ok('module with top-level calls imports + runs (C1 fixed)'))
  .catch(async () => fail('module top-level call broke import (C1): ' + await consoleText()));
await page.evaluate(() => pyodide.runPython('_stop()'));

// Pause honored inside an imported module function (function-level cooperation intact post-C1).
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
const tSleep = Date.now();
await runProject({
  'main.py': 'import pygame, seq\npygame.init()\nscreen=pygame.display.set_mode((200,150))\nseq.run(screen)\n',
  'seq.py': 'import pygame, time\ndef run(screen):\n    screen.fill((200,60,60)); pygame.display.flip()\n    pygame.time.wait(500)\n    time.sleep(0.5)\n    screen.fill((60,200,60)); pygame.display.flip()\n    print("SEQ_DONE")\n',
}, 'main.py');
const rresp0 = Date.now(); await page.evaluate(() => 1+1); const rresp = Date.now() - rresp0;
await page.waitForFunction(() => /SEQ_DONE/.test(
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n')),
  null, { timeout: 12_000 }).then(() => {
    const took = Date.now() - tSleep;
    if (rresp < 500 && took >= 800) ok(`imported module pause honored (~${took}ms) without freezing (${rresp}ms)`);
    else fail(`imported pause wrong: took=${took}ms resp=${rresp}ms`);
  }).catch(async () => fail('imported module pause never finished: ' + await consoleText()));
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
// M2: the message names the file BASENAME, not the abs MEMFS path.
const methodErr = await consoleText();
if (/badmod\.py/.test(methodErr) && !/\/home\/pyodide|\/badmod/.test(methodErr))
  ok('friendly error shows basename badmod.py (M2)');
else fail('friendly error path wrong (M2): ' + methodErr);
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

// SELECTIVE ASYNCIFY — the headline fix. A pure module helper stays sync so a
// class method can call it and use the real return value (not a coroutine).
await page.evaluate(() => pyodide.runPython('_stop()'));
await runProject({
  'main.py': 'import pygame, entities\npygame.init()\nscreen=pygame.display.set_mode((200,150))\np = entities.Player((10,20))\nprint("KIND", type(p.size).__name__, p.size)\n',
  'entities.py': 'def scale(n):\n    return n * 2\nclass Player:\n    def __init__(self, pos):\n        self.size = scale(8)\n        self.pos = pos\n    def grow(self):\n        self.size = scale(self.size)\n',
}, 'main.py');
await page.waitForFunction(() => /KIND int 16/.test(
  Array.from(document.getElementById('console').children).map(c=>c.textContent).join('\n')),
  null, { timeout: 15000 }).then(() => ok('class method uses a pure module helper result (selective asyncify)'))
  .catch(async () => fail('canonical method-uses-helper pattern broke: ' + await consoleText()));
await page.evaluate(() => pyodide.runPython('_stop()'));

// Module-level constant computed via a pure helper resolves to the value (not a coroutine).
await page.evaluate(() => { document.getElementById('console').textContent=''; });
await runProject({
  'main.py': 'import pygame, conf2\npygame.init()\nscreen=pygame.display.set_mode((200,150))\nprint("CONST", type(conf2.SIZE).__name__, conf2.SIZE)\n',
  'conf2.py': 'def compute():\n    return 7 * 6\nSIZE = compute()\n',
}, 'main.py');
await page.waitForFunction(() => /CONST int 42/.test(
  Array.from(document.getElementById('console').children).map(c=>c.textContent).join('\n')),
  null, { timeout: 15000 }).then(() => ok('module-level constant via a pure helper resolves to a value'))
  .catch(async () => fail('module-level helper constant broke: ' + await consoleText()));
await page.evaluate(() => pyodide.runPython('_stop()'));

// Friendly error: a cooperative (pause/loop) function called by bare name from a SYNC
// context (a class method) — its coroutine would be silently dropped, so we raise instead.
await page.evaluate(() => { document.getElementById('console').textContent=''; });
await runProject({
  'main.py': 'import bad\nbad.Thing().go()\n',
  'bad.py': 'import pygame\ndef pause_a_bit():\n    pygame.time.wait(200)\nclass Thing:\n    def go(self):\n        pause_a_bit()\n',   // method calls a cooperative fn -> friendly error
}, 'main.py');
await page.waitForFunction(() => /pause_a_bit/.test(
  Array.from(document.getElementById('console').children).map(c=>c.textContent).join('\n')),
  null, { timeout: 15000 }).then(() => ok('friendly error: cooperative fn called from a sync method'))
  .catch(async () => fail('no friendly error for coop-from-sync: ' + await consoleText()));
// must be the friendly message, NOT a raw traceback
const coopErr = await consoleText();
if (!/Traceback/.test(coopErr)) ok('coop-from-sync error is friendly (no raw traceback)');
else fail('coop-from-sync produced a raw traceback: ' + coopErr);
await page.evaluate(() => pyodide.runPython('_stop()'));

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
// Force a real document load (not a same-path fragment nav, which would only fire the
// hashchange handler) so this exercises loadInitialProject's precedence as intended.
await page.goto('about:blank');
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

// hashchange handler: same-tab share link prompts; cancel preserves the project, accept loads it.
await page.goto(URL, { waitUntil: 'load' }); await booted();
const hcHash = '#project=' + Buffer.from(JSON.stringify(
  { files: { 'main.py': 'SHARED_HC = 9\n' }, order: ['main.py'], entry: 'main.py' })).toString('base64url');
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'KEEP_HC = 1\n', 'x.py': 'Y = 2\n' }, order: ['main.py','x.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
// cancel: confirm=false -> project NOT replaced
await page.evaluate((h) => { window.confirm = () => false; location.hash = h; }, hcHash);
await page.waitForTimeout(250);
const hcCancel = await page.evaluate(() => ({ order: window.project.order,
  val: document.querySelector('.CodeMirror').CodeMirror.getValue() }));
if (hcCancel.order.length === 2 && hcCancel.val.includes('KEEP_HC')) ok('hashchange cancel preserves the current project');
else fail('hashchange cancel lost the project: ' + JSON.stringify(hcCancel));
// accept: confirm=true -> loads the shared single file (hash was stripped on cancel, so set it again)
await page.evaluate((h) => { window.confirm = () => true; location.hash = h; }, hcHash);
await page.waitForTimeout(250);
const hcAccept = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
if (hcAccept.includes('SHARED_HC')) ok('hashchange accept loads a same-tab share link');
else fail('hashchange accept did not load: ' + hcAccept);

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'MULTIFILE VERIFY FAILED' : 'MULTIFILE VERIFY OK');
