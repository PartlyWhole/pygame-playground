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
// --- DnD-simulation approach (assertion 6) -------------------------------------------------------
// HTML5 native drag-and-drop cannot be driven by Playwright's real mouse headlessly (the OS-level
// drag is never produced). The proto (proto/sandbox.html:624-655) and the design (§5.5) both wire
// HTML5 DnD events (dragstart/dragover/drop) carrying the dragged id via a DataTransfer. So we
// SIMULATE that protocol in-page: build a real DataTransfer, set the dragged path on it, and
// dispatch dragstart on the source row, then dragover + drop on the target row. We assert the
// load-bearing RESULT (project.files / order re-keyed; descendant move BLOCKED) — never pixels.
// If the impl instead reads the dragged path from an in-page variable (proto stores dragId in a
// closure) rather than the DataTransfer, the synthetic dragstart on the real row still runs the
// impl's own dragstart handler (which sets that variable), so this approach is robust to either
// wiring. As a final fallback, an assertion that the synthetic protocol produced no result is
// still a clean RED today (the flat build has no DnD handlers at all).

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

  // happy path: stub prompt to return an identifier-safe name, click the button.
  await page.evaluate(() => { window.prompt = () => 'actors'; });
  await click('#newFolderBtn');
  await page.waitForTimeout(150);
  const created = await page.evaluate(() => {
    const row = document.querySelector('#tabs .tab.folder[data-path="actors"]');
    const inEmptyDirs = window.project.serialize().emptyDirs.includes('actors');
    return { row: !!row, inEmptyDirs };
  });
  if (created.row && created.inEmptyDirs)
    ok('#newFolderBtn creates an empty `actors/` folder row that persists via serialize().emptyDirs');
  else fail('new folder not created/persisted: ' + JSON.stringify(created));

  // rejection: a non-identifier folder name must be refused (no row, not in emptyDirs) AND
  // produce a user-facing rejection signal (the house alert). Gating on btnVisible + the alert
  // (not just the absent row) prevents a vacuous pass while #newFolderBtn is hidden/unwired — the
  // absent row is trivially true today, so without these the reject path would false-GREEN.
  await page.evaluate(() => { window.prompt = () => 'my-folder'; window.__alerted = false; window.alert = () => { window.__alerted = true; }; });
  await click('#newFolderBtn');
  await page.waitForTimeout(150);
  const rejected = await page.evaluate(() => ({
    noRow: !document.querySelector('#tabs .tab.folder[data-path="my-folder"]'),
    notInEmptyDirs: !window.project.serialize().emptyDirs.includes('my-folder'),
    alerted: !!window.__alerted,
  }));
  if (btnVisible && rejected.noRow && rejected.notInEmptyDirs && rejected.alerted)
    ok('#newFolderBtn rejects a non-identifier folder name (`my-folder` not created, user alerted)');
  else fail('non-identifier folder name reject path wrong: ' + JSON.stringify({ btnVisible, ...rejected }));
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
    // Capture warn-don't-rewrite note via the app's alert (the house warn surface, mirrors
    // tabMenu's rename alert at index.html:2084). Also accept an inline DOM note if the impl
    // surfaces one instead.
    window.__warnText = '';
    window.alert = (m) => { window.__warnText += String(m) + '\n'; };
    // Drive the rename through the folder row's action menu. The impl wires a per-folder menu
    // (⋯ / .tab-menu on a folder row) or an inline rename; we stub prompt to choose rename + new
    // name so whichever prompt-based flow the impl uses re-keys to `actors`.
    window.__promptSeq = ['rename', 'actors'];
    window.prompt = () => window.__promptSeq.shift();
  });
  await ensureExplorerOpen();
  // Click the folder row's menu button if present; else click the folder row itself (some impls
  // open the menu on the row). Both go through the short-timeout resilient click.
  const menuClicked = await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    if (!folder) return false;
    const menu = folder.querySelector('.tab-menu');
    (menu || folder).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  });
  await page.waitForTimeout(200);
  const renamed = await page.evaluate(() => ({
    menuClicked: true,
    hasNew: !!window.project.files['actors/enemy.py'] && !!window.project.files['actors/util.py'],
    oldGone: !window.project.files['sprites/enemy.py'] && !window.project.files['sprites/util.py'],
    warn: /import|not updated|manually|rewrit/i.test(window.__warnText || '') ||
          // or an inline DOM warning note somewhere in the explorer.
          /import|not updated|manually|rewrit/i.test(document.getElementById('side')?.textContent || ''),
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
    window.__promptSeq = ['delete'];             // prompt-based folder menu chooses delete
    window.prompt = () => window.__promptSeq.shift();
    window.alert = () => {};
  });
  await ensureExplorerOpen();
  await page.evaluate(() => {
    const folder = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
    if (!folder) return;
    const menu = folder.querySelector('.tab-menu');
    (menu || folder).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
//    the move is BLOCKED (paths unchanged). (design §7.1 #10, §5.5)
//    DnD-simulation: synthetic HTML5 dragstart/dragover/drop with a real DataTransfer (see the
//    header comment). Load-bearing = the resulting project.files / order, and the descendant BLOCK.
// ================================================================================================
{
  // 6a. move a root file INTO a folder.
  await page.evaluate(() => {
    window.project.load({
      files: { 'main.py': 'a = 1\n', 'enemy.py': '# enemy\nE = 1\n', 'sprites/util.py': 'U = 1\n' },
      order: ['main.py', 'enemy.py', 'sprites/util.py'], entry: 'main.py', active: 'main.py',
    });
    window.renderTabs();
  });
  await ensureExplorerOpen();
  // The synthetic-DnD driver. Returns whether both source + target rows existed (so a missing tree
  // fails for the RIGHT reason).
  const dndResult = await page.evaluate(() => {
    function fireDnd(srcSel, dstSel) {
      const src = document.querySelector(srcSel);
      const dst = document.querySelector(dstSel);
      if (!src || !dst) return { srcFound: !!src, dstFound: !!dst };
      const dt = new DataTransfer();
      // mirror the proto/§5.5 wiring: the dragged identifier rides text/plain. For a file row the
      // dragged path is data-name; for a folder row it is data-path.
      const dragged = src.getAttribute('data-name') || src.getAttribute('data-path');
      dt.setData('text/plain', dragged);
      const mk = (type, target) => { const e = new DragEvent(type, { bubbles: true, cancelable: true }); try { Object.defineProperty(e, 'dataTransfer', { value: dt }); } catch {} return [e, target]; };
      const [ds, dsTgt] = mk('dragstart', src); dsTgt.dispatchEvent(ds);
      const [dov, dovTgt] = mk('dragover', dst); dovTgt.dispatchEvent(dov);
      const [dp, dpTgt] = mk('drop', dst); dpTgt.dispatchEvent(dp);
      const [de, deTgt] = mk('dragend', src); deTgt.dispatchEvent(de);
      return { srcFound: true, dstFound: true };
    }
    return fireDnd('#tabs .tab[data-name="enemy.py"]', '#tabs .tab.folder[data-path="sprites"]');
  });
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
  // open the nested folder so the descendant target row exists in the DOM.
  await page.evaluate(() => {
    const sub = document.querySelector('#tabs .tab.folder[data-path="sprites/sub"]');
    if (!sub) {
      // ensure parent is open first (impls collapse by default sometimes).
      const sp = document.querySelector('#tabs .tab.folder[data-path="sprites"]');
      if (sp && getComputedStyle(sp).display !== 'none') sp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await page.waitForTimeout(120);
  const guardResult = await page.evaluate(() => {
    function fireDnd(srcSel, dstSel) {
      const src = document.querySelector(srcSel);
      const dst = document.querySelector(dstSel);
      if (!src || !dst) return { srcFound: !!src, dstFound: !!dst };
      const dt = new DataTransfer();
      dt.setData('text/plain', src.getAttribute('data-path') || src.getAttribute('data-name'));
      const mk = (type, target) => { const e = new DragEvent(type, { bubbles: true, cancelable: true }); try { Object.defineProperty(e, 'dataTransfer', { value: dt }); } catch {} return [e, target]; };
      src.dispatchEvent(mk('dragstart', src)[0]);
      dst.dispatchEvent(mk('dragover', dst)[0]);
      dst.dispatchEvent(mk('drop', dst)[0]);
      src.dispatchEvent(mk('dragend', src)[0]);
      return { srcFound: true, dstFound: true };
    }
    return fireDnd('#tabs .tab.folder[data-path="sprites"]', '#tabs .tab.folder[data-path="sprites/sub"]');
  });
  await page.waitForTimeout(150);
  const guardOk = await page.evaluate(() => ({
    enemyUnchanged: !!window.project.files['sprites/enemy.py'],
    subUnchanged: !!window.project.files['sprites/sub/x.py'],
    // a blocked self-move must NOT have created a doubled prefix.
    noDoublePrefix: !Object.keys(window.project.files).some(k => k.startsWith('sprites/sub/sprites')),
  }));
  if (guardResult.srcFound && guardResult.dstFound && guardOk.enemyUnchanged && guardOk.subUnchanged && guardOk.noDoublePrefix)
    ok('descendant guard: dragging sprites/ into sprites/sub/ is BLOCKED (paths unchanged)');
  else fail('descendant-into-self drag was not blocked: ' + JSON.stringify({ guardResult, guardOk }));
}

// ================================================================================================
// 7. ASSETS RENDER NESTED IN THE TREE (design §0.1 Q2). Seed a nested asset via the assetFS test
//    seam (nested write mechanism is S2a-green); assert it shows as
//    .tab.asset[data-name="sounds/jump.wav"] INSIDE its folder node, AND #assetPanel /
//    .asset-row[data-name] still exist (compat container preserved).
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
    // compat container still present + keyed by path.
    const panel = document.getElementById('assetPanel');
    const compatRow = panel && panel.querySelector('.asset-row[data-name="sounds/jump.wav"]');
    return {
      assetRow: !!assetRow, folderRow: !!folderRow, nestedIndented,
      panelExists: !!panel, compatRow: !!compatRow,
    };
  });
  if (nested.assetRow && nested.folderRow && nested.nestedIndented)
    ok('assets render nested in the tree: .tab.asset[data-name="sounds/jump.wav"] inside the sounds/ folder node');
  else fail('nested asset not in the tree: ' + JSON.stringify(nested));
  if (nested.panelExists && nested.compatRow)
    ok('  ...#assetPanel compat container kept, .asset-row[data-name] keyed by path');
  else fail('  asset compat container/row missing or not path-keyed: ' + JSON.stringify(nested));
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
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) info('JS console errors observed (informational during RED): ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXPLORER-TREE BATTERY FAILED (expected RED pre-S2b)' : 'EXPLORER-TREE BATTERY OK');
