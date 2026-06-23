// SPIKE: unified Start/Stop semantics for the redesign.
// De-risks the four claims the PM flagged:
//   (1) Stop cancels the run (status -> stopped).
//   (2) The LAST rendered frame stays on the canvas — the task cancel does NOT
//       clear it (pixel check against a known fill color).
//   (3) The console stays intact across Stop (a printed marker survives).
//   (4) "Running" is observable, so a single unified control can BLOCK re-run
//       until stopped (one main program at a time). Current run() does NOT block
//       (it stop+restarts); this proves the signal a guard would read.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// A program that draws ONE known frame (solid red), prints a console marker, then
// idles in a cooperative loop that never redraws. The last frame is the red fill.
const PROG = [
  'import pygame',
  'pygame.init()',
  'screen = pygame.display.set_mode((300, 200))',
  'screen.fill((210, 50, 60))',
  'pygame.display.flip()',
  'print("MARKER_KEEPME")',
  'clock = pygame.time.Clock()',
  'while True:',
  '    pygame.event.pump()',
  '    clock.tick(60)',
].join('\n');

await page.evaluate((src) => { document.querySelector('.CodeMirror').CodeMirror.setValue(src); }, PROG);
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 15_000 }).catch(() => fail('idle program did not start'));

// (4) Running is observable two ways: the status pill, and the live asyncio task.
const runningSignal = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  taskLive: pyodide.runPython("_state['task'] is not None and not _state['task'].done()"),
}));
if (runningSignal.status === 'running' && runningSignal.taskLive)
  ok('running state is observable (status="running" + live asyncio task) — a unified control can block re-run');
else fail('running state not observable: ' + JSON.stringify(runningSignal));

// The known frame is on the canvas (red at center) before we stop.
const px = () => page.evaluate(() => Array.from(
  document.getElementById('canvas').getContext('2d').getImageData(150, 100, 1, 1).data));
const beforeStop = await px();
const isRed = (p) => p[0] > 170 && p[1] < 110 && p[2] < 120;
if (isRed(beforeStop)) ok('known last frame is rendered (red center pixel): ' + beforeStop);
else fail('expected red frame before stop, got ' + beforeStop);

// (1) Stop.
await page.click('#stopBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'stopped',
  null, { timeout: 5000 }).catch(() => fail('stop did not transition to "stopped"'));
ok('Stop cancels the run (status="stopped")');

// (2) Last frame persists after the cancel — sample now and again after a delay
// to prove it is both intact and frozen (not cleared, not animating).
const afterStop = await px();
await page.waitForTimeout(700);
const laterStop = await px();
if (isRed(afterStop) && JSON.stringify(afterStop) === JSON.stringify(laterStop))
  ok('last frame STAYS on canvas after Stop (cancel does not clear it; frozen): ' + afterStop);
else fail(`frame not preserved/frozen after stop: after=${afterStop} later=${laterStop}`);

// (3) Console intact across Stop — the printed marker survives, and the "stopped"
// note was appended (clearConsole only runs on Run, never on Stop).
const consoleText = await page.textContent('#console');
if (/MARKER_KEEPME/.test(consoleText)) ok('console intact across Stop (printed marker survives)');
else fail('console lost its content on stop: ' + consoleText.slice(0, 200));
if (/stopped/.test(consoleText)) ok('console shows the "stopped" note');

// (4b) The task is now done — a guard reading this signal would now ALLOW a new run.
const afterTask = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  taskDone: pyodide.runPython("_state['task'] is None or _state['task'].done()"),
}));
if (afterTask.taskDone && afterTask.status === 'stopped')
  ok('after Stop the task is done — a unified control would re-enable Start');
else fail('task not done after stop: ' + JSON.stringify(afterTask));

// Re-run after stop works and clears the console (Run semantics) — confirms we can
// distinguish Run (clear) from Stop (keep).
await page.evaluate(() => { document.querySelector('.CodeMirror').CodeMirror.setValue(
  'import pygame\npygame.init()\ns=pygame.display.set_mode((200,150))\nn=0\nwhile True:\n    s.fill((20,(n*5)%255,90))\n    pygame.display.flip()\n    n+=1\n'); });
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running',
  null, { timeout: 10_000 }).catch(() => fail('re-run after stop failed'));
const clearedConsole = await page.textContent('#console');
if (!/MARKER_KEEPME/.test(clearedConsole)) ok('Run clears the console (distinct from Stop, which keeps it)');
else fail('console not cleared on a fresh Run');

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'RUNSTOP SPIKE FAILED' : 'RUNSTOP SPIKE OK');
