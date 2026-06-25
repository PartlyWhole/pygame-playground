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

import { launch, acceptModal } from './_harness.mjs';
import { WAV_B64 } from './fixtures.mjs';

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

// REAL page.mouse pointer gesture: press on the src row's center, cross the ~5px drag threshold, travel
// to the target and settle at the given Y-fraction of its row, release. This fires real
// pointerdown/move/up that the #11 controller handles end-to-end — unlike native HTML5 DnD, which
// fires ZERO events from a headless mouse. yFrac<0.25 = drop in the target's top (before); ~0.5 = the
// folder's middle band (move-into); >0.75 = bottom (after).
const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, height: r.height };
}, sel);
async function pointerDrag(srcSel, dstSel, yFrac = 0.5) {
  const s = await rectOf(srcSel), d = await rectOf(dstSel);
  if (!s || !d) return { srcFound: !!s, dstFound: !!d };
  const ty = d.top + d.height * yFrac;
  await page.mouse.move(s.x, s.cy);
  await page.mouse.down();
  await page.mouse.move(s.x, s.cy + 8, { steps: 2 });   // cross the threshold → drag begins
  await page.mouse.move(d.x, ty, { steps: 5 });          // travel to the target Y
  await page.mouse.move(d.x, ty, { steps: 2 });          // settle (final computeDrop)
  await page.mouse.up();
  return { srcFound: true, dstFound: true };
}

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
  await acceptModal(page);   // #13: confirm the delete in the aesthetic modal
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ dirOrder: window.project.dirOrder, gone: !window.project.files['sprites/enemy.py'] }));
  if (r.gone && eq(r.dirOrder, []))
    ok('R1.9 folder delete via ⋯ menu drops dirOrder entries (sprites,sprites/sub removed)');
  else fail('R1.9 folder delete did not drop dirOrder: ' + JSON.stringify(r));
}

// ================================================================================================
// R2 — POINTER DRAG CONTROLLER. Real page.mouse gestures drive the new controller end-to-end and
// assert the MODEL + RENDERED ORDER + persistence (serialize). No synthetic DragEvent anywhere.
// ================================================================================================

// R2.1 — reorder a FILE within a dir (drag b above a → b,a,c). Model + rendered rows + serialize.
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': '# a\n', 'b.py': '# b\n', 'c.py': '# c\n' }, order: ['a.py', 'b.py', 'c.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.py[data-name="b.py"]', '#tabs .tab.py[data-name="a.py"]', 0.2);
  await page.waitForTimeout(120);
  const order = await page.evaluate(() => window.project.order.slice());
  const rows = await fileOrder();
  const ser = await page.evaluate(() => window.project.serialize().order);
  if (g.srcFound && g.dstFound && eq(order, ['b.py', 'a.py', 'c.py']) && eq(rows, ['b.py', 'a.py', 'c.py']) && eq(ser, ['b.py', 'a.py', 'c.py']))
    ok('R2.1 pointer drag reorders a file within a dir (b above a → model + rendered rows + serialize = b,a,c)');
  else fail('R2.1 file reorder gesture failed: ' + JSON.stringify({ g, order, rows, ser }));
}

// R2.2 — reorder a FOLDER among siblings (the NEW capability). Drag zebra above apple → dirOrder +
// rendered folder order + serialize all = zebra,apple.
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('apple'); window.project.addFolder('zebra');
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.folder[data-path="zebra"]', '#tabs .tab.folder[data-path="apple"]', 0.2);
  await page.waitForTimeout(120);
  const order = await folderOrder();
  const dirOrder = await page.evaluate(() => window.project.dirOrder.slice());
  const ser = await page.evaluate(() => window.project.serialize().dirOrder);
  if (g.srcFound && eq(order, ['zebra', 'apple']) && eq(dirOrder, ['zebra', 'apple']) && eq(ser, ['zebra', 'apple']))
    ok('R2.2 pointer drag reorders a FOLDER among siblings (zebra above apple → dirOrder + rendered + serialize)');
  else fail('R2.2 folder reorder gesture failed: ' + JSON.stringify({ g, order, dirOrder, ser }));
}

// R2.3 — move a FILE into a folder (drop on the folder's middle band → project.move re-keys).
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n', 'enemy.py': 'E=1\n', 'sprites/util.py': 'U=1\n' }, order: ['main.py', 'enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.py[data-name="enemy.py"]', '#tabs .tab.folder[data-path="sprites"]', 0.5);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ into: !!window.project.files['sprites/enemy.py'], rootGone: !window.project.files['enemy.py'] }));
  if (g.srcFound && r.into && r.rootGone) ok('R2.3 pointer drag moves a file INTO a folder (enemy.py → sprites/enemy.py, root key gone)');
  else fail('R2.3 move-file-into-folder gesture failed: ' + JSON.stringify({ g, r }));
}

// R2.4 — move a FOLDER into a folder (4a), and the descendant guard (4b) via real gestures.
{
  // 4a
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n', 'box/x.py': 'X=1\n', 'bin/y.py': 'Y=1\n' }, order: ['main.py', 'box/x.py', 'bin/y.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.folder[data-path="box"]', '#tabs .tab.folder[data-path="bin"]', 0.5);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ moved: !!window.project.files['bin/box/x.py'], oldGone: !window.project.files['box/x.py'] }));
  if (g.srcFound && r.moved && r.oldGone) ok('R2.4a pointer drag moves a FOLDER into a folder (box → bin/box, descendant re-keyed)');
  else fail('R2.4a folder move-into gesture failed: ' + JSON.stringify({ g, r }));

  // 4b descendant guard
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n', 'sprites/sub/x.py': 'X=1\n' }, order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  await pointerDrag('#tabs .tab.folder[data-path="sprites"]', '#tabs .tab.folder[data-path="sprites/sub"]', 0.5);
  await page.waitForTimeout(150);
  const r2 = await page.evaluate(() => ({
    enemyUnchanged: !!window.project.files['sprites/enemy.py'],
    subUnchanged: !!window.project.files['sprites/sub/x.py'],
    noDouble: !Object.keys(window.project.files).some(k => k.startsWith('sprites/sub/sprites')),
  }));
  if (r2.enemyUnchanged && r2.subUnchanged && r2.noDouble) ok('R2.4b descendant guard: dragging sprites onto sprites/sub is BLOCKED (paths unchanged)');
  else fail('R2.4b descendant guard failed: ' + JSON.stringify(r2));
}

// R2.5 — move an ASSET into a folder (assetFS.move re-keys IndexedDB + MEMFS + list).
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('audio');
    window.renderTabs();
  });
  await page.evaluate((b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return window.assetFS.add(new File([bytes], 'beep.wav', { type: 'audio/wav' }));
  }, WAV_B64).catch(() => {});
  await page.waitForTimeout(250);
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.asset[data-name="beep.wav"]', '#tabs .tab.folder[data-path="audio"]', 0.5);
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    newInList: window.assetFS.list.some(a => a.name === 'audio/beep.wav'),
    oldInList: window.assetFS.list.some(a => a.name === 'beep.wav'),
    newInFs: pyodide.FS.analyzePath('audio/beep.wav').exists,
  }));
  if (g.srcFound && r.newInList && !r.oldInList && r.newInFs) ok('R2.5 pointer drag moves an ASSET into a folder (beep.wav → audio/beep.wav via assetFS.move)');
  else fail('R2.5 asset move-into gesture failed: ' + JSON.stringify({ g, r }));
}

// R2.6 — threshold / click coexistence: a click (down+up, NO movement) still selects/opens the file;
// the ⋯ menu button never starts a drag.
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': '# a\n', 'b.py': '# b\n', 'c.py': '# c\n' }, order: ['a.py', 'b.py', 'c.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const rb = await rectOf('#tabs .tab.py[data-name="b.py"]');
  await page.mouse.move(rb.x, rb.cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(120);
  const c = await page.evaluate(() => ({ active: window.project.active, order: window.project.order.slice() }));
  if (c.active === 'b.py' && eq(c.order, ['a.py', 'b.py', 'c.py']))
    ok('R2.6 a click (no movement) still selects/opens the file (active=b.py, order unchanged)');
  else fail('R2.6 click coexistence failed: ' + JSON.stringify(c));
  // press + drag FROM the ⋯ button must NOT reorder (the menu/inputs never start a drag).
  const rm = await rectOf('#tabs .tab.py[data-name="a.py"] .tab-menu');
  await page.mouse.move(rm.x, rm.cy); await page.mouse.down();
  await page.mouse.move(rm.x, rm.cy + 40, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterMenu = await page.evaluate(() => window.project.order.slice());
  if (eq(afterMenu, ['a.py', 'b.py', 'c.py']))
    ok('R2.6 the ⋯ menu button never starts a drag (order unchanged after a press-drag on it)');
  else fail('R2.6 menu-button drag suppression failed: ' + JSON.stringify(afterMenu));
  await page.keyboard.press('Escape').catch(() => {});
}

// R2.7 — abort: Escape mid-drag leaves the model unchanged and clears the indicator/highlight.
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': '# a\n', 'b.py': '# b\n', 'c.py': '# c\n' }, order: ['a.py', 'b.py', 'c.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const s = await rectOf('#tabs .tab.py[data-name="c.py"]');
  const d = await rectOf('#tabs .tab.py[data-name="a.py"]');
  await page.mouse.move(s.x, s.cy); await page.mouse.down();
  await page.mouse.move(s.x, s.cy + 8, { steps: 2 });       // begin drag
  await page.mouse.move(d.x, d.top + 2, { steps: 4 });        // hover above a.py
  const midDrag = await page.evaluate(() => !!document.querySelector('#tabs .drop-line') || !!document.querySelector('#tabs .drag-ghost'));
  await page.keyboard.press('Escape');                        // ABORT
  await page.mouse.up();
  await page.waitForTimeout(120);
  const order = await page.evaluate(() => window.project.order.slice());
  const cleared = await page.evaluate(() => !document.querySelector('#tabs .drop-line') && !document.querySelector('#tabs .drop-into'));
  if (midDrag && eq(order, ['a.py', 'b.py', 'c.py']) && cleared)
    ok('R2.7 Escape mid-drag ABORTS: a drag was in progress, model unchanged, indicator/highlight cleared');
  else fail('R2.7 abort failed: ' + JSON.stringify({ midDrag, order, cleared }));
}

// ================================================================================================
// MO (request #12) — drag a file OUT of a folder. A file's folder membership IS its path key, so
// move-out must RE-KEY the path (project.move), not just reorder project.order. The fix: a file
// reorder ADOPTS the target row's directory (drop a nested file on a root item → moves OUT to root;
// drop on a file in folder X → moves INTO X). Real page.mouse gestures. (Known v1 edge, not tested:
// with ZERO root files there's no root item to drop onto — drop a nested file on a root item instead.)
// ================================================================================================

// MO.1 — drag a NESTED file onto a ROOT file → moves OUT to root (path re-keyed).
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n' }, order: ['main.py', 'sprites/enemy.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.py[data-name="sprites/enemy.py"]', '#tabs .tab.py[data-name="main.py"]', 0.8);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    atRoot: !!window.project.files['enemy.py'],
    nestedGone: !window.project.files['sprites/enemy.py'],
    rows: [...document.querySelectorAll('#tabs .tab.py')].map(n => n.dataset.name),
  }));
  if (g.srcFound && r.atRoot && r.nestedGone && r.rows.includes('enemy.py'))
    ok('MO.1 drag a nested file onto a root file moves it OUT to root (sprites/enemy.py → enemy.py)');
  else fail('MO.1 move-out-onto-root-file failed: ' + JSON.stringify(r));
}

// MO.2 — adopt-target-dir the OTHER way: drag a ROOT file onto a file inside folder pkg → moves INTO pkg.
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'main.py': 'a=1\n', 'loose.py': 'L=1\n', 'pkg/mod.py': 'M=1\n' }, order: ['main.py', 'loose.py', 'pkg/mod.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.py[data-name="loose.py"]', '#tabs .tab.py[data-name="pkg/mod.py"]', 0.8);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ intoPkg: !!window.project.files['pkg/loose.py'], rootGone: !window.project.files['loose.py'] }));
  if (g.srcFound && r.intoPkg && r.rootGone)
    ok('MO.2 drag a root file onto a file inside pkg moves it INTO pkg (loose.py → pkg/loose.py)');
  else fail('MO.2 move-into-via-file-target failed: ' + JSON.stringify(r));
}

// MO.3 — regression: a SAME-dir reorder must stay a pure reorder (no path change).
{
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': 'a\n', 'b.py': 'b\n', 'pkg/x.py': 'x\n' }, order: ['a.py', 'b.py', 'pkg/x.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const g = await pointerDrag('#tabs .tab.py[data-name="b.py"]', '#tabs .tab.py[data-name="a.py"]', 0.2);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    bStillRoot: !!window.project.files['b.py'] && !window.project.files['pkg/b.py'],
    rootOrder: window.project.order.filter(p => !p.startsWith('pkg/')),
  }));
  if (g.srcFound && r.bStillRoot && eq(r.rootOrder, ['b.py', 'a.py']))
    ok('MO.3 regression: same-dir reorder stays a pure reorder (b above a, no path change)');
  else fail('MO.3 same-dir reorder regression: ' + JSON.stringify(r));
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-DND BATTERY FAILED' : 'EXPLORER-DND BATTERY OK');
