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
    localStorage.removeItem('lessonProgress');   // deterministic lock/done state
    window.LESSONS = [
      { id: 'fix-lesson', title: 'Fixture lesson', steps: [
        { phase: 'concept', text: 'A short concept explanation.' },
        { phase: 'demo', file: 'demo_fixture.py', source: src, instruction: 'Press Start and watch.' },
        { phase: 'tweak', instruction: 'Change a value.',
          predict: { mode: 'choices', prompt: 'What will happen?', choices: ['Bigger window', 'Smaller window', 'An error'] } },
        { phase: 'recreate', scaffold: 'WIDTH = 0\n# write it yourself\n', referenceFile: 'demo_fixture.py',
          instruction: 'Write it yourself. Use “Show the demo” if stuck.' },
        { phase: 'verify', prompt: 'Did the window open and fill? Mark done when it matches.' },
      ] },
      { id: 'fix-lesson-2', title: 'Second fixture', steps: [
        { phase: 'concept', text: 'Second lesson concept.' },
        { phase: 'verify', prompt: 'Done?' },
      ] },
    ];
    // reset to a clean project + the lesson LIST (fixture rows visible).
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
// L3 — PREDICT-BEFORE-RUN gate + TWEAK phase. On a demo/tweak phase carrying a `predict` config,
// Start (#runBtn) is LOCKED until the student commits a prediction; after they Start, the panel shows
// their prediction beside a calm matched/surprised self-check (no grading). The gate must NOT affect
// the regular playground Start when no predict-gated phase is active.
// ================================================================================================

// Navigate the open stepper to a named phase (bounded Next clicks).
async function goToPhase(phase) {
  for (let k = 0; k < 8; k++) {
    const cur = await page.evaluate(() => document.querySelector('#panel-lessons .lesson-phase')?.dataset.phase);
    if (cur === phase) return true;
    await page.evaluate(() => document.querySelector('#panel-lessons .lesson-next')?.click());
    await page.waitForTimeout(60);
  }
  return false;
}

// L3.1 — the tweak phase (has predict) gates Start and renders the prompt + choices.
{
  await ensureLessonsOpen();
  await installFixture();
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-row[data-lesson-id="fix-lesson"]')?.click());
  await page.waitForTimeout(80);
  await goToPhase('tweak');
  const r = await page.evaluate(() => ({
    phase: document.querySelector('#panel-lessons .lesson-phase')?.dataset.phase,
    runDisabled: document.getElementById('runBtn').disabled,
    prompt: document.querySelector('#panel-lessons .predict-prompt')?.textContent || '',
    choices: [...document.querySelectorAll('#panel-lessons .predict-choice')].map(c => c.textContent),
  }));
  if (r.phase === 'tweak' && r.runDisabled && /What will happen/.test(r.prompt) && r.choices.length === 3)
    ok('L3.1 tweak phase gates Start (#runBtn disabled) + renders the predict prompt and 3 choices');
  else fail('L3.1 predict gate/UI wrong: ' + JSON.stringify(r));
}

// L3.2 — selecting a choice enables Commit (Start still locked); committing enables Start + shows it.
{
  await page.evaluate(() => document.querySelector('#panel-lessons .predict-choice[data-i="0"]')?.click());
  await page.waitForTimeout(50);
  const afterSelect = await page.evaluate(() => ({
    commitEnabled: document.querySelector('#panel-lessons .predict-commit')?.disabled === false,
    runStillDisabled: document.getElementById('runBtn').disabled === true,
  }));
  await page.evaluate(() => document.querySelector('#panel-lessons .predict-commit')?.click());
  await page.waitForTimeout(60);
  const afterCommit = await page.evaluate(() => ({
    runEnabled: document.getElementById('runBtn').disabled === false,
    youPredicted: document.querySelector('#panel-lessons .predict-you')?.textContent || '',
  }));
  if (afterSelect.commitEnabled && afterSelect.runStillDisabled)
    ok('L3.2 selecting a choice enables Commit but Start stays locked until committed');
  else fail('L3.2 select state wrong: ' + JSON.stringify(afterSelect));
  if (afterCommit.runEnabled && /Bigger window/.test(afterCommit.youPredicted))
    ok('L3.2  ...committing enables Start and shows "You predicted: Bigger window"');
  else fail('L3.2 commit did not enable Start / show prediction: ' + JSON.stringify(afterCommit));
}

// L3.3 — after Start, the reconcile self-check (.predict-result) appears with matched/surprised.
{
  await page.evaluate(() => { window.project.setActive('main.py'); });   // safe content to run
  await page.evaluate(() => document.getElementById('runBtn').click());
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    hasResult: !!document.querySelector('#panel-lessons .predict-result'),
    matched: !!document.querySelector('#panel-lessons .predict-matched'),
    surprised: !!document.querySelector('#panel-lessons .predict-surprised'),
    youText: document.querySelector('#panel-lessons .predict-you')?.textContent || '',
  }));
  if (r.hasResult && r.matched && r.surprised && /Bigger window/.test(r.youText))
    ok('L3.3 after Start, .predict-result shows the prediction + matched/surprised self-check (no grading)');
  else fail('L3.3 predict-result reconcile wrong: ' + JSON.stringify(r));
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });   // stop the run
  await page.waitForTimeout(80);
}

// L3.4 — the gate does NOT affect Start outside a gated phase (a non-predict phase + closed lesson).
{
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-back')?.click());   // tweak→demo
  await page.waitForTimeout(50);
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-back')?.click());   // demo→concept
  await page.waitForTimeout(50);
  const onConcept = await page.evaluate(() => ({
    phase: document.querySelector('#panel-lessons .lesson-phase')?.dataset.phase,
    runEnabled: document.getElementById('runBtn').disabled === false,
  }));
  await page.evaluate(() => window.lessonClose && window.lessonClose());
  await page.waitForTimeout(50);
  const closedEnabled = await page.evaluate(() => document.getElementById('runBtn').disabled === false);
  if (onConcept.phase === 'concept' && onConcept.runEnabled) ok('L3.4 a non-predict phase (concept) leaves Start enabled');
  else fail('L3.4 concept phase wrongly gated Start: ' + JSON.stringify(onConcept));
  if (closedEnabled) ok('L3.4  ...closing the lesson leaves Start enabled (gate cleared)');
  else fail('L3.4 closing the lesson left Start disabled');
}

// L3.5 — REGRESSION (review): the gate must RELEASE Start when the student navigates AWAY from a
// gated lesson phase (switches rail view OR collapses the panel) — otherwise #runBtn is stuck
// disabled in the main playground. It must RE-ENGAGE when they return to the still-gated phase.
{
  await ensureLessonsOpen();
  await installFixture();
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-row[data-lesson-id="fix-lesson"]')?.click());
  await page.waitForTimeout(80);
  await goToPhase('tweak');   // gated, uncommitted → Start disabled
  const gated = await page.evaluate(() => document.getElementById('runBtn').disabled);
  await page.evaluate(() => document.querySelector('nav.rail [data-view="explorer"]')?.click());   // switch away
  await page.waitForTimeout(80);
  const onExplorer = await page.evaluate(() => document.getElementById('runBtn').disabled);
  await page.evaluate(() => document.querySelector('nav.rail [data-view="lessons"]')?.click());     // back, still gated
  await page.waitForTimeout(80);
  const backOnLessons = await page.evaluate(() => document.getElementById('runBtn').disabled);
  if (gated === true && onExplorer === false && backOnLessons === true)
    ok('L3.5 gate RELEASES Start when switching away from a gated phase, RE-ENGAGES on return');
  else fail('L3.5 gate view-switch wrong: ' + JSON.stringify({ gated, onExplorer, backOnLessons }));
  // collapse the Lessons panel (click the active Lessons tab) → Start released too.
  await page.evaluate(() => document.querySelector('nav.rail [data-view="lessons"]')?.click());
  await page.waitForTimeout(80);
  const collapsed = await page.evaluate(() => ({
    sideCollapsed: document.getElementById('side').classList.contains('collapsed'),
    runDisabled: document.getElementById('runBtn').disabled,
  }));
  if (collapsed.sideCollapsed && collapsed.runDisabled === false)
    ok('L3.5  ...collapsing the Lessons panel also releases Start');
  else fail('L3.5 gate collapse wrong: ' + JSON.stringify(collapsed));
  await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });
}

// ================================================================================================
// L4 — RECREATE (manual) + VERIFY + progress persistence. Recreate loads a scaffold doc the student
// writes themselves (engine-driven); "Show the demo" / "Back to my code" toggle the reference and
// their work WITHOUT clobbering edits. No auto-check (v1 is manual). Verify self-confirm marks the
// lesson done in localStorage and unlocks the next; progress survives reload.
// ================================================================================================

// helper: the name of the active editor doc (its key in project.files).
const activeDocName = () => page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror, doc = cm.getDoc();
  return Object.keys(window.project.files).find(k => window.project.files[k] === doc) || null;
});

// L4.1 — the recreate phase loads the scaffold into the editor via the engine (no setValue).
let recreateName = null;
{
  await ensureLessonsOpen();
  await installFixture();
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-row[data-lesson-id="fix-lesson"]')?.click());
  await page.waitForTimeout(80);
  // arm a setValue spy.
  await page.evaluate(() => {
    window.__svCalls = 0;
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    if (cm && !cm.__svWrap) { const o = cm.setValue.bind(cm); cm.setValue = (...a) => { window.__svCalls++; return o(...a); }; cm.__svWrap = true; }
  });
  await goToPhase('recreate');
  recreateName = await activeDocName();
  const r = await page.evaluate((rn) => ({
    inProject: !!window.project.files[rn],
    text: rn ? window.project.files[rn].getValue() : '',
    sv: window.__svCalls,
    lint: !!document.querySelector('.CodeMirror').CodeMirror.getOption('lint'),
  }), recreateName);
  if (recreateName && r.inProject && r.text.includes('write it yourself') && r.sv === 0 && !r.lint)
    ok('L4.1 recreate loads the scaffold into the editor via the engine (project.files gains it, no setValue, lint off)');
  else fail('L4.1 recreate scaffold load wrong: ' + JSON.stringify({ recreateName, ...r }));
}

// L4.2 — "Show the demo" / "Back to my code" toggle reference vs the student's work WITHOUT clobbering.
{
  // simulate a student edit on the recreate doc (replaceRange — not setValue).
  await page.evaluate((rn) => window.project.files[rn].replaceRange('STUDENT_EDIT\n', { line: 0, ch: 0 }), recreateName);
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-show-demo')?.click());
  await page.waitForTimeout(80);
  const onDemo = await page.evaluate((rn) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const active = Object.keys(window.project.files).find(k => window.project.files[k] === cm.getDoc());
    return { activeIsDemo: active === 'demo_fixture.py', recreateExists: !!window.project.files[rn], recreateKeepsEdit: !!window.project.files[rn] && window.project.files[rn].getValue().includes('STUDENT_EDIT') };
  }, recreateName);
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-my-code')?.click());
  await page.waitForTimeout(80);
  const back = await page.evaluate((rn) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    const active = Object.keys(window.project.files).find(k => window.project.files[k] === cm.getDoc());
    return { activeIsRecreate: active === rn, keepsEdit: cm.getValue().includes('STUDENT_EDIT') };
  }, recreateName);
  if (onDemo.activeIsDemo && onDemo.recreateExists && onDemo.recreateKeepsEdit)
    ok('L4.2 "Show the demo" swaps to the reference; the recreate doc + its edits persist in project.files');
  else fail('L4.2 show-demo did not preserve recreate doc: ' + JSON.stringify(onDemo));
  if (back.activeIsRecreate && back.keepsEdit)
    ok('L4.2  ..."Back to my code" returns to the student\'s doc with edits intact (no clobber)');
  else fail('L4.2 back-to-my-code lost edits/doc: ' + JSON.stringify(back));
}

// L4.3 — NO auto-check on recreate (v1 manual): no pass/fail verdict element; only manual aids.
{
  const r = await page.evaluate(() => {
    // re-select the recreate phase (back to my code already did). Check the recreate phase DOM.
    const phase = document.querySelector('#panel-lessons .lesson-phase[data-phase="recreate"]');
    return {
      onRecreate: !!phase,
      hasShowDemo: !!document.querySelector('#panel-lessons .lesson-show-demo'),
      hasMyCode: !!document.querySelector('#panel-lessons .lesson-my-code'),
      hasAutoCheck: !!document.querySelector('#panel-lessons .lesson-check, #panel-lessons .check-pass, #panel-lessons .check-fail'),
      hasConfirm: !!document.querySelector('#panel-lessons .lesson-confirm'),   // confirm belongs to VERIFY, not recreate
    };
  });
  if (r.onRecreate && r.hasShowDemo && r.hasMyCode && !r.hasAutoCheck && !r.hasConfirm)
    ok('L4.3 recreate is manual: reference aids present, NO auto-check verdict, no pass/fail gate (self-confirm is on Verify)');
  else fail('L4.3 recreate auto-check expectations wrong: ' + JSON.stringify(r));
}

// L4.4 — Verify self-confirm marks the lesson done in localStorage + unlocks the next lesson.
{
  // fix-lesson-2 should be LOCKED before fix-lesson is verified.
  const beforeLocked = await page.evaluate(() => {
    if (window.lessonClose) window.lessonClose();
    return document.querySelector('.lesson-row[data-lesson-id="fix-lesson-2"]')?.classList.contains('locked');
  });
  // re-open fix-lesson, go to verify, confirm.
  await page.evaluate(() => document.querySelector('.lesson-row[data-lesson-id="fix-lesson"]')?.click());
  await page.waitForTimeout(80);
  await goToPhase('verify');
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-confirm')?.click());
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const prog = JSON.parse(localStorage.getItem('lessonProgress') || '{}');
    if (window.lessonClose) window.lessonClose();
    return {
      progressHasLesson: Array.isArray(prog.done) && prog.done.includes('fix-lesson'),
      l1done: document.querySelector('.lesson-row[data-lesson-id="fix-lesson"]')?.classList.contains('done'),
      l2locked: document.querySelector('.lesson-row[data-lesson-id="fix-lesson-2"]')?.classList.contains('locked'),
    };
  });
  if (beforeLocked === true) ok('L4.4 the next lesson (fix-lesson-2) is LOCKED until the first is verified');
  else fail('L4.4 next lesson was not locked initially: ' + JSON.stringify({ beforeLocked }));
  if (after.progressHasLesson && after.l1done && after.l2locked === false)
    ok('L4.4  ...Verify self-confirm writes lessonProgress (fix-lesson done) + unlocks the next lesson');
  else fail('L4.4 verify confirm/unlock wrong: ' + JSON.stringify(after));
}

// L4.5 — progress persists across reload (real lessons): a done lesson stays done; next unlocked; rest locked.
{
  await page.evaluate(() => localStorage.setItem('lessonProgress', JSON.stringify({ done: ['lesson-0'] })));
  await page.goto(URL, { waitUntil: 'load' });
  await booted().catch(() => fail('never rebooted (L4.5)'));
  await ensureLessonsOpen();
  const r = await page.evaluate(() => ({
    l0done: document.querySelector('.lesson-row[data-lesson-id="lesson-0"]')?.classList.contains('done'),
    aUnlocked: document.querySelector('.lesson-row[data-lesson-id="warmup-0a"]')?.classList.contains('locked') === false,
    bLocked: document.querySelector('.lesson-row[data-lesson-id="warmup-0b"]')?.classList.contains('locked'),
  }));
  if (r.l0done && r.aUnlocked && r.bLocked)
    ok('L4.5 progress survives reload: lesson-0 stays done, warmup-0a unlocked, warmup-0b locked');
  else fail('L4.5 reload persistence/lock wrong: ' + JSON.stringify(r));
  await page.evaluate(() => localStorage.removeItem('lessonProgress'));   // cleanup
}

// L4.6 — REGRESSION (review): corrupt lessonProgress (non-string done items) must not break the
// list render or the unlock chain — progressGet sanitizes it to an empty done set.
{
  await page.evaluate(() => localStorage.setItem('lessonProgress', JSON.stringify({ done: [123, null, { id: 'x' }] })));
  await page.goto(URL, { waitUntil: 'load' });
  await booted().catch(() => fail('never rebooted (L4.6)'));
  await ensureLessonsOpen();
  const r = await page.evaluate(() => ({
    rows: document.querySelectorAll('#panel-lessons .lesson-row').length,
    firstUnlocked: document.querySelector('.lesson-row[data-lesson-id="lesson-0"]')?.classList.contains('locked') === false,
  }));
  if (r.rows === 4 && r.firstUnlocked)
    ok('L4.6 corrupt lessonProgress is sanitized: list still renders 4 rows, first lesson unlocked (no crash)');
  else fail('L4.6 corrupt-progress resilience wrong: ' + JSON.stringify(r));
  await page.evaluate(() => localStorage.removeItem('lessonProgress'));
}

// ================================================================================================
// L5 — FRIENDLY-ERROR map. A known runtime error (two-arg set_mode, NameError, …) is rewritten in
// the instructor's encouraging voice in #console, ALWAYS keeping the line number (locating the line
// is part of the skill). The raw traceback is preserved and #status still reaches the `error` token.
// An unmapped error falls through to the normal message (with its line) — no crash.
// ================================================================================================

// run a program that errors; return the resulting #console text.
async function runCodeExpectError(src) {
  await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });   // no lesson gate
  await page.evaluate((s) => {
    window.project.load({ files: { 'main.py': s }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.setActive('main.py');
  }, src);
  await page.evaluate(() => document.getElementById('runBtn').click());
  await page.waitForFunction(() => /error/.test(document.getElementById('status').textContent), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => document.getElementById('console')?.innerText || '');
}

// L5.1 — two-arg set_mode → friendly rewrite whose OWN line carries the line number; raw preserved.
{
  const out = await runCodeExpectError('import pygame\npygame.init()\nscreen = pygame.display.set_mode(800, 600)\n');
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  const friendlyLine = out.split('\n').find(l => /set_mode wants ONE/i.test(l)) || '';
  if (friendlyLine && /line 3/.test(friendlyLine) && /size must be two numbers/.test(out) && /error/.test(status))
    ok('L5.1 two-arg set_mode → friendly rewrite WITH the line number; raw traceback preserved; #status error');
  else fail('L5.1 wrong: ' + JSON.stringify({ friendlyLine, raw: /size must be two numbers/.test(out), status, out: out.slice(0, 260) }));
}

// L5.2 — a NameError → friendly rewrite + line number; raw preserved.
{
  const out = await runCodeExpectError('print(undefined_name)\n');
  const friendlyLine = out.split('\n').find(l => /recognize that name|not defined yet|check the spelling/i.test(l)) || '';
  if (friendlyLine && /line 1/.test(friendlyLine) && /NameError/.test(out))
    ok('L5.2 NameError → friendly rewrite WITH the line number; raw traceback preserved');
  else fail('L5.2 wrong: ' + JSON.stringify({ friendlyLine, raw: /NameError/.test(out), out: out.slice(0, 260) }));
}

// L5.3 — an UNMAPPED error falls through: raw error + its line number, NO friendly line, no crash.
{
  const out = await runCodeExpectError('x = 1 / 0\n');
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  if (!/💡/.test(out) && /ZeroDivisionError/.test(out) && /line 1/.test(out) && /error/.test(status))
    ok('L5.3 unmapped error (ZeroDivisionError) falls through: raw error + line number, no friendly line, no crash');
  else fail('L5.3 wrong: ' + JSON.stringify({ noFriendly: !/💡/.test(out), raw: /ZeroDivisionError/.test(out), hasLine: /line 1/.test(out), status, out: out.slice(0, 260) }));
}

// ================================================================================================
// L6 — CONTENT: Lesson 0 + warm-up 0a/0b/0c (condensed). The real declarative content replaces the
// L1 stubs: each lesson is the full five-phase loop with a runnable demo, a quick-choices predict, a
// recreate scaffold + reference, and a verify prompt. (The mechanism is already covered by L1-L5 via
// the fixture; here we smoke-test the shipped content.)
// ================================================================================================
const LESSON_IDS = ['lesson-0', 'warmup-0a', 'warmup-0b', 'warmup-0c'];

// L6.1 — structural completeness: every lesson has the 5 canonical phases with non-empty content.
{
  const r = await page.evaluate((ids) => ids.map(id => {
    const lesson = window.LESSONS.find(l => l.id === id);
    if (!lesson) return { id, missing: true };
    const by = p => lesson.steps.find(s => s.phase === p);
    const concept = by('concept'), demo = by('demo'), tweak = by('tweak'), recreate = by('recreate'), verify = by('verify');
    return {
      id,
      concept: !!concept && !!concept.text && concept.text.length > 20,
      demo: !!demo && !!demo.source && demo.source.includes('import pygame') && !!demo.file,
      tweak: !!tweak && !!tweak.predict && Array.isArray(tweak.predict.choices) && tweak.predict.choices.length >= 2,
      recreate: !!recreate && !!recreate.scaffold && !!recreate.referenceFile,
      verify: !!verify && !!verify.prompt,
    };
  }), LESSON_IDS);
  const allOk = r.every(x => !x.missing && x.concept && x.demo && x.tweak && x.recreate && x.verify);
  if (allOk) ok('L6.1 all 4 lessons have the 5 canonical phases with non-empty content (concept/demo/predict/scaffold+ref/verify)');
  else fail('L6.1 content structure incomplete: ' + JSON.stringify(r));
}

// L6.2 — each lesson's primary demo RUNS through the engine (reaches running/finished, no error).
{
  const results = [];
  for (const id of LESSON_IDS) {
    const src = await page.evaluate((lid) => {
      const lesson = window.LESSONS.find(l => l.id === lid);
      const demo = lesson && lesson.steps.find(s => s.phase === 'demo');
      return demo ? demo.source : null;
    }, id);
    if (!src) { results.push({ id, okRun: false, reason: 'no demo source' }); continue; }
    await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });
    await page.evaluate((s) => { window.project.load({ files: { 'main.py': s }, order: ['main.py'], entry: 'main.py', active: 'main.py' }); window.project.setActive('main.py'); }, src);
    await page.evaluate(() => document.getElementById('runBtn').click());
    const okRun = await page.waitForFunction(() => ['running', 'finished'].includes(document.getElementById('status').textContent), null, { timeout: 25_000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(200);
    const status = await page.evaluate(() => document.getElementById('status').textContent);
    results.push({ id, okRun, status, noError: !/error/.test(status) });
    await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} });
    await page.waitForTimeout(200);
  }
  if (results.every(r => r.okRun && r.noError))
    ok('L6.2 every lesson\'s primary demo runs through the engine (reaches running/finished, no immediate error)');
  else fail('L6.2 a demo did not run cleanly: ' + JSON.stringify(results));
}

// L6.3 — 0a teaches the two-arg set_mode mis-step, and running it fires L5's friendly error.
{
  const present = await page.evaluate(() => {
    const lesson = window.LESSONS.find(l => l.id === 'warmup-0a');
    return JSON.stringify(lesson).includes('set_mode(WIDTH, HEIGHT)') || /two loose numbers/.test(JSON.stringify(lesson));
  });
  const out = await runCodeExpectError('import pygame\npygame.init()\nWIDTH, HEIGHT = 800, 600\nscreen = pygame.display.set_mode(WIDTH, HEIGHT)\n');
  const friendly = /set_mode wants ONE/i.test(out);
  if (present && friendly)
    ok('L6.3 0a teaches the two-arg set_mode mis-step, and running it fires the friendly tuple-lesson error');
  else fail('L6.3 0a set_mode mis-step / friendly error wrong: ' + JSON.stringify({ present, friendly, out: out.slice(0, 200) }));
}

// ================================================================================================
// #16 — Showing a lesson demo makes its .py file appear in the explorer tree IMMEDIATELY, without
// having to visit the explorer (where it used to first "appear"). Regression for showCurrentDemo
// calling renderTabs. (Run mechanics already worked; this locks the tree-sync the user reported.)
{
  await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });
  await page.evaluate(() => window.project.load({ files: { 'main.py': '# main\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' }));
  await ensureLessonsOpen();
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-row[data-lesson-id="lesson-0"]')?.click());
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-next')?.click());   // concept -> demo
  await page.evaluate(() => document.querySelector('#panel-lessons .lesson-show-demo')?.click());
  const r = await page.evaluate(() => ({
    inProject: window.project.order.includes('demo_lesson0.py'),
    inTree: [...document.querySelectorAll('#tabs .tab.py')].some(n => n.dataset.name === 'demo_lesson0.py'),
  }));
  if (r.inProject && r.inTree)
    ok('#16 Show-the-demo adds the demo to the explorer tree immediately (no explorer visit needed)');
  else fail('#16 demo file not in tree right after show-demo: ' + JSON.stringify(r));
}

// #15 — when a program ENDS, the stage is blanked to black (the last frame is removed, mirroring a
// local pygame window closing). Run a draw-once blue fill, let it finish, sample the centre pixel.
{
  await page.evaluate(() => { if (window.lessonClose) window.lessonClose(); });
  await page.evaluate(() => window.project.load({ files: { 'main.py': 'import pygame\npygame.init()\ns=pygame.display.set_mode((200,150))\ns.fill((0,0,255))\npygame.display.flip()\n' }, order: ['main.py'], entry: 'main.py', active: 'main.py' }));
  await page.evaluate(() => window.project.setActive('main.py'));
  await page.evaluate(() => document.getElementById('runBtn').click());
  await page.waitForFunction(() => ['finished', 'stopped', 'ready'].includes(document.getElementById('status').textContent), null, { timeout: 20_000 }).catch(() => {});
  const px = await page.evaluate(() => { const c = document.getElementById('canvas'); return Array.from(c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data); });
  if (px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 255)
    ok('#15 canvas clears to opaque black when a program finishes (last frame removed): ' + px);
  else fail('#15 canvas not black after the program finished: ' + px);
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'LESSONS BATTERY FAILED' : 'LESSONS BATTERY OK');
