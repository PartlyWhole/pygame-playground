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

import { launch } from './_harness.mjs';
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
  fileMenu.items.some(t => /set as start/i.test(t)) &&
  fileMenu.items.some(t => /delete/i.test(t));
if (fileBtn && fileItemsOk)
  ok('file ⋯ opens a [role=menu] with Rename / Set as start file / Delete: ' + JSON.stringify(fileMenu.items));
else fail('file ⋯ did not open a role=menu with the 3 file items: ' + JSON.stringify({ fileBtn, fileMenu }));
if (fileBtn && filePrompts.length === 0)
  ok('  ...opening the file ⋯ menu fired NO window.prompt');
else fail('  file ⋯ fired a window.prompt (typed-prompt menu still live): ' + JSON.stringify(filePrompts));

// ================================================================================================
// 2. FOLDER ⋯ OPENS A [role=menu] WITH Rename / Delete (no "Set as start", no Download). (design §1)
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
  !folderMenu.items.some(t => /set as start|download/i.test(t));
if (folderBtn && folderItemsOk)
  ok('folder ⋯ opens a [role=menu] with exactly Rename / Delete: ' + JSON.stringify(folderMenu.items));
else fail('folder ⋯ did not open a role=menu with just Rename/Delete: ' + JSON.stringify({ folderBtn, folderMenu }));
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
    ].join('\n') + '\n',
  } });
});
await click('#runBtn');
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const px = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  return Array.from(g.getImageData(58, 58, 1, 1).data);   // inside the blit; fixture is magenta
});
if (px[0] > 150 && px[1] < 100 && px[2] > 150)
  ok('  ...pygame.image.load("hero.png") blits after the inline rename (load-path invariant holds): ' + px);
else fail('  renamed asset does not load by its new path: ' + px);
await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });

// ================================================================================================
// 7. DELETE (FILE) VIA MENU IS CONFIRM-GATED. Choose Delete from the file menu; with confirm()
//    accepting, the file is removed. (design §1: "Delete keeps the existing confirm()".)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; };
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const fileDeleteChosen = await activateMenuItem('Delete');
await page.waitForTimeout(200);
const fileDeleted = await page.evaluate(() => ({
  gone: !window.project.files['enemy.py'] && !window.project.order.includes('enemy.py'),
  mainKept: !!window.project.files['main.py'],
  confirms: window.__confirms,
  prompts: window.__prompts.slice(),
}));
if (fileDeleteChosen && fileDeleted.gone && fileDeleted.mainKept && fileDeleted.confirms >= 1)
  ok('file Delete via menu is confirm-gated and removes enemy.py (main.py kept)');
else fail('file Delete via menu did not confirm-gate + remove: ' + JSON.stringify({ fileDeleteChosen, fileDeleted }));
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
await page.evaluate(() => {
  window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; };
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab.asset[data-name="doomed.png"]');
await page.waitForTimeout(150);
const assetDeleteChosen = await activateMenuItem('Delete');
await page.waitForTimeout(400);   // assetFS.remove is async
const assetDeleted = await page.evaluate(() => ({
  goneFromList: !window.assetFS.list.some(a => a.name === 'doomed.png'),
  goneFromFs: (() => { try { return !pyodide.FS.analyzePath('doomed.png').exists; } catch { return true; } })(),
  goneFromDom: !document.querySelector('#tabs .tab.asset[data-name="doomed.png"]'),
  confirms: window.__confirms,
  prompts: window.__prompts.slice(),
}));
if (assetDeleteChosen && assetDeleted.goneFromList && assetDeleted.goneFromFs && assetDeleted.confirms >= 1)
  ok('asset Delete via menu is confirm-gated and removes doomed.png from assetFS + MEMFS');
else fail('asset Delete via menu did not confirm-gate + remove: ' + JSON.stringify({ assetDeleteChosen, assetDeleted }));
if (assetDeleteChosen && assetDeleted.prompts.length === 0)
  ok('  ...asset Delete fired NO window.prompt for the action');
else fail('  asset Delete fired a window.prompt: ' + JSON.stringify(assetDeleted.prompts));

// ================================================================================================
// 9. SET-AS-START (FILE) VIA MENU SETS project.entry — IMMEDIATELY, NO PROMPT. (design §1)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n', 'enemy.py': 'E = 1\n' }, order: ['main.py', 'enemy.py'], entry: 'main.py', active: 'main.py' });
  window.renderTabs();
  window.__prompts = [];
});
await ensureExplorerOpen();
await clickRowMenu('#tabs .tab[data-name="enemy.py"]');
await page.waitForTimeout(150);
const startChosen = await activateMenuItem('Set as start');
await page.waitForTimeout(200);
const startSet = await page.evaluate(() => ({ entry: window.project.entry, prompts: window.__prompts.slice() }));
if (startChosen && startSet.entry === 'enemy.py')
  ok('Set as start file via menu sets project.entry = enemy.py');
else fail('Set as start file did not set project.entry: ' + JSON.stringify({ startChosen, startSet }));
if (startChosen && startSet.prompts.length === 0)
  ok('  ...Set as start fired NO window.prompt');
else fail('  Set as start fired a window.prompt: ' + JSON.stringify(startSet.prompts));

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
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) info('JS console errors observed (informational during RED): ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-ACTIONS BATTERY FAILED (expected RED pre-Slice-B)' : 'EXPLORER-ACTIONS BATTERY OK');
