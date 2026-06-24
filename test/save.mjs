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

// Helper: read a downloaded zip's entries via JSZip in-page. (Hoisted above the
// always-zip checks so the lone-.py Download — now a zip — can be inspected too.)
let _zipSeq = 0;
async function readZip(download) {
  const path = join(tmp, `p${_zipSeq++}.zip`);   // unique path per call (no overwrite races)
  await download.saveAs(path);
  const b64 = (await readFile(path)).toString('base64');
  // Tolerate a non-zip artifact (RED state: a feature not yet always-zip downloads a
  // bare file). Return {__notAZip} instead of throwing, so every check still reports.
  return page.evaluate(async (b64) => {
    try {
      const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const Z = window.JSZip || (await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = rej; document.head.appendChild(s); }));
      const zip = await Z.loadAsync(data);
      const out = {};
      // Skip directory entries (zip.file(dir) is null for `sprites/`); only read files.
      for (const [name, entry] of Object.entries(zip.files))
        if (!entry.dir) out[name] = Array.from(await entry.async('uint8array'));
      return out;
    } catch (e) { return { __notAZip: String(e && e.message || e) }; }
  }, b64);
}
const toStr = (arr) => Buffer.from(arr).toString('utf8');

// Click a selector and capture the resulting download, with a SHORT timeout so a
// not-yet-implemented affordance (RED: no .dl button) reports a clean FAIL instead of
// hanging the battery. Returns the Download, or null on timeout/missing element.
async function clickDownload(selector) {
  const has = await page.$(selector);
  if (!has) return null;
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 4000 }),
      page.click(selector, { timeout: 3000 }),
    ]);
    return dl;
  } catch { return null; }
}

// 1. Save button exists.
const hasBtn = await page.evaluate(() => !!document.getElementById('saveBtn'));
if (hasBtn) ok('save button present'); else fail('no #saveBtn');

// 5a. JSZip laziness — FIRST PAINT (moved here from the old post-.py-save spot).
// Always-zip means the FIRST Download crosses the JSZip path, so the only place
// JSZip can be proven absent is BEFORE any Download. Re-assert it here, then prove
// it BECOMES defined after the first Download (5b, below).
const noJsZipFirstPaint = await page.evaluate(() => typeof window.JSZip === 'undefined');
if (noJsZipFirstPaint) ok('JSZip absent at first paint (lazy — no Download yet)');
else fail('JSZip loaded eagerly at first paint');

// 2. Lone file (no assets) now Downloads as pygame-project.zip CONTAINING <entry>.py
//    (always-zip: Branch A's bare-main.py fast-path is deleted). Fold the old raw-.py
//    content check into a zip-entry read.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import pygame  # my game\n' } });
});
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#saveBtn'),
]);
if (dl.suggestedFilename() === 'pygame-project.zip') ok('lone file Downloads as pygame-project.zip (always-zip)');
else fail('wrong filename (expected pygame-project.zip): ' + dl.suggestedFilename());
// 5b. Capture JSZip state RIGHT AFTER the first Download, BEFORE readZip (which would
//     itself lazy-load JSZip and mask the result). Always-zip must have loaded it.
const jsZipAfterSave = await page.evaluate(() => typeof window.JSZip !== 'undefined');
const zlone = await readZip(dl);
if (zlone['main.py'] && toStr(zlone['main.py']) === 'import pygame  # my game\n')
  ok('always-zip: zip contains main.py with the editor content');
else fail('lone-zip main.py wrong: ' + JSON.stringify(Object.keys(zlone)) + ' / ' + JSON.stringify(zlone['main.py'] && toStr(zlone['main.py'])));

// 5b (report). AFTER the first Download JSZip is now DEFINED (the always-zip path
//     loaded it). Inverts the old "undefined after a .py-only save".
if (jsZipAfterSave) ok('JSZip present after the first Download (always-zip loaded it)');
else fail('JSZip still undefined after a Download — always-zip did not load it');

// 3. A renamed lone file Downloads as pygame-project.zip CONTAINING game.py.
await page.evaluate(() => { window.project.load({ files: { 'game.py': 'x = 1\n' } }); });
const [dl2] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
if (dl2.suggestedFilename() === 'pygame-project.zip') ok('renamed lone file Downloads as pygame-project.zip');
else fail('renamed lone file wrong name (expected pygame-project.zip): ' + dl2.suggestedFilename());
const zren = await readZip(dl2);
if (zren['game.py'] && toStr(zren['game.py']) === 'x = 1\n') ok('always-zip: renamed-file zip contains game.py');
else fail('renamed-file zip wrong: ' + JSON.stringify(Object.keys(zren)));

// 4. Cmd-S (focus the editor first) triggers the same always-zip Download.
await page.evaluate(() => { window.project.load({ files: { 'main.py': 'shortcut = 1\n' } }); document.querySelector('.CodeMirror').CodeMirror.focus(); });
const isMac = process.platform === 'darwin';
const [dl3] = await Promise.all([
  page.waitForEvent('download'),
  page.keyboard.press(isMac ? 'Meta+s' : 'Control+s'),
]);
if (dl3.suggestedFilename() === 'pygame-project.zip') ok('Cmd/Ctrl-S triggers the always-zip Download');
else fail('shortcut save wrong (expected pygame-project.zip): ' + dl3.suggestedFilename());

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
// Deterministic wait: the chip shows a count only after assetFS.add awaits the
// IndexedDB put (so assetStore.getAll() — the zip's byte source — has it).
await page.waitForFunction(() => /1/.test(document.getElementById('assetChip').textContent), null, { timeout: 5000 });
const [adl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
if (adl.suggestedFilename() === 'pygame-project.zip') ok('lone file + an asset still zips');
else fail('asset-zip name wrong: ' + adl.suggestedFilename());
const z2 = await readZip(adl);
const pngBytes = Array.from(buf(PNG_B64));
if (z2['main.py'] && JSON.stringify(z2['dot.png']) === JSON.stringify(pngBytes))
  ok('zip bundles the asset bytes intact');
else fail('asset bytes wrong in zip: ' + (z2['dot.png'] ? 'mismatch' : 'missing'));

// 8. Multi-file project + an asset together (the real-world game-with-sprites case).
await page.evaluate(() => window.project.load({ files: { 'main.py': 'import sprites\n', 'sprites.py': 'P = 1\n' },
  order: ['main.py','sprites.py'], entry: 'main.py', active: 'main.py' }));   // asset dot.png still uploaded
const [mdl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
const z3 = await readZip(mdl);
if (toStr(z3['main.py']).includes('import sprites') && z3['sprites.py'] &&
    JSON.stringify(z3['dot.png']) === JSON.stringify(pngBytes))
  ok('multi-file + asset zips code and asset together');
else fail('multi-file+asset zip wrong: ' + JSON.stringify(Object.keys(z3)));

// 9. An asset whose name collides with a code file does NOT clobber the code.
await page.evaluate(() => window.project.load({ files: { 'main.py': 'M = 1\n', 'data.py': 'CODE = 99\n' },
  order: ['main.py','data.py'], entry: 'main.py', active: 'main.py' }));
await page.setInputFiles('#assetInput', { name: 'data.py', mimeType: 'image/png', buffer: buf(PNG_B64) });  // asset named like a code file
await page.waitForFunction(() => /2/.test(document.getElementById('assetChip').textContent), null, { timeout: 5000 });
const [cdl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
const z4 = await readZip(cdl);
if (toStr(z4['data.py']).includes('CODE = 99') && JSON.stringify(z4['asset_data.py']) === JSON.stringify(pngBytes))
  ok('asset name collision: code preserved, asset zipped as asset_data.py');
else fail('collision handling wrong: ' + JSON.stringify(Object.keys(z4)));

// ----------------------------------------------------------------------------
// D. Auto-__init__.py-in-zip fidelity (S5 §5 / design 0.1-Q1).
//    A downloaded zip of a package project must be a faithful importable package:
//    every .py-bearing directory gets an EMPTY __init__.py marker (JS-derived at zip
//    time), and a USER-AUTHORED __init__.py (with content) is NEVER overwritten.
// ----------------------------------------------------------------------------

// 10. sprites/enemy.py + main.py -> the zip contains an EMPTY sprites/__init__.py marker.
//     Clear the assets left by checks 7/9 so the zip contents are unambiguous.
await page.evaluate(async () => { await window.assetFS.clearAll(); window.project.load({
  files: { 'main.py': 'import sprites.enemy\n', 'sprites/enemy.py': 'E = 1\n' },
  order: ['main.py', 'sprites/enemy.py'], entry: 'main.py', active: 'main.py' }); });
const [idl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
const zi = await readZip(idl);
if ('sprites/__init__.py' in zi && toStr(zi['sprites/__init__.py']) === '')
  ok('zip includes an empty sprites/__init__.py marker (faithful package)');
else fail('missing/non-empty auto __init__.py: ' + JSON.stringify(Object.keys(zi)) +
  (('sprites/__init__.py' in zi) ? ' /content=' + JSON.stringify(toStr(zi['sprites/__init__.py'])) : ''));

// 11. A USER-authored sprites/__init__.py (with content) is preserved, not overwritten.
await page.evaluate(() => window.project.load({
  files: { 'main.py': 'import sprites.enemy\n', 'sprites/__init__.py': 'VERSION = "1.0"\n', 'sprites/enemy.py': 'E = 1\n' },
  order: ['main.py', 'sprites/__init__.py', 'sprites/enemy.py'], entry: 'main.py', active: 'main.py' }));
const [udl] = await Promise.all([ page.waitForEvent('download'), page.click('#saveBtn') ]);
const zu = await readZip(udl);
if (zu['sprites/__init__.py'] && toStr(zu['sprites/__init__.py']) === 'VERSION = "1.0"\n')
  ok('user-authored __init__.py preserved (never overwritten by the auto marker)');
else fail('user __init__.py clobbered: ' + JSON.stringify(zu['sprites/__init__.py'] && toStr(zu['sprites/__init__.py'])));

// ----------------------------------------------------------------------------
// C. Per-item row download (the .dl affordance S2 OMITTED; S5 §3).
//    Each Explorer row (#tabs) gets a `.dl` button:
//      - a .py row  -> downloads the BARE file (filename = basename, content = bare
//        bytes, NO zip, NO JSZip needed).
//      - an asset row -> downloads the BARE asset bytes (byte-identical, NO zip).
//      - a FOLDER row -> downloads a zip of that folder's SUBTREE (filename
//        <folder>.zip; entries are paths RELATIVE to the folder).
//    Implementer seams: `.dl` button in renderTabs emit(); a tabsEl click branch that
//    matches `.dl` FIRST (stopPropagation, no row-select / no folder-toggle) and
//    dispatches to downloadItem(path) for files / downloadFolder(folderPath) for
//    folder rows (folder rows carry data-path; file rows carry data-name).
// ----------------------------------------------------------------------------

// 12. A .py row's .dl downloads the BARE .py (basename filename, bare content, no zip).
await page.evaluate(() => { window.project.load({
  files: { 'main.py': 'import helper\n', 'helper.py': 'H = 42  # bare\n' },
  order: ['main.py', 'helper.py'], entry: 'main.py', active: 'main.py' }); window.renderTabs(); });
const pyRowDl = await clickDownload('#tabs .tab.py[data-name="helper.py"] .dl');
if (!pyRowDl) fail('.py row .dl missing or no download (expected bare helper.py)');
else if (pyRowDl.suggestedFilename() !== 'helper.py') fail('.py row .dl wrong filename (expected helper.py): ' + pyRowDl.suggestedFilename());
else {
  ok('.py row .dl downloads bare helper.py (basename filename)');
  const pPy = join(tmp, 'helper.py');
  await pyRowDl.saveAs(pPy);
  const cPy = await readFile(pPy, 'utf8');
  if (cPy === 'H = 42  # bare\n') ok('.py row .dl content is the bare file (not a zip)');
  else fail('.py row .dl content wrong: ' + JSON.stringify(cPy));
}

// 13. An asset row's .dl downloads the BARE asset bytes (byte-identical, no zip).
//     Clear prior assets first (checks 7/9 left dot.png/data.py in assetStore), then
//     wait on art.png landing in assetStore (the durable byte source the .dl reads).
await page.evaluate(async () => { await window.assetFS.clearAll(); window.project.load({ files: { 'main.py': 'import pygame\n' } }); });
await page.setInputFiles('#assetInput', { name: 'art.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'art.png'), null, { timeout: 5000 });
await page.evaluate(() => window.renderTabs());
// Readiness gate: the asset .dl reads the bare bytes SYNCHRONOUSLY from MEMFS, so wait
// until art.png is actually present in pyodide's FS — the real byte source — before the
// click (bare `pyodide`, not window.pyodide; see assets.mjs/spike-bridge.mjs). This also
// lets Chromium's brief post-file-input download cooldown clear, so the synthesized
// <a download> isn't suppressed — a headless-shell timing quirk that suppresses ANY
// download (even #saveBtn) fired microseconds after setInputFiles, NOT a product issue.
// The byte-identical assertion below is fully preserved.
await page.waitForFunction(
  () => typeof pyodide !== 'undefined' && pyodide.FS.analyzePath('art.png').exists,
  null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);
const assetRowDl = await clickDownload('#tabs .tab.asset[data-name="art.png"] .dl');
if (!assetRowDl) fail('asset row .dl missing or no download (expected bare art.png)');
else if (assetRowDl.suggestedFilename() !== 'art.png') fail('asset row .dl wrong filename (expected art.png): ' + assetRowDl.suggestedFilename());
else {
  ok('asset row .dl downloads bare art.png (basename filename)');
  const pAsset = join(tmp, 'art.png');
  await assetRowDl.saveAs(pAsset);
  const aBytes = Array.from(await readFile(pAsset));
  if (JSON.stringify(aBytes) === JSON.stringify(Array.from(buf(PNG_B64))))
    ok('asset row .dl content is the bare, byte-identical asset (not a zip)');
  else fail('asset row .dl bytes mismatch');
}

// 14. A FOLDER row's .dl downloads a zip of the folder's SUBTREE (relative paths).
await page.evaluate(() => { window.project.load({
  files: { 'main.py': 'import sprites.enemy\n', 'sprites/enemy.py': 'E = 1\n', 'sprites/boss.py': 'B = 2\n' },
  order: ['main.py', 'sprites/enemy.py', 'sprites/boss.py'], entry: 'main.py', active: 'main.py' });
  if (typeof closedFolders !== 'undefined') closedFolders.clear();   // ensure the folder row renders
  window.renderTabs(); });
const folderDl = await clickDownload('#tabs .tab.folder[data-path="sprites"] .dl');
if (!folderDl) fail('folder row .dl missing or no download (expected sprites.zip)');
else if (folderDl.suggestedFilename() !== 'sprites.zip') fail('folder row .dl wrong filename (expected sprites.zip): ' + folderDl.suggestedFilename());
else {
  ok('folder row .dl downloads <folder>.zip');
  const zf = await readZip(folderDl);
  // Entries are RELATIVE to the folder: enemy.py + boss.py at the zip root, NOT sprites/enemy.py.
  if (zf['enemy.py'] && zf['boss.py'] && toStr(zf['enemy.py']) === 'E = 1\n' && toStr(zf['boss.py']) === 'B = 2\n')
    ok('folder zip contains the subtree at paths relative to the folder');
  else fail('folder zip subtree wrong: ' + JSON.stringify(Object.keys(zf)));
}

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'SAVE VERIFY FAILED' : 'SAVE VERIFY OK');
