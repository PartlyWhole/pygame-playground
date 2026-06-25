// Headless verification of S4 — the Examples panel becomes EDITABLE, RUNNABLE files that
// PROMOTE-ON-EDIT. This is the RED contract for S4 from docs/specs/2026-06-23-examples-promote-design.md
// §8 (the test plan). Every assertion is engine-light (no game must run except the one Start
// in (b)) and must NOT trip a lazy-loader except where a real edit legitimately arms lint.
//
// SEAMS the implementer MUST expose to make this battery GREEN (named here so impl matches):
//   - window.EXAMPLES                       — read-only test hook: the immutable example source map
//                                             (mirrors window.project / window.renderTabs / window.runFile).
//   - #examplesPanel .exrow[data-ex="<EXAMPLES key>"]
//                                           — one clickable list row per example; data-ex carries the
//                                             EXAMPLES key so a test can target a specific example.
//   - clicking a row PREVIEWS via swapDoc (NEVER editor.setValue), lint stays UNARMED.
//   - .exrow.sel                            — the selected (currently previewed) example row.
//   - .exrow .moddot  AND  #tabs .tab .moddot
//                                           — the `●` modified indicator (proto class .moddot), shown in
//                                             BOTH the Examples list row and the Explorer tree row once a
//                                             promoted example diverges from its EXAMPLES source.
//   - .exrow .reset                         — the `↺` reset-to-default control on a promoted+modified row.
//   - project.adoptDoc(name, doc)           — ADOPTS the live preview Doc into project.files (preserves
//                                             keystroke + undo history; NOT a re-created Doc).
//   - EXAMPLE_FILENAME table                — "Bouncy balls" -> bouncy_balls.py (canonical, fixed).
//   - collision auto-suffix uses UNDERSCORE — bouncy_balls.py taken -> bouncy_balls_2.py (NOT -2; a hyphen
//                                             fails isModuleName).
//
// Run: python3 -m http.server 8923   then   node test/examples.mjs http://localhost:8923/
import { launch, acceptModal, cancelModal } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);
const info = (msg) => console.log('info -', msg);
// Short-timeout click so a missing seam fails its OWN assertion fast (RED phase) rather than
// hanging 30s and aborting the whole battery.
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});

await page.goto(URL, { waitUntil: 'load' });
// Boot to a quiescent state before probing.
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// The example we drive throughout. Its canonical filename per the fixed table.
const EX_NAME = 'Bouncy balls';
const EX_FILE = 'bouncy_balls.py';

// Open the Examples rail view so its panel rows are rendered + clickable.
const openExamplesView = () => click('nav.rail [data-view="examples"]');
// Click a specific example row by its EXAMPLES key (data-ex seam).
const openExample = async (key) => {
  await page.evaluate((k) => {
    const row = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
    if (row) row.click();
  }, key);
  await page.waitForTimeout(120);
};
// Read the live CM instance + getValue.
const cmValue = () => page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
  return cm ? cm.getValue() : null;
});

await openExamplesView();
await page.waitForTimeout(120);

// Reset to a clean single-file project before the open/promote assertions so a stale autosaved
// project doesn't pre-occupy bouncy_balls.py or leave a multi-file project around.
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'seed = 1\n' } });
  window.renderTabs();
});

// ----------------------------------------------------------------------------
// (a) OPEN shows content, lint UNARMED, no editor.setValue, CM identity preserved,
//     and the previewed example is NOT yet in project.files.
// ----------------------------------------------------------------------------
// Capture the CM instance + arm a setValue spy BEFORE opening, so any sneaky editor.setValue
// during preview is caught (preview MUST use swapDoc, never setValue).
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  window.__cm0 = cm;
  window.__setValueCalls = 0;
  if (!cm.__svWrapped) {
    const orig = cm.setValue.bind(cm);
    cm.setValue = function (...a) { window.__setValueCalls++; return orig(...a); };
    cm.__svWrapped = true;
  }
});
// Read the immutable example source via the window.EXAMPLES test hook the implementer must expose.
const exSource = await page.evaluate((k) => (window.EXAMPLES ? window.EXAMPLES[k] : null), EX_NAME);

await openExample(EX_NAME);

const openState = await page.evaluate((k) => {
  const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
  const row = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  return {
    value: cm ? cm.getValue() : null,
    sameInstance: !!cm && cm === window.__cm0,
    lint: cm ? cm.getOption('lint') : 'no-cm',
    setValueCalls: window.__setValueCalls,
    rowSelected: !!row && row.classList.contains('sel'),
    inFiles: !!(window.project && window.project.files && window.project.files['bouncy_balls.py']),
  };
}, EX_NAME);

if (exSource == null) fail('(a) window.EXAMPLES not exposed (read-only test hook missing) — cannot verify preview content');
const contentMatches = openState.value != null && exSource != null && openState.value === exSource;
if (contentMatches && openState.sameInstance && !openState.lint
    && openState.setValueCalls === 0 && openState.rowSelected && !openState.inFiles)
  ok('(a) open: editor shows EXAMPLES content via swapDoc (no setValue), one CM, lint UNARMED, row .sel, NOT yet in project.files');
else fail('(a) open wrong: ' + JSON.stringify({ contentMatches, ...openState }));

// ----------------------------------------------------------------------------
// (b) FIRST EDIT PROMOTES. Type a real change into the preview Doc; assert it becomes a real
//     project file under bouncy_balls.py, appears in the Explorer tree with a `●` (.moddot), the
//     Examples row shows its `●`, the SAME Doc holds the typed text (keystroke preserved), and it
//     is RUNNABLE (Start reaches status `running`).
// ----------------------------------------------------------------------------
const SENTINEL_EDIT = '# my edit MARKER_4242\n';
await page.evaluate((s) => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.replaceRange(s, { line: 0, ch: 0 });   // a real content edit -> fires CM "change" -> promote + arm lint
}, SENTINEL_EDIT);
await page.waitForTimeout(150);

const promoteState = await page.evaluate((k) => {
  const p = window.project;
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const treeRow = document.querySelector('#tabs .tab[data-name="bouncy_balls.py"]');
  const exRow = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  return {
    inFiles: !!(p && p.files && p.files['bouncy_balls.py']),
    inOrder: !!(p && p.order && p.order.includes('bouncy_balls.py')),
    // The promoted Doc must be the SAME object the editor is editing (adopted, not re-created).
    sameDocAdopted: !!(p && p.files && p.files['bouncy_balls.py'] && cm.getDoc() === p.files['bouncy_balls.py']),
    treeRow: !!treeRow,
    treeModdot: !!(treeRow && treeRow.querySelector('.moddot')),
    exModdot: !!(exRow && exRow.querySelector('.moddot')),
    // The typed text survived (not reverted to the pristine example).
    typedPresent: cm.getValue().includes('MARKER_4242'),
    cmSame: cm === window.__cm0,
  };
}, EX_NAME);

if (promoteState.inFiles && promoteState.inOrder && promoteState.sameDocAdopted
    && promoteState.treeRow && promoteState.treeModdot && promoteState.exModdot
    && promoteState.typedPresent && promoteState.cmSame)
  ok('(b) first edit PROMOTES: bouncy_balls.py in files+order, same adopted Doc, ● in tree + examples, typed text preserved');
else fail('(b) promote wrong: ' + JSON.stringify(promoteState));

// Runnable: with the promoted file the active single file, Start reaches `running`.
await page.evaluate(() => {
  // make the promoted file the open/active single file so the single-file Start path runs it
  window.project.setActive('bouncy_balls.py');
  if (window.renderTabs) window.renderTabs();
});
await click('#runBtn');
const reachedRunning = await page.waitForFunction(
  () => document.getElementById('status').textContent === 'running',
  null, { timeout: 8000 }).then(() => true).catch(() => false);
if (reachedRunning) ok('(b) promoted example is RUNNABLE: Start reaches status "running"');
else fail('(b) promoted example did not run (status never reached "running")');
// End the run so later assertions are not racing a live loop.
await click('#stopBtn');
await page.waitForTimeout(120);
await page.evaluate(() => setStatus('', 'ready'));

// ----------------------------------------------------------------------------
// (c) PER-FILE UNDO — undo reverts within THAT file only; a different file is untouched, and
//     switching away and back preserves each file's own history.
// ----------------------------------------------------------------------------
const OTHER_BODY = 'other_sentinel = 7\n';
await page.evaluate((body) => {
  // Add a second, distinct file with known content; do not touch bouncy_balls.py.
  window.project.add('other.py', body);
  window.renderTabs();
}, OTHER_BODY);
// Make bouncy_balls.py active, then undo the promoting keystroke.
const undoState = await page.evaluate(() => {
  const p = window.project;
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  p.setActive('bouncy_balls.py');
  const before = cm.getValue();
  cm.undo();                         // reverts toward the pristine example (drops the MARKER edit)
  const afterUndo = cm.getValue();
  const otherBefore = p.text('other.py');
  // switch away to other.py and back — each Doc keeps its own history
  p.setActive('other.py');
  const otherShown = cm.getValue();
  p.setActive('bouncy_balls.py');
  const backShown = cm.getValue();
  return {
    contentChangedByUndo: before !== afterUndo,
    markerGone: !afterUndo.includes('MARKER_4242'),
    otherUntouched: otherBefore === 'other_sentinel = 7\n',
    otherShownCorrect: otherShown === 'other_sentinel = 7\n',
    backMatchesUndo: backShown === afterUndo,   // bouncy_balls history preserved across the switch
  };
});
if (undoState.contentChangedByUndo && undoState.markerGone && undoState.otherUntouched
    && undoState.otherShownCorrect && undoState.backMatchesUndo)
  ok('(c) per-file undo reverts only the active file; other.py untouched; history survives file switches');
else fail('(c) per-file undo wrong: ' + JSON.stringify(undoState));

// ----------------------------------------------------------------------------
// (d) RESET-TO-DEFAULT behind confirm. Re-edit (re-modify) the promoted file, then click `↺`:
//     with confirm accepted, content returns to EXAMPLES[name] and the ● clears (fresh Doc =
//     empty undo stack). With confirm rejected, nothing changes.
// ----------------------------------------------------------------------------
// Re-modify so the ● + .reset control are present again.
await page.evaluate(() => {
  const p = window.project;
  p.setActive('bouncy_balls.py');
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.replaceRange('# remod RESETME_9\n', { line: 0, ch: 0 });
  if (window.renderTabs) window.renderTabs();
});
await page.waitForTimeout(80);

// CANCEL path: the #13 modal is dismissed -> content unchanged.
await page.evaluate((k) => {
  const row = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  const btn = row && row.querySelector('.reset');
  if (btn) btn.click();
}, EX_NAME);
await cancelModal(page);
await page.waitForTimeout(80);
const afterCancel = await page.evaluate(() =>
  (window.project && window.project.files && window.project.files['bouncy_balls.py'])
    ? window.project.text('bouncy_balls.py') : null);
if (afterCancel && afterCancel.includes('RESETME_9'))
  ok('(d) reset CANCEL (modal dismissed): file content unchanged');
else fail('(d) reset cancel wrong — content changed despite a dismissed modal: ' + JSON.stringify({ hasMarker: afterCancel && afterCancel.includes('RESETME_9') }));

// ACCEPT path: confirm the modal -> content == EXAMPLES[name], ● cleared in BOTH surfaces, fresh undo.
await page.evaluate((k) => {
  const row = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  const btn = row && row.querySelector('.reset');
  if (btn) btn.click();
}, EX_NAME);
await acceptModal(page);
await page.waitForTimeout(120);
const afterReset = await page.evaluate((k) => {
  const p = window.project;
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  const treeRow = document.querySelector('#tabs .tab[data-name="bouncy_balls.py"]');
  const exRow = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  const bbText = (p.files && p.files['bouncy_balls.py']) ? p.text('bouncy_balls.py') : null;
  return {
    contentIsPristine: bbText != null && bbText === (window.EXAMPLES ? window.EXAMPLES[k] : '__noex__'),
    treeModdotGone: !(treeRow && treeRow.querySelector('.moddot')),
    exModdotGone: !(exRow && exRow.querySelector('.moddot')),
    // fresh Doc => empty undo stack (only meaningful when the reset file is the active doc).
    freshUndo: p.active === 'bouncy_balls.py' ? (cm.getDoc().historySize().undo === 0) : true,
  };
}, EX_NAME);
if (afterReset.contentIsPristine && afterReset.treeModdotGone && afterReset.exModdotGone && afterReset.freshUndo)
  ok('(d) reset ACCEPT (modal confirmed): content == EXAMPLES[name], ● cleared in tree + examples, fresh undo stack');
else fail('(d) reset accept wrong: ' + JSON.stringify(afterReset));

// ----------------------------------------------------------------------------
// (e) HARD invariant — opening/promoting an example NEVER overwrites a DIFFERENT existing file;
//     and a canonical-name COLLISION auto-suffixes with UNDERSCORE (bouncy_balls_2.py), leaving
//     the existing bouncy_balls.py untouched.
// ----------------------------------------------------------------------------
// Fresh project with two known-sentinel files + a pre-existing real bouncy_balls.py to force a collision.
const MAIN_SENT = 'MAIN_SENTINEL = 111\n';
const ENEMY_SENT = 'ENEMY_SENTINEL = 222\n';
const BB_SENT = 'PREEXISTING_BB = 333\n';
await page.evaluate((s) => {
  window.project.load({ files: { 'main.py': s.main, 'enemy.py': s.enemy, 'bouncy_balls.py': s.bb } });
  window.renderTabs();
}, { main: MAIN_SENT, enemy: ENEMY_SENT, bb: BB_SENT });
await openExamplesView();
await page.waitForTimeout(100);
await openExample(EX_NAME);
// promote via a real edit
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.replaceRange('# collide COLLIDE_X\n', { line: 0, ch: 0 });
});
await page.waitForTimeout(150);
const collide = await page.evaluate((s) => {
  const p = window.project;
  return {
    mainUntouched: p.text('main.py') === s.main,
    enemyUntouched: p.text('enemy.py') === s.enemy,
    bbUntouched: p.text('bouncy_balls.py') === s.bb,            // original collision target NOT clobbered
    suffixUnderscore: p.order.includes('bouncy_balls_2.py'),    // UNDERSCORE suffix (not -2)
    noHyphenSuffix: !p.order.includes('bouncy_balls-2.py'),     // a hyphen would fail isModuleName
    suffixHasEdit: !!(p.files['bouncy_balls_2.py']) && p.text('bouncy_balls_2.py').includes('COLLIDE_X'),
  };
}, { main: MAIN_SENT, enemy: ENEMY_SENT, bb: BB_SENT });
if (collide.mainUntouched && collide.enemyUntouched && collide.bbUntouched
    && collide.suffixUnderscore && collide.noHyphenSuffix && collide.suffixHasEdit)
  ok('(e) HARD invariant: other files byte-identical; collision auto-suffixes to bouncy_balls_2.py (UNDERSCORE), holds the edit');
else fail('(e) cross-file/collision invariant wrong: ' + JSON.stringify(collide));

// ----------------------------------------------------------------------------
// (f) FIRST-PAINT LAZINESS. Re-boot to a fresh page; open the Examples panel + preview an example
//     (NO edit, NO run). Assert no heavy lib loaded and lint stays falsy.
// ----------------------------------------------------------------------------
const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page2.goto(URL, { waitUntil: 'load' });
await page2.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('(f) never booted'));
await page2.click('nav.rail [data-view="examples"]', { timeout: 2500 }).catch(() => {});
await page2.waitForTimeout(120);
await page2.evaluate((k) => {
  const row = document.querySelector(`#examplesPanel .exrow[data-ex="${CSS.escape(k)}"]`);
  if (row) row.click();
}, EX_NAME);
await page2.waitForTimeout(150);
const lazy = await page2.evaluate(() => {
  const cm = document.querySelector('.CodeMirror');
  return {
    amLoaded: !!window.__amLoaded,
    jsZip: typeof window.JSZip,
    diff: typeof window.Diff,
    lint: cm ? cm.CodeMirror.getOption('lint') : 'no-cm',
  };
});
if (!lazy.amLoaded && lazy.jsZip === 'undefined' && lazy.diff === 'undefined' && !lazy.lint)
  ok('(f) first-paint laziness: opening + previewing an example loads nothing (JSZip/Automerge/jsdiff unset, lint falsy)');
else fail('(f) preview tripped a lazy-loader: ' + JSON.stringify(lazy));
await page2.close();

// ----------------------------------------------------------------------------
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'EXAMPLES VERIFY FAILED' : 'EXAMPLES VERIFY OK');
