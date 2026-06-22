# Sprites & Sound (uploadable assets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload images and sounds that their pygame programs load by name (`pygame.image.load("ship.png")`, `pygame.mixer.Sound("blip.wav")`), entirely in-browser, persisted across reloads.

**Architecture:** All code lives in the single static `index.html`. Uploaded bytes are stored in IndexedDB (`assetStore`) and written into Pyodide's MEMFS (`assetFS`) so the ordinary pygame file API resolves them by bare name. UI is drop-anywhere + a `📁` header chip with a popover. A transparent `AudioContext` proxy lets the Run click (a user gesture) resume Web Audio for the headed-browser autoplay policy.

**Tech Stack:** Pyodide 0.27.2 + pygame-ce, vanilla JS, IndexedDB, Emscripten `pyodide.FS`, Playwright headless-Chromium tests (`test/_harness.mjs`).

---

## Verified facts (from spikes — do not re-litigate)

These are empirically proven in real headless Chromium; the code below depends on them:

- Assets **must** be real MEMFS files; `pygame.image.load(io.BytesIO(...))` fails (`RuntimeError("can't access resource on platform")`).
- `pyodide` is reachable from `page.evaluate` by **bare name** (it's a global `let`, not on `window`). `pyodide.FS.cwd() === "/home/pyodide"`, and Python `os.getcwd()` matches it.
- JS `pyodide.FS.writeFile("name.png", uint8)` (relative, cwd-based) produces a file that Python `pygame.image.load("name.png")` reads byte-intact. `pyodide.FS.analyzePath("name").exists` and `pyodide.FS.unlink("name")` work.
- Sound formats: **WAV and OGG/Vorbis decode; MP3 does not** (`"Unrecognized audio format"`).
- Images: PNG/JPG/GIF/BMP all load.

## File Structure

- **Modify `index.html`** — all feature code:
  - CSS: chip, popover, drop overlay, warning badge (in the `<style>` block).
  - HTML: `📁` chip + popover + hidden file input in `<header>`; drop overlay before `</body>`.
  - JS: `assetStore` (IndexedDB), `assetFS` (MEMFS bridge + validation), asset UI wiring, `AudioContext` capture shim + `resumeAudio()`, `hydrateAll()` call in `boot()`, `resumeAudio()` call in `run()`.
- **Create `test/fixtures.mjs`** — committed base64 fixtures (PNG, WAV, OGG, MP3, GIF) + a `buf()` decode helper. (Rename of the spikes' `test/_fixtures.mjs`.)
- **Create `test/assets.mjs`** — the headless asset test battery, same harness/style as `verify.mjs`.
- **Modify `README.md`** — feature section, usage snippet, caveats, manual check.

## Constraints (must hold at the end)

- Single static file, no backend, no build step. Solo path unchanged when no assets are used.
- Existing `verify.mjs` 11-step battery stays green (run it unchanged in Task 8).
- `#code=` share links, localStorage code persistence, and collab remain code-only and untouched.

---

### Task 1: Test fixtures + asset chip (DOM)

**Files:**
- Create: `test/fixtures.mjs`
- Create: `test/assets.mjs`
- Modify: `index.html` (`<style>` block; `<header>`)
- Rename source: `test/_fixtures.mjs` already holds the base64 — copy it to `test/fixtures.mjs` and add a helper.

- [ ] **Step 1: Create `test/fixtures.mjs`**

The base64 consts already exist in `test/_fixtures.mjs` (PNG/WAV/OGG/MP3/GIF). Create `test/fixtures.mjs` with those same five exports plus a Node Buffer helper:

```javascript
// Committed test fixtures. PNG = 16x16 magenta; WAV/MP3/GIF via ffmpeg;
// OGG = pygame examples/data/house_lo.ogg (real Vorbis).
export { PNG_B64, WAV_B64, OGG_B64, MP3_B64, GIF_B64 } from './_fixtures.mjs';
export const buf = (b64) => Buffer.from(b64, 'base64');
```

- [ ] **Step 2: Write `test/assets.mjs` scaffold with the first failing assertion**

```javascript
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
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node test/assets.mjs` (server must be running: `python3 -m http.server 8923` in the repo root)
Expected: `FAIL: no #assetChip with 📁` then `ASSETS VERIFY FAILED`.

- [ ] **Step 4: Add chip CSS to `index.html`**

In the `<style>` block, after the `#liveDot` rules (near the `.remote-cursor` rules), add:

```css
  #assetChip { font-size: 12.5px; color: var(--dim); padding: 4px 8px; cursor: pointer;
               border-radius: 99px; border: 1px solid transparent; user-select: none; }
  #assetChip:hover { border-color: var(--edge); color: var(--text); }
  #assetChip.has { color: var(--accent); }
```

- [ ] **Step 5: Add the chip element to the header**

In `<header>`, immediately after the `<span id="liveDot" ...>...</span>` line, add:

```html
  <span id="assetChip" title="Uploaded assets — drop files anywhere, or click to add">📁</span>
  <input id="assetInput" type="file" multiple hidden>
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `node test/assets.mjs`
Expected: `ok - asset chip present: 📁` then `ASSETS VERIFY OK`.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures.mjs test/assets.mjs index.html
git commit -m "feat(assets): asset chip in header + test scaffold"
```

---

### Task 2: assetStore (IndexedDB) + assetFS.add via file input → MEMFS

This is the core bridge. After it, uploading through the (hidden) file input writes the bytes into MEMFS and updates the chip count.

**Files:**
- Modify: `index.html` (JS — new asset module after the `storage` wrapper, ~after the `const storage = {...}` block; chip-count helper)
- Modify: `test/assets.mjs` (add upload assertion)

- [ ] **Step 1: Add the failing upload assertion to `test/assets.mjs`**

Insert before `await browser.close();`:

```javascript
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
```

- [ ] **Step 2: Run the test, verify the new assertions fail**

Run: `node test/assets.mjs`
Expected: assertion 1 passes; the new ones FAIL (`chip did not show 1`, `uploaded file not in MEMFS`).

- [ ] **Step 3: Implement `assetStore` + `assetFS` + chip wiring in `index.html`**

After the `const storage = { ... };` block (the localStorage wrapper), add:

```javascript
// ---------------------------------------------------------------- assets (uploadable sprites & sounds)
// Bytes live in IndexedDB (assetStore) and are mirrored into Pyodide's MEMFS
// (assetFS) so plain pygame code resolves them by name. Lazy + additive: the
// solo path touches none of this. See docs/specs/2026-06-22-assets-sprites-sound-design.md
const ASSET_MAX_FILE = 10 * 1024 * 1024;   // 10 MB per file
const ASSET_MAX_TOTAL = 64 * 1024 * 1024;  // 64 MB total
const UNSUPPORTED_AUDIO = /\.(mp3|m4a|aac|flac|wma)$/i;  // SDL_mixer here decodes only WAV/OGG

const assetStore = {
  _db: null,
  async _open() {
    if (this._db) return this._db;
    this._db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('pygame-playground', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('assets', { keyPath: 'name' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this._db;
  },
  async _tx(mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', mode);
      const out = fn(tx.objectStore('assets'));
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  },
  async getAll() { try { return await this._tx('readonly', s => { const rq = s.getAll(); return new Promise(r => rq.onsuccess = () => r(rq.result)); }); } catch { return []; } },
  async put(rec) { try { await this._tx('readwrite', s => s.put(rec)); } catch {} },
  async remove(name) { try { await this._tx('readwrite', s => s.delete(name)); } catch {} },
  async clear() { try { await this._tx('readwrite', s => s.clear()); } catch {} },
};

const assetFS = {
  list: [],   // [{name, size, type, warn}]
  _memfs(name, bytes) { if (pyodide) try { pyodide.FS.writeFile(name, bytes); } catch (e) { console.warn('memfs write', name, e); } },
  _unlink(name) { if (pyodide) try { if (pyodide.FS.analyzePath(name).exists) pyodide.FS.unlink(name); } catch {} },
  async hydrateAll() {
    const recs = await assetStore.getAll();
    this.list = recs.map(r => ({ name: r.name, size: r.size, type: r.type, warn: UNSUPPORTED_AUDIO.test(r.name) }));
    for (const r of recs) this._memfs(r.name, new Uint8Array(r.bytes));
    renderAssets();
  },
  totalSize() { return this.list.reduce((n, a) => n + a.size, 0); },
  async add(file) {
    if (file.size > ASSET_MAX_FILE) return assetMsg(`"${file.name}" is ${(file.size/1048576).toFixed(1)} MB — over the 10 MB per-file limit.`);
    const existing = this.list.find(a => a.name === file.name);
    if (this.totalSize() - (existing?.size || 0) + file.size > ASSET_MAX_TOTAL)
      return assetMsg(`Adding "${file.name}" would exceed the 64 MB total budget. Remove something first.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await assetStore.put({ name: file.name, bytes: bytes.buffer, type: file.type, size: bytes.length, addedAt: Date.now() });
    this._memfs(file.name, bytes);
    this.list = this.list.filter(a => a.name !== file.name);
    this.list.push({ name: file.name, size: bytes.length, type: file.type, warn: UNSUPPORTED_AUDIO.test(file.name) });
    renderAssets();
  },
  async remove(name) {
    await assetStore.remove(name); this._unlink(name);
    this.list = this.list.filter(a => a.name !== name); renderAssets();
  },
  async clearAll() {
    await assetStore.clear();
    for (const a of this.list) this._unlink(a.name);
    this.list = []; renderAssets();
  },
  async addFiles(files) { for (const f of files) await this.add(f); },
};

const assetChipEl = document.getElementById('assetChip');
function assetMsg(text) { logLine(text, 'sys'); }
function renderAssets() {
  const n = assetFS.list.length;
  assetChipEl.textContent = n ? `📁 ${n}` : '📁';
  assetChipEl.classList.toggle('has', n > 0);
  renderAssetPanel();   // defined in Task 5; harmless no-op stub until then
}
function renderAssetPanel() {}   // replaced in Task 5

document.getElementById('assetInput').addEventListener('change', (e) => {
  assetFS.addFiles([...e.target.files]); e.target.value = '';
});
```

- [ ] **Step 4: Call `assetFS.hydrateAll()` at the end of `boot()`**

In `boot()`, after `await pyodide.runPythonAsync(BOOT_PY);` and before `setStatus("ready", "ready");`, add:

```javascript
  await assetFS.hydrateAll();   // rehydrate any persisted uploads into MEMFS
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node test/assets.mjs`
Expected: all three assertions pass; `ASSETS VERIFY OK`.

- [ ] **Step 6: Commit**

```bash
git add index.html test/assets.mjs
git commit -m "feat(assets): IndexedDB store + MEMFS bridge, upload via file input"
```

---

### Task 3: Persistence across reload (IndexedDB → MEMFS rehydration)

**Files:**
- Modify: `test/assets.mjs` (add reload assertion)

No new app code — this verifies `hydrateAll()` from Task 2. If it fails, the bug is in Task 2.

- [ ] **Step 1: Add the reload-persistence assertion**

After the Task 2 assertions in `test/assets.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test**

Run: `node test/assets.mjs`
Expected: PASS — `ok - asset persisted across reload`. (If FAIL, fix `hydrateAll`/`assetStore` in Task 2, not here.)

- [ ] **Step 3: Commit**

```bash
git add test/assets.mjs
git commit -m "test(assets): assert uploads persist across reload"
```

---

### Task 4: Image end-to-end (load → convert_alpha → blit → pixel)

**Files:**
- Modify: `test/assets.mjs` (full user-path assertion)

The acceptance test for sprites. No new app code expected.

- [ ] **Step 1: Add the blit-to-pixel assertion**

Append to `test/assets.mjs` (the `dot.png` from Task 2 is already in MEMFS post-reload):

```javascript
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
```

- [ ] **Step 2: Run the test**

Run: `node test/assets.mjs`
Expected: PASS — `ok - uploaded sprite blits to canvas: 253,0,252,255` (approx).

- [ ] **Step 3: Commit**

```bash
git add test/assets.mjs
git commit -m "test(assets): end-to-end sprite load+blit pixel check"
```

---

### Task 5: Sound API path + AudioContext capture/resume

**Files:**
- Modify: `index.html` (`boot()` audio shim; `resumeAudio()`; call in `run()`; canvas click)
- Modify: `test/assets.mjs` (sound assertions)

- [ ] **Step 1: Add the failing sound assertions**

Append to `test/assets.mjs`:

```javascript
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
await page.click('#runBtn');   // a real user gesture -> resumeAudio()
await page.waitForFunction(() => /finished|error/.test(document.getElementById('status').textContent),
  null, { timeout: 20_000 }).catch(() => {});
const soundConsole = await page.evaluate(() =>
  Array.from(document.getElementById('console').children).map(c => c.textContent).join('\n'));
if (/PLAY_OK True/.test(soundConsole)) ok('Sound.play() returned a channel, no exception');
else fail('sound play path failed: ' + soundConsole.slice(0, 200));
const acCount = await page.evaluate(() => (window.__audioContexts || []).length);
if (acCount > 0) ok('AudioContext captured: ' + acCount);
else fail('no AudioContext captured (shim not installed?)');
const acState = await page.evaluate(() => (window.__audioContexts || []).map(c => c.state));
ok('AudioContext states after Run gesture: ' + acState.join(','));
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node test/assets.mjs`
Expected: `PLAY_OK True` likely passes (mixer works), but `no AudioContext captured` FAILS — the shim isn't installed yet.

- [ ] **Step 3: Install the AudioContext capture shim early in `boot()`**

In `boot()`, at the very top of the function (before `setStatus("boot", "loading Python…")`), add:

```javascript
  // Capture SDL's Web Audio context(s) so the Run click (a user gesture) can resume
  // them — headed browsers start an AudioContext suspended until a gesture. Inert
  // unless the user's program calls pygame.mixer. (Proxy returns real instances.)
  window.__audioContexts = window.__audioContexts || [];
  for (const key of ["AudioContext", "webkitAudioContext"]) {
    const Orig = window[key];
    if (!Orig || Orig.__wrapped) continue;
    const Wrapped = new Proxy(Orig, { construct(T, a) { const c = new T(...a); window.__audioContexts.push(c); return c; } });
    Wrapped.__wrapped = true;
    window[key] = Wrapped;
  }
```

- [ ] **Step 4: Add `resumeAudio()` and call it from `run()` and a canvas click**

After the `run()` function definition (near the `runBtn`/`stopBtn` listeners), add:

```javascript
// Resume any SDL-created Web Audio context on a user gesture (autoplay policy).
function resumeAudio() {
  for (const c of window.__audioContexts || []) {
    if (c.state === "suspended") c.resume().catch(() => {});
  }
}
canvasEl.addEventListener("click", resumeAudio);
```

Then inside `run()`, right after `canvasEl.focus();`, add:

```javascript
  resumeAudio();
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node test/assets.mjs`
Expected: `ok - Sound.play() returned a channel`, `ok - AudioContext captured: 1`, and a states line.

- [ ] **Step 6: Commit**

```bash
git add index.html test/assets.mjs
git commit -m "feat(assets): sound via mixer + AudioContext resume-on-gesture"
```

---

### Task 6: Popover UI — list, remove, clear, size readout, MP3 warning

**Files:**
- Modify: `index.html` (CSS for popover/badge; popover HTML; `renderAssetPanel()` real impl; chip click toggle)
- Modify: `test/assets.mjs` (remove + warning assertions)

- [ ] **Step 1: Add failing size-budget, warning, and remove assertions**

Append to `test/assets.mjs`:

```javascript
// 6. Oversize file (>10 MB) is rejected: no MEMFS file, chip count unchanged.
const chipBefore = await page.textContent('#assetChip');
await page.setInputFiles('#assetInput',
  { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024) });
await page.waitForTimeout(150);
const chipAfterBig = await page.textContent('#assetChip');
const bigInFs = await page.evaluate(() => pyodide.FS.analyzePath('big.png').exists);
if (chipBefore === chipAfterBig && !bigInFs) ok('oversize file rejected');
else fail(`oversize not rejected (chip ${chipBefore}->${chipAfterBig}, memfs=${bigInFs})`);

// 7. MP3 upload shows a warning flag in the popover.
await page.setInputFiles('#assetInput',
  { name: 'tune.mp3', mimeType: 'audio/mpeg', buffer: buf(MP3_B64) });
await page.waitForTimeout(150);
await page.click('#assetChip');   // open popover
const warnShown = await page.evaluate(() =>
  !!document.querySelector('#assetPanel [data-name="tune.mp3"] .asset-warn'));
if (warnShown) ok('MP3 shows unsupported-format warning');
else fail('no warning badge on MP3 row');

// 8. Remove via popover -> MEMFS unlinked.
await page.click('#assetPanel [data-name="tune.mp3"] .asset-remove');
await page.waitForTimeout(150);
const goneFs = await page.evaluate(() => pyodide.FS.analyzePath('tune.mp3').exists);
const chipNow = (await page.textContent('#assetChip')).trim();
if (!goneFs) ok('removed asset unlinked from MEMFS; chip=' + chipNow);
else fail('removed file still in MEMFS');
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node test/assets.mjs`
Expected: FAIL on `#assetPanel` not existing / no warning badge.

- [ ] **Step 3: Add popover + badge CSS**

In the `<style>` block, after the `#assetChip` rules from Task 1, add:

```css
  #assetPanel { position: absolute; top: 44px; right: 14px; z-index: 20; width: 300px;
                max-height: 60vh; overflow-y: auto; background: var(--panel);
                border: 1px solid var(--edge); border-radius: 8px; padding: 10px;
                box-shadow: 0 8px 24px rgba(0,0,0,.4); font-size: 12.5px; }
  #assetPanel[hidden] { display: none; }
  #assetPanel .ap-head { display: flex; justify-content: space-between; align-items: center;
                         color: var(--dim); margin-bottom: 6px; }
  #assetPanel .ap-browse { color: var(--accent); cursor: pointer; }
  #assetPanel .asset-row { display: flex; align-items: center; gap: 6px; padding: 3px 0;
                           border-top: 1px solid var(--edge); }
  #assetPanel .asset-name { flex: 1; font-family: "SF Mono", Menlo, monospace; word-break: break-all; }
  #assetPanel .asset-size { color: var(--dim); }
  #assetPanel .asset-warn { color: var(--warn); cursor: help; }
  #assetPanel .asset-remove { color: var(--bad); cursor: pointer; border: none; background: none; font-size: 13px; }
  #assetPanel .ap-empty { color: var(--dim); padding: 4px 0; }
  #assetPanel .ap-foot { display: flex; justify-content: space-between; align-items: center;
                         color: var(--dim); margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--edge); }
  #assetPanel .ap-clear { color: var(--bad); cursor: pointer; }
  #dropOverlay { position: fixed; inset: 0; z-index: 50; display: none; align-items: center;
                 justify-content: center; background: rgba(20,30,40,.78); color: var(--accent);
                 font-size: 22px; border: 3px dashed var(--accent); }
  #dropOverlay.show { display: flex; }
```

- [ ] **Step 4: Add the popover + drop overlay HTML**

In `<header>`, immediately after the `<input id="assetInput" ...>` line, add:

```html
  <div id="assetPanel" hidden></div>
```

Before `</body>` (after the closing `</main>` is fine; place it just before the first `<script>`), add:

```html
<div id="dropOverlay">Drop files to add them as assets</div>
```

- [ ] **Step 5: Replace the `renderAssetPanel()` stub and wire the chip toggle**

Replace the `function renderAssetPanel() {}` stub (from Task 2) with:

```javascript
const assetPanelEl = document.getElementById('assetPanel');
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(0) + ' KB' : (n/1048576).toFixed(1) + ' MB';
function renderAssetPanel() {
  if (assetPanelEl.hidden) return;
  const rows = assetFS.list.map(a => `
    <div class="asset-row" data-name="${a.name}">
      <span class="asset-name">${a.name}</span>
      ${a.warn ? '<span class="asset-warn" title="Only WAV and OGG play in the browser audio engine — convert this file.">⚠</span>' : ''}
      <span class="asset-size">${fmtSize(a.size)}</span>
      <button class="asset-remove" title="Remove">✕</button>
    </div>`).join('');
  assetPanelEl.innerHTML = `
    <div class="ap-head"><span>Assets</span><span class="ap-browse">+ add files</span></div>
    ${assetFS.list.length ? rows : '<div class="ap-empty">No files yet. Drop files anywhere, or “+ add files”.</div>'}
    <div class="ap-foot"><span>used ${fmtSize(assetFS.totalSize())} / 64 MB</span>${assetFS.list.length ? '<span class="ap-clear">Clear all</span>' : ''}</div>`;
}
assetChipEl.addEventListener('click', () => {
  assetPanelEl.hidden = !assetPanelEl.hidden;
  renderAssetPanel();
});
assetPanelEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('ap-browse')) document.getElementById('assetInput').click();
  else if (e.target.classList.contains('ap-clear')) assetFS.clearAll();
  else if (e.target.classList.contains('asset-remove'))
    assetFS.remove(e.target.closest('.asset-row').dataset.name);
});
// Close the popover when clicking elsewhere.
document.addEventListener('click', (e) => {
  if (!assetPanelEl.hidden && !assetPanelEl.contains(e.target) && e.target !== assetChipEl)
    { assetPanelEl.hidden = true; }
});
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `node test/assets.mjs`
Expected: `ok - MP3 shows unsupported-format warning`, `ok - removed asset`.

- [ ] **Step 7: Commit**

```bash
git add index.html test/assets.mjs
git commit -m "feat(assets): popover list with remove/clear, size readout, MP3 warning"
```

---

### Task 7: Drop-anywhere

**Files:**
- Modify: `index.html` (document drag/drop handlers)
- Modify: `test/assets.mjs` (drop assertion)

- [ ] **Step 1: Add the failing drop assertion**

Append to `test/assets.mjs`:

```javascript
// 9. Drop-anywhere path adds an asset.
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node test/assets.mjs`
Expected: FAIL — `dropped file not added` (no drop handler yet).

- [ ] **Step 3: Add document-level drag/drop handlers in `index.html`**

After the `assetInput` change listener (end of the asset module, before the layout section), add:

```javascript
// Drop files anywhere on the page to add them as assets.
const dropOverlayEl = document.getElementById('dropOverlay');
let dragDepth = 0;
addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; dropOverlayEl.classList.add('show'); } });
addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlayEl.classList.remove('show'); } });
addEventListener('drop', (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault(); dragDepth = 0; dropOverlayEl.classList.remove('show');
  assetFS.addFiles([...e.dataTransfer.files]);
});
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node test/assets.mjs`
Expected: `ok - drop-anywhere wrote asset to MEMFS`, `ok - no JS console errors`, `ASSETS VERIFY OK`.

- [ ] **Step 5: Commit**

```bash
git add index.html test/assets.mjs
git commit -m "feat(assets): drop files anywhere to add them"
```

---

### Task 8: Non-regression, README, manual-check doc

**Files:**
- Modify: `README.md`
- (Verify only) `verify.mjs`

- [ ] **Step 1: Run the existing solo battery — must be green**

Run: `node verify.mjs`
Expected: ends with `VERIFY OK` and `console errors: none`. If anything regressed, fix it before continuing (the asset shim/listeners must not disturb the solo path).

- [ ] **Step 2: Run the asset battery once more end-to-end**

Run: `node test/assets.mjs`
Expected: `ASSETS VERIFY OK`.

- [ ] **Step 3: Add a README section**

After the existing "Collaborate" section in `README.md`, add:

```markdown
## Images & sounds (your own assets)

Drop image or sound files anywhere on the page (or click the **📁** chip in the
header to browse). Uploaded files are written into the runtime's filesystem, so
ordinary pygame code loads them by name:

​```python
sprite = pygame.image.load("ship.png").convert_alpha()
screen.blit(sprite, (100, 100))

pygame.mixer.init()
blip = pygame.mixer.Sound("blip.wav")
blip.play()                 # call from a key/mouse handler — see the autoplay note
​```

- **Image formats:** PNG, JPG, GIF, BMP.
- **Sound formats:** **WAV and OGG only.** MP3 has no decoder in the in-browser
  audio engine (you'll see a ⚠ on MP3 uploads) — convert to WAV or OGG.
- **Autoplay:** browsers won't play audio until you interact with the page.
  Pressing **▶ Run** counts, and so does clicking the canvas; if a sound seems
  silent, click the canvas once.
- **Where they live:** uploads persist in your browser (IndexedDB), up to 10 MB
  per file / 64 MB total. They are **local to your browser** — they do not travel
  with 🔗 Share links or collab rooms. Use the 📁 popover to remove or clear them.

`test/assets.mjs` is the headless asset test battery (upload → blit → pixel,
persistence across reload, sound API path, drop-anywhere). Audio *output* can't be
checked headlessly — verify it by ear in a real browser (see below).
```

- [ ] **Step 4: Append a paste-in test program + manual check to the README**

Add right after the section from Step 3:

```markdown
### Quick manual test (sprite + sound)

Upload a PNG named `sprite.png` and a WAV named `beep.wav`, then run:

​```python
import pygame
pygame.init()
screen = pygame.display.set_mode((480, 320))
pygame.mixer.init()
sprite = pygame.image.load("sprite.png").convert_alpha()
beep = pygame.mixer.Sound("beep.wav")
clock = pygame.time.Clock()
x = 0
while True:
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            raise SystemExit
        if e.type == pygame.KEYDOWN:
            beep.play()                       # press a key to hear it
    screen.fill((18, 22, 30))
    x = (x + 2) % 480
    screen.blit(sprite, (x, 140))
    pygame.display.flip()
    clock.tick(60)
​```

Click the canvas, press a key, and confirm you **hear** the beep and **see** the
sprite slide across — that's the manual audio-output check headless tests can't do.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(assets): README section, caveats, and a manual sprite+sound test"
```

---

### Task 9: Spike cleanup

**Files:**
- Remove or keep `test/spike-assets.mjs`, `test/spike-formats.mjs`, `test/spike-bridge.mjs`

The repo keeps prior spikes (`test/spike-automerge.mjs`, `test/spike-bundle.mjs`) as a record, so keeping these is consistent. Confirm `test/_fixtures.mjs` is still imported by `test/fixtures.mjs` and the spikes (leave it in place).

- [ ] **Step 1: Confirm everything still runs**

Run: `node test/assets.mjs && node verify.mjs`
Expected: both end `... VERIFY OK`.

- [ ] **Step 2: Commit any final tidy-ups (if needed)**

```bash
git add -A && git commit -m "chore(assets): keep de-risking spikes as record" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** input model (Tasks 1,2,6,7) · IndexedDB persistence (Tasks 2,3) · MEMFS bridge (Task 2, spike-proven) · drop-anywhere + chip + popover (Tasks 1,6,7) · format guidance/MP3 warning (Task 6) · autoplay unlock (Task 5) · size budget + overwrite (Task 2) · local-only sharing (untouched — verified by Task 8 running `verify.mjs`) · tests (every task) · README + manual check (Task 8). All spec sections map to a task.
- **No placeholders:** every code/test step is complete and runnable.
- **Type/name consistency:** `assetFS` methods (`add`, `addFiles`, `remove`, `clearAll`, `hydrateAll`, `totalSize`, `list`), `assetStore` methods (`getAll`, `put`, `remove`, `clear`), `renderAssets`/`renderAssetPanel`, and element ids (`assetChip`, `assetInput`, `assetPanel`, `dropOverlay`) are used identically across tasks.
- **Manual check** is explicitly documented (audio output) since headless can't verify it.
