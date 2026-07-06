// FOLDER-UPLOAD battery (spec: docs/superpowers/specs/2026-07-06-folder-upload-design.md).
// TDD RED first: every check below MUST FAIL before the feature lands, for the right
// reason (missing seam / relPath ignored / no menu), then GREEN after.
//
// SEAMS the implementer MUST expose / satisfy:
//   - window.__walkEntries(entries) -> Promise<[{file, relPath}]> — async traversal of
//     duck-typed FileSystemEntry objects (isFile/isDirectory/name/file()/createReader()).
//     readEntries MUST be drained in a loop (Chrome caps ~100/call). Folder segments
//     sanitized ([^A-Za-z0-9_] -> "_", leading digit -> "_"-prefix); junk skipped
//     (dot-names, __pycache__, *.pyc, node_modules, Thumbs.db). Returns files only
//     (empty dirs vanish). Also exposes the skip count for the caller's summary line
//     (returned array carries `.skipped` — a number).
//   - window.uploadFiles(items, destFolder) accepts File OR {file, relPath} items
//     (PINNED seam, existing File-only callers unchanged). >200 files -> confirmModal
//     gate (cancel adds NOTHING).
//   - #uploadBtn opens the shared [role=menu] with items "Files…" and "Folder…";
//     "Folder…" clicks #folderInput, a hidden <input type="file" webkitdirectory>.
//
// Run: python3 -m http.server 8923 ; node test/upload-folder.mjs http://localhost:8923/
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

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));


// Evaluate that FAILS the check (instead of crashing the battery) when the page throws —
// in the RED phase unsupported seams reject; that's the failure we want to see per-check.
const tryEval = (fn, arg) => page.evaluate(fn, arg).catch((e) => ({ __threw: String(e).split('\n')[0] }));
async function reset() {
  await page.evaluate(async () => {
    await window.assetFS.clearAll();
    window.project.load({ files: { 'main.py': 'import pygame\n' }, entry: 'main.py', active: 'main.py' });
    window.selectedFolder = '';
    window.renderTabs();
  });
}

// In-page fake-entry builders (real directory DataTransfers can't be synthesized).
const FAKES = `
  const fakeFile = (name, contents = 'x') => ({
    isFile: true, isDirectory: false, name,
    file: (cb) => cb(new File([contents], name)),
  });
  const fakeDir = (name, children, batch) => ({
    isFile: false, isDirectory: true, name,
    createReader: () => { let i = 0; return { readEntries: (cb) => {
      const out = children.slice(i, i + (batch || children.length || 1)); i += out.length; cb(out);
    } }; },
  });
`;

// ---- FU1: nested traversal + folder-segment sanitization --------------------------------------
{
  const res = await page.evaluate(`(async () => { ${FAKES}
    if (typeof window.__walkEntries !== 'function') return { missing: true };
    const tree = [
      fakeDir('My Game', [
        fakeFile('main.py'),
        fakeDir('2 sprites', [fakeFile('ship.png')]),
      ]),
      fakeFile('loose.py'),
    ];
    const out = await window.__walkEntries(tree);
    return { paths: out.map(o => o.relPath).sort(), files: out.every(o => o.file instanceof File) };
  })()`);
  const want = ['My_Game/_2_sprites/ship.png', 'My_Game/main.py', 'loose.py'];
  if (!res.missing && JSON.stringify(res.paths) === JSON.stringify(want) && res.files)
    ok('FU1 nested traversal maps + sanitizes folder segments (My Game/2 sprites -> My_Game/_2_sprites)');
  else fail('FU1 traversal wrong: ' + JSON.stringify(res));
}

// ---- FU2: readEntries drained in a LOOP (Chrome caps ~100/call) --------------------------------
{
  const res = await page.evaluate(`(async () => { ${FAKES}
    if (typeof window.__walkEntries !== 'function') return { missing: true };
    const kids = Array.from({ length: 250 }, (_, i) => fakeFile('f' + i + '.png'));
    const out = await window.__walkEntries([fakeDir('big', kids, 100)]);   // 100 per readEntries call
    return { n: out.length };
  })()`);
  if (res.n === 250) ok('FU2 readEntries drained in a loop (250 children across 100-entry batches)');
  else fail('FU2 readEntries loop: ' + JSON.stringify(res));
}

// ---- FU3: junk skipped, skip count surfaced ----------------------------------------------------
{
  const res = await page.evaluate(`(async () => { ${FAKES}
    if (typeof window.__walkEntries !== 'function') return { missing: true };
    const tree = [fakeDir('game', [
      fakeFile('.DS_Store'), fakeFile('main.py'), fakeFile('mod.pyc'), fakeFile('Thumbs.db'),
      fakeDir('__pycache__', [fakeFile('x.cpython-311.pyc')]),
      fakeDir('.git', [fakeFile('config')]),
      fakeDir('node_modules', [fakeFile('pkg.js')]),
    ])];
    const out = await window.__walkEntries(tree);
    return { paths: out.map(o => o.relPath), skipped: out.skipped };
  })()`);
  if (!res.missing && JSON.stringify(res.paths) === JSON.stringify(['game/main.py']) && res.skipped >= 6)
    ok('FU3 junk skipped (.DS_Store/__pycache__/*.pyc/.git/node_modules/Thumbs.db), skip count surfaced');
  else fail('FU3 junk skipping: ' + JSON.stringify(res));
}

// ---- FU4: path-carrying upload routes code + asset into the tree, MEMFS, stores ---------------
{
  await reset();
  const res = await tryEval(async (png) => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    await window.uploadFiles([
      { file: new File(['print("hi")\n'], 'main.py'), relPath: 'mygame/main.py' },
      { file: new File([bytes], 'ship.png', { type: 'image/png' }), relPath: 'mygame/sprites/ship.png' },
    ], '');
    return {
      code: !!window.project.files['mygame/main.py'],
      asset: window.assetFS.list.some(a => a.name === 'mygame/sprites/ship.png'),
      memfsCode: !!pyodide.FS.analyzePath('mygame/main.py').exists,
      memfsAsset: !!pyodide.FS.analyzePath('mygame/sprites/ship.png').exists,
      folderRow: !!document.querySelector('#tabs .tab.folder[data-path="mygame"]'),
    };
  }, PNG_B64);
  if (res.code && res.asset && res.memfsCode && res.memfsAsset && res.folderRow)
    ok('FU4 {file, relPath} items route code+asset into nested paths (project/assetFS/MEMFS/tree)');
  else fail('FU4 path-carrying upload: ' + JSON.stringify(res));
}

// ---- FU4b: assets under folder paths survive reload --------------------------------------------
{
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
    null, { timeout: 120_000 }).catch(() => fail('FU4b never re-booted'));
  const back = await page.evaluate(() => window.assetFS.list.some(a => a.name === 'mygame/sprites/ship.png'));
  if (back) ok('FU4b folder-path asset persists across reload');
  else fail('FU4b folder-path asset lost on reload');
}

// ---- FU5: merging into an existing folder suffixes per-file (code _N, asset -N) ---------------
{
  const res = await tryEval(async (png) => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    await window.uploadFiles([
      { file: new File(['print(2)\n'], 'main.py'), relPath: 'mygame/main.py' },
      { file: new File([bytes], 'ship.png', { type: 'image/png' }), relPath: 'mygame/sprites/ship.png' },
    ], '');
    return {
      code2: !!window.project.files['mygame/main_2.py'],
      asset2: window.assetFS.list.some(a => a.name === 'mygame/sprites/ship-2.png'),
      original: !!window.project.files['mygame/main.py'],
    };
  }, PNG_B64);
  if (res.code2 && res.asset2 && res.original)
    ok('FU5 re-upload MERGES into the existing folder; per-file suffixes (main_2.py, ship-2.png)');
  else fail('FU5 merge collisions: ' + JSON.stringify(res));
}

// ---- FU6: >200-file drop gates on confirmModal; cancel adds nothing ---------------------------
{
  await reset();
  const before = await page.evaluate(() => window.assetFS.list.length);
  const uploadPromise = page.evaluate(async () => {
    const items = Array.from({ length: 201 }, (_, i) =>
      ({ file: new File(['x'], 'p' + i + '.txt'), relPath: 'big/p' + i + '.txt' }));
    await window.uploadFiles(items, '');
    return window.assetFS.list.length;
  }).catch(() => '__threw__');
  const sawModal = await modalOpen(page, 5000);
  if (!sawModal) fail('FU6 no confirmModal for a 201-file upload');
  else {
    await page.evaluate(() => { document.querySelector('.modal [data-act="cancel"]').click(); });
    const after = await uploadPromise;
    if (after === before) ok('FU6 201-file upload asks first; cancel adds nothing');
    else fail('FU6 cancel still added files: ' + JSON.stringify({ before, after }));
  }
  if (sawModal === false) {
    await page.evaluate(() => {}).catch(() => {});
  }
}

// ---- FU7: #uploadBtn opens the shared menu; "Folder…" reaches #folderInput (webkitdirectory) --
{
  await reset();
  await page.evaluate(() => document.getElementById('uploadBtn').click());
  await page.waitForTimeout(120);
  const menu = await page.evaluate(() => {
    const m = [...document.querySelectorAll('[role="menu"]')].find(el => el.offsetParent !== null);
    if (!m) return { open: false };
    return { open: true, items: [...m.querySelectorAll('[role="menuitem"]')].map(el => el.textContent.trim()) };
  });
  const hasBoth = menu.open && menu.items.some(t => /Files…?/.test(t)) && menu.items.some(t => /Folder…?/.test(t));
  if (hasBoth) ok('FU7 upload button opens [role=menu] with Files…/Folder…: ' + JSON.stringify(menu.items));
  else fail('FU7 upload menu wrong: ' + JSON.stringify(menu));
  const wired = await page.evaluate(() => {
    const inp = document.getElementById('folderInput');
    if (!inp || !inp.hasAttribute('webkitdirectory')) return { input: !!inp, dir: false };
    let clicked = false;
    const orig = inp.click.bind(inp);
    inp.click = () => { clicked = true; };
    const m = [...document.querySelectorAll('[role="menu"]')].find(el => el.offsetParent !== null);
    const item = m && [...m.querySelectorAll('[role="menuitem"]')].find(el => /Folder…?/.test(el.textContent));
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    inp.click = orig;
    return { input: true, dir: true, clicked };
  });
  if (wired.input && wired.dir && wired.clicked)
    ok('FU7b "Folder…" clicks #folderInput, which carries webkitdirectory');
  else fail('FU7b folder-input wiring: ' + JSON.stringify(wired));
}

// ---- FU8: plain-File uploads still behave exactly as before (regression guard) -----------------
{
  await reset();
  const res = await tryEval(async () => {
    await window.uploadFiles([new File(['A = 1\n'], 'helper.py')], '');
    return { landed: !!window.project.files['helper.py'] };
  });
  if (res.landed) ok('FU8 plain-File upload unchanged (helper.py lands at root leaf)');
  else fail('FU8 plain-File regression: ' + JSON.stringify(res));
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'UPLOAD-FOLDER BATTERY FAILED' : 'UPLOAD-FOLDER BATTERY OK');
