import { chromium } from '/Users/alan/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs';
import { readdirSync } from 'node:fs';
const cacheDir = process.env.HOME + '/Library/Caches/ms-playwright';
const shell = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = cacheDir + '/' + shell + '/chrome-headless-shell-mac-arm64/chrome-headless-shell';
export const launch = () => chromium.launch({ executablePath: exe });
