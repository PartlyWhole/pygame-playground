# S2 — True subdirectories + full Python packages + the explorer folder tree (design only)

> **Slice S2 of the pygame-playground redesign.** Design document — **no implementation,
> no code changes, no commit.** Produced 2026-06-23. Drives a **test-first** implementation;
> precision is the point.
>
> **Sources of truth, in priority order:**
> 1. `docs/specs/2026-06-23-redesign-derisk-findings.md` **§1** — the package-imports spike's
>    VERIFIED recipe (native importlib over MEMFS; replace `_ProjectFinder`; optional
>    `MetaPathFinder` wrapper to keep the cooperative transform; `__init__.py` auto-create; one
>    `writePath` helper; `invalidate_caches()`; path validator; serialize/load + `#project=` + zip
>    keys; flat-engine coexistence). **THIS IS THE CORE — S2 is designed to it.**
> 2. `test/spike-packages.{html,mjs}` — the proven approach in runnable code (18/18 GREEN).
> 3. `docs/specs/2026-06-23-redesign-architecture-map.md` — the seam inventory + line refs.
> 4. `docs/specs/2026-06-23-shell-restyle-design.md` — **S1**: the explorer is currently a FLAT
>    always-on list (`#tabs` with `.tab[data-name]`/`.active`/`.entry` rows). S2 extends those
>    exact seams to a nested tree.
> 5. `proto/sandbox.html` — the folder-tree UI the team shaped (carets, create/rename/delete,
>    drag-reorder + move-into-folder with descendant-guard, per-row download). Its tree is a
>    **mock node model** — S2 adopts its *interaction + chrome*, not its node objects.
> 6. `docs/specs/2026-06-22-multi-file-design.md` + `docs/specs/2026-06-22-assets-sprites-sound-design.md`
>    — the CURRENT flat model S2 changes.
> 7. `docs/specs/2026-06-23-redesign-decision-context-map.md` — the locked verdicts + the
>    `setValue`/lint-arm + lazy-load landmines.
> 8. `index.html` — the live engine. **All line refs below were re-confirmed on 2026-06-23**
>    against the current (post-S1) file, which has grown well past the architecture-map's numbers.

---

## 0.1 Orchestrator resolutions (settles §9 — READ FIRST; binding for implementation)

- **Q1 — Upload INTO selected folder → DEFER to S5 (upload-routing).** S2 makes nested asset *writes*
  work (the mechanism, for load/zip hydration) but the default add target stays ROOT.
- **Q2 — Assets in the tree → assets render as nested `.tab.asset[data-name=path]` rows AND
  `#assetPanel`/`.asset-row[data-name]`/`#assetChip`/`#apStorage` stay as a compat/summary container**
  (lowest `assets.mjs` churn; `renderAssetPanel` keys rows by path).
- **Q3 — Auto-`__init__.py` → INVISIBLE-UNTIL-CONTENT** (tracked in a model set; written to MEMFS +
  serialize + zip, filtered out of `renderTabs` while empty).
- **Q4 — Per-row download → OMIT in S2** (do NOT render a `.dl` button at all). S5 adds the affordance
  and wires both project-always-zip and per-item download together (same machinery; avoids a dead
  button and pulling `save.mjs` reconciliation into S2).
- **Q5 — Folder names → enforce `isFolderSegment` (Python-identifier-safe) for ALL folders at creation**
  (letters/digits/underscore, no leading digit; reject spaces/dots/`/`). Simplest; never need to rename
  when a `.py` arrives.
- **Q6 — MetaPathFinder transform-wrapper → IN-SCOPE-REQUIRED.** It holds `multifile.mjs` checks 2/3
  (imported cooperative loop) green. If it cannot be made robust, **STOP and escalate to the
  orchestrator — do NOT relax checks 2/3.** §7.1 #5/#6 gate it.
- **Q7 + risks 7/9 — defensively skip `__pycache__`** in serialize/zip/prune; the asset hydrate loop
  uses `writePath`/`mkdirTree` per record (paths with slashes in `assetStore` are fine).

### Execution split (two sub-slices, each test-first → two-stage review → green checkpoint)
This slice is implemented in two ordered sub-slices so the high-risk engine is green before the UI:

- **S2a — ENGINE** (this is the de-risked-but-delicate core). Scope: native `importlib` + the
  `MetaPathFinder` wrapper (§2.2); `writePath`; nested `_run_project` writes + dotted `sys.modules` pop
  + empty-dir prune + `invalidate_caches`; flat-engine coexistence; `isModuleName` path validator (§3);
  JS `project` path keys + new `move`; `serialize`/`load`/`#project=`/zip/localStorage path keys +
  additive `emptyDirs`; `assetFS` nested-write *mechanism*. Validated by a NEW `test/subdirs.mjs`
  driven PROGRAMMATICALLY via `window.project` + `run()` (engine assertions from §7.1: #2,3,4,5,6,7,11,
  12,13,14,16 + model-level move/rename/remove + `emptyDirs` serialize/load round-trip). No tree-DOM
  dependency.
- **S2b — TREE UI** (built on the green engine). Scope: `renderTabs` nested tree (§5.2); folder
  create/rename/delete behind the shared confirm (§5.4); drag-reorder + move-into-folder + descendant
  guard (§5.5); `#newFolderBtn` enabled; assets nested in the tree (§5.6, per Q2). Validated by a NEW
  `test/explorer-tree.mjs` (§7.1: #1, the UI side of #8/#9, #10, the render side of #15, assets-in-tree)
  PLUS the one lockstep tightening `multifile.mjs:282` (`#tabs .tab` → `#tabs .tab[data-name]`).

Guardrails (green throughout BOTH sub-slices, no edits): `verify.mjs`, the 6 batteries, `spike-viewer`,
`spike-runstop`. `test/shell.mjs` must also stay green (S1 seams preserved).

---

## 0. Verified seam map (current line numbers — the architecture-map's are stale post-S1)

These are the real symbols S2 touches, re-read on 2026-06-23:

| Symbol | Location (now) | What it is |
|---|---|---|
| `BOOT_PY` (single-file engine) | `index.html:807` | flat engine; `_start`/`_run`; `__yield__` @865 |
| `PROJECT_PY` (multi-file engine) | `index.html:1026` | the engine S2 rewrites |
| `_transform_module(src, filename)` | `1138` | cooperative transform for imported modules |
| `_PROJECT_FILES` (stem→abs path) / `_PROJECT_PATHS` (abs paths) | `1152`/`1153` | reconcile state |
| `_ProjectLoader` (`exec_module` runs `_transform_module`) | `1156` | **replaced/wrapped** in S2 |
| `_ProjectFinder.find_spec` (matches **bare stem** in `_PROJECT_FILES`) | `1168` | **replaced** in S2 |
| `_install_finder` | `1174` | **replaced** in S2 |
| `_transform_entry` (keeps top-level-await flag) | `1178` | unchanged |
| `_run_project(files, entry)` (writes flat `os.path.join(cwd, fname)`) | `1188` | **rewritten** for nested writes |
| `_start_project` | `1235` | unchanged surface |
| `_purge_project_files` | `1241` | extended to prune nested dirs |
| `isModuleName = /^[A-Za-z_][A-Za-z0-9_]*\.py$/` | `1321` | **becomes a path validator** |
| JS `project` model (`files`/`order`/`entry`/`active`; `serialize`/`load`/`add`/`rename`/`remove`/`setEntry`/`setActive`) | `1323`–`1368` | keys become paths; add `move` |
| `deserializeProject` / `projectFromHash` / `savedProject` | `1417`/`1429`/`1435` | path-tolerant |
| `assetFS` (`_memfs`/`_unlink`/`add`/`remove`/`hydrateAll`) | `1520` | nested writes via shared helper |
| `renderAssets` / `renderAssetPanel` (`.asset-row[data-name]`) | `1558`/`1598` | path-aware |
| `renderTabs` (S1 flat explorer; `.tab[data-name]`, `.active`, `.entry`, `.tab-add`) | `1844` | **becomes the nested tree** |
| `renderViewer` (type-aware viewer; one-CM swapDoc rule) | `1786` | unchanged logic; reads by path |
| `newFilePrompt` / `tabMenu` | `1873`/`1882` | path-aware; folder ops added |
| explorer click delegate (`#tabs` listener) | `1862` | extended for carets / DnD |
| `loadInitialProject` / `flushSave` / `__flushSave` | `1914`/`1929`/`1938` | path round-trip |
| `saveProject` (zip block; `asset_` clash) | `2013` | folders free; clash per-directory |
| `run()` dispatch (`_purge_project_files` on solo path) | `2264` | unchanged |
| boot Python concat (`BOOT_PY` then `PROJECT_PY`) | `2252`–`2253` | unchanged |
| `#newFolderBtn` (present, `hidden`) | DOM `330` | **un-hidden + wired** |
| Explorer header (`#shareBtn`/`#uploadBtn`/`#saveBtn`/`#newFileBtn`/`#newFolderBtn`) | DOM `326`–`330` | header unchanged except enabling `#newFolderBtn` |
| `#tabs` container + `#assetSection`/`#assetChip`/`#assetPanel`/`#assetInput` | DOM `334`–`340` | container kept; tree renders into `#tabs` |

> Today `_ProjectFinder.find_spec` matches **bare stems only** (`1170`: `if fullname in
> _PROJECT_FILES`), `_run_project` writes **flat** (`1194`: `os.path.join(cwd, fname)` with bare
> `fname`), and `isModuleName` (`1321`) **forbids `/`**. These three are exactly what S2 removes.

---

## 1. Scope & non-goals

### 1.1 What S2 IS

S2 turns the flat project namespace into **real nested paths**, makes the Python engine resolve
**true packages** (dotted imports, `__init__.py`, relative + absolute intra-package imports), and
turns the S1 flat explorer into a **real nested folder tree** (create / rename / delete folders;
drag-reorder + move-into-folder with the descendant guard). Nested assets load by relative path.
Persistence (localStorage `PROJECT_KEY`, `#project=`, the save zip) carries POSIX path keys.

S2 delivers:

1. **Engine (Python):** native `importlib` with the project root on `sys.path`, replacing the
   bare-stem `_ProjectFinder`/`_ProjectLoader`/`_install_finder`; the cooperative transform
   preserved via an **optional `MetaPathFinder` wrapper** (§2.4); `__init__.py` auto-creation; one
   `writePath` helper for every code+asset write; `invalidate_caches()` after every write/unlink;
   nested unlink + empty-dir prune + dotted-`sys.modules` pop; coexistence with the flat `BOOT_PY`
   single-file engine.
2. **Validation:** `isModuleName` → a relative-POSIX-path validator
   (`^([A-Za-z_]\w*/)*[A-Za-z_]\w*\.py$`); asset path rules.
3. **JS project model + persistence:** keys become relative POSIX paths;
   `add/rename/move/setActive/order` operate on paths; `serialize()` → `{path:text}`; `load()`
   recreates dirs; `#project=` (slashes are `encodeURIComponent`-safe); the zip gets folders for
   free; `asset_` clash handling now **per-directory**.
4. **Explorer folder tree:** `renderTabs` renders a real **nested** tree; folder
   create/rename/delete; drag-reorder + move-into-folder with the descendant guard; `#newFolderBtn`
   enabled — all on the preserved `.tab[data-name]` (now `data-name` carries a PATH), `.active`,
   `.entry`, `renderTabs` hook, and the **swapDoc/setActive (never `setValue`)** open rule.
5. **Assets in folders:** `assetFS` writes nested paths through the shared `writePath`; loads by
   relative path; the viewer/asset selectors preserved.

### 1.2 Explicit non-goals (and which slice owns them)

| Deferred | Slice | S2's obligation |
|---|---|---|
| **Multi-file COLLAB path-keying** (per-file CRDT carrying folder paths) | **S6** | S2's `serialize()`/`load()` must be **forward-compatible**: S6 adds a thin `encodeProject`/`decodeProject` boundary that stores file keys as `encodeURIComponent(path)` (the de-risk §3 headline: Automerge's `updateText` splits its path arg on `/`, so the **shared doc** must hold encoded keys). **S2 keeps human POSIX paths in the local model + `#project=` + zip + localStorage; it does NOT encode** — encoding is purely S6's CRDT-boundary concern. S2 must not bake `%2F` into any local format. (See §4.5.) |
| **Always-zip Download + per-item bare download** | **S5** | The proto tree shows a **per-row download (`.dl`) affordance**. **Recommendation: S2 STUBS the per-row download** (render the `.dl` button + an inert/`toast`-style no-op handler, or omit it entirely behind a flag), and **S5 wires it** to the real zip/`downloadBlob`. Rationale below. The project-level Download (`#saveBtn` → `saveProject`) stays the existing 2-branch behavior in S2; always-zip is S5. |
| **Upload routing by extension into the selected folder + `.zip` restore** | **S5b / upload-routing** | S2 keeps the existing upload paths (`#assetInput` → `assetFS.add`; drop-anywhere). Routing `.py`→`project.add`, warn/auto-suffix, and "upload into the selected folder" ride the upload-routing slice. S2 only makes `assetFS.add` capable of nested paths (so the *mechanism* exists); the **default** add target stays the project root unless the orchestrator pulls "upload into selected folder" into S2 (open question §9). |
| **Rename rewrites imports** | never (warn-only verdict) | `project.rename`/`move` keep the existing **warn-don't-rewrite** inline note. A move that changes a module's dotted path is a rename for import purposes — same warning. |
| **Split run model / Pause** | **S3** | untouched. |
| **Editable examples** | **S4** | untouched (legacy `#examples` select seam preserved). |

**Why per-row download is S5, not S2 (recommended):** (a) The proto's `.dl` is an explicit **mock**
(`downloadItem` at `proto/sandbox.html:702` says "*prototype mock — a real build would JSZip…*").
(b) A real per-item download is the **same machinery** as always-zip: a single `.py` → `downloadBlob`,
a folder → a JSZip of its subtree — which is exactly the always-zip-save verdict (option B:
"always-zip project Download + a per-item bare single-file download"). Splitting that machinery across
two slices duplicates the zip-subtree logic and the `save.mjs` reconciliation. (c) S2's risk budget is
already the engine rewrite + the tree DnD; bolting download semantics on multiplies the test surface.
**So S2 renders the affordance inert (or omits it) and S5 implements both project-zip-always and the
per-row download together.** If the orchestrator wants per-item download in S2, it is a contained
add (§9 Q4) — but it pulls forward the `save.mjs` reconciliation.

### 1.3 Bounding principle

If a change touches the CRDT doc shape, the Automerge `updateText` boundary, the save-branch logic /
`save.mjs` assertions, or example-promote semantics, it is **not S2**. S2 changes: the `PROJECT_PY`
engine, `isModuleName`, the JS `project` keys + a new `move`, `assetFS` nested writes, the
`renderTabs` tree + its DnD, and the three local persistence formats' **path keys** — and nothing a
collab room or the save-branch reads differently.

---

## 2. Engine (Python) — straight from de-risk-findings §1

The spike proved (18/18) that **native importlib over real MEMFS subdirectories on `sys.path`
needs NO custom finder** (`has_custom_ProjectFinder: false`). S2 replaces the bare-stem custom
finder with that native path, and re-adds the **only** thing native loaders drop — the cooperative
transform on imported modules — via an *augmenting* `MetaPathFinder` wrapper.

### 2.1 Replace `_ProjectFinder`/`_ProjectLoader`/`_install_finder` with native importlib

- **Put the project root on `sys.path`.** cwd is `/home/pyodide`; the spike uses
  `ROOT = os.getcwd()` and `sys.path.insert(0, ROOT)` + `os.chdir(ROOT)`. The current engine
  already inserts `''` (`1210`); S2 inserts the **absolute** ROOT (so nested asset `open()` and
  dotted import both resolve from one anchor) and keeps `''` for back-compat. Idempotent: only
  insert if absent.
- **Delete** the bare-stem `_ProjectFinder` (`1168`), its `find_spec` (`1170`, `fullname in
  _PROJECT_FILES`), and `_install_finder` (`1174`). They cannot resolve `sprites.enemy` or the
  `sprites` package and are wholly superseded.
- `_PROJECT_FILES` changes meaning from `stem→abspath` to **`relpath→abspath`** (or is dropped in
  favor of `_PROJECT_PATHS` — see §2.5); the finder no longer reads it.

### 2.2 PRESERVE the cooperative transform via a MetaPathFinder wrapper (§1's "one real subtlety")

Native loaders will NOT run `_transform_module` on imported modules, so an imported module with a
blocking `while True` would freeze. The de-risk verdict: **v1 is fine without it** (imported
modules rarely contain a blocking loop; the *entry* is still transformed via `_transform_entry`).
But the existing engine DOES transform imported modules (`_ProjectLoader.exec_module` →
`_transform_module`, `1161`–`1166`) and `multifile.mjs` checks 2/3 assert an **imported cooperative
loop** runs without freezing. **To not regress that, S2 must keep the transform.** The de-risk recipe:

> Install a `MetaPathFinder` whose `find_spec` **delegates to
> `importlib.machinery.PathFinder.find_spec(fullname, path, target)`** (keeps native dotted/package
> resolution — packages, `__init__.py`, relative imports, all free), then **wraps the returned
> spec's loader** so its `exec_module` runs `_transform_module` on the source before exec. This
> *augments* native resolution; it does not reimplement it.

Concrete shape (design intent, not final code):

```
class _CoopPathFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
        if spec is None or spec.origin is None:
            return None
        # Only wrap PROJECT source files under ROOT (never stdlib / pygame / site-packages).
        if not _is_project_origin(spec.origin):   # spec.origin startswith ROOT and endswith .py
            return None                            # let the default finder handle it
        spec.loader = _CoopLoader(spec.loader, spec.origin)
        return spec

class _CoopLoader(importlib.abc.Loader):
    def __init__(self, inner, origin): self.inner, self.origin = inner, origin
    def create_module(self, spec): return None      # default module creation
    def exec_module(self, module):
        with open(self.origin) as f: src = f.read()
        code = _transform_module(src, self.origin)
        module.__dict__.update(_MOD_HELPERS)        # __yield__/__sleep__/__maybe_await__ (1154)
        exec(code, module.__dict__)
```

- **`_is_project_origin` gate is load-bearing:** only project `.py` files under ROOT are wrapped;
  stdlib, `pygame`, and `site-packages` modules go through the unmodified `PathFinder` (returning
  `None` from our finder lets the next finder claim them). This keeps the transform exactly as
  narrow as today's `_ProjectFinder` (which only matched project names).
- **`__init__.py` is a project file** — it goes through the wrapper too. `_transform_module` runs
  `_check_loop_placement`; an empty/auto-created `__init__.py` is a no-op transform. (A user who
  puts a blocking loop in `__init__.py` gets the friendly placement error — acceptable.)
- **Install at index 0 of `sys.meta_path`** (mirroring today's `_install_finder`), idempotent
  (don't double-insert). `PathFinder` already lives on `sys.meta_path`; our wrapper sits in front,
  delegates to it, and only claims project files — so removing it (or not installing it) degrades
  gracefully to plain native import (the de-risk "v1 is fine" fallback).

> **Risk (called out in §9):** the wrap-the-returned-loader step is the subtlest part of S2.
> `spec.loader` from `PathFinder` is a `SourceFileLoader`; replacing `exec_module` while keeping
> `create_module=None` is the spike-blessed shape. The TDD plan (§7) pins an imported cooperative
> loop running without freeze AND a stdlib import (e.g. `import json` inside a module) still working
> — proving the gate doesn't over-claim.

### 2.3 `__init__.py` auto-creation policy

Per §1: **auto-create an empty `__init__.py` in any folder that contains `.py` files** (so the
folder is an importable package — `import sprites.enemy` needs `sprites/__init__.py`, as the spike's
`PROJECT` includes). Policy:

- On write/reconcile, for every directory that ends up containing ≥1 `.py` file, ensure an empty
  `__init__.py` exists on disk if the project model doesn't already carry one.
- **Do NOT surface an auto-created empty `__init__.py` as a user-editable tree row** unless it has
  content. If the user opens/edits it (or it arrives with content via load), it becomes a normal
  visible file. (Mirrors how IDEs hide empty package markers; keeps the tree clean.) The model can
  track auto-created markers in a set so they're written to MEMFS + included in serialize/zip but
  filtered out of `renderTabs` while empty.
- **Folders with only assets (no `.py`) get NO `__init__.py`** — a `sounds/` folder of WAVs is not
  a package.

> **Open question (§9 Q3):** whether the auto-`__init__.py` is (a) invisible-until-content (model
> set, recommended) or (b) a visible greyed row. Recommend (a).

### 2.4 One `writePath(relpath, bytes)` helper for ALL code + asset writes

A single Python helper (in `PROJECT_PY`) does `mkdirTree(dirname(relpath))` + `writeFile(relpath,
bytes)` relative to ROOT. The spike's `writeProject` is the proven shape (`os.makedirs(d,
exist_ok=True)` then `open(full,'w')`). Requirements:

- **Used by BOTH** `_run_project`'s code writes (replacing the flat `os.path.join(cwd, fname)` at
  `1194`) **and** the JS asset path (via a JS-side equivalent — see §6). One helper = one place that
  creates dirs, so code and assets can never disagree about directory creation.
- After any write it is the caller's job to call `importlib.invalidate_caches()` (batched once per
  reconcile, not per file — see §2.6).
- The JS side has its own thin `writePath` equivalent on top of `pyodide.FS.mkdirTree` +
  `pyodide.FS.writeFile` (assets are written from JS at upload time, before any run). **Both** the
  Python `writePath` and the JS `assetFS._memfs` must `mkdirTree` first. Name them the same
  (`writePath`) on each side so the design intent reads through.

### 2.5 `_run_project` rewrite: honor real relpaths, reconcile nested

Replace the flat write loop (`1188`–`1204`) with:

```
async def _run_project(files, entry):
    ROOT = os.getcwd()
    if ROOT not in sys.path: sys.path.insert(0, ROOT)
    new_paths = set()
    for relpath, msrc in files.items():
        writePath(relpath, msrc)                         # mkdirTree + write under ROOT
        new_paths.add(os.path.join(ROOT, relpath))
    _ensure_init_py(new_paths)                           # §2.3: empty __init__.py per .py-bearing dir
    # unlink files dropped since last run, then prune now-empty dirs
    for old in _PROJECT_PATHS - new_paths:
        if os.path.exists(old): os.unlink(old)
    _prune_empty_dirs(ROOT, new_paths)
    _PROJECT_PATHS = new_paths
    importlib.invalidate_caches()                        # MANDATORY after nested write/unlink
    for relpath in files:                                # pop DOTTED module names
        for dotted in _dotted_names_for(relpath): sys.modules.pop(dotted, None)
    _install_coop_finder()                               # §2.2 wrapper, idempotent
    # ... entry transform/eval unchanged (1213-1233) ...
```

- **Dotted `sys.modules` pop** (§1): a file `sprites/enemy.py` is the module `sprites.enemy`; an
  edit must drop `sprites.enemy` AND can drop `sprites` (the package object caches its submodules).
  `_dotted_names_for("sprites/enemy.py")` → `["sprites.enemy", "sprites"]` (strip `.py`, replace
  `/`→`.`, plus each ancestor package). Conservative: pop the module and every ancestor package so a
  re-run re-execs edited code. (The spike's wipe pops `m == "sprites" or m.startswith("sprites.")`.)
- **Prune empty dirs:** after unlinking dropped files, remove directories under ROOT that no longer
  contain any project file (walk bottom-up; never remove ROOT itself; never touch `__pycache__` —
  but Pyodide sets `sys.dont_write_bytecode = True`, so none exists; still skip defensively).
- **`invalidate_caches()` is MANDATORY** (spike claim 5a): `FileFinder` caches directory listings
  per `sys.path` entry; a newly-created subdir/module is invisible until invalidation. The engine
  already calls it (`1207`/`1254`) — keep it, call it after the write/unlink batch and after prune.

### 2.6 Coexistence with the flat single-file `BOOT_PY` engine

- A **bare name with no `/`** is just a path of depth 1 — `isModuleName("main.py")` still passes, and
  `writePath("main.py", …)` is `mkdirTree("") + writeFile`. So the flat case is the nested case with
  zero directories; no special path.
- The single-file dispatch in `run()` (`2271`–`2275`) is unchanged: `collab.active ||
  !project.isMulti()` → `_start(editor.getValue())` after `_purge_project_files()`. The flat engine
  (`BOOT_PY`) is untouched.
- **`_purge_project_files` (`1241`) is extended** to prune nested dirs: today it unlinks tracked
  paths + pops stems + invalidates. S2 makes it (a) unlink every `_PROJECT_PATHS` entry, (b) pop
  **dotted** names, (c) `_prune_empty_dirs(ROOT)`, (d) `invalidate_caches()`. This is what lets a
  project with `sprites/` drop cleanly back to a single flat `.py` (de-risk claim 4 wipe + the
  "extend `_purge_project_files` to remove nested dirs" instruction).

---

## 3. Validation

### 3.1 `isModuleName` → relative-POSIX-path validator

Replace `index.html:1321` `/^[A-Za-z_][A-Za-z0-9_]*\.py$/` with the de-risk §1 regex:

```
const isModuleName = (name) =>
  /^([A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(name);
```

Plus explicit rejections (regex covers most, but assert them in tests for clarity and to reject
sneaky inputs the regex alone might admit via odd encodings):

- reject `..` anywhere (no parent traversal) — the regex's segment shape already forbids it (`..`
  is not `[A-Za-z_]\w*`), but a defensive `name.split('/').includes('..')` check is cheap and
  test-pinned.
- reject a **leading `/`** (absolute) — regex requires the first char to start a valid segment.
- reject **empty segments** (`a//b.py`, trailing `/`) — regex forbids `//` and requires a `.py`
  leaf.
- reject a bare folder (`sprites/` with no leaf) as a *file* name — that's a folder, validated
  separately (§3.3).

Every JS callsite of `isModuleName` keeps working: `project.add` (`1344`), `project.rename`
(`1350`), `deserializeProject` (`1421`), and the new `project.move`. The validator is the **single**
gate for code paths — folders + assets get their own (below).

### 3.2 Module-name vs path: the entry & dotted resolution

- `project.entry` is now a **path** (`main.py` or `game/main.py`); `serialize().entry` carries it;
  `_run_project(files, entry)` writes it and transforms `files[entry]`.
- The Python engine maps a relpath to a dotted module name only for `sys.modules` hygiene (§2.5);
  the entry itself is `eval`'d (not imported), so its location doesn't need to be a package.
- A `.py` directly under ROOT with no `/` is importable as a top-level module (spike `late_mod.py`);
  a `.py` under a folder needs that folder to be a package (auto-`__init__.py`, §2.3).

### 3.3 Folder-name + asset-path rules

- **Folder name** (new-folder / rename-folder): a single path segment matching `[A-Za-z_]\w*`
  (Python-package-safe so `import folder.x` works; reject spaces, dots, `/`, leading digit). Add
  `isFolderSegment(seg)`.
- **Asset paths** are less strict than module paths (no identifier requirement — `sounds/jump-1.wav`
  is fine), but must still: be relative, have no `..`, no leading `/`, no empty segments, and a
  non-empty leaf. Add `isAssetPath(path)` = same path-shape guard minus the identifier-stem rule on
  segments. (A folder that holds assets need not be a Python identifier — but if it ALSO holds `.py`
  it must be, since it becomes a package; surface that constraint when a user drops a `.py` into a
  non-identifier folder — open question §9 Q5.)

---

## 4. JS project model + persistence

### 4.1 Keys become relative POSIX paths

`project.files` keys, `project.order` entries, `project.entry`, `project.active` all become POSIX
relpaths (`sprites/enemy.py`). The `files[active] === editor.getDoc()` identity invariant
(architecture-map §3) is **unchanged** — the value is still a `CodeMirror.Doc`; only the key shape
changes.

### 4.2 Methods operate on paths; add `move`

- `add(path, text)` — validate via `isModuleName` (now path-aware); reject dup/invalid (unchanged
  contract, `1343`). Auto-create the parent folder's package marker on next reconcile.
- `rename(oldPath, newPath)` — validate `newPath`; re-key `files`/`order`; follow `entry`/`active`;
  `pyodide.FS.unlink(oldPath)` (guarded, `1355`). **Note:** renaming across directories IS a move;
  `move` is the directory-aware sugar.
- **`move(path, destFolder)`** — NEW. Compute `newPath = destFolder ? destFolder + '/' + basename
  : basename`; reject if `newPath` exists or `isModuleName(newPath)` fails; then `rename(path,
  newPath)`. Folder move = move every descendant (re-key each child path under the new prefix).
  Guard: cannot move a folder into its own descendant (the tree DnD already blocks this via
  `isDescendant`, §5.3 — but `move` re-checks defensively).
- `remove(path)` — re-key filter as today (`1358`); unlink the real path; if its directory becomes
  empty of project files, the next reconcile prunes it.
- `setActive(path)` / `setEntry(path)` / `order` — operate on paths verbatim.
- **Folder ops live on a thin model layer, not `project`** (project tracks files only): folders are
  **derived** from the set of file paths (a folder exists iff some file path has it as a prefix) PLUS
  an explicit **empty-folder set** (so a just-created empty folder persists until a file lands in it).
  See §5.1.

### 4.3 `serialize()` → `{path: text}`; `load()` recreates dirs

- `serialize()` (`1327`) already returns `{ files: {name→text}, order, entry }` — with path keys it
  becomes `{ files: {path→text}, order:[paths], entry:path }` **with no code change** (it iterates
  `order` and reads each Doc). The empty-folder set must also be serialized (add
  `emptyDirs: [...]` so a saved project with an empty folder restores it) — **new field, additive,
  tolerated by old readers.**
- `load(rec)` (`1333`) recreates Docs keyed by path; on next reconcile the engine `mkdirTree`s the
  dirs. `load` restores `emptyDirs` into the model's empty-folder set. `deserializeProject` (`1417`)
  validates each key with the path-aware `isModuleName`; an invalid path → `null` → falls through
  (no clobber) exactly as today.

### 4.4 `flushSave` / localStorage

`flushSave` (`1929`) writes `JSON.stringify(rec)` to `PROJECT_KEY` — path keys serialize natively in
JSON (slashes are valid JSON string chars). The legacy-key mirror (`1936`, `!isMulti()` →
`storage.set(text)`) is unchanged (single-file is path-depth-1, no slash). **No localStorage format
break** beyond the new `emptyDirs` field.

### 4.5 `#project=` (slashes are `encodeURIComponent`-safe) + the S6 boundary

- `projectToHash` (`saveProject`'s share branch, `1977`) does `b64url.enc(JSON.stringify(
  project.serialize()))`. Slashes inside the JSON are **base64url-encoded along with everything
  else** — no special handling needed; a path key round-trips byte-for-byte (spike claim 4). The
  `multifile.mjs` check 7 `#project=` round-trip (paths) is the test (§7).
- **The `encodeURIComponent` boundary is S6's, not S2's.** De-risk §3 headline: Automerge's
  `updateText` splits its path arg on `/`, so the **shared CRDT doc** must key files by
  `encodeURIComponent(path)`. S6 adds `encodeProject(serialize())` on seed + `decodeProject` on
  adopt — total inverses, local model unchanged. **S2 must NOT encode paths in `#project=` /
  localStorage / zip** (those are not CRDT-backed); doing so would (a) break the human-readable share
  format and (b) double-encode when S6 wraps. S2's only obligation: keep `serialize()`/`load()` a
  clean `{path:text}` inverse pair so S6 can wrap them. **Document this boundary in the impl** so S6
  doesn't accidentally re-encode an already-encoded key.

### 4.6 `saveProject` zip: folders free; `asset_` clash per-directory

`saveProject` (`2013`) Branch B builds the zip from `serialize().files` + `assetStore.getAll()`:

- `zip.file("sprites/enemy.py", text)` **creates the `sprites/` folder automatically** (JSZip
  treats `/` as a path) — code files need **zero change** beyond their keys already being paths
  (`2025`).
- Assets are written by their (now possibly nested) path key.
- **`asset_` clash handling is now per-directory** (`2028`): today it prefixes `asset_` when
  `files[rec.name]` exists (a code file with the same bare name). With paths, the clash is when an
  asset path **equals** a code-file path key. Recommendation: compare full paths
  (`files[assetPath]`), and if clashing, prefix the **leaf** within its directory:
  `sprites/ship.py` (code) + `sprites/ship.py` (asset, pathological) → `sprites/asset_ship.py`.
  Since assets and code are different extensions in practice, a true clash is rare; the per-directory
  rule keeps the existing safety without flattening. (Branch A, the lone-`.py` fast path at `2015`,
  is unchanged in S2 — always-zip is S5.)

---

## 5. Explorer folder tree UI (extends S1's flat list)

S1 made `#tabs` an always-on flat list of `.tab[data-name]` rows (`.py` first, then assets) +
a `+ new file` row, with a single click delegate (`1862`) and the one-CM `renderViewer` (`1786`).
**S2 turns `renderTabs` into a nested tree while preserving every one of those seams.**

### 5.1 Deriving the tree from path keys (no separate node model)

The proto's mock uses a recursive `{id, type, children[]}` node tree. **S2 does NOT adopt that** —
the source of truth stays `project.files` (path→Doc) + `assetFS.list` (path-bearing) + the
**empty-folder set**. `renderTabs` builds a transient display tree each render:

- Group every code path + asset path by its directory segments into a nested structure.
- Add any `emptyDirs` (created-but-empty folders) so a fresh folder shows before it has files.
- Folders are **derived**; there is no folder object to keep in sync — moving a file to a new prefix
  *is* moving it between folders. This sidesteps the proto's `findNode`/`walk` bookkeeping and the
  desync risk between a node tree and the real file map.

### 5.2 `renderTabs` renders a nested tree (preserved seams)

The render output keeps the **exact** load-bearing selectors so S1's + the batteries' assertions
hold:

- **File/asset rows stay `.tab[data-name]`** — but `data-name` now carries the **full POSIX path**
  (`data-name="sprites/enemy.py"`). `.active` (selected) and `.entry` (▸ badge on the entry file)
  unchanged. `escTab` still escapes for the attribute.
- **Folder rows** are NEW: `.tab.folder[data-path]` (a folder is not a file, so it carries
  `data-path` NOT `data-name` — keeping `data-name` strictly for openable file/asset rows so
  `t.querySelectorAll('.tab[data-name]')` in `multifile.mjs:270` still returns exactly the files).
  Folder rows get a **caret** (`.caret`, rotate-on-open via `.node.open`/`.closed` per proto
  `113`–`119`), a folder icon, the folder name, and (optionally, stubbed) a `.dl` download button.
- **Indentation** by depth (padding-left), matching the proto.
- The `+ new file` affordance (`.tab-add`, `1858`) stays; add a sibling `+ new folder` OR rely on
  the header `#newFolderBtn` (§5.4). Recommend: keep the header buttons as the create entry points;
  the `.tab-add` row stays for parity with S1.
- `editor.refresh()` at the end (S1's `1859`) stays (CM viewport geometry).
- `window.renderTabs` stays the zero-arg hook (`1861`).

### 5.3 Opening rows: the swapDoc/setActive rule (landmine b)

The click delegate (`1862`) extends, **never** changing the open path:

- Click a **caret** or a **folder row** → toggle that folder's open/closed state (a render-only flag,
  e.g. a `Set` of open folder paths) → `renderTabs()`. No model mutation.
- Click a **file/asset row** → `renderViewer(path)` → for `.py`, `renderViewer` calls
  `project.setActive(path)` → `editor.swapDoc(files[path])` (`1797`/`1342`). **NEVER `editor.setValue`**
  — `setValue` fires `change` → `armLint` (`1414`) → eager lint load → breaks first-paint laziness
  (decision-context landmine b). This rule is inherited intact from S1; S2 must not introduce a
  `setValue` in any new tree code (folder toggle, DnD, create/rename all touch the model + render,
  never the editor value directly).
- Click a `.tab-menu` (⋯) → `tabMenu(path)` (rename/delete/set-entry), now path-aware.

### 5.4 Folder create / rename / delete (behind the shared confirm)

- **Create** (`#newFolderBtn`, currently `hidden` at DOM `330`): un-hide it; on click, prompt for a
  folder name (or create `new-folder` and inline-rename, proto-style). Validate via
  `isFolderSegment`. The new folder is added to the **empty-folder set** and rendered; it persists
  via `emptyDirs` in serialize until a file lands in it. **Created relative to the selected folder**
  if one is selected, else ROOT (matches proto `newFolder`).
- **Rename folder** (via the folder row's ⋯ or inline edit): validate; re-key **every descendant
  file path** under the new prefix (calls `project.move` per child, or a batch re-key); update
  `emptyDirs`; show the **same warn-don't-rewrite import note** (a folder rename changes dotted
  paths). `pyodide.FS` paths are reconciled on next run (writePath new, prune old).
- **Delete folder**: behind the **shared confirm** the app already uses (`confirm(...)`, e.g.
  `tabMenu`'s delete at `1896`); deleting a folder removes every descendant file (each via
  `project.remove`, guarded so the last remaining file can't be deleted — surface a friendly block,
  matching `1895`) and clears it from `emptyDirs`. Reconcile prunes the dir.
- All three go through the **existing prompt/confirm pattern** (the app has no modal framework;
  `prompt`/`confirm` is the house style, S1 uses it in `newFilePrompt`/`tabMenu`). The proto's
  inline-rename is a nicety the impl MAY adopt but the design only requires the confirm-gated path.

### 5.5 Drag-reorder + move-into-folder + descendant guard (from the proto)

Adopt the proto's DnD mechanics (`proto/sandbox.html:623`–`690`), retargeted to **paths** instead of
node ids:

- **`dragstart`** on a row stores the dragged **path** (`dragId` → `dragPath`); add `.drag-ghost`.
- **`dragover`**: if hovering a **folder row** and the dragged path is NOT inside that folder
  (descendant guard, §5.3) → highlight `.drop-into` (drop INTO the folder). If hovering a file row →
  show a `.drop-line` before/after for **reorder** within the same container.
- **`drop`**: into a folder → `project.move(dragPath, folderPath)` (re-key under the new prefix);
  reorder → splice the path in `project.order` to the new position. Then `renderTabs()` + `flushSave()`.
- **Descendant guard** (`isDescendant`, proto `538`): a folder cannot be dropped into itself or any
  descendant. With derived folders, this is a **prefix check**: `dest.startsWith(draggedFolder + '/')`
  → block. `project.move` re-checks defensively (§4.2).
- **`dragend`/`dragleave`** clear the marks (`clearDropMarks`, proto `678`).
- Moving a folder moves all its descendants (re-key each child path); moving a file is a single
  re-key. The `.drop-line` / `.drop-into` CSS classes come straight from the proto (`115`/`137`).

### 5.6 How the Assets section integrates with the tree

S1 keeps assets in **two** places: as `.tab.asset[data-name]` rows in `#tabs` (`1852`) **and** in
the separate `#assetSection`/`#assetPanel` (DOM `335`–`338`, rendered by `renderAssetPanel`,
`1598`). S2 must decide how assets show in a **nested** tree. **Recommendation:**

- **Assets become first-class tree citizens**: an asset at `sounds/jump.wav` renders as a
  `.tab.asset[data-name="sounds/jump.wav"]` row **inside the `sounds/` folder node** in `#tabs`,
  interleaved with code by directory. Selecting it opens the type-aware viewer (unchanged).
- **Keep `#assetPanel` + `.asset-row[data-name]` + `#assetChip` + `#apStorage` alive** as the
  compatibility surface `assets.mjs` gates on (§7 reconciliation) — but `renderAssetPanel` now keys
  rows by **path** (`data-name="sounds/jump.wav"`). The panel can remain the storage-summary +
  remove surface; the tree is the primary browse surface. This is the **lowest-churn** path:
  `assets.mjs` selectors keep working with path values, and the tree gains nested assets.
- **Alternative (heavier):** drop the separate `#assetPanel` and route all asset interactions
  through the tree, updating `assets.mjs` selectors to `#tabs .tab.asset[...]`. Not recommended for
  S2 (bigger test churn; the asset-model redesign isn't S2's job). **Open question §9 Q2** — confirm
  "keep `#assetPanel` as a compat container, assets ALSO appear nested in the tree."

---

## 6. Assets in folders

- **Upload still goes through `assetFS.add`** (`1531`). Today it writes a bare name to MEMFS
  (`_memfs`, `1522`). S2 makes `_memfs` (and `hydrateAll`'s write loop, `1527`) call the **JS
  `writePath`** (`pyodide.FS.mkdirTree(dirname) + pyodide.FS.writeFile(path, bytes)`) so a nested
  asset path lands at its real location. `assetStore` keeps the **full path** as `keyPath: 'name'`
  (the IndexedDB record's `name` becomes a path — no schema change, just a value with slashes).
- **Default add target stays ROOT** in S2 (a dropped/browsed file with no folder context →
  `file.name` at root), because "upload INTO the selected folder" is the upload-routing slice. The
  *mechanism* for nested asset writes exists (so a loaded/zipped project with `sounds/x.wav`
  hydrates correctly), but the default UI add stays flat unless §9 Q1 pulls it forward.
- **Load by relative path** is already proven (spike claim 3: `open("sprites/ship.png","rb")` works
  after `os.chdir(ROOT)`; pygame sees the path via shared MEMFS, claim 3b). User code does
  `pygame.image.load("sounds/sprite.png")` — resolves cwd-relative against ROOT.
- **Viewer/asset selectors preserved**: `assetObjectURL` (`1780`) reads `pyodide.FS.readFile(name)`
  — pass the **path**; `classifyKind` (`1764`) splits on the **leaf** extension (`name.split('.')`
  on the path still finds the extension). `renderViewer` (`1786`) is path-agnostic. The MP3 ⚠
  banner (`1824`) and `UNSUPPORTED_AUDIO` (`1443`) test the leaf extension — unchanged.
- **`assetFS.remove`/`clearAll`** unlink by path (`_unlink`, `1523`), then the next reconcile
  prunes the empty dir.

---

## 7. TDD test plan

**New battery: `test/subdirs.mjs`** (same harness as `multifile.mjs`/`assets.mjs`:
`python3 -m http.server 8923` then `node test/subdirs.mjs http://localhost:8923/`). Rationale for a
new battery (not extensions): S2's engine + tree behaviors are a coherent, large new surface;
keeping them in `subdirs.mjs` keeps `multifile.mjs`/`assets.mjs` focused on the flat contracts they
already prove, **except** for the handful of existing assertions that must change in lockstep (§7.3),
which are edited in-place in their home battery.

### 7.1 New engine assertions (`test/subdirs.mjs`) — proving the REAL engine

These drive `window.project` + `run()` against the live `PROJECT_PY` (not the spike harness):

1. **Create a folder, add a module inside it.** `project.add('sprites/enemy.py', …)` + a
   `project`-created folder; assert the tree shows a `sprites/` folder row containing an
   `enemy.py` file row (`#tabs .tab.folder[data-path="sprites"]` + a nested
   `.tab[data-name="sprites/enemy.py"]`).
2. **`from sprites import enemy` RUNS in the real engine.** Load a project mirroring the spike's
   `PROJECT` (`main.py` does `from sprites import enemy`; `sprites/enemy.py` has a class; an
   auto/explicit `sprites/__init__.py`); `run()`; assert status `running` and (via a print routed to
   `#console` or a draw on `#canvas`) the import resolved. Negative-control a stale run.
3. **Dotted `import sprites.enemy` RUNS** (separate entry) — and the `__init__` re-export path
   (`import sprites; sprites.Enemy(...)`) works (spike claim 1c).
4. **Relative + absolute intra-package imports** (`from . import util`; `from sprites.util import
   hp_for`) resolve when run through the entry (spike claim 1c transitively).
5. **Imported cooperative loop does NOT freeze** (regression guard for the §2.2 wrapper): an
   imported module function with a game loop, called from the entry; main-thread round-trip < 500 ms
   while running (mirrors `multifile.mjs` check 2 but with a **nested** module). **This is the
   wrapper's proof.**
6. **Stdlib import inside a project module still works** (proves the `_is_project_origin` gate
   doesn't over-claim): a nested module does `import json` / `import math` and uses it.
7. **Nested asset load by path.** `setInputFiles('#assetInput', …)` a PNG, move/place it at
   `sounds/sprite.png` (or seed via the nested-write path), run code that
   `pygame.image.load("sounds/sprite.png")` + blit; assert the canvas pixel (mirrors `assets.mjs`
   check 1, nested).
8. **Folder rename** re-keys descendants: rename `sprites/` → `actors/`; assert
   `project.files['actors/enemy.py']` exists, `sprites/enemy.py` gone, and the warn-don't-rewrite
   note appeared.
9. **Folder delete** removes the subtree: delete `sprites/` (with ≥1 file); assert all
   `sprites/*` paths gone, the folder row gone, and reconcile pruned the dir (a subsequent run of a
   solo program importing `sprites.enemy` → `ModuleNotFoundError`).
10. **Drag-move-into-folder + descendant guard.** Simulate a drag of `enemy.py` onto the
    `sprites/` folder row (mousedown/dragstart→dragover→drop, or call the drop handler) → assert
    `project.files['sprites/enemy.py']`. Then attempt to drag `sprites/` into `sprites/sub/` → assert
    the move is **blocked** (descendant guard) and paths unchanged.
11. **Path round-trip (save → reload → import still works).** Build a nested project, `__flushSave()`,
    `page.reload()`, assert the tree + paths restored AND `run()` of the package import still works
    (the engine recreates dirs from the loaded `{path:text}`). Mirrors spike claim 4.
12. **`#project=` round-trip with paths.** Multi-file nested project → share branch emits
    `#project=`; reload that URL; assert `project.order` (with slashes) + a nested file's content
    round-trip (extends `multifile.mjs` check 7 to paths).
13. **`isModuleName` path validation.** `project.add` accepts `a/b/c.py`, rejects `../x.py`,
    `/abs.py`, `a//b.py`, `a/.py`, `a/1bad.py` (leading digit), `noext` — assert false/no-op for
    each.
14. **Coexistence (flat `.py` still runs).** A single flat `main.py` (depth 1, no slash) runs via
    the `BOOT_PY` single-file path (`!isMulti()`); assert it animates exactly as today and `_start`
    (not `_start_project`) was used (mirrors `multifile.mjs` check 11).
15. **`emptyDirs` persistence.** Create an empty folder, `__flushSave()`, reload; assert the empty
    folder still renders (round-trips via the new `emptyDirs` field).
16. **First-paint laziness regression** (additive): after boot + rendering a nested tree (no run),
    assert `window.JSZip === undefined`, `window.__amLoaded` falsy, CM `lint` option falsy — proving
    tree rendering + folder toggles touch no lazy loader and never `setValue`.

### 7.2 Engine-only assertions worth a dedicated micro-check

- **`invalidate_caches` necessity** (mirror spike 5a): after the engine adds a new nested module
  between runs, it imports on the next run (the engine's batched `invalidate_caches` covers it).
- **Dotted `sys.modules` pop**: edit `sprites/enemy.py`, re-run, assert the new code executes (not a
  cached module) — proving `_dotted_names_for` popped `sprites.enemy`.
- **Wrapper narrowness**: assert `import json` inside a nested module did NOT get the cooperative
  transform applied destructively (it just works) — covered by §7.1 #6.

### 7.3 EXACT existing assertions to reconcile in lockstep (same commit as the DOM/engine change)

| Test site | Today's assumption | S2 reality | Action |
|---|---|---|---|
| **`multifile.mjs:270`** `t.querySelectorAll('.tab[data-name]')` | files are flat `.tab[data-name]` rows | files are nested but **still `.tab[data-name]`** (folders are `.tab.folder[data-path]`, NOT `data-name`) | **Passes unchanged** — by design, only file/asset rows carry `data-name`. Verify the single-file solo assertion (`273`, names === `["main.py"]`) still holds (one flat file = depth-1 row). |
| **`multifile.mjs:282-285`** `Array.from(querySelectorAll('#tabs .tab')).map(t=>t.dataset.name)` expects `["main.py","enemy.py"]` | all `.tab` rows are files | folder rows are also `.tab` (`.tab.folder`) → this would pick them up | **Reconcile:** this test adds two **flat** files (`main.py`, `enemy.py`, no folders), so no folder rows exist → **still passes**. BUT to be robust, the selector should be `.tab[data-name]` not `.tab`. **Recommend: update `282` to `#tabs .tab[data-name]`** in lockstep (it's still flat data here, so the value is unchanged). |
| **`multifile.mjs:288`** `page.click('#tabs .tab[data-name="enemy.py"]')` | flat file row click switches | nested-capable row click still switches by `data-name` | **Passes unchanged** (flat `enemy.py` here). |
| **`multifile.mjs:299-302`** entry badge `#tabs .tab.entry` | `.entry` on a flat row | `.entry` on a (possibly nested) file row | **Passes unchanged.** |
| **`multifile.mjs:317-334`** `#project=` round-trip | flat keys | path keys round-trip too | **Passes unchanged** (this test uses flat `main.py`/`helper.py`); **§7.1 #12 adds the nested case** rather than mutating this one. |
| **`lint.mjs:71`** `page.click('#tabs .tab[data-name="good.py"]')` | flat row click | row keeps `.tab[data-name]` | **Passes unchanged** (flat `good.py`). |
| **`assets.mjs`** `.asset-row[data-name]` / `#assetPanel [data-name="…"]` / `#assetChip` / `#apStorage` / `.asset-remove` / click-not-close (`166-173`) | asset rows keyed by **bare name** | asset rows keyed by **path** (but flat assets are depth-1 paths == bare names) | **Passes unchanged** for the flat fixtures `assets.mjs` uses (`tune.mp3`, `q"x.png` — all root-level, so path == name). **No change needed** unless `assets.mjs` is extended with a nested asset (then a nested `data-name` assertion is added, not changed). Keep `#assetPanel` + `.asset-row[data-name]` rendering (§5.6). |
| **`multifile.mjs:308`** `window.project.files['enemy.py'].setValue(...)` | a Doc keyed by bare name | a Doc keyed by path (flat here) | **Passes unchanged.** |

> **Net:** because S2 keeps `data-name` strictly on file/asset rows (folders use `data-path`) and the
> existing batteries use **flat fixtures**, almost everything passes unmodified. The one
> recommended-in-lockstep tightening is `multifile.mjs:282` `#tabs .tab` → `#tabs .tab[data-name]`
> (defensive against folder rows; value unchanged). **No assertion is weakened or deleted** — the
> nested behaviors are proven by NEW assertions in `subdirs.mjs`.

### 7.4 Guardrails (must stay green, unchanged)

`verify.mjs`, `spike-runstop.mjs`, `spike-viewer.mjs`, `save.mjs` (S2 does not touch save branches),
`history.mjs`, `collab.mjs` (single-file room; S2 doesn't touch the CRDT), and `lint.mjs` must all
stay green with no edits. `test/spike-packages.mjs` stays a living reference (run on demand).

---

## 8. Seam preservation + landmines

### 8.1 Seams confirmed intact

- **S1 explorer seams**: `#tabs` container id; `.tab[data-name]` (now path-valued for files/assets);
  `.active`; `.entry`; `.tab-add`; `window.renderTabs` zero-arg hook; the `#tabs` click delegate;
  `renderViewer`'s one-CM swapDoc; `cmStash` (the off-screen CM holder, `1757`).
- **Asset seams**: `#assetInput` (real hidden input); `.asset-row[data-name]`; `.asset-warn`;
  `.asset-remove`; `#assetChip`; `#assetPanel`; `#apStorage`; the click-not-close rule (`1614`);
  drop-anywhere + `#dropOverlay`.
- **Engine seams**: `_start_project` surface (`1235`); `run()` dispatch (`2271`); `_state['task']`;
  the status-token protocol; `_purge_project_files` (extended, not renamed); `__yield__`/`__sleep__`/
  `__maybe_await__` helpers; `_transform_entry` (unchanged); `_transform_module` (now invoked by the
  wrapper loader instead of `_ProjectLoader`).
- **JS globals**: `window.project` (method surface + new `move`); `window.__flushSave`;
  `window.historyStore`; `window.renderAssetPanel`; `pyodide`.
- **Persistence**: `PROJECT_KEY` JSON (path keys + additive `emptyDirs`); `#project=`/`#code=`/
  `#room=` (untouched semantics); the zip (folders free).

### 8.2 Landmines reaffirmed for the new tree code

- **(b) `setValue`/lint-arm trap.** Every new tree interaction — folder toggle, create/rename/delete,
  DnD move, opening a row — mutates the **model + render**, never `editor.setValue`. Opening a `.py`
  row goes through `renderViewer` → `project.setActive` → `editor.swapDoc` (`1797`/`1342`). A folder
  rename re-keys Docs (swaps the map key; the Doc object is untouched, no value write). **No new code
  path may call `editor.setValue`** (§7.1 #16 regression-guards this).
- **(c) Lazy-load invariants.** Rendering a nested tree, toggling folders, and dragging rows must
  load **zero** of JSZip / Automerge / ruff / jsdiff at first paint. The tree reads in-memory data
  only. (Per-row download, if stubbed, must NOT eagerly `loadJSZip` — it's inert in S2.) §7.1 #16 +
  §7.4 guard this.
- **(a) Flat-MEMFS-isolation truth gap — now RESOLVED.** S1/decision-context warned organizational
  folders create no real isolation. **S2 removes that gap**: paths ARE real MEMFS subdirectories, so
  `sprites/ship.png` and `ship.png` are genuinely distinct files. The `asset_` clash prefix is now
  per-directory (§4.6) — a real same-path code/asset clash is the only remaining collision, and it's
  rare (different extensions).

---

## 9. Risks + open questions for the orchestrator

1. **Q1 — Upload INTO the selected folder: S2 or upload-routing slice?** S2 makes nested asset writes
   *possible* (the mechanism), but keeps the **default add target = ROOT** (a dropped file lands at
   root). "Drop/browse into the currently-selected folder" is small but belongs to upload-routing.
   **Recommend: keep flat-add in S2; pull nested-add only if the orchestrator wants it now.** A real
   risk if deferred: a user creates `sounds/` then drags a WAV from the OS expecting it to land
   inside — in S2 it lands at root and they must move it via the tree DnD. Acceptable for S2.

2. **Q2 — How assets coexist with the tree visually.** **Recommend: assets become nested
   `.tab.asset[data-name=path]` rows inside their folder in `#tabs`, AND `#assetPanel` stays as a
   compatibility/summary container** (lowest `assets.mjs` churn). Confirm vs the heavier option of
   removing `#assetPanel` entirely (bigger test churn, not S2's asset-model job).

3. **Q3 — Auto-`__init__.py` visibility.** **Recommend: invisible-until-content** (tracked in a model
   set; written to MEMFS + serialize/zip but filtered from `renderTabs` while empty). Confirm vs a
   visible greyed row. (Affects whether `subdirs.mjs` asserts an `__init__.py` tree row.)

4. **Q4 — Per-row download: S2 stub vs S2 implement.** **Recommend: S2 renders the `.dl` affordance
   inert (or omits it) and S5 wires both project-always-zip and per-item download together** (same
   machinery; avoids splitting zip-subtree logic and pulling `save.mjs` reconciliation into S2). If
   the orchestrator wants it in S2, it's a contained add (single `.py` → `downloadBlob`; folder →
   JSZip subtree) but it forces the `save.mjs` per-item assertions forward.

5. **Q5 — Code dropped into a non-identifier folder.** A folder holding only assets can have any
   path-shape name (`sounds-2/`), but the moment a `.py` lands in it, it must be a Python identifier
   to be an importable package. **Recommend: enforce `isFolderSegment` (identifier-safe) for ALL
   folder names at creation** (simplest; never need to rename a folder when a `.py` arrives). Confirm
   — the alternative (lax folder names, error only when a `.py` enters) is more permissive but adds a
   failure mode.

6. **Risk — the MetaPathFinder transform-wrapper (the §2.2 subtlety).** This is S2's highest-risk
   engine piece: wrap `PathFinder`'s returned `SourceFileLoader.exec_module` to run
   `_transform_module`, gated to project-origin files only. The de-risk doc flags it explicitly. If
   it proves fragile, the **documented fallback is the de-risk "v1 is fine"**: drop the wrapper, let
   imported modules run untransformed, and accept that an imported module with a blocking `while
   True` would freeze (the entry is still cooperative). **But that would regress `multifile.mjs`
   checks 2/3** (imported cooperative loop) — so the wrapper is effectively required to hold those
   green. §7.1 #5 + #6 are the gating tests. **Decision for the orchestrator: treat the wrapper as
   in-scope-required; if it can't be made robust, the fallback requires relaxing checks 2/3 in
   lockstep (undesirable).**

7. **Risk — `__pycache__` skip.** Pyodide sets `sys.dont_write_bytecode = True` (spike claim 5b: no
   `__pycache__` observed), so bytecode caches shouldn't appear. **Still skip `__pycache__`
   defensively** in the serialize walk, the zip, and `_prune_empty_dirs` (the spike's serialize does
   this) so a build-flag change can never leak `.pyc` into a saved/shared project.

8. **Risk — folder-rename = many re-keys.** Renaming a deep folder re-keys every descendant path
   (and re-points entry/active). Cheap for small projects; the only correctness risk is the
   warn-don't-rewrite import note (dotted import strings in user code aren't updated). Covered by
   §7.1 #8 + the existing warn pattern. No auto-rewrite (verdict).

9. **Risk — `assetStore` keyPath now holds slashes.** The IndexedDB `assets` store keys on `name`;
   that value becomes a path. No schema change, but a project that previously stored `ship.png` and
   one that stores `sprites/ship.png` are distinct records — correct, but worth a note that the
   hydrate loop must `writePath` (mkdirTree) each, not assume root.

---

## 10. One-paragraph recap

S2 replaces the bare-stem `_ProjectFinder`/`_ProjectLoader`/`_install_finder` with **native
`importlib`** (project root on `sys.path`, real MEMFS subdirectories), re-adding the cooperative
transform via a **`MetaPathFinder` that delegates to `PathFinder` and wraps the returned loader's
`exec_module`** (gated to project-origin files); auto-creates empty `__init__.py` per `.py`-bearing
folder; routes every code + asset write through one **`writePath`** (`mkdirTree`+`writeFile`); calls
**`importlib.invalidate_caches()`** after every write/unlink; pops **dotted** `sys.modules` names and
prunes empty dirs on reconcile; and **coexists** with the untouched flat `BOOT_PY` engine (a bare
name is a depth-1 path). `isModuleName` becomes a relative-POSIX-path validator
(`^([A-Za-z_]\w*/)*[A-Za-z_]\w*\.py$`, rejecting `..`/leading-`/`/empty segments). The JS `project`
model keys on POSIX paths, gains `move`, and `serialize()`/`load()` round-trip `{path:text}` (+
additive `emptyDirs`) compatibly with the `#project=`/zip/localStorage formats — **leaving the
`encodeURIComponent` CRDT-key boundary for S6**. The S1 flat explorer becomes a **real nested tree**:
`renderTabs` derives folders from path keys, keeps file/asset rows as `.tab[data-name]` (path-valued)
with `.active`/`.entry`, adds `.tab.folder[data-path]` rows with carets, enables `#newFolderBtn`, and
supports proto-style drag-reorder + move-into-folder with the descendant (prefix) guard — all via
model+render, **never `editor.setValue`** (swapDoc/setActive only). Assets gain nested writes through
the shared `writePath`, load by relative path, and keep every viewer/asset selector. The
test-first plan is a **new `test/subdirs.mjs`** battery (package import RUN in the real engine,
nested asset load, folder rename/delete, drag-move + descendant guard, path round-trips, `#project=`
with paths, validation, flat coexistence, first-paint laziness) plus **one lockstep tightening**
(`multifile.mjs:282` `#tabs .tab` → `#tabs .tab[data-name]`); the rest of the batteries pass
unchanged because they use flat fixtures and folders never carry `data-name`. Per-row download stays
a **stub for S5**; upload-into-folder stays for the upload-routing slice.

**Doc path:** `docs/specs/2026-06-23-subdirs-packages-design.md`
