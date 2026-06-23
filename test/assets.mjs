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

// 5. Sound API path: upload WAV, play it, assert no exception + AudioContext exists.
await page.setInputFiles('#assetInput',
  { name: 'beep.wav', mimeType: 'audio/wav', buffer: buf(WAV_B64) });
await page.waitForTimeout(150);
await page.evaluate(() => {
  document.querySelector('.CodeMirror').CodeMirror.setValue([
    'import pygame',
    'pygame.init()',
    'pygame.display.set_mode((120, 90))',
    'pygame.mixer.init()',
    's = pygame.mixer.Sound("beep.wav")',
    'ch = s.play()',
    'print("PLAY_OK", ch is not None, round(s.get_length(), 2))',
  ].join('\n'));
});
await page.click('#runBtn');   // a real user gesture; resumeAudio() resumes SDL's context (created on mixer.init)
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const soundConsole = await page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
if (/PLAY_OK True/.test(soundConsole)) ok('Sound.play() returned a channel, no exception');
else fail('sound play path failed: ' + soundConsole.slice(0, 200));
const acCount = await page.evaluate(() => (window.__audioContexts || []).length);
if (acCount > 0) ok('AudioContext captured: ' + acCount);
else fail('no AudioContext captured (shim not installed?)');
// Informational only: headless Chromium is permissive so the context is already
// 'running'; the headed-browser resume-on-gesture path is the documented manual check.
const acState = await page.evaluate(() => (window.__audioContexts || []).map(c => c.state));
console.log('info - AudioContext states after Run gesture: ' + acState.join(','));

// S1: assets are re-homed into the always-on Explorer. Open the Explorer rail view to
// surface the asset section (#assetChip/#assetPanel + .asset-row selectors preserved).
const openExplorer = () => page.evaluate(() => {
  const tab = document.querySelector('[data-view="explorer"]');
  if (tab) tab.click();
  if (typeof renderAssetPanel === 'function') renderAssetPanel();
});

// 6. No hard cap: a >10 MB file is accepted, and the Explorer shows a real
//    browser-storage metric (used vs available).
await page.setInputFiles('#assetInput',
  { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024) });
await page.waitForTimeout(250);
const bigInFs = await page.evaluate(() => pyodide.FS.analyzePath('big.png').exists);
if (bigInFs) ok('large (11 MB) file accepted — no hard cap');
else fail('large file rejected — cap not removed');
await openExplorer();
await page.waitForFunction(() => {
  const el = document.getElementById('apStorage');
  return el && /storage/i.test(el.textContent) && /\d/.test(el.textContent);
}, null, { timeout: 5000 }).catch(() => {});
const storageText = await page.evaluate(() => document.getElementById('apStorage')?.textContent || '');
if (/storage/i.test(storageText) && /\d/.test(storageText)) ok('Explorer shows browser-storage metric: ' + storageText.trim());
else fail('no storage metric in Explorer (got ' + JSON.stringify(storageText) + ')');

// 7. MP3 upload shows a warning flag on its asset row.
await page.setInputFiles('#assetInput',
  { name: 'tune.mp3', mimeType: 'audio/mpeg', buffer: buf(MP3_B64) });
await page.waitForTimeout(150);
await openExplorer();   // assets live in the always-on Explorer (no popover toggle)
const warnShown = await page.evaluate(() =>
  !!document.querySelector('#assetPanel [data-name="tune.mp3"] .asset-warn'));
if (warnShown) ok('MP3 shows unsupported-format warning');
else fail('no warning badge on MP3 row');

// 8. Remove via the asset row -> MEMFS unlinked.
await page.click('#assetPanel [data-name="tune.mp3"] .asset-remove');
await page.waitForTimeout(150);
const goneFs = await page.evaluate(() => pyodide.FS.analyzePath('tune.mp3').exists);
const chipNow = (await page.textContent('#assetChip')).trim();
if (!goneFs) ok('removed asset unlinked from MEMFS; chip=' + chipNow);
else fail('removed file still in MEMFS');

// 9. A filename containing a double-quote must still remove correctly
// (data-name must be escaped so dataset.name round-trips the real name).
await page.setInputFiles('#assetInput',
  { name: 'q"x.png', mimeType: 'image/png', buffer: buf(PNG_B64) });
await page.waitForTimeout(150);
const removeResult = await page.evaluate(() => {
  const panel = document.getElementById('assetPanel');
  panel.hidden = false;
  if (typeof renderAssetPanel === 'function') renderAssetPanel();   // ensure rows rendered
  const row = [...panel.querySelectorAll('.asset-row')].find(r => r.dataset.name === 'q"x.png');
  if (!row) return 'no-row';
  row.querySelector('.asset-remove').click();
  return 'clicked';
});
await page.waitForTimeout(150);
const quoteGone = await page.evaluate(() => !pyodide.FS.analyzePath('q"x.png').exists);
if (removeResult === 'clicked' && quoteGone) ok('quoted filename removes correctly (data-name escaped)');
else fail(`quoted filename remove broken (row=${removeResult}, gone=${quoteGone})`);

// 10. A click originating on the hidden file input must not close the panel
// (otherwise "+ add files" self-closes the popover before the picker returns).
await page.evaluate(() => { document.getElementById('assetPanel').hidden = false; });
await page.evaluate(() =>
  document.getElementById('assetInput').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(50);
const panelStillOpen = await page.evaluate(() => !document.getElementById('assetPanel').hidden);
if (panelStillOpen) ok('file-input click does not close the panel');
else fail('panel closed on file-input click (browse would self-close)');

// 11. Drop-anywhere path adds an asset.
await page.evaluate(({ name, b64, type }) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type }));
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, { name: 'ship.ogg', b64: OGG_B64, type: 'audio/ogg' });
await page.waitForTimeout(200);
const dropped = await page.evaluate(() => pyodide.FS.analyzePath('ship.ogg').exists);
if (dropped) ok('drop-anywhere wrote asset to MEMFS');
else fail('dropped file not added');

// Final: no unexpected JS errors throughout.
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'ASSETS VERIFY FAILED' : 'ASSETS VERIFY OK');
