// Headless verification of S5 UPLOAD ROUTING (#6): route by extension, land in the
// selected folder, warn + auto-suffix on a same-path clash (ONE unified helper for
// code + asset), and keep drop-anywhere. Mirrors test/assets.mjs structure.
//
// SEAMS the implementer MUST expose / satisfy (named here so the implementer matches):
//   - A single upload router (e.g. `uploadFiles(files, selectedFolder)` calling a
//     per-file `routeUpload(file, destFolder)`) wired into BOTH live entry points:
//     the `#assetInput` change handler AND the document `drop` handler. NOT boot
//     hydrate (which replays already-classified IndexedDB records, asset-only).
//   - Routing by EXTENSION only: `/\.py$/i` -> CODE (project.add, validated by the
//     path-aware isModuleName; editor reached via a fresh Doc + setActive/swapDoc,
//     NEVER editor.setValue). Everything else -> ASSET (assetFS.add).
//   - Land at `selectedFolder ? selectedFolder + "/" + name : name` (root default).
//     `selectedFolder` is set by clicking a folder row in #tabs.
//   - `uniquePath(path, exists)` collision helper, used by BOTH branches: suffix the
//     LEAF before the extension — `helper.py` -> `helper-2.py`, `ship.png` ->
//     `ship-2.png` — never overwrite, never silently refuse. A sys console line warns.
//   - `existsAnywhere(path)` spans code AND assets (one MEMFS namespace within a dir).
//   - `assetFS.add(file, name = file.name)` optional name-override arg so a suffixed /
//     folder-prefixed asset lands at the computed path (assetStore name = project path).
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

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// Reset to a clean lone-file project + no assets before every routing scenario.
async function reset() {
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'main.py': 'import pygame\n' }, entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
}

// Arm a setValue spy on the single CodeMirror so a code-upload that cheats via
// editor.setValue (which arms lint + breaks first-paint laziness) is caught.
async function armSetValueSpy() {
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    window.__setValueCalls = 0;
    if (!cm.__svWrapped) {
      const orig = cm.setValue.bind(cm);
      cm.setValue = function (...a) { window.__setValueCalls++; return orig(...a); };
      cm.__svWrapped = true;
    }
  });
}

// 0. First-paint laziness invariant we must not break: no JSZip from an upload.
const noJsZipBoot = await page.evaluate(() => typeof window.JSZip === 'undefined');
if (noJsZipBoot) ok('JSZip absent at first paint (an upload must not load it)');
else fail('JSZip loaded eagerly at first paint');

// ----------------------------------------------------------------------------
// 1. ROUTE BY EXTENSION: a .py uploaded via #assetInput becomes a CODE file
//    (project.files + a .py tree row), reaches the editor WITHOUT editor.setValue,
//    and is NOT an asset. An image becomes an ASSET (assetFS), NOT a code file.
// ----------------------------------------------------------------------------
await reset();
await armSetValueSpy();
await page.setInputFiles('#assetInput', { name: 'helper.py', mimeType: 'text/x-python', buffer: Buffer.from('H = 1\n') });
await page.waitForFunction(() => window.project && window.project.order.includes('helper.py'), null, { timeout: 5000 })
  .catch(() => {});
const pyRoute = await page.evaluate(() => ({
  inCode: !!(window.project.files && window.project.files['helper.py']),
  inOrder: window.project.order.includes('helper.py'),
  notAsset: !window.assetFS.list.some(a => a.name === 'helper.py'),
  hasRow: !!document.querySelector('#tabs .tab.py[data-name="helper.py"]'),
  notAssetRow: !document.querySelector('#tabs .tab.asset[data-name="helper.py"]'),
  setValueCalls: window.__setValueCalls,
}));
if (pyRoute.inCode && pyRoute.inOrder && pyRoute.notAsset && pyRoute.hasRow && pyRoute.notAssetRow)
  ok('.py upload routes to CODE (project.files + a .py tree row, not an asset)');
else fail('.py routing wrong: ' + JSON.stringify(pyRoute));

// 2. The code-upload reached the editor WITHOUT editor.setValue (lint stays unarmed).
if (pyRoute.setValueCalls === 0) ok('code upload used a fresh Doc/swapDoc — zero editor.setValue calls');
else fail('code upload called editor.setValue ' + pyRoute.setValueCalls + ' time(s) (arms lint / breaks laziness)');

// 3. ROUTE BY EXTENSION: an image uploaded via #assetInput becomes an ASSET.
await reset();
await page.setInputFiles('#assetInput', { name: 'ship.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'ship.png'), null, { timeout: 5000 })
  .catch(() => {});
const imgRoute = await page.evaluate(() => ({
  inAsset: window.assetFS.list.some(a => a.name === 'ship.png'),
  notCode: !(window.project.files && window.project.files['ship.png']),
  assetRow: !!document.querySelector('#tabs .tab.asset[data-name="ship.png"]'),
}));
if (imgRoute.inAsset && imgRoute.notCode && imgRoute.assetRow)
  ok('image upload routes to ASSET (assetFS + an asset tree row, not code)');
else fail('image routing wrong: ' + JSON.stringify(imgRoute));

// ----------------------------------------------------------------------------
// 4. LAND IN THE SELECTED FOLDER (root default). Select a folder row in #tabs, then
//    an uploaded .py lands at <folder>/<name>, an uploaded image at <folder>/<name>,
//    and the nested files exist in MEMFS. With NO folder selected -> root.
// ----------------------------------------------------------------------------
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import pkg.mod\n', 'pkg/mod.py': 'M = 1\n' },
    order: ['main.py', 'pkg/mod.py'], entry: 'main.py', active: 'main.py' });
  if (typeof closedFolders !== 'undefined') closedFolders.clear();
  window.renderTabs();
});
// Drive selectedFolder by clicking the folder row (the user gesture that sets it).
await page.click('#tabs .tab.folder[data-path="pkg"]');
await page.setInputFiles('#assetInput', { name: 'enemy.py', mimeType: 'text/x-python', buffer: Buffer.from('E = 1\n') });
await page.waitForFunction(() => window.project.order.includes('pkg/enemy.py'), null, { timeout: 5000 }).catch(() => {});
// Re-select the folder (renderTabs after a code-upload may reset selection to the new file's dir).
await page.evaluate(() => { window.renderTabs(); });
await page.click('#tabs .tab.folder[data-path="pkg"]');
await page.setInputFiles('#assetInput', { name: 'tile.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'pkg/tile.png'), null, { timeout: 5000 }).catch(() => {});
const folderLand = await page.evaluate(() => ({
  codeAtPath: !!window.project.files['pkg/enemy.py'],
  assetAtPath: window.assetFS.list.some(a => a.name === 'pkg/tile.png'),
  memfsCode: !!(window.pyodide && pyodide.FS.analyzePath('pkg/enemy.py').exists),
  memfsAsset: !!(window.pyodide && pyodide.FS.analyzePath('pkg/tile.png').exists),
}));
if (folderLand.codeAtPath && folderLand.assetAtPath && folderLand.memfsCode && folderLand.memfsAsset)
  ok('uploads land in the SELECTED folder (pkg/enemy.py code + pkg/tile.png asset, nested in MEMFS)');
else fail('selected-folder landing wrong: ' + JSON.stringify(folderLand));

// 4b. With NO folder selected, an upload lands at ROOT.
await reset();
await page.evaluate(() => { selectedFolder = ''; });   // implementer: selectedFolder is the anchor (root = "")
await page.setInputFiles('#assetInput', { name: 'root.py', mimeType: 'text/x-python', buffer: Buffer.from('R = 1\n') });
await page.waitForFunction(() => window.project.order.includes('root.py'), null, { timeout: 5000 }).catch(() => {});
const rootLand = await page.evaluate(() => ({
  atRoot: !!window.project.files['root.py'],
  notNested: !Object.keys(window.project.files).some(k => k !== 'root.py' && k.endsWith('/root.py')),
}));
if (rootLand.atRoot && rootLand.notNested) ok('with no folder selected, an upload lands at ROOT');
else fail('root-default landing wrong: ' + JSON.stringify(rootLand));

// ----------------------------------------------------------------------------
// 5. COLLISION (CODE): uploading a name that already exists at that path
//    auto-suffixes (helper.py -> helper-2.py), does NOT overwrite, and warns (sys line).
// ----------------------------------------------------------------------------
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'import pygame\n', 'helper.py': 'ORIGINAL = 1\n' },
    order: ['main.py', 'helper.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__consoleLen = document.getElementById('console').children.length;
});
await page.setInputFiles('#assetInput', { name: 'helper.py', mimeType: 'text/x-python', buffer: Buffer.from('UPLOADED = 2\n') });
await page.waitForFunction(() => window.project.order.includes('helper-2.py'), null, { timeout: 5000 }).catch(() => {});
const codeClash = await page.evaluate(() => ({
  suffixed: !!window.project.files['helper-2.py'],
  suffixedContent: window.project.files['helper-2.py'] ? window.project.files['helper-2.py'].getValue() : null,
  originalIntact: window.project.files['helper.py'] ? window.project.files['helper.py'].getValue() : null,
  warned: Array.from(document.getElementById('console').children).slice(window.__consoleLen)
    .some(c => /already exists|helper-2\.py/.test(c.textContent)),
}));
if (codeClash.suffixed && codeClash.suffixedContent === 'UPLOADED = 2\n' &&
    codeClash.originalIntact === 'ORIGINAL = 1\n' && codeClash.warned)
  ok('code collision: suffixes to helper-2.py, original preserved, sys warn shown');
else fail('code collision wrong: ' + JSON.stringify(codeClash));

// ----------------------------------------------------------------------------
// 6. COLLISION (ASSET): uploading a name that already exists auto-suffixes
//    (ship.png -> ship-2.png), byte-identical original preserved, warns. Proves the
//    UNIFIED helper — both branches suffix identically (leaf-before-extension).
// ----------------------------------------------------------------------------
await reset();
const originalPng = Array.from(buf(PNG_B64));
await page.setInputFiles('#assetInput', { name: 'ship.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'ship.png'), null, { timeout: 5000 }).catch(() => {});
await page.evaluate(() => { window.__consoleLen2 = document.getElementById('console').children.length; });
// Second upload with DIFFERENT bytes so we can prove the original is not overwritten.
const altPng = buf(PNG_B64); altPng[altPng.length - 1] ^= 0xff;
await page.setInputFiles('#assetInput', { name: 'ship.png', mimeType: 'image/png', buffer: altPng });
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'ship-2.png'), null, { timeout: 5000 }).catch(() => {});
const assetClash = await page.evaluate(async () => {
  const recs = await assetStore.getAll();
  const orig = recs.find(r => r.name === 'ship.png');
  const suff = recs.find(r => r.name === 'ship-2.png');
  return {
    suffixed: !!suff,
    origBytes: orig ? Array.from(new Uint8Array(orig.bytes)) : null,
    bothPresent: !!orig && !!suff,
    warned: Array.from(document.getElementById('console').children).slice(window.__consoleLen2)
      .some(c => /already exists|ship-2\.png/.test(c.textContent)),
  };
});
if (assetClash.suffixed && assetClash.bothPresent &&
    JSON.stringify(assetClash.origBytes) === JSON.stringify(originalPng) && assetClash.warned)
  ok('asset collision: suffixes to ship-2.png, original byte-identical, sys warn (unified helper)');
else fail('asset collision wrong: ' + JSON.stringify({ ...assetClash, origMatches: JSON.stringify(assetClash.origBytes) === JSON.stringify(originalPng) }));

// ----------------------------------------------------------------------------
// 7. CROSS-NAMESPACE clash within a dir: code and assets share the per-directory
//    MEMFS namespace, so existsAnywhere(path) MUST span BOTH. Seed an ASSET at the
//    path `data.py` (a pre-routing/legacy state), then upload a CODE `data.py`: it
//    must SEE the asset and suffix to `data-2.py` (not silently clobber the asset).
//    (Complements save.mjs check 9, which is the zip-time asset_ prefix — a different layer.)
// ----------------------------------------------------------------------------
await page.evaluate(async () => {
  await window.assetFS.clearAll();
  window.project.load({ files: { 'main.py': 'import pygame\n' }, entry: 'main.py', active: 'main.py' });
  // Seed an asset literally at the path "data.py" (bypassing the new router, to set up
  // the shared-namespace collision the router's existsAnywhere must detect).
  await window.assetFS.add(new File([new Uint8Array([1, 2, 3])], 'data.py', { type: 'application/octet-stream' }));
  window.renderTabs();
});
await page.waitForFunction(() => window.assetFS.list.some(a => a.name === 'data.py'), null, { timeout: 5000 }).catch(() => {});
// Now upload a CODE data.py — routes to code, but the path is taken by the asset.
await page.setInputFiles('#assetInput', { name: 'data.py', mimeType: 'text/x-python', buffer: Buffer.from('CODE = 99\n') });
await page.waitForFunction(() => window.project.order.includes('data-2.py'), null, { timeout: 5000 }).catch(() => {});
const crossClash = await page.evaluate(() => ({
  codeSuffixed: !!window.project.files['data-2.py'],
  codeNotAtTakenPath: !window.project.files['data.py'],
  assetIntact: window.assetFS.list.some(a => a.name === 'data.py'),
}));
if (crossClash.codeSuffixed && crossClash.codeNotAtTakenPath && crossClash.assetIntact)
  ok('cross-namespace clash: code upload sees the asset at data.py, suffixes to data-2.py, asset intact');
else fail('cross-namespace clash wrong: ' + JSON.stringify(crossClash));

// ----------------------------------------------------------------------------
// 8. DROP-ANYWHERE still routes via #dropOverlay: a dropped .py -> code, a dropped
//    image -> asset (the drop handler body re-routes through the upload router).
// ----------------------------------------------------------------------------
await reset();
await page.evaluate((pngB64) => {
  const png = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([new TextEncoder().encode('D = 1\n')], 'dropped.py', { type: 'text/x-python' }));
  dt.items.add(new File([png], 'dropped.png', { type: 'image/png' }));
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, PNG_B64);
await page.waitForFunction(
  () => window.project.order.includes('dropped.py') && window.assetFS.list.some(a => a.name === 'dropped.png'),
  null, { timeout: 5000 }).catch(() => {});
const dropRoute = await page.evaluate(() => ({
  pyToCode: !!window.project.files['dropped.py'] && !window.assetFS.list.some(a => a.name === 'dropped.py'),
  pngToAsset: window.assetFS.list.some(a => a.name === 'dropped.png') && !window.project.files['dropped.png'],
}));
if (dropRoute.pyToCode && dropRoute.pngToAsset)
  ok('drop-anywhere routes a .py to code and an image to asset (router shared with #assetInput)');
else fail('drop-anywhere routing wrong: ' + JSON.stringify(dropRoute));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');
await browser.close();
console.log(process.exitCode ? 'UPLOAD VERIFY FAILED' : 'UPLOAD VERIFY OK');
