// SPIKE: type-aware file viewer for the redesign's explorer.
// De-risks: rendering an uploaded image (<img> from a Blob object URL built from
// the real asset bytes), a sound player (<audio> from an object URL), and the
// "unable to open" path for other types. Also probes the documented divergence
// that <audio> decodes MP3 natively even though pygame's SDL_mixer here does not.
// Source of bytes = Pyodide MEMFS (pyodide.FS.readFile), the same place a real
// viewer would read from after an upload is mirrored in.
import { launch } from './_harness.mjs';
import { PNG_B64, WAV_B64, OGG_B64, MP3_B64, GIF_B64, buf } from './fixtures.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);
const info = (msg) => console.log('info -', msg);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// Upload a representative set of files through the real asset input.
const uploads = [
  { name: 'sprite.png', mime: 'image/png', b64: PNG_B64 },
  { name: 'anim.gif',   mime: 'image/gif', b64: GIF_B64 },
  { name: 'blip.wav',   mime: 'audio/wav', b64: WAV_B64 },
  { name: 'house.ogg',  mime: 'audio/ogg', b64: OGG_B64 },
  { name: 'tune.mp3',   mime: 'audio/mpeg', b64: MP3_B64 },
  { name: 'notes.txt',  mime: 'text/plain', b64: Buffer.from('hello world, not openable').toString('base64') },
];
for (const u of uploads) {
  await page.setInputFiles('#assetInput', { name: u.name, mimeType: u.mime, buffer: buf(u.b64) });
  await page.waitForTimeout(80);
}
// All bytes must have reached MEMFS (the viewer's byte source).
const inFs = await page.evaluate((names) => names.map(n => pyodide.FS.analyzePath(n).exists),
  uploads.map(u => u.name));
if (inFs.every(Boolean)) ok('all uploaded files present in MEMFS (viewer byte source)');
else fail('some uploads missing from MEMFS: ' + JSON.stringify(inFs));

// The proposed classifier the explorer would use to pick a viewer by extension.
const classify = (name) => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'py') return 'code';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) return 'image';
  if (['wav', 'ogg', 'mp3', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  return 'other';
};
const expectKind = { 'sprite.png': 'image', 'anim.gif': 'image', 'blip.wav': 'audio',
  'house.ogg': 'audio', 'tune.mp3': 'audio', 'notes.txt': 'other' };
let classOk = true;
for (const [n, k] of Object.entries(expectKind)) if (classify(n) !== k) { classOk = false; fail(`classify("${n}") = ${classify(n)}, expected ${k}`); }
if (classOk) ok('extension classifier maps each upload to the right viewer kind');

// IMAGE VIEWER: bytes -> Blob -> object URL -> <img>, assert it decodes.
const imgProbe = await page.evaluate(async (name) => {
  const bytes = pyodide.FS.readFile(name);                 // Uint8Array from MEMFS
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const img = new Image();
    const loaded = await new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url; });
    return { loaded, w: img.naturalWidth, h: img.naturalHeight, bytes: bytes.length };
  } finally { URL.revokeObjectURL(url); }
}, 'sprite.png');
if (imgProbe.loaded && imgProbe.w > 0 && imgProbe.h > 0) ok(`image viewer decodes PNG via object URL: ${imgProbe.w}x${imgProbe.h} (${imgProbe.bytes} B)`);
else fail('image did not decode from object URL: ' + JSON.stringify(imgProbe));

// AUDIO PLAYER: bytes -> Blob -> object URL -> <audio>, assert metadata loads.
async function audioProbe(name, mime) {
  return page.evaluate(async ({ name, mime }) => {
    const bytes = pyodide.FS.readFile(name);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const result = await new Promise((res) => {
      let done = false;
      const finish = (loaded) => { if (!done) { done = true; res({ loaded, duration: a.duration, readyState: a.readyState }); } };
      a.addEventListener('loadedmetadata', () => finish(true));
      a.addEventListener('error', () => finish(false));
      setTimeout(() => finish(false), 4000);
      a.src = url;
    });
    URL.revokeObjectURL(url);
    return result;
  }, { name, mime });
}
const wav = await audioProbe('blip.wav', 'audio/wav');
if (wav.loaded) ok(`audio player loads WAV metadata: duration=${wav.duration}, readyState=${wav.readyState}`);
else fail('audio player failed to load WAV metadata: ' + JSON.stringify(wav));
const ogg = await audioProbe('house.ogg', 'audio/ogg');
if (ogg.loaded) ok(`audio player loads OGG metadata: duration=${ogg.duration}`);
else info('OGG metadata did not load headlessly (may still play in a real browser): ' + JSON.stringify(ogg));
// The documented divergence: <audio> may decode MP3 even though pygame's SDL_mixer
// here cannot. Whatever the headless result, it informs the viewer's messaging.
const mp3 = await audioProbe('tune.mp3', 'audio/mpeg');
info(`MP3 in <audio> headlessly: ${mp3.loaded ? 'DECODES (player can play it; pygame cannot — must message this)' : 'does not decode here'} ${JSON.stringify(mp3)}`);

// UNABLE TO OPEN: a .txt must NOT route to a media viewer.
if (classify('notes.txt') === 'other') ok('non-media type (.txt) routes to the "unable to open" path');
else fail('.txt mis-classified');

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'VIEWER SPIKE FAILED' : 'VIEWER SPIKE OK');
