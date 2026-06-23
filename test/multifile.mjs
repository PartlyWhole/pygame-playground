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

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'MULTIFILE VERIFY FAILED' : 'MULTIFILE VERIFY OK');
