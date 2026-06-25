import { readdirSync } from 'node:fs';
// playwright-core is borrowed (read-only) from a sibling checkout; override the location with
// the PLAYWRIGHT_CORE env var, else default under $HOME (no hardcoded username in the repo).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE
  || (process.env.HOME + '/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs'));
const cacheDir = process.env.HOME + '/Library/Caches/ms-playwright';
const shell = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = cacheDir + '/' + shell + '/chrome-headless-shell-mac-arm64/chrome-headless-shell';
export const launch = () => chromium.launch({ executablePath: exe });
