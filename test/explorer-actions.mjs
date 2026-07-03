// Explorer Slice B — POPUP ACTION-MENU + INLINE-RENAME battery (TDD RED).
//
// This is the contract for slice B (design: docs/specs/2026-06-24-explorer-action-menu-design.md
// §5 "Test plan"). Slice A is GREEN (assets unified into the tree; per-row ⋯ menus exist). TODAY
// the ⋯ button on every row (.tab-menu) routes to a window.prompt-driven menu:
//   - file rows  -> tabMenu(name)   -> prompt('File "…" — type: entry / rename / delete')
//   - folder rows-> folderMenu(path)-> prompt('Folder "…" — type: rename / delete')
//   - asset rows -> assetMenu(name) -> prompt('Asset "…" — type: rename / delete / download')
// Slice B REPLACES all three typed prompts with a polished popup [role=menu] anchored to the ⋯,
// and replaces the typed rename prompt with an INLINE <input> edit in the row.
//
// Therefore EVERY assertion below MUST FAIL today, for the RIGHT reason: clicking ⋯ fires a
// window.prompt (no [role=menu] element ever appears; no inline <input> ever appears; the action
// word is typed into a prompt). A DIFFERENT subagent implements the popup + inline rename to turn
// this battery GREEN. THESE TESTS ARE THE CONTRACT.
//
// Run (SEQUENTIALLY — concurrent Pyodide/CDN loads flake):
//   pkill -f "http.server 8923" ; python3 -m http.server 8923 --directory <repo>   # one terminal
//   node test/explorer-actions.mjs http://localhost:8923/
//
// Style mirrors explorer-tree.mjs / subdirs.mjs: ok()/fail() + process.exitCode, synthetic events,
// SHORT per-assertion click timeouts so a still-missing seam fails its OWN assertion fast (RED
// phase) instead of hanging the whole battery.
//
// --- "no prompt for the ACTION" detector -------------------------------------------------------
// We stub window.prompt to RECORD every call (message + default) and return null, then assert that
// SELECTING a menu action recorded NO prompt. Renaming uses an inline <input>, not a prompt, so the
// rename path must also record no prompt. (design §5: "action selection invokes no prompt()".)
//
// --- popup-menu open seam ----------------------------------------------------------------------
// The contract is behavioural, not pixel: after a real click on a row's `.tab-menu` (⋯) button, an
// element with [role=menu] is in the DOM and visible, carrying menuitems whose visible text matches
// the row type's action set. We find menuitems by [role=menuitem] (preferred) OR, defensively, any
// clickable descendant whose text matches — so the impl is free on exact markup as long as the
// a11y role + the labels are present (design §2 requires role=menu / menuitem).
//
// --- download detector -------------------------------------------------------------------------
// downloadItem() synthesizes an <a download> and calls .click() (index.html downloadBlob). We spy on
// HTMLAnchorElement.prototype.click and record any anchor that carried a `download` attribute.

import { launch, acceptModal, modalOpen } from './_harness.mjs';
import { PNG_B64 } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const info = (m) => console.log('info -', m);
// Resilient click: a short timeout so a missing seam fails its OWN assertion fast (RED phase).
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

// State-aware "ensure the Explorer rail view is open" (mirrors explorer-tree.mjs / shell.mjs).
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

// Install the action-selection prompt recorder + the download spy + a setValue spy. Re-installed
// after every reload. window.__prompts records EVERY prompt message; window.__downloads records
// every <a download> .click(); window.__setValueCalls counts any sneaky editor.setValue (the
// engine landmine — inline rename must NOT setValue).
const arm = async () => {
  await page.evaluate(() => {
    window.__prompts = [];
    const realPrompt = window.prompt;
    window.prompt = (m, d) => { window.__prompts.push(String(m)); return null; };
    window.__realPrompt = realPrompt;

    window.__downloads = [];
    if (!HTMLAnchorElement.prototype.__dlWrapped) {
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (...a) {
        if (this.hasAttribute && this.hasAttribute('download'))
          window.__downloads.push(this.getAttribute('download') || this.download || '');
        return realClick.apply(this, a);
      };
      HTMLAnchorElement.prototype.__dlWrapped = true;
    }

    window.__setValueCalls = 0;
    const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
    if (cm && !cm.__svWrapped) {
      const orig = cm.setValue.bind(cm);
      cm.setValue = function (...a) { window.__setValueCalls++; return orig(...a); };
      cm.__svWrapped = true;
    }
  });
};

// Click a row's ⋯ (.tab-menu) the way a user would. Returns whether the button was found. A real
// .click() runs the impl's click delegate (tabsEl listener) — today that calls window.prompt.
const clickRowMenu = (rowSel) => page.evaluate((sel) => {
  const row = document.querySelector(sel);
  if (!row) return false;
  const btn = row.querySelector('.tab-menu');
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}, rowSel);

// Read the currently-open popup menu (if any) + its menuitem labels. A menu = [role=menu] that is
// visible (offsetParent != null). Items = [role=menuitem] (preferred) else clickable children.
const readMenu = () => page.evaluate(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
  const menu = menus[menus.length - 1] || null;   // the last-opened, visible menu
  if (!menu) return { open: false, items: [] };
  let items = [...menu.querySelectorAll('[role="menuitem"]')];
  if (!items.length) items = [...menu.querySelectorAll('button, li, a, [data-action]')];
  return { open: true, items: items.map(el => (el.textContent || '').trim()).filter(Boolean) };
});

// Activate a menu item by its visible label (real click). Returns whether it was found.
const activateMenuItem = (label) => page.evaluate((wanted) => {
  const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
  const menu = menus[menus.length - 1];
  if (!menu) return false;
  let items = [...menu.querySelectorAll('[role="menuitem"]')];
  if (!items.length) items = [...menu.querySelectorAll('button, li, a, [data-action]')];
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = items.find(el => norm(el.textContent).includes(norm(wanted)));
  if (!hit) return false;
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}, label);

// Type into the inline rename <input> if one is present in the given row, then press a key. Returns
// whether an inline <input> was found. We set .value + dispatch input, then dispatch a keydown for
// Enter/Escape (the impl listens for those to commit/cancel).
const inlineRename = (rowSel, newName, key) => page.evaluate(({ sel, val, k }) => {
  const row = document.querySelector(sel);
  if (!row) return { rowFound: false, inputFound: false };
  const input = row.querySelector('input[type="text"], input:not([type])');
  if (!input) return { rowFound: true, inputFound: false };
  input.focus();
  input.value = val;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (k) {
    const opts = { key: k, code: k === 'Enter' ? 'Enter' : 'Escape', bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  return { rowFound: true, inputFound: true };
}, { sel: rowSel, val: newName, k: key });

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));
await ensureExplorerOpen();
await arm();

// ================================================================================================
// 1. FILE ⋯ OPENS A [role=menu] WITH Rename / Set as start file / Delete — AND NO ACTION PROMPT.
//    Clicking a code row's ⋯ must open a popup menu (role=menu) carrying those three items. Today
//    the click fires window.prompt('File "…" — type: entry / rename / delete') instead — so no
//    [role=menu] appears AND a prompt IS recorded. Both halves fail RED. (design §1, §2, §5)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await ensureExplorerOpen();
await page.evaluate(() => { window.__prompts = []; });
const fileBtn = await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const fileMenu = await readMenu();
const filePrompts = await page.evaluate(() => window.__prompts.slice());
const fileItemsOk = fileMenu.open &&
  fileMenu.items.some(t => /rename/i.test(t)) &&
  fileMenu.items.some(t => /delete/i.test(t)) &&
  fileMenu.items.some(t => /download/i.test(t)) &&   // #7: Download moved into the ⋯ menu
  !fileMenu.items.some(t => /set as start/i.test(t));   // #9: fixed entry retired — no "Set as start"
if (fileBtn && fileItemsOk)
  ok('file ⋯ opens a [role=menu] with Rename / Delete / Download (no "Set as start" — #9): ' + JSON.stringify(fileMenu.items));
else fail('file ⋯ did not open a role=menu with the expected file items: ' + JSON.stringify({ fileBtn, fileMenu }));
if (fileBtn && filePrompts.length === 0)
  ok('  ...opening the file ⋯ menu fired NO window.prompt');
else fail('  file ⋯ fired a window.prompt (typed-prompt menu still live): ' + JSON.stringify(filePrompts));

// ================================================================================================
// 2. FOLDER ⋯ OPENS A [role=menu] WITH Rename / Delete / Download (no "Set as start"). (#7)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'sprites/enemy.py': 'E = 1\n' }, order: ['main.py', 'sprites/enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__prompts = [];
});
await ensureExplorerOpen();
const folderBtn = await clickRowMenu('#tabs .tab.folder[data-path="sprites"]');
await page.waitForTimeout(150);
const folderMenu = await readMenu();
const folderPrompts = await page.evaluate(() => window.__prompts.slice());
const folderItemsOk = folderMenu.open &&
  folderMenu.items.some(t => /rename/i.test(t)) &&
  folderMenu.items.some(t => /delete/i.test(t)) &&
  folderMenu.items.some(t => /download/i.test(t)) &&   // #7: folder Download now in the ⋯ menu
  !folderMenu.items.some(t => /set as start/i.test(t));
if (folderBtn && folderItemsOk)
  ok('folder ⋯ opens a [role=menu] with Rename / Delete / Download: ' + JSON.stringify(folderMenu.items));
else fail('folder ⋯ did not open a role=menu with Rename/Delete/Download: ' + JSON.stringify({ folderBtn, folderMenu }));

// #7: the standalone per-row .dl download button is GONE — download lives in the ⋯ menu now.
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n', 'sprites/enemy.py': 'E=1\n' }, order: ['main.py', 'sprites/enemy.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  const noDl = await page.evaluate(() => document.querySelectorAll('#tabs .tab .dl').length);
  if (noDl === 0) ok('#7: no standalone .dl button on any row (download is in the ⋯ menu)');
  else fail(`#7: standalone .dl button still present (count=${noDl})`);
}
if (folderBtn && folderPrompts.length === 0)
  ok('  ...opening the folder ⋯ menu fired NO window.prompt');
else fail('  folder ⋯ fired a window.prompt: ' + JSON.stringify(folderPrompts));

// ================================================================================================
// 3. ASSET ⋯ OPENS A [role=menu] WITH Rename / Delete / Download. (design §1)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await page.evaluate((b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.assetFS.add(new File([bytes], 'ship.png', { type: 'image/png' }));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(250);
await ensureExplorerOpen();
await page.evaluate(() => { window.__prompts = []; });
const assetBtn = await clickRowMenu('#tabs .tab.asset[data-name="ship.png"]');
await page.waitForTimeout(150);
const assetMenu = await readMenu();
const assetPrompts = await page.evaluate(() => window.__prompts.slice());
const assetItemsOk = assetMenu.open &&
  assetMenu.items.some(t => /rename/i.test(t)) &&
  assetMenu.items.some(t => /delete/i.test(t)) &&
  assetMenu.items.some(t => /download/i.test(t));
if (assetBtn && assetItemsOk)
  ok('asset ⋯ opens a [role=menu] with Rename / Delete / Download: ' + JSON.stringify(assetMenu.items));
else fail('asset ⋯ did not open a role=menu with Rename/Delete/Download: ' + JSON.stringify({ assetBtn, assetMenu }));
if (assetBtn && assetPrompts.length === 0)
  ok('  ...opening the asset ⋯ menu fired NO window.prompt');
else fail('  asset ⋯ fired a window.prompt: ' + JSON.stringify(assetPrompts));

// ================================================================================================
// 4. RENAME (FILE) IS INLINE — NO PROMPT, RE-KEYS project.files, EDITOR STAYS BOUND. Choosing
//    "Rename" from the file menu turns the row label into an <input>; typing a new name + Enter
//    re-keys project.files (old key gone, new present), keeps the SAME live CodeMirror Doc bound to
//    the editor (no setValue), and records NO window.prompt for the whole flow. (design §1, §3, §5)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'PAYLOAD = 42\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  // make enemy.py the ACTIVE doc so we can prove the editor stays bound to the same Doc after rename.
  window.project.setActive('enemy.py');
  window.renderTabs();
  window.__prompts = []; window.__setValueCalls = 0;
  window.__docBefore = (window.project.files['enemy.py'] === editor.getDoc());
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const fileRenameChosen = await activateMenuItem('Rename');
await page.waitForTimeout(150);
const fileInline = await inlineRename('#tabs .tab[data-name="enemy.py"]', 'boss.py', 'Enter');
await page.waitForTimeout(200);
const fileRenamed = await page.evaluate(() => ({
  newPresent: !!window.project.files['boss.py'],
  oldGone: !window.project.files['enemy.py'],
  orderHasNew: window.project.order.includes('boss.py') && !window.project.order.includes('enemy.py'),
  // editor still bound: the live Doc for the new key is the editor's current Doc, content preserved.
  editorBound: window.project.files['boss.py'] === editor.getDoc(),
  contentKept: editor.getDoc().getValue() === 'PAYLOAD = 42\n',
  docBefore: window.__docBefore,
  prompts: window.__prompts.slice(),
  setValueCalls: window.__setValueCalls,
}));
if (fileRenameChosen && fileInline.inputFound)
  ok('file Rename opens an INLINE <input> in the row (not a prompt)');
else fail('file Rename did not open an inline <input>: ' + JSON.stringify({ fileRenameChosen, fileInline }));
if (fileRenamed.newPresent && fileRenamed.oldGone && fileRenamed.orderHasNew)
  ok('  ...Enter re-keys project.files enemy.py -> boss.py (old gone, order updated)');
else fail('  inline file rename did not re-key project.files: ' + JSON.stringify(fileRenamed));
if (fileRenamed.docBefore && fileRenamed.editorBound && fileRenamed.contentKept && fileRenamed.setValueCalls === 0)
  ok('  ...editor stays bound to the SAME live Doc (no setValue; content preserved)');
else fail('  inline file rename broke editor binding / used setValue: ' + JSON.stringify(fileRenamed));
if (fileRenameChosen && fileRenamed.prompts.length === 0)
  ok('  ...the whole inline file-rename flow fired NO window.prompt');
else fail('  inline file rename fired a window.prompt: ' + JSON.stringify(fileRenamed.prompts));

// ================================================================================================
// 5. RENAME (FILE) — Esc CANCELS (no change). Open the menu, choose Rename, type a different name,
//    press Escape → project.files is unchanged. (design §3: "Esc cancels".)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
await activateMenuItem('Rename');
await page.waitForTimeout(150);
const escInline = await inlineRename('#tabs .tab[data-name="enemy.py"]', 'WRONG.py', 'Escape');
await page.waitForTimeout(200);
const escResult = await page.evaluate(() => ({
  stillEnemy: !!window.project.files['enemy.py'],
  noWrong: !window.project.files['WRONG.py'],
}));
if (escInline.inputFound && escResult.stillEnemy && escResult.noWrong)
  ok('file Rename + Esc cancels: enemy.py unchanged, no WRONG.py created');
else fail('file Rename Esc did not cancel cleanly: ' + JSON.stringify({ escInline, escResult }));

// ================================================================================================
// 6. RENAME (ASSET) IS INLINE — re-keys assetFS + MEMFS so pygame.image.load(new) works. Choose
//    Rename on an asset row, type a new path + Enter; assert assetFS.list re-keyed, MEMFS re-keyed,
//    NO prompt — then RUN code that pygame.image.load(new).blit()s and check the canvas pixel.
//    (design §1, §3, §5: "asset: assetFS re-keyed + pygame.image.load(new) still works".)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await page.evaluate((b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.assetFS.add(new File([bytes], 'ship.png', { type: 'image/png' }));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(250);
await ensureExplorerOpen();
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.asset[data-name="ship.png"]');
await page.waitForTimeout(150);
const assetRenameChosen = await activateMenuItem('Rename');
await page.waitForTimeout(150);
const assetInline = await inlineRename('#tabs .tab.asset[data-name="ship.png"]', 'hero.png', 'Enter');
await page.waitForTimeout(400);   // assetFS.rename is async (IndexedDB + MEMFS re-key)
const assetRenamed = await page.evaluate(() => ({
  newInList: window.assetFS.list.some(a => a.name === 'hero.png'),
  oldInList: window.assetFS.list.some(a => a.name === 'ship.png'),
  newInFs: (() => { try { return pyodide.FS.analyzePath('hero.png').exists; } catch { return false; } })(),
  oldInFs: (() => { try { return pyodide.FS.analyzePath('ship.png').exists; } catch { return false; } })(),
  prompts: window.__prompts.slice(),
}));
if (assetRenameChosen && assetInline.inputFound)
  ok('asset Rename opens an INLINE <input> in the row (not a prompt)');
else fail('asset Rename did not open an inline <input>: ' + JSON.stringify({ assetRenameChosen, assetInline }));
if (assetRenamed.newInList && !assetRenamed.oldInList && assetRenamed.newInFs && !assetRenamed.oldInFs)
  ok('  ...Enter re-keys assetFS + MEMFS: ship.png -> hero.png (old gone from both)');
else fail('  inline asset rename did not re-key assetFS/MEMFS: ' + JSON.stringify(assetRenamed));
if (assetRenameChosen && assetRenamed.prompts.length === 0)
  ok('  ...the inline asset-rename flow fired NO window.prompt');
else fail('  inline asset rename fired a window.prompt: ' + JSON.stringify(assetRenamed.prompts));
// the load-path invariant: pygame.image.load("hero.png") must work after the re-key.
await page.evaluate(() => { document.getElementById('console').textContent = ''; });
await page.evaluate(() => {
  window.project.load({ files: {
    'main.py': [
      'import pygame',
      'pygame.init()',
      'screen = pygame.display.set_mode((200, 150))',
      'screen.fill((0, 0, 0))',
      'sprite = pygame.image.load("hero.png").convert_alpha()',
      'screen.blit(sprite, (50, 50))',
      'pygame.display.flip()',
      // #15: the host blanks the canvas when a program ENDS — hold the frame and sample while
      // it is still running (we _stop() right after).
      'clock = pygame.time.Clock()',
      'while True:',
      '    clock.tick(30)',
    ].join('\n') + '\n',
  } });
});
await click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(150);   // let the first frame paint
const px = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  return Array.from(g.getImageData(58, 58, 1, 1).data);   // inside the blit; fixture is magenta
});
if (px[0] > 150 && px[1] < 100 && px[2] > 150)
  ok('  ...pygame.image.load("hero.png") blits after the inline rename (load-path invariant holds): ' + px);
else fail('  renamed asset does not load by its new path: ' + px);
await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });

// ================================================================================================
// 6b. RENAME (ASSET) TO A NAME ALREADY IN USE STAYS IN EDIT WITH A CALM INLINE HINT (regression).
//     assetFS.rename is ASYNC and validates AFTER the call, resolving false on a collision (without
//     a renderTabs repaint). The inline-rename commit must AWAIT that result: on false it must keep
//     the <input> live (still in the DOM, editable) and show a .rename-hint — NOT optimistically
//     close + leave the row stuck with an inert editable input (the review's medium finding). Then
//     Esc must still revert cleanly. (design §3: "invalid name -> stay in edit with a calm hint".)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
// two assets: we'll try to rename keep.png ONTO taken.png (a collision via existsAnywhere).
await page.evaluate((b64) => {
  const mk = (n) => { const bin = atob(b64); const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return window.assetFS.add(new File([b], n, { type: 'image/png' })); };
  return mk('keep.png').then(() => mk('taken.png'));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(300);
await ensureExplorerOpen();
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.asset[data-name="keep.png"]');
await page.waitForTimeout(150);
const collideChosen = await activateMenuItem('Rename');
await page.waitForTimeout(150);
const collideInline = await inlineRename('#tabs .tab.asset[data-name="keep.png"]', 'taken.png', 'Enter');
await page.waitForTimeout(400);   // assetFS.rename is async — wait for it to RESOLVE false
const collideState = await page.evaluate(() => {
  const row = document.querySelector('#tabs .tab.asset[data-name="keep.png"]');
  const input = row ? row.querySelector('input[type="text"], input.rename-input') : null;
  return {
    rowStillKeep: !!row,                                   // keep.png was NOT re-keyed (no data loss)
    keepInList: window.assetFS.list.some(a => a.name === 'keep.png'),
    takenStillOne: window.assetFS.list.filter(a => a.name === 'taken.png').length === 1,
    inputStillLive: !!input && input.isConnected,          // the edit field is STILL in the DOM
    inputEnabled: !!input && !input.disabled,              // and editable again (not frozen/inert)
    hintShown: !!(row && row.querySelector('.rename-hint')),
    prompts: window.__prompts.slice(),
  };
});
if (collideChosen && collideInline.inputFound && collideState.rowStillKeep && collideState.keepInList && collideState.takenStillOne)
  ok('asset Rename onto an in-use name does NOT re-key (no data loss): keep.png + single taken.png survive');
else fail('asset collide-rename mangled the model: ' + JSON.stringify(collideState));
if (collideState.inputStillLive && collideState.inputEnabled && collideState.hintShown)
  ok('  ...the row STAYS in edit: <input> still live + editable + a .rename-hint is shown (not stuck inert)');
else fail('  collide-rename left the row stuck / no hint (review finding): ' + JSON.stringify(collideState));
if (collideChosen && collideState.prompts.length === 0)
  ok('  ...the rejected async rename fired NO window.prompt');
else fail('  collide-rename fired a window.prompt: ' + JSON.stringify(collideState.prompts));
// Esc from the still-live input must revert the row cleanly back to a normal label.
await inlineRename('#tabs .tab.asset[data-name="keep.png"]', '', 'Escape');
await page.waitForTimeout(150);
const collideReverted = await page.evaluate(() => {
  const row = document.querySelector('#tabs .tab.asset[data-name="keep.png"]');
  return { row: !!row, noInput: !!row && !row.querySelector('input'), hasLabel: !!(row && row.querySelector('.tab-name')) };
});
if (collideReverted.row && collideReverted.noInput && collideReverted.hasLabel)
  ok('  ...Esc reverts the still-live input back to a normal label (no leftover edit state)');
else fail('  Esc did not revert the kept-open input cleanly: ' + JSON.stringify(collideReverted));

// ================================================================================================
// 7. DELETE (FILE) VIA MENU IS MODAL-GATED. Choose Delete from the file menu; the aesthetic confirm
//    modal (#13, replaced native confirm()) gates it — accept it → the file is removed.
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const fileDeleteChosen = await activateMenuItem('Delete');
await page.waitForTimeout(120);
const fileDeleteGated = await modalOpen(page);   // #13: the modal IS the gate (no native confirm)
await acceptModal(page);
await page.waitForTimeout(150);
const fileDeleted = await page.evaluate(() => ({
  gone: !window.project.files['enemy.py'] && !window.project.order.includes('enemy.py'),
  mainKept: !!window.project.files['main.py'],
  prompts: window.__prompts.slice(),
}));
if (fileDeleteChosen && fileDeleteGated && fileDeleted.gone && fileDeleted.mainKept)
  ok('file Delete via menu is modal-gated and removes enemy.py (main.py kept)');
else fail('file Delete via menu did not modal-gate + remove: ' + JSON.stringify({ fileDeleteChosen, fileDeleteGated, fileDeleted }));
if (fileDeleteChosen && fileDeleted.prompts.length === 0)
  ok('  ...file Delete fired NO window.prompt for the action');
else fail('  file Delete fired a window.prompt: ' + JSON.stringify(fileDeleted.prompts));

// ================================================================================================
// 8. DELETE (ASSET) VIA MENU IS CONFIRM-GATED. Same, for an asset row -> assetFS.remove. (design §1)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await page.evaluate((b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.assetFS.add(new File([bytes], 'doomed.png', { type: 'image/png' }));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(250);
await page.evaluate(() => { window.__prompts = []; });
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab.asset[data-name="doomed.png"]');
await page.waitForTimeout(150);
const assetDeleteChosen = await activateMenuItem('Delete');
await page.waitForTimeout(120);
const assetDeleteGated = await modalOpen(page);   // #13: the modal IS the gate
await acceptModal(page);
await page.waitForTimeout(400);   // assetFS.remove is async
const assetDeleted = await page.evaluate(() => ({
  goneFromList: !window.assetFS.list.some(a => a.name === 'doomed.png'),
  goneFromFs: (() => { try { return !pyodide.FS.analyzePath('doomed.png').exists; } catch { return true; } })(),
  goneFromDom: !document.querySelector('#tabs .tab.asset[data-name="doomed.png"]'),
  prompts: window.__prompts.slice(),
}));
if (assetDeleteChosen && assetDeleteGated && assetDeleted.goneFromList && assetDeleted.goneFromFs)
  ok('asset Delete via menu is modal-gated and removes doomed.png from assetFS + MEMFS');
else fail('asset Delete via menu did not modal-gate + remove: ' + JSON.stringify({ assetDeleteChosen, assetDeleteGated, assetDeleted }));
if (assetDeleteChosen && assetDeleted.prompts.length === 0)
  ok('  ...asset Delete fired NO window.prompt for the action');
else fail('  asset Delete fired a window.prompt: ' + JSON.stringify(assetDeleted.prompts));

// ================================================================================================
// 9. #9: "Set as start file" is RETIRED — the open file is what runs, so the file ⋯ menu must NOT
//    offer it. (was: set-as-start sets project.entry)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const startMenu = await readMenu();
await page.evaluate(() => window.__closePopMenu && window.__closePopMenu(false));
if (startMenu.open && !startMenu.items.some(t => /set as start/i.test(t)))
  ok('#9: the file ⋯ menu no longer offers "Set as start file" (fixed entry retired): ' + JSON.stringify(startMenu.items));
else fail('#9: "Set as start" still present in the file menu: ' + JSON.stringify(startMenu.items));

// ================================================================================================
// 10. DOWNLOAD (ASSET) VIA MENU TRIGGERS A DOWNLOAD EVENT. Choose Download from the asset menu;
//     downloadItem() synthesizes an <a download> + .click() (spied via __downloads). (design §1)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await page.evaluate((b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.assetFS.add(new File([bytes], 'grab.png', { type: 'image/png' }));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(250);
await page.evaluate(() => { window.__downloads = []; window.__prompts = []; });
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab.asset[data-name="grab.png"]');
await page.waitForTimeout(150);
const dlChosen = await activateMenuItem('Download');
await page.waitForTimeout(300);
const dlResult = await page.evaluate(() => ({ downloads: window.__downloads.slice(), prompts: window.__prompts.slice() }));
if (dlChosen && dlResult.downloads.some(n => /grab\.png$/.test(n)))
  ok('Download (asset) via menu triggers a download event for grab.png: ' + JSON.stringify(dlResult.downloads));
else fail('Download (asset) did not trigger a download <a> click: ' + JSON.stringify({ dlChosen, dlResult }));
if (dlChosen && dlResult.prompts.length === 0)
  ok('  ...Download fired NO window.prompt');
else fail('  Download fired a window.prompt: ' + JSON.stringify(dlResult.prompts));

// ================================================================================================
// 11. KEYBOARD: Esc CLOSES THE MENU. Open the file menu, press Escape on the document → the
//     [role=menu] is gone/hidden. (design §2: "Dismiss on … Esc"; §5: "Esc closes the menu".)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const openedBeforeEsc = (await readMenu()).open;
await page.evaluate(() => {
  const opts = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
  document.dispatchEvent(new KeyboardEvent('keydown', opts));
});
await page.waitForTimeout(150);
const openAfterEsc = (await readMenu()).open;
if (openedBeforeEsc && !openAfterEsc)
  ok('keyboard: Esc closes the popup menu');
else fail('Esc did not close the menu (or it never opened): ' + JSON.stringify({ openedBeforeEsc, openAfterEsc }));

// ================================================================================================
// 12. SLICE-C FOLLOW-UP A — code+asset SAME-PATH selector disambiguation (design Slice C §3).
//     A LOW Slice-B review finding: the ⋯ click delegate reads `tab.dataset.name` and routes via
//     `tabMenu(name)`, which dispatches by a PATH LOOKUP (`if (!project.files[name]) assetMenu(name)`,
//     ~index.html:2780). So when a CODE file and an ASSET share the exact same path, clicking the
//     ASSET row's ⋯ still hits `project.files[name]` first and opens the FILE menu (Set as start /
//     no Download) — the WRONG row. Slice C must disambiguate by the CLICKED ROW'S TYPE
//     (`.tab.py` vs `.tab.asset`), not the path lookup.
//
//     We construct the clash directly via the model seams: project.files carries a code key "dup.png"
//     AND assetFS carries an asset "dup.png", so BOTH a .tab.py[data-name="dup.png"] and a
//     .tab.asset[data-name="dup.png"] render. Then we open EACH row's ⋯ and assert the menu targets
//     the right type: the asset row's menu has Download (asset-only); the code row's has Set as start
//     (code-only) and NO Download. RED today: the asset row opens the FILE menu (no Download).
// ================================================================================================
await page.evaluate(() => {
  window.project.load({
    files: { 'main.py': 'a = 1\n', 'dup.png': '# a CODE file that happens to be keyed dup.png\n' },
    order: ['main.py', 'dup.png'], entry: 'main.py', active: 'main.py',
  });
  window.renderTabs();
});
// add the colliding ASSET at the same path (low-level model seam; bypasses the upload de-dupe).
await page.evaluate((b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return window.assetFS.add(new File([bytes], 'dup.png', { type: 'image/png' }));
}, PNG_B64).catch(() => {});
await page.waitForTimeout(250);
await ensureExplorerOpen();
// sanity: both typed rows really do render for the same data-name (the clash exists in the DOM).
const clashRows = await page.evaluate(() => ({
  codeRow: !!document.querySelector('#tabs .tab.py[data-name="dup.png"]'),
  assetRow: !!document.querySelector('#tabs .tab.asset[data-name="dup.png"]'),
}));
if (clashRows.codeRow && clashRows.assetRow)
  ok('clash constructed: both .tab.py and .tab.asset render for data-name="dup.png"');
else fail('could not construct the code+asset clash rows: ' + JSON.stringify(clashRows));

// open the ASSET row's ⋯ — its menu must be the ASSET menu (Download present, no "Set as start").
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.asset[data-name="dup.png"]');
await page.waitForTimeout(150);
const assetClashMenu = await readMenu();
await page.evaluate(() => window.__closePopMenu && window.__closePopMenu(false));
await page.waitForTimeout(80);
const assetMenuRight = assetClashMenu.open &&
  assetClashMenu.items.some(t => /download/i.test(t)) &&
  assetClashMenu.items.some(t => /rename/i.test(t)) &&
  assetClashMenu.items.some(t => /delete/i.test(t));
if (assetMenuRight)
  ok('same-path: the ASSET row\'s ⋯ opens a menu (Rename/Delete/Download): ' + JSON.stringify(assetClashMenu.items));
else fail('same-path: ASSET row\'s ⋯ did not open the expected menu: ' + JSON.stringify(assetClashMenu));

// open the CODE row's ⋯. #9 retired "Set as start", so code & asset menus now carry the SAME items —
// the real code-vs-asset disambiguation is proven BEHAVIORALLY by the rename leg below (the inline
// input must land on the .tab.py row, not the same-path .tab.asset row).
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.py[data-name="dup.png"]');
await page.waitForTimeout(150);
const codeClashMenu = await readMenu();
await page.evaluate(() => window.__closePopMenu && window.__closePopMenu(false));
await page.waitForTimeout(80);
const codeMenuRight = codeClashMenu.open &&
  codeClashMenu.items.some(t => /rename/i.test(t)) &&
  codeClashMenu.items.some(t => /delete/i.test(t));
if (codeMenuRight)
  ok('same-path: the CODE row\'s ⋯ opens a menu (Rename/Delete/Download): ' + JSON.stringify(codeClashMenu.items));
else fail('same-path: CODE row\'s ⋯ did not open the expected menu: ' + JSON.stringify(codeClashMenu));

// Slice-C follow-up A (rename leg): choosing "Rename" from the CODE row's menu must attach the inline
// <input> to the .tab.py row — NOT the same-path .tab.asset row. fileRenameInline must qualify its
// selector to `.tab.py` (mirroring tabMenu's anchor); an unqualified `.tab[data-name]` selector would
// land the input on whichever typed row is first in DOM order (the asset row interleaves), corrupting
// the asset row instead of the code file. RED before the selector fix; GREEN after.
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.py[data-name="dup.png"]');
await page.waitForTimeout(150);
const codeRenameChosen = await activateMenuItem('Rename');
await page.waitForTimeout(150);
const renameTarget = await page.evaluate(() => ({
  pyRowHasInput: !!document.querySelector('#tabs .tab.py[data-name="dup.png"] input'),
  assetRowHasInput: !!document.querySelector('#tabs .tab.asset[data-name="dup.png"] input'),
}));
// cancel the inline edit so we leave the DOM clean for any later steps.
await inlineRename('#tabs .tab.py[data-name="dup.png"]', '', 'Escape').catch(() => {});
await inlineRename('#tabs .tab.asset[data-name="dup.png"]', '', 'Escape').catch(() => {});
await page.waitForTimeout(80);
if (codeRenameChosen && renameTarget.pyRowHasInput && !renameTarget.assetRowHasInput)
  ok('same-path: CODE "Rename" attaches the inline <input> to the .tab.py row (not the asset row)');
else fail('same-path: CODE "Rename" did NOT land on the .tab.py row (selector not qualified to code): ' + JSON.stringify({ codeRenameChosen, renameTarget }));

// #9-review: mirror the rename leg for the ASSET side. Since #7/#9 made the code & asset menus carry
// IDENTICAL items, item-set checks can't disambiguate — so prove the ASSET row's ⋯ Rename lands on
// the .tab.asset row, NOT the same-path .tab.py row (restores the lost asset-direction routing coverage).
await page.evaluate(() => { window.__prompts = []; });
await clickRowMenu('#tabs .tab.asset[data-name="dup.png"]');
await page.waitForTimeout(150);
const clashAssetRenameChosen = await activateMenuItem('Rename');
await page.waitForTimeout(150);
const clashAssetRenameTarget = await page.evaluate(() => ({
  assetRowHasInput: !!document.querySelector('#tabs .tab.asset[data-name="dup.png"] input'),
  pyRowHasInput: !!document.querySelector('#tabs .tab.py[data-name="dup.png"] input'),
}));
await inlineRename('#tabs .tab.asset[data-name="dup.png"]', '', 'Escape').catch(() => {});
await inlineRename('#tabs .tab.py[data-name="dup.png"]', '', 'Escape').catch(() => {});
await page.waitForTimeout(80);
if (clashAssetRenameChosen && clashAssetRenameTarget.assetRowHasInput && !clashAssetRenameTarget.pyRowHasInput)
  ok('same-path: ASSET "Rename" attaches the inline <input> to the .tab.asset row (not the code row)');
else fail('same-path: ASSET "Rename" did NOT land on the .tab.asset row: ' + JSON.stringify({ clashAssetRenameChosen, clashAssetRenameTarget }));

// ================================================================================================
// 13. SLICE-C FOLLOW-UP B — popup-menu Tab focus-trap (a11y) (design Slice C §3).
//     A LOW Slice-B review finding: pressing Tab while the [role=menu] is open must NOT leak focus to
//     an unrelated page control — it must either keep focus WITHIN the menu items OR close the menu and
//     return focus to the ⋯ anchor. We put a known, focusable page control (#runBtn) in a state where a
//     real Tab COULD land on it, open the menu, dispatch a Tab keydown, and assert document.activeElement
//     is NOT that unrelated control: it is a menuitem, the menu container, or the ⋯ anchor.
//     RED rationale + the synthetic-event subtlety: a dispatched KeyboardEvent does NOT trigger the
//     browser's NATIVE Tab focus move, so we can't observe the real focus leak by reading
//     document.activeElement after a synthetic Tab. The observable contract-level seam is that the
//     menu's Tab handler must SUPPRESS the browser's default Tab (e.preventDefault()) — either while
//     trapping focus among the items or while closing + returning focus to the ⋯. Today the handler
//     (~index.html:2636) is `else if (e.key === "Tab") { closePopMenu(); }` — it closes but does NOT
//     call preventDefault(), so the native Tab still runs AFTER the handler and advances focus off the
//     anchor to the next tabbable page control. We assert the dispatched Tab event was
//     defaultPrevented (RED today) AND that focus did not land on an unrelated page control.
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const trapBefore = await page.evaluate(() => {
  const menu = [...document.querySelectorAll('[role="menu"]')].find(m => m.offsetParent !== null);
  return {
    open: !!menu,
    // focus starts inside the menu (openPopMenu focuses the first item).
    activeInMenu: !!menu && (menu.contains(document.activeElement) || document.activeElement === menu),
  };
});
// Dispatch a CANCELABLE Tab keydown on the focused element (bubbles to the menu's handler). Read back
// whether the handler called preventDefault — the synthetic signal for "the native Tab is suppressed".
const trapAfter = await page.evaluate(() => {
  const el = document.activeElement || document.body;
  const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  const menu = document.querySelector('[role="menu"]');
  const menuOpen = !!menu && menu.classList.contains('open') && menu.offsetParent !== null;
  const ae = document.activeElement;
  const inMenu = !!menu && (menu.contains(ae) || ae === menu);
  const onAnchor = !!ae && ae.classList && ae.classList.contains('tab-menu');
  // an UNRELATED page control = a real focusable element that is neither a menuitem/menu nor the ⋯.
  const leakedToPage = !inMenu && !onAnchor && !!ae &&
    /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  const leakedToCM = !inMenu && !onAnchor && !!ae && !!(ae.closest && ae.closest('.CodeMirror'));
  return {
    defaultPrevented: ev.defaultPrevented,   // RED today: handler closes but doesn't preventDefault
    menuOpen, activeTag: ae ? ae.tagName : null,
    activeClass: ae && ae.className ? String(ae.className) : '',
    inMenu, onAnchor, leakedToPage, leakedToCM,
  };
});
if (trapBefore.open && trapBefore.activeInMenu)
  ok('focus-trap setup: menu opened with focus inside it');
else fail('focus-trap setup failed (menu/focus not in menu): ' + JSON.stringify(trapBefore));
// The load-bearing contract: Tab inside the open menu must SUPPRESS the browser default (so the native
// Tab can't leak focus to the page) — preventDefault() while trapping among items OR while closing +
// returning to the ⋯. RED today: the handler closes without preventDefault.
if (trapAfter.defaultPrevented)
  ok('Tab inside the open menu suppresses the browser default (preventDefault — native Tab can\'t leak to the page): ' + JSON.stringify(trapAfter));
else fail('Tab inside the open menu does NOT preventDefault — the native Tab leaks focus to the next page control: ' + JSON.stringify(trapAfter));
// Secondary guard: synthetic focus must not have landed on an unrelated page control / the editor.
if (!trapAfter.leakedToPage && !trapAfter.leakedToCM && (trapAfter.inMenu || trapAfter.onAnchor))
  ok('  ...and focus stays within the menu or returns to the ⋯ (not an unrelated page control): ' + JSON.stringify({ inMenu: trapAfter.inMenu, onAnchor: trapAfter.onAnchor }));
else fail('  Tab landed focus on an unrelated page control / the editor: ' + JSON.stringify(trapAfter));

// ================================================================================================
// Request #8 (refinement v2): NEW file/folder creation uses an inline editable row, NOT a browser
// prompt(). Clicking the header New-file button shows an inline <input>; type + Enter creates;
// Esc cancels. window.prompt must NOT fire.
{
  await ensureExplorerOpen();
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
    window.__prompts = [];
  });
  await page.click('#newFileBtn');
  await page.waitForTimeout(60);
  const created = await page.evaluate(() => !!document.querySelector('#tabs .tab.creating input'));
  if (created) ok('#8: New-file button opens an inline create input (no browser prompt dialog)');
  else fail('#8: New-file button did not show an inline create input');
  await inlineRename('#tabs .tab.creating', 'spawned', 'Enter');
  await page.waitForTimeout(60);
  const madeFile = await page.evaluate(() =>
    Object.keys(window.project.files).some(k => k.split('/').pop() === 'spawned.py'));
  if (madeFile) ok('#8: typing + Enter creates the file (spawned.py) via the model');
  else fail('#8: inline create did not add spawned.py to the project');
  const noPrompt = await page.evaluate(() => (window.__prompts || []).length);
  if (noPrompt === 0) ok('#8: NO window.prompt invoked during inline create');
  else fail(`#8: window.prompt was called ${noPrompt}x (ugly browser dialog still in use)`);
  await page.evaluate(() => { window.__prompts = []; });
  await page.click('#newFileBtn');
  await page.waitForTimeout(60);
  await inlineRename('#tabs .tab.creating', 'temp', 'Escape');
  await page.waitForTimeout(60);
  const cancelled = await page.evaluate(() =>
    !Object.keys(window.project.files).some(k => k.split('/').pop() === 'temp.py')
    && !document.querySelector('#tabs .tab.creating'));
  if (cancelled) ok('#8: Esc cancels inline create (no file added, input removed)');
  else fail('#8: Esc did not cleanly cancel inline create');
}

// ================================================================================================
// 14. RENAME (FILE) — ext-appending NO-OP must cancel cleanly (regression guard: stuck input).
//     Renaming "main.py" to "main" (no extension): the commit handler appends ".py", making the
//     target equal the current name. That no-op must behave exactly like the raw===base no-op —
//     input removed, name span restored, file untouched — NOT leave a dead .rename-input in the
//     row (the pre-fix bug: the handler returned true without repainting, the shared inline-edit
//     core marked the edit done, and Escape/blur were inert forever after).
// ================================================================================================
{
  await ensureExplorerOpen();
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  const menuOpened = await clickRowMenu('#tabs .tab.py[data-name="main.py"]');
  await page.waitForTimeout(150);
  const chose = await activateMenuItem('Rename');
  await page.waitForTimeout(60);
  const typed = await inlineRename('#tabs .tab.py[data-name="main.py"]', 'main', 'Enter');
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    inputLeft: !!document.querySelector('#tabs .rename-input'),
    renamingLeft: !!document.querySelector('#tabs .tab.renaming'),
    nameSpanBack: !!document.querySelector('#tabs .tab.py[data-name="main.py"] .tab-name'),
    filePresent: !!window.project.files['main.py'],
  }));
  if (menuOpened && chose && typed.inputFound && !after.inputLeft && !after.renamingLeft && after.nameSpanBack && after.filePresent)
    ok('#14: ext-appending no-op rename (main.py -> "main") cancels cleanly — no stuck input');
  else fail('#14: ext-appending no-op rename left a stuck input / broke the row: ' + JSON.stringify({ menuOpened, chose, typed, after }));
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) info('JS console errors observed (informational during RED): ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-ACTIONS BATTERY FAILED (expected RED pre-Slice-B)' : 'EXPLORER-ACTIONS BATTERY OK');
