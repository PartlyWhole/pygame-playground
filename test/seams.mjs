// Seam-audit battery: the EXECUTABLE inventory of every window/bare seam the ES-module
// refactor must preserve (spec 2026-07-01 §4). Read-only — no clicks, no runs — so it is
// safe to run at any point in the extraction. If this battery is green, the seam contract
// holds; if a refactor step silently drops a global, this fails by NAME instead of some
// unrelated suite failing by symptom.
import { launch } from './_harness.mjs';

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
  () => ['ready', 'running', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// 1. bare `pyodide` — a classic-script global (NOT necessarily window.pyodide).
const bare = await page.evaluate(() =>
  typeof pyodide !== 'undefined' && pyodide !== null && typeof pyodide.runPython === 'function');
bare ? ok('bare pyodide reachable + booted') : fail('bare pyodide missing/unbooted');

// 2. window.* FUNCTION seams (tests call these via window or bare-name-resolving-to-window).
const fns = ['setStatus', 'run', 'tabMenu', 'newFilePrompt', 'renderHistory', 'restoreSnapshot',
  'renderTabs', 'confirmModal', 'toast', '__closePopMenu', 'uploadFiles', 'openExample',
  'renderLessons', 'lessonClose', '__flushSave', 'runFile', '__engineDiag'];
const missingFns = await page.evaluate(
  (names) => names.filter(n => typeof window[n] !== 'function'), fns);
missingFns.length === 0
  ? ok('all ' + fns.length + ' window function seams present')
  : fail('missing window fns: ' + missingFns.join(', '));

// 3. window.* OBJECT seams.
const objs = ['project', 'assetFS', 'assetStore', 'historyStore', 'EXAMPLES', 'LESSONS',
  'FRIENDLY_ERRORS', 'editor'];
const missingObjs = await page.evaluate(
  (names) => names.filter(n => window[n] == null || typeof window[n] !== 'object' && typeof window[n] !== 'function'),
  objs);
missingObjs.length === 0
  ? ok('all ' + objs.length + ' window object seams present')
  : fail('missing window objects: ' + missingObjs.join(', '));

// 4. project API shape + LIVE CodeMirror Doc values (17 suites pin this).
const proj = await page.evaluate(() => {
  const p = window.project;
  if (!p) return { missing: true };
  const api = ['load', 'setActive', 'add', 'adoptDoc', 'addFolder', 'rename', 'move', 'remove',
    'serialize', 'text', 'isMulti'].filter(k => typeof p[k] !== 'function');
  const doc = p.files && p.files[p.active];
  return { api, liveDoc: !!doc && typeof doc.getValue === 'function',
           entry: typeof p.entry === 'string', order: Array.isArray(p.order) };
});
(!proj.missing && proj.api.length === 0 && proj.liveDoc && proj.entry && proj.order)
  ? ok('project API intact; files[] values are live CodeMirror Docs')
  : fail('project shape: ' + JSON.stringify(proj));

// 5. ONE CodeMirror + the identity invariant files[active] === editor.getDoc().
const cm = await page.evaluate(() => ({
  count: document.querySelectorAll('.CodeMirror').length,
  identity: !!window.project && !!window.editor && window.project.files[window.project.active] === window.editor.getDoc(),
}));
(cm.count === 1 && cm.identity)
  ? ok('ONE CodeMirror; files[active] === editor.getDoc()')
  : fail('CodeMirror invariant: ' + JSON.stringify(cm));

// 6. selectedFolder must LIVE on window and accept BARE writes (upload.mjs:140 assigns it bare).
// Proves residency + writability, NOT that modules read it live — upload.mjs checks 4/4b are the
// behavioral backstop for the live-read half of spec §4.2.
const sf = await page.evaluate(() => {
  if (typeof window.selectedFolder !== 'string') return 'window.selectedFolder is not a string';
  const prev = window.selectedFolder;
  selectedFolder = '__seamtest__';                 // bare write, exactly like upload.mjs
  const landed = window.selectedFolder === '__seamtest__';
  selectedFolder = prev;
  return landed || 'bare write did not land on window.selectedFolder';
});
sf === true ? ok('selectedFolder lives on window and accepts bare writes')
            : fail('selectedFolder: ' + sf);

// closedFolders: bare Set consumed typeof-guarded by upload.mjs/save.mjs. (__engineStallMs
// is a write-seam checked by freeze.mjs; not asserted here — it's undefined until a test sets it.)
const cf = await page.evaluate(() => typeof closedFolders !== 'undefined' && closedFolders instanceof Set);
cf ? ok('closedFolders bare Set present') : fail('closedFolders bare seam missing');

// 7. Laziness sentinels: heavy libs must NOT be loaded at boot; engine IS (eager boot kick).
const lazy = await page.evaluate(() => ({
  jszip: typeof window.JSZip, diff: typeof window.Diff,
  am: typeof window.__amLoaded, engine: window.__engineLoaded === true,
  eager: performance.getEntriesByType('resource').map(r => r.name)
    .filter(n => /automerge|jszip|jsdiff|ruff|addon\/lint\//i.test(n)),
}));
(lazy.jszip === 'undefined' && lazy.diff === 'undefined' && lazy.am === 'undefined' && lazy.engine && lazy.eager.length === 0)
  ? ok('lazy gates intact (JSZip/Diff/Automerge unloaded; engine loaded at boot)')
  : fail('laziness: ' + JSON.stringify(lazy));

// 8. #status token vocabulary (quiescent states only — this battery never starts a run).
const tok = await page.evaluate(() => document.getElementById('status').textContent);
['ready', 'running', 'finished', 'stopped', 'paused'].includes(tok)
  ? ok(`status token '${tok}' in vocabulary`)
  : fail('unexpected status token: ' + tok);

// 9. No JS errors during boot — the cheapest detector of "boots to ready but a moved
// module threw or 404'd after boot" during the module split.
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
realErrors.length === 0 ? ok('no JS console errors during boot')
                        : fail('JS errors: ' + JSON.stringify(realErrors.slice(0, 5)));

await browser.close();
console.log(process.exitCode ? 'SEAMS VERIFY FAILED' : 'SEAMS VERIFY OK');
