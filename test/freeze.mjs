// FREEZE-PREVENTION battery (request #14) — the cooperative engine must keep the tab responsive even
// when student code runs a heavy/infinite loop that the old yield-injection missed.
//
// ROOT CAUSE (diagnosed + reproduced): vendor/engine.mjs injects `await __yield__()` only into
// while-loop bodies in async contexts (top-level + gameloop-converted async functions). It did NOT
// inject into (a) FOR loops, or (b) loops nested in ordinary (non-gameloop) functions. Such a loop
// runs synchronously and blocks the single JS thread → the WHOLE TAB FREEZES. The fix broadens the
// injection (throttled — __yield__ only round-trips the browser every 256th plain iteration, so tight
// loops stay fast).
//
// We assert RESPONSIVENESS via a race: after starting a heavy loop, the main thread must still answer
// a page.evaluate() within a few seconds (a frozen thread can't → the eval times out). Because a
// frozen page can't be cleaned up (its JS thread is blocked), EACH test uses its OWN fresh page and
// force-closes it; a hard process failsafe guarantees the battery never hangs.
//
// Run (sequential): python3 -m http.server 8923 ; node test/freeze.mjs http://localhost:8923/

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
// Hard failsafe: a regression that re-introduces a freeze must not hang the battery.
const failsafe = setTimeout(() => { console.error('FREEZE BATTERY TIMED OUT (failsafe)'); process.exit(process.exitCode || 1); }, 210_000);   // headroom for F6/F7

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => ['running', 'ready', 'finished', 'stopped'].includes(document.getElementById('status').textContent),
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
// Run a heavy/infinite loop on a throwaway page and assert the main thread stays responsive.
async function expectResponsive(label, src) {
  const page = await freshPage();
  await runSrc(page, src);
  const resp = await respondsWithin(page, () => document.getElementById('status').textContent, 6000);
  if (resp !== '__FROZEN__') ok(`${label} (responsive; status=${JSON.stringify(resp)})`);
  else fail(`${label} — TAB FROZEN (main thread blocked)`);
  await page.close().catch(() => {});   // force-close (a frozen page can't be stopped cleanly)
}

// F1 — top-level heavy FOR loop (the common beginner freeze: `for i in range(big)`).
await expectResponsive('F1 top-level heavy for-loop stays responsive', 'x = 0\nfor i in range(10**10):\n    x = x + i\n');
// F2 — a heavy loop in the GAME-LOOP function (def main(): while True: ...flip()...; main()) stays
// responsive — these functions ARE made cooperative (gameloop detection → async), and their for/while
// bodies now get yields too.
await expectResponsive('F2 heavy for-loop inside the game-loop function stays responsive', [
  'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((120, 90))',
  'clock = pygame.time.Clock()',
  'def main():',
  '    while True:',
  '        for k in range(10**9):',          // a heavy inner for-loop inside the (async) game loop
  '            pass',
  '        screen.fill((0, 0, 40))',
  '        pygame.display.flip()',
  '        clock.tick(60)',
  'main()',
].join('\n') + '\n');

// F3 — a gameloop that uses `continue` (start / pause / game-over screens — VERY common) must NOT
// freeze. The injected `await __yield__()` sits at the START of the loop body, so `continue`/`break`
// can't skip it. (Regression for #18: the program starts in `state=="start"`, whose branch always
// `continue`s; an end-of-body yield would be skipped every iteration → freeze.)
await expectResponsive('F3 gameloop using `continue` stays responsive (yield at loop-body start)', [
  'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((120, 90))',
  'clock = pygame.time.Clock()', 'state = "start"',
  'while True:',
  '    for e in pygame.event.get():',
  '        pass',
  '    if state == "start":',
  '        screen.fill((0, 0, 0))',
  '        pygame.display.flip()',
  '        clock.tick(60)',
  '        continue',
  '    screen.fill((50, 50, 50))',
  '    pygame.display.flip()',
  '    clock.tick(60)',
].join('\n') + '\n');

// KNOWN DESIGN BOUNDARY (NOT a bug we force-fix here): a heavy COMPUTE loop inside an ordinary helper
// function that is NOT a game loop — e.g. `def work(): for i in range(10**10): ...; x = work()` — can
// still block the thread. The engine DELIBERATELY keeps pure helpers synchronous (engine.mjs
// _AsyncifyCoop/_needs_async, "Pure helpers stay sync so … callers can use real return values").
// Making them cooperative would turn their return value into a coroutine (breaking `x = work()`).
// The stall WATCHDOG (below) surfaces a calm notice for the soft/stage-freeze variant; the only full
// fix for a hard in-helper-loop freeze is moving Pyodide to a Web Worker (a large, separate effort).

// F4 — a BOUNDED for-loop still RUNS TO COMPLETION (throttled, not frozen, not pathologically slow).
{
  const page = await freshPage();
  await runSrc(page, 'total = 0\nfor i in range(50000):\n    total = total + i\nprint("sum", total)\n');
  const finished = await page.waitForFunction(
    () => document.getElementById('status').textContent === 'finished', null, { timeout: 30_000 }
  ).then(() => true).catch(() => false);
  const consoleHasSum = await page.evaluate(() => /sum 1249975000/.test(document.getElementById('console')?.innerText || ''));
  if (finished && consoleHasSum) ok('F4 a bounded 50k for-loop completes (status finished, correct sum) — throttled, not frozen');
  else fail('F4 bounded for-loop did not complete correctly: ' + JSON.stringify({ finished, consoleHasSum }));
  await page.close().catch(() => {});
}

// F5 — REGRESSION: a normal frame-paced gameloop still runs (reaches 'running' and stays there).
{
  const page = await freshPage();
  await runSrc(page, [
    'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((120, 90))',
    'clock = pygame.time.Clock()', 'n = 0', 'while True:',
    '    screen.fill((n % 255, 0, 80))', '    pygame.display.flip()', '    clock.tick(60)', '    n += 1',
  ].join('\n') + '\n');
  const running = await page.waitForFunction(
    () => document.getElementById('status').textContent === 'running', null, { timeout: 20_000 }
  ).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  const stillRunning = await page.evaluate(() => document.getElementById('status').textContent === 'running');
  if (running && stillRunning) ok('F5 regression: a normal frame-paced gameloop still runs at FPS (status stays running)');
  else fail('F5 gameloop regression: ' + JSON.stringify({ running, stillRunning }));
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} }).catch(() => {});
  await page.close().catch(() => {});
}

// W1 — STALL WATCHDOG: a program that drew a frame then stops drawing (a flip-less but yielding loop)
// surfaces a calm "hasn't drawn a new frame" notice — the soft stage-freeze the watchdog targets —
// and window.__engineDiag() exposes the internal run state for diagnosis.
{
  const page = await freshPage();
  await page.evaluate(() => { window.__engineStallMs = 1500; });   // shorten the threshold for the test
  await runSrc(page, [
    'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((100, 80))',
    'screen.fill((0, 0, 40))', 'pygame.display.flip()',   // ONE frame...
    'while True:', '    x = 1',                            // ...then a flip-less (but yielding) loop
  ].join('\n') + '\n');
  const noticed = await page.waitForFunction(
    () => /hasn't drawn a new frame/.test(document.getElementById('console')?.innerText || ''),
    null, { timeout: 12_000 }).then(() => true).catch(() => false);
  const diag = await page.evaluate(() => window.__engineDiag && window.__engineDiag());
  if (noticed) ok('W1 stall watchdog surfaces a calm "no new frame" notice when the stage stops updating');
  else fail('W1 watchdog did not surface the stall notice: ' + JSON.stringify(diag));
  if (diag && diag.flips >= 1 && diag.running) ok('W1  ...window.__engineDiag() reports internal run state (flips>=1, running) for diagnosis');
  else fail('W1 __engineDiag wrong: ' + JSON.stringify(diag));
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch {} }).catch(() => {});
  await page.close().catch(() => {});
}

// F6 — a game loop inside a CLASS METHOD (single-file) must raise the friendly placement
// error, NOT hard-freeze the tab. The transform can never make methods cooperative
// (_SyncBarrier), so the engine must refuse with a clear message — same contract the
// multi-file module path has had via _check_loop_placement. (Diagnosed + reproduced
// 2026-07-03: pre-fix, Run wedged the main thread within the click.)
const CLASS_LOOP = [
  'import pygame', 'pygame.init()', 'screen = pygame.display.set_mode((120, 90))',
  'clock = pygame.time.Clock()',
  'class Game:',
  '    def run(self):',
  '        while True:',
  '            for e in pygame.event.get():',
  '                pass',
  '            screen.fill((0, 0, 40))',
  '            pygame.display.flip()',
  '            clock.tick(60)',
  'Game().run()',
].join('\n') + '\n';
{
  const page = await freshPage();
  await runSrc(page, CLASS_LOOP);
  // Poll for the settled status (fast on green, robust on slow machines); a FROZEN page
  // just times this out and falls through to respondsWithin's __FROZEN__ diagnosis.
  await page.waitForFunction(() => document.getElementById('status').textContent === 'error — see console',
    null, { timeout: 15_000 }).catch(() => {});
  const resp = await respondsWithin(page, () => ({
    status: document.getElementById('status').textContent,
    friendly: /game loop inside a class method/.test(document.getElementById('console')?.innerText || ''),
  }), 6000);
  if (resp !== '__FROZEN__' && resp !== '__ERR__' && resp.status === 'error — see console' && resp.friendly)
    ok('F6 class-method game loop (single-file) raises the friendly placement error, tab responsive');
  else fail('F6 class-method game loop: ' + (resp === '__FROZEN__' ? 'TAB FROZEN (main thread blocked)' : JSON.stringify(resp)));
  await page.close().catch(() => {});
}

// F7 — same contract on the MULTI-FILE ENTRY path (_transform_entry): only imported modules
// were placement-checked; the entry file must refuse a class-method game loop too.
{
  const page = await freshPage();
  await page.evaluate((s) => {
    window.project.load({ files: { 'main.py': s, 'helper.py': 'X = 1\n' },
      order: ['main.py', 'helper.py'], entry: 'main.py', active: 'main.py' });
    window.project.setActive('main.py');
  }, CLASS_LOOP);
  await page.evaluate(() => document.getElementById('runBtn').click());
  // Poll for the settled status (fast on green, robust on slow machines); a FROZEN page
  // just times this out and falls through to respondsWithin's __FROZEN__ diagnosis.
  await page.waitForFunction(() => document.getElementById('status').textContent === 'error — see console',
    null, { timeout: 15_000 }).catch(() => {});
  const resp = await respondsWithin(page, () => ({
    status: document.getElementById('status').textContent,
    friendly: /game loop inside a class method/.test(document.getElementById('console')?.innerText || ''),
  }), 6000);
  if (resp !== '__FROZEN__' && resp !== '__ERR__' && resp.status === 'error — see console' && resp.friendly)
    ok('F7 class-method game loop in a multi-file ENTRY raises the friendly error, tab responsive');
  else fail('F7 multi-file entry class-method loop: ' + (resp === '__FROZEN__' ? 'TAB FROZEN (main thread blocked)' : JSON.stringify(resp)));
  await page.close().catch(() => {});
}

clearTimeout(failsafe);
await browser.close().catch(() => {});
console.log(process.exitCode ? 'FREEZE BATTERY FAILED' : 'FREEZE BATTERY OK');
process.exit(process.exitCode || 0);
