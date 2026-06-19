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
  console.log(process.exitCode ? 'TASK2 FAIL' : 'TASK2 OK');
} finally { await b.close(); }
