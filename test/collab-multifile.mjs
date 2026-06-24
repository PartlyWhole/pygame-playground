// S6a — multi-file collaboration CRDT / reconciliation TWO-PEER browser battery (TDD RED).
//
// This is the multi-file successor to test/collab.mjs. collab.mjs STAYS as the
// single-file (depth-1) guardrail; this file proves the *multi-file* room: a
// project with more than one file (including a NESTED file under a folder) is
// seeded whole, adopted whole, and reconciled correctly when two real peers edit
// concurrently. The residual risk S6a retires is UI-integration RECONCILIATION
// (ghost tabs / lost files / cursor jumps) — the bit CRDT-level spikes can't see.
//
// Modeled on test/collab.mjs EXACTLY: ./_harness.mjs launch(), b.newPage(),
// localhost-pinned, peer A creates a `#room=` room via #collabStartBtn, peer B
// JOINs the room URL, sync asserted over the REAL relay wss://sync.automerge.org.
//
// RELAY HANDLING (design §0.1 Q2): the app has no in-browser loopback like the
// Node spike, so the live two-peer assertions are relay-dependent. If the relay
// is unreachable we SKIP the live assertions ("skipped — relay unreachable",
// exit 0) rather than FAIL. The solo-zero-Automerge regression guard runs and is
// asserted UNCONDITIONALLY (it needs no relay).
//
// EXPECTED RED TODAY: index.html's room is still single-file ({code}). Sharing a
// multi-file project collapses it to the entry file (a confirm() seeds entry-only),
// so on peer B `sprites/enemy.py` never appears and concurrent different-file edits
// don't both land. When the relay is up these assertions FAIL (RED, by design);
// when the relay is down they SKIP and the RED can't be observed live (noted).
//
// Run:  node test/collab-multifile.mjs http://localhost:8923/
//
// SEAMS this test drives (the implementer MUST keep/expose these):
//   window.project            — .files[path]=CodeMirror.Doc, .order, .entry, .active,
//                               .setActive(path), .add(path,text), .isMulti()
//   window.renderTabs         — repaints #tabs from project.order
//   #tabs .tab[data-name]     — one row per file (data-name = HUMAN path)
//   #collabBtn                — idle→startRoom ENGINE SEAM (off-screen-but-clickable;
//                               #collabStartBtn in the collapsed panel delegates to it)
//   #liveDot / #peerCount     — live indicator + roster count (peers + you)
//   window.__amLoaded         — Automerge-lazy sentinel (must stay falsy solo)
//   document.querySelector('.CodeMirror').CodeMirror — the one editor (active file's Doc)

import { launch } from './_harness.mjs';

const BASE = process.argv[2] || 'http://localhost:8923/';
const b = await launch();

let failed = 0;
let skippedLive = false;
const fail = (m) => { console.error('FAIL:', m); failed++; process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);

// ---------------------------------------------------------------- helpers
// The collaboration ENGINE SEAM. The visible #collabStartBtn lives in the COLLAPSED
// (hidden) collab panel and merely delegates here, so — exactly like test/collab.mjs —
// we click the off-screen-but-clickable #collabBtn directly to start the room.
const bootSel = () => '#collabBtn';

// Set up a 3-file NESTED project on a page BEFORE it starts/joins a room, via the
// window.project seam — main.py at root + two nested files. Mirrors the spike's
// SEED_PATHS so the multi-file shape (folder paths) is exercised, not just flat.
async function seedNestedProject(page) {
  await page.evaluate(() => {
    const p = window.project;
    p.load({
      files: {
        'main.py': 'print("main")\n',
        'sprites/enemy.py': 'class Enemy:\n    pass\n',
        'sounds/blip.py': 'BLIP = 1\n',
      },
      order: ['main.py', 'sprites/enemy.py', 'sounds/blip.py'],
      entry: 'main.py',
      active: 'main.py',
    });
    window.renderTabs();
  });
}

// Boot a page to the app and wait for the editor + collab button.
async function bootPage(url) {
  const page = await b.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30000 });
  return page;
}

// Read the set of file paths the explorer currently shows (data-name on .tab rows).
const tabNames = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#tabs .tab[data-name]')].map(t => t.getAttribute('data-name')).sort());

// Read the project model's order/entry/active + per-file text (from the live Docs).
const projState = (page) => page.evaluate(() => {
  const p = window.project;
  const files = {};
  for (const k of p.order) files[k] = p.files[k]?.getValue();
  return { order: [...p.order], entry: p.entry, active: p.active, files };
});

// Type text into a specific file by making it active and replacing its content.
// Switches the active file via project.setActive (which swapDoc's the editor),
// then drives the editor's CodeMirror so the local→remote change listener fires.
async function editFile(page, path, text) {
  await page.evaluate(({ path, text }) => {
    window.project.setActive(path);
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue(text);
  }, { path, text });
}

// Append a line at a given position in the ACTIVE file's editor (drives a real edit
// the room's local→remote listener should pick up), without setValue (preserves caret).
async function appendInActive(page, line, ch, text) {
  await page.evaluate(({ line, ch, text }) => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.replaceRange(text, { line, ch });
  }, { line, ch, text });
}

// Poll a page-side predicate; resolves true/false (never throws) so the caller
// decides PASS/FAIL. Generous timeout to tolerate relay propagation, like collab.mjs.
const waitConverge = (page, predicate, arg, timeout = 15000) =>
  page.waitForFunction(predicate, arg, { timeout }).then(() => true, () => false);

try {
  // ============================================================ ASSERTION 5 (relay-free)
  // Solo path loads ZERO Automerge. A page that boots and never starts/joins a room
  // must have window.__amLoaded falsy and must NOT have fetched the vendor bundle.
  // (Carried verbatim from collab.mjs — the lazy-load guardrail; runs unconditionally.)
  {
    const p = await b.newPage();
    const reqs = [];
    p.on('request', r => { if (/vendor\/automerge|esm\.sh/.test(r.url())) reqs.push(r.url()); });
    await p.goto(BASE);
    await p.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const amLoaded = await p.evaluate(() => !!window.__amLoaded);
    console.log('solo automerge requests (want 0):', reqs.length, '| __amLoaded (want false):', amLoaded);
    if (reqs.length === 0 && !amLoaded) ok('A5 solo path loads ZERO Automerge (lazy guardrail)');
    else fail('A5 solo path eager-loaded Automerge — must be lazy');
    await p.close();
  }

  // ---------------------------------------------------------------- relay reachability probe
  // Seed a multi-file room on peer A, then try to JOIN it from peer B. If B never
  // adopts even main.py within a generous budget, treat the relay as unreachable and
  // SKIP all live assertions (design §0.1 Q2). All live assertions below reuse the
  // SAME A/B room (one create, one join) so we spend the relay budget once.
  const A = await bootPage(BASE);
  await seedNestedProject(A);
  // TODAY (RED): startRoom shows a blocking confirm() for a multi-file project
  // ("Live collaboration is single-file. Share only your entry file…"). Playwright
  // auto-DISMISSES dialogs (→ confirm returns false → startRoom bails, no room). We
  // ACCEPT it so the room actually starts and the multi-file RED becomes observable
  // (peer B then receives ONLY main.py — the bug this slice fixes). After S6a deletes
  // that confirm, no dialog fires and this handler is a harmless no-op.
  A.on('dialog', d => d.accept().catch(() => {}));
  // Start the room (idle → startRoom via the engine seam).
  await A.click(bootSel());
  const hash = await A.waitForFunction(
    () => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }
  ).then(h => h.jsonValue(), () => null);

  if (!hash) {
    skippedLive = true;
    console.log('SKIP (live) — peer A never produced a #room= hash (Automerge/relay unreachable).');
  }

  let B = null;
  if (!skippedLive) {
    console.log('room hash:', hash.slice(0, 44) + '…');
    B = await b.newPage();
    await B.goto(BASE + hash);
    await B.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30000 });
    // Adopt probe: B must at least receive main.py from the seed. If not within budget,
    // the relay is unreachable → SKIP the live assertions.
    const adopted = await waitConverge(B,
      () => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('main'), null, 30000);
    if (!adopted) {
      skippedLive = true;
      console.log('SKIP (live) — peer B never adopted the seed within budget (relay unreachable).');
    }
  }

  if (skippedLive) {
    console.log('\n================ collab-multifile SUMMARY ================');
    console.log('LIVE ASSERTIONS SKIPPED — relay unreachable. The multi-file RED cannot be');
    console.log('observed live this run; the contract is still authored. Solo guardrail asserted.');
    console.log(failed ? `RESULT: FAIL (${failed} relay-free assertions failed)` : 'RESULT: OK (skipped live, guardrail green)');
  } else {
    console.log('relay reachable — running live two-peer assertions.\n');

    // ============================================================ ASSERTION 1
    // Seed + adopt (multi-file). Peer A seeded a 3-file nested project; peer B joined.
    // Assert BOTH peers show ALL THREE files in #tabs (no ghost tabs, no lost files),
    // order/entry consistent, and each file's content matches across peers.
    {
      const WANT = ['main.py', 'sounds/blip.py', 'sprites/enemy.py'];   // sorted
      const adoptedAll = await waitConverge(B, (want) => {
        const got = [...document.querySelectorAll('#tabs .tab[data-name]')]
          .map(t => t.getAttribute('data-name')).sort();
        return JSON.stringify(got) === JSON.stringify(want);
      }, WANT, 20000);

      const aTabs = await tabNames(A);
      const bTabs = await tabNames(B);
      if (adoptedAll && JSON.stringify(aTabs) === JSON.stringify(WANT)
          && JSON.stringify(bTabs) === JSON.stringify(WANT)) {
        ok('A1 seed+adopt: both peers show all 3 files (no ghost/lost tabs)');
      } else {
        fail('A1 seed+adopt FAILED — A tabs=' + JSON.stringify(aTabs) + ' B tabs=' + JSON.stringify(bTabs)
          + ' (want ' + JSON.stringify(WANT) + ')');
      }

      // content + order/entry consistency on B vs A
      const sA = await projState(A);
      const sB = await projState(B);
      const contentMatch = WANT.every(k => sA.files[k] === sB.files[k] && sA.files[k] != null);
      const orderMatch = JSON.stringify([...sB.order].sort()) === JSON.stringify(WANT)
        && JSON.stringify([...sA.order].sort()) === JSON.stringify(WANT);
      const entryMatch = sA.entry === 'main.py' && sB.entry === 'main.py';
      if (contentMatch && orderMatch && entryMatch) {
        ok('A1 seed+adopt: per-file content + order/entry consistent across peers');
      } else {
        fail('A1 content/order/entry mismatch — contentMatch=' + contentMatch
          + ' orderMatch=' + orderMatch + ' entryMatch=' + entryMatch
          + ' A=' + JSON.stringify(sA) + ' B=' + JSON.stringify(sB));
      }
    }

    // ============================================================ ASSERTION 2
    // Concurrent edits to DIFFERENT files converge. A edits sprites/enemy.py while B
    // edits sounds/blip.py; after sync BOTH peers have BOTH edits in the correct files,
    // and the untouched sibling (main.py) is byte-identical on both. The non-active
    // file's edit must land in its Doc; the locally-active file must not be clobbered.
    {
      // Put A on main.py (so enemy.py is its NON-active file) to prove a remote change
      // to another file lands without disturbing A's active file/cursor.
      await editFile(A, 'main.py', 'print("main")\n');
      await A.evaluate(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        cm.setCursor({ line: 1, ch: 0 });   // caret on line 2 of A's active main.py
      });
      const aCursorBefore = await A.evaluate(() => {
        const c = document.querySelector('.CodeMirror').CodeMirror.getCursor('head'); return { line: c.line, ch: c.ch };
      });

      // Concurrent: A edits its NON-active enemy.py via project Doc + the room (switch,
      // edit, switch back). B edits blip.py. Issue both, then await convergence.
      await editFile(A, 'sprites/enemy.py', 'class Enemy:\n    hp = 100\n');
      await editFile(A, 'main.py', 'print("main")\n');   // back to main.py (active), re-set its caret below
      await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setCursor({ line: 1, ch: 0 }));
      await editFile(B, 'sounds/blip.py', 'BLIP = 1\nBOOP = 2\n');

      const enemyOnB = await waitConverge(B,
        () => window.project.files['sprites/enemy.py']?.getValue().includes('hp = 100'), null, 15000);
      const blipOnA = await waitConverge(A,
        () => window.project.files['sounds/blip.py']?.getValue().includes('BOOP = 2'), null, 15000);

      const sA = await projState(A);
      const sB = await projState(B);
      const bothOnA = sA.files['sprites/enemy.py']?.includes('hp = 100') && sA.files['sounds/blip.py']?.includes('BOOP = 2');
      const bothOnB = sB.files['sprites/enemy.py']?.includes('hp = 100') && sB.files['sounds/blip.py']?.includes('BOOP = 2');
      if (enemyOnB && blipOnA && bothOnA && bothOnB) {
        ok('A2 concurrent DIFFERENT-file edits converge: both edits on both peers');
      } else {
        fail('A2 concurrent different-file edits did NOT converge — enemyOnB=' + enemyOnB
          + ' blipOnA=' + blipOnA + ' bothOnA=' + bothOnA + ' bothOnB=' + bothOnB
          + ' A.files=' + JSON.stringify(sA.files) + ' B.files=' + JSON.stringify(sB.files));
      }

      // untouched sibling byte-identical
      if (sA.files['main.py'] === 'print("main")\n' && sB.files['main.py'] === 'print("main")\n') {
        ok('A2 untouched sibling main.py byte-identical on both peers');
      } else {
        fail('A2 main.py drifted — A=' + JSON.stringify(sA.files['main.py']) + ' B=' + JSON.stringify(sB.files['main.py']));
      }

      // A's active-file caret preserved across the remote change to ANOTHER file.
      const aCursorAfter = await A.evaluate(() => {
        const c = document.querySelector('.CodeMirror').CodeMirror.getCursor('head'); return { line: c.line, ch: c.ch };
      });
      if (aCursorAfter.line === aCursorBefore.line && aCursorAfter.ch === aCursorBefore.ch) {
        ok('A2 active-file cursor preserved across remote change to another file');
      } else {
        fail('A2 active cursor jumped — before=' + JSON.stringify(aCursorBefore) + ' after=' + JSON.stringify(aCursorAfter));
      }
    }

    // ============================================================ ASSERTION 3
    // Same-file concurrent edit converges (design §0.1 Q6). Both peers put main.py
    // active and edit it at the same time; after sync they converge to the SAME text
    // (Automerge char-level merge), no crash. Assert convergence, not a specific
    // interleaving (the accepted char-merge behavior).
    {
      await editFile(A, 'main.py', 'shared = 0\n');
      // wait for B to see the reset baseline before diverging
      await waitConverge(B, () => window.project.files['main.py']?.getValue().includes('shared = 0'), null, 15000);
      await editFile(B, 'main.py', 'shared = 0\n');

      // concurrent prepend (A) + append (B) on main.py — issue both, then converge.
      await A.evaluate(() => window.project.setActive('main.py'));
      await appendInActive(A, 0, 0, 'from_a = 1\n');
      await B.evaluate(() => window.project.setActive('main.py'));
      await appendInActive(B, 1, 0, 'from_b = 2\n');

      const converged = await waitConverge(A, () => {
        const a = window.project.files['main.py']?.getValue();
        return a && a.includes('from_a') && a.includes('from_b');
      }, null, 15000);
      const textA = await A.evaluate(() => window.project.files['main.py']?.getValue());
      const textB = await B.evaluate(() => window.project.files['main.py']?.getValue());
      const noCrash = (await A.evaluate(() => !!document.querySelector('.CodeMirror')))
        && (await B.evaluate(() => !!document.querySelector('.CodeMirror')));
      if (converged && textA === textB && noCrash
          && textA.includes('from_a') && textA.includes('from_b')) {
        ok('A3 same-file concurrent edit converges to identical text (char-merge)');
      } else {
        fail('A3 same-file concurrent edit did NOT converge — equal=' + (textA === textB)
          + ' A=' + JSON.stringify(textA) + ' B=' + JSON.stringify(textB) + ' noCrash=' + noCrash);
      }
    }

    // ============================================================ ASSERTION 4
    // order/entry consistency after the edits: order set === files key set on both
    // peers; entry points at a live path on both. (Mirrors spike assertions 8.)
    {
      const consistent = async (page) => page.evaluate(() => {
        const p = window.project;
        const orderSet = [...p.order].sort().join(',');
        const fileSet = Object.keys(p.files).sort().join(',');
        return { orderEqFiles: orderSet === fileSet, entryLive: !!p.files[p.entry], order: [...p.order], entry: p.entry };
      });
      const cA = await consistent(A);
      const cB = await consistent(B);
      if (cA.orderEqFiles && cB.orderEqFiles && cA.entryLive && cB.entryLive) {
        ok('A4 order set === files key set, entry points at a live path (both peers)');
      } else {
        fail('A4 order/entry inconsistent — A=' + JSON.stringify(cA) + ' B=' + JSON.stringify(cB));
      }
    }

    console.log('\n================ collab-multifile SUMMARY ================');
    console.log('relay: REACHABLE. live two-peer assertions ran.');
    console.log(failed ? `RESULT: FAIL/RED (${failed} assertions failed) — expected at S6a RED.`
      : 'RESULT: OK (all live assertions passed) — implementation is GREEN.');
  }
} finally {
  await b.close();
}

setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
