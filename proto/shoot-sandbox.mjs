// Screenshot the sandbox prototype across a few states. Throwaway tooling.
import { readdirSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE
  || (process.env.HOME + '/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs'));

const cacheDir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const headless = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = `${cacheDir}/${headless}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const out = './proto/shots/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:8923/proto/sandbox.html', { waitUntil: 'load' });
await page.waitForTimeout(700);

const shot = (n) => page.screenshot({ path: `${out}sandbox-${n}.png` });
const clickText = async (t) => { try { await page.getByText(t, { exact: false }).first().click({ timeout: 2500 }); await page.waitForTimeout(450); return true; } catch { return false; } };

await shot('1-default');
console.log('examples tab:', await clickText('Examples'));
await shot('2-examples');
console.log('collab tab:', await clickText('Collaboration'));
await shot('3-collab');
await clickText('Explorer');
console.log('ship.png:', await clickText('ship.png'));
await shot('4-image');
console.log('start:', await clickText('Start'));
await page.waitForTimeout(600);
await shot('5-running');

console.log(errs.length ? `CONSOLE ERRORS (${errs.length}): ` + errs.slice(0, 5).join(' | ') : 'no console errors');
await browser.close();
