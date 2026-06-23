// SPIKE (throwaway de-risking): SAVE / download.
// Proves, in real headless Chromium: (1) a plain .py download via Blob + a[download]
// is capturable and round-trips its content; (2) JSZip loads no-build from cdnjs and
// produces a valid zip (incl. a binary asset) that unzips back to the same bytes.
import { launch } from './_harness.mjs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://localhost:8923/';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let failures = 0;
const ok = (m) => console.log('ok   -', m);
const fail = (m) => { console.error('FAIL:', m); failures++; };

const browser = await launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'load' });
const tmp = await mkdtemp(join(tmpdir(), 'save-spike-'));

// 1. Plain .py download via Blob + a[download].
{
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => {
      const blob = new Blob(['import pygame  # hello\n'], { type: 'text/x-python' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'main.py';
      document.body.appendChild(a); a.click(); a.remove();
    }),
  ]);
  if (dl.suggestedFilename() === 'main.py') ok('download filename is main.py');
  else fail('wrong filename: ' + dl.suggestedFilename());
  const path = join(tmp, 'main.py');
  await dl.saveAs(path);
  const content = await readFile(path, 'utf8');
  if (content === 'import pygame  # hello\n') ok('.py download content round-trips via Blob + a[download]');
  else fail('content mismatch: ' + JSON.stringify(content));
}

// 2. JSZip loads no-build from cdnjs and zips text + a binary asset.
{
  const loaded = await page.evaluate(async (cdn) => {
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = cdn;
      s.onload = res; s.onerror = () => rej(new Error('script load failed'));
      document.head.appendChild(s);
    });
    return typeof window.JSZip === 'function';
  }, JSZIP_CDN).catch((e) => 'ERR: ' + e.message);
  if (loaded === true) ok('JSZip loaded no-build from cdnjs (window.JSZip)');
  else { fail('JSZip did not load: ' + loaded); }

  // Build a zip with a .py file and a small binary "asset", download + capture it.
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async () => {
      const zip = new JSZip();
      zip.file('main.py', 'import pygame\nsprite = pygame.image.load("dot.bin")\n');
      zip.file('dot.bin', new Uint8Array([0, 1, 2, 253, 254, 255]));   // binary asset
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'pygame-project.zip';
      document.body.appendChild(a); a.click(); a.remove();
    }),
  ]);
  if (dl.suggestedFilename() === 'pygame-project.zip') ok('zip filename is pygame-project.zip');
  else fail('wrong zip filename: ' + dl.suggestedFilename());
  const zpath = join(tmp, 'p.zip');
  await dl.saveAs(zpath);
  const bytes = await readFile(zpath);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) ok('zip has valid PK signature (' + bytes.length + ' bytes)');
  else fail('not a valid zip (no PK header)');

  // Unzip back in-browser (round-trip) to confirm the binary asset survived.
  const roundtrip = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const zip = await JSZip.loadAsync(data);
    const py = await zip.file('main.py').async('string');
    const bin = await zip.file('dot.bin').async('uint8array');
    return { py, bin: Array.from(bin) };
  }, bytes.toString('base64'));
  if (roundtrip.py.includes('image.load') && JSON.stringify(roundtrip.bin) === '[0,1,2,253,254,255]')
    ok('zip round-trips .py text + binary asset bytes intact');
  else fail('zip round-trip wrong: ' + JSON.stringify(roundtrip));
}

await browser.close();
console.log(failures ? `\nSAVE SPIKE FAILED (${failures})` : '\nSAVE SPIKE OK — Blob .py download + JSZip no-build both proven');
process.exitCode = failures ? 1 : 0;
