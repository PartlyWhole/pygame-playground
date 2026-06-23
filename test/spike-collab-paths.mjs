// SPIKE: multi-file Automerge sync with FOLDER-PATH keys for the pygame playground.
//
// Goal: RE-VALIDATE the multi-file CRDT proof when files carry NESTED PATHS.
// The existing green spike (test/spike-collab-multifile.mjs) proved the shape
//   { files: { [name]: text }, order: string[], entry: string }
// syncs/merges across two real peers for FLAT filenames. This spike extends that
// to FOLDER PATHS — files identified by 'main.py', 'sprites/enemy.py',
// 'sounds/blip.py' — and proves convergence still holds for:
//   1. concurrent edits to two DIFFERENT nested files,
//   2. adding a file inside a folder (new map key — plain assignment, NOT updateText),
//   3. rename / move-into-folder modeled as copy-and-delete,
//   4. 'order' + 'entry' (path-bearing) staying consistent,
//   5. an OFFLINE partition+merge test mirroring the existing spike.
//
// ============================================================================
// HEADLINE FINDING (this is the whole reason to re-validate paths, not flat):
// ----------------------------------------------------------------------------
// The committed bundle's updateText() resolves its PATH ARGUMENT by SPLITTING
// string components on "/". So calling
//     updateText(d, ['files', 'sprites/enemy.py'], next)
// is misread as the 4-component path  _root/files/sprites/enemy.py  and throws
//     "invalid path ... path component 1 (sprites) referenced a nonexistent object".
// The map KEY 'sprites/enemy.py' is perfectly valid for plain assignment, read
// (String()), delete, and use in order/entry — ONLY updateText's path arg breaks.
//
// FIX proven here: store each file under a SLASH-FREE encoded key
//     key = encodeURIComponent(displayPath)   // 'sprites/enemy.py' -> 'sprites%2Fenemy.py'
//     displayPath = decodeURIComponent(key)
// This keeps char-level CRDT merge (the entire point of per-file text) intact
// while letting updateText address a nested file. 'order' and 'entry' also hold
// the ENCODED keys so the whole doc is internally consistent; the UI decodes for
// display. The spike asserts BOTH the raw-slash failure (documented) and that the
// encoded-key path round-trips and converges. See REPORT for real-impl mapping.
// ============================================================================
//
// This file ONLY adds a test. It does NOT touch index.html, app code, the
// committed vendor bundle, or the existing spike. It imports the committed
// bundle (vendor/automerge-collab.mjs) by file URL, exactly like the existing
// spike (Node 24 has a global WebSocket the bundle's isomorphic-ws shim picks up).
//
// Run:  node test/spike-collab-paths.mjs
//       SPIKE_NO_NET=1 node test/spike-collab-paths.mjs   (offline only)
//
// Strategy (identical two-tier approach to spike-collab-multifile.mjs):
//   TIER 1 (preferred) — live sync: two Repos on wss://sync.automerge.org, the
//     same transport the app uses, with the mandatory ~1s unavailable-retry loop.
//   TIER 2 (fallback) — offline: two Repos wired with an in-process loopback
//     NetworkAdapter pair (no network). Same CRDT-level result, different transport.
// Both tiers run the IDENTICAL assertion suite against two real Repos + the real
// committed bundle — only the transport differs.

import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';

const BUNDLE = '/Users/alan/Desktop/pygame-playground/vendor/automerge-collab.mjs';
const AM = await import(pathToFileURL(BUNDLE).href);
const { Repo, WebSocketClientAdapter, updateText } = AM;

// ---- tiny assert harness (mirrors the existing spike's exit-code convention) -
let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- PATH ENCODING ----------------------------------------------------------
// Stored CRDT key must contain no '/' (see HEADLINE FINDING). Display path is
// the human folder path. enc/dec are total inverses for these inputs.
const enc = (displayPath) => encodeURIComponent(displayPath);
const dec = (key) => decodeURIComponent(key);

// ---- helpers ----------------------------------------------------------------
// AutomergeText stringifies via String(); strings round-trip as-is. We address
// files by DISPLAY path everywhere in the suite and encode at the boundary.
const fileText = (doc, displayPath) => {
  const v = doc.files[enc(displayPath)];
  return v == null ? undefined : String(v);
};
// updateText against a file addressed by DISPLAY path (encodes internally).
const editFile = (d, displayPath, next) => updateText(d, ['files', enc(displayPath)], next);
// add-file: plain assignment of the encoded key (creates the text object).
const addFile = (d, displayPath, initial) => { d.files[enc(displayPath)] = initial; };

// Record keyed by DISPLAY paths (decoded) for human-readable display.
const docToRecord = (doc) => ({
  files: Object.fromEntries(Object.keys(doc.files).map(k => [dec(k), String(doc.files[k])])),
  order: [...doc.order].map(dec),
  entry: dec(doc.entry),
});
const displayPaths = (doc) => Object.keys(doc.files).map(dec).sort();
// CANONICAL record for cross-peer EQUALITY: Automerge maps are unordered, so two
// converged peers can legitimately differ in files-key INSERTION order (each
// inserts its own concurrent add first). We sort the files keys before comparing
// so insertion order doesn't cause a false negative. 'order' is an Automerge LIST
// (positionally meaningful + CRDT-merged) so it is compared as-is.
const canonRecord = (doc) => {
  const r = docToRecord(doc);
  const filesSorted = {};
  for (const k of Object.keys(r.files).sort()) filesSorted[k] = r.files[k];
  return JSON.stringify({ files: filesSorted, order: r.order, entry: r.entry });
};

// Wait until predicate(doc) is true on a handle, polling. Returns true/false.
async function waitFor(handle, predicate, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  for (;;) {
    try { if (predicate(handle.doc())) return true; } catch { /* doc not ready */ }
    if (Date.now() - start > timeout) return false;
    await sleep(interval);
  }
}

// The mandatory unavailable-retry loop for the no-persistence relay.
async function findWithRetry(repo, url, { budget = 15000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const h = await repo.find(url);
      await h.whenReady();
      return h;
    } catch (e) {
      if (Date.now() - start > budget) throw e;
      await sleep(1000);
    }
  }
}

// ---- TIER 2 transport: in-process loopback NetworkAdapter pair --------------
// Copied verbatim (public adapter contract only) from spike-collab-multifile.mjs.
// Two cross-wired EventEmitters let two Repos in one process sync with zero network.
function makeLoopbackPair() {
  class LoopbackAdapter extends EventEmitter {
    constructor() { super(); this.partner = null; this.peerId = null; this.ready = false; }
    isReady() { return this.ready; }
    whenReady() { return this.ready ? Promise.resolve() : new Promise(res => this.once('ready', res)); }
    connect(peerId) {
      this.peerId = peerId;
      this.ready = true;
      queueMicrotask(() => {
        this.emit('ready', { network: this });
        if (this.partner && this.partner.peerId) this._announceBoth();
      });
    }
    _announceBoth() {
      this.emit('peer-candidate', { peerId: this.partner.peerId, peerMetadata: {} });
      this.partner.emit('peer-candidate', { peerId: this.peerId, peerMetadata: {} });
    }
    send(message) {
      const partner = this.partner;
      queueMicrotask(() => partner.emit('message', message));
    }
    disconnect() { this.ready = false; }
  }
  const a = new LoopbackAdapter();
  const b = new LoopbackAdapter();
  a.partner = b; b.partner = a;
  return [a, b];
}

// ---- shared seed (FOLDER-PATH files, stored under ENCODED keys) -------------
// Display paths: main.py at root; the rest inside folders. files/order/entry all
// hold the ENCODED keys; the UI would decode for display.
const SEED_PATHS = ['main.py', 'sprites/enemy.py', 'sounds/blip.py'];
const SEED_TEXT = { 'main.py': 'print(1)', 'sprites/enemy.py': 'class Enemy: pass', 'sounds/blip.py': 'BLIP = 1' };
function seedDoc() {
  const files = {};
  for (const p of SEED_PATHS) files[enc(p)] = SEED_TEXT[p];
  return { files, order: SEED_PATHS.map(enc), entry: enc('main.py') };
}

// ============================================================================
// Assertion suite — runs against two ready handles hA (peer A) / hB (peer B)
// that already point at the SAME doc. `label` is the transport tier name.
// ============================================================================
async function runAssertions(hA, hB, label) {
  console.log(`\n--- assertions over ${label} (FOLDER PATHS) ---`);

  // (0) DOCUMENT THE HEADLINE GOTCHA: raw-slash updateText path throws; encoded
  //     path works. Both are asserted so the failure mode is captured in the run.
  let rawSlashThrew = false, rawSlashMsg = '';
  try {
    hA.change(d => updateText(d, ['files', 'sprites/enemy.py'], 'should throw'));
  } catch (e) { rawSlashThrew = true; rawSlashMsg = (e && e.message) || String(e); }
  check(`[${label}] raw-slash updateText path THROWS (documents the gotcha)`,
    rawSlashThrew && /invalid path/.test(rawSlashMsg), rawSlashMsg);

  // (1) ADOPT: B sees the full folder-path shape A created (decoded for display).
  check(`[${label}] B adopts folder-path files`,
    fileText(hB.doc(), 'main.py') === 'print(1)' &&
    fileText(hB.doc(), 'sprites/enemy.py') === 'class Enemy: pass' &&
    fileText(hB.doc(), 'sounds/blip.py') === 'BLIP = 1',
    JSON.stringify(docToRecord(hB.doc()).files));
  check(`[${label}] B adopts order (folder paths)`,
    JSON.stringify(docToRecord(hB.doc()).order) === JSON.stringify(SEED_PATHS),
    JSON.stringify(docToRecord(hB.doc()).order));
  check(`[${label}] B adopts entry (folder path)`, dec(hB.doc().entry) === 'main.py', dec(hB.doc().entry));

  // (2) HEADLINE: concurrent edits to two DIFFERENT NESTED files, no sync between.
  //     peer1 (A) edits sprites/enemy.py, peer2 (B) edits sounds/blip.py at the
  //     same time -> disjoint CRDT paths -> both survive on both peers.
  hA.change(d => editFile(d, 'sprites/enemy.py', 'class Enemy:\n  hp = 100'));
  hB.change(d => editFile(d, 'sounds/blip.py', 'BLIP = 1\nBOOP = 2'));
  const enemyOnB = await waitFor(hB, d => fileText(d, 'sprites/enemy.py') === 'class Enemy:\n  hp = 100');
  const blipOnA  = await waitFor(hA, d => fileText(d, 'sounds/blip.py') === 'BLIP = 1\nBOOP = 2');
  check(`[${label}] concurrent nested edit: A's sprites/enemy.py reaches B`, enemyOnB, fileText(hB.doc(), 'sprites/enemy.py'));
  check(`[${label}] concurrent nested edit: B's sounds/blip.py reaches A`, blipOnA, fileText(hA.doc(), 'sounds/blip.py'));
  const bothOnA = fileText(hA.doc(), 'sprites/enemy.py') === 'class Enemy:\n  hp = 100' && fileText(hA.doc(), 'sounds/blip.py') === 'BLIP = 1\nBOOP = 2';
  const bothOnB = fileText(hB.doc(), 'sprites/enemy.py') === 'class Enemy:\n  hp = 100' && fileText(hB.doc(), 'sounds/blip.py') === 'BLIP = 1\nBOOP = 2';
  check(`[${label}] both concurrent nested edits survive on both peers`, bothOnA && bothOnB,
    `A=${JSON.stringify(docToRecord(hA.doc()).files)} B=${JSON.stringify(docToRecord(hB.doc()).files)}`);
  check(`[${label}] root sibling (main.py) byte-identical after nested edits`,
    fileText(hA.doc(), 'main.py') === 'print(1)' && fileText(hB.doc(), 'main.py') === 'print(1)',
    `A=${fileText(hA.doc(), 'main.py')} B=${fileText(hB.doc(), 'main.py')}`);

  // (3) ADD A FILE INSIDE A FOLDER (new map key) + append to order.
  //     GOTCHA from the flat spike: updateText cannot create a new key — add is a
  //     plain assignment first (addFile), then updateText for char-level edits.
  hA.change(d => { addFile(d, 'sprites/boss.py', 'class Boss: pass'); d.order.push(enc('sprites/boss.py')); });
  const bossOnB = await waitFor(hB, d => fileText(d, 'sprites/boss.py') === 'class Boss: pass' && d.order.map(dec).includes('sprites/boss.py'));
  check(`[${label}] added file inside folder (sprites/boss.py) propagates to B`, bossOnB, fileText(hB.doc(), 'sprites/boss.py'));
  hB.change(d => editFile(d, 'sprites/boss.py', 'class Boss:\n  hp = 500'));
  const bossEdited = await waitFor(hA, d => fileText(d, 'sprites/boss.py') === 'class Boss:\n  hp = 500');
  check(`[${label}] updateText on the newly-added nested key converges`, bossEdited, fileText(hA.doc(), 'sprites/boss.py'));

  // (4) FILE IN A BRAND-NEW FOLDER prefix (folder did not exist before).
  hA.change(d => { addFile(d, 'levels/level1.py', 'LEVEL = 1'); d.order.push(enc('levels/level1.py')); });
  const levelOnB = await waitFor(hB, d => fileText(d, 'levels/level1.py') === 'LEVEL = 1' && d.order.map(dec).includes('levels/level1.py'));
  check(`[${label}] file in a brand-new folder (levels/level1.py) propagates`, levelOnB, fileText(hB.doc(), 'levels/level1.py'));

  // (5) MOVE-INTO-FOLDER as copy-and-delete in ONE change() txn: main.py -> core/main.py.
  //     Copy current value to the new key, delete old key, rewrite order, fix entry.
  hA.change(d => {
    const cur = String(d.files[enc('main.py')]);
    d.files[enc('core/main.py')] = cur;                 // copy (plain assignment)
    delete d.files[enc('main.py')];                     // delete old key
    d.order = d.order.map(k => k === enc('main.py') ? enc('core/main.py') : k); // rewrite order
    if (d.entry === enc('main.py')) d.entry = enc('core/main.py');              // keep entry consistent
  });
  const movedOnB = await waitFor(hB, d =>
    fileText(d, 'core/main.py') === 'print(1)' &&
    d.files[enc('main.py')] == null &&
    d.order.map(dec).includes('core/main.py') && !d.order.map(dec).includes('main.py') &&
    dec(d.entry) === 'core/main.py');
  check(`[${label}] move-into-folder (main.py -> core/main.py) converges`, movedOnB,
    `files=${JSON.stringify(displayPaths(hB.doc()))} order=${JSON.stringify(docToRecord(hB.doc()).order)} entry=${dec(hB.doc().entry)}`);
  check(`[${label}] old key gone on A after move`, hA.doc().files[enc('main.py')] == null, JSON.stringify(displayPaths(hA.doc())));

  // (6) PLAIN RENAME within the same folder: sprites/enemy.py -> sprites/villain.py.
  hB.change(d => {
    const cur = String(d.files[enc('sprites/enemy.py')]);
    d.files[enc('sprites/villain.py')] = cur;
    delete d.files[enc('sprites/enemy.py')];
    d.order = d.order.map(k => k === enc('sprites/enemy.py') ? enc('sprites/villain.py') : k);
  });
  const renamedOnA = await waitFor(hA, d =>
    fileText(d, 'sprites/villain.py') === 'class Enemy:\n  hp = 100' &&
    d.files[enc('sprites/enemy.py')] == null &&
    d.order.map(dec).includes('sprites/villain.py') && !d.order.map(dec).includes('sprites/enemy.py'));
  check(`[${label}] rename within folder (sprites/enemy.py -> sprites/villain.py) converges`, renamedOnA,
    `files=${JSON.stringify(displayPaths(hA.doc()))} order=${JSON.stringify(docToRecord(hA.doc()).order)}`);

  // (7) entry is a LWW scalar; B sets it to a nested path; A converges.
  hB.change(d => { d.entry = enc('core/main.py'); });
  const entryOnA = await waitFor(hA, d => dec(d.entry) === 'core/main.py');
  check(`[${label}] entry (folder path) change converges`, entryOnA, dec(hA.doc().entry));

  // (8) ORDER + ENTRY consistency (PROVE item #4): order set == files key set,
  //     and entry is a path that exists, on BOTH peers.
  const dA = hA.doc(), dB = hB.doc();
  const orderMatchesKeysA = [...dA.order].sort().join(',') === Object.keys(dA.files).sort().join(',');
  const orderMatchesKeysB = [...dB.order].sort().join(',') === Object.keys(dB.files).sort().join(',');
  check(`[${label}] order set == files key set on both peers`, orderMatchesKeysA && orderMatchesKeysB,
    `A.order=${JSON.stringify(docToRecord(dA).order)} A.files=${JSON.stringify(displayPaths(dA))}`);
  check(`[${label}] entry points at a live path on both peers`,
    dA.files[dA.entry] != null && dB.files[dB.entry] != null,
    `A.entry=${dec(dA.entry)} B.entry=${dec(dB.entry)}`);

  // (9) FINAL CONSISTENCY: both peers agree on the entire (decoded) record.
  //     Canonical compare (sorted files keys) — see canonRecord rationale.
  const recA = canonRecord(hA.doc());
  const recB = canonRecord(hB.doc());
  check(`[${label}] both peers fully consistent (files+order+entry)`, recA === recB,
    recA === recB ? recA : `A=${recA}\n      B=${recB}`);
}

// ============================================================================
// OFFLINE PARTITION + MERGE (PROVE item #5): two peers DIVERGE while not syncing
// each change individually, then reconcile. Disjoint nested paths must both
// survive; concurrent order appends both land (list CRDT). Owns its own repos so
// it is deterministic regardless of whether the live relay was reachable.
// ============================================================================
async function offlinePartitionMerge() {
  console.log('\n--- offline partition + merge (folder paths) ---');
  const [adA, adB] = makeLoopbackPair();
  const repoA = new Repo({ network: [adA] });
  const repoB = new Repo({ network: [adB] });

  const hA = repoA.create(seedDoc());
  await hA.whenReady();
  const url = hA.url;
  await sleep(50);
  const hB = await repoB.find(url);
  await hB.whenReady();
  const adopted = await waitFor(hB, d => d && d.files && fileText(d, 'main.py') === 'print(1)', { timeout: 5000 });
  check('[offline-merge] B adopted folder-path seed', adopted, fileText(hB.doc(), 'main.py'));

  // Diverge: A edits one nested file + adds sprites/a.py; B edits a different
  // nested file + adds sounds/b.py. Issue both before awaiting convergence.
  hA.change(d => { editFile(d, 'sprites/enemy.py', 'class Enemy:\n  ai = True'); addFile(d, 'sprites/a.py', 'A = 1'); d.order.push(enc('sprites/a.py')); });
  hB.change(d => { editFile(d, 'sounds/blip.py', 'BLIP = 9'); addFile(d, 'sounds/b.py', 'B = 2'); d.order.push(enc('sounds/b.py')); });

  const conv = (d) =>
    fileText(d, 'sprites/enemy.py') === 'class Enemy:\n  ai = True' &&
    fileText(d, 'sounds/blip.py') === 'BLIP = 9' &&
    fileText(d, 'sprites/a.py') === 'A = 1' &&
    fileText(d, 'sounds/b.py') === 'B = 2';
  const convergedA = await waitFor(hA, conv);
  const convergedB = await waitFor(hB, conv);
  check('[offline-merge] divergent nested edits both survive on A', convergedA, JSON.stringify(docToRecord(hA.doc()).files));
  check('[offline-merge] divergent nested edits both survive on B', convergedB, JSON.stringify(docToRecord(hB.doc()).files));
  const orderHasBoth = hA.doc().order.map(dec).includes('sprites/a.py') && hA.doc().order.map(dec).includes('sounds/b.py');
  check('[offline-merge] concurrent order appends both present', orderHasBoth, JSON.stringify(docToRecord(hA.doc()).order));
  const recA = canonRecord(hA.doc());
  const recB = canonRecord(hB.doc());
  check('[offline-merge] both peers fully consistent after merge', recA === recB,
    recA === recB ? 'identical' : `A=${recA}\n      B=${recB}`);

  try { await repoA?.shutdown?.(); } catch {}
  try { await repoB?.shutdown?.(); } catch {}
}

// ============================================================================
// TIER 1: live relay
// ============================================================================
async function tier1Live() {
  console.log('\n=== TIER 1: live sync via wss://sync.automerge.org (FOLDER PATHS) ===');
  let repoA, repoB;
  try {
    repoA = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const hA = repoA.create(seedDoc());
    await hA.whenReady();
    const url = hA.url;
    console.log('created folder-path doc:', url);

    repoB = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const hB = await findWithRetry(repoB, url, { budget: 15000 });

    const adopted = await waitFor(hB, d => d && d.files && fileText(d, 'main.py') === 'print(1)', { timeout: 8000 });
    if (!adopted) throw new Error('B did not adopt seed within budget (relay flaky)');

    await runAssertions(hA, hB, 'live-relay');
    return true;
  } catch (e) {
    console.log('TIER 1 unavailable/flaky:', e && e.message ? e.message : String(e));
    return false;
  } finally {
    try { await repoA?.shutdown?.(); } catch {}
    try { await repoB?.shutdown?.(); } catch {}
  }
}

// ============================================================================
// TIER 2: offline in-process loopback (no network)
// ============================================================================
async function tier2Offline() {
  console.log('\n=== TIER 2 (fallback): offline in-process loopback, no network (FOLDER PATHS) ===');
  const [adapterA, adapterB] = makeLoopbackPair();
  const repoA = new Repo({ network: [adapterA] });
  const repoB = new Repo({ network: [adapterB] });

  const hA = repoA.create(seedDoc());
  await hA.whenReady();
  const url = hA.url;
  console.log('created folder-path doc:', url);

  await sleep(50);
  const hB = await repoB.find(url);
  await hB.whenReady();

  const adopted = await waitFor(hB, d => d && d.files && fileText(d, 'main.py') === 'print(1)', { timeout: 5000 });
  check('[offline] B adopted folder-path seed over loopback', adopted, fileText(hB.doc(), 'main.py'));

  await runAssertions(hA, hB, 'offline');

  try { await repoA?.shutdown?.(); } catch {}
  try { await repoB?.shutdown?.(); } catch {}
}

// ============================================================================
// main
// ============================================================================
const TIER1_ENABLED = process.env.SPIKE_NO_NET !== '1';
let tier1ok = false;
if (TIER1_ENABLED) {
  tier1ok = await Promise.race([
    tier1Live(),
    sleep(45000).then(() => { console.log('TIER 1 hit 45s wall-clock budget'); return false; }),
  ]);
} else {
  console.log('SPIKE_NO_NET=1 set — skipping live tier.');
}

if (!tier1ok) {
  console.log('\nFalling back to offline CRDT proof (transport differs, CRDT result identical).');
  await tier2Offline();
}

// The offline partition/merge proof always runs (PROVE item #5).
await offlinePartitionMerge();

console.log('\n================ SPIKE SUMMARY ================');
console.log(`transport proven: ${tier1ok ? 'LIVE RELAY (wss://sync.automerge.org)' : 'OFFLINE LOOPBACK (network fell back)'}`);
const passed = results.filter(r => r.ok).length;
console.log(`assertions: ${passed}/${results.length} passed`);
if (failed > 0) {
  console.log(`SPIKE RESULT: FAIL (${failed} failing assertions)`);
  process.exitCode = 1;
} else {
  console.log('SPIKE RESULT: PASS — FOLDER-PATH multi-file doc syncs & merges across two peers (encoded keys)');
}

setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
