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

// State-aware "ensure the Lessons rail view is open" (mirrors ensureExplorerOpen in shell.mjs) — the
// rail click is a clean toggle, so clicking an already-active+open view would COLLAPSE it.
const ensureLessonsOpen = async () => {
  const needsClick = await page.evaluate(() => {
    const side = document.getElementById('side');
    const tab = document.querySelector('nav.rail [data-view="lessons"]');
    const collapsed = !!side && side.classList.contains('collapsed');
    const active = !!tab && tab.getAttribute('aria-selected') === 'true';
    return collapsed || !active;
  });
  if (needsClick) await click('nav.rail [data-view="lessons"]');
};

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
// L2 — STEPPER (one phase at a time) + CONCEPT & DEMO phases. Clicking a lesson opens a stepper that
// shows ONE phase at a time (Concept→Demo→…) with Next/Back. The Demo phase loads the lesson's demo
// source into the editor VIA THE ENGINE (adoptDoc/setActive — never editor.setValue). Mechanism is
// tested with an injected fixture lesson so it's independent of L6's authored content.
// ================================================================================================

// Inject a controlled fixture lesson (concept + demo + a later phase), then re-render the panel.
const FIXTURE_DEMO_SRC = 'WINDOW_SIZE = (320, 240)\nprint("demo", WINDOW_SIZE)\n';
async function installFixture() {
  await page.evaluate((src) => {
    window.LESSONS = [{
      id: 'fix-lesson', title: 'Fixture lesson', steps: [
        { phase: 'concept', text: 'A short concept explanation.' },
        { phase: 'demo', file: 'demo_fixture.py', source: src, instruction: 'Press Start and watch.' },
        { phase: 'tweak', instruction: 'Change a value.' },
      ],
    }];
    // reset to a clean project + the lesson LIST (fixture row visible).
    window.project.load({ files: { 'main.py': 'a=1\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    if (window.lessonClose) window.lessonClose(); else window.renderLessons();
  }, FIXTURE_DEMO_SRC);
}

// L2.1 — clicking a lesson row opens the stepper at the `concept` phase with Next/Back; Back disabled.
{
  await ensureLessonsOpen();
  await installFixture();
  await page.evaluate(() => {
    const row = document.querySelector('#panel-lessons .lesson-row[data-lesson-id="fix-lesson"]');
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(120);
  const s = await page.evaluate(() => {
    const stepper = document.querySelector('#panel-lessons .stepper');
    const phases = [...document.querySelectorAll('#panel-lessons .lesson-phase')];
    const visible = phases.filter(p => !p.hidden && p.offsetParent !== null);
    const next = document.querySelector('#panel-lessons .lesson-next');
    const back = document.querySelector('#panel-lessons .lesson-back');
    return {
      hasStepper: !!stepper,
      phaseCount: phases.length,
      visibleCount: visible.length,
      currentPhase: visible[0]?.dataset.phase,
      hasNext: !!next, hasBack: !!back,
      backDisabled: !!back && (back.disabled || back.getAttribute('aria-disabled') === 'true'),
    };
  });
  if (s.hasStepper && s.phaseCount === 1 && s.visibleCount === 1 && s.currentPhase === 'concept' && s.hasNext && s.hasBack)
    ok('L2.1 clicking a lesson opens the stepper at `concept` with exactly one phase + Next/Back controls');
  else fail('L2.1 stepper open wrong: ' + JSON.stringify(s));
  if (s.backDisabled) ok('L2.1  ...Back is disabled on the first phase');
  else fail('L2.1 Back not disabled on first phase: ' + JSON.stringify(s));
}

// L2.2 — Next advances concept→demo; Back returns; always exactly one phase on screen.
{
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-next')?.click());
  await page.waitForTimeout(80);
  const afterNext = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('#panel-lessons .lesson-phase')].filter(p => !p.hidden);
    const back = document.querySelector('#panel-lessons .lesson-back');
    return { count: vis.length, phase: vis[0]?.dataset.phase, backDisabled: !!back && back.disabled };
  });
  if (afterNext.count === 1 && afterNext.phase === 'demo' && !afterNext.backDisabled)
    ok('L2.2 Next advances concept→demo (one phase visible, Back now enabled)');
  else fail('L2.2 Next did not advance to demo: ' + JSON.stringify(afterNext));
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-back')?.click());
  await page.waitForTimeout(80);
  const afterBack = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('#panel-lessons .lesson-phase')].filter(p => !p.hidden);
    return { count: vis.length, phase: vis[0]?.dataset.phase };
  });
  if (afterBack.count === 1 && afterBack.phase === 'concept')
    ok('L2.2  ...Back returns demo→concept');
  else fail('L2.2 Back did not return to concept: ' + JSON.stringify(afterBack));
}

// L2.3 — the Demo phase's "show the demo" loads the demo source into the editor VIA THE ENGINE: the
// doc lands in project.files, editor.getDoc() is that doc, the text matches the source, and lint did
// NOT arm (i.e. no editor.setValue) — mirrors the laziness/setValue guard.
{
  // arm a setValue spy on the live CM instance.
  await page.evaluate(() => {
    window.__setValueCalls = 0;
    const cm = document.querySelector('.CodeMirror') && document.querySelector('.CodeMirror').CodeMirror;
    if (cm && !cm.__svWrapped) {
      const orig = cm.setValue.bind(cm);
      cm.setValue = function (...a) { window.__setValueCalls++; return orig(...a); };
      cm.__svWrapped = true;
    }
  });
  // advance to demo, click "show the demo".
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-next')?.click());
  await page.waitForTimeout(80);
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-show-demo')?.click());
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const doc = window.project.files['demo_fixture.py'];
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    return {
      inProject: !!doc,
      isActiveDoc: !!doc && cm.getDoc() === doc,
      textMatches: !!doc && doc.getValue().includes('WINDOW_SIZE = (320, 240)'),
      setValueCalls: window.__setValueCalls,
      lint: !!cm.getOption('lint'),
    };
  });
  if (r.inProject && r.isActiveDoc && r.textMatches && r.setValueCalls === 0 && !r.lint)
    ok('L2.3 demo loads into the editor via the engine (project.files gains it, editor doc is it, no setValue, lint off)');
  else fail('L2.3 demo load wrong: ' + JSON.stringify(r));
}

// L2.4 — a persistent "show the demo again" reference control is present on the demo phase.
{
  const r = await page.evaluate(() => {
    const phase = document.querySelector('#panel-lessons .lesson-phase[data-phase="demo"]');
    const showDemo = document.querySelector('#panel-lessons .lesson-show-demo');
    return { onDemo: !!phase, hasShowDemo: !!showDemo };
  });
  if (r.onDemo && r.hasShowDemo) ok('L2.4 a "show the demo (again)" reference control is present on the demo phase');
  else fail('L2.4 show-the-demo reference control missing: ' + JSON.stringify(r));
}

// restore real content + list view for any later sections / reuse.
await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'LESSONS BATTERY FAILED' : 'LESSONS BATTERY OK');
