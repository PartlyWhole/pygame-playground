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
