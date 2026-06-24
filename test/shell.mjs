// Headless verification of the S1 shell restyle (the new rail + 4-view IA, type-aware
// viewer, panes/fullscreen/console-collapse, status pill, and the first-paint laziness
// regression guard). This is the RED contract for S1: it asserts the NEW shell DOM seams
// from docs/specs/2026-06-23-shell-restyle-design.md §10.1 (the 12 assertions). Every
// assertion is engine-independent (no game must run) and must NOT trip a lazy-loader.
// Mirrors the spike-viewer / _harness style: playwright-core launch, page.goto, ok/fail,
// process.exitCode. Server URL = process.argv[2], default http://localhost:8923/.
import { launch } from './_harness.mjs';
import { PNG_B64, MP3_B64, buf } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);
const info = (msg) => console.log('info -', msg);
// Resilient click: a short timeout so a missing seam fails its OWN assertion fast
// (RED phase) instead of hanging 30s and aborting the whole battery. In GREEN the seam
// exists and the click resolves immediately.
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
// State-aware "ensure the Explorer is open" helper. The app's rail click is a clean toggle, so an
// unconditional click on the Explorer icon would COLLAPSE an already-open Explorer. This clicks the
// icon ONLY when the side panel is collapsed OR Explorer is not the active view — never toggling an
// already-open Explorer shut. (Distinct from assertion #3, which deliberately toggles it.)
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
// Boot to a quiescent state (the existing status seam) before probing the shell.
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// ----------------------------------------------------------------------------
// 1. Rail present + 4 views (Explorer · History · Examples · Collaboration).
// ----------------------------------------------------------------------------
const rail = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('nav.rail [role="tab"]'));
  return { count: tabs.length, order: tabs.map(t => t.dataset.view) };
});
if (rail.count === 4 && JSON.stringify(rail.order) === JSON.stringify(['explorer', 'history', 'examples', 'collab']))
  ok('rail present with 4 views in order explorer/history/examples/collab');
else fail('rail wrong: ' + JSON.stringify(rail));

// ----------------------------------------------------------------------------
// 2. View switching: clicking each rail icon shows its panelview, hides the other
//    three, sets aria-selected="true" on exactly one tab.
// ----------------------------------------------------------------------------
const views = ['explorer', 'history', 'examples', 'collab'];
// Start from a non-Explorer active view so the first loop click (Explorer) is a genuine view SWITCH,
// not a re-click on the boot-active Explorer (which the clean toggle (§3.1) would collapse). With the
// active view != the clicked view on every iteration, each click is a switch that shows its panel.
await click('nav.rail [data-view="collab"]');
let switchOk = true;
for (const v of views) {
  await click(`nav.rail [data-view="${v}"]`);
  const state = await page.evaluate((active) => {
    const panels = ['explorer', 'history', 'examples', 'collab'].map(name => {
      const p = document.getElementById('panel-' + name);
      // "visible" = exists and not hidden and laid out.
      const visible = !!p && !p.hidden && p.offsetParent !== null;
      return [name, visible];
    });
    const tabs = Array.from(document.querySelectorAll('nav.rail [role="tab"]'));
    const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.view);
    return { panels: Object.fromEntries(panels), selected };
  }, v);
  const onlyActiveVisible = views.every(name => state.panels[name] === (name === v));
  const oneSelected = state.selected.length === 1 && state.selected[0] === v;
  if (!(onlyActiveVisible && oneSelected)) {
    switchOk = false;
    fail(`view switch to "${v}" wrong: ${JSON.stringify(state)}`);
  }
}
if (switchOk) ok('view switching shows only the active panelview + selects exactly one tab');

// ----------------------------------------------------------------------------
// 3. Click-collapse: with Explorer open, clicking the Explorer icon collapses the
//    side panel (#side.collapsed, panel hidden) BUT the rail stays visible; clicking
//    any icon re-opens.
// ----------------------------------------------------------------------------
await click('nav.rail [data-view="explorer"]');   // ensure Explorer is the open view
const beforeCollapse = await page.evaluate(() =>
  document.getElementById('side') && !document.getElementById('side').classList.contains('collapsed'));
await click('nav.rail [data-view="explorer"]');   // click the ALREADY-open icon -> collapse
const collapsed = await page.evaluate(() => {
  const side = document.getElementById('side');
  const railEl = document.querySelector('nav.rail');
  const explorerPanel = document.getElementById('panel-explorer');
  return {
    sideCollapsed: !!side && side.classList.contains('collapsed'),
    panelHidden: !explorerPanel || explorerPanel.offsetParent === null || explorerPanel.hidden,
    railVisible: !!railEl && railEl.offsetParent !== null,
  };
});
if (beforeCollapse && collapsed.sideCollapsed && collapsed.panelHidden && collapsed.railVisible)
  ok('click-collapse hides the side panel but keeps the rail visible');
else fail('click-collapse wrong: ' + JSON.stringify({ beforeCollapse, ...collapsed }));
await click('nav.rail [data-view="explorer"]');   // re-click re-opens
const reopened = await page.evaluate(() => {
  const side = document.getElementById('side');
  const explorerPanel = document.getElementById('panel-explorer');
  return !!side && !side.classList.contains('collapsed')
    && !!explorerPanel && explorerPanel.offsetParent !== null;
});
if (reopened) ok('re-clicking a rail icon re-opens the side panel');
else fail('side panel did not re-open after collapse');

// ----------------------------------------------------------------------------
// 4. Status pill reflects the real #status seam (setStatus is the only writer).
// ----------------------------------------------------------------------------
async function probeStatus(cls, text, wantClass) {
  return page.evaluate(({ cls, text }) => {
    setStatus(cls, text);
    const el = document.getElementById('status');
    return { text: el.textContent, classList: Array.from(el.classList) };
  }, { cls, text });
}
const sRun = await probeStatus('running', 'running');
const sErr = await probeStatus('error', 'error — see console');
const sBoot = await probeStatus('boot', 'loading Python…');
const sDim = await probeStatus('', 'ready');
const statusOk =
  sRun.text === 'running' && sRun.classList.includes('running')
  && sErr.text === 'error — see console' && sErr.classList.includes('error')
  && sBoot.text === 'loading Python…' && sBoot.classList.includes('boot')
  && sDim.text === 'ready'
  // The .pill chrome class must SURVIVE every setStatus write — the pill bg/border/radius and
  // per-state color hang off `.pill`/`.pill.<state>`, so a writer that clobbers className loses them.
  && sRun.classList.includes('pill') && sErr.classList.includes('pill')
  && sBoot.classList.includes('pill') && sDim.classList.includes('pill');
if (statusOk) ok('status pill reflects the real #status seam (running/error/boot/dim)');
else fail('status pill wrong: ' + JSON.stringify({ sRun, sErr, sBoot, sDim }));
// Restore a quiescent status so later assertions are not confused by 'error'.
await page.evaluate(() => setStatus('', 'ready'));

// ----------------------------------------------------------------------------
// 5. Viewer type switching. Seed an image + an mp3 audio asset + a .txt via the real
//    hidden input; select each in the explorer; assert the viewer body shows the right
//    surface, and #runBtn is hidden for non-.py, visible for .py.
// ----------------------------------------------------------------------------
// Make sure Explorer is open so rows are clickable.
await ensureExplorerOpen();
for (const u of [
  { name: 'pic.png', mime: 'image/png', b64: PNG_B64 },
  { name: 'tune.mp3', mime: 'audio/mpeg', b64: MP3_B64 },
  { name: 'notes.txt', mime: 'text/plain', b64: Buffer.from('hello, not openable').toString('base64') },
]) {
  await page.setInputFiles('#assetInput', { name: u.name, mimeType: u.mime, buffer: buf(u.b64) });
  await page.waitForTimeout(120);
}

// Selecting a file in the explorer = clicking its row. Rows carry data-name (assets and
// .py both render into #tabs per the always-on explorer). Helper opens by clicking the row.
async function openFile(name) {
  await page.evaluate((n) => {
    const row = document.querySelector(`#tabs [data-name="${CSS.escape(n)}"]`);
    if (row) row.click();
  }, name);
  await page.waitForTimeout(150);
}
const runBtnVisible = () => page.evaluate(() => {
  const b = document.getElementById('runBtn');
  if (!b) return null;
  // hidden = display:none or detached-from-layout; visible = laid out.
  return b.offsetParent !== null && getComputedStyle(b).display !== 'none';
});
const viewerBodyHas = (sel) => page.evaluate((s) => !!document.querySelector('#viewerBody ' + s), sel);

// image -> <img>, run hidden
await openFile('pic.png');
const imgOk = await viewerBodyHas('img');
const runHiddenImg = (await runBtnVisible()) === false;
if (imgOk && runHiddenImg) ok('image file shows <img> in the viewer + #runBtn hidden');
else fail(`image viewer wrong (img=${imgOk}, runHidden=${runHiddenImg})`);

// audio (mp3) -> <audio> player + the MP3 warning banner, run hidden
await openFile('tune.mp3');
const audioOk = await viewerBodyHas('audio');
const mp3Warn = await page.evaluate(() => {
  const body = document.getElementById('viewerBody');
  return !!body && /MP3|WAV|OGG|convert/i.test(body.textContent);
});
const runHiddenAudio = (await runBtnVisible()) === false;
if (audioOk && mp3Warn && runHiddenAudio) ok('mp3 shows <audio> player + the unsupported-format warning + #runBtn hidden');
else fail(`audio viewer wrong (audio=${audioOk}, warn=${mp3Warn}, runHidden=${runHiddenAudio})`);

// other (.txt) -> "unable to open" empty state, run hidden
await openFile('notes.txt');
const txtOk = await page.evaluate(() => {
  const body = document.getElementById('viewerBody');
  return !!body && /unable to open|can't open|cannot open/i.test(body.textContent)
    && !body.querySelector('img') && !body.querySelector('audio') && !body.querySelector('.CodeMirror');
});
const runHiddenTxt = (await runBtnVisible()) === false;
if (txtOk && runHiddenTxt) ok('.txt shows the "unable to open" empty state + #runBtn hidden');
else fail(`other-type viewer wrong (emptyState=${txtOk}, runHidden=${runHiddenTxt})`);

// .py -> the single CodeMirror, run VISIBLE
await openFile('main.py');
const pyOk = await viewerBodyHas('.CodeMirror');
const runVisiblePy = (await runBtnVisible()) === true;
if (pyOk && runVisiblePy) ok('.py shows the CodeMirror editor + #runBtn visible');
else fail(`py viewer wrong (cm=${pyOk}, runVisible=${runVisiblePy})`);

// ----------------------------------------------------------------------------
// 6. ONE CodeMirror identity preserved across viewer switches + lint stays falsy.
//    Capture the CM instance on .py, switch to image then back, assert same instance and
//    getOption('lint') still falsy (no eager arm from the viewer swap).
// ----------------------------------------------------------------------------
await openFile('main.py');
await page.evaluate(() => { window.__cmId = document.querySelector('.CodeMirror').CodeMirror; });
await openFile('pic.png');     // swap viewer to image (CM hidden, not destroyed)
await openFile('main.py');     // swap back to .py
const cmIdentity = await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
  return {
    same: !!cm && cm === window.__cmId,
    lint: cm ? cm.getOption('lint') : 'no-cm',
  };
});
if (cmIdentity.same && !cmIdentity.lint)
  ok('one CodeMirror instance survives viewer switches; getOption("lint") still falsy');
else fail('CM identity/lint wrong across viewer switch: ' + JSON.stringify(cmIdentity));

// ----------------------------------------------------------------------------
// 7. Fullscreen toggles exist + invoke a STUBBED requestFullscreen on the right pane.
//    (Browser fullscreen can't run headless, so assert the call + the target element.)
// ----------------------------------------------------------------------------
await page.evaluate(() => {
  window.__fsCalls = [];
  Element.prototype.requestFullscreen = function () {
    window.__fsCalls.push(this.id || this.className || this.tagName);
    return Promise.resolve();
  };
  // Avoid exitFullscreen path: report no current fullscreen element.
  try { Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null }); } catch (e) {}
});
const fsButtons = await page.evaluate(() => ({
  viewerFs: !!document.getElementById('viewerFs'),
  fsBtn: !!document.getElementById('fsBtn'),
  consoleFs: !!document.getElementById('consoleFs'),
}));
if (fsButtons.viewerFs && fsButtons.fsBtn && fsButtons.consoleFs)
  ok('all three fullscreen buttons exist (#viewerFs, #fsBtn, #consoleFs)');
else fail('missing fullscreen button(s): ' + JSON.stringify(fsButtons));
// Each button must call requestFullscreen on a pane element (its enclosing pane), not body.
async function fsTargetFor(btnId) {
  await page.evaluate(() => { window.__fsCalls = []; });
  await click('#' + btnId);
  return page.evaluate(() => window.__fsCalls.slice());
}
const viewerFsCalls = await fsTargetFor('viewerFs');
const stageFsCalls = await fsTargetFor('fsBtn');
const consoleFsCalls = await fsTargetFor('consoleFs');
const fsInvoked = viewerFsCalls.length === 1 && stageFsCalls.length === 1 && consoleFsCalls.length === 1;
// The editor pane is #editorPane, the stage pane is #rightPane/#stage, the console is #drawer/#console.
const targetsOk =
  /editorPane|viewer/i.test(viewerFsCalls.join('')) &&
  /rightPane|stage/i.test(stageFsCalls.join('')) &&
  /drawer|console/i.test(consoleFsCalls.join(''));
if (fsInvoked && targetsOk)
  ok('each fullscreen button invokes requestFullscreen on its own pane element');
else fail(`fullscreen invoke/target wrong: viewer=${JSON.stringify(viewerFsCalls)} stage=${JSON.stringify(stageFsCalls)} console=${JSON.stringify(consoleFsCalls)}`);

// ----------------------------------------------------------------------------
// 8. Console collapse + the inline-flex stash/restore quirk.
//    Drag the console splitter to write an inline flex height, collapse, expand, and
//    assert the dragged height is restored (proto savedDrawerFlex behavior).
// ----------------------------------------------------------------------------
// Pre-seed a dragged inline flex on #drawer so we can verify stash/restore.
await page.evaluate(() => {
  const d = document.getElementById('drawer');
  if (d) d.style.flex = '0 0 222px';
});
const draggedFlex = await page.evaluate(() => document.getElementById('drawer') && document.getElementById('drawer').style.flex);
// Collapse.
await click('#drawerCollapse');
await page.waitForTimeout(60);
const afterCollapse = await page.evaluate(() => {
  const d = document.getElementById('drawer');
  const c = document.getElementById('console');
  const btn = document.getElementById('drawerCollapse');
  return {
    collapsed: !!d && d.classList.contains('collapsed'),
    consoleHidden: !c || c.offsetParent === null,
    aria: btn && btn.getAttribute('aria-expanded'),
    chevron: btn && btn.textContent.trim(),
    inlineFlexCleared: !!d && !d.style.flex,   // quirk: inline flex stashed/cleared on collapse
  };
});
// Expand.
await click('#drawerCollapse');
await page.waitForTimeout(60);
const afterExpand = await page.evaluate(() => {
  const d = document.getElementById('drawer');
  const c = document.getElementById('console');
  const btn = document.getElementById('drawerCollapse');
  return {
    collapsed: !!d && d.classList.contains('collapsed'),
    consoleVisible: !!c && c.offsetParent !== null,
    aria: btn && btn.getAttribute('aria-expanded'),
    restoredFlex: d ? d.style.flex : null,
  };
});
const collapseOk = afterCollapse.collapsed && afterCollapse.consoleHidden
  && afterCollapse.aria === 'false' && afterCollapse.chevron === '▸'
  && afterCollapse.inlineFlexCleared;
const expandOk = !afterExpand.collapsed && afterExpand.consoleVisible
  && afterExpand.aria === 'true' && afterExpand.restoredFlex === draggedFlex;
if (collapseOk && expandOk)
  ok('console collapse hides console + flips aria/chevron; expand restores the dragged inline flex');
else fail('console collapse/expand wrong: ' + JSON.stringify({ draggedFlex, afterCollapse, afterExpand }));

// ----------------------------------------------------------------------------
// 9. Panes present + a simulated side-splitter drag changes #side width within clamp.
// ----------------------------------------------------------------------------
const splitsPresent = await page.evaluate(() => ({
  side: !!document.querySelector('.split[data-split="side"]'),
  viewer: !!document.querySelector('#splitter[data-split="viewer"]') || !!document.querySelector('[data-split="viewer"]'),
  console: !!document.querySelector('#vsplit[data-split="console"]') || !!document.querySelector('[data-split="console"]'),
}));
if (splitsPresent.side && splitsPresent.viewer && splitsPresent.console)
  ok('all three splitters present (side / viewer / console)');
else fail('missing splitter(s): ' + JSON.stringify(splitsPresent));
// Make sure the side panel is expanded (the side splitter is disabled when collapsed).
await ensureExplorerOpen();
// Simulate a mousedown -> mousemove -> mouseup drag on the side splitter, dragging right.
const widthBefore = await page.evaluate(() => {
  const s = document.getElementById('side');
  return s ? s.getBoundingClientRect().width : null;
});
await page.evaluate(() => {
  const sp = document.querySelector('.split[data-split="side"]');
  if (!sp) return;
  const r = sp.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const opts = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y0, button: 0 });
  sp.dispatchEvent(new MouseEvent('mousedown', opts(x0)));
  document.dispatchEvent(new MouseEvent('mousemove', opts(x0 + 60)));   // drag 60px right
  document.dispatchEvent(new MouseEvent('mouseup', opts(x0 + 60)));
});
await page.waitForTimeout(60);
const widthAfter = await page.evaluate(() => {
  const s = document.getElementById('side');
  return s ? s.getBoundingClientRect().width : null;
});
// Clamp per design §6.1 is ~180–440px; the width must change and stay within clamp.
if (widthBefore !== null && widthAfter !== null && widthAfter !== widthBefore
    && widthAfter >= 170 && widthAfter <= 450)
  ok(`side-splitter drag changed #side width within clamp (${Math.round(widthBefore)} -> ${Math.round(widthAfter)})`);
else fail(`side drag did not resize within clamp: before=${widthBefore} after=${widthAfter}`);

// ----------------------------------------------------------------------------
// 10. Explorer always-on (the IA flip): in single-file mode #tabs is VISIBLE and shows
//     the project's file row(s) (inverse of the old "tab strip absent" assertion).
// ----------------------------------------------------------------------------
await page.evaluate(() => {
  window.project.load({ files: { 'main.py': 'a = 1\n' } });   // single file
  window.renderTabs();
});
await ensureExplorerOpen();   // ensure explorer open
const explorerAlwaysOn = await page.evaluate(() => {
  const t = document.getElementById('tabs');
  if (!t || t.offsetParent === null) return { visible: false };
  const rows = Array.from(t.querySelectorAll('[data-name]'));
  const py = rows.filter(r => r.dataset.name === 'main.py');
  return { visible: true, rowCount: rows.length, hasMain: py.length === 1 };
});
if (explorerAlwaysOn.visible && explorerAlwaysOn.hasMain)
  ok('explorer always-on: #tabs visible with the main.py row in single-file mode');
else fail('explorer not always-on: ' + JSON.stringify(explorerAlwaysOn));

// ----------------------------------------------------------------------------
// 11. First-paint laziness regression guard (additive). After boot + opening each rail
//     panel (History, Examples, Collaboration) WITHOUT Run/diff/collab-start, assert
//     nothing eagerly loaded.
// ----------------------------------------------------------------------------
for (const v of ['history', 'examples', 'collab']) {
  await click(`nav.rail [data-view="${v}"]`);
  await page.waitForTimeout(150);
}
const lazy = await page.evaluate(() => ({
  amLoaded: !!window.__amLoaded,
  jsZip: typeof window.JSZip,
  diff: typeof window.Diff,
  lint: (() => { const cm = document.querySelector('.CodeMirror'); return cm ? cm.CodeMirror.getOption('lint') : 'no-cm'; })(),
}));
if (!lazy.amLoaded && lazy.jsZip === 'undefined' && lazy.diff === 'undefined' && !lazy.lint)
  ok('opening rail panels loads nothing eagerly (Automerge/JSZip/jsdiff unset, lint falsy)');
else fail('rail navigation tripped a lazy-loader: ' + JSON.stringify(lazy));

// ----------------------------------------------------------------------------
// 12. Tooltip a11y: focusing a rail icon shows the shared .tooltip[role="tooltip"] with
//     the icon's data-tip text; blur hides it; the icon also has a non-empty aria-label.
// ----------------------------------------------------------------------------
const tipResult = await page.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const icon = document.querySelector('nav.rail [data-view="history"]');
  if (!icon) return { err: 'no history rail icon' };
  const ariaLabel = (icon.getAttribute('aria-label') || '').trim();
  const tipWanted = icon.getAttribute('data-tip') || '';
  icon.focus();
  icon.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await sleep(60);
  const tip = document.querySelector('.tooltip[role="tooltip"]');
  const shownText = tip ? tip.textContent : null;
  const shown = !!tip && (tip.classList.contains('show') || getComputedStyle(tip).visibility === 'visible');
  icon.blur();
  icon.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(60);
  const tip2 = document.querySelector('.tooltip[role="tooltip"]');
  const hidden = !tip2 || (!tip2.classList.contains('show') && getComputedStyle(tip2).visibility === 'hidden');
  return { ariaLabel, tipWanted, shownText, shown, hidden };
});
if (tipResult.shown && tipResult.shownText === tipResult.tipWanted
    && tipResult.hidden && tipResult.ariaLabel.length > 0)
  ok(`tooltip a11y: focus shows "${tipResult.shownText}", blur hides, icon has aria-label "${tipResult.ariaLabel}"`);
else fail('tooltip a11y wrong: ' + JSON.stringify(tipResult));

// ----------------------------------------------------------------------------
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'SHELL VERIFY FAILED' : 'SHELL VERIFY OK');
