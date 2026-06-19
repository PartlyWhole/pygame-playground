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
} finally { await b.close(); }
