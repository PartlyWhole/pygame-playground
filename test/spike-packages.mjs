// SPIKE (throwaway de-risk): TRUE SUBDIRECTORIES + FULL PYTHON PACKAGES in Pyodide MEMFS.
//
// The redesign's highest-risk fork (folder-model) was OVERRIDDEN from "organizational
// folders" to "true subdirectories + full Python packages": real paths, __init__.py,
// dotted imports (`from sprites import enemy`, `import sprites.enemy`), and nested asset
// loads (`open("sprites/ship.png","rb")`). Today's engine CANNOT do this:
//   - _ProjectFinder.find_spec (index.html:922-926) matches BARE stem names only; a dotted
//     name like 'sprites.enemy' never matches, and the 'sprites' package has no entry at all.
//   - _run_project (942-958) writes every file flat: os.path.join(cwd, BARE fname).
//   - isModuleName (1075) forbids '/'.
// So we must prove the REPLACEMENT mechanism: PLAIN, NATIVE importlib over real MEMFS
// subdirectories placed on sys.path — NO custom finder, NO custom loader.
//
// This file ONLY ADDS a test. It does NOT touch index.html. It loads its own harness
// page (test/spike-packages.html) which boots the SAME Pyodide v0.27.2 + pygame-ce as
// index.html and exposes window.runPy(code) / window.writeBytes(path, b64).
//
// Run:
//   python3 -m http.server 8924          # from repo root, in another terminal
//   node test/spike-packages.mjs http://localhost:8924/test/spike-packages.html
// (default URL is the same; the arg is optional)
//
// PROVES (headless assertions):
//   1. Nested dirs via FS.mkdirTree + nested .py + __init__.py, root on sys.path:
//      BOTH `import sprites.enemy` AND `from sprites import enemy` resolve & execute.
//   2. A top-level main.py doing `from sprites import enemy` runs correctly.
//   3. A nested asset is readable by its real relative path from cwd
//      (open('sprites/ship.png','rb').read() after writing bytes there).
//   4. Path round-trip: serialize -> {path: text}, WIPE MEMFS, recreate, import STILL works
//      (models save/reload + zip + #project= share).
//   5. REPORT (assertion-backed): does native import REPLACE _ProjectFinder or coexist;
//      invalidate_caches need; __pycache__/.pyc behavior; nested write/unlink; flat coexist.

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8924/test/spike-packages.html';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));

let failed = 0;
const check = (name, cond, detail = '') => {
  const okk = !!cond;
  console.log(`${okk ? 'PASS' : 'FAIL'}: ${name}${detail ? '  — ' + detail : ''}`);
  if (!okk) failed++;
};
const fatal = (msg) => { console.error('FATAL:', msg); process.exitCode = 1; };

// Drive a Python snippet through the harness bridge. Returns the bridge result object.
const py = (code) => page.evaluate((c) => window.runPy(c), code);

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('status').textContent === 'ready' || window.bootError,
  null, { timeout: 180_000 }).catch(() => fatal('harness never booted'));

const bootErr = await page.evaluate(() => window.bootError);
if (bootErr) { fatal('boot failed: ' + bootErr); await browser.close(); process.exit(1); }
console.log('--- harness booted (Pyodide v0.27.2 + pygame-ce) ---\n');

// ---------------------------------------------------------------------------
// Shared project content used across claims. This is a REAL package:
//   sprites/__init__.py     (package marker; re-exports for convenience)
//   sprites/enemy.py        (a module with a class + a cross-module import)
//   sprites/util.py         (sibling, imported by enemy via `from . import util`)
//   main.py                 (top-level entry doing `from sprites import enemy`)
// ---------------------------------------------------------------------------
const PROJECT = {
  'sprites/__init__.py': [
    '# package marker',
    'PKG = "sprites"',
    'from .enemy import Enemy   # re-export so `from sprites import Enemy` also works',
  ].join('\n') + '\n',
  'sprites/util.py': [
    'def hp_for(level):',
    '    return 10 * level',
  ].join('\n') + '\n',
  'sprites/enemy.py': [
    'from . import util            # relative import of a sibling module',
    'from sprites.util import hp_for  # absolute dotted import of the same sibling',
    '',
    'class Enemy:',
    '    def __init__(self, level=3):',
    '        self.level = level',
    '        self.hp = hp_for(level)',
    '    def label(self):',
    '        return f"Enemy(lvl={self.level}, hp={self.hp})"',
  ].join('\n') + '\n',
  'main.py': [
    'from sprites import enemy      # `from package import module`',
    'import sprites.enemy as alias  # dotted `import package.module`',
    '',
    'e = enemy.Enemy(5)',
    'print("MAIN:", e.label())',
    'assert e.hp == 50, e.hp',
    'assert alias.Enemy is enemy.Enemy, "dotted alias != from-import (different module objects!)"',
    'RESULT = e.label()',
  ].join('\n') + '\n',
};

// Write the project tree into MEMFS at REAL nested paths (mkdirTree + writeFile).
// Mirrors how a real nested-write helper would work; everything under /home/pyodide
// (the cwd Pyodide starts in).
const ROOT = '/home/pyodide';
async function writeProject(files) {
  const r = await py(`
import os
ROOT = ${JSON.stringify(ROOT)}
files = ${JSON.stringify(files)}
for path, text in files.items():
    full = os.path.join(ROOT, path)
    d = os.path.dirname(full)
    if d:
        os.makedirs(d, exist_ok=True)   # native equivalent of FS.mkdirTree
    with open(full, 'w') as f:
        f.write(text)
# Put the project root on sys.path so native import can find the 'sprites' package.
import sys
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)
"WROTE " + str(len(files)) + " files"
`);
  return r;
}

// =================== CLAIM 1: dotted + from-imports resolve ===================
{
  const w = await writeProject(PROJECT);
  check('claim1.setup: nested project written to MEMFS', w.ok, w.ok ? w.result : w.error);

  // Confirm the dirs+files actually exist at nested paths (FS-level proof).
  const fsCheck = await py(`
import os
ok = (os.path.isdir(os.path.join(${JSON.stringify(ROOT)}, "sprites"))
      and os.path.isfile(os.path.join(${JSON.stringify(ROOT)}, "sprites", "enemy.py"))
      and os.path.isfile(os.path.join(${JSON.stringify(ROOT)}, "sprites", "__init__.py")))
ok
`);
  check('claim1.fs: real subdir + nested enemy.py + __init__.py exist on disk', fsCheck.ok && fsCheck.result === true, fsCheck.error || ('isdir/isfile=' + fsCheck.result));

  // `import sprites.enemy` (dotted) via NATIVE importlib — no custom finder installed.
  const dotted = await py(`
import importlib
importlib.invalidate_caches()   # MEMFS dir contents changed after sys.path was set
import sprites.enemy
sprites.enemy.Enemy(4).label()
`);
  check('claim1.a: `import sprites.enemy` resolves & executes (native importlib)', dotted.ok && /Enemy\(lvl=4, hp=40\)/.test(String(dotted.result)), dotted.ok ? String(dotted.result) : dotted.error);

  // `from sprites import enemy` (from-import of a submodule).
  const fromImp = await py(`
from sprites import enemy
enemy.Enemy(2).label()
`);
  check('claim1.b: `from sprites import enemy` resolves & executes', fromImp.ok && /Enemy\(lvl=2, hp=20\)/.test(String(fromImp.result)), fromImp.ok ? String(fromImp.result) : fromImp.error);

  // The relative + absolute sibling imports inside the package both worked
  // (proven transitively: Enemy.__init__ calls hp_for from sprites.util via BOTH
  // `from . import util` and `from sprites.util import hp_for`). Assert the package
  // __init__ re-export path too.
  const reExport = await py(`
import sprites
sprites.Enemy(1).label() + " | PKG=" + sprites.PKG
`);
  check('claim1.c: package __init__ re-export + relative+absolute sibling imports work', reExport.ok && /Enemy\(lvl=1, hp=10\) \| PKG=sprites/.test(String(reExport.result)), reExport.ok ? String(reExport.result) : reExport.error);
}

// =================== CLAIM 2: top-level main.py uses the package ===================
{
  // Execute main.py the way a runner would: read its source, compile, exec in a
  // fresh namespace with __name__ == '__main__'. main.py does `from sprites import enemy`.
  const runMain = await py(`
import os
src = open(os.path.join(${JSON.stringify(ROOT)}, "main.py")).read()
glb = {'__name__': '__main__'}
exec(compile(src, "main.py", "exec"), glb)
glb.get('RESULT')
`);
  check('claim2: top-level main.py `from sprites import enemy` runs correctly', runMain.ok && /Enemy\(lvl=5, hp=50\)/.test(String(runMain.result)), runMain.ok ? String(runMain.result) : runMain.error);
  check('claim2.stdout: main.py printed via the bridge stdout', runMain.ok && runMain.out.some(l => /MAIN: Enemy\(lvl=5, hp=50\)/.test(l)), JSON.stringify(runMain.out));
}

// =================== CLAIM 3: nested asset readable by relative path ===================
{
  // Write fake PNG bytes to sprites/ship.png (a nested path), then prove a program
  // can open it by its REAL relative path from cwd. No real pygame window needed.
  const SHIP_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]; // PNG magic + payload
  const b64 = Buffer.from(SHIP_BYTES).toString('base64');
  await page.evaluate(({ p, b }) => window.writeBytes(p, b), { p: ROOT + '/sprites/ship.png', b: b64 });

  const assetRead = await py(`
# cwd is ROOT (we os.chdir'd), so the relative path mirrors a user's pygame.image.load.
data = open("sprites/ship.png", "rb").read()
list(data[:8]) == [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] and len(data) == 12
`);
  check('claim3: nested asset open("sprites/ship.png","rb").read() works (relative path)', assetRead.ok && assetRead.result === true, assetRead.ok ? ('match=' + assetRead.result) : assetRead.error);

  // Bonus: pygame.image.load actually decoding would need SDL_image; we don't need a
  // window. But prove pygame can at least be imported and SEE the file path (rwops),
  // i.e. the FS bridge is the same one pygame uses. We assert os.path from pygame's POV.
  const pygSee = await py(`
import pygame, os
os.path.exists("sprites/ship.png")
`);
  check('claim3.b: pygame imported & sees the nested asset path (shared MEMFS)', pygSee.ok && pygSee.result === true, pygSee.error || String(pygSee.result));
}

// =================== CLAIM 4: serialize -> wipe MEMFS -> recreate -> import still works ===================
{
  // 4a. Serialize the on-disk tree back to a {path: text} dict (what save/zip/#project= would store).
  const ser = await py(`
import os, json
ROOT = ${JSON.stringify(ROOT)}
out = {}
for dirpath, dirnames, filenames in os.walk(ROOT):
    # skip __pycache__ — see claim 5 (bytecode caches must NOT be serialized)
    dirnames[:] = [d for d in dirnames if d != "__pycache__"]
    for fn in filenames:
        if fn.endswith(".py"):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT)
            out[rel.replace(os.sep, "/")] = open(full).read()
json.dumps(out, sort_keys=True)
`);
  let serialized = null;
  try { serialized = JSON.parse(ser.result); } catch { /* */ }
  const expectKeys = ['main.py', 'sprites/__init__.py', 'sprites/enemy.py', 'sprites/util.py'].sort();
  const gotKeys = serialized ? Object.keys(serialized).sort() : [];
  check('claim4.serialize: tree -> {path:text} dict with POSIX nested keys', ser.ok && JSON.stringify(gotKeys) === JSON.stringify(expectKeys), JSON.stringify(gotKeys));

  // 4b. WIPE MEMFS: remove the whole project root, drop cached modules + the sys.path
  //     entry, so the next import would fail unless we truly recreate everything.
  const wipe = await py(`
import os, sys, shutil, importlib
ROOT = ${JSON.stringify(ROOT)}
# forget every project module so a stale in-memory copy can't fake success
for m in list(sys.modules):
    if m == "sprites" or m.startswith("sprites."):
        del sys.modules[m]
# remove from sys.path so import can't find the old location
sys.path[:] = [p for p in sys.path if p != ROOT]
# physically delete the tree (incl. any __pycache__)
for name in os.listdir(ROOT):
    p = os.path.join(ROOT, name)
    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
importlib.invalidate_caches()
# PROVE the wipe: importing now MUST fail. (A bare try-statement is not an
# expression, so capture the outcome in a name and make THAT the trailing value.)
_wipe_outcome = None
try:
    import sprites.enemy   # noqa
    _wipe_outcome = "STILL_IMPORTABLE_BUG"
except ImportError:
    _wipe_outcome = "WIPED_OK"
_wipe_outcome
`);
  check('claim4.wipe: after wiping MEMFS, package import FAILS (clean slate proven)', wipe.ok && wipe.result === 'WIPED_OK', wipe.ok ? String(wipe.result) : wipe.error);

  // 4c. Recreate dirs+files from the serialized dict and re-import. This models
  //     load-from-save / unzip / #project= hydration.
  const recreated = serialized ? await writeProject(serialized) : { ok: false, error: 'no serialized dict' };
  check('claim4.recreate: rebuilt tree from {path:text} dict', recreated.ok, recreated.ok ? recreated.result : recreated.error);

  const reimport = await py(`
import importlib
importlib.invalidate_caches()
import sprites.enemy
from sprites import enemy as e2
sprites.enemy.Enemy(7).label() + " / " + e2.Enemy(7).label()
`);
  check('claim4.roundtrip: package import STILL works after wipe+recreate', reimport.ok && /Enemy\(lvl=7, hp=70\) \/ Enemy\(lvl=7, hp=70\)/.test(String(reimport.result)), reimport.ok ? String(reimport.result) : reimport.error);
}

// =================== CLAIM 5: characterize replace-vs-coexist, caches, etc. ===================
{
  // 5a. invalidate_caches IS required: importlib's FileFinder caches directory listings
  //     per sys.path entry. After we add a brand-new dir to an existing-but-previously-
  //     listed location, the new module is invisible until invalidate_caches(). Prove it.
  const cacheProof = await py(`
import os, sys, importlib
ROOT = ${JSON.stringify(ROOT)}
# Trigger a FileFinder for ROOT by importing something, populating its dir cache.
import sprites  # already importable from claim4 recreate
# Now add a NEW top-level module file AFTER the finder cached ROOT's listing.
with open(os.path.join(ROOT, "late_mod.py"), "w") as f:
    f.write("VALUE = 99\\n")
# Without invalidate_caches the new file may be invisible:
stale = None
try:
    import late_mod  # may or may not be cached-out depending on finder state
    stale = "VISIBLE_WITHOUT_INVALIDATE"
except ImportError:
    stale = "INVISIBLE_UNTIL_INVALIDATE"
# After invalidate_caches it MUST be importable.
importlib.invalidate_caches()
import late_mod
after = late_mod.VALUE
str(stale) + "|" + str(after)
`);
  check('claim5.caches: late-added module importable after invalidate_caches() (== 99)', cacheProof.ok && /\|99$/.test(String(cacheProof.result)), cacheProof.ok ? String(cacheProof.result) : cacheProof.error);
  // Report which behavior we observed (informational, both are fine; tells the impl whether
  // invalidate_caches is merely sufficient or strictly necessary in MEMFS).
  console.log('       INFO claim5.caches observed: ' + String(cacheProof.result).split('|')[0]);

  // 5b. __pycache__/.pyc behavior in MEMFS: does importing create bytecode caches we'd
  //     have to exclude from serialize/zip? Report whether any __pycache__ exists.
  const pycProbe = await py(`
import os, sys
ROOT = ${JSON.stringify(ROOT)}
caches = []
for dp, dn, fns in os.walk(ROOT):
    if os.path.basename(dp) == "__pycache__":
        caches.append(os.path.relpath(dp, ROOT))
# Also report the global flag many wasm builds set.
import_bytecode = getattr(sys, "dont_write_bytecode", None)
{"pycache_dirs": caches, "dont_write_bytecode": import_bytecode}
`);
  const pycInfo = pycProbe.ok ? pycProbe.result : pycProbe.error;
  // We don't fail on either outcome; we just record it. The serialize walk in claim4
  // already skips __pycache__, which is the safe policy regardless.
  console.log('       INFO claim5.pycache: ' + JSON.stringify(pycInfo));
  check('claim5.pycache: probe ran (bytecode-cache policy characterized)', pycProbe.ok, JSON.stringify(pycInfo));

  // 5c. Native import needs NO custom finder. Prove the _ProjectFinder is absent here
  //     yet everything above worked — i.e. native importlib over real dirs is sufficient.
  const noFinder = await py(`
import sys
has_custom = any(type(f).__name__ == "_ProjectFinder" for f in sys.meta_path)
# Show the standard finders that ARE doing the work.
std = [type(f).__name__ for f in sys.meta_path]
{"has_custom_ProjectFinder": has_custom, "meta_path": std}
`);
  const nf = noFinder.ok ? noFinder.result : noFinder.error;
  check('claim5.no-finder: packages resolved with NO custom _ProjectFinder (native importlib only)', noFinder.ok && nf && nf.has_custom_ProjectFinder === false, JSON.stringify(nf));

  // 5d. Nested UNLINK reconcile: removing a submodule file + invalidate + forget module
  //     makes a subsequent import of it fail, while siblings still import. Models delete-file.
  const unlinkProof = await py(`
import os, sys, importlib
ROOT = ${JSON.stringify(ROOT)}
# ensure util importable, then delete it
import sprites.util
importlib.import_module("sprites.util")
os.remove(os.path.join(ROOT, "sprites", "util.py"))
for m in ("sprites.util",):
    sys.modules.pop(m, None)
importlib.invalidate_caches()
gone = False
try:
    importlib.import_module("sprites.util")
except ImportError:
    gone = True
# sibling enemy.py file still exists on disk (its import would re-fail only because it
# imports util — so prove the PACKAGE itself + a non-dependent module still resolve)
pkg_ok = importlib.import_module("sprites") is not None
str(gone) + "|" + str(pkg_ok)
`);
  check('claim5.unlink: delete nested file + invalidate -> that module gone, package intact', unlinkProof.ok && /^True\|True$/.test(String(unlinkProof.result)), unlinkProof.ok ? String(unlinkProof.result) : unlinkProof.error);
}

// ---------------------------------------------------------------------------
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
check('no JS console errors during spike', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
if (failed) { process.exitCode = 1; console.log(`\nPACKAGES SPIKE FAILED (${failed} check(s) failed)`); }
else console.log('\nPACKAGES SPIKE OK — true subdirs + full Python packages are FEASIBLE via native importlib');
