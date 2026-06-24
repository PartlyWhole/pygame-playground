// S6b — multi-file collaboration STRUCTURAL-OPS + PER-FILE-PRESENCE TWO-PEER battery (TDD RED).
//
// Sibling of test/collab-multifile.mjs (S6a). S6a proved a multi-file room SEEDS, ADOPTS,
// and RECONCILES doc-level changes (A1-A5, all green). S6b proves the UI *produces* those
// changes (structural ops routed to the shared doc) and shows *who is where* (per-file
// presence). The residual risk this slice retires is INTERACTION wiring — a local explorer
// op that mutates only the local model (flushSave() is a no-op in a room) and a peer cursor
// rendered regardless of which file it is on (silent visual corruption, not a crash).
//
// Modeled on test/collab-multifile.mjs EXACTLY: ./_harness.mjs launch(), b.newPage(),
// localhost-pinned, peer A creates a `#room=` room via #collabBtn, peer B JOINs the room URL,
// sync asserted over the REAL relay wss://sync.automerge.org. One create + one join; all live
// assertions reuse the SAME A/B room so the relay budget is spent once.
//
// RELAY HANDLING (design §0.1 Q2): the app has no in-browser loopback. If the relay is
// unreachable the live two-peer assertions SKIP ("skipped — relay unreachable", exit 0)
// rather than FAIL. This file has NO relay-free assertions of its own (the solo/lazy guard
// lives in collab-multifile.mjs A5 + collab.mjs); when the relay is down this whole file
// reports SKIP.
//
// EXPECTED RED TODAY (S6a HEAD): the explorer structural ops (newFilePrompt / tabMenu /
// folderMenu / drag-move) call project.<op>() + renderTabs() + flushSave() — and flushSave()
// early-returns in a room (index.html:2572). So a LOCAL add/rename/delete never reaches the
// shared doc → peer B never sees it. And startPresence broadcasts a cursor with NO `file`
// field (index.html:3371-3373) while renderPeers renders EVERY peer's cursor on the active
// editor (no file filter) → a peer on a DIFFERENT file still paints a ghost caret. restore-
// in-room uses confirm("Replace your current code…") and never touches the doc in a room.
// When the relay is up these assertions FAIL (RED, by design); when it is down they SKIP.
//
// Run:  node test/collab-multifile-b.mjs http://localhost:8923/
//
// SEAMS the IMPLEMENTER must expose for these to go GREEN (the contract under test):
//   • a room structural-op push (e.g. a roomOp(mutator) helper → handle.change) wired into
//     newFilePrompt / tabMenu rename+delete / folderMenu / the drop handler, so every
//     successful local project.<op>() in a room ALSO mutates the doc (add = plain assignment,
//     rename/move = copy-and-delete, delete = delete key + filter order + fix entry).
//   • a `file` field on each presence cursor (= encPath(project.active)) in startPresence's
//     cursorActivity broadcast.
//   • a file FILTER in renderPeers: render a peer's .remote-cursor ONLY when its cursor.file
//     === the local active file; a peer with NO file field renders NO cursor (STRICT, §0.1 Q1);
//     the roster (#peerCount) still counts everyone. Repaint on local file switch.
//   • restore-in-room: a confirm that WARNS it overwrites for ALL peers, and on accept
//     overwrites the whole shared doc so both peers converge.
//
// SEAMS this test drives (kept from S6a):
//   window.project / window.renderTabs / #tabs .tab[data-name] / #collabBtn /
//   #liveDot / #peerCount / .remote-cursor / .remote-flag /
//   document.querySelector('.CodeMirror').CodeMirror

import { launch } from './_harness.mjs';

const BASE = process.argv[2] || 'http://localhost:8923/';
const b = await launch();

let failed = 0;
let skippedLive = false;
const fail = (m) => { console.error('FAIL:', m); failed++; process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);

// ---------------------------------------------------------------- helpers (mirrors S6a)
// The collaboration ENGINE SEAM — the off-screen-but-clickable #collabBtn (the visible
// #collabStartBtn merely delegates here), exactly like collab.mjs / collab-multifile.mjs.
const bootSel = () => '#collabBtn';

// Seed the SAME 3-file nested project the S6a harness uses, via the window.project seam.
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

async function bootPage(url) {
  const page = await b.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30000 });
  return page;
}

// The set of file paths the explorer currently shows (data-name on .tab rows), sorted.
const tabNames = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#tabs .tab[data-name]')].map(t => t.getAttribute('data-name')).sort());

// The project model's order/entry/active + per-file text (from the live Docs).
const projState = (page) => page.evaluate(() => {
  const p = window.project;
  const files = {};
  for (const k of p.order) files[k] = p.files[k]?.getValue();
  return { order: [...p.order], entry: p.entry, active: p.active, files };
});

// Make a file active and type text into it (drives the local→remote change listener).
async function editFile(page, path, text) {
  await page.evaluate(({ path, text }) => {
    window.project.setActive(path);
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue(text);
  }, { path, text });
}

// Poll a page-side predicate; resolves true/false (never throws). Generous timeout to
// tolerate relay propagation, like collab-multifile.mjs.
const waitConverge = (page, predicate, arg, timeout = 15000) =>
  page.waitForFunction(predicate, arg, { timeout }).then(() => true, () => false);

// ---- explorer-affordance drivers (drive the REAL wiring, not window.project directly) ----
// The explorer ops are prompt()/confirm()-driven (the app's house style). Playwright auto-
// DISMISSES dialogs, so we register a ONE-SHOT dialog handler that answers the prompt chain
// for a single op, then resolves. Driving the real handler proves the wiring routes to the
// doc (the seam under test) rather than only the local model.

// Answer an ordered list of dialog responses for the NEXT op, then auto-clean the handler.
// Each entry: a string (prompt answer) | true (accept confirm) | false (dismiss). The list
// is consumed in dialog order; when exhausted, further dialogs are accepted (defensive).
function withDialogs(page, answers) {
  const queue = [...answers];
  const handler = async (d) => {
    const a = queue.length ? queue.shift() : true;
    try {
      if (d.type() === 'prompt') await d.accept(typeof a === 'string' ? a : '');
      else if (a === false) await d.dismiss();
      else await d.accept();
    } catch {}
    if (!queue.length) page.off('dialog', handler);   // op's dialog chain done
  };
  page.on('dialog', handler);
  return () => page.off('dialog', handler);
}

// Create a new file via the REAL explorer flow (newFilePrompt — the "+ new file" affordance).
// Answers the single "New file name" prompt with `name`. Returns once the local op settled.
async function explorerNewFile(page, name) {
  const off = withDialogs(page, [name]);
  await page.evaluate(() => window.newFilePrompt());
  await page.waitForTimeout(150);
  off();
}

// Rename a file via the REAL explorer flow (tabMenu → "rename" → new name).
async function explorerRename(page, oldPath, newPath) {
  const off = withDialogs(page, ['rename', newPath, true]);   // action, new name, then accept the import-note alert
  await page.evaluate((p) => window.tabMenu(p), oldPath);
  await page.waitForTimeout(150);
  off();
}

// Delete a file via the REAL explorer flow (tabMenu → "delete" → confirm).
async function explorerDelete(page, path) {
  const off = withDialogs(page, ['delete', true]);            // action, then confirm the delete
  await page.evaluate((p) => window.tabMenu(p), path);
  await page.waitForTimeout(150);
  off();
}

try {
  // ---------------------------------------------------------------- relay reachability probe
  // Seed a multi-file room on peer A, then JOIN it from peer B. If B never adopts main.py
  // within a generous budget, treat the relay as unreachable and SKIP all live assertions.
  const A = await bootPage(BASE);
  await seedNestedProject(A);
  // Defensive: accept a startRoom confirm if one fires (S6a deletes it, so normally none does).
  // ONE-SHOT + removed after the hash so it never races the per-op withDialogs handlers below
  // ("Cannot accept dialog which is already handled" if two handlers answer one dialog).
  const offStartConfirm = (() => {
    const h = (d) => { d.accept().catch(() => {}); A.off('dialog', h); };
    A.on('dialog', h);
    return () => A.off('dialog', h);
  })();
  await A.click(bootSel());
  const hash = await A.waitForFunction(
    () => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }
  ).then(h => h.jsonValue(), () => null);
  offStartConfirm();   // drop the start-confirm handler so per-op dialog handlers are exclusive

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
    const adopted = await waitConverge(B,
      () => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('main'), null, 30000);
    if (!adopted) {
      skippedLive = true;
      console.log('SKIP (live) — peer B never adopted the seed within budget (relay unreachable).');
    }
    // Confirm B sees ALL THREE seeded files before structural ops (so a later "B sees the
    // new/renamed/deleted file" assertion is about THIS op, not a half-adopted seed).
    if (!skippedLive) {
      const seedOnB = await waitConverge(B, () => {
        const got = [...document.querySelectorAll('#tabs .tab[data-name]')]
          .map(t => t.getAttribute('data-name')).sort();
        return JSON.stringify(got) === JSON.stringify(['main.py', 'sounds/blip.py', 'sprites/enemy.py']);
      }, null, 20000);
      if (!seedOnB) {
        skippedLive = true;
        console.log('SKIP (live) — peer B did not adopt all 3 seed files within budget (relay flaky).');
      }
    }
  }

  if (skippedLive) {
    console.log('\n================ collab-multifile-b SUMMARY ================');
    console.log('LIVE ASSERTIONS SKIPPED — relay unreachable. The S6b structural-ops + per-file-');
    console.log('presence RED cannot be observed live this run; the contract is still authored.');
    console.log(failed ? `RESULT: FAIL (${failed} assertions failed)` : 'RESULT: OK (skipped live)');
  } else {
    console.log('relay reachable — running live S6b two-peer assertions.\n');

    // ============================================================ ASSERTION B4 (presence)
    // PER-FILE PRESENCE ISOLATION (strict, §0.1 Q1). Run FIRST, on the PRISTINE seed (both
    // peers hold all 3 files), so it never depends on B1-B3 structural propagation. A sits on
    // main.py, B on sprites/enemy.py (a DIFFERENT seed file both peers have):
    //   (a) the roster count is 2 on BOTH (#peerCount — counts everyone regardless of file),
    //   (b) A renders NO .remote-cursor for B while B is on a different file (STRICT — the
    //       cursor needs a `file` field + a renderPeers file filter to be hidden),
    //   (c) when A switches to sprites/enemy.py (B's file), A NOW renders B's .remote-cursor.
    // This is the single most bug-prone presence assertion; (b) is the discriminating one and
    // is RED at S6a HEAD (cursor renders regardless of file → a ghost caret on the wrong file).
    {
      const MINE = 'main.py', THEIRS = 'sprites/enemy.py';   // distinct seed files on BOTH peers
      await A.evaluate((p) => { window.project.setActive(p);
        const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setCursor({ line: 0, ch: 0 }); cm.focus(); }, MINE);
      await B.evaluate((p) => { window.project.setActive(p);
        const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setCursor({ line: 1, ch: 0 }); cm.focus(); }, THEIRS);

      // (a) roster count = 2 on both (peers + you). The "count != render" distinction: the
      //     roster counts everyone even though the cursor filter (should) hide B's caret.
      const countA = await waitConverge(A, () => document.getElementById('peerCount').textContent === '2', null, 20000);
      const countB = await waitConverge(B, () => document.getElementById('peerCount').textContent === '2', null, 20000);
      if (countA && countB) {
        ok('B4a roster count is 2 on both peers (counts everyone regardless of file)');
      } else {
        fail('B4a roster count wrong — A=' + (await A.evaluate(() => document.getElementById('peerCount').textContent))
          + ' B=' + (await B.evaluate(() => document.getElementById('peerCount').textContent)));
      }

      // (b) STRICT isolation: A on main.py, B on sprites/enemy.py → A renders NO .remote-cursor.
      //     Let presence settle, then sample. RED today: no `file` field / no render filter.
      await A.waitForTimeout(2500);
      const cursorsApart = await A.evaluate(() => document.querySelectorAll('.remote-cursor').length);
      if (cursorsApart === 0) {
        ok('B4b A renders NO remote cursor while B is on a different file (strict per-file isolation)');
      } else {
        fail('B4b A rendered ' + cursorsApart + ' remote cursor(s) while B is on a DIFFERENT file — '
          + 'presence has no `file` field and renderPeers has no file filter (silent ghost caret on the wrong file).');
      }

      // (c) A switches to B's file → A NOW renders B's .remote-cursor. Nudge B's caret after
      //     the switch so a fresh presence beat fires for A to pick up.
      await A.evaluate((p) => { window.project.setActive(p);
        document.querySelector('.CodeMirror').CodeMirror.focus(); }, THEIRS);
      await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setCursor({ line: 0, ch: 1 }); cm.setCursor({ line: 1, ch: 0 }); });
      const cursorAppears = await waitConverge(A, () => document.querySelector('.remote-cursor') !== null, null, 20000);
      if (cursorAppears) {
        ok('B4c A renders B\'s remote cursor after switching to B\'s file (per-file reveal)');
      } else {
        fail('B4c A did NOT render B\'s remote cursor after switching to B\'s file — '
          + 'cursor has no `file` field, so renderPeers can\'t reveal it on the matching file.');
      }
      // Restore A onto main.py before the structural ops below mutate A's local file set.
      await A.evaluate(() => { window.project.setActive('main.py'); });
    }

    // ============================================================ ASSERTION B1
    // Structural ADD propagates. Peer A creates a NEW file via the REAL explorer new-file
    // flow; the LOCAL op must succeed (a tab + Doc on A), and peer B must then see the new
    // #tabs row WITH its content (the encoded key was assigned to the doc + B reconciled it).
    {
      const NEW = 'sprites/boss.py';
      await explorerNewFile(A, NEW);
      // The local op MUST have landed on A (so a RED here means "didn't PROPAGATE", not
      // "the explorer op failed locally"). If the local add itself failed, say so.
      const localOK = await waitConverge(A,
        (p) => !!window.project.files[p], NEW, 5000);
      if (!localOK) {
        fail('B1 PRECONDITION — explorer new-file did not create ' + NEW + ' LOCALLY on A (test driver issue, not the propagation under test)');
      } else {
        // Give the file content on A so B can assert it adopted text, not just a key.
        await editFile(A, NEW, 'class Boss:\n    hp = 500\n');
        await editFile(A, 'main.py', 'print("main")\n');   // leave A back on main.py
        const onB = await waitConverge(B, (p) => {
          const has = [...document.querySelectorAll('#tabs .tab[data-name]')]
            .some(t => t.getAttribute('data-name') === p);
          return has && window.project.files[p]?.getValue().includes('hp = 500');
        }, NEW, 15000);
        const bTabs = await tabNames(B);
        if (onB && bTabs.includes(NEW)) {
          ok('B1 structural ADD via explorer propagates: B shows the new file + content');
        } else {
          fail('B1 structural ADD did NOT propagate — B tabs=' + JSON.stringify(bTabs)
            + ' (want to include ' + NEW + '); local add on A succeeded, so the explorer op is NOT routed to the shared doc.');
        }
      }
    }

    // ============================================================ ASSERTION B2
    // RENAME / move-into-folder propagates. Peer A renames a seed file via the REAL tabMenu
    // rename flow; on B the OLD path is gone, the NEW path present, order/entry consistent.
    {
      const OLD = 'sprites/enemy.py', NEW2 = 'sprites/villain.py';
      await explorerRename(A, OLD, NEW2);
      const localOK = await waitConverge(A,
        (a) => !!window.project.files[a.NEW2] && !window.project.files[a.OLD], { OLD, NEW2 }, 5000);
      if (!localOK) {
        fail('B2 PRECONDITION — explorer rename ' + OLD + '→' + NEW2 + ' did not apply LOCALLY on A (test driver issue)');
      } else {
        const onB = await waitConverge(B, (a) => {
          const names = [...document.querySelectorAll('#tabs .tab[data-name]')].map(t => t.getAttribute('data-name'));
          return names.includes(a.NEW2) && !names.includes(a.OLD)
            && !!window.project.files[a.NEW2] && !window.project.files[a.OLD];
        }, { OLD, NEW2 }, 15000);
        const sB = await projState(B);
        const consistent = JSON.stringify([...sB.order].sort()) === JSON.stringify(Object.keys(sB.files).sort())
          && !!sB.files[sB.entry];
        if (onB && consistent) {
          ok('B2 RENAME via explorer propagates: B shows new path, old gone, order/entry consistent');
        } else {
          fail('B2 RENAME did NOT propagate — B tabs=' + JSON.stringify(await tabNames(B))
            + ' consistent=' + consistent + '; local rename on A succeeded → not routed to the doc.');
        }
      }
    }

    // ============================================================ ASSERTION B3
    // DELETE propagates. Peer A deletes a file via the REAL tabMenu delete flow (guard: NOT
    // the last file — there are still ≥3); on B that file disappears.
    {
      const DEL = 'sounds/blip.py';
      await explorerDelete(A, DEL);
      const localOK = await waitConverge(A,
        (p) => !window.project.files[p], DEL, 5000);
      if (!localOK) {
        fail('B3 PRECONDITION — explorer delete ' + DEL + ' did not apply LOCALLY on A (test driver issue)');
      } else {
        const onB = await waitConverge(B, (p) => {
          const names = [...document.querySelectorAll('#tabs .tab[data-name]')].map(t => t.getAttribute('data-name'));
          return !names.includes(p) && !window.project.files[p];
        }, DEL, 15000);
        if (onB) {
          ok('B3 DELETE via explorer propagates: B shows the file gone');
        } else {
          fail('B3 DELETE did NOT propagate — B still shows ' + DEL + ' (' + JSON.stringify(await tabNames(B))
            + '); local delete on A succeeded → not routed to the doc.');
        }
      }
    }

    // ============================================================ ASSERTION B5
    // RENAME-vs-EDIT converges (§0.1 Q6). A renames a file while B is typing into it. Both
    // peers converge: the file exists at the NEW path with consistent content, no crash, no
    // dead Doc. B's in-flight keystrokes on the OLD name MAY be lost — we assert CONVERGENCE,
    // not a specific keystroke survival.
    {
      // Use a file present on BOTH. main.py is guaranteed. Put B on it and have it type;
      // concurrently A renames it. (If rename isn't routed to the doc, B keeps editing the
      // old key and the two peers DIVERGE — that's the RED.)
      const FROM = 'main.py', TO = 'core/main.py';
      await editFile(B, FROM, 'shared = 0\n');
      await waitConverge(A, () => window.project.files['main.py']?.getValue().includes('shared = 0'), null, 15000);
      // Issue concurrently: B types into FROM while A renames FROM→TO via the explorer.
      await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setCursor({ line: 1, ch: 0 }); cm.replaceRange('typing_b = 1\n', { line: 1, ch: 0 }); });
      await explorerRename(A, FROM, TO);

      // Converge: BOTH peers end with the file at the NEW path, identical content, both alive.
      const converged = await waitConverge(A, (t) => {
        const f = window.project.files[t];
        return !!f && !window.project.files['main.py'];
      }, TO, 20000);
      const onBToo = await waitConverge(B, (t) => !!window.project.files[t] && !window.project.files['main.py'], TO, 20000);
      const sA = await projState(A);
      const sB = await projState(B);
      const sameContent = sA.files[TO] != null && sA.files[TO] === sB.files[TO];
      const alive = (await A.evaluate(() => !!document.querySelector('.CodeMirror')))
        && (await B.evaluate(() => !!document.querySelector('.CodeMirror')));
      // order/entry consistency on both (no dead Doc, no orphan key).
      const consistent = JSON.stringify([...sA.order].sort()) === JSON.stringify(Object.keys(sA.files).sort())
        && JSON.stringify([...sB.order].sort()) === JSON.stringify(Object.keys(sB.files).sort())
        && !!sA.files[sA.entry] && !!sB.files[sB.entry];
      if (converged && onBToo && sameContent && alive && consistent) {
        ok('B5 rename-vs-edit converges: file at new path, identical content, no dead Doc (in-flight keystrokes may be lost)');
      } else {
        fail('B5 rename-vs-edit did NOT converge — converged=' + converged + ' onBToo=' + onBToo
          + ' sameContent=' + sameContent + ' alive=' + alive + ' consistent=' + consistent
          + ' A[' + TO + ']=' + JSON.stringify(sA.files[TO]) + ' B[' + TO + ']=' + JSON.stringify(sB.files[TO]));
      }
    }

    // ============================================================ ASSERTION B6
    // RESTORE-IN-ROOM (§0.1 Q4). A peer restoring/replacing the project in a room is gated by
    // a confirm that WARNS it overwrites for ALL peers; on accept, both peers converge to the
    // restored project. We drive the load-into-room path (project.load + the restore wiring)
    // and assert (a) a confirm fired whose text WARNS about peers/everyone, and (b) the
    // replacement PROPAGATES so B converges to the restored project.
    {
      // The restored project: a distinct 2-file shape with a sentinel only it contains.
      const RESTORED = {
        files: { 'main.py': 'RESTORED = 1\n', 'util.py': 'HELPER = 2\n' },
        order: ['main.py', 'util.py'], entry: 'main.py', active: 'main.py',
      };
      // Seed it into history so the REAL restore affordance (restoreSnapshot) can replay it.
      // historyStore is the only exposed window.* seam; renderHistory() (a function decl, so
      // on window) populates the _histSnaps array that restoreSnapshot looks up by id.
      await A.evaluate(async (proj) => {
        await window.historyStore.add({ at: Date.now(), mode: 'room', project: proj });
        await window.renderHistory();   // refresh the in-memory _histSnaps from the store
      }, RESTORED).catch(() => {});

      // Capture the confirm text the restore path shows (the WARN-for-everyone requirement).
      let confirmText = '';
      const off = (() => {
        const handler = async (d) => {
          if (d.type() === 'confirm') { confirmText = d.message(); await d.accept(); }
          else await d.accept();
        };
        A.on('dialog', handler);
        return () => A.off('dialog', handler);
      })();

      // Drive the restore via the REAL restoreSnapshot path: find the snapshot's real
      // (auto-incremented) id from the store, then replay it through the actual restore wiring.
      const drove = await A.evaluate(async (proj) => {
        if (!window.restoreSnapshot || !window.historyStore) return 'none';
        const all = await window.historyStore.getAll();   // newest-first
        const rec = all.find(s => JSON.stringify(s.project) === JSON.stringify(proj));
        if (!rec) return 'no-snapshot';
        await window.restoreSnapshot(rec.id);
        return 'restoreSnapshot';
      }, RESTORED).catch((e) => 'error:' + (e?.message || e));

      await A.waitForTimeout(300);
      off();

      // (a) the confirm must WARN it affects ALL peers / everyone (not just "your code").
      const warnsPeers = /\b(everyone|all peers|other(s)?|peers|in the room)\b/i.test(confirmText);
      if (warnsPeers) {
        ok('B6a restore-in-room confirm WARNS it overwrites for all peers (' + JSON.stringify(confirmText) + ')');
      } else {
        fail('B6a restore-in-room confirm does NOT warn about peers — got ' + JSON.stringify(confirmText)
          + ' (drove=' + drove + '); the confirm must say it overwrites for everyone in the room.');
      }

      // (b) the restore must PROPAGATE: B converges to the restored sentinel + file set.
      const onB = await waitConverge(B, () => {
        const f = window.project.files['util.py'];
        return !!f && window.project.files['main.py']?.getValue().includes('RESTORED');
      }, null, 20000);
      if (onB) {
        ok('B6b restore-in-room propagates: B converges to the restored project');
      } else {
        fail('B6b restore-in-room did NOT propagate — B did not receive the restored project '
          + '(' + JSON.stringify(await tabNames(B)) + '); restore in a room only loads locally (flushSave is a no-op).');
      }
    }

    console.log('\n================ collab-multifile-b SUMMARY ================');
    console.log('relay: REACHABLE. live S6b two-peer assertions ran.');
    console.log(failed ? `RESULT: FAIL/RED (${failed} assertions failed) — expected at S6a HEAD (S6b not yet built).`
      : 'RESULT: OK (all live assertions passed) — S6b implementation is GREEN.');
  }
} finally {
  await b.close();
}

setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
