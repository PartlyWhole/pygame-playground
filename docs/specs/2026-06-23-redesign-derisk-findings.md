# Redesign de-risk spikes — findings (2026-06-23, all GREEN)

Three spikes were run BEFORE any feature code, to retire the redesign's engine risks. **All three pass
and were independently re-verified.** Spike files live under `test/` as living references (run on demand;
they are NOT part of the 6 batteries). This doc condenses the actionable build guidance per slice; the full
agent reports are in the session transcripts.

---

## 1. Package imports / true subdirectories — `test/spike-packages.{html,mjs}` — GREEN (18/18)
**Verdict: FEASIBLE via NATIVE `importlib`. No custom finder needed.**

Proven: with the project root on `sys.path` and real nested dirs, `import sprites.enemy`,
`from sprites import enemy`, package `__init__` re-export, and relative+absolute intra-package imports all
resolve with **zero** custom finder (`has_custom_ProjectFinder: false`). Nested assets read by relative path
after `os.chdir(root)`. Full `serialize → wipe → recreate` round-trip works (models save/reload + zip +
`#project=`). No `__pycache__` (Pyodide sets `sys.dont_write_bytecode = True`).

**The one real subtlety for S2:** native loaders will NOT apply the cooperative `_transform_module`
(`__yield__`/asyncify) to imported modules. v1 is fine (imported modules rarely contain a blocking
`while True`; the *entry* module is still transformed). If the transform is needed everywhere, install a
`MetaPathFinder` that delegates `find_spec` to `importlib.machinery.PathFinder` (keeps native dotted/package
resolution) and wraps the returned loader's `exec_module` to run the transform — this *augments* resolution,
it does not reimplement it.

**Recommended (S2):**
- **Replace** `_ProjectFinder`/`_ProjectLoader`/`_install_finder` (index.html:910-930) with native importlib +
  the project root on `sys.path`; preserve the cooperative transform via the optional `MetaPathFinder` wrapper.
- `_run_project` writes (942-958): honor the real relpath — `mkdirTree(dirname)` + `writeFile`; track written
  paths in `_PROJECT_PATHS`; prune now-empty dirs on reconcile; pop **dotted** names from `sys.modules`.
- **`importlib.invalidate_caches()` is MANDATORY** after any nested write/unlink (`FileFinder` caches dir
  listings). The engine already calls it (961/1008) — keep it.
- `__init__.py`: auto-create an **empty** one in any folder containing `.py` files; don't surface it as a
  user-editable file unless it gets content.
- One `writePath(relpath, bytes)` helper (`mkdirTree` + `writeFile`) for ALL code+asset writes; unlink the
  real path + invalidate caches.
- `serialize`/`load` keys → relative POSIX paths (`sprites/enemy.py`).
- `isModuleName` → a path validator, e.g. `^([A-Za-z_]\w*/)*[A-Za-z_]\w*\.py$`; reject `..`, leading `/`,
  empty segments.
- `#project=` keys gain slashes (encodeURIComponent-safe); zip is free (`zip.file("sprites/enemy.py", text)`
  makes folders); keep the `asset_` clash prefix, now applied **per directory**.
- The flat single-file engine coexists (a bare name is just a path with no `/`); extend `_purge_project_files`
  to remove nested dirs when dropping back to single-file mode.

---

## 2. Pause / Resume — `test/spike-pause.{html,mjs}` — GREEN (both run flavors)
**Verdict: gating `__yield__` on a paused `asyncio.Event` works.** Suspend-at-next-frame (frame frozen,
canvas pixel stable), task stays alive (pause ≠ stop), resume continues from the exact paused state. One
gate covers BOTH single-file and project loops (they share `__yield__`).

**Gotcha:** pause granularity is per-cooperative-frame — a pure-compute loop only yields every 256 iters; a
frame-paced loop pauses within one frame; a no-loop program never yields (but finishes instantly, so nothing
to pause). Create the gate **already-set** so the unpaused path is a cheap no-op.

**Recommended (S3):**
- Python (BOOT_PY, near `_state`@566 / `__yield__`@619): add `_pause_gate = asyncio.Event(); _pause_gate.set()`
  and `_state['paused'] = False`; make the **first line** of `__yield__` be `await _pause_gate.wait()`; add
  `_pause()`/`_resume()` (clear/set the gate + flip the flag; `_pause()` guards on a live task). Defensive:
  `_pause_gate.set(); _state['paused']=False` in `_start`(759) and `_start_project`(989); `_pause_gate.set()`
  in `_stop`(765) after `t.cancel()`.
- JS/DOM: new **additive** id `#pauseBtn` (Pause⇄Resume toggle on the stage, next to End=`#stopBtn`);
  Start=`#runBtn` unchanged. `setStatus('paused')` using `--warn` (#f0a45d). The `'paused'` token is additive —
  no battery breaks (they gate exact strings; this adds a new value).
- Re-run guard: a paused task is alive (`not done()`), so any "block Start while running" guard already keeps
  Start blocked while paused — intended (resume or End first).

---

## 3. Multi-file collab with folder paths — `test/spike-collab-paths.mjs` — GREEN (23/23 live, 24/24 offline)
**Verdict: folder paths add ZERO CRDT risk beyond the flat case — ONCE KEYS ARE ENCODED.**

**HEADLINE BLOCKER (why this spike existed):** the Automerge bundle's `updateText` **splits its path
argument on `/`**, so a raw `sprites/enemy.py` key throws on `updateText` (`path component referenced a
nonexistent object`). Assignment/read/`delete`/`order`/`entry` are all fine with raw keys — only `updateText`
breaks.

**FIX (proven green):** store files under `encodeURIComponent(path)` keys (`sprites/enemy.py` →
`sprites%2Fenemy.py`); decode for display. `order` and `entry` hold encoded keys too; the UI decodes.

**Other gotchas:** `updateText` cannot create a new map key — add-file is a plain assignment first, then
`updateText` for edits; canonicalize (sort) `files` keys before any cross-peer equality check (Automerge maps
are unordered); `order` is a positional list (compare as-is).

**Recommended (S6):**
- Doc shape stays `{ files, order, entry }` with **keys = `encodeURIComponent(path)`**. Add a thin boundary
  layer: `encodeProject(project.serialize())` on seed; `project.load(decodeProject(docToRecord(doc)))` on
  adopt — total inverses. The local model + UI keep human paths; only the shared doc carries encoded keys.
- Per-file edit: `handle.change(d => updateText(d, ['files', encodeURIComponent(activePath)], next))` — never
  a raw path.
- Rename/move = one `handle.change()` transaction: copy old→`encodeURIComponent(new)`, delete old, rewrite
  `order`, fix `entry` if it was the old key. Copy-and-delete loses that file's char history + in-flight
  keystrokes on the old name — accept and document.
- Per-file presence: cursor gains a `file` field = encoded active path; `renderPeers` filters to peers on the
  current file; repaint on file switch.
- The two **L** items — `bindEditor` multi-file reconciliation (1870-1895) and structural ops to
  `handle.change()` (1524-1558) — remain the real cost and still need two-peer browser tests. The
  encode/decode boundary is only an **S** addition.

---

## What this unblocks
S2 (subdirs + packages engine), S3 (split run model), and S6 (multi-file collab room) are all de-risked and
can proceed to design → plan → TDD. The hardest unknowns (native package imports; suspendable cooperative
loop; path-keyed CRDT) are retired with concrete, proven implementation recipes above.
