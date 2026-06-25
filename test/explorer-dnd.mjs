// EXPLORER POINTER-DND battery (request #11) — folder ordering model + pointer-events drag.
//
// Design: docs/specs/2026-06-24-explorer-pointer-dnd-design.md. Replaces the flaky native HTML5
// drag-and-drop with a pointer-events controller and adds explicit folder ordering so BOTH files
// and folders reorder reliably.
//
// CRITICAL LESSON (why this battery exists): native HTML5 DnD is UNTESTABLE in headless — a real
// mouse gesture in headless Chromium fires ZERO native drag events. That is exactly why request #6
// regressed despite "green" tests that used synthetic DragEvent dispatch. Pointer events
// (pointerdown/move/up) ARE dispatchable via page.mouse.move/down/up and DO fire the handlers — so
// the R2 tests below drive REAL page.mouse gestures and assert the MODEL + RENDERED ORDER +
// persistence. We do NOT add or trust synthetic-DragEvent tests for the new controller.
//
// Slices:
//   R1 (this file, below) — folder-ordering MODEL + render + serialize/load (no drag yet).
//   R2 — pointer drag controller (file + folder reorder via page.mouse) — appended here.
//   R3 — move-into-folder via pointer + native-DnD removal — appended here.
//
// Run (sequential; concurrent Pyodide/CDN loads flake):
//   python3 -m http.server 8923            # repo root
//   node test/explorer-dnd.mjs http://localhost:8923/
//
// Style mirrors explorer-tree.mjs / subdirs.mjs: ok()/fail() + process.exitCode.

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

// State-aware "ensure the Explorer rail view is open" (mirrors explorer-tree.mjs).
const ensureExplorerOpen = async () => {
  const needsClick = await page.evaluate(() => {
    const side = document.getElementById('side');
    const tab = document.querySelector('nav.rail [data-view="explorer"]');
    const collapsed = !!side && side.classList.contains('collapsed');
    const active = !!tab && tab.getAttribute('aria-selected') === 'true';
    return collapsed || !active;
  });
  if (needsClick) await click('nav.rail [data-view="explorer"]');
};

// Rendered ROOT-level (and deeper) row readers — DOM order is render/emit order.
const folderOrder = () => page.evaluate(() => [...document.querySelectorAll('#tabs .tab.folder')].map(n => n.dataset.path));
const fileOrder = () => page.evaluate(() => [...document.querySelectorAll('#tabs .tab.py')].map(n => n.dataset.name));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));
await ensureExplorerOpen();

// ================================================================================================
// R1 — FOLDER-ORDERING MODEL (no drag yet). project.dirOrder is an ADDITIVE local field modeled on
// project.emptyDirs: serialized + loaded + decoded, but NOT collab-mirrored (the collab doc shape
// {files,order,entry} is unchanged). buildTree renders child dirs by their index in dirOrder, with
// an alphabetical fallback for dirs not listed (preserves today's behavior for un-reordered/old
// projects). Folders-first, then files, within each directory.
// ================================================================================================

// R1.1 — the field exists and serialize carries it (default []).
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  const r = await page.evaluate(() => {
    const ser = window.project.serialize();
    return { hasField: Array.isArray(window.project.dirOrder), serIsArray: Array.isArray(ser.dirOrder) };
  });
  if (r.hasField && r.serIsArray) ok('R1.1 project.dirOrder is an array and serialize().dirOrder is an array (default [])');
  else fail('R1.1 dirOrder field/serialize missing: ' + JSON.stringify(r));
}

// R1.2 — created folders stay ALPHABETICAL by default (addFolder must NOT seed dirOrder in a way
// that reorders the default render; a new folder must not jump position). Preserves today's UX.
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('zebra'); window.project.addFolder('apple');
    window.renderTabs();
  });
  const order = await folderOrder();
  if (eq(order, ['apple', 'zebra'])) ok('R1.2 created folders render alphabetically by default (apple before zebra) — no dirOrder seeding regression');
  else fail('R1.2 default folder order not alphabetical: ' + JSON.stringify(order));
}

// R1.3 — dirOrder DRIVES folder render order.
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('apple'); window.project.addFolder('zebra');
    window.project.dirOrder = ['zebra', 'apple'];
    window.renderTabs();
  });
  const order = await folderOrder();
  if (eq(order, ['zebra', 'apple'])) ok('R1.3 project.dirOrder drives folder render order (zebra before apple)');
  else fail('R1.3 dirOrder did not drive render order: ' + JSON.stringify(order));
}

// R1.4 — partial dirOrder: LISTED folders first (in dirOrder sequence), then UNLISTED alphabetical.
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('alpha'); window.project.addFolder('bravo'); window.project.addFolder('charlie');
    window.project.dirOrder = ['charlie'];
    window.renderTabs();
  });
  const order = await folderOrder();
  if (eq(order, ['charlie', 'alpha', 'bravo'])) ok('R1.4 partial dirOrder: listed folder (charlie) first, then unlisted alphabetical (alpha, bravo)');
  else fail('R1.4 partial dirOrder fallback wrong: ' + JSON.stringify(order));
}

// R1.5 — serialize/load round-trips dirOrder (persistence). Folders also survive via emptyDirs.
{
  const r = await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('apple'); window.project.addFolder('zebra');
    window.project.dirOrder = ['zebra', 'apple'];
    const ser = window.project.serialize();
    // wipe, then restore from the serialized record.
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.load(ser);
    window.renderTabs();
    return { serDirOrder: ser.dirOrder, loadedDirOrder: window.project.dirOrder };
  });
  const order = await folderOrder();
  if (eq(r.serDirOrder, ['zebra', 'apple']) && eq(r.loadedDirOrder, ['zebra', 'apple']))
    ok('R1.5 serialize/load round-trips dirOrder (zebra,apple survives)');
  else fail('R1.5 dirOrder serialize/load round-trip failed: ' + JSON.stringify(r));
  if (eq(order, ['zebra', 'apple'])) ok('R1.5  ...rendered folder order after reload honors the restored dirOrder');
  else fail('R1.5  reloaded render order wrong: ' + JSON.stringify(order));
}

// R1.6 — load back-compat: a record WITHOUT dirOrder → dirOrder=[] and folders render alphabetical.
{
  const r = await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a=1\n', 'zztop/a.py': 'x=1\n', 'aaa/b.py': 'y=1\n' },
      order: ['main.py', 'zztop/a.py', 'aaa/b.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
    return { dirOrder: window.project.dirOrder };
  });
  const order = await folderOrder();
  if (Array.isArray(r.dirOrder) && r.dirOrder.length === 0 && eq(order, ['aaa', 'zztop']))
    ok('R1.6 load back-compat: no dirOrder key → dirOrder=[] and folders render alphabetically (aaa before zztop)');
  else fail('R1.6 back-compat load wrong: ' + JSON.stringify({ ...r, order }));
}

// R1.7 — project.move (folder) re-keys dirOrder entries INCLUDING descendants.
{
  const r = await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/sub/x.py': 'X=1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py',
    });
    window.project.dirOrder = ['sprites', 'sprites/sub'];
    window.project.move('sprites', 'actors');   // → actors/sprites, descendants re-keyed
    return { dirOrder: window.project.dirOrder };
  });
  if (eq(r.dirOrder, ['actors/sprites', 'actors/sprites/sub']))
    ok('R1.7 project.move (folder) re-keys dirOrder + descendants (sprites,sprites/sub → actors/sprites,actors/sprites/sub)');
  else fail('R1.7 folder move did not re-key dirOrder: ' + JSON.stringify(r));
}

// R1.8 — folder RENAME via the ⋯ menu maintains dirOrder (re-key the entry + descendants).
{
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/sub/x.py': 'X=1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py',
    });
    window.project.dirOrder = ['sprites', 'sprites/sub'];
    window.renderTabs();
    window.alert = () => {};
  });
  await ensureExplorerOpen();
  // open the folder ⋯ popup, activate Rename, fill the inline input with `actors`, Enter.
  await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    const menu = folder && folder.querySelector('.tab-menu');
    (menu || folder)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
    const menu = menus[menus.length - 1];
    const ren = menu && [...menu.querySelectorAll('[role="menuitem"]')].find(el => /rename/i.test(el.textContent || ''));
    ren?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const row = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    const input = row && row.querySelector('input[type="text"], input:not([type])');
    if (!input) return;
    input.focus(); input.value = 'actors';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const opts = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ dirOrder: window.project.dirOrder, hasNew: !!window.project.files['actors/enemy.py'] }));
  if (r.hasNew && eq(r.dirOrder, ['actors', 'actors/sub']))
    ok('R1.8 folder rename via ⋯ menu re-keys dirOrder (sprites,sprites/sub → actors,actors/sub)');
  else fail('R1.8 folder rename did not maintain dirOrder: ' + JSON.stringify(r));
}

// R1.9 — folder DELETE via the ⋯ menu drops its dirOrder entry (+ descendants).
{
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/sub/x.py': 'X=1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py',
    });
    window.project.dirOrder = ['sprites', 'sprites/sub'];
    window.renderTabs();
    window.confirm = () => true; window.alert = () => {};
  });
  await ensureExplorerOpen();
  await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    const menu = folder && folder.querySelector('.tab-menu');
    (menu || folder)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
    const menu = menus[menus.length - 1];
    const del = menu && [...menu.querySelectorAll('[role="menuitem"]')].find(el => /delete/i.test(el.textContent || ''));
    del?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ dirOrder: window.project.dirOrder, gone: !window.project.files['sprites/enemy.py'] }));
  if (r.gone && eq(r.dirOrder, []))
    ok('R1.9 folder delete via ⋯ menu drops dirOrder entries (sprites,sprites/sub removed)');
  else fail('R1.9 folder delete did not drop dirOrder: ' + JSON.stringify(r));
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-DND BATTERY FAILED' : 'EXPLORER-DND BATTERY OK');
