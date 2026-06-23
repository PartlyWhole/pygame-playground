// SPIKE (throwaway de-risking): ruff-wasm RULE CURATION.
// The original lint spike proved ruff-wasm loads + lints + CM5 wiring works. This
// confirms the make-or-break UX detail: can we select only high-value diagnostics
// (undefined names / unused imports — the pyflakes-equivalent F-codes) and SUPPRESS
// style noise (E701 "multiple statements" etc.) that the app's own compact examples
// trigger? Also pins the exact package + version and dumps the Workspace API shape.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const RUFF = 'https://esm.sh/@astral-sh/ruff-wasm-web@0.15.18';   // pinned candidate (current latest)
let failures = 0;
const ok = (m) => console.log('ok   -', m);
const fail = (m) => { console.error('FAIL:', m); failures++; };
const info = (m) => console.log('info -', m);

const browser = await launch();
const page = await browser.newPage();
const perr = [];
page.on('pageerror', e => perr.push(String(e)));
page.on('console', m => { if (m.type() === 'error') perr.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });

// A snippet styled like the app's examples (compact one-line ifs -> E701), plus a
// deliberate undefined name (F821) and an unused import (F401).
const SAMPLE = [
  'import pygame, random            # random is unused -> F401',
  'pygame.init()',
  'screen = pygame.display.set_mode((640, 480))',
  'keys = pygame.key.get_pressed()',
  'x = 0',
  'if keys[pygame.K_LEFT]:  x -= speeed   # compact if -> E701 ; speeed undefined -> F821',
  'if keys[pygame.K_RIGHT]: x += 5',
].join('\n');

const result = await page.evaluate(async ({ ruffUrl, sample }) => {
  const mod = await import(ruffUrl);
  const init = mod.default;
  await init();                                  // wasm init
  const { Workspace } = mod;
  const out = { api: {} };
  out.api.hasWorkspace = typeof Workspace === 'function';
  out.api.hasDefaultSettings = typeof Workspace.defaultSettings === 'function';
  const def = Workspace.defaultSettings ? Workspace.defaultSettings() : null;
  out.api.defaultSettingsKeys = def ? Object.keys(def) : null;
  out.api.defaultSettingsSample = def ? JSON.stringify(def).slice(0, 400) : null;

  // Default (uncurated) lint — expect style noise (E701) present.
  try {
    const wsDefault = new Workspace(Workspace.defaultSettings());
    out.defaultDiags = wsDefault.check(sample).map(d => d.code);
  } catch (e) { out.defaultErr = String(e); }

  // Curated: try a settings object selecting only F-codes (pyflakes-equivalent) + syntax.
  // Try a few shapes since the settings schema varies by version.
  const tryShapes = [
    { ...((def) || {}), 'lint': { ...((def && def.lint) || {}), select: ['F'] } },
    { ...((def) || {}), select: ['F'] },
  ];
  for (let i = 0; i < tryShapes.length; i++) {
    try {
      const ws = new Workspace(tryShapes[i]);
      const codes = ws.check(sample).map(d => d.code);
      out['curated' + i] = codes;
    } catch (e) { out['curated' + i + 'Err'] = String(e).slice(0, 200); }
  }

  // CRITICAL: with select=['F'], is a real SYNTAX ERROR still reported? (Syntax
  // errors are the #1 diagnostic; ruff surfaces them independent of rule select.)
  const broken = 'import pygame\ndef run(:\n    pass\n';   // invalid syntax
  try {
    const ws = new Workspace({ lint: { select: ['F'] } });
    out.syntaxDiags = ws.check(broken).map(d => ({ code: d.code, msg: (d.message || '').slice(0, 60), row: d.location && d.location.row }));
  } catch (e) { out.syntaxErr = String(e).slice(0, 200); }
  return out;
}, { ruffUrl: RUFF, sample: SAMPLE }).catch(e => ({ fatal: String(e) }));

if (result.fatal) { fail('ruff-wasm failed to load/run: ' + result.fatal); }
else {
  info('Workspace API: ' + JSON.stringify(result.api));
  info('default diagnostics codes: ' + JSON.stringify(result.defaultDiags || result.defaultErr));
  if (result.defaultDiags && result.defaultDiags.some(c => /E7|E70/.test(c)))
    info('confirmed: DEFAULT lint includes style noise (E70x) on compact-if code');
  for (const key of Object.keys(result)) {
    if (key.startsWith('curated')) info(key + ': ' + JSON.stringify(result[key]));
  }
  // Find a curated shape that KEEPS F821 (undefined) + F401 (unused) but DROPS E-codes.
  const good = ['curated0', 'curated1'].map(k => result[k]).find(
    codes => Array.isArray(codes) && codes.includes('F821') && codes.includes('F401')
             && !codes.some(c => /^E\d/.test(c)));
  if (good) ok('rule curation works: select=["F"] keeps F821+F401, drops E-style noise -> ' + JSON.stringify(good));
  else fail('could not find a settings shape that keeps F-codes and drops E-noise; see info above');

  info('syntax-error diagnostics (select F): ' + JSON.stringify(result.syntaxDiags || result.syntaxErr));
  if (Array.isArray(result.syntaxDiags) && result.syntaxDiags.length > 0)
    ok('syntax errors ARE still reported with select=["F"] (row ' + result.syntaxDiags[0].row + ')');
  else fail('syntax error NOT reported with select=["F"] — would need to add it explicitly');
}

if (perr.length) info('page errors: ' + perr.join(' | '));
await browser.close();
console.log(failures ? `\nLINT-RULES SPIKE FAILED (${failures})` : '\nLINT-RULES SPIKE OK — ruff rule curation confirmed');
process.exitCode = failures ? 1 : 0;
