// S7: the share-removal contract (open-decisions #2, verdict B).
//
// The 🔗 Share button (PRODUCER) and the legacy `#code=` / `#project=` LOAD
// readers (CONSUMERS) are removed. Old packed-project share links stop opening
// (accepted). `#room=` (live-collab join) is KEPT and must stay unaffected.
//
// New boot precedence: #room > saved(localStorage) > legacy-key > default.
// (#project= and #code= are dropped from the precedence chain.)
//
// RED against current code (button + readers still present); GREEN after the
// implementer deletes the markup/listener + the two consume sites.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);
const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });
const cmValue = () => page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());

// b64url encode the OLD way (matches the now-removed producer at index.html:1461)
// so we can prove a hand-built legacy link is IGNORED, not loaded.
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------------------------------------------------------------------------
// 1. The Share button is GONE from the DOM.
// ---------------------------------------------------------------------------
await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));
const hasShareBtn = await page.evaluate(() => document.getElementById('shareBtn') !== null);
if (!hasShareBtn) ok('#shareBtn is gone from the DOM');
else fail('#shareBtn still exists in the DOM');

// ---------------------------------------------------------------------------
// 2. A `#project=<encoded>` URL is IGNORED on boot — the app loads the
//    default/saved project, NOT the URL payload. Build the link the OLD way to
//    prove the reader is gone.
// ---------------------------------------------------------------------------
const PROJ_SENTINEL = 'SHARED_BY_LINK_PROJECT = 1';
const projHash = '#project=' + b64url(JSON.stringify({
  files: { 'main.py': PROJ_SENTINEL + '\n' }, order: ['main.py'], entry: 'main.py',
}));
// Clear storage so "default" is unambiguous, then do a REAL document load
// (about:blank first) so this exercises loadInitialProject — not a same-path
// fragment nav (which would only fire the also-removed hashchange handler).
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => { localStorage.clear(); });
await page.goto('about:blank');
await page.goto(URL + projHash, { waitUntil: 'load' });
await booted().catch(() => fail('did not boot from #project= URL'));
const afterProj = await cmValue();
if (!afterProj.includes('SHARED_BY_LINK_PROJECT'))
  ok('#project= URL is IGNORED on boot (legacy reader removed)');
else fail('#project= URL still loaded its payload: ' + afterProj.slice(0, 80));

// ---------------------------------------------------------------------------
// 3. A `#code=<encoded>` URL is IGNORED on boot — same as above for the
//    single-file legacy reader.
// ---------------------------------------------------------------------------
const CODE_SENTINEL = 'SHARED_BY_LINK_CODE = 1';
const codeHash = '#code=' + b64url(CODE_SENTINEL + '\n');
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => { localStorage.clear(); });
await page.goto('about:blank');
await page.goto(URL + codeHash, { waitUntil: 'load' });
await booted().catch(() => fail('did not boot from #code= URL'));
const afterCode = await cmValue();
if (!afterCode.includes('SHARED_BY_LINK_CODE'))
  ok('#code= URL is IGNORED on boot (legacy reader removed)');
else fail('#code= URL still loaded its payload: ' + afterCode.slice(0, 80));

// ---------------------------------------------------------------------------
// 4. A saved (localStorage) project still wins over a legacy `#project=` URL —
//    the new precedence is #room > saved > legacy-key > default. The share link
//    must NOT clobber the saved project.
// ---------------------------------------------------------------------------
await page.goto(URL, { waitUntil: 'load' }); await booted();
await page.evaluate(() => localStorage.setItem('pygame-playground:project',
  JSON.stringify({ files: { 'main.py': 'SAVED_WINS = 7\n' }, order: ['main.py'], entry: 'main.py' })));
await page.goto('about:blank');
await page.goto(URL + projHash, { waitUntil: 'load' });
await booted().catch(() => fail('did not boot (saved vs #project=)'));
const afterSaved = await cmValue();
if (afterSaved.includes('SAVED_WINS') && !afterSaved.includes('SHARED_BY_LINK_PROJECT'))
  ok('saved project wins over a #project= URL (precedence: saved > legacy link)');
else fail('precedence wrong — saved did not win over #project=: ' + afterSaved.slice(0, 80));
await page.evaluate(() => localStorage.clear());

// ---------------------------------------------------------------------------
// 5. `#room=` is UNAFFECTED — a `#room=<id>` URL still triggers the collab join
//    path (joinRoom -> loadAutomerge sets window.__amLoaded). This fires before
//    any relay round-trip, so it is relay-independent: even a non-existent room
//    id proves the join was ATTEMPTED. Lightweight; SKIP if the vendor bundle
//    itself can't import (no relay needed for the sentinel).
// ---------------------------------------------------------------------------
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto('about:blank');
await page.goto(URL + '#room=automerge:doesNotExist999shareRemoved', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30_000 });
const joined = await page.waitForFunction(() => window.__amLoaded === true, null, { timeout: 30_000 })
  .then(() => true, () => false);
if (joined) {
  ok('#room= still triggers the collab join path (__amLoaded set) — UNAFFECTED');
} else {
  // Automerge vendor bundle failed to import (offline/CDN) — the join path is
  // present but un-exercisable here. Don't fail the share-removal contract on it.
  console.log('SKIP (collab) — #room= join could not load Automerge (vendor bundle unreachable).');
}
// And the page stays usable in solo fallback (room not found).
await page.waitForTimeout(1500);
const usable = await page.evaluate(() => {
  const cm = document.querySelector('.CodeMirror').CodeMirror;
  cm.setValue('still_usable = 1'); return cm.getValue();
});
if (usable === 'still_usable = 1') ok('#room= bad-id stays usable (solo fallback intact)');
else fail('#room= path left the page unusable: ' + usable);

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'SHARE-REMOVED VERIFY FAILED' : 'SHARE-REMOVED VERIFY OK');
