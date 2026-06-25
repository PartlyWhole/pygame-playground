// SPIKE: de-risk sprites (SDL_image) and sound (SDL_mixer / Web Audio) in a real
// headless browser BEFORE designing the feature. Throwaway — proves the API path,
// surfaces the autoplay/gesture constraint, and reports which formats decode.
//
//   node test/spike-assets.mjs            # default autoplay policy (real-world)
//   node test/spike-assets.mjs --unlock   # launch with no-user-gesture-required
//
// Needs a local server on :8923 and Playwright's chromium cache (see _harness.mjs).
import { launch } from './_harness.mjs';

const UNLOCK = process.argv.includes('--unlock');
const URL = 'http://localhost:8923/';

// Python the user could paste: generates its own assets in-memory (no SDL_image
// needed to CREATE the PNG — pure zlib — so loading it truly tests the decoder),
// then exercises image load/convert/blit and mixer init/Sound/play.
const TEST_PY = String.raw`
import pygame, io, struct, zlib, wave, math, os, traceback

results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, "--", detail)

pygame.init()
screen = pygame.display.set_mode((320, 240))
screen.fill((20, 30, 40))

# ---- build a real 16x16 RGBA PNG in pure Python (no SDL_image to encode) ----
def make_png(w, h, rgba):
    def chunk(typ, data):
        body = typ + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw += b"\x00" + rgba[y*stride:(y+1)*stride]   # filter byte 0 per scanline
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw)))
            + chunk(b"IEND", b""))

W = H = 16
px = bytearray()
for y in range(H):
    for x in range(W):
        # opaque magenta disc on transparent ground -> exercises alpha
        a = 255 if (x-8)**2 + (y-8)**2 <= 36 else 0
        px += bytes((220, 40, 200, a))
png_bytes = make_png(W, H, bytes(px))
with open("sprite.png", "wb") as f:
    f.write(png_bytes)

# ---- IMAGE: decode embedded PNG via SDL_image ----
try:
    surf = pygame.image.load("sprite.png")
    check("image.load(PNG)", surf.get_size() == (16, 16), "size=%s" % (surf.get_size(),))
    conv = surf.convert_alpha()
    center = conv.get_at((8, 8)); corner = conv.get_at((0, 0))
    check("convert_alpha+alpha", center[3] == 255 and corner[3] == 0,
          "center=%s corner=%s" % (tuple(center), tuple(corner)))
    screen.blit(conv, (40, 40))
    blitted = screen.get_at((48, 48))
    check("blit to screen", blitted[0] > 150 and blitted[2] > 120, "pixel=%s" % (tuple(blitted),))
except Exception as e:
    check("image.load(PNG)", False, "EXC " + repr(e))

# ---- IMAGE: also test load-from-bytes (BytesIO), the URL/upload code path ----
try:
    surf2 = pygame.image.load(io.BytesIO(png_bytes), "x.png")
    check("image.load(BytesIO)", surf2.get_size() == (16, 16), "size=%s" % (surf2.get_size(),))
except Exception as e:
    check("image.load(BytesIO)", False, "EXC " + repr(e))

# ---- IMAGE: JPG codec via save+load round-trip ----
try:
    pygame.image.save(conv, "sprite.jpg")
    j = pygame.image.load("sprite.jpg")
    check("image JPG round-trip", j.get_size() == (16, 16), "size=%s" % (j.get_size(),))
except Exception as e:
    check("image JPG round-trip", False, "EXC " + repr(e))

# ---- build a real 0.2s WAV beep (pure stdlib) ----
buf = io.BytesIO()
sr = 22050
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    frames = bytearray()
    for i in range(int(sr * 0.2)):
        frames += struct.pack("<h", int(12000 * math.sin(2*math.pi*440*i/sr)))
    w.writeframes(bytes(frames))
wav_bytes = buf.getvalue()
with open("beep.wav", "wb") as f:
    f.write(wav_bytes)

# ---- SOUND: mixer init ----
try:
    pygame.mixer.init()
    check("mixer.init()", pygame.mixer.get_init() is not None, "get_init=%s" % (pygame.mixer.get_init(),))
except Exception as e:
    check("mixer.init()", False, "EXC " + repr(e))

# ---- SOUND: load WAV ----
snd = None
try:
    snd = pygame.mixer.Sound("beep.wav")
    check("Sound(WAV) load", snd.get_length() > 0.1, "len=%.3f" % snd.get_length())
except Exception as e:
    check("Sound(WAV) load", False, "EXC " + repr(e))

# ---- SOUND: load from buffer ----
try:
    snd_b = pygame.mixer.Sound(buffer=wav_bytes)
    check("Sound(buffer=) load", snd_b.get_length() > 0.1, "len=%.3f" % snd_b.get_length())
except Exception as e:
    check("Sound(buffer=) load", False, "EXC " + repr(e))

# ---- SOUND: play() must not throw (audio output not verifiable headlessly) ----
try:
    if snd is not None:
        ch = snd.play()
        check("Sound.play()", True, "channel=%s busy=%s" % (ch, ch.get_busy() if ch else None))
    else:
        check("Sound.play()", False, "no sound loaded")
except Exception as e:
    check("Sound.play()", False, "EXC " + repr(e))

pygame.display.flip()
print("SPIKE_DONE", sum(1 for _,ok,_ in results if ok), "/", len(results))
`;

const browser = await launch({
  args: UNLOCK ? ['--autoplay-policy=no-user-gesture-required'] : [],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

// Instrument AudioContext BEFORE any page script: capture every instance + its
// state, so we can see whether SDL created one and whether a gesture unlocked it.
await page.addInitScript(() => {
  window.__ac = [];
  const wrap = (Orig) => new Proxy(Orig, {
    construct(T, args) {
      const ctx = new T(...args);
      window.__ac.push(ctx);
      return ctx;
    },
  });
  if (window.AudioContext) window.AudioContext = wrap(window.AudioContext);
  if (window.webkitAudioContext) window.webkitAudioContext = wrap(window.webkitAudioContext);
});

const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${String(e)}`));

const acStates = async (label) => {
  const states = await page.evaluate(() => (window.__ac || []).map(c => c.state));
  console.log(`  AudioContext states (${label}):`, states.length ? states.join(', ') : '(none created)');
  return states;
};

console.log(`\n=== SPIKE assets ${UNLOCK ? '(--unlock: no-gesture-required)' : '(default autoplay policy)'} ===`);
await page.goto(URL, { waitUntil: 'load' });

// Wait for Pyodide+pygame ready (default example auto-runs -> 'running', or 'ready').
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 },
);
console.log('booted; status =', await page.textContent('#status'));
await acStates('after boot, before any gesture');

// Put the spike code in the editor.
await page.evaluate((src) => {
  document.querySelector('.CodeMirror').CodeMirror.setValue(src);
}, TEST_PY);

// --- Run path A: NO user gesture (programmatic run()) ---
console.log('\n-- Run WITHOUT user gesture (programmatic) --');
await page.evaluate(() => window.run());
await page.waitForFunction(
  () => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 30_000 },
).catch(() => console.log('  (did not reach finished/error in 30s)'));
let consoleText = await page.textContent('#console');
const noGestureAudio = await acStates('after no-gesture run');
console.log('  console (no-gesture run):');
console.log(consoleText.split('\n').filter(l => /PASS|FAIL|SPIKE_DONE/.test(l)).map(l => '    ' + l).join('\n'));

// --- Run path B: WITH a real user gesture (click Run button) ---
console.log('\n-- Run WITH user gesture (click #runBtn) --');
await page.click('#runBtn');
await page.waitForFunction(
  () => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 30_000 },
).catch(() => console.log('  (did not reach finished/error in 30s)'));
consoleText = await page.textContent('#console');
const gestureAudio = await acStates('after gesture run');
console.log('  console (gesture run):');
console.log(consoleText.split('\n').filter(l => /PASS|FAIL|SPIKE_DONE/.test(l)).map(l => '    ' + l).join('\n'));

// Did a gesture move an AudioContext from suspended -> running?
console.log('\n-- AudioContext gesture effect --');
console.log('  no-gesture states:', noGestureAudio.join(', ') || '(none)');
console.log('  gesture states:   ', gestureAudio.join(', ') || '(none)');

// Try explicit resume after gesture (what we'd wire on Run).
const afterResume = await page.evaluate(async () => {
  const acs = window.__ac || [];
  await Promise.all(acs.map(c => c.resume().catch(() => {})));
  return acs.map(c => c.state);
});
console.log('  states after explicit resume():', afterResume.join(', ') || '(none)');

// Confirm sprite actually rendered: sample a canvas pixel where we blitted.
const px = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  if (!g) return 'no 2d ctx';
  try { return Array.from(g.getImageData(48, 48, 1, 1).data); }
  catch (e) { return 'getImageData failed: ' + e.message; }
});
console.log('\n  canvas pixel at sprite center (48,48):', px);

await page.screenshot({ path: './test/spike-assets.png' });

// Surface any SDL/emscripten audio chatter.
const audioLogs = logs.filter(l => /audio|mixer|sdl|webaudio|gesture|autoplay/i.test(l));
if (audioLogs.length) {
  console.log('\n  audio/SDL console chatter:');
  audioLogs.slice(0, 20).forEach(l => console.log('    ' + l));
}
const errLogs = logs.filter(l => /\[error\]|\[pageerror\]/.test(l) && !/favicon/.test(l));
if (errLogs.length) {
  console.log('\n  JS errors:');
  errLogs.slice(0, 20).forEach(l => console.log('    ' + l));
}

await browser.close();
console.log('\n=== spike complete; screenshot at test/spike-assets.png ===');
