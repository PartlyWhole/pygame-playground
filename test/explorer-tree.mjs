// S2b TREE-UI battery (TDD RED) — the nested folder tree in the Explorer.
//
// This is the UI half of slice S2 (design: docs/specs/2026-06-23-subdirs-packages-design.md,
// §5 the nested tree UI + §0.1 resolutions + §7.1 the tree subset of the assertion list). The
// S2a ENGINE is already GREEN (test/subdirs.mjs): window.project has real nested path keys,
// move/addFolder/emptyDirs, and assetFS does nested writes. S2b turns S1's FLAT renderTabs
// (#tabs as a flat list of .tab[data-name] rows) into a real nested folder tree.
//
// Today (pre-S2b) MANY of these MUST FAIL, for the RIGHT reasons:
//   - renderTabs (index.html:2035) emits a FLAT list: no .tab.folder[data-path] rows, no carets,
//     no indentation, no nesting.
//   - #newFolderBtn is `hidden` (index.html:330, CSS :41) and unwired — no folder-create path.
//   - there is no folder rename/delete UI, no drag-and-drop move-into-folder, no descendant guard
//     in the UI.
//   - assets render as FLAT .tab.asset[data-name] rows, never nested inside a folder node.
// A different subagent implements the tree (renderTabs + click delegate + #newFolderBtn + DnD +
// folder menu) to make this battery GREEN. THESE TESTS ARE THE CONTRACT (design §7.1 tree subset:
// #1, the UI side of #8/#9, #10, the render side of #15, assets-in-tree, first-paint laziness).
//
// Run:
//   python3 -m http.server 8923            # repo root, another terminal
//   node test/explorer-tree.mjs http://localhost:8923/
//
// Style mirrors shell.mjs / subdirs.mjs / multifile.mjs: ok()/fail() + process.exitCode, SHORT
// per-assertion timeouts so a still-missing seam fails its OWN assertion fast instead of hanging
// the whole battery.
//
// --- DnD approach (#11): REAL pointer gestures, not synthetic DragEvent ---------------------------
// The drag-and-drop here was rewritten (#11) from native HTML5 DnD to a pointer-events controller
// precisely because native DnD fires ZERO events from a headless mouse (so synthetic DragEvent tests
// gave false confidence — they passed while the real browser was broken, the #6 regression). These
// drag assertions now drive page.mouse.move/down/up (the `pointerDrag` helper below), which fire the
// real pointerdown/move/up the controller listens to, and assert the load-bearing RESULT (project
// model re-keyed/reordered; descendant move BLOCKED). The dedicated, fuller pointer-DnD coverage
// (file/folder reorder, threshold, abort) lives in test/explorer-dnd.mjs.

import { launch } from './_harness.mjs';
import { WAV_B64 } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const info = (m) => console.log('info -', m);
// Resilient click: a short timeout so a missing seam fails its OWN assertion fast (RED phase)
// instead of hanging 30s and aborting the whole battery.
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// #11: REAL pointer gesture (press src center, cross the ~5px threshold, settle on the target at the
// given Y-fraction, release). Fires real pointerdown/move/up that the controller handles. yFrac ~0.5 =
// a folder's middle band (move-into); <0.25 = top (reorder-before); >0.75 = bottom (reorder-after).
const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, cy: r.top + r.height / 2, top: r.top, height: r.height };
}, sel);
async function pointerDrag(srcSel, dstSel, yFrac = 0.5) {
  const s = await rectOf(srcSel), d = await rectOf(dstSel);
  if (!s || !d) return { srcFound: !!s, dstFound: !!d };
  const ty = d.top + d.height * yFrac;
  await page.mouse.move(s.x, s.cy); await page.mouse.down();
  await page.mouse.move(s.x, s.cy + 8, { steps: 2 });
  await page.mouse.move(d.x, ty, { steps: 5 });
  await page.mouse.move(d.x, ty, { steps: 2 });
  await page.mouse.up();
  return { srcFound: true, dstFound: true };
}

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

// State-aware "ensure the Explorer rail view is open" (mirrors shell.mjs). The rail click is a
// clean toggle, so an unconditional click would COLLAPSE an already-open Explorer. Click only when
// the side panel is collapsed OR Explorer is not the active view.
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

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));
await ensureExplorerOpen();

// ================================================================================================
// 1. NESTED TREE RENDERS. After project.add('sprites/enemy.py', …) + renderTabs(), #tabs shows a
//    FOLDER row .tab.folder[data-path="sprites"] (with a caret) CONTAINING a nested file row
//    .tab[data-name="sprites/enemy.py"] (indented deeper than a root-level file). Folders carry
//    data-path; files/assets carry data-name (NEVER data-name on a folder) — this is what keeps
//    multifile.mjs's `.tab[data-name]` count correct. (design §7.1 #1, §5.2)
// ================================================================================================
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
  window.project.add('sprites/enemy.py', '# enemy\nclass Enemy:\n    pass\n');
  window.renderTabs();
});
const tree = await page.evaluate(() => {
  const t = document.getElementById('tabs');
  const folder = t.querySelector('.tab.folder[data-path="sprites"]');
  const file = t.querySelector('.tab[data-name="sprites/enemy.py"]');
  const root = t.querySelector('.tab[data-name="main.py"]');
  // a folder must NOT carry data-name (keeps the file-only data-name contract intact).
  const folderHasNoDataName = !!folder && !folder.hasAttribute('data-name');
  // a caret on the folder row (the open/close affordance).
  const caret = !!folder && !!folder.querySelector('.caret');
  // indentation: nested file is padded deeper than a root file (depth-based padding-left).
  const pad = (el) => el ? parseFloat(getComputedStyle(el).paddingLeft || '0') : null;
  const fileEl = file;
  const indented = !!fileEl && !!root && pad(fileEl) > pad(root);
  return {
    hasFolder: !!folder, hasNestedFile: !!file, hasRootFile: !!root,
    folderHasNoDataName, caret, indented,
  };
});
if (tree.hasFolder && tree.hasNestedFile && tree.folderHasNoDataName && tree.caret)
  ok('nested tree renders: .tab.folder[data-path="sprites"] (caret, no data-name) holds .tab[data-name="sprites/enemy.py"]');
else fail('nested tree wrong: ' + JSON.stringify(tree));
if (tree.indented) ok('  ...nested file row is indented deeper than a root-level file');
else fail('  nested file not indented past root file: ' + JSON.stringify(tree));

// ================================================================================================
// 2. CARET TOGGLE IS RENDER-ONLY. Clicking the folder caret/row hides/shows its children (a
//    folder open/closed state) with NO model mutation and NO setValue (CM lint stays unarmed).
//    (design §5.3 — folder toggle is a render-only flag; never touches the editor value)
// ================================================================================================
{
  // snapshot model + arm a setValue spy so any sneaky editor.setValue is caught.
  await page.evaluate(() => {
    window.__setValueCalls = 0;
    const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
    if (cm && !cm.__svWrapped) {
      const orig = cm.setValue.bind(cm);
      cm.setValue = function (...a) { window.__setValueCalls++; return orig(...a); };
      cm.__svWrapped = true;
    }
    window.__modelBefore = JSON.stringify({ order: window.project.order, files: Object.keys(window.project.files), entry: window.project.entry });
  });
  // child visible before toggle.
  const beforeVisible = await page.evaluate(() => {
    const f = document.querySelector('#tabs .tab[data-name="sprites/enemy.py"]');
    return !!f && f.offsetParent !== null;
  });
  // click the folder row (caret-bearing) to collapse it.
  await click('#tabs .tab.folder[data-path="sprites"]');
  await page.waitForTimeout(120);
  const afterCollapse = await page.evaluate(() => {
    const f = document.querySelector('#tabs .tab[data-name="sprites/enemy.py"]');
    return { hidden: !f || f.offsetParent === null };
  });
  // click again to re-open.
  await click('#tabs .tab.folder[data-path="sprites"]');
  await page.waitForTimeout(120);
  const afterReopen = await page.evaluate(() => {
    const f = document.querySelector('#tabs .tab[data-name="sprites/enemy.py"]');
    return { visible: !!f && f.offsetParent !== null };
  });
  const guard = await page.evaluate(() => ({
    modelUnchanged: window.__modelBefore === JSON.stringify({ order: window.project.order, files: Object.keys(window.project.files), entry: window.project.entry }),
    setValueCalls: window.__setValueCalls,
    lint: (() => { const cm = document.querySelector('.CodeMirror'); return cm ? cm.CodeMirror.getOption('lint') : 'no-cm'; })(),
  }));
  if (beforeVisible && afterCollapse.hidden && afterReopen.visible)
    ok('caret toggle hides then re-shows the folder children');
  else fail('caret toggle did not hide/show children: ' + JSON.stringify({ beforeVisible, afterCollapse, afterReopen }));
  if (guard.modelUnchanged && guard.setValueCalls === 0 && !guard.lint)
    ok('  ...toggle is render-only: no model mutation, no setValue, CM lint stays falsy');
  else fail('  caret toggle mutated state/armed lint: ' + JSON.stringify(guard));
}

// ================================================================================================
// 3. #newFolderBtn CREATES A FOLDER. It is currently `hidden` (S2b un-hides + wires it). Create an
//    identifier-safe folder `actors` → an empty folder row appears AND persists via
//    serialize().emptyDirs (engine supports addFolder/emptyDirs). A non-identifier name
//    (e.g. `my-folder`) is REJECTED. (design §5.4, §0.1 Q5 isFolderSegment)
// ================================================================================================
{
  // reset to a clean single-file project so the new folder is unambiguous.
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  // the button must be VISIBLE (un-hidden) for the user to reach it.
  const btnVisible = await page.evaluate(() => {
    const b = document.getElementById('newFolderBtn');
    return !!b && b.offsetParent !== null && !b.hidden && getComputedStyle(b).display !== 'none';
  });
  if (btnVisible) ok('#newFolderBtn is visible (un-hidden in S2b)');
  else fail('#newFolderBtn still hidden / not laid out');

  // #8: new folder is now an INLINE create row (no browser prompt). Helper: fill the inline input + key.
  const fillCreate = (val, key) => page.evaluate(({ v, k }) => {
    const input = document.querySelector('#tabs .tab.creating input');
    if (!input) return false;
    input.value = v; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
    return true;
  }, { v: val, k: key });
  // happy path: click the button to open the inline row, type an identifier-safe name + Enter.
  await click('#newFolderBtn');
  await page.waitForTimeout(80);
  const folderInputShown = await page.evaluate(() => !!document.querySelector('#tabs .tab.folder.creating input'));
  await fillCreate('actors', 'Enter');
  await page.waitForTimeout(120);
  const created = await page.evaluate(() => {
    const row = document.querySelector('#tabs .tab.folder[data-path="actors"]');
    const inEmptyDirs = window.project.serialize().emptyDirs.includes('actors');
    return { row: !!row, inEmptyDirs };
  });
  if (folderInputShown && created.row && created.inEmptyDirs)
    ok('#newFolderBtn opens an inline input that creates an empty `actors/` folder (persists via serialize().emptyDirs)');
  else fail('new folder not created/persisted: ' + JSON.stringify({ folderInputShown, ...created }));

  // rejection: a non-identifier folder name must be refused (no row, not in emptyDirs) AND surface a
  // CALM INLINE HINT (no browser alert — #8 replaced alert() with an in-row hint), staying in edit.
  // Gating on btnVisible + the hint (not just the absent row) prevents a vacuous pass.
  await click('#newFolderBtn');
  await page.waitForTimeout(80);
  await fillCreate('my-folder', 'Enter');
  await page.waitForTimeout(120);
  const rejected = await page.evaluate(() => ({
    noRow: !document.querySelector('#tabs .tab.folder[data-path="my-folder"]'),
    notInEmptyDirs: !window.project.serialize().emptyDirs.includes('my-folder'),
    hinted: !!document.querySelector('#tabs .tab.creating input.invalid') || !!document.querySelector('#tabs .tab.creating .rename-hint'),
  }));
  if (btnVisible && rejected.noRow && rejected.notInEmptyDirs && rejected.hinted)
    ok('#newFolderBtn rejects a non-identifier folder name (`my-folder` not created; calm inline hint, no browser alert)');
  else fail('non-identifier folder name reject path wrong: ' + JSON.stringify({ btnVisible, ...rejected }));
  // close the lingering create row so it doesn't bleed into the next block.
  await page.evaluate(() => { const i = document.querySelector('#tabs .tab.creating input'); if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); });
}

// ================================================================================================
// 4. FOLDER RENAME via the UI re-keys descendants + shows the warn-don't-rewrite import note.
//    Rename `sprites/` → `actors/` through the folder row's menu; assert
//    project.files['actors/enemy.py'] exists, sprites/enemy.py gone, and the inline import-warning
//    appeared. (design §7.1 #8, §5.4)
// ================================================================================================
{
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'sprites/enemy.py': '# enemy\nE = 1\n', 'sprites/util.py': 'U = 1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
    // Capture warn-don't-rewrite note. Slice B retired the typed prompt: folder rename is now a
    // popup [role=menu] (Rename · Delete) + an inline <input>, and the import warning is surfaced
    // as a calm console line (the house warn-on-move surface) rather than an alert(). We accept the
    // alert surface (legacy), an inline DOM note, OR the #console line.
    window.__warnText = '';
    window.alert = (m) => { window.__warnText += String(m) + '\n'; };
  });
  await ensureExplorerOpen();
  // Slice B flow: open the folder row's ⋯ popup, activate "Rename", fill the inline <input> with
  // `actors`, press Enter. (Mirrors explorer-actions.mjs's menu+inline-rename driver.)
  const menuClicked = await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    if (!folder) return false;
    const menu = folder.querySelector('.tab-menu');
    (menu || folder).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(m => m.offsetParent !== null);
    const menu = menus[menus.length - 1];
    if (!menu) return;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const ren = items.find(el => /rename/i.test(el.textContent || ''));
    if (ren) ren.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
  const renamed = await page.evaluate(() => ({
    menuClicked: true,
    hasNew: !!window.project.files['actors/enemy.py'] && !!window.project.files['actors/util.py'],
    oldGone: !window.project.files['sprites/enemy.py'] && !window.project.files['sprites/util.py'],
    warn: /import|not updated|manually|rewrit/i.test(window.__warnText || '') ||
          /import|not updated|manually|rewrit/i.test(document.getElementById('side')?.textContent || '') ||
          /import|not updated|manually|rewrit/i.test(document.getElementById('console')?.textContent || ''),
  }));
  if (renamed.hasNew && renamed.oldGone)
    ok('folder rename via UI re-keys descendants: sprites/* → actors/* (old keys gone)');
  else fail('folder rename did not re-key descendants: ' + JSON.stringify(renamed) + ' (menuClicked=' + menuClicked + ')');
  if (renamed.warn)
    ok('  ...folder rename shows the warn-don\'t-rewrite import note');
  else fail('  no warn-don\'t-rewrite import note on folder rename');
}

// ================================================================================================
// 5. FOLDER DELETE via the UI (shared confirm) removes the subtree. Delete `sprites/` (≥1 file)
//    behind the confirm; assert all sprites/* rows + paths gone. (design §7.1 #9, §5.4)
// ================================================================================================
{
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'sprites/enemy.py': 'E = 1\n', 'sprites/util.py': 'U = 1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
    window.confirm = () => true;                 // accept the shared confirm
    window.alert = () => {};
  });
  await ensureExplorerOpen();
  // Slice B flow: open the folder row's ⋯ popup, then activate "Delete" (confirm-gated).
  await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    if (!folder) return;
    const menu = folder.querySelector('.tab-menu');
    (menu || folder).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
  await page.waitForTimeout(200);
  const deleted = await page.evaluate(() => ({
    pathsGone: !window.project.files['sprites/enemy.py'] && !window.project.files['sprites/util.py']
      && !window.project.order.some(p => p.startsWith('sprites/')),
    rowsGone: !document.querySelector('#tabs .tab.folder[data-path="sprites"]')
      && !document.querySelector('#tabs .tab[data-name^="sprites/"]'),
    mainKept: !!window.project.files['main.py'],
  }));
  if (deleted.pathsGone && deleted.rowsGone && deleted.mainKept)
    ok('folder delete via UI (shared confirm) removes the whole sprites/ subtree (rows + paths gone)');
  else fail('folder delete did not remove the subtree: ' + JSON.stringify(deleted));
}

// ================================================================================================
// 6. DRAG-MOVE-INTO-FOLDER + DESCENDANT GUARD. Drag the enemy.py file row onto the sprites/ folder
//    row → project.files['sprites/enemy.py']. Then drag sprites/ into its own descendant →
//    the move is BLOCKED (paths unchanged). (design §7.1 #10, §5.5; #11 pointer-events rewrite)
//    Driven by REAL page.mouse pointer gestures (pointerDrag). Load-bearing = the resulting
//    project.files / order, and the descendant BLOCK.
// ================================================================================================
{
  // 6a. move a root file INTO a folder (real pointer gesture onto the folder's middle band).
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'enemy.py': '# enemy\nE = 1\n', 'sprites/util.py': 'U = 1\n' },
      order: ['main.py', 'enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  const dndResult = await pointerDrag('#tabs .tab[data-name="enemy.py"]', '#tabs .tab.folder[data-path="sprites"]', 0.5);
  await page.waitForTimeout(150);
  const movedIn = await page.evaluate(() => ({
    intoFolder: !!window.project.files['sprites/enemy.py'],
    rootGone: !window.project.files['enemy.py'],
    orderHas: window.project.order.includes('sprites/enemy.py'),
  }));
  if (dndResult.srcFound && dndResult.dstFound && movedIn.intoFolder && movedIn.rootGone && movedIn.orderHas)
    ok('drag-move-into-folder: enemy.py dropped on sprites/ → project.files["sprites/enemy.py"] (root key gone)');
  else fail('drag-move-into-folder did not re-key: ' + JSON.stringify({ dndResult, movedIn }));

  // 6b. descendant guard: dragging sprites/ into its own descendant sprites/sub/ is BLOCKED.
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'sprites/enemy.py': 'E = 1\n', 'sprites/sub/x.py': 'X = 1\n' },
      order: ['main.py', 'sprites/enemy.py', 'sprites/sub/x.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  await page.waitForTimeout(120);
  await pointerDrag('#tabs .tab.folder[data-path="sprites"]', '#tabs .tab.folder[data-path="sprites/sub"]', 0.5);
  await page.waitForTimeout(150);
  const guardOk = await page.evaluate(() => ({
    enemyUnchanged: !!window.project.files['sprites/enemy.py'],
    subUnchanged: !!window.project.files['sprites/sub/x.py'],
    // a blocked self-move must NOT have created a doubled prefix.
    noDoublePrefix: !Object.keys(window.project.files).some(k => k.startsWith('sprites/sub/sprites')),
  }));
  if (guardOk.enemyUnchanged && guardOk.subUnchanged && guardOk.noDoublePrefix)
    ok('descendant guard: dragging sprites/ into sprites/sub/ is BLOCKED (paths unchanged)');
  else fail('descendant-into-self drag was not blocked: ' + JSON.stringify(guardOk));
}

// ================================================================================================
// 7. ASSETS RENDER NESTED IN THE TREE — AS .tab.asset ONLY (Slice A: #assetPanel retired). Seed a
//    nested asset via the assetFS test seam (nested write mechanism is S2a-green); assert it shows
//    as .tab.asset[data-name="sounds/jump.wav"] INSIDE its folder node, indented past root, with NO
//    #assetPanel compat container in the DOM. Then DRAG-MOVE a root asset into a folder via the
//    synthetic HTML5 DnD protocol and assert the assetFS + MEMFS path is re-keyed.
//    (design: docs/specs/2026-06-24-explorer-unify-assets-design.md §4, §5, §7)
// ================================================================================================
{
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  await page.evaluate((b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'sounds/jump.wav', { type: 'audio/wav' });
    return window.assetFS.add(file);   // documented test seam; writes nested + re-renders
  }, WAV_B64).catch(() => {});
  await page.waitForTimeout(250);
  await ensureExplorerOpen();
  const nested = await page.evaluate(() => {
    const t = document.getElementById('tabs');
    const assetRow = t.querySelector('.tab.asset[data-name="sounds/jump.wav"]');
    const folderRow = t.querySelector('.tab.folder[data-path="sounds"]');
    // indentation: the nested asset is padded deeper than the root main.py file row.
    const root = t.querySelector('.tab[data-name="main.py"]');
    const pad = (el) => el ? parseFloat(getComputedStyle(el).paddingLeft || '0') : 0;
    const nestedIndented = !!assetRow && !!root && pad(assetRow) > pad(root);
    // Slice A: the legacy panel is GONE from the DOM (assets live only as tree rows).
    const panelGone = document.getElementById('assetPanel') === null;
    return { assetRow: !!assetRow, folderRow: !!folderRow, nestedIndented, panelGone };
  });
  if (nested.assetRow && nested.folderRow && nested.nestedIndented)
    ok('assets render nested in the tree: .tab.asset[data-name="sounds/jump.wav"] inside the sounds/ folder node');
  else fail('nested asset not in the tree: ' + JSON.stringify(nested));
  if (nested.panelGone)
    ok('  ...#assetPanel is gone from the DOM (assets are tree-only in Slice A)');
  else fail('  #assetPanel still exists (Slice A retires it): ' + JSON.stringify(nested));

  // 7b. DRAG-MOVE an asset row into a folder re-keys assetFS + MEMFS (real pointer gesture). Seed a
  //     root asset + an empty target folder, then drag the asset onto the folder's middle band.
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a = 1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
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
  const dndAsset = await pointerDrag('#tabs .tab.asset[data-name="beep.wav"]', '#tabs .tab.folder[data-path="audio"]', 0.5);
  await page.waitForTimeout(300);
  const movedAsset = await page.evaluate(() => ({
    newInList: window.assetFS.list.some(a => a.name === 'audio/beep.wav'),
    oldInList: window.assetFS.list.some(a => a.name === 'beep.wav'),
    newInFs: pyodide.FS.analyzePath('audio/beep.wav').exists,
    oldInFs: pyodide.FS.analyzePath('beep.wav').exists,
    nestedRow: !!document.querySelector('#tabs .tab.asset[data-name="audio/beep.wav"]'),
  }));
  if (dndAsset.srcFound && dndAsset.dstFound && movedAsset.newInList && !movedAsset.oldInList && movedAsset.newInFs && !movedAsset.oldInFs)
    ok('drag-move asset into folder re-keys assetFS + MEMFS: beep.wav -> audio/beep.wav (old gone)');
  else fail('asset drag-into-folder did not update the path: ' + JSON.stringify({ dndAsset, movedAsset }));
}

// ================================================================================================
// 8. FIRST-PAINT LAZINESS ON THE TREE (additive). After rendering a nested tree + toggling a
//    folder (no run), window.JSZip === undefined, __amLoaded falsy, CM lint falsy — proving tree
//    rendering + folder toggles touch no lazy loader and never setValue. (design §7.1 #16)
// ================================================================================================
{
  await page.goto(URL, { waitUntil: 'load' });
  await booted().catch(() => fail('never rebooted (laziness)'));
  await ensureExplorerOpen();
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'pkg/mod.py': 'M = 1\n', 'pkg/sub/deep.py': 'D = 1\n' },
      order: ['main.py', 'pkg/mod.py', 'pkg/sub/deep.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
  });
  // toggle a folder (render-only).
  await page.evaluate(() => {
    const f = document.querySelector('#tabs .tab.folder[data-path="pkg"]');
    if (f) f.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  const lazy = await page.evaluate(() => ({
    jszip: typeof window.JSZip,
    amLoaded: !!window.__amLoaded,
    diff: typeof window.Diff,
    lint: !!document.querySelector('.CodeMirror')?.CodeMirror?.getOption('lint'),
  }));
  if (lazy.jszip === 'undefined' && !lazy.amLoaded && !lazy.lint)
    ok('first-paint laziness intact after nested render + folder toggle: JSZip undefined, __amLoaded falsy, CM lint off');
  else fail('tree render/toggle tripped a lazy loader: ' + JSON.stringify(lazy));
}

// ================================================================================================
// 9. ROW DE-CLUTTER (Slice C — design docs/specs/2026-06-24-explorer-row-declutter-design.md §1-§2, §4).
//    Resolves request #3 ("🐍 + two play triangles is too much; the stage already labels what's
//    running"). Three contracts, every one RED today:
//      9a. a RUNNING .py row carries NO in-row run "▶" glyph (today CSS `.tab.running .tab-name::after
//          { content:" ▶" }` ~index.html:153 → the ::after content contains ▶ → fails now) — BUT the
//          row is STILL marked running: the `.tab.running` class is present and its highlight (the
//          warm left-border + warm name color) still applies. The stage #runFileBadge stays the
//          authoritative "what's running"; the row only needs the at-a-glance highlight.
//      9b. the ENTRY row is shown by a CALM, NON-play marker (a class/element seam the implementer
//          exposes + a non-triangle visual), NOT the play-looking "▸" (today CSS `.tab.entry
//          .tab-name::before { content:"▸ " }` ~index.html:149 → the ::before content contains ▸ →
//          fails now). The `.tab.entry` semantic class is PRESERVED (tests rely on it, §5).
//      9c. the 🐍 type glyph is STILL on .py rows (.ic === 🐍) and asset glyphs (🖼️/🔊/📄) unchanged.
//    `content` is read via getComputedStyle(el,'::after'|'::before') — the CSS-pseudo string (with
//    quotes), NOT DOM text. We assert the play triangles are ABSENT from those pseudo strings.
// ================================================================================================
{
  await page.goto(URL, { waitUntil: 'load' });
  await booted().catch(() => fail('never rebooted (de-clutter)'));
  await ensureExplorerOpen();

  // ---- 9b + 9c first (no run needed): entry marker is calm; 🐍 + asset glyphs intact. -----------
  // ISOLATE the entry row from the .active and .running confounders (both recolor .tab-name and
  // would mask an entry-specific cue): End any live boot task so nothing is .running, load THREE
  // code files (main.py = entry, boss.py = the selected/active row, util.py = a PLAIN reference row
  // that is neither entry nor active nor running), then click boss.py so main.py is entry-ONLY.
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });
  await page.waitForFunction(() => !window.runFile(), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'boss.py': 'b = 2\n', 'util.py': 'c = 3\n' },
      order: ['main.py', 'boss.py', 'util.py'], entry: 'main.py', active: 'boss.py',
    });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  await click('#tabs .tab.py[data-name="boss.py"]');   // select boss.py → main.py is entry-only
  await page.waitForTimeout(120);
  // seed an asset so we can confirm asset glyphs are unchanged by Slice C.
  await page.evaluate((b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return window.assetFS.add(new File([bytes], 'jump.wav', { type: 'audio/wav' }));
  }, WAV_B64).catch(() => {});
  await page.waitForTimeout(250);
  await ensureExplorerOpen();

  // #9: the fixed-entry cue is RETIRED — the open file is what runs. Assert no .tab.entry class and
  // no start tag anywhere; the 🐍 type glyph stays on .py rows; running highlight is checked in §9a.
  const entry = await page.evaluate(() => {
    const anyPy = document.querySelector('#tabs .tab.py[data-name="main.py"]') || document.querySelector('#tabs .tab.py');
    return {
      entryRows: document.querySelectorAll('#tabs .tab.entry').length,
      startTags: document.querySelectorAll('#tabs .start-tag, #tabs [data-entry], #tabs [data-start]').length,
      pyGlyph: anyPy ? (anyPy.querySelector('.ic') || {}).textContent : null,
    };
  });
  if (entry.entryRows === 0 && entry.startTags === 0)
    ok('#9: no fixed-entry cue in the tree (.tab.entry + start tag retired — the open file runs)');
  else fail('entry cue still present: ' + JSON.stringify(entry));
  if (entry.pyGlyph === '🐍')
    ok('🐍 type glyph STILL present on .py rows (.ic === 🐍)');
  else fail('🐍 type glyph missing/changed on .py rows: ' + JSON.stringify(entry.pyGlyph));

  // asset glyphs unchanged: a .wav asset still shows 🔊 (the audio glyph).
  const assetGlyph = await page.evaluate(() => {
    const a = document.querySelector('#tabs .tab.asset[data-name="jump.wav"] .ic');
    return a ? a.textContent : null;
  });
  if (assetGlyph === '🔊')
    ok('asset type glyphs unchanged by Slice C (.wav still shows 🔊)');
  else fail('asset glyph changed by Slice C: ' + JSON.stringify(assetGlyph));

  // ---- 9a: a LIVE program leaves NO in-row "▶" but DOES keep the .running highlight. ------------
  // Start a frame-paced (non-terminating) program so runFile stays set and the entry/active row is
  // .running while we sample it. Single-file run model: runFile = project.active, so make main.py
  // the active+entry single file and Start it.
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': [
        'import pygame',
        'pygame.init()',
        'screen = pygame.display.set_mode((160, 120))',
        'clock = pygame.time.Clock()',
        'n = 0',
        'while True:',
        '    screen.fill(((n*7)%255, (n*3)%255, 90))',
        '    pygame.display.flip()',
        '    pygame.event.pump()',
        '    clock.tick(60)',
        '    n += 1',
      ].join('\n') + '\n' },
      order: ['main.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  await click('#runBtn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent === 'running', null, { timeout: 20_000 }
  ).catch(() => fail('  de-clutter 9a: program never reached status "running"'));
  await page.waitForTimeout(200);   // let renderTabs paint the .running row
  const running = await page.evaluate(() => {
    const row = document.querySelector('#tabs .tab.running[data-name="main.py"]');
    const name = row && row.querySelector('.tab-name');
    const after = name ? (getComputedStyle(name, '::after').content || '') : '(no running row)';
    // the warm highlight that REPLACES the in-row glyph as the at-a-glance signal:
    const bl = row ? getComputedStyle(row).borderLeftColor : '';
    const nameColor = name ? getComputedStyle(name).color : '';
    return {
      hasRunningRow: !!row,
      runningClassKept: !!row,                    // .tab.running semantic class still applied
      afterContent: after,
      // RED today: ::after is " ▶" → contains the play triangle. GREEN: no ▶ in the pseudo content.
      noRunTriangle: !/▶/.test(after),
      // the highlight still distinguishes the running row: a non-transparent warm left-border AND a
      // warm name color (both keyed off --warn; we just assert they're set, not transparent/empty).
      borderSet: !!bl && bl !== 'rgba(0, 0, 0, 0)' && bl !== 'transparent',
      nameColorSet: !!nameColor,
    };
  });
  if (running.hasRunningRow && running.runningClassKept)
    ok('running row keeps the .tab.running semantic class (the running highlight seam, §5)');
  else fail('running row / .tab.running class missing while live: ' + JSON.stringify(running));
  if (running.noRunTriangle)
    ok('running .py row carries NO in-row run "▶" glyph (::after has no ▶): ' + JSON.stringify(running.afterContent));
  else fail('running row STILL shows the in-row "▶" (CSS .tab.running .tab-name::after " ▶"): ' + JSON.stringify(running.afterContent));
  if (running.borderSet && running.nameColorSet)
    ok('  ...the running highlight is INTACT (warm left-border + warm name color still applied)');
  else fail('  running highlight lost (border/color) — de-clutter must keep the at-a-glance running cue: ' + JSON.stringify(running));
  // End the live task so it doesn't leak into later batteries / hang teardown.
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });
  await page.waitForTimeout(150);
}

// ================================================================================================
// Request #6 / #11: dragging a file to REORDER actually reorders, via a REAL pointer gesture (the
// regression that prompted #11 was that native DnD never fired from a real mouse — so this now drives
// page.mouse and asserts the reconciled model + rendered order).
{
  await ensureExplorerOpen();
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': '# a\n', 'b.py': '# b\n', 'c.py': '# c\n' }, order: ['a.py', 'b.py', 'c.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  // drag b.py to the TOP half of a.py → b before a.
  const reordered = await pointerDrag('#tabs .tab[data-name="b.py"]', '#tabs .tab[data-name="a.py"]', 0.2);
  await page.waitForTimeout(120);
  const res = await page.evaluate(() => ({
    order: window.project.order.slice(),
    rows: [...document.querySelectorAll('#tabs .tab.py')].map(n => n.dataset.name),
  }));
  const want = ['b.py', 'a.py', 'c.py'];
  if (reordered.srcFound && eq(res.order, want) && eq(res.rows, want))
    ok('#6: pointer drag reorders b.py above a.py (model + rendered order = b,a,c)');
  else fail('#6: pointer reorder failed: ' + JSON.stringify({ reordered, ...res }));

  // drag a.py to the BOTTOM half of c.py (the last row) → reorder-to-end (b,c,a).
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'a.py': '# a\n', 'b.py': '# b\n', 'c.py': '# c\n' }, order: ['a.py', 'b.py', 'c.py'], entry: 'a.py', active: 'a.py' });
    window.renderTabs();
  });
  await pointerDrag('#tabs .tab[data-name="a.py"]', '#tabs .tab[data-name="c.py"]', 0.85);
  await page.waitForTimeout(120);
  const endOrder = await page.evaluate(() => window.project.order.slice());
  if (eq(endOrder, ['b.py', 'c.py', 'a.py']))
    ok('#6: pointer drag to the bottom half of the last row moves a.py to the end (b,c,a)');
  else fail('#6: drag-to-end failed: ' + JSON.stringify({ endOrder }));
}

// ================================================================================================
// Request #10 (refinement v2): the redundant trailing "+ new file" affordance (.tab-add) is GONE.
// The header New-file button (#newFileBtn) remains the single in-explorer new-file entry point.
{
  await ensureExplorerOpen();
  await page.evaluate(() => {
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.renderTabs();
  });
  const noAdd = await page.evaluate(() => document.querySelectorAll('#tabs .tab-add').length);
  if (noAdd === 0) ok('#10: no redundant ".tab-add" (+ new file) span in the tree');
  else fail(`#10: redundant .tab-add still present (count=${noAdd})`);
  const headerBtn = await page.evaluate(() => !!document.getElementById('newFileBtn'));
  if (headerBtn) ok('#10: header New-file button (#newFileBtn) remains as the new-file entry point');
  else fail('#10: header #newFileBtn missing — new-file affordance lost');
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) info('JS console errors observed (informational during RED): ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-TREE BATTERY FAILED (expected RED pre-S2b)' : 'EXPLORER-TREE BATTERY OK');
