// Headless verification of the asset (sprite/sound) feature. Mirrors verify.mjs.
import { launch } from './_harness.mjs';
import { PNG_B64, WAV_B64, OGG_B64, MP3_B64, buf } from './fixtures.mjs';

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

// 1. Asset chip exists and shows the folder glyph.
const chip = await page.textContent('#assetChip').catch(() => null);
if (chip && chip.includes('📁')) ok('asset chip present: ' + chip);
else fail('no #assetChip with 📁 (got ' + JSON.stringify(chip) + ')');

await browser.close();
console.log(process.exitCode ? 'ASSETS VERIFY FAILED' : 'ASSETS VERIFY OK');
