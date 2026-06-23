import { launch } from './_harness.mjs';
const b = await launch();
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
try {
  const p = await b.newPage();
  const reqs = [];
  p.on('request', r => { if (/vendor\/automerge|esm\.sh/.test(r.url())) reqs.push(r.url()); });
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

  console.log(process.exitCode ? 'TASK3 FAIL' : 'TASK3 OK');

  // --- live two-way sync + concurrent edits survive ---
  {
    const A = await b.newPage(); await A.goto('http://localhost:8923/');
    await A.waitForFunction(() => document.getElementById('collabBtn'), null, { timeout: 30000 });
    await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.setValue('line_one = 1\n'));
    await A.click('#collabBtn');
    const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
    const B = await b.newPage(); await B.goto('http://localhost:8923/' + hash);
    await B.waitForFunction(() => document.querySelector('.CodeMirror')?.CodeMirror.getValue().includes('line_one'), null, { timeout: 30000 });
    // A appends; B should see it.
    await A.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('line_two = 2\n', { line: 1, ch: 0 }); });
    await B.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('line_two'), null, { timeout: 15000 })
      .then(() => console.log('SYNC A->B OK'), () => { console.error('SYNC A->B FAIL'); process.exitCode = 1; });
    // B prepends; A should see it (two-way).
    await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.replaceRange('from_b = 9\n', { line: 0, ch: 0 }); });
    await A.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('from_b'), null, { timeout: 15000 })
      .then(() => console.log('SYNC B->A OK'), () => { console.error('SYNC B->A FAIL'); process.exitCode = 1; });
    // Both survive (CRDT merge, no clobber).
    const finalA = await A.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue());
    if (finalA.includes('line_two') && finalA.includes('from_b')) console.log('MERGE OK');
    else { console.error('MERGE FAIL:', JSON.stringify(finalA)); process.exitCode = 1; }
  }
  // --- presence: peer count + remote cursor marker ---
  {
    const A = await b.newPage(); await A.goto('http://localhost:8923/');
    await A.waitForFunction(() => document.getElementById('collabBtn'), null, { timeout: 30000 });
    await A.click('#collabBtn');
    const hash = await A.waitForFunction(() => location.hash.startsWith('#room=') ? location.hash : false, null, { timeout: 30000 }).then(h => h.jsonValue());
    const B = await b.newPage(); await B.goto('http://localhost:8923/' + hash);
    await B.waitForFunction(() => document.getElementById('liveDot') && !document.getElementById('liveDot').hidden, null, { timeout: 30000 });
    await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue('a\nb\nc'); cm.setCursor({ line: 2, ch: 1 }); });
    await A.waitForFunction(() => document.getElementById('peerCount').textContent === '2', null, { timeout: 20000 })
      .then(() => console.log('PEER COUNT OK'), () => { console.error('PEER COUNT FAIL'); process.exitCode = 1; });
    await A.waitForFunction(() => document.querySelector('.remote-cursor') !== null, null, { timeout: 20000 })
      .then(() => console.log('REMOTE CURSOR OK'), () => { console.error('REMOTE CURSOR FAIL'); process.exitCode = 1; });
    // fun anon name (adjective + animal, not "anon-xxxx")
    // Wait for the name to propagate via presence before sampling (it can lag the
    // cursor render by a beat — sampling immediately was flaky and read "").
    await A.waitForFunction(() => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(document.querySelector('.remote-flag')?.textContent || ''),
      null, { timeout: 20000 }).catch(() => {});
    const flag = await A.evaluate(() => document.querySelector('.remote-flag')?.textContent || '');
    console.log('peer name:', JSON.stringify(flag), /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(flag) ? '(OK)' : '(BAD)');
    if (!/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(flag)) { console.error('NAME FAIL'); process.exitCode = 1; }
    // shared highlighting: B selects a range; A renders a selection band (markText sets the
    // `background-color` longhand inline — the name flag uses the `background` shorthand, so this
    // selector matches only the highlight). Chrome serializes the hsla value to rgba in `style`.
    await B.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 1 }); });
    await A.waitForFunction(() => document.querySelector('.CodeMirror span[style*="background-color"]') !== null, null, { timeout: 20000 })
      .then(() => console.log('SHARED HIGHLIGHT OK'), () => { console.error('SHARED HIGHLIGHT FAIL'); process.exitCode = 1; });
  }
  // --- bad room id => graceful solo fallback, page stays usable ---
  {
    const p = await b.newPage();
    await p.goto('http://localhost:8923/#room=automerge:doesNotExist999');
    await p.waitForFunction(() => document.querySelector('.CodeMirror') !== null, null, { timeout: 30000 });
    await p.waitForTimeout(3000);
    const usable = await p.evaluate(() => { const cm = document.querySelector('.CodeMirror').CodeMirror; cm.setValue('still_works = 1'); return cm.getValue(); });
    console.log('bad-room stays usable:', usable === 'still_works = 1' ? 'YES' : 'NO');
    if (usable !== 'still_works = 1') process.exitCode = 1;
  }
} finally { await b.close(); }
