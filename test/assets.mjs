// Headless verification of the asset (sprite/sound) feature. Mirrors verify.mjs.
//
// SLICE A — UNIFY ASSETS INTO THE TREE (design: docs/specs/2026-06-24-explorer-unify-assets-design.md).
// This battery is the RED contract for retiring #assetPanel: assets become first-class .tab.asset
// rows in the unified #tabs tree, with rename / delete / download (via the ⋯ .tab-menu) and
// drag-move into folders — exactly like code rows. A move/rename that breaks a pygame.image.load()
// reference is ALLOWED but surfaces a calm, non-destructive notice (warn-on-move); the app NEVER
// rewrites student code.
//
// Today (pre-Slice-A) the new checks MUST FAIL for the RIGHT reasons:
//   - #assetPanel / #assetChip / #apStorage still exist in the DOM (the removal hasn't happened).
//   - .tab.asset rows carry no ⋯ .tab-menu button (renderTabs @2312 omits it for assets).
//   - window.assetFS has no .rename / .move (assetFS @1782 only has add/remove/clearAll).
//   - tabMenu(name) early-returns for asset rows (@2551 `if (!project.files[name]) return;`) so the
//     menu does nothing for an asset.
//   - the #tabs drop handler (@2431) only calls project.move (code-only); an asset drag does not
//     re-key the asset (project.files[asset] is false).
//   - there is no warn-on-move notice surface.
// The implementer exposes: assetFS.rename(oldName,newName)->bool, assetFS.move(name,destFolder)->bool,
// a ⋯ menu on .tab.asset rows (Rename/Delete/Download), and a user-visible warn-on-move notice.
//
// Run:
//   python3 -m http.server 8923            # repo root
//   node test/assets.mjs http://localhost:8923/
//
// Style mirrors shell.mjs / explorer-tree.mjs: ok()/fail() + process.exitCode.
import { launch } from './_harness.mjs';
import { PNG_B64, WAV_B64, MP3_B64, buf } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// State-aware "ensure the Explorer rail view is open" (mirrors explorer-tree.mjs). The rail click
// is a clean toggle, so an unconditional click would COLLAPSE an already-open Explorer.
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
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
await ensureExplorerOpen();

// ================================================================================================
// (a) AN UPLOADED ASSET RENDERS AS A .tab.asset[data-name] ROW IN THE TREE — AND #assetPanel IS
//     GONE FROM THE DOM. The legacy popover/panel (#assetPanel / #assetChip / #apStorage) is
//     retired; each asset renders ONCE, in the unified #tabs tree. (design §1, §4, §7a)
// ================================================================================================
await page.setInputFiles('#assetInput',
  { name: 'dot.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForTimeout(250);
await ensureExplorerOpen();
const treeRow = await page.evaluate(() => {
  const row = document.querySelector('#tabs .tab.asset[data-name="dot.png"]');
  return {
    rowInTree: !!row,
    assetPanelGone: document.getElementById('assetPanel') === null,
    assetChipGone: document.getElementById('assetChip') === null,
    apStorageGone: document.getElementById('apStorage') === null,
  };
});
if (treeRow.rowInTree) ok('uploaded asset renders as .tab.asset[data-name="dot.png"] in the tree');
else fail('no .tab.asset[data-name="dot.png"] row in #tabs');
if (treeRow.assetPanelGone) ok('#assetPanel is gone from the DOM (panel retired)');
else fail('#assetPanel still exists in the DOM (not retired)');
if (treeRow.assetChipGone && treeRow.apStorageGone)
  ok('legacy #assetChip / #apStorage are gone from the DOM');
else fail('legacy panel seams remain: ' + JSON.stringify(treeRow));

const inFs = await page.evaluate(() => pyodide.FS.analyzePath('dot.png').exists);
if (inFs) ok('uploaded file written to MEMFS');
else fail('uploaded file not in MEMFS');

// ================================================================================================
// (b) THE ASSET ROW EXPOSES A ⋯ .tab-menu BUTTON (action affordance, mirrors code rows @2324).
//     The menu = Rename · Delete · Download (no "set as entry"). (design §6, §7b)
// ================================================================================================
const hasMenu = await page.evaluate(() =>
  !!document.querySelector('#tabs .tab.asset[data-name="dot.png"] .tab-menu'));
if (hasMenu) ok('asset row exposes a ⋯ .tab-menu action button');
else fail('asset row has no ⋯ .tab-menu (renderTabs omits it for assets)');

// ================================================================================================
// CHECK (kept) 2: Persistence — reload, asset rehydrates from IndexedDB into MEMFS and re-renders
//     as a tree row. (formerly assets.mjs check 3; #assetChip count replaced by the tree row)
// ================================================================================================
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('did not reboot'));
await page.waitForTimeout(250);
await ensureExplorerOpen();
const rowReload = await page.evaluate(() => !!document.querySelector('#tabs .tab.asset[data-name="dot.png"]'));
const fsReload = await page.evaluate(() => pyodide.FS.analyzePath('dot.png').exists);
if (rowReload && fsReload) ok('asset persisted across reload (IndexedDB -> MEMFS, tree row back)');
else fail(`asset did not persist (treeRow=${rowReload} memfs=${fsReload})`);

// ================================================================================================
// CHECK (kept) 3: Real user path — load the uploaded sprite, blit it, check the canvas pixel.
//     (formerly assets.mjs check 4 — unchanged)
// ================================================================================================
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue([
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((200, 150))',
    'screen.fill((0, 0, 0))',
    'sprite = pygame.image.load("dot.png").convert_alpha()',
    'screen.blit(sprite, (50, 50))',
    'pygame.display.flip()',
  ].join('\n'));
});
await page.click('#runBtn');
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const spritePx = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  return Array.from(g.getImageData(58, 58, 1, 1).data);  // inside the blit, magenta
});
if (spritePx[0] > 150 && spritePx[1] < 100 && spritePx[2] > 150) ok('uploaded sprite blits to canvas: ' + spritePx);
else fail('sprite pixel wrong: ' + spritePx);

// ================================================================================================
// CHECK (kept) 4: Sound API path — upload WAV, play it, assert no exception + AudioContext exists.
//     (formerly assets.mjs check 5 — unchanged)
// ================================================================================================
await page.setInputFiles('#assetInput',
  { name: 'beep.wav', mimeType: 'audio/wav', buffer: buf(WAV_B64) });
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue([
    'import pygame',
    'pygame.init()',
    'pygame.display.set_mode((120, 90))',
    'pygame.mixer.init()',
    's = pygame.mixer.Sound("beep.wav")',
    'ch = s.play()',
    'print("PLAY_OK", ch is not None, round(s.get_length(), 2))',
  ].join('\n'));
});
await page.click('#runBtn');   // a real user gesture; resumeAudio() resumes SDL's context (created on mixer.init)
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const soundConsole = await page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
if (/PLAY_OK True/.test(soundConsole)) ok('Sound.play() returned a channel, no exception');
else fail('sound play path failed: ' + soundConsole.slice(0, 200));
const acCount = await page.evaluate(() => (window.__audioContexts || []).length);
if (acCount > 0) ok('AudioContext captured: ' + acCount);
else fail('no AudioContext captured (shim not installed?)');
const acState = await page.evaluate(() => (window.__audioContexts || []).map(c => c.state));
console.log('info - AudioContext states after Run gesture: ' + acState.join(','));

// ================================================================================================
// CHECK (kept) 5: No hard cap — a >10 MB file is accepted, AND the Explorer surfaces a real
//     browser-storage metric (used vs available). The metric is no longer in #apStorage (removed);
//     it lives in the always-on Explorer tree (e.g. the tree footer — design §4 storage metric).
//     (formerly assets.mjs check 6 — behavior kept; the #apStorage seam dropped)
// ================================================================================================
await page.setInputFiles('#assetInput',
  { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024) });
await page.waitForTimeout(300);
const bigInFs = await page.evaluate(() => pyodide.FS.analyzePath('big.png').exists);
if (bigInFs) ok('large (11 MB) file accepted — no hard cap');
else fail('large file rejected — cap not removed');
await ensureExplorerOpen();
await page.waitForFunction(() => {
  const side = document.getElementById('side');
  return side && /storage/i.test(side.textContent) && /\d/.test(side.textContent);
}, null, { timeout: 5000 }).catch(() => {});
const storageText = await page.evaluate(() => {
  // The metric moved out of #apStorage into the always-on Explorer tree (footer). Accept any
  // explorer-side element whose text names "storage" with a number.
  const side = document.getElementById('side');
  if (!side) return '';
  const m = side.textContent.match(/[^\n]*storage[^\n]*/i);
  return m ? m[0] : '';
});
if (/storage/i.test(storageText) && /\d/.test(storageText)) ok('Explorer shows browser-storage metric (tree-side): ' + storageText.trim());
else fail('no storage metric in the Explorer tree (got ' + JSON.stringify(storageText) + ')');

// ================================================================================================
// CHECK (kept) 6: MP3 upload shows a warning flag on its asset row (now the .tab.asset tree row,
//     not the retired panel row). (formerly assets.mjs check 7 — re-keyed to the tree row)
// ================================================================================================
await page.setInputFiles('#assetInput',
  { name: 'tune.mp3', mimeType: 'audio/mpeg', buffer: buf(MP3_B64) });
await page.waitForTimeout(200);
await ensureExplorerOpen();
const warnShown = await page.evaluate(() =>
  !!document.querySelector('#tabs .tab.asset[data-name="tune.mp3"] .asset-warn'));
if (warnShown) ok('MP3 shows unsupported-format warning on its .tab.asset tree row');
else fail('no warning badge on the MP3 .tab.asset row');

// ================================================================================================
// (c) RENAME RE-KEYS — window.assetFS.rename(old, new) atomically re-keys the asset: MEMFS has the
//     NEW path and NOT the old, and pygame.image.load(new) works. (design §2, §3, §7c)
// ================================================================================================
{
  // upload a fresh sprite, then rename it through the new model seam.
  await page.setInputFiles('#assetInput',
    { name: 'hero.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  const renamed = await page.evaluate(async () => {
    if (typeof window.assetFS.rename !== 'function') return { noSeam: true };
    const ret = await window.assetFS.rename('hero.png', 'player.png');
    return {
      ret,
      newInFs: pyodide.FS.analyzePath('player.png').exists,
      oldInFs: pyodide.FS.analyzePath('hero.png').exists,
      newInList: window.assetFS.list.some(a => a.name === 'player.png'),
      oldInList: window.assetFS.list.some(a => a.name === 'hero.png'),
      newRow: !!document.querySelector('#tabs .tab.asset[data-name="player.png"]'),
      oldRow: !!document.querySelector('#tabs .tab.asset[data-name="hero.png"]'),
    };
  });
  if (!renamed.noSeam && renamed.ret && renamed.newInFs && !renamed.oldInFs && renamed.newInList && !renamed.oldInList)
    ok('assetFS.rename re-keys: MEMFS + assetFS.list have NEW path, old path gone');
  else fail('assetFS.rename did not re-key cleanly: ' + JSON.stringify(renamed));
  if (!renamed.noSeam && renamed.newRow && !renamed.oldRow)
    ok('  ...tree row re-keyed: .tab.asset[data-name="player.png"] present, old row gone');
  else fail('  rename did not re-key the tree row: ' + JSON.stringify(renamed));

  // the renamed asset must still be loadable at its NEW path (the load-path invariant holds).
  await page.evaluate(() => {
    document.querySelector('.CodeMirror').CodeMirror.setValue([
      'import pygame',
      'pygame.init()',
      'screen = pygame.display.set_mode((200, 150))',
      'screen.fill((0, 0, 0))',
      'sprite = pygame.image.load("player.png").convert_alpha()',
      'screen.blit(sprite, (50, 50))',
      'pygame.display.flip()',
      'print("LOAD_OK")',
    ].join('\n'));
  });
  await page.click('#runBtn');
  await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
    null, { timeout: 20_000 }).catch(() => {});
  const loadConsole = await page.evaluate(() =>
    Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
  const loadStatus = await page.evaluate(() => document.getElementById('status')?.textContent || '');
  if (/LOAD_OK/.test(loadConsole) && !/error/i.test(loadStatus))
    ok('  ...pygame.image.load("player.png") works after rename (load-path invariant holds)');
  else fail('  load at the new path failed after rename: ' + loadConsole.slice(-200));
}

// ================================================================================================
// (d) DELETE unlinks MEMFS + removes from assetFS.list (via the asset row ⋯ menu's Delete, which
//     wires to assetFS.remove). (design §6, §7d)
// ================================================================================================
{
  await page.setInputFiles('#assetInput',
    { name: 'trash.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  await ensureExplorerOpen();
  // Drive Delete through the asset row's ⋯ popup menu (Slice B: open the [role=menu], activate the
  // "Delete" menuitem; the confirm() gate guards it).
  await page.evaluate(() => {
    window.confirm = () => true;
    window.alert = () => {};
    const row = document.querySelector('#tabs .tab.asset[data-name="trash.png"]');
    if (!row) return;
    const menu = row.querySelector('.tab-menu');
    (menu || row).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
    const menu = menus[menus.length - 1];
    if (!menu) return;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const del = items.find(el => /delete/i.test(el.textContent || ''));
    if (del) del.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  const deleted = await page.evaluate(() => ({
    goneFs: !pyodide.FS.analyzePath('trash.png').exists,
    goneList: !window.assetFS.list.some(a => a.name === 'trash.png'),
    goneRow: !document.querySelector('#tabs .tab.asset[data-name="trash.png"]'),
  }));
  if (deleted.goneFs && deleted.goneList && deleted.goneRow)
    ok('asset Delete (via ⋯ menu) unlinks MEMFS + removes from assetFS.list + drops the row');
  else fail('asset delete via ⋯ menu did not fully remove the asset: ' + JSON.stringify(deleted));
}

// ================================================================================================
// (e) DRAG-MOVE AN ASSET ROW INTO A FOLDER updates assetFS path + MEMFS path. Synthetic HTML5
//     dragstart/dragover/drop with a real DataTransfer (the explorer-tree.mjs protocol). The #tabs
//     drop handler must branch: an asset drag delegates to assetFS.move(dragged, dest). (design §5, §7e)
// ================================================================================================
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.addFolder('sounds');
    window.renderTabs();
  });
  await page.setInputFiles('#assetInput',
    { name: 'jump.wav', mimeType: 'audio/wav', buffer: buf(WAV_B64) });
  await page.waitForTimeout(200);
  await ensureExplorerOpen();
  const dnd = await page.evaluate(() => {
    const src = document.querySelector('#tabs .tab.asset[data-name="jump.wav"]');
    const dst = document.querySelector('#tabs .tab.folder[data-path="sounds"]');
    if (!src || !dst) return { srcFound: !!src, dstFound: !!dst };
    const dt = new DataTransfer();
    dt.setData('text/plain', src.getAttribute('data-name'));
    const mk = (type, target) => { const e = new DragEvent(type, { bubbles: true, cancelable: true }); try { Object.defineProperty(e, 'dataTransfer', { value: dt }); } catch {} return [e, target]; };
    src.dispatchEvent(mk('dragstart', src)[0]);
    dst.dispatchEvent(mk('dragover', dst)[0]);
    dst.dispatchEvent(mk('drop', dst)[0]);
    src.dispatchEvent(mk('dragend', src)[0]);
    return { srcFound: true, dstFound: true };
  });
  await page.waitForTimeout(300);
  const moved = await page.evaluate(() => ({
    newInList: window.assetFS.list.some(a => a.name === 'sounds/jump.wav'),
    oldInList: window.assetFS.list.some(a => a.name === 'jump.wav'),
    newInFs: pyodide.FS.analyzePath('sounds/jump.wav').exists,
    oldInFs: pyodide.FS.analyzePath('jump.wav').exists,
    nestedRow: !!document.querySelector('#tabs .tab.asset[data-name="sounds/jump.wav"]'),
  }));
  if (dnd.srcFound && dnd.dstFound && moved.newInList && !moved.oldInList && moved.newInFs && !moved.oldInFs)
    ok('drag-move asset into folder: assetFS + MEMFS re-keyed to sounds/jump.wav (old path gone)');
  else fail('drag-move-into-folder did not re-key the asset: ' + JSON.stringify({ dnd, moved }));
}

// ================================================================================================
// (f) WARN-ON-MOVE — when the old path is referenced in a code file, a user-visible notice is
//     surfaced AND the code text is UNCHANGED (the app NEVER rewrites student code). (design §5, §7f)
// ================================================================================================
{
  const codeText = [
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((200, 150))',
    'sprite = pygame.image.load("coin.png")',  // <- the reference that the move will break
  ].join('\n');
  await page.evaluate((code) => {
    window.project.load({ files: { 'main.py': code }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
    // Snapshot every place a notice could surface so we can read what's NEW after the move.
    window.__consoleBefore = Array.from(document.getElementById('console').children).length;
    window.__alertText = '';
    window.alert = (m) => { window.__alertText += String(m) + '\n'; };
  }, codeText);
  await page.setInputFiles('#assetInput',
    { name: 'coin.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  await ensureExplorerOpen();
  // rename the referenced asset (coin.png -> coins/coin.png) via the model seam.
  const warn = await page.evaluate(async () => {
    if (typeof window.assetFS.rename !== 'function') return { noSeam: true };
    await window.assetFS.rename('coin.png', 'gold.png');
    // The notice may surface as a new #console "sys" line, an alert, or an inline DOM note in the
    // Explorer/main panel. Accept any user-visible surface that names the OLD path + an update hint.
    const consoleLines = Array.from(document.getElementById('console').children).map(c => c.textContent);
    const newConsole = consoleLines.slice(window.__consoleBefore).join('\n');
    const sideText = document.getElementById('side')?.textContent || '';
    const stageText = document.getElementById('stage')?.textContent || '';
    const haystack = [newConsole, window.__alertText, sideText, stageText].join('\n');
    return {
      noticeNamesOld: /coin\.png/.test(haystack),
      noticeIsUpdateHint: /update|now at|references?|load path|not updated/i.test(haystack),
      // project.files[name] is a live CodeMirror.Doc; the student's text is read via project.text().
      codeUnchanged: window.project.text('main.py') === document.querySelector('.CodeMirror').CodeMirror.getValue(),
      codeStillReferencesOld: /pygame\.image\.load\("coin\.png"\)/.test(window.project.text('main.py') || ''),
    };
  });
  if (!warn.noSeam && warn.noticeNamesOld && warn.noticeIsUpdateHint)
    ok('warn-on-move surfaces a user-visible notice naming the broken reference (coin.png)');
  else fail('no warn-on-move notice surfaced for a referenced asset move: ' + JSON.stringify(warn));
  if (!warn.noSeam && warn.codeStillReferencesOld)
    ok('  ...student code is UNCHANGED — the old load path is left intact (no rewrite)');
  else fail('  warn-on-move altered the student code (must never rewrite): ' + JSON.stringify(warn));
}

// ================================================================================================
// (g) REGRESSION — DURABLE-WRITE-FAILURE DATA-SAFETY. The load-path invariant says a rename must
//     move IndexedDB + MEMFS + .list atomically. If the durable write (assetStore.put) FAILS
//     mid-rename, the destructive half (remove(old) / unlink(old) / mutate .list) MUST NOT run —
//     otherwise a storage-full move SILENTLY DESTROYS the only copy of the asset. Stub the store so
//     put() fails, then rename; assert the OLD asset survives intact and the NEW key was NOT created.
// ================================================================================================
{
  await page.setInputFiles('#assetInput',
    { name: 'safe.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  await ensureExplorerOpen();
  const r = await page.evaluate(async () => {
    if (typeof window.assetFS.rename !== 'function' || !window.assetStore) return { noSeam: true };
    const realPut = window.assetStore.put;
    window.assetStore.put = async () => false;   // simulate a storage-full / unavailable durable write
    let ret;
    try { ret = await window.assetFS.rename('safe.png', 'moved.png'); }
    finally { window.assetStore.put = realPut; }
    return {
      ret,
      // OLD asset must survive every plane (the destructive half must not have run).
      oldInList: window.assetFS.list.some(a => a.name === 'safe.png'),
      oldInFs: pyodide.FS.analyzePath('safe.png').exists,
      oldRow: !!document.querySelector('#tabs .tab.asset[data-name="safe.png"]'),
      // NEW key must NOT exist anywhere (no half-written destination).
      newInList: window.assetFS.list.some(a => a.name === 'moved.png'),
      newInFs: pyodide.FS.analyzePath('moved.png').exists,
      newRow: !!document.querySelector('#tabs .tab.asset[data-name="moved.png"]'),
    };
  });
  if (!r.noSeam && r.ret === false && r.oldInList && r.oldInFs && r.oldRow && !r.newInList && !r.newInFs && !r.newRow)
    ok('rename aborts (returns false) on durable-write failure — OLD asset survives, NO data loss');
  else fail('rename on storage-full LOST or half-moved the asset: ' + JSON.stringify(r));
}

// ================================================================================================
// (h) REGRESSION — QUOTE-AWARE WARN-ON-MOVE. The warn-on-move scan must only flag a line where the
//     OLD path is a real load-path literal (quote-prefixed), not any bare substring. Renaming
//     "s.png" must NOT warn about a line that loads "boss.png" (false positive); but a line that
//     loads "s.png" MUST warn (true positive).
// ================================================================================================
{
  // false-positive case: code references boss.png, we rename s.png — must NOT warn.
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'import pygame\nimg = pygame.image.load("boss.png")\n' },
      order: ['main.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
    window.__cb = Array.from(document.getElementById('console').children).length;
    window.__alertText = '';
    window.alert = (m) => { window.__alertText += String(m) + '\n'; };
  });
  await page.setInputFiles('#assetInput',
    { name: 's.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  const fp = await page.evaluate(async () => {
    if (typeof window.assetFS.rename !== 'function') return { noSeam: true };
    await window.assetFS.rename('s.png', 'x.png');
    const newConsole = Array.from(document.getElementById('console').children).map(c => c.textContent).slice(window.__cb).join('\n');
    const haystack = [newConsole, window.__alertText].join('\n');
    return { warned: /s\.png|x\.png|update|now at|references?/i.test(haystack) };
  });
  if (!fp.noSeam && !fp.warned)
    ok('warn-on-move is quote-aware: renaming s.png does NOT false-warn on a boss.png load line');
  else fail('warn-on-move FALSE-POSITIVED on a boss.png line when renaming s.png: ' + JSON.stringify(fp));

  // true-positive case: code references s2.png as a real load literal — MUST warn. (Distinct names
  // from the false-positive case above so the destination is free in the unified namespace.)
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'import pygame\nimg = pygame.image.load("s2.png")\n' },
      order: ['main.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
    window.__cb = Array.from(document.getElementById('console').children).length;
    window.__alertText = '';
    window.alert = (m) => { window.__alertText += String(m) + '\n'; };
  });
  await page.setInputFiles('#assetInput',
    { name: 's2.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
  await page.waitForTimeout(200);
  const tp = await page.evaluate(async () => {
    if (typeof window.assetFS.rename !== 'function') return { noSeam: true };
    await window.assetFS.rename('s2.png', 'x2.png');
    const newConsole = Array.from(document.getElementById('console').children).map(c => c.textContent).slice(window.__cb).join('\n');
    const haystack = [newConsole, window.__alertText].join('\n');
    return { warned: /s2\.png/.test(haystack) && /update|now at|references?/i.test(haystack) };
  });
  if (!tp.noSeam && tp.warned)
    ok('warn-on-move still fires for a real load("s.png") reference (true positive intact)');
  else fail('warn-on-move did NOT fire for a real s.png load reference: ' + JSON.stringify(tp));
}

// Final: no unexpected JS errors throughout. A console error fails the battery (restored gate).
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors during run: ' + realErrors.join(' | '));

await browser.close();
console.log(process.exitCode ? 'ASSETS VERIFY FAILED' : 'ASSETS VERIFY OK');
