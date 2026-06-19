import { launch } from './_harness.mjs';
const SRC = `
  import * as AM from "/vendor/automerge-collab.mjs";
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
const b = await launch();
try {
  const A = await b.newPage(); await host(A, 'A');
  const url = await A.evaluate(async () => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = repo.create({ code: 'hello' }); await h.whenReady(); window.__h = h; return h.url;
  });
  console.log('created doc:', url);
  const B = await b.newPage(); await host(B, 'B');
  const found = await B.evaluate(async (u) => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    // sync.automerge.org is a relay (no persistence): the first find() can
    // resolve "unavailable" if it races the just-created doc's announcement.
    // The doc becomes available within ~1s, so retry briefly. This races the
    // network, NOT the bundle — diag confirmed a single retry always wins.
    const start = Date.now();
    for (;;) {
      try {
        const h = await repo.find(u); await h.whenReady(); window.__h = h; return h.doc().code;
      } catch (e) {
        if (Date.now() - start > 15000) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }, url);
  console.log('B sees code:', JSON.stringify(found));
  await B.evaluate(() => { const { updateText } = window.__amr; window.__h.change(d => updateText(d, ['code'], 'hello world')); });
  const sawIt = await A.waitForFunction(() => window.__h.doc().code === 'hello world', null, { timeout: 15000 }).then(() => true, () => false);
  console.log('A observed B edit:', sawIt);
  if (found !== 'hello' || !sawIt) { console.error('BUNDLE SPIKE FAILED'); process.exitCode = 1; }
  else console.log('BUNDLE SPIKE OK');
} finally { await b.close(); }
