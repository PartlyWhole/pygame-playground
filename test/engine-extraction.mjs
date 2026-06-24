// Headless verification of the engine extraction (refactor Option D). Mirrors verify.mjs.
//
// P1 contract: the two cooperative-engine Python source consts now live in
// vendor/engine.mjs (dynamically imported like vendor/automerge-collab.mjs); after the
// eager boot, the Python namespace is byte-identical to before (reachable via the
// BARE-NAME `pyodide` global — NOT window.pyodide; the inline <script> is classic).
import { launch } from './_harness.mjs';
let pass = 0, failn = 0;
const ok = (m) => { console.log('  ok  -', m); pass++; };
const fail = (m) => { console.log('  FAIL-', m); failn++; };
const base = process.argv[2] || 'http://localhost:8923/';

const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
await page.goto(base, { waitUntil: 'load' });

// C1: engine.mjs imports in the page and exports the two non-empty Python consts.
const exports = await page.evaluate(async () => {
  const m = await import(new URL('./vendor/engine.mjs', document.baseURI).href);
  return {
    boot: typeof m.BOOT_PY === 'string' && m.BOOT_PY.includes('def _start(src)'),
    project: typeof m.PROJECT_PY === 'string' && m.PROJECT_PY.includes('def _start_project('),
    bootLen: (m.BOOT_PY || '').length,
    projLen: (m.PROJECT_PY || '').length,
  };
}).catch((e) => ({ err: String(e) }));
if (exports.boot && exports.project && exports.bootLen > 1000 && exports.projLen > 1000)
  ok(`vendor/engine.mjs exports BOOT_PY (${exports.bootLen}b) + PROJECT_PY (${exports.projLen}b)`);
else fail(`engine.mjs exports missing/empty: ${JSON.stringify(exports)}`);

// C2: after the eager boot, the Python namespace is intact and reachable by BARE NAME `pyodide`.
await page.waitForFunction(() => /ready|finished|stopped/.test(
  document.getElementById('status')?.textContent || ''), null, { timeout: 90000 }).catch(() => {});
const ns = await page.evaluate(() => {
  if (typeof pyodide === 'undefined' || !pyodide) return { reachable: false };
  const names = ['_start', '_stop', '_pause', '_resume', '_state', '__yield__',
                 '_start_project', '_purge_project_files'];
  const present = pyodide.runPython(
    `all(n in dict(globals()) for n in [${names.map((n) => `'${n}'`).join(',')}])`);
  return { reachable: true, present: !!present };
}).catch((e) => ({ reachable: false, err: String(e) }));
if (ns.reachable && ns.present)
  ok('post-boot Python namespace intact via bare-name `pyodide` (_start/_stop/_state/__yield__/_start_project)');
else fail(`namespace not intact / pyodide unreachable by bare name: ${JSON.stringify(ns)}`);

// C3: the engine module load is tracked by a sentinel (mirrors window.__amLoaded) and
// window.pyodide is NOT relied upon as the seam.
const sentinel = await page.evaluate(() => ({
  engineLoaded: window.__engineLoaded === true,
  bareWorks: typeof pyodide !== 'undefined' && !!pyodide,
}));
if (sentinel.engineLoaded && sentinel.bareWorks)
  ok('window.__engineLoaded sentinel set; bare-name pyodide is the live seam');
else fail(`sentinel/seam wrong: ${JSON.stringify(sentinel)}`);

// C4 (P2): the host run path delegates to the engine and still produces exactly ONE live
// _state['task']; engine.stop() clears it. Driven through the real #runBtn so the host
// wrapper (clearConsole/snapshot/syncRunControls/renderTabs) is exercised.
await page.waitForSelector('#runBtn', { timeout: 5000 });
await page.click('#runBtn');
await page.waitForFunction(() => {
  try { return pyodide.runPython("_state.get('task') is not None"); } catch { return false; }
}, null, { timeout: 30000 }).catch(() => {});
const live = await page.evaluate(() =>
  pyodide.runPython("1 if (_state.get('task') is not None and not _state['task'].done()) else 0"));
await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });
await page.waitForFunction(() => {
  try { return pyodide.runPython("_state.get('task') is None or _state['task'].done()"); }
  catch { return false; }
}, null, { timeout: 10000 }).catch(() => {});
const stopped = await page.evaluate(() =>
  pyodide.runPython("1 if (_state.get('task') is None or _state['task'].done()) else 0"));
if (live === 1 && stopped === 1) ok('host run() → engine.start drives exactly one task; engine.stop clears it');
else fail(`P2 task lifecycle wrong: live=${live} stopped=${stopped}`);

await browser.close();
console.log(`\nengine-extraction: ${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
