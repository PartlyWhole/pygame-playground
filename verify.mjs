// Headless verification of the pygame playground (borrows Trellis's playwright-core read-only).
import { readdirSync } from 'node:fs';
// playwright-core borrowed read-only from a sibling checkout; override via PLAYWRIGHT_CORE env,
// else default under $HOME (no hardcoded username in the repo).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE
  || (process.env.HOME + '/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs'));

const cacheDir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const headless = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = `${cacheDir}/${headless}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

await page.goto(process.argv[2] || 'http://localhost:8923/', { waitUntil: 'load' });

// 1. Boot: status reaches "running" (auto-run of default example) within 90s.
await page.waitForFunction(
  () => document.getElementById('status').textContent === 'running',
  null, { timeout: 90_000 },
).catch(() => fail('status never reached "running": ' +
  // eslint-disable-next-line no-undef
  'see console'));
console.log('boot+autorun status:', await page.textContent('#status'));

// 2. Canvas is actually animating: two frames differ.
const frame = () => page.evaluate(() => document.getElementById('canvas').toDataURL());
const f1 = await frame();
await page.waitForTimeout(500);
const f2 = await frame();
console.log('canvas animating:', f1 !== f2 ? 'YES' : 'NO');
if (f1 === f2) fail('canvas frames identical — not animating');

// 3. Page still responsive (loop is yielding): evaluate round-trips fast.
const t0 = Date.now();
await page.evaluate(() => 1 + 1);
const dt = Date.now() - t0;
console.log(`main thread responsive: ${dt}ms`);
if (dt > 500) fail('main thread blocked');

// 4. Stop works.
await page.click('#stopBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'stopped', null, { timeout: 5000 })
  .catch(() => fail('stop did not transition status'));
console.log('stop:', await page.textContent('#status'));

// 5. Asyncify path: load Snake (def main() + nested while loops) and run.
await page.evaluate(() => {
  const sel = document.getElementById('examples');
  sel.value = 'Snake';
  sel.dispatchEvent(new Event('change'));
});
// #13: the example-replace confirm is now the aesthetic modal — accept it so Snake loads + runs.
await page.click('#modalBackdrop [data-act="confirm"]', { timeout: 3000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('#modalBackdrop'), null, { timeout: 3000 }).catch(() => {});
await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 15_000 })
  .catch(() => fail('snake did not start'));
// Sample frames immediately — after ~1.8s the snake hits the wall and the
// game-over screen is (correctly) static.
await page.waitForTimeout(200);
const s1 = await frame();
await page.waitForTimeout(500);
const s2 = await frame();
console.log('snake animating:', s1 !== s2 ? 'YES' : 'NO');
if (s1 === s2) fail('snake canvas not animating');
const snakeStatus = await page.textContent('#status');
console.log('snake status:', snakeStatus);
if (snakeStatus !== 'running') fail('snake stopped unexpectedly (transform bug?)');

// 6. Keyboard reaches pygame: wait for game over (static screen), press R, game restarts (animating again).
await page.waitForTimeout(2500); // snake has crashed into the wall by now
const g1 = await frame();
await page.waitForTimeout(400);
const g2 = await frame();
console.log('game-over screen static (as expected):', g1 === g2 ? 'YES' : 'no (still playing)');
await page.click('#canvas');
await page.keyboard.press('r');
await page.waitForTimeout(600);
const k1 = await frame();
await page.waitForTimeout(500);
const k2 = await frame();
console.log('keyboard restart (R) re-animates:', k1 !== k2 ? 'YES' : 'NO');
if (g1 === g2 && k1 === k2) fail('keyboard input did not reach pygame (R restart had no effect)');

// 7. Error path: bad code shows a traceback, page survives.
await page.evaluate(() => {
  window.editor_set = true;
});
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('import pygame\npygame.init()\nboom()\n');
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('error'), null, { timeout: 10_000 })
  .catch(() => fail('error status not shown for bad code'));
const consoleText = await page.textContent('#console');
console.log('error path shows traceback:', /NameError.*boom/s.test(consoleText) ? 'YES' : 'NO — ' + consoleText.slice(0, 200));
if (!/NameError/.test(consoleText)) fail('no NameError traceback in console');

// 8. Re-run after error works (restart semantics).
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue(`import pygame\npygame.init()\nscreen = pygame.display.set_mode((400, 300))\nn = 0\nwhile True:\n    screen.fill(((n * 3) % 255, 80, 120))\n    pygame.display.flip()\n    n += 1\n`);
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 10_000 })
  .catch(() => fail('re-run after error failed'));
const r1 = await frame();
await page.waitForTimeout(400);
const r2 = await frame();
console.log('re-run animating (untick-ed while True):', r1 !== r2 ? 'YES' : 'NO');
if (r1 === r2) fail('re-run canvas not animating');

// 9. "Stage 1" shape: draw once, time.sleep, draw again. Must NOT freeze the
// tab (Pyodide's time.sleep busy-waits unless rewritten to an await).
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue([
    'import pygame, time',
    'pygame.init()',
    'screen = pygame.display.set_mode((400, 300))',
    'screen.fill((200, 60, 60))',
    'pygame.display.flip()',
    'time.sleep(2)',
    'screen.fill((60, 200, 60))',
    'pygame.display.flip()',
  ].join('\n'));
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 10_000 })
  .catch(() => fail('stage-1 program did not start'));
await page.waitForTimeout(700); // we are now inside the 2s sleep
const sleepFrame = await frame();
const st0 = Date.now();
await page.evaluate(() => 1 + 1); // would stall if time.sleep busy-waited
const sdt = Date.now() - st0;
console.log(`responsive during time.sleep: ${sdt}ms`);
if (sdt > 500) fail('tab frozen during time.sleep (busy-wait regression)');
await page.waitForFunction(() => document.getElementById('status').textContent === 'finished', null, { timeout: 10_000 })
  .catch(() => fail('stage-1 program never finished (sleep not honored?)'));
const doneFrame = await frame();
console.log('time.sleep pauses then continues:', sleepFrame !== doneFrame ? 'YES' : 'NO');
if (sleepFrame === doneFrame) fail('second draw after time.sleep not visible');

// 10. for-loop pacing (user-reported): draw once, then 30 × pygame.time.wait(100)
// in a FOR loop (no while → no injected yields), then pygame.quit(). The waits
// must be honored as real pauses, the tab must stay responsive, and the program
// should take ~3s — not finish instantly.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue([
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((600, 300))',
    'screen.fill((20, 20, 10))',
    'pygame.display.flip()',
    'for i in range(30):',
    '    pygame.event.pump()',
    '    pygame.time.wait(100)',
    'pygame.quit()',
  ].join('\n'));
});
const w0 = Date.now();
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 10_000 })
  .catch(() => fail('for-loop wait program did not start'));
await page.waitForTimeout(800); // inside the 3s of waits
const wt0 = Date.now();
await page.evaluate(() => 1 + 1);
const wdt = Date.now() - wt0;
console.log(`responsive during pygame.time.wait loop: ${wdt}ms`);
if (wdt > 500) fail('tab frozen during pygame.time.wait loop');
const stillRunning = await page.textContent('#status');
if (stillRunning !== 'running') fail(`waits not honored — already "${stillRunning}" after 0.8s`);
await page.waitForFunction(() => document.getElementById('status').textContent === 'finished', null, { timeout: 15_000 })
  .catch(() => fail('for-loop wait program never finished'));
const elapsed = Date.now() - w0;
console.log(`for-loop waits honored: ran ${elapsed}ms (expect ~3000+boot)`);
if (elapsed < 2500) fail('finished too fast — waits skipped');

// 11. pygame.quit() must not poison the next run.
await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('import pygame\npygame.init()\ns = pygame.display.set_mode((300, 200))\nn = 0\nwhile True:\n    s.fill((n % 255, 120, 60))\n    pygame.display.flip()\n    n += 5\n');
});
await page.click('#runBtn');
await page.waitForFunction(() => document.getElementById('status').textContent === 'running', null, { timeout: 10_000 })
  .catch(() => fail('run after pygame.quit() did not start'));
const q1 = await frame();
await page.waitForTimeout(400);
const q2 = await frame();
console.log('run after pygame.quit() animates:', q1 !== q2 ? 'YES' : 'NO');
if (q1 === q2) fail('canvas dead after a prior pygame.quit()');

await page.screenshot({ path: './verify-screenshot.png' });

const realErrors = errors.filter(e => !/favicon/.test(e));
console.log('console errors:', realErrors.length ? realErrors : 'none');
// Python tracebacks are routed to the page's own console div, not console.error;
// JS-level errors here would indicate real plumbing bugs.
if (realErrors.length) fail('unexpected JS console errors');

await browser.close();
console.log(process.exitCode ? 'VERIFY FAILED' : 'VERIFY OK');
