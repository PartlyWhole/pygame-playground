// De-risking spike for the "history panel" feature. Proves, in real headless
// Chromium against the locally-built scratch bundle, that Automerge 2.2.9 /
// automerge-repo 2.5.6 expose everything a history panel needs:
//   3a. a multi-version history accrues from a series of edits
//   3b. enumerate versions with metadata (actor, time, message)
//   3c. time-travel: materialize the doc at a PAST version
//   3d. diff: compute a patch between two versions
//   3e. revert: revert-as-new-change converges across a peer
//   4a. solo: a LOCAL doc (no sync server, no room) still accrues full history
//
// Run:  node test/spike-history.mjs       (static server must serve repo root on :8923)
// Imports vendor/automerge-history-spike.mjs (NOT the committed collab bundle).
import { launch } from './_harness.mjs';

const SRC = `
  import * as AM from "/vendor/automerge-history-spike.mjs";
  if (AM.ensureReady) await AM.ensureReady();
  window.__amr = AM; window.__amrReady = true;
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

const results = {};
const assert = (name, cond, detail) => {
  results[name] = { ok: !!cond, detail };
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  if (!cond) process.exitCode = 1;
};

const b = await launch();
try {
  // ============================================================ COLLAB PATH (3a-3e)
  const A = await b.newPage(); await host(A, 'A');

  // 3a. create a doc and make a SERIES of distinct edits => real multi-version history
  const created = await A.evaluate(async () => {
    const { Repo, WebSocketClientAdapter, updateText, getAllChanges, getHeads } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = repo.create({ code: 'v1' });
    await h.whenReady();
    window.__repo = repo; window.__h = h;
    // Snapshot the RAW heads (hex hash[]) after each version for the bare-API
    // view(doc, heads)/diff(doc,a,b). NOTE: getHeads(doc) returns raw hashes,
    // whereas handle.heads()/history() return UrlHeads (tagged) — the two are
    // NOT interchangeable. (A key finding for the panel: see report.)
    const headsByVersion = { v1: getHeads(h.doc()) };
    for (const v of ['v2', 'v3', 'v4']) {
      h.change(d => updateText(d, ['code'], v), { message: 'set ' + v, time: Math.floor(Date.now() / 1000) });
      headsByVersion[v] = getHeads(h.doc());
    }
    window.__headsByVersion = headsByVersion;
    return {
      url: h.url,
      finalCode: h.doc().code,
      numRawChanges: getAllChanges(h.doc()).length,
      headsByVersion,
      currentHeads: getHeads(h.doc()),
    };
  });
  assert('3a multi-version history accrues (>=4 changes)', created.numRawChanges >= 4,
    { numRawChanges: created.numRawChanges, finalCode: created.finalCode });

  // 3b. enumerate the change history with metadata (actor / time / message)
  const history = await A.evaluate(async () => {
    const { getAllChanges, decodeChange } = window.__amr;
    const h = window.__h;
    // (i) handle.history() => array of UrlHeads, one per change, topo-sorted
    const handleHistory = h.history();
    // (ii) raw changes decoded for metadata
    const decoded = getAllChanges(h.doc()).map(c => {
      const dc = decodeChange(c);
      return { actor: dc.actor, seq: dc.seq, time: dc.time, message: dc.message, hash: dc.hash.slice(0, 8) };
    });
    // (iii) handle.metadata(hash) — the DocHandle convenience for one change
    const lastHash = handleHistory[handleHistory.length - 1][0];
    const meta = h.metadata(lastHash);
    return {
      handleHistoryLen: handleHistory.length,
      decoded,
      metadataSample: meta ? { actor: meta.actor, time: meta.time, message: meta.message } : null,
    };
  });
  assert('3b enumerate versions with metadata', history.decoded.length >= 4 &&
    history.decoded.every(d => typeof d.actor === 'string' && typeof d.time === 'number'),
    { handleHistoryLen: history.handleHistoryLen, decoded: history.decoded, metadataSample: history.metadataSample });

  // 3c. time-travel: materialize the doc AT a past version, assert old code value
  const travel = await A.evaluate(async () => {
    const { view, getHeads } = window.__amr;
    const h = window.__h;
    const heads = window.__headsByVersion; // raw heads
    // (i) bare-API view(doc, rawHeads)
    const v2DocView = view(h.doc(), heads.v2);
    // (ii) DocHandle.view(urlHeads) -> a handle whose .doc() is the past snapshot.
    //      handle.history() yields UrlHeads, which is exactly what handle.view wants.
    const hist = h.history();           // UrlHeads[], topo-sorted, one per change
    const v2Handle = h.view(hist[1]);   // hist[1] == version after v2
    return {
      apiViewCodeAtV1: view(h.doc(), heads.v1).code,
      apiViewCodeAtV2: v2DocView.code,
      apiViewCodeAtV3: view(h.doc(), heads.v3).code,
      handleViewCodeAtV2: v2Handle.doc().code,
      currentCode: h.doc().code,
    };
  });
  assert('3c time-travel materializes old code (bare-API + DocHandle.view)',
    travel.apiViewCodeAtV1 === 'v1' && travel.apiViewCodeAtV2 === 'v2' &&
    travel.apiViewCodeAtV3 === 'v3' && travel.handleViewCodeAtV2 === 'v2' &&
    travel.currentCode === 'v4',
    travel);

  // 3d. diff between two versions — report the patch shape
  const diffOut = await A.evaluate(async () => {
    const { diff } = window.__amr;
    const h = window.__h;
    const heads = window.__headsByVersion;
    const patchesV1toV4 = diff(h.doc(), heads.v1, heads.v4);
    const patchesV2toV3 = diff(h.doc(), heads.v2, heads.v3);
    return { patchesV1toV4, patchesV2toV3 };
  });
  // a real text change should produce at least one splice/del/put patch on path ["code", ...]
  assert('3d diff reflects the text change', Array.isArray(diffOut.patchesV1toV4) &&
    diffOut.patchesV1toV4.length > 0 &&
    diffOut.patchesV1toV4.every(p => p.path[0] === 'code'),
    { v1_to_v4: diffOut.patchesV1toV4, v2_to_v3: diffOut.patchesV2toV3 });

  // 3e. revert-as-new-change: read old code at a head, write it back as a NEW change,
  //     assert the doc AND a peer converge on the reverted value.
  const url = created.url;
  const B = await b.newPage(); await host(B, 'B');
  const bSees = await B.evaluate(async (u) => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const start = Date.now();
    for (;;) {
      try {
        const h = await repo.find(u); await h.whenReady(); window.__hB = h; return h.doc().code;
      } catch (e) {
        if (Date.now() - start > 15000) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }, url);
  assert('3e peer B joined and sees v4', bSees === 'v4', { bSees });

  // A performs the revert: read code at the v2 head, write it as a new change.
  await A.evaluate(async () => {
    const { view, updateText, getHeads } = window.__amr;
    const h = window.__h;
    const oldCode = view(h.doc(), window.__headsByVersion.v2).code; // "v2"
    h.change(d => updateText(d, ['code'], oldCode), { message: 'revert to v2' });
    window.__revertedHeads = getHeads(h.doc());
  });
  const aReverted = await A.evaluate(() => window.__h.doc().code);
  const bConverged = await B.waitForFunction(() => window.__hB.doc().code === 'v2', null, { timeout: 15000 })
    .then(() => true, () => false);
  // revert is a NEW change: history grows (no destructive rollback), code is back to v2
  const histAfterRevert = await A.evaluate(() => window.__amr.getAllChanges(window.__h.doc()).length);
  assert('3e revert-as-new-change: doc=v2, peer converged, history grew', aReverted === 'v2' && bConverged &&
    histAfterRevert > created.numRawChanges,
    { aReverted, bConverged, changesBefore: created.numRawChanges, changesAfter: histAfterRevert });

  // ============================================================ SOLO PATH (4a)
  // Prove a LOCAL doc with NO network adapter (no sync server, no room) still
  // accrues full change history + time-travel + diff. Uses a fresh page so there
  // is zero collab state.
  const S = await b.newPage(); await host(S, 'S');
  const solo = await S.evaluate(async () => {
    const { Repo, updateText, getAllChanges, view, diff, getHeads, decodeChange } = window.__amr;
    // Repo with NO network and NO storage adapter => purely local, offline.
    const repo = new Repo({});
    const h = repo.create({ code: 's1' });
    await h.whenReady();
    const headsS1 = getHeads(h.doc()); // raw heads for bare view()/diff()
    for (const v of ['s2', 's3']) h.change(d => updateText(d, ['code'], v), { message: 'solo ' + v });
    const changes = getAllChanges(h.doc());
    const oldView = view(h.doc(), headsS1);
    const patches = diff(h.doc(), headsS1, getHeads(h.doc()));
    return {
      numChanges: changes.length,
      finalCode: h.doc().code,
      timeTravelToS1: oldView.code,
      diffOps: patches.map(p => p.action),
      lastMsg: decodeChange(changes[changes.length - 1]).message,
      hasNetwork: false,
    };
  });
  assert('4a solo local doc accrues history (no server/room)', solo.numChanges >= 3 &&
    solo.timeTravelToS1 === 's1' && solo.finalCode === 's3' && solo.diffOps.length > 0,
    solo);

  console.log('\n===== HISTORY SPIKE SUMMARY =====');
  console.log(JSON.stringify(results, null, 2));
  const allOk = Object.values(results).every(r => r.ok);
  console.log(allOk ? '\nHISTORY SPIKE OK' : '\nHISTORY SPIKE FAILED');
  if (!allOk) process.exitCode = 1;
} catch (e) {
  console.error('HISTORY SPIKE THREW:', e);
  process.exitCode = 1;
} finally {
  await b.close();
}
