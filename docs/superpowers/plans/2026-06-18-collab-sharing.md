# Collaborative Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in real-time collaborative editing (shared code + live cursors) to the pygame playground via Automerge over the public sync server, with Pyodide still running locally per peer.

**Architecture:** A lazily-loaded `collab` module inside the single static `index.html`. Automerge loads from a CDN only when collaboration is activated (Collaborate button or `#room=` link), so the solo path is byte-for-byte unchanged and ships no WASM. Shared state is one Automerge doc `{ code: string }` synced over `wss://sync.automerge.org`; cursors ride the `Presence` ephemeral channel. CodeMirror 5 is bound to the doc both ways with prefix/suffix diffing and an echo guard.

**Tech Stack:** Vanilla JS ESM (no build step), `@automerge/automerge-repo` + `@automerge/automerge-repo-network-websocket` (+ `Presence`) from a CDN, CodeMirror 5, Pyodide. Verification: headless Chromium driven by Trellis's `playwright-core`, plus the existing `verify.mjs` 16-check regression battery.

---

## Conventions for every task

- **Server:** keep a static server running: `cd $HOME/Desktop/pygame-playground && python3 -m http.server 8923`. If it died, restart it (backgrounded).
- **Headless harness:** all browser checks use Trellis's playwright-core. The boilerplate launcher (reused verbatim across tasks) is:

```js
import { chromium } from '$HOME/Desktop/Trellis/verification/node_modules/playwright-core/index.mjs';
import { readdirSync } from 'node:fs';
const cacheDir = process.env.HOME + '/Library/Caches/ms-playwright';
const shell = readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
const exe = cacheDir + '/' + shell + '/chrome-headless-shell-mac-arm64/chrome-headless-shell';
export const launch = () => chromium.launch({ executablePath: exe });
```

Save that once as `$HOME/Desktop/pygame-playground/test/_harness.mjs` in Task 0 and import it everywhere.
- **Commit cadence:** commit after each task's tests pass. Do **not** push until Task 8 (final gate) and the user authorizes the deploy.
- **Regression invariant:** `node verify.mjs` (16 checks) must stay green after every task — collaboration is off by default, so the solo path must never regress.

---

## Task 0: Test harness helper + version pin placeholder

**Files:**
- Create: `test/_harness.mjs`
- Create: `test/spike-automerge.mjs` (filled in Task 1)

- [ ] **Step 1: Create the shared launcher**

Create `test/_harness.mjs` with exactly the launcher boilerplate from "Conventions" above (the `export const launch` block).

- [ ] **Step 2: Verify it imports and launches**

Run:
```bash
cd $HOME/Desktop/pygame-playground && node --input-type=module -e "
import { launch } from './test/_harness.mjs';
const b = await launch(); const p = await b.newPage();
await p.goto('http://localhost:8923/'); console.log('harness OK:', await p.title()); await b.close();"
```
Expected: prints `harness OK: pygame playground`.

- [ ] **Step 3: Commit**

```bash
git add test/_harness.mjs && git commit -m "test: shared headless-chromium launcher for collab tests"
```

---

## Task 1: Build & verify the Automerge vendor bundle (gating)

**Context (why this replaced the CDN spike):** the original CDN spike PROVED, deterministically, that `@automerge/automerge-repo`'s `Repo` export cannot be loaded from any CDN with no build step (esm.sh resolves its circular `export *` entrypoints to an empty object; jsDelivr fails to resolve its WASM). User decision: keep Automerge and ship a **committed, locally-built vendor bundle**. The historical CDN spike lives at `test/spike-automerge.mjs` (commit `18873c1`) as the record — leave it.

**This task's deliverable gates everything else.** No feature task proceeds until two browser contexts importing the **committed** `vendor/automerge-collab.mjs` round-trip a document over `wss://sync.automerge.org`.

**Files:**
- Create: `build/package.json`, `build/entry.mjs`, `build/build.mjs` (esbuild script)
- Create (committed artifacts): `vendor/automerge-collab.mjs` (+ `vendor/automerge.wasm` if external)
- Create: `.gitignore` (add `build/node_modules/`)
- Create: `test/spike-bundle.mjs`

**Library API note:** before writing automerge calls, if unsure verify via `context7:resolve-library-id` then `context7:query-docs` (`/automerge/automerge-repo`). Known-good exports to surface: `Repo`, `Presence` (from `@automerge/automerge-repo`), `WebSocketClientAdapter` (from `@automerge/automerge-repo-network-websocket`), `updateText` (from `@automerge/automerge` — confirmed by the spike to live on the `/next` entry for the 2.x line).

- [ ] **Step 1: Create the build project**

`build/package.json`:
```json
{
  "name": "collab-vendor-build",
  "private": true,
  "type": "module",
  "dependencies": {
    "@automerge/automerge": "2.2.9",
    "@automerge/automerge-repo": "2.5.6",
    "@automerge/automerge-repo-network-websocket": "2.5.6"
  },
  "devDependencies": { "esbuild": "^0.24.0" },
  "scripts": { "build": "node build.mjs" }
}
```
`build/entry.mjs` (the single public surface the app imports):
```js
export { Repo, Presence } from "@automerge/automerge-repo";
export { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
export { updateText } from "@automerge/automerge/next";
```

- [ ] **Step 2: Write the esbuild bundler**

`build/build.mjs` bundles `entry.mjs` to `../vendor/automerge-collab.mjs` as an ESM bundle for the browser. Automerge core is WASM; prefer the recipe that yields a self-contained import. Start with the default (auto-initializing) automerge build bundled and the `.wasm` emitted as a sibling asset fetched at runtime:
```js
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
mkdirSync("../vendor", { recursive: true });
await build({
  entryPoints: ["entry.mjs"],
  bundle: true,
  format: "esm",
  outfile: "../vendor/automerge-collab.mjs",
  loader: { ".wasm": "file" },     // emit automerge.wasm next to the bundle, referenced by URL
  assetNames: "[name]",            // -> vendor/automerge.wasm (stable name)
  target: "es2022",
  logLevel: "info",
});
console.log("built vendor/automerge-collab.mjs");
```
If the `.wasm=file` loader path does not initialize at runtime, fall back to bundling the **slim** automerge entry and inlining the wasm as base64 (`loader: { ".wasm": "binary" }`) with an `initializeBase64Wasm` call wired into `entry.mjs`. Whichever works, the app-facing import surface (`Repo`, `Presence`, `WebSocketClientAdapter`, `updateText`, and — if needed — an exported `ensureReady()` that performs wasm init) must be stable. **Record the final surface at the top of `vendor/automerge-collab.mjs` as a comment and in the "Vendor bundle import" section below.**

- [ ] **Step 3: Build it**

Run:
```bash
cd $HOME/Desktop/pygame-playground/build && npm install && npm run build
```
Expected: `built vendor/automerge-collab.mjs`, and `ls ../vendor` shows the bundle (+ `automerge.wasm` if external).

- [ ] **Step 4: Write the round-trip test against the COMMITTED bundle**

Create `test/spike-bundle.mjs`. It serves from the same origin (so the bundle's sibling `.wasm` resolves), loads the vendor module in two pages, creates a doc in A, finds it in B, edits in B, asserts A observes it:
```js
import { launch } from './_harness.mjs';

const SRC = `
  import * as AM from "/vendor/automerge-collab.mjs";
  if (AM.ensureReady) await AM.ensureReady();   // no-op if wasm self-initializes
  window.__amr = AM;
  window.__amrReady = true;
`;
const host = async (page, label) => {
  const errs = [];
  page.on('pageerror', e => errs.push(label + ': ' + e));
  page.on('console', m => { if (m.type() === 'error') errs.push(label + ' console: ' + m.text()); });
  await page.goto('http://localhost:8923/');
  await page.addScriptTag({ type: 'module', content: SRC });
  await page.waitForFunction(() => window.__amrReady === true, null, { timeout: 30000 })
    .catch(() => { throw new Error(label + ' bundle never loaded; errors: ' + JSON.stringify(errs)); });
};
const b = await launch();
try {
  const A = await b.newPage(); await host(A, 'A');
  const url = await A.evaluate(async () => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = repo.create({ code: 'hello' }); await h.whenReady(); window.__h = h; return h.url;
  });
  console.log('created doc:', url);
  const B = await b.newPage(); await host(B, 'B');
  const found = await B.evaluate(async (u) => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = await repo.find(u); await h.whenReady(); window.__h = h; return h.doc().code;
  }, url);
  console.log('B sees code:', JSON.stringify(found));
  await B.evaluate(() => { const { updateText } = window.__amr; window.__h.change(d => updateText(d, ['code'], 'hello world')); });
  const sawIt = await A.waitForFunction(() => window.__h.doc().code === 'hello world', null, { timeout: 15000 }).then(() => true, () => false);
  console.log('A observed B edit:', sawIt);
  if (found !== 'hello' || !sawIt) { console.error('BUNDLE SPIKE FAILED'); process.exitCode = 1; }
  else console.log('BUNDLE SPIKE OK');
} finally { await b.close(); }
```

- [ ] **Step 5: Run it**

Run: `cd $HOME/Desktop/pygame-playground && node test/spike-bundle.mjs`
Expected: `B sees code: "hello"`, `A observed B edit: true`, `BUNDLE SPIKE OK`.

- [ ] **Step 6: If it fails, iterate on the bundler (Step 2 fallback), not the app**

Try the slim+base64 wasm recipe. If after a reasonable effort the bundle cannot round-trip, STOP and report BLOCKED with the captured errors — do not hand-edit the app to paper over a broken bundle.

- [ ] **Step 7: gitignore node_modules + record the import surface**

Create/append `.gitignore` with `build/node_modules/`. Edit the "Vendor bundle import" section below to record the exact exported surface and whether `ensureReady()` is required.

- [ ] **Step 8: Commit (artifacts included)**

```bash
git add build/package.json build/entry.mjs build/build.mjs vendor/ test/spike-bundle.mjs .gitignore docs/superpowers/plans/2026-06-18-collab-sharing.md
git commit -m "build: committed Automerge vendor bundle (round-trips a doc between tabs)"
```
(Commit the built `vendor/` artifacts — they are what GitHub Pages serves.)

---

## Vendor bundle import (filled by Task 1)

The app imports Automerge **only** from the committed bundle (never a CDN):

```js
const VENDOR_URL  = "/vendor/automerge-collab.mjs";   // committed, served statically by Pages
const SYNC_SERVER = "wss://sync.automerge.org";
// Surface: { Repo, Presence, WebSocketClientAdapter, updateText[, ensureReady] }
const NEEDS_ENSURE_READY = false; // <!-- Task 1 sets true if the slim+init recipe was used -->
```

`Repo`, `Presence`, `WebSocketClientAdapter`, `updateText` are all named exports of the bundle. If `NEEDS_ENSURE_READY`, call `await ensureReady()` once after import before constructing a `Repo`.

---

## Task 2: Collab module scaffold — lazy loader + status indicator (no sync yet)

Build the opt-in entry point and the header UI. No Automerge wiring yet beyond loading the libs; this task proves the solo path is untouched and the module loads on demand.

**Files:**
- Modify: `index.html` (header HTML; new `<script>` collab section near the run/stop wiring)
- Test: `test/collab.mjs` (create)

- [ ] **Step 1: Add the Collaborate button + live indicator to the header**

In `index.html`, after the `shareBtn` button, add:
```html
  <button id="collabBtn" title="Start a live collaboration room">👥 Collaborate</button>
  <span id="liveDot" hidden>● <span id="peerCount">1</span></span>
```
Add CSS near the other header rules:
```css
  #liveDot { font-size: 12.5px; color: var(--accent); padding: 4px 8px; }
  #liveDot.connecting { color: var(--warn); }
  #liveDot.offline { color: var(--bad); }
```

- [ ] **Step 2: Add the lazy loader + state object (collab module)**

In the main `<script>`, near the run/stop wiring, add:
```js
// ---------------------------------------------------------------- collaboration (lazy)
const collab = { repo: null, handle: null, presence: null, active: false, applyingRemote: false };

let _amCache = null;
async function loadAutomerge() {
  if (_amCache) return _amCache;
  const AM = await import("/vendor/automerge-collab.mjs");   // committed bundle, served statically
  if (AM.ensureReady) await AM.ensureReady();                 // wasm init if the slim recipe was used (Task 1)
  _amCache = { Repo: AM.Repo, Presence: AM.Presence,
               WebSocketClientAdapter: AM.WebSocketClientAdapter, updateText: AM.updateText };
  return _amCache;
}

function setLive(state, peers) {
  const dot = document.getElementById("liveDot");
  dot.hidden = !collab.active;
  dot.className = state;                 // '', 'connecting', 'offline'
  document.getElementById("peerCount").textContent = peers ?? 1;
}
```
The import path is the committed vendor bundle from Task 1 — never a CDN.

- [ ] **Step 2b: Wire the button to a stub (proves lazy-load, no room yet)**

```js
document.getElementById("collabBtn").addEventListener("click", async () => {
  document.getElementById("collabBtn").disabled = true;
  setLive("connecting", 1);
  window.__amLoaded = await loadAutomerge().then(() => true, (e) => { console.error(e); return false; });
  document.getElementById("collabBtn").disabled = false;
});
```
(Task 3 replaces this stub with real room creation.)

- [ ] **Step 3: Write the test — solo path loads no Automerge; button lazy-loads it**

Create `test/collab.mjs`:
```js
import { launch } from './_harness.mjs';
const b = await launch();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
try {
  const p = await b.newPage();
  const reqs = [];
  p.on('request', r => { if (/esm\.sh|automerge/.test(r.url())) reqs.push(r.url()); });
  await p.goto('http://localhost:8923/');
  await p.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  console.log('solo path automerge requests (want 0):', reqs.length);
  if (reqs.length !== 0) fail('solo path loaded automerge — must be lazy');
  await p.click('#collabBtn');
  const loaded = await p.waitForFunction(() => window.__amLoaded === true, null, { timeout: 30000 })
    .then(() => true, () => false);
  console.log('button lazy-loaded automerge:', loaded);
  if (!loaded) fail('automerge did not load on click');
  console.log(process.exitCode ? 'TASK2 FAIL' : 'TASK2 OK');
} finally { await b.close(); }
```

- [ ] **Step 4: Run it to verify it fails first (button not wired / lib missing)**

Temporarily before Step 2b is in place this would fail; after Steps 1–2b, run:
Run: `node test/collab.mjs`
Expected after implementation: `TASK2 OK` (solo requests 0, button lazy-loaded true).

- [ ] **Step 5: Regression**

Run: `node verify.mjs`
Expected: `VERIFY OK`.

- [ ] **Step 6: Commit**

```bash
git add index.html test/collab.mjs && git commit -m "feat(collab): opt-in Collaborate button lazy-loads Automerge; solo path untouched"
```

---

## Task 3: Create & join rooms — `#room=` URL, seed/adopt, load precedence

Replace the Task 2 stub: creating a room makes a doc seeded with the current code, sets `#room=`, copies the link; opening a `#room=` link finds and adopts the doc. No editor binding yet — just prove the code text transfers once on join.

**Files:**
- Modify: `index.html` (collab module; load-precedence in the existing init)
- Test: `test/collab.mjs` (extend)

- [ ] **Step 1: Add room create/join functions**

```js
async function startRoom() {
  const lib = await loadAutomerge();
  collab.lib = lib;
  collab.repo = new lib.Repo({ network: [new lib.WebSocketClientAdapter("wss://sync.automerge.org")] });
  collab.handle = collab.repo.create({ code: editor.getValue() });
  await collab.handle.whenReady();
  location.hash = "#room=" + collab.handle.url;
  await enterRoom();
  copyRoomLink();
}

async function joinRoom(url) {
  const lib = await loadAutomerge();
  collab.lib = lib;
  collab.repo = new lib.Repo({ network: [new lib.WebSocketClientAdapter("wss://sync.automerge.org")] });
  collab.handle = await collab.repo.find(url);
  await collab.handle.whenReady().catch(() => {});
  if (!collab.handle || collab.handle.isUnavailable?.()) { console.error("room unavailable"); setLive("offline", 1); return; }
  applyingRemoteSet(() => editor.setValue(collab.handle.doc().code ?? ""));
  await enterRoom();
}

function applyingRemoteSet(fn) { collab.applyingRemote = true; try { fn(); } finally { collab.applyingRemote = false; } }

async function enterRoom() {
  collab.active = true;
  setLive("", 1);
  document.getElementById("collabBtn").textContent = "🔗 Copy room link";
  bindEditor();      // Task 4
  startPresence();   // Task 5
}

function copyRoomLink() {
  const url = location.origin + location.pathname + location.hash;
  navigator.clipboard?.writeText(url).then(
    () => flashBtn("✓ link copied"), () => flashBtn("✓ link in URL bar"));
}
function flashBtn(text) {
  const b = document.getElementById("collabBtn"); const prev = b.textContent;
  b.textContent = text; setTimeout(() => { b.textContent = "🔗 Copy room link"; }, 1500);
}
```
Add no-op placeholders `function bindEditor(){}` and `function startPresence(){}` (filled in Tasks 4–5) so this task runs standalone.

- [ ] **Step 2: Rewire the button and add load precedence**

Replace the Task 2 stub click handler with:
```js
document.getElementById("collabBtn").addEventListener("click", () => {
  if (collab.active) copyRoomLink();
  else { setLive("connecting", 1); startRoom().catch((e) => { console.error(e); setLive("offline", 1); }); }
});
```
Find the existing load-precedence line (currently `editor.setValue(codeFromHash() ?? storage.get() ?? loadedExample);`) and add a room check **before** it:
```js
const roomFromHash = location.hash.startsWith("#room=") ? location.hash.slice(6) : null;
if (roomFromHash) {
  editor.setValue(loadedExample);                 // temporary until the doc arrives
  joinRoom(roomFromHash).catch((e) => console.error("join failed", e));
} else {
  editor.setValue(codeFromHash() ?? storage.get() ?? loadedExample);
}
```

- [ ] **Step 3: Pause solo autosave while in a room**

In the existing `editor.on("change", …)` autosave handler, guard the save:
```js
editor.on("change", () => {
  if (collab.active) return;                       // room is the source of truth; don't clobber solo draft
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.set(editor.getValue()), 400);
});
```
And in the `beforeunload` flush: `addEventListener("beforeunload", () => { if (!collab.active) storage.set(editor.getValue()); });`

- [ ] **Step 4: Extend the test — join adopts the creator's code**

Append to `test/collab.mjs` (new context joining the created room):
```js
// --- room create + join adopt ---
{
  const A = await b.newPage();
  await A.goto('http://localhost:8923/');
  await A.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
  await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('seeded_by_A = 123'));
  await A.click('#collabBtn');
  const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
  console.log('room hash:', hash.slice(0, 40) + '…');
  const B = await b.newPage();
  await B.goto('http://localhost:8923/' + hash);
  await B.waitForFunction(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue().includes('seeded_by_A'), null, { timeout: 30000 })
    .then(() => console.log('JOIN OK: B adopted A code'), () => { console.error('JOIN FAIL'); process.exitCode = 1; });
}
```

- [ ] **Step 5: Run**

Run: `node test/collab.mjs`
Expected: `JOIN OK: B adopted A code` (plus the Task 2 assertions still pass).

- [ ] **Step 6: Regression + commit**

Run: `node verify.mjs` → `VERIFY OK`.
```bash
git add index.html test/collab.mjs && git commit -m "feat(collab): create/join Automerge rooms via #room=, seed and adopt code, pause solo autosave"
```

---

## Task 4: Live two-way editor binding (prefix/suffix diff + echo guard)

Make edits flow continuously both ways while preserving the local cursor.

**Files:**
- Modify: `index.html` (`bindEditor`)
- Test: `test/collab.mjs` (extend)

- [ ] **Step 1: Implement `bindEditor`**

Replace the no-op `bindEditor` with:
```js
function bindEditor() {
  const { updateText } = collab.lib;
  // local -> doc
  editor.on("change", () => {
    if (!collab.active || collab.applyingRemote) return;
    const value = editor.getValue();
    if (value === collab.handle.doc().code) return;
    collab.handle.change(d => updateText(d, ["code"], value));
  });
  // doc -> local (minimal replaceRange on the changed middle, preserving cursor)
  collab.handle.on("change", ({ doc }) => {
    const next = doc.code ?? "";
    const cur = editor.getValue();
    if (next === cur) return;
    applyingRemoteSet(() => {
      let s = 0; while (s < cur.length && s < next.length && cur[s] === next[s]) s++;
      let e = 0; while (e < cur.length - s && e < next.length - s &&
                        cur[cur.length - 1 - e] === next[next.length - 1 - e]) e++;
      const from = editor.posFromIndex(s);
      const to = editor.posFromIndex(cur.length - e);
      editor.replaceRange(next.slice(s, next.length - e), from, to, "+remote");
    });
  });
}
```
Note: the local `editor.on("change", …)` autosave handler from Task 3 already early-returns when `collab.active`, so these two handlers coexist (autosave is paused; this one drives the doc).

- [ ] **Step 2: Extend the test — continuous two-way sync + concurrent edits survive**

Append to `test/collab.mjs`:
```js
// --- live two-way sync (reuse A & B from Task 3 block by re-opening a fresh room) ---
{
  const A = await b.newPage(); await A.goto('http://localhost:8923/');
  await A.waitForFunction(() => document.getElementById('collabBtn'), null, { timeout: 30000 });
  await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('line_one = 1\n'));
  await A.click('#collabBtn');
  const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
  const B = await b.newPage(); await B.goto('http://localhost:8923/' + hash);
  await B.waitForFunction(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue().includes('line_one'), null, { timeout: 30000 });
  // A types more; B should see it.
  await A.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('line_two = 2\n', { line: 1, ch: 0 }); });
  await B.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('line_two'), null, { timeout: 15000 })
    .then(() => console.log('SYNC A->B OK'), () => { console.error('SYNC A->B FAIL'); process.exitCode = 1; });
  // B types; A should see it (proves two-way).
  await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('from_b = 9\n', { line: 0, ch: 0 }); });
  await A.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('from_b'), null, { timeout: 15000 })
    .then(() => console.log('SYNC B->A OK'), () => { console.error('SYNC B->A FAIL'); process.exitCode = 1; });
  // Both edits coexist (CRDT merge, no clobber).
  const finalA = await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
  if (finalA.includes('line_two') && finalA.includes('from_b')) console.log('MERGE OK');
  else { console.error('MERGE FAIL:', JSON.stringify(finalA)); process.exitCode = 1; }
}
```

- [ ] **Step 3: Run**

Run: `node test/collab.mjs`
Expected: `SYNC A->B OK`, `SYNC B->A OK`, `MERGE OK`.

- [ ] **Step 4: Regression + commit**

Run: `node verify.mjs` → `VERIFY OK`.
```bash
git add index.html test/collab.mjs && git commit -m "feat(collab): live two-way editor binding with cursor-preserving diff and echo guard"
```

---

## Task 5: Presence — peer count + remote cursors

**Files:**
- Modify: `index.html` (`startPresence`, cursor rendering, CSS)
- Test: `test/collab.mjs` (extend)

- [ ] **Step 1: Add cursor CSS**

```css
  .remote-cursor { position: relative; border-left: 2px solid; margin-left: -1px; }
  .remote-flag { position: absolute; top: -1.1em; left: -1px; font-size: 10px; padding: 0 3px;
                 white-space: nowrap; color: #0b0d12; border-radius: 3px 3px 3px 0; }
```

- [ ] **Step 2: Implement `startPresence`**

```js
function startPresence() {
  const me = { name: "anon-" + Math.random().toString(36).slice(2, 6),
               color: "hsl(" + Math.floor(Math.random() * 360) + ",70%,60%)" };
  collab.presence = new collab.lib.Presence({ handle: collab.handle });
  collab.presence.start({ initialState: { cursor: { line: 0, ch: 0 }, user: me },
                          heartbeatMs: 5000, peerTtlMs: 60000 });
  editor.on("cursorActivity", () => {
    const c = editor.getCursor();
    collab.presence.broadcast("cursor", { line: c.line, ch: c.ch });
  });
  collab.markers = [];
  collab.presence.on("update", () => {
    const peers = collab.presence.getPeerStates().peers();
    setLive("", peers.length + 1);
    collab.markers.forEach(m => m.clear());
    collab.markers = peers.filter(p => p.state?.cursor).map(p => {
      const el = document.createElement("span");
      el.className = "remote-cursor";
      el.style.borderColor = p.state.user?.color || "#fff";
      const flag = document.createElement("span");
      flag.className = "remote-flag"; flag.textContent = p.state.user?.name || "peer";
      flag.style.background = p.state.user?.color || "#fff";
      el.appendChild(flag);
      return editor.setBookmark({ line: p.state.cursor.line, ch: p.state.cursor.ch }, { widget: el, insertLeft: true });
    });
  });
}
```

- [ ] **Step 3: Extend the test — peer count and a remote cursor marker**

Append to `test/collab.mjs` (reuse a fresh A/B room as in Task 4):
```js
// --- presence: peer count + remote cursor marker ---
{
  const A = await b.newPage(); await A.goto('http://localhost:8923/');
  await A.waitForFunction(() => document.getElementById('collabBtn'), null, { timeout: 30000 });
  await A.click('#collabBtn');
  const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
  const B = await b.newPage(); await B.goto('http://localhost:8923/' + hash);
  await B.waitForFunction(() => document.getElementById('liveDot') && !document.getElementById('liveDot').hidden, null, { timeout: 30000 });
  // Move B's cursor; A should show "Live (2)" and a remote-cursor marker.
  await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue('a\nb\nc'); cm.setCursor({ line: 2, ch: 1 }); });
  await A.waitForFunction(() => document.getElementById('peerCount').textContent === '2', null, { timeout: 20000 })
    .then(() => console.log('PEER COUNT OK'), () => { console.error('PEER COUNT FAIL'); process.exitCode = 1; });
  await A.waitForFunction(() => document.querySelector('.remote-cursor') !== null, null, { timeout: 20000 })
    .then(() => console.log('REMOTE CURSOR OK'), () => { console.error('REMOTE CURSOR FAIL'); process.exitCode = 1; });
}
```

- [ ] **Step 4: Run**

Run: `node test/collab.mjs`
Expected: `PEER COUNT OK`, `REMOTE CURSOR OK`.

- [ ] **Step 5: Regression + commit**

Run: `node verify.mjs` → `VERIFY OK`.
```bash
git add index.html test/collab.mjs && git commit -m "feat(collab): presence — live peer count and remote cursor markers"
```

---

## Task 6: Connection state + leave/solo + unavailable-room fallback

**Files:**
- Modify: `index.html` (network status listeners, leave handling)
- Test: `test/collab.mjs` (extend)

- [ ] **Step 1: Reflect connection state on the indicator**

After creating the repo in both `startRoom` and `joinRoom`, attach adapter status (the WebSocket adapter emits `peer-candidate`/`disconnect` via the repo's network subsystem; simplest reliable signal is `navigator.onLine` + a periodic check of `collab.presence.getPeerStates().peers().length`). Add:
```js
addEventListener("offline", () => { if (collab.active) setLive("offline", document.getElementById("peerCount").textContent); });
addEventListener("online",  () => { if (collab.active) setLive("", document.getElementById("peerCount").textContent); });
```

- [ ] **Step 2: Unavailable-room fallback (already stubbed in Task 3 joinRoom)**

Confirm `joinRoom` handles unavailable by setting `setLive("offline", 1)` and leaving the editor on the default example. Add a visible console note: `console.warn("Room not found or unavailable; staying solo.")` in that branch.

- [ ] **Step 3: Test — bad room id stays solo, page usable**

Append to `test/collab.mjs`:
```js
// --- bad room id => graceful solo fallback ---
{
  const p = await b.newPage();
  await p.goto('http://localhost:8923/#room=automerge:doesNotExist999');
  await p.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const usable = await p.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue('still_works = 1'); return cm.getValue(); });
  console.log('bad-room stays usable:', usable === 'still_works = 1' ? 'YES' : 'NO');
  if (usable !== 'still_works = 1') process.exitCode = 1;
}
```

- [ ] **Step 4: Run + regression + commit**

Run: `node test/collab.mjs` → all prior labels + `bad-room stays usable: YES`.
Run: `node verify.mjs` → `VERIFY OK`.
```bash
git add index.html test/collab.mjs && git commit -m "feat(collab): connection-state indicator and graceful fallback for unavailable rooms"
```

---

## Task 7: README + the run-time caveat note

**Files:**
- Modify: `README.md`
- Modify: `index.html` (one-line hint near the Collaborate button)

- [ ] **Step 1: Document collaboration in README**

Add a "Collaborate" section: click 👥 Collaborate to start a room; share the copied link; everyone edits the same code with live cursors; each person runs Pyodide locally. Note the caveats verbatim from the spec: public community sync server (free, occasionally flaky), anyone with the link can edit.

- [ ] **Step 2: Add a small hint**

In the header hint text, append: `· 👥 = live share`. Keep it terse.

- [ ] **Step 3: Commit**

```bash
git add README.md index.html && git commit -m "docs(collab): document live collaboration and its public-server caveats"
```

---

## Task 8: Final gate — full battery, live deploy, live verification

**Files:** none (verification + deploy)

- [ ] **Step 1: Full local regression + full collab suite**

Run: `node verify.mjs` → `VERIFY OK`.
Run: `node test/collab.mjs` → all labels OK.

- [ ] **Step 2: Confirm git state is a clean fast-forward**

Run: `git fetch -q origin && git rev-list --left-right --count origin/main...HEAD`
Expected: `0   <n>` (0 behind). If behind, STOP — another agent pushed; rebase and re-run Step 1 before deploying.

- [ ] **Step 3: Ask the user to authorize the deploy**

Deploying publishes to the live public site. Confirm with the user before pushing (per project norms). Only push on an explicit yes.

- [ ] **Step 4: Push and wait for Pages**

```bash
git push origin main
# poll until the deployed HTML contains the collab marker:
for i in $(seq 1 30); do curl -s https://partlywhole.github.io/pygame-playground/ | grep -q 'collabBtn' && { echo "DEPLOYED"; break; }; sleep 5; done
```

- [ ] **Step 5: Live verification (two contexts on the deployed site)**

Run a trimmed `test/collab.mjs` variant pointed at `https://partlywhole.github.io/pygame-playground/` (use `{ waitUntil: 'domcontentloaded' }` and longer timeouts for cold Pyodide) asserting: B adopts A's code, A↔B live sync, peer count 2. Report results.

---

## Self-review notes

- **Spec coverage:** architecture/lazy-load (Task 2), rooms+URLs+precedence (Task 3), two-way binding (Task 4), presence/cursors/peer count (Task 5), error handling/connection state/unavailable (Task 6), README+caveats (Task 7), WASM-load risk spike (Task 1), testing + regression invariant (every task + Task 8). Run-stays-local and autosave-pause are in Task 3. All spec sections map to a task.
- **Placeholder note:** the only intentional placeholders are the CDN URLs in "Pinned imports", which Task 1 is explicitly chartered to resolve before any feature task uses them; no task ships code with an unresolved URL because Tasks 2+ copy the pinned strings.
- **Naming consistency:** `collab.{repo,handle,presence,active,applyingRemote,lib,markers}`, `loadAutomerge`, `setLive`, `startRoom`, `joinRoom`, `enterRoom`, `bindEditor`, `startPresence`, `applyingRemoteSet`, `copyRoomLink`/`flashBtn` are used consistently across Tasks 2–6.
