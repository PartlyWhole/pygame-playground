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

// 2. Upload a PNG via the real hidden file input -> MEMFS file + chip count.
await page.setInputFiles('#assetInput',
  { name: 'dot.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForTimeout(200);
const chipAfter = await page.textContent('#assetChip');
if (/1/.test(chipAfter)) ok('chip shows count after upload: ' + chipAfter);
else fail('chip did not show 1 after upload (got ' + JSON.stringify(chipAfter) + ')');
const inFs = await page.evaluate(() => pyodide.FS.analyzePath('dot.png').exists);
if (inFs) ok('uploaded file written to MEMFS');
else fail('uploaded file not in MEMFS');

// 3. Persistence: reload, asset rehydrates from IndexedDB into MEMFS.
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('did not reboot'));
await page.waitForTimeout(200);
const chipReload = await page.textContent('#assetChip');
const fsReload = await page.evaluate(() => pyodide.FS.analyzePath('dot.png').exists);
if (/1/.test(chipReload) && fsReload) ok('asset persisted across reload (IndexedDB -> MEMFS)');
else fail(`asset did not persist (chip=${JSON.stringify(chipReload)} memfs=${fsReload})`);

// 4. Real user path: load the uploaded sprite, blit it, check the canvas pixel.
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue([
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((200, 150))',
    'screen.fill((0, 0, 0))',
    'sprite = pygame.image.load("dot.png").convert_alpha()',
    'screen.blit(sprite, (50, 50))',
    'pygame.display.flip()',
  ].join('\n'));
});
await page.click('#runBtn');
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const spritePx = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  return Array.from(g.getImageData(58, 58, 1, 1).data);  // inside the blit, magenta
});
// fixture is magenta (R high, G low, B high)
if (spritePx[0] > 150 && spritePx[1] < 100 && spritePx[2] > 150) ok('uploaded sprite blits to canvas: ' + spritePx);
else fail('sprite pixel wrong: ' + spritePx);

await browser.close();
console.log(process.exitCode ? 'ASSETS VERIFY FAILED' : 'ASSETS VERIFY OK');
