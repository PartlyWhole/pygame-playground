// SPIKE: verify the JS -> MEMFS -> Python bridge the feature depends on.
// 1) is `pyodide` reachable from page.evaluate (global `let`, not window.*)?
// 2) does pyodide.FS.writeFile(name, bytes) from JS make the file visible to
//    Python's pygame.image.load(name) by bare (cwd-relative) name, byte-intact?
import { launch } from './_harness.mjs';
import { PNG_B64, WAV_B64 } from './_fixtures.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('[pageerror]', String(e)));

await page.goto('http://localhost:8923/', { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

// (1) Is the module-scope `let pyodide` reachable from evaluate by bare name?
const reach = await page.evaluate(() => {
  try { return { type: typeof pyodide, hasFS: !!(pyodide && pyodide.FS), cwd: pyodide?.FS?.cwd?.() }; }
  catch (e) { return { error: String(e) }; }
});
console.log('pyodide reachable from evaluate:', reach);

// (2) Write PNG + WAV from JS via FS.writeFile, using the cwd, then have Python load them.
const wrote = await page.evaluate(({ png, wav }) => {
  const b = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const dir = pyodide.FS.cwd();
  pyodide.FS.writeFile(dir + '/jsdot.png', b(png));
  pyodide.FS.writeFile('jsbeep.wav', b(wav));          // relative form too
  return { dir, png_len: b(png).length, wav_len: b(wav).length,
           exists_abs: pyodide.FS.analyzePath(dir + '/jsdot.png').exists,
           exists_rel: pyodide.FS.analyzePath('jsbeep.wav').exists };
}, { png: PNG_B64, wav: WAV_B64 });
console.log('JS wrote:', wrote);

// Python reads what JS wrote, by bare name.
const PY = String.raw`
import pygame, os
pygame.init(); screen = pygame.display.set_mode((64,64))
print("PY_CWD", os.getcwd())
try:
    img = pygame.image.load("jsdot.png").convert_alpha()
    px = img.get_at((8,8))
    print("IMG_OK", img.get_size(), tuple(px))
except Exception as e:
    print("IMG_FAIL", repr(e))
try:
    pygame.mixer.init()
    snd = pygame.mixer.Sound("jsbeep.wav")
    print("WAV_OK", round(snd.get_length(),3))
except Exception as e:
    print("WAV_FAIL", repr(e))
print("BRIDGE_DONE")
`;
await page.evaluate((src) => document.querySelector('.CodeMirror').CodeMirror.setValue(src), PY);
await page.click('#runBtn');
await page.waitForFunction(
  () => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 30_000 }).catch(() => {});

const lines = await page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent));
console.log('\n=== BRIDGE PROBE ===');
lines.filter(l => /PY_CWD|IMG_|WAV_|DONE/.test(l)).forEach(l => console.log('  ' + l.trim()));
await browser.close();
