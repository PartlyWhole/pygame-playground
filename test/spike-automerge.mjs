import { launch } from './_harness.mjs';

const ATTEMPTS = {
  A: `
    import { Repo } from "https://esm.sh/@automerge/automerge-repo@2?bundle";
    import { WebSocketClientAdapter } from "https://esm.sh/@automerge/automerge-repo-network-websocket@2?bundle";
    window.__amr = { Repo, WebSocketClientAdapter };
  `,
  B: `
    import { Repo, initializeWasm } from "https://esm.sh/@automerge/automerge-repo@2/slim?bundle";
    import wasmUrl from "https://esm.sh/@automerge/automerge@2/dist/automerge.wasm?url";
    import { WebSocketClientAdapter } from "https://esm.sh/@automerge/automerge-repo-network-websocket@2?bundle";
    await initializeWasm(wasmUrl);
    window.__amr = { Repo, WebSocketClientAdapter };
  `,
};

const attempt = process.argv[2] || 'A';
const SRC = ATTEMPTS[attempt];

const host = async (page, label) => {
  const errs = [];
  page.on('pageerror', e => errs.push(label + ': ' + e));
  page.on('console', m => { if (m.type() === 'error') errs.push(label + ' console: ' + m.text()); });
  await page.goto('http://localhost:8923/');
  await page.addScriptTag({ type: 'module', content: SRC + '\nwindow.__amrReady = true;' });
  await page.waitForFunction(() => window.__amrReady === true, null, { timeout: 30000 })
    .catch(() => { throw new Error(label + ' module never loaded; errors: ' + JSON.stringify(errs)); });
  return errs;
};

const b = await launch();
try {
  const A = await b.newPage(); await host(A, 'A');
  const url = await A.evaluate(async () => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = repo.create({ code: 'hello' });
    await h.whenReady();
    window.__h = h;
    return h.url;
  });
  console.log('attempt', attempt, 'created doc:', url);

  const B = await b.newPage(); await host(B, 'B');
  const found = await B.evaluate(async (u) => {
    const { Repo, WebSocketClientAdapter } = window.__amr;
    const repo = new Repo({ network: [new WebSocketClientAdapter('wss://sync.automerge.org')] });
    const h = await repo.find(u);
    await h.whenReady();
    window.__h = h;
    return h.doc().code;
  }, url);
  console.log('B sees code:', JSON.stringify(found));

  await B.evaluate(async () => {
    const A = await import("https://esm.sh/@automerge/automerge@2?bundle");
    window.__updateTextOk = typeof A.updateText === 'function';
    window.__h.change(d => A.updateText(d, ['code'], 'hello world'));
  });
  const updateTextOk = await B.evaluate(() => window.__updateTextOk);
  console.log('updateText present on base export:', updateTextOk);
  const sawIt = await A.waitForFunction(() => window.__h.doc().code === 'hello world', null, { timeout: 15000 })
    .then(() => true, () => false);
  console.log('A observed B edit:', sawIt);
  if (found !== 'hello' || !sawIt) { console.error('SPIKE FAILED'); process.exitCode = 1; }
  else console.log('SPIKE OK (attempt ' + attempt + ')');
} finally {
  await b.close();
}
