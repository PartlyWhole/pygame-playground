// Headless verification of the pygame playground (borrows Trellis's playwright-core read-only).
import { chromium } from '/Users/alan/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs';
import { readdirSync } from 'node:fs';

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
  window.confirm = () => true;
  sel.dispatchEvent(new Event('change'));
});
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

await page.screenshot({ path: '/Users/alan/Desktop/pygame-playground/verify-screenshot.png' });

const realErrors = errors.filter(e => !/favicon/.test(e));
console.log('console errors:', realErrors.length ? realErrors : 'none');
// Python tracebacks are routed to the page's own console div, not console.error;
// JS-level errors here would indicate real plumbing bugs.
if (realErrors.length) fail('unexpected JS console errors');

await browser.close();
console.log(process.exitCode ? 'VERIFY FAILED' : 'VERIFY OK');
