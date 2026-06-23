// SPIKE (throwaway de-risking): which in-browser Python lint engine is viable for
// "auto-lint as you type", and is CodeMirror 5's lint addon wireable no-build?
//
// Measures, in REAL headless Chromium against the already-booted Pyodide:
//   1. pyflakes via micropip            (undefined-name / unused-import quality)
//   2. compile()-only syntax check      (cheapest floor; always available)
//   3. ruff via wasm from a CDN, no-build (can it even import here?)
//   4. (noted in findings) pure-JS options
//   + CM5 addon/lint wiring: inject lint.js/lint.css from the SAME cdnjs 5.65.16
//     path the app uses, register an async linter, assert a gutter marker renders.
//
// Run:  node test/spike-lint.mjs            (server must be at http://localhost:8923/)
// Does NOT modify index.html or any committed app behavior.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const CDN5 = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16';
const N = 12;                                  // lint repetitions to average per engine
const out = [];
const log = (...a) => { console.log(...a); out.push(a.join(' ')); };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (x) => Math.round(x * 10) / 10;

// ---- the realistic program under test: the "Snake" example (~63 lines) padded with
// the "Swimming fish" example so we lint a ~200-line file. We assemble it in-page
// from index.html's own EXAMPLES so the source is REAL, then make two variants:
//   SEMANTIC: syntactically valid, but with an undefined name + an unused import
//             (the case that exercises pyflakes/ruff beyond syntax checking)
//   SYNTAX:   the SEMANTIC source with a hard SyntaxError appended (the floor case)
// We benchmark on SEMANTIC (the common as-you-type state) and separately confirm
// each engine reports the injected SYNTAX error with a line number.
const SEMANTIC_TAIL = [
  '',
  'import collections   # unused import (spike): pyflakes/ruff F401 target',
  '',
  'def broken_tail():',
  '    total = scoer + 1   # undefined name (typo): pyflakes/ruff F821 target',
  '    return total',
  '',
];
const SYNTAX_TAIL = [
  '',
  'def bad_syntax(:   # invalid syntax at the colon (spike)',
  '    pass',
  '',
];

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });
log('booted: Pyodide + pygame-ce ready');

// Build the ~200-line test program in-page from real EXAMPLES. __lintSrc is the
// SEMANTIC variant (valid syntax, 1 unused import + 1 undefined name); __syntaxSrc
// is the same plus a hard SyntaxError.
const meta = await page.evaluate(({ semTail, synTail }) => {
  const fish = EXAMPLES['Swimming fish'];
  const snake = EXAMPLES['Snake'];
  const base = snake + '\n' + fish + '\n';
  window.__lintSrc = base + semTail.join('\n') + '\n';
  window.__syntaxSrc = base + semTail.join('\n') + '\n' + synTail.join('\n') + '\n';
  const s = window.__lintSrc;
  return { lines: s.split('\n').length, chars: s.length };
}, { semTail: SEMANTIC_TAIL, synTail: SYNTAX_TAIL });
log(`test program assembled: ${meta.lines} lines, ${meta.chars} chars (Snake + Swimming-fish + unused-import + undefined-name)`);

const results = {};   // engine -> { init, perLint:[], diag, loads, note }

// =====================================================================
// 1. compile()-only syntax check (the floor — Pyodide already up)
// =====================================================================
{
  const r = await page.evaluate(async ({ n }) => {
    pyodide.runPython(`
import json
def __compile_lint(src):
    try:
        compile(src, '<lint>', 'exec')
        return json.dumps([])
    except SyntaxError as e:
        return json.dumps([{ 'line': e.lineno or 1, 'col': (e.offset or 1),
                             'msg': e.msg, 'sev': 'error' }])
`);
    const lintOnce = (which) => pyodide.runPython(
      `__compile_lint(${which})`);
    pyodide.globals.set('__sem', window.__lintSrc);
    pyodide.globals.set('__syn', window.__syntaxSrc);
    // time on the valid (semantic) source — the common as-you-type state
    const t0 = performance.now();
    lintOnce('__sem');
    const init = performance.now() - t0;
    const per = [];
    for (let i = 0; i < n; i++) {
      const a = performance.now(); lintOnce('__sem'); per.push(performance.now() - a);
    }
    return { init, per, onValid: lintOnce('__sem'), onSyntax: lintOnce('__syn') };
  }, { n: N });
  results.compile = {
    init: r.init, perLint: r.per, loads: true,
    diag: 'syntax errors only (line, col, msg)',
    sample: r.onSyntax,
  };
  log(`\n[1] compile() syntax check — init ${r1(r.init)}ms, per-lint median ${r1(med(r.per))}ms / mean ${r1(mean(r.per))}ms`);
  log(`    on valid source: ${r.onValid}  (no diagnostics — compile sees no SEMANTIC errors)`);
  log(`    on syntax-error source: ${r.onSyntax}`);
}

// =====================================================================
// 2. pyflakes via micropip (pure-Python wheel)
// =====================================================================
{
  const install = await page.evaluate(async () => {
    const t0 = performance.now();
    try {
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');
      await micropip.install('pyflakes');
      const ok = pyodide.runPython('import pyflakes; pyflakes.__version__');
      return { ok: true, ms: performance.now() - t0, version: ok };
    } catch (e) {
      return { ok: false, ms: performance.now() - t0, error: String(e) };
    }
  });
  if (!install.ok) {
    results.pyflakes = { loads: false, note: install.error, init: install.ms };
    log(`\n[2] pyflakes — INSTALL FAILED in ${r1(install.ms)}ms: ${install.error}`);
  } else {
    log(`\n[2] pyflakes ${install.version} installed via micropip in ${r1(install.ms)}ms (one-time)`);
    const r = await page.evaluate(async ({ n }) => {
      // Define a structured linter mirroring how the app would call pyflakes:
      // collect (lineno, col, message) by subclassing its Reporter.
      pyodide.runPython(`
import json
from pyflakes import api as _pf_api, reporter as _pf_rep

class _CollectReporter(_pf_rep.Reporter):
    def __init__(self):
        self.items = []
    def unexpectedError(self, filename, msg):
        self.items.append({'line': 1, 'col': 1, 'msg': str(msg), 'sev': 'error'})
    def syntaxError(self, filename, msg, lineno, offset, text):
        self.items.append({'line': lineno or 1, 'col': (offset or 1),
                           'msg': str(msg), 'sev': 'error'})
    def flake(self, message):
        self.items.append({'line': message.lineno,
                           'col': getattr(message, 'col', 0) + 1,
                           'msg': str(message.message % message.message_args),
                           'sev': 'warning'})

def __pyflakes_lint(src):
    rep = _CollectReporter()
    _pf_api.check(src, '<lint>', rep)
    return json.dumps(rep.items)
`);
      pyodide.globals.set('__sem', window.__lintSrc);
      pyodide.globals.set('__syn', window.__syntaxSrc);
      const lintOnce = (which) => pyodide.runPython(`__pyflakes_lint(${which})`);
      const t0 = performance.now();
      const first = lintOnce('__sem');
      const init = performance.now() - t0;   // includes one-time module warmup of check()
      const per = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now(); lintOnce('__sem'); per.push(performance.now() - a);
      }
      return { init, per, sample: first, onSyntax: lintOnce('__syn') };
    }, { n: N });
    const items = JSON.parse(r.sample);
    const synItems = JSON.parse(r.onSyntax);
    results.pyflakes = {
      loads: true, init: install.ms, firstLintInit: r.init, perLint: r.per,
      diag: 'syntax + undefined-name + unused-import + unused-var + redefinition',
      sample: r.sample, count: items.length,
    };
    log(`    first-lint warmup ${r1(r.init)}ms; per-lint median ${r1(med(r.per))}ms / mean ${r1(mean(r.per))}ms`);
    log(`    on valid source — diagnostics found: ${items.length}`);
    for (const it of items.slice(0, 8)) log(`      L${it.line}:${it.col} [${it.sev}] ${it.msg}`);
    log(`    on syntax-error source — reports: ${JSON.stringify(synItems)}`);
  }
}

// =====================================================================
// 2b. pycodestyle (optional style warnings) via micropip
// =====================================================================
{
  const r = await page.evaluate(async ({ n }) => {
    const t0 = performance.now();
    try {
      const micropip = pyodide.pyimport('micropip');
      await micropip.install('pycodestyle');
      pyodide.runPython(`
import json, io, pycodestyle
class _Catch(pycodestyle.BaseReport):
    def __init__(self, opts):
        super().__init__(opts); self.items = []
    def error(self, line_number, offset, text, check):
        code = super().error(line_number, offset, text, check)
        if code: self.items.append({'line': line_number, 'col': offset + 1,
                                    'msg': text, 'sev': 'warning'})
        return code
def __pycodestyle_lint(src):
    style = pycodestyle.StyleGuide(reporter=_Catch, quiet=True)
    checker = pycodestyle.Checker('<lint>', lines=src.splitlines(keepends=True),
                                  options=style.options, report=style.options.report)
    checker.check_all()
    return json.dumps(style.options.report.items)
`);
      const init = performance.now() - t0;
      const lintOnce = () => pyodide.runPython(
        `__pycodestyle_lint(__SRC__)`.replace('__SRC__', JSON.stringify(window.__lintSrc)));
      lintOnce();
      const per = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now(); lintOnce(); per.push(performance.now() - a);
      }
      const sample = lintOnce();
      return { ok: true, init, per, count: JSON.parse(sample).length, sample };
    } catch (e) { return { ok: false, error: String(e), init: performance.now() - t0 }; }
  }, { n: N });
  if (r.ok) {
    results.pycodestyle = { loads: true, init: r.init, perLint: r.per, count: r.count,
      diag: 'PEP8 style (line length, whitespace, etc.)' };
    log(`\n[2b] pycodestyle installed+ran; init ${r1(r.init)}ms, per-lint median ${r1(med(r.per))}ms, ${r.count} style hits`);
  } else {
    results.pycodestyle = { loads: false, note: r.error };
    log(`\n[2b] pycodestyle FAILED: ${r.error}`);
  }
}

// =====================================================================
// 3. ruff via wasm from a CDN, NO build step. Try several CDN entry points.
// =====================================================================
{
  // Candidate ESM entry points for @astral-sh/ruff-wasm-web (browser target).
  // We try each: dynamic import in-page, then init() (wasm fetch), then a lint.
  const candidates = [
    'https://esm.sh/@astral-sh/ruff-wasm-web',
    'https://cdn.jsdelivr.net/npm/@astral-sh/ruff-wasm-web/+esm',
    'https://unpkg.com/@astral-sh/ruff-wasm-web?module',
  ];
  let ruffResult = null;
  for (const url of candidates) {
    const r = await page.evaluate(async ({ url, src, n }) => {
      const t0 = performance.now();
      try {
        const mod = await import(url);
        const importMs = performance.now() - t0;
        // ruff-wasm-web exports a default init() (wasm-bindgen) + Workspace.
        const init = mod.default || mod.init;
        const ti = performance.now();
        if (typeof init === 'function') await init();
        const initMs = performance.now() - ti;
        const Workspace = mod.Workspace;
        if (!Workspace) return { url, stage: 'no-Workspace-export', importMs, keys: Object.keys(mod) };
        const ws = new Workspace(Workspace.version ? Workspace.defaultSettings() : {});
        const tl = performance.now();
        let first = ws.check(src);
        const firstMs = performance.now() - tl;
        const per = [];
        for (let i = 0; i < n; i++) {
          const a = performance.now(); ws.check(src); per.push(performance.now() - a);
        }
        return { url, ok: true, importMs, initMs, firstMs, per,
                 count: Array.isArray(first) ? first.length : -1,
                 sample: JSON.stringify(Array.isArray(first) ? first.slice(0, 4) : first) };
      } catch (e) {
        return { url, ok: false, importMs: performance.now() - t0, error: String(e) };
      }
    }, { url, src: await page.evaluate(() => window.__lintSrc), n: N });
    log(`\n[3] ruff-wasm via ${url}`);
    if (r.ok) {
      log(`    LOADED no-build. import ${r1(r.importMs)}ms, wasm init ${r1(r.initMs)}ms, ` +
          `first-lint ${r1(r.firstMs)}ms, per-lint median ${r1(med(r.per))}ms`);
      log(`    diagnostics: ${r.count}; sample: ${r.sample}`);
      ruffResult = { loads: true, init: r.importMs + r.initMs, perLint: r.per,
        diag: 'full ruff ruleset (syntax + F-codes like pyflakes + E/W style)',
        count: r.count, sample: r.sample, url };
      break;
    } else {
      log(`    FAILED: ${r.error}`);
    }
  }
  results.ruff = ruffResult || { loads: false, note: 'all CDN entry points failed (see log above)' };
}

// =====================================================================
// 4. CM5 lint addon wiring — inject lint.js + lint.css from the SAME cdnjs
//    5.65.16 path the app uses; register an ASYNC linter; assert a gutter
//    marker actually renders. This proves the wiring is feasible no-build.
// =====================================================================
{
  const wiring = await page.evaluate(async ({ cdn }) => {
    const load = (tag, attrs) => new Promise((res, rej) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs);
      el.onload = res; el.onerror = () => rej(new Error('load failed: ' + (attrs.src || attrs.href)));
      document.head.appendChild(el);
    });
    const lintJsUrl = cdn + '/addon/lint/lint.min.js';
    const lintCssUrl = cdn + '/addon/lint/lint.min.css';
    let loadOk = true, loadErr = null;
    try {
      await load('link', { rel: 'stylesheet', href: lintCssUrl });
      await load('script', { src: lintJsUrl });
    } catch (e) { loadOk = false; loadErr = String(e); }
    if (!loadOk) return { loadOk, loadErr };

    // Build a throwaway CM5 instance (NOT the app's editor) inside a sized, attached
    // host so it actually lays out and renders gutter markers. lint enabled with an
    // ASYNC lint source via getAnnotations + options.async = true.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:200px;';
    const ta = document.createElement('textarea');
    host.appendChild(ta);
    document.body.appendChild(host);
    window.__spikeLintCalled = false;
    const cm = CodeMirror.fromTextArea(ta, {
      mode: 'python',
      lineNumbers: true,
      gutters: ['CodeMirror-lint-markers'],
      lint: {
        async: true,
        getAnnotations(text, updateLinting, options, editor) {
          window.__spikeLintCalled = true;
          // simulate the debounced async Python round-trip
          setTimeout(() => {
            updateLinting(editor, [{
              from: CodeMirror.Pos(0, 0),
              to: CodeMirror.Pos(0, 5),
              message: 'spike: undefined name',
              severity: 'error',
            }]);
          }, 10);
        },
      },
    });
    cm.setValue('scoer = 1\nprint(scoer)\n');
    cm.refresh();
    cm.performLint();   // force a lint pass (don't wait for the debounced change hook)
    // Poll up to ~1.5s for the marker element to appear in the gutter.
    let hasMarker = false;
    for (let i = 0; i < 30; i++) {
      hasMarker = !!document.querySelector(
        '.CodeMirror-lint-marker-error, .CodeMirror-lint-marker.CodeMirror-lint-marker-error, .CodeMirror-lint-marker');
      if (hasMarker) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const hasGutter = !!document.querySelector('.CodeMirror-lint-markers');
    const markerClasses = [...document.querySelectorAll('[class*="CodeMirror-lint-marker"]')]
      .map(e => e.className).slice(0, 4);
    const tooltipApi = typeof cm.state.lint === 'object';
    return { loadOk, lintJsUrl, lintCssUrl, lintCalled: window.__spikeLintCalled, hasMarker, hasGutter,
             markerClasses, tooltipApi, asyncSupported: window.__spikeLintCalled && hasMarker };
  }, { cdn: CDN5 });
  results.cmWiring = wiring;
  log(`\n[4] CM5 lint addon wiring`);
  if (!wiring.loadOk) {
    log(`    addon FAILED to load: ${wiring.loadErr}`);
  } else {
    log(`    loaded addon/lint/lint.min.js + lint.min.css from cdnjs 5.65.16`);
    log(`    getAnnotations(async:true) called: ${wiring.lintCalled}`);
    log(`    .CodeMirror-lint-markers gutter present: ${wiring.hasGutter}`);
    log(`    .CodeMirror-lint-marker rendered: ${wiring.hasMarker} (classes: ${JSON.stringify(wiring.markerClasses)})`);
    log(`    => async-linter wiring feasible: ${wiring.asyncSupported}`);
  }
}

// =====================================================================
// Summary table
// =====================================================================
log('\n================= BENCHMARK SUMMARY =================');
const row = (name, r) => {
  if (!r) return log(`${name.padEnd(14)} | (not run)`);
  if (r.loads === false) return log(`${name.padEnd(14)} | NO-BUILD LOAD FAILED: ${(r.note || '').slice(0, 70)}`);
  const init = r.init != null ? `${r1(r.init)}ms` : '—';
  const perL = r.perLint ? `${r1(med(r.perLint))}ms` : '—';
  log(`${name.padEnd(14)} | init ${init.padEnd(9)} | per-lint(med) ${perL.padEnd(8)} | ${r.diag || ''}`);
};
row('compile()', results.compile);
row('pyflakes', results.pyflakes);
row('pycodestyle', results.pycodestyle);
row('ruff-wasm', results.ruff);
log('CM5 wiring     | ' + (results.cmWiring?.asyncSupported ? 'FEASIBLE (marker rendered, async ok)' :
  'NOT confirmed: ' + JSON.stringify(results.cmWiring)));

const realErrors = jsErrors.filter(e => !/favicon/.test(e));
log('\nJS console errors (non-favicon): ' + (realErrors.length ? realErrors.join(' | ') : 'none'));

await browser.close();
log('\nSPIKE COMPLETE');
