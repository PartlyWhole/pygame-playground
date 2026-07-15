// Multi-transport collab battery: proves a room works WITHOUT the public sync server.
// Scenario 1 (?transports=tabs): pure BroadcastChannel — same-browser tabs, zero network.
// Scenario 2 (?transports=p2p): pure WebRTC — signaling via public Nostr relays, then
//   direct data channels. Needs internet for the relays; if they're unreachable the
//   scenario reports SKIPPED (like collab-multifile's relay probe) rather than failing.
// Both scenarios assert that NO websocket to sync.automerge.org is ever opened.
import { launch } from './_harness.mjs';
const b = await launch();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

async function scenario(name, transports, { adoptTimeout, skipOnTimeout }) {
  const ctx = await b.newContext();   // fresh context per scenario: isolated BroadcastChannel space
  try {
    const syncServerHits = [];
    // headless Chromium can't resolve peers' mDNS host candidates (no responder), so
    // same-machine ICE would fail; trystero's test knob falls back to loopback. Real
    // browsers on real networks use mDNS/STUN normally — this seam is test-only.
    await ctx.addInitScript(() => { window.__collabRtcTestConfig = { _test_only_mdnsHostFallbackToLoopback: true }; });
    const A = await ctx.newPage();
    A.on('websocket', ws => { if (ws.url().includes('sync.automerge.org')) syncServerHits.push(ws.url()); });
    await A.goto('http://localhost:8923/?transports=' + transports);
    await A.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });
    await A.evaluate((t) => document.querySelector('.CodeMirror').CodeMirror.setValue('seeded_via_' + t + ' = 1'), transports);
    await A.click('#collabBtn');
    const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
    console.log(`[${name}] room:`, hash.slice(0, 32) + '…');

    const B = await ctx.newPage();
    B.on('websocket', ws => { if (ws.url().includes('sync.automerge.org')) syncServerHits.push(ws.url()); });
    await B.goto('http://localhost:8923/?transports=' + transports + hash);
    const adopted = await B.waitForFunction((t) => document.querySelector('.CodeMirror')?.CodeMirror.getValue().includes('seeded_via_' + t), transports, { timeout: adoptTimeout })
      .then(() => true, () => false);
    if (!adopted) {
      if (skipOnTimeout) { console.log(`[${name}] SKIPPED — peers did not meet in ${adoptTimeout}ms (relays unreachable or WebRTC blocked on this network)`); return; }
      return fail(`[${name}] B never adopted A's code (no-sync-server join broken)`);
    }
    console.log(`[${name}] JOIN OK (no sync server)`);

    // live two-way sync
    await A.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('a_to_b = 2\n', { line: 0, ch: 0 }); });
    await B.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('a_to_b'), null, { timeout: 20000 })
      .then(() => console.log(`[${name}] SYNC A->B OK`), () => fail(`[${name}] SYNC A->B`));
    await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('b_to_a = 3\n', { line: 0, ch: 0 }); });
    await A.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('b_to_a'), null, { timeout: 20000 })
      .then(() => console.log(`[${name}] SYNC B->A OK`), () => fail(`[${name}] SYNC B->A`));

    // presence (peer count, cursors) travels as ephemeral messages — assert it flows on this transport too
    await A.waitForFunction(() => +document.getElementById('peerCount').textContent >= 2, null, { timeout: 20000 })
      .then(() => console.log(`[${name}] PRESENCE OK (peer count ≥ 2)`), () => fail(`[${name}] presence never showed 2 peers`));

    if (syncServerHits.length) fail(`[${name}] opened ${syncServerHits.length} websocket(s) to sync.automerge.org — transport gating leaks`);
    else console.log(`[${name}] sync-server websockets: 0 (gating OK)`);
  } finally {
    await ctx.close();
  }
}

// The Collaboration-panel "Connection pathways" checkboxes: persist to localStorage,
// snap back when the last one is unchecked, and actually gate the room (no URL param).
async function uiPrefsScenario() {
  const name = 'ui-prefs';
  const ctx = await b.newContext();
  try {
    await ctx.addInitScript(() => { window.__collabRtcTestConfig = { _test_only_mdnsHostFallbackToLoopback: true }; });
    const syncServerHits = [];
    const A = await ctx.newPage();
    A.on('websocket', ws => { if (ws.url().includes('sync.automerge.org')) syncServerHits.push(ws.url()); });
    await A.goto('http://localhost:8923/');
    await A.waitForFunction(() => document.getElementById('collabBtn') !== null, null, { timeout: 30000 });

    // uncheck "Sync server" → localStorage records the remaining pathways
    const stored = await A.evaluate(() => {
      document.querySelector('#transportPrefs input[data-transport="ws"]').click();
      return localStorage.getItem('pygame-playground:transports');
    });
    if (stored !== 'p2p,tabs') return fail(`[${name}] expected stored "p2p,tabs", got ${JSON.stringify(stored)}`);
    console.log(`[${name}] checkbox persisted:`, stored);

    // unchecking the remaining two must snap the last one back (never zero pathways)
    const snap = await A.evaluate(() => {
      document.querySelector('#transportPrefs input[data-transport="p2p"]').click();
      document.querySelector('#transportPrefs input[data-transport="tabs"]').click();
      return { tabs: document.querySelector('#transportPrefs input[data-transport="tabs"]').checked,
               stored: localStorage.getItem('pygame-playground:transports') };
    });
    if (!snap.tabs || snap.stored !== 'tabs') return fail(`[${name}] last-checkbox guard broken: ${JSON.stringify(snap)}`);
    console.log(`[${name}] last-checkbox snap-back OK`);
    await A.evaluate(() => { document.querySelector('#transportPrefs input[data-transport="p2p"]').click(); }); // back to p2p,tabs

    // start a room WITHOUT any ?transports= param — the saved preference must gate it
    await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('via_ui_prefs = 1'));
    await A.click('#collabBtn');
    const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());

    const B = await ctx.newPage();   // same context → same localStorage preference
    B.on('websocket', ws => { if (ws.url().includes('sync.automerge.org')) syncServerHits.push(ws.url()); });
    await B.goto('http://localhost:8923/' + hash);
    await B.waitForFunction(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue().includes('via_ui_prefs'), null, { timeout: 20000 })
      .then(() => console.log(`[${name}] JOIN OK under saved preference`), () => fail(`[${name}] join failed under saved preference`));

    if (syncServerHits.length) fail(`[${name}] saved preference did not gate the sync server (${syncServerHits.length} websocket(s))`);
    else console.log(`[${name}] sync-server websockets: 0 (checkbox gating OK)`);
  } finally {
    await ctx.close();
  }
}

try {
  await scenario('tabs-only', 'tabs', { adoptTimeout: 20000, skipOnTimeout: false });
  await scenario('p2p-only',  'p2p',  { adoptTimeout: 60000, skipOnTimeout: true });
  await uiPrefsScenario();
  console.log(process.exitCode ? 'collab-transports FAIL' : 'collab-transports OK');
} finally {
  await b.close();
}
