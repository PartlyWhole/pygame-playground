// Headless verification of Save/download. Mirrors test/assets.mjs but uses a
// download-accepting context.
import { launch } from './_harness.mjs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const tmp = await mkdtemp(join(tmpdir(), 'save-test-'));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running','ready','finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// 1. Save button exists.
const hasBtn = await page.evaluate(() => !!document.getElementById('saveBtn'));
if (hasBtn) ok('save button present'); else fail('no #saveBtn');

// 2. Lone file (no assets) downloads as <entry>.py with the editor content.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import pygame  # my game\n' } });
});
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#saveBtn'),
]);
if (dl.suggestedFilename() === 'main.py') ok('lone file downloads as main.py');
else fail('wrong filename: ' + dl.suggestedFilename());
const p1 = join(tmp, 'main.py');
await dl.saveAs(p1);
const c1 = await readFile(p1, 'utf8');
if (c1 === 'import pygame  # my game\n') ok('.py content matches the editor');
else fail('content mismatch: ' + JSON.stringify(c1));

// 3. A renamed lone file downloads under its own name.
await page.evaluate(() => { window.project.load({ files: { 'game.py': 'x = 1\n' } }); });
const [dl2] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
if (dl2.suggestedFilename() === 'game.py') ok('lone file uses the entry filename');
else fail('renamed lone file wrong name: ' + dl2.suggestedFilename());

// 4. Cmd-S (focus the editor first) triggers the same save.
await page.evaluate(() => { window.project.load({ files: { 'main.py': 'shortcut = 1\n' } }); document.querySelector('.CodeMirror').CodeMirror.focus(); });
const isMac = process.platform === 'darwin';
const [dl3] = await Promise.all([
  page.waitForEvent('download'),
  page.keyboard.press(isMac ? 'Meta+s' : 'Control+s'),
]);
if (dl3.suggestedFilename() === 'main.py') ok('Cmd/Ctrl-S triggers Save');
else fail('shortcut save wrong: ' + dl3.suggestedFilename());

// 5. First paint loaded no JSZip (lazy).
const noJsZip = await page.evaluate(() => typeof window.JSZip === 'undefined');
if (noJsZip) ok('JSZip not loaded for the .py-only path (lazy)');
else fail('JSZip loaded eagerly');

// Helper: read a downloaded zip's entries via JSZip in-page.
async function readZip(download) {
  const path = join(tmp, 'p.zip');
  await download.saveAs(path);
  const b64 = (await readFile(path)).toString('base64');
  return page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const Z = window.JSZip || (await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = rej; document.head.appendChild(s); }));
    const zip = await Z.loadAsync(data);
    const out = {};
    for (const name of Object.keys(zip.files)) out[name] = Array.from(await zip.file(name).async('uint8array'));
    return out;
  }, b64);
}
const toStr = (arr) => Buffer.from(arr).toString('utf8');

// 6. Multi-file project -> pygame-project.zip with all .py files.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import enemy\n', 'enemy.py': 'X = 9\n' },
                        order: ['main.py','enemy.py'], entry: 'main.py', active: 'main.py' });
});
const [zdl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
if (zdl.suggestedFilename() === 'pygame-project.zip') ok('multi-file saves as pygame-project.zip');
else fail('zip name wrong: ' + zdl.suggestedFilename());
const z1 = await readZip(zdl);
if (toStr(z1['main.py']).includes('import enemy') && toStr(z1['enemy.py']).includes('X = 9'))
  ok('zip contains all .py files with correct content');
else fail('zip .py content wrong: ' + JSON.stringify(Object.keys(z1)));

// 7. Assets are bundled into the zip (upload a real PNG fixture, single file -> zip via the assets branch).
const { PNG_B64, buf } = await import('./fixtures.mjs');
await page.evaluate(() => window.project.load({ files: { 'main.py': 'import pygame\n' } }));   // lone file...
await page.setInputFiles('#assetInput', { name: 'dot.png', mimeType: 'image/png', buffer: buf(PNG_B64) });  // ...plus an asset
await page.waitForTimeout(200);
const [adl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
if (adl.suggestedFilename() === 'pygame-project.zip') ok('lone file + an asset still zips');
else fail('asset-zip name wrong: ' + adl.suggestedFilename());
const z2 = await readZip(adl);
const pngBytes = Array.from(buf(PNG_B64));
if (z2['main.py'] && JSON.stringify(z2['dot.png']) === JSON.stringify(pngBytes))
  ok('zip bundles the asset bytes intact');
else fail('asset bytes wrong in zip: ' + (z2['dot.png'] ? 'mismatch' : 'missing'));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'SAVE VERIFY FAILED' : 'SAVE VERIFY OK');
