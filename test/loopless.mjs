// LOOPLESS-ANIMATION battery — a straight-line program (no game loop) with several
// display.flip() calls must show EACH frame, exactly like desktop pygame, not just the
// final one. The cooperative engine injects `await __yield__()` at loop-body starts; a
// loopless program has no loop, so pre-fix every flip ran in one JS turn and the browser
// only ever composited the LAST frame. The fix injects a cooperative yield after each
// top-level (not-inside-a-loop) flip/update so the browser paints between them.
//
// Instrument: an in-page rAF recorder samples the canvas centre on every animation frame
// (no driver round-trip latency), collecting the sequence of composited colours. We use a
// long ramp of distinct full-screen fills with NO sleep/wait/tick between flips, so the
// ONLY thing that can hand control to the browser is the injected post-flip yield.
//
// Run: python3 -m http.server 8923 ; node test/loopless.mjs http://localhost:8923/

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const failsafe = setTimeout(() => { console.error('LOOPLESS BATTERY TIMED OUT'); process.exit(process.exitCode || 1); }, 120_000);

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
    null, { timeout: 120_000 }).catch(() => fail('never booted'));
  return page;
}
const respondsWithin = async (page, fn, ms) => {
  let to; const timeout = new Promise(r => { to = setTimeout(() => r('__FROZEN__'), ms); });
  const res = await Promise.race([page.evaluate(fn).catch(() => '__ERR__'), timeout]);
  clearTimeout(to); return res;
};
async function runSrc(page, src) {
  await page.evaluate((s) => {
    window.project.load({ files: { 'main.py': s }, order: ['main.py'], entry: 'main.py', active: 'main.py' });
    window.project.setActive('main.py');
  }, src);
  await page.evaluate(() => document.getElementById('runBtn').click());
}
// rAF recorder over the canvas centre; returns distinct red-channel shades seen (in order).
const startRecorder = (page) => page.evaluate(() => {
  window.__shades = [];
  const cv = document.getElementById('canvas');
  const rec = () => {
    try {
      const r = cv.getContext('2d').getImageData((cv.width / 2) | 0, (cv.height / 2) | 0, 1, 1).data[0];
      if (window.__shades[window.__shades.length - 1] !== r) window.__shades.push(r);
    } catch (e) {}
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
});

// L1 — a loopless ramp of 30 distinct full-screen fills, each flipped, NO waits between.
// Each distinct shade the recorder captures = a browser paint that happened between two
// flips = an injected post-flip yield fired. Pre-fix: only the final shade composites
// (all flips in one turn) -> ~1 non-black shade. Post-fix: the browser paints between
// flips -> many distinct shades. Assert a wide margin (>=5) so it can never flake green.
{
  const page = await freshPage();
  await startRecorder(page);
  // Emit 30 STRAIGHT-LINE frames (no Python loop — a loop would get start-yields and paint
  // pre-fix, defeating the isolation). Each is a distinct full-screen red shade + flip.
  let src = 'import pygame\npygame.init()\nscreen = pygame.display.set_mode((200, 150))\n';
  for (let i = 1; i <= 30; i++) src += `screen.fill((${i * 8}, 0, 0)); pygame.display.flip()\n`;
  await runSrc(page, src);
  const resp = await respondsWithin(page, () => document.getElementById('status').textContent, 8000);
  await page.waitForTimeout(300);
  const shades = await page.evaluate(() => window.__shades.filter(s => s !== 0));   // drop black end-clear
  const distinct = new Set(shades).size;
  if (resp === '__FROZEN__') fail('L1 loopless ramp — TAB FROZEN');
  else if (distinct >= 5) ok(`L1 loopless multi-flip animates: ${distinct} distinct frames composited (pre-fix: 1)`);
  else fail(`L1 loopless multi-flip did NOT animate — only ${distinct} distinct frame(s) painted: ${JSON.stringify(shades)}`);
  await page.close().catch(() => {});
}

// L2 — the user's real shape: draw a moving rect at 3 x-positions, flip each, no loop.
// The recorder samples a column only the MIDDLE frame's rect covers; pre-fix that frame
// never composites, so its colour is never seen.
{
  const page = await freshPage();
  await page.evaluate(() => {
    window.__mid = [];
    const cv = document.getElementById('canvas');
    const rec = () => { try { const d = cv.getContext('2d').getImageData(150, 50, 1, 1).data; window.__mid.push([d[0], d[1], d[2]]); } catch (e) {} requestAnimationFrame(rec); };
    requestAnimationFrame(rec);
  });
  const src = [
    'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((800, 600))',
    'screen.fill("white"); pygame.draw.rect(screen, "green", (0, 0, 100, 100)); pygame.display.flip()',
    'screen.fill("white"); pygame.draw.rect(screen, "green", (100, 0, 100, 100)); pygame.display.flip()',
    'screen.fill("white"); pygame.draw.rect(screen, "green", (200, 0, 100, 100)); pygame.display.flip()',
  ].join('\n') + '\n';
  await runSrc(page, src);
  await respondsWithin(page, () => document.getElementById('status').textContent, 8000);
  await page.waitForTimeout(300);
  const sawMiddle = await page.evaluate(() => window.__mid.some(p => p[0] < 80 && p[1] > 150 && p[2] < 80));   // green RECT (not white bg) at x=150 => frame 1 composited
  if (sawMiddle) ok('L2 the middle frame of a loopless 3-flip program is composited (was invisible pre-fix)');
  else fail('L2 middle frame never painted — loopless animation still broken');
  await page.close().catch(() => {});
}

// L3 — DETERMINISTIC no-regression + fix check via the engine's OWN transform passes
// (accessible in the pyodide namespace, like _state/_stop in other suites). Count the
// injected `await __yield__()` nodes for two shapes:
//   - a loopless 3x flip program  -> exactly 3 (one after each top-level flip)  [pre-fix: 0]
//   - a `while True: flip(); tick()` gameloop -> exactly 1 (loop-start only; the fix must
//     NOT add a second, in-loop post-flip yield — that double-yield would halve FPS).
{
  const page = await freshPage();
  const countYields = (src) => page.evaluate((s) => {
    try {
      return pyodide.runPython(`
import ast as _a
def _cnt(_src):
    _t = _a.parse(_src)
    _asy = _Asyncify(); _t = _asy.visit(_t)
    _t = _Awaiter(_asy.converted, *_time_names(_t)).visit(_t)
    _t = _InjectYield().visit(_t)
    _a.fix_missing_locations(_t)
    return sum(1 for _n in _a.walk(_t)
               if isinstance(_n, _a.Await) and isinstance(_n.value, _a.Call)
               and isinstance(_n.value.func, _a.Name) and _n.value.func.id == '__yield__')
_cnt(${JSON.stringify(s)})
`);
    } catch (e) { return 'ERR: ' + e; }
  }, src);

  const loopless = 'import pygame\npygame.init()\ns = pygame.display.set_mode((10, 10))\ns.fill((1, 0, 0)); pygame.display.flip()\ns.fill((2, 0, 0)); pygame.display.flip()\ns.fill((3, 0, 0)); pygame.display.flip()\n';
  const gameloop = 'import pygame\npygame.init()\ns = pygame.display.set_mode((10, 10))\nc = pygame.time.Clock()\nwhile True:\n    s.fill((0, 0, 0))\n    pygame.display.flip()\n    c.tick(60)\n';
  const nLoopless = await countYields(loopless);
  const nGameloop = await countYields(gameloop);
  if (nLoopless === 3) ok('L3 loopless 3x flip gets exactly 3 injected yields (one per top-level flip)');
  else fail(`L3 loopless yield count wrong: expected 3, got ${JSON.stringify(nLoopless)}`);
  if (nGameloop === 1) ok('L3 no-regression: while-True gameloop keeps exactly 1 loop-start yield (no in-loop double-yield)');
  else fail(`L3 gameloop yield count wrong: expected 1, got ${JSON.stringify(nGameloop)} (double-yield regression?)`);
  await page.close().catch(() => {});
}

// L4 — behavioural no-regression: a normal frame-paced gameloop still reaches + stays
// 'running' (mirrors freeze.mjs F5; guards against the fix breaking real gameloops).
{
  const page = await freshPage();
  await runSrc(page, [
    'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((120, 90))',
    'clock = pygame.time.Clock()', 'n = 0', 'while True:',
    '    screen.fill((n % 255, 0, 0))', '    pygame.display.flip()', '    clock.tick(60)', '    n += 1',
  ].join('\n') + '\n');
  const running = await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 20_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  const still = await page.evaluate(() => document.getElementById('status').textContent === 'running');
  if (running && still) ok('L4 no-regression: a normal frame-paced gameloop still runs (status stays running)');
  else fail(`L4 gameloop regressed: ${JSON.stringify({ running, still })}`);
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} }).catch(() => {});
  await page.close().catch(() => {});
}

clearTimeout(failsafe);
await browser.close().catch(() => {});
console.log(process.exitCode ? 'LOOPLESS BATTERY FAILED' : 'LOOPLESS BATTERY OK');
process.exit(process.exitCode || 0);
