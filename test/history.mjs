// Headless verification of the history panel. Mirrors test/assets.mjs.
import { launch } from './_harness.mjs';
const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const setCode = (s) => page.evaluate((v) => document.querySelector('.CodeMirror').CodeMirror.setValue(v), s);
const runAndSnap = async () => { await page.click('#runBtn'); await page.waitForTimeout(600); };
const snapCount = () => page.evaluate(async () => (await window.historyStore.getAll()).length);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running','ready','finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));
// The boot auto-run snapshots the loaded example fire-and-forget; wait for that
// capture to land before clearing, so we truly start from a clean slate (else the
// in-flight boot capture settles *after* clear() and shows up as a phantom row).
await page.waitForFunction(async () => (await window.historyStore.getAll()).length >= 1,
  null, { timeout: 10_000 }).catch(() => {});
await page.evaluate(async () => { await window.historyStore.clear(); });   // clean slate

// 1. Run captures a snapshot.
await setCode('a = 1\n');
await runAndSnap();
if (await snapCount() === 1) ok('Run captured a snapshot'); else fail('snapshot not captured: ' + await snapCount());

// 2. Dedup: running unchanged code adds nothing; editing + Run adds one.
await runAndSnap();
if (await snapCount() === 1) ok('re-running unchanged code is deduped'); else fail('dedup failed: ' + await snapCount());
await setCode('a = 2\n');
await runAndSnap();
if (await snapCount() === 2) ok('edit + Run adds a version'); else fail('expected 2 versions: ' + await snapCount());

// 3. Snapshot records the project + a timestamp + mode.
const latest = await page.evaluate(async () => (await window.historyStore.getAll())[0]);
if (latest && latest.project.files['main.py'].includes('a = 2') && latest.mode === 'solo' && typeof latest.at === 'number')
  ok('snapshot records project + timestamp + mode'); else fail('snapshot shape wrong: ' + JSON.stringify(latest));

// 4. Multi-file snapshot captures all files.
await page.evaluate(() => window.project.load({ files: { 'main.py': 'import e\n', 'e.py': 'Z = 3\n' },
  order: ['main.py','e.py'], entry: 'main.py', active: 'main.py' }));
await page.click('#runBtn'); await page.waitForTimeout(800);
const multi = await page.evaluate(async () => (await window.historyStore.getAll())[0]);
if (multi && multi.project.order.length === 2 && multi.project.files['e.py'].includes('Z = 3'))
  ok('multi-file project snapshots all files'); else fail('multi-file snapshot wrong: ' + JSON.stringify(multi?.project?.order));

// 5. Cap at 100 (drive the store directly).
await page.evaluate(async () => { await window.historyStore.clear();
  for (let i = 0; i < 105; i++) await window.historyStore.add({ at: Date.now() + i, mode: 'solo', project: { files: { 'main.py': 'x = ' + i + '\n' }, order: ['main.py'], entry: 'main.py' } }); });
const capped = await snapCount();
if (capped === 100) ok('history capped at 100 (oldest evicted)'); else fail('cap wrong: ' + capped);

// 6. The panel lists versions; selecting an older one shows a line-diff; restore works.
await page.evaluate(async () => { await window.historyStore.clear(); });
await page.evaluate(() => window.project.load({ files: { 'main.py': 'a = 1\nb = 2\n' } }));
await page.click('#runBtn'); await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('a = 1\nb = 99\nc = 3\n'));
await page.click('#runBtn'); await page.waitForTimeout(600);

await page.click('#historyBtn');
await page.waitForSelector('#historyPanel .hist-row', { timeout: 5000 });
const rows = await page.evaluate(() => document.querySelectorAll('#historyPanel .hist-row').length);
if (rows === 2) ok('history panel lists both versions'); else fail('rows wrong: ' + rows);

// jsdiff not loaded until we view a diff.
const diffEager = await page.evaluate(() => typeof window.Diff === 'undefined');
if (diffEager) ok('jsdiff not loaded until a diff is viewed (lazy)'); else fail('jsdiff loaded eagerly');

// Select the OLDER version (last row) -> diff vs current shows the changed lines.
await page.click('#historyPanel .hist-row:last-child');
await page.waitForSelector('#historyPanel .hp-diffbody', { timeout: 10_000 });
const diff = await page.evaluate(() => document.querySelector('#historyPanel .hp-diffbody').innerHTML);
if (/d-del/.test(diff) && /d-add/.test(diff)) ok('diff shows added + removed lines'); else fail('diff missing add/del: ' + diff.slice(0, 200));

// Restore the older version -> editor becomes 'a = 1\nb = 2\n'.
await page.evaluate(() => { window.confirm = () => true; });
await page.click('#historyPanel .hp-restore');
await page.waitForTimeout(200);
const restored = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
if (restored.trim() === 'a = 1\nb = 2'.trim()) ok('restore loads the chosen version'); else fail('restore wrong: ' + JSON.stringify(restored));

// 7. Multi-file restore brings back all files.
await page.evaluate(async () => { await window.historyStore.clear(); });
await page.evaluate(() => window.project.load({ files: { 'main.py': 'import e\n', 'e.py': 'Z = 7\n' },
  order: ['main.py','e.py'], entry: 'main.py', active: 'main.py' }));
await page.click('#runBtn'); await page.waitForTimeout(600);
await page.evaluate(() => window.project.load({ files: { 'main.py': 'solo = 1\n' } }));   // collapse to one file
await page.click('#historyBtn'); await page.waitForSelector('#historyPanel .hist-row', { timeout: 5000 });
await page.evaluate(() => { window.confirm = () => true; });
await page.click('#historyPanel .hist-row:last-child');
await page.waitForSelector('#historyPanel .hp-restore', { timeout: 10_000 });
await page.click('#historyPanel .hp-restore');
await page.waitForTimeout(200);
const back = await page.evaluate(() => ({ order: window.project.order, e: window.project.files['e.py']?.getValue() }));
if (back.order.length === 2 && back.e?.includes('Z = 7')) ok('multi-file restore brings back all files'); else fail('multi-file restore wrong: ' + JSON.stringify(back));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | ')); else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'HISTORY VERIFY FAILED' : 'HISTORY VERIFY OK');
