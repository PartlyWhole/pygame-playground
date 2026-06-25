import { readdirSync } from 'node:fs';
// playwright-core is borrowed (read-only) from a sibling checkout; override the location with
// the PLAYWRIGHT_CORE env var, else default under $HOME (no hardcoded username in the repo).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE
  || (process.env.HOME + '/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs'));
const cacheDir = process.env.HOME + '/Library/Caches/ms-playwright';
const shell = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = cacheDir + '/' + shell + '/chrome-headless-shell-mac-arm64/chrome-headless-shell';
export const launch = () => chromium.launch({ executablePath: exe });

// #13: the aesthetic confirm modal replaced native confirm(). After triggering a delete/replace/
// reset/restore, drive the in-app modal — acceptModal clicks Confirm, cancelModal clicks Cancel. Both
// wait for it to appear AND to close, so a leftover blurred backdrop can't block later interactions.
export async function acceptModal(page, { timeout = 2500 } = {}) {
  await page.waitForSelector('#modalBackdrop [data-act="confirm"]', { timeout }).catch(() => {});
  await page.click('#modalBackdrop [data-act="confirm"]', { timeout }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#modalBackdrop'), null, { timeout }).catch(() => {});
}
export async function cancelModal(page, { timeout = 2500 } = {}) {
  await page.waitForSelector('#modalBackdrop [data-act="cancel"]', { timeout }).catch(() => {});
  await page.click('#modalBackdrop [data-act="cancel"]', { timeout }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#modalBackdrop'), null, { timeout }).catch(() => {});
}
// Is the confirm modal currently open? (assert the gate appeared)
export const modalOpen = (page) => page.evaluate(() => !!document.querySelector('#modalBackdrop .modal[role="dialog"]'));
