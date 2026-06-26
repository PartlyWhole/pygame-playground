// LESSONS battery (curriculum lesson-UI, Phase 1) — the five-phase lesson loop as a 5th rail view.
//
// Plan: docs/superpowers/plans/2026-06-24-lesson-ui-phase1.md (LOCAL-ONLY).
// Design: docs/specs/2026-06-24-lesson-ui-phase1-design.md (LOCAL-ONLY).
//
// This battery grows per task:
//   L1 (below) — "Lessons" rail view + declarative window.LESSONS + lesson list (no engine work).
//   L2 — stepper + concept/demo phases.   L3 — predict-before-Run + tweak.
//   L4 — recreate + verify + progress.     L5 — friendly errors.   L6 — content.
//
// Run (sequential; concurrent Pyodide/CDN loads flake):
//   python3 -m http.server 8923            # repo root
//   node test/lessons.mjs http://localhost:8923/
//
// Style mirrors shell.mjs / explorer-tree.mjs: ok()/fail() + process.exitCode.

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished', 'stopped'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));

// ================================================================================================
// L1 — "LESSONS" RAIL VIEW + DECLARATIVE CONTENT + LESSON LIST.
// A 5th rail icon opens a quiet "Lessons" panel that lists the four warm-up lessons from declarative
// window.LESSONS data. Opening the panel costs nothing at first paint (no Pyodide/ruff/Automerge).
// ================================================================================================

// L1.1 — a 5th rail tab exists: nav.rail [data-view="lessons"] (role=tab, aria-label="Lessons"),
// and the rail now has FIVE views in order explorer/history/examples/collab/lessons.
{
  const rail = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('nav.rail [role="tab"]'));
    const lessons = document.querySelector('nav.rail [data-view="lessons"]');
    return {
      count: tabs.length,
      order: tabs.map(t => t.dataset.view),
      hasLessons: !!lessons,
      ariaLabel: lessons ? lessons.getAttribute('aria-label') : null,
      controls: lessons ? lessons.getAttribute('aria-controls') : null,
    };
  });
  if (rail.hasLessons && rail.ariaLabel === 'Lessons' && rail.controls === 'panel-lessons')
    ok('L1.1 a 5th rail tab [data-view="lessons"] exists (aria-label="Lessons", controls #panel-lessons)');
  else fail('L1.1 lessons rail tab missing/mislabeled: ' + JSON.stringify(rail));
  if (rail.count === 5 && JSON.stringify(rail.order) === JSON.stringify(['explorer', 'history', 'examples', 'collab', 'lessons']))
    ok('L1.1  ...rail has 5 views in order explorer/history/examples/collab/lessons');
  else fail('L1.1 rail order wrong: ' + JSON.stringify(rail));
}

// L1.2 — clicking the Lessons tab shows #panel-lessons (role=tabpanel) and hides the other four;
// exactly one tab is aria-selected (lessons). Mirrors shell.mjs's view-switch contract.
{
  await click('nav.rail [data-view="lessons"]');
  const state = await page.evaluate(() => {
    const names = ['explorer', 'history', 'examples', 'collab', 'lessons'];
    const panels = Object.fromEntries(names.map(n => {
      const p = document.getElementById('panel-' + n);
      return [n, !!p && !p.hidden && p.offsetParent !== null];
    }));
    const lp = document.getElementById('panel-lessons');
    const tabs = Array.from(document.querySelectorAll('nav.rail [role="tab"]'));
    const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.dataset.view);
    return { panels, selected, isTabpanel: lp ? lp.getAttribute('role') === 'tabpanel' : false };
  });
  const onlyLessons = ['explorer', 'history', 'examples', 'collab', 'lessons'].every(n => state.panels[n] === (n === 'lessons'));
  if (onlyLessons && state.selected.length === 1 && state.selected[0] === 'lessons' && state.isTabpanel)
    ok('L1.2 clicking Lessons shows #panel-lessons (tabpanel) + hides the other 4 + selects exactly the lessons tab');
  else fail('L1.2 lessons view-switch wrong: ' + JSON.stringify(state));
}

// L1.3 — window.LESSONS is declarative: array of {id, title, steps:[...]}, unique ids, with the four
// warm-up ids present and in order (lesson-0, warmup-0a, warmup-0b, warmup-0c).
{
  const r = await page.evaluate(() => {
    const L = window.LESSONS;
    if (!Array.isArray(L)) return { isArray: false };
    const ids = L.map(x => x && x.id);
    const shapeOk = L.every(x => x && typeof x.id === 'string' && typeof x.title === 'string' && Array.isArray(x.steps));
    const unique = new Set(ids).size === ids.length;
    return { isArray: true, ids, shapeOk, unique };
  });
  const want = ['lesson-0', 'warmup-0a', 'warmup-0b', 'warmup-0c'];
  if (r.isArray && r.shapeOk && r.unique && JSON.stringify(r.ids) === JSON.stringify(want))
    ok('L1.3 window.LESSONS is an array of {id,title,steps[]} with unique ids in order ' + JSON.stringify(want));
  else fail('L1.3 window.LESSONS shape/order wrong: ' + JSON.stringify(r));
}

// L1.4 — the panel renders one .lesson-row[data-lesson-id] per lesson, showing the title, in order.
{
  const r = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#panel-lessons .lesson-row[data-lesson-id]')];
    return {
      ids: rows.map(x => x.dataset.lessonId),
      titlesShown: rows.every(x => {
        const lesson = window.LESSONS.find(l => l.id === x.dataset.lessonId);
        return lesson && x.textContent.includes(lesson.title);
      }),
    };
  });
  const want = ['lesson-0', 'warmup-0a', 'warmup-0b', 'warmup-0c'];
  if (JSON.stringify(r.ids) === JSON.stringify(want) && r.titlesShown)
    ok('L1.4 panel lists one .lesson-row[data-lesson-id] per lesson, with the title, in LESSONS order');
  else fail('L1.4 lesson list render wrong: ' + JSON.stringify(r));
}

// L1.5 — first-paint laziness: opening the Lessons view triggers NO heavy load. #status text is
// unchanged (no transition into a loading state), CM lint stays off, JSZip/Automerge stay unloaded.
{
  // reload to a clean first-paint, then capture status BEFORE touching Lessons.
  await page.goto(URL, { waitUntil: 'load' });
  await booted().catch(() => fail('never rebooted (laziness)'));
  const before = await page.evaluate(() => document.getElementById('status').textContent);
  await click('nav.rail [data-view="lessons"]');
  await page.waitForTimeout(150);
  const lazy = await page.evaluate(() => ({
    statusAfter: document.getElementById('status').textContent,
    jszip: typeof window.JSZip,
    amLoaded: !!window.__amLoaded,
    lint: !!document.querySelector('.CodeMirror')?.CodeMirror?.getOption('lint'),
    rowsRendered: document.querySelectorAll('#panel-lessons .lesson-row').length,
  }));
  if (lazy.statusAfter === before && lazy.jszip === 'undefined' && !lazy.amLoaded && !lazy.lint)
    ok('L1.5 opening Lessons is lazy: #status unchanged, JSZip undefined, Automerge unloaded, CM lint off');
  else fail('L1.5 opening Lessons tripped a load: ' + JSON.stringify({ before, ...lazy }));
  if (lazy.rowsRendered === 4) ok('L1.5  ...and the list rendered on view-open (4 rows)');
  else fail('L1.5 list did not render on view-open: ' + JSON.stringify(lazy));
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'LESSONS BATTERY FAILED' : 'LESSONS BATTERY OK');
