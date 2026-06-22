// SPIKE: which sound/image formats does pygame-ce on Pyodide 0.27.2 actually
// decode? Feeds real ffmpeg-generated OGG/MP3/GIF bytes through MEMFS files.
// Throwaway — answers the objective's "which formats work (WAV/OGG/MP3)".
import { launch } from './_harness.mjs';
import { OGG_B64, MP3_B64, GIF_B64 } from './_fixtures.mjs';

const PY = String.raw`
import pygame, base64, io, math, struct, wave
pygame.init()
pygame.display.set_mode((64, 64))

def probe(name, write, load):
    try:
        write()
        obj = load()
        print("PASS", name, "--", obj)
    except Exception as e:
        print("FAIL", name, "--", repr(e))

# WAV (baseline, stdlib-generated)
def wav_bytes():
    b = io.BytesIO(); w = wave.open(b, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
    w.writeframes(b"".join(struct.pack("<h", int(9000*math.sin(2*math.pi*440*i/22050))) for i in range(4410)))
    w.close(); return b.getvalue()

pygame.mixer.init()
data = {"wav": wav_bytes(),
        "ogg": base64.b64decode("__OGG__"),
        "mp3": base64.b64decode("__MP3__"),
        "gif": base64.b64decode("__GIF__")}

for ext in ("wav", "ogg", "mp3"):
    def mk(ext=ext):
        open("s." + ext, "wb").write(data[ext])
    probe("Sound(" + ext + ")", mk, lambda ext=ext: round(pygame.mixer.Sound("s." + ext).get_length(), 3))

# music streaming path (pygame.mixer.music) — common for background tracks
for ext in ("ogg", "mp3", "wav"):
    def mk(ext=ext):
        open("m." + ext, "wb").write(data[ext])
    probe("music.load(" + ext + ")", mk, lambda ext=ext: (pygame.mixer.music.load("m." + ext), "loaded")[1])

# GIF image (SDL_image)
def mkgif():
    open("d.gif", "wb").write(data["gif"])
probe("image.load(gif)", mkgif, lambda: pygame.image.load("d.gif").get_size())

print("FORMATS_DONE")
`.replace('__OGG__', OGG_B64).replace('__MP3__', MP3_B64).replace('__GIF__', GIF_B64);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('[pageerror] ' + e));

await page.goto('http://localhost:8923/', { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

await page.evaluate((src) => document.querySelector('.CodeMirror').CodeMirror.setValue(src), PY);
await page.click('#runBtn');
await page.waitForFunction(
  () => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 30_000 }).catch(() => {});

const lines = await page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent));
console.log('\n=== FORMAT PROBE ===');
lines.filter(l => /PASS|FAIL|DONE/.test(l)).forEach(l => console.log('  ' + l.trim()));
const sdlChatter = logs.filter(l => /mpg|mp3|ogg|vorbis|mixer|codec|format|sdl_image|sdl_mixer/i.test(l));
if (sdlChatter.length) { console.log('\n SDL chatter:'); sdlChatter.slice(0, 15).forEach(l => console.log('   ' + l)); }
await browser.close();
