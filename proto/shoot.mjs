// Screenshot the IA prototypes (served at :8923) for review. Throwaway tooling.
import { readdirSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE
  || (process.env.HOME + '/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs'));

const cacheDir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const headless = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = `${cacheDir}/${headless}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
mkdirSync('./proto/shots', { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const base = 'http://localhost:8923/proto/';
const out = './proto/shots/';
const pages = ['index.html', 'ia-a.html', 'ia-b.html', 'ia-c.html'];
let errs = 0;

for (const p of pages) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrs = [];
  page.on('console', m => { if (m.type() === 'error') pageErrs.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(String(e)));
  await page.goto(base + p, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const name = p.replace('.html', '');
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`${p}: shot ok${pageErrs.length ? ` · ${pageErrs.length} console errors: ` + pageErrs.slice(0,3).join(' | ') : ''}`);
  if (pageErrs.length) errs += pageErrs.length;
  await page.close();
}
await browser.close();
console.log(errs ? `DONE with ${errs} console errors` : 'DONE clean');
