// SPIKE: multi-file Automerge sync for the pygame playground.
//
// Goal: prove (or disprove) that the DESIGNED multi-file doc shape
//   { files: { [name]: text }, order: string[], entry: string }
// syncs and merges across two INDEPENDENT peers — concurrent edits to
// DIFFERENT files converge, a newly-added file propagates, and order/entry
// stay consistent.
//
// This file ONLY adds a test. It does NOT touch index.html, app code, or the
// committed vendor bundle. It imports the committed bundle
// (vendor/automerge-collab.mjs) by file URL, exactly like the NODE-DIRECT
// pattern proven in the investigation (Node 24 has a global WebSocket the
// bundle's isomorphic-ws shim picks up).
//
// Run:  node test/spike-collab-multifile.mjs
//
// Strategy (timeboxed):
//   TIER 1 (preferred) — real sync path: two Repos on wss://sync.automerge.org,
//     same transport the app uses (index.html startRoom). Relay has no
//     persistence, so the first find() can race the create announcement — we
//     use the mandatory ~1s unavailable-retry loop (see findWithRetry /
//     spike-bundle.mjs). If TIER 1 can't establish a round-trip within a short
//     budget, we fall back.
//   TIER 2 (fallback) — offline, no network: connect the two Repos with an
//     in-process loopback NetworkAdapter pair (messages piped peer-to-peer in
//     the same process). This proves the SAME CRDT-level result (doc shape,
//     nested-path updateText, structural map ops, concurrent-merge) without any
//     server, so the spike still yields a verdict if the relay is flaky.
//
// Both tiers exercise the identical assertion suite against two real Repos and
// the real committed bundle — only the transport differs.

import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';

const BUNDLE = '/Users/alan/Desktop/pygame-playground/vendor/automerge-collab.mjs';
const AM = await import(pathToFileURL(BUNDLE).href);
const { Repo, WebSocketClientAdapter, updateText } = AM;

// ---- tiny assert harness (mirrors spike-bundle.mjs exit-code convention) ----
let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- helpers ----------------------------------------------------------------
// AutomergeText stringifies via String(); strings round-trip as-is.
const fileText = (doc, name) => (doc.files[name] == null ? undefined : String(doc.files[name]));
const docToRecord = (doc) => ({
  files: Object.fromEntries(Object.keys(doc.files).map(n => [n, String(doc.files[n])])),
  order: [...doc.order],
  entry: doc.entry,
});

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
// Implements the automerge-repo NetworkAdapterInterface minimally: an
// EventEmitter that emits 'ready' | 'peer-candidate' | 'message' and forwards
// send() to the partner's message stream. Two of these, cross-wired, let two
// Repos in one process sync with zero network. This uses ONLY the public
// adapter contract — it does not subclass anything from the committed bundle.
function makeLoopbackPair() {
  class LoopbackAdapter extends EventEmitter {
    constructor() { super(); this.partner = null; this.peerId = null; this.ready = false; }
    isReady() { return this.ready; }
    whenReady() { return this.ready ? Promise.resolve() : new Promise(res => this.once('ready', res)); }
    connect(peerId) {
      this.peerId = peerId;
      this.ready = true;
      // announce readiness, then announce ourselves to the partner
      queueMicrotask(() => {
        this.emit('ready', { network: this });
        if (this.partner && this.partner.peerId) this._announceBoth();
      });
    }
    _announceBoth() {
      // each side learns of the other as a peer-candidate
      this.emit('peer-candidate', { peerId: this.partner.peerId, peerMetadata: {} });
      this.partner.emit('peer-candidate', { peerId: this.peerId, peerMetadata: {} });
    }
    send(message) {
      // deliver asynchronously to mimic a real wire and avoid reentrancy
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

// ============================================================================
// Assertion suite — runs against two ready handles hA (peer A) / hB (peer B)
// that already point at the SAME doc. `label` is the transport tier name.
// ============================================================================
async function runAssertions(hA, hB, label) {
  console.log(`\n--- assertions over ${label} ---`);

  // (1) ADOPT: B sees the full multi-file shape A created.
  check(`[${label}] B adopts files`,
    fileText(hB.doc(), 'main.py') === 'print(1)' &&
    fileText(hB.doc(), 'enemy.py') === 'class E: pass',
    JSON.stringify(docToRecord(hB.doc()).files));
  check(`[${label}] B adopts order`,
    JSON.stringify(hB.doc().order) === JSON.stringify(['main.py', 'enemy.py']),
    JSON.stringify(hB.doc().order));
  check(`[${label}] B adopts entry`, hB.doc().entry === 'main.py', hB.doc().entry);

  // (2) NESTED per-file text edit from B; A converges; OTHER file untouched.
  hB.change(d => updateText(d, ['files', 'enemy.py'], 'class E:\n  hp = 100'));
  const sawEnemy = await waitFor(hA, d => fileText(d, 'enemy.py') === 'class E:\n  hp = 100');
  check(`[${label}] nested updateText converges (enemy.py)`, sawEnemy, fileText(hA.doc(), 'enemy.py'));
  check(`[${label}] sibling file byte-identical (main.py untouched)`,
    fileText(hA.doc(), 'main.py') === 'print(1)', fileText(hA.doc(), 'main.py'));

  // (3) HEADLINE: concurrent edits to DIFFERENT files, no sync in between.
  //     A edits main.py, B edits enemy.py at the same time -> disjoint paths.
  hA.change(d => updateText(d, ['files', 'main.py'], 'print(1)\nprint(2)'));
  hB.change(d => updateText(d, ['files', 'enemy.py'], 'class E:\n  hp = 200'));
  const mainOnB = await waitFor(hB, d => fileText(d, 'main.py') === 'print(1)\nprint(2)');
  const enemyOnA = await waitFor(hA, d => fileText(d, 'enemy.py') === 'class E:\n  hp = 200');
  check(`[${label}] concurrent edit to different files: A's main.py reaches B`, mainOnB, fileText(hB.doc(), 'main.py'));
  check(`[${label}] concurrent edit to different files: B's enemy.py reaches A`, enemyOnA, fileText(hA.doc(), 'enemy.py'));
  // both survive on both peers (no clobber)
  const bothOnA = fileText(hA.doc(), 'main.py') === 'print(1)\nprint(2)' && fileText(hA.doc(), 'enemy.py') === 'class E:\n  hp = 200';
  const bothOnB = fileText(hB.doc(), 'main.py') === 'print(1)\nprint(2)' && fileText(hB.doc(), 'enemy.py') === 'class E:\n  hp = 200';
  check(`[${label}] both concurrent edits survive on both peers`, bothOnA && bothOnB,
    `A=${JSON.stringify(docToRecord(hA.doc()).files)} B=${JSON.stringify(docToRecord(hB.doc()).files)}`);

  // (4) STRUCTURAL: A adds a NEW file (new map key) + appends to order.
  //     IMPORTANT FINDING: updateText() can only EDIT an existing text object;
  //     it throws "invalid path" on a key that doesn't exist yet. So add-file is
  //     a plain map assignment (d.files[name] = initialString), which creates
  //     the text object; updateText is only for subsequent char-level edits.
  //     This is exactly how the real renderTabs "add file" handler must mutate
  //     the shared doc.
  hA.change(d => { d.files['boss.py'] = 'class Boss: pass'; d.order.push('boss.py'); });
  const bossOnB = await waitFor(hB, d => fileText(d, 'boss.py') === 'class Boss: pass' && d.order.includes('boss.py'));
  check(`[${label}] added file propagates to B`, bossOnB, fileText(hB.doc(), 'boss.py'));
  check(`[${label}] order grew consistently on B`,
    JSON.stringify(hB.doc().order) === JSON.stringify(['main.py', 'enemy.py', 'boss.py']),
    JSON.stringify(hB.doc().order));

  // (5) entry is a last-writer scalar; B sets it, A converges + stays consistent.
  hB.change(d => { d.entry = 'boss.py'; });
  const entryOnA = await waitFor(hA, d => d.entry === 'boss.py');
  check(`[${label}] entry change converges`, entryOnA, hA.doc().entry);

  // (6) FINAL CONSISTENCY: both peers agree on the entire record.
  const recA = JSON.stringify(docToRecord(hA.doc()));
  const recB = JSON.stringify(docToRecord(hB.doc()));
  check(`[${label}] both peers fully consistent (files+order+entry)`, recA === recB,
    recA === recB ? recA : `A=${recA}\n      B=${recB}`);
}

// ============================================================================
// TIER 1: live relay
// ============================================================================
async function tier1Live() {
  console.log('\n=== TIER 1: live sync via wss://sync.automerge.org ===');
  let repoA, repoB;
  try {
    repoA = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const hA = repoA.create({
      files: { 'main.py': 'print(1)', 'enemy.py': 'class E: pass' },
      order: ['main.py', 'enemy.py'],
      entry: 'main.py',
    });
    await hA.whenReady();
    const url = hA.url;
    console.log('created multi-file doc:', url);

    repoB = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const hB = await findWithRetry(repoB, url, { budget: 15000 });

    // sanity round-trip before the full suite: confirm B actually received content
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
  console.log('\n=== TIER 2 (fallback): offline in-process loopback, no network ===');
  const [adapterA, adapterB] = makeLoopbackPair();
  const repoA = new Repo({ network: [adapterA] });
  const repoB = new Repo({ network: [adapterB] });

  const hA = repoA.create({
    files: { 'main.py': 'print(1)', 'enemy.py': 'class E: pass' },
    order: ['main.py', 'enemy.py'],
    entry: 'main.py',
  });
  await hA.whenReady();
  const url = hA.url;
  console.log('created multi-file doc:', url);

  // give the loopback a moment to exchange peer-candidates
  await sleep(50);
  const hB = await repoB.find(url);
  await hB.whenReady();

  const adopted = await waitFor(hB, d => d && d.files && fileText(d, 'main.py') === 'print(1)', { timeout: 5000 });
  check('[offline] B adopted seed over loopback', adopted, fileText(hB.doc(), 'main.py'));

  await runAssertions(hA, hB, 'offline');
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

console.log('\n================ SPIKE SUMMARY ================');
console.log(`transport proven: ${tier1ok ? 'LIVE RELAY (wss://sync.automerge.org)' : 'OFFLINE LOOPBACK (network fell back)'}`);
const passed = results.filter(r => r.ok).length;
console.log(`assertions: ${passed}/${results.length} passed`);
if (failed > 0) {
  console.log(`SPIKE RESULT: FAIL (${failed} failing assertions)`);
  process.exitCode = 1;
} else {
  console.log('SPIKE RESULT: PASS — multi-file doc shape syncs & merges across two peers');
}

// ensure the process exits even if a Repo keeps a socket/timer alive
setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
