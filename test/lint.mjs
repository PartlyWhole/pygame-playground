// Headless verification of auto-lint. Mirrors test/assets.mjs.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const setCode = (src) => page.evaluate((s) => document.querySelector('.CodeMirror').CodeMirror.setValue(s), src);
const markers = () => page.evaluate(() => ({
  err: document.querySelectorAll('.CodeMirror-lint-marker-error, .CodeMirror-lint-marker-multiple').length,
  warn: document.querySelectorAll('.CodeMirror-lint-marker-warning').length,
  any: document.querySelectorAll('.CodeMirror-lint-marker').length,
}));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running','ready','finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// 1. Lazy: lint not enabled at first paint (no edit yet).
const lintEarly = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getOption('lint'));
if (!lintEarly) ok('lint not enabled before first edit (lazy)'); else fail('lint enabled eagerly');

// 2. Undefined name -> an error marker on the right line.
await setCode('import pygame\nx = 0\nx += speeed\n');   // speeed undefined (line 3)
await page.waitForSelector('.CodeMirror-lint-marker-error, .CodeMirror-lint-marker-multiple', { timeout: 20_000 })
  .then(() => ok('undefined name shows an error marker'))
  .catch(() => fail('no error marker for undefined name'));
const ann = await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  // CM5 lint addon stores state on cm.state.lint.marked (the inline marks)
  return (cm.state.lint && cm.state.lint.marked || []).length;
});
if (ann > 0) ok('lint produced inline annotations'); else fail('no inline lint annotations');

// 3. Syntax error -> an ERROR marker (pins the invalid-syntax->error severity, so a
//    future ruff bump that renamed the code can't silently downgrade it to a warning).
await setCode('import pygame\ndef run(:\n    pass\n');
await page.waitForSelector('.CodeMirror-lint-marker-error, .CodeMirror-lint-marker-multiple', { timeout: 20_000 })
  .then(() => ok('syntax error shows an error marker')).catch(() => fail('no error marker for syntax error'));

// 4. Unused import -> a warning marker.
await setCode('import random\nx = 1\n');
await page.waitForSelector('.CodeMirror-lint-marker-warning', { timeout: 20_000 })
  .then(() => ok('unused import shows a warning marker')).catch(() => fail('no warning for unused import'));

// 5. No STYLE noise: valid compact-if code (like the app's examples) -> zero markers.
await setCode('import pygame\nkeys = pygame.key.get_pressed()\nx = 0\nif keys:  x -= 5\nif keys:  x += 5\nprint(x)\n');
await page.waitForTimeout(1200);   // let the debounced lint run
const m5 = await markers();
if (m5.any === 0) ok('no style-noise markers on compact-if code (curation works)');
else fail('style noise: ' + JSON.stringify(m5));

// 6. Clean code -> no markers.
await setCode('import pygame\npygame.init()\nscreen = pygame.display.set_mode((320, 240))\nprint(screen)\n');
await page.waitForTimeout(1200);
const m6 = await markers();
if (m6.any === 0) ok('clean code has no markers'); else fail('markers on clean code: ' + JSON.stringify(m6));

// 7. Multi-file: an undefined name in a non-active file marks after switching to it.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import good\n', 'good.py': 'y = notdefined\n' },
                        order: ['main.py','good.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await page.waitForTimeout(800);   // let main.py settle (its only finding is an F401 warning, never an error marker)
await page.click('#tabs .tab[data-name="good.py"]');   // switch -> setActive re-lints good.py
// good.py has an undefined name (F821 -> error); main.py never produces an error marker,
// so an error marker here proves the switch re-linted the newly-shown file.
await page.waitForSelector('.CodeMirror-lint-marker-error, .CodeMirror-lint-marker-multiple', { timeout: 20_000 })
  .then(() => ok('switching tabs lints the newly-shown file')).catch(() => fail('tab switch did not re-lint'));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'LINT VERIFY FAILED' : 'LINT VERIFY OK');
