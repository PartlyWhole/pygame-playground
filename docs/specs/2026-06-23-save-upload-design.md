# Slice S5 — always-zip Save + per-item download + upload routing — DESIGN

**Date:** 2026-06-23 · **Branch:** `redesign` · **Status:** design only — NO implementation, NO code, NO commit
**App:** pygame playground (single static `index.html`, GitHub Pages, no backend, no build step)

> This is the design for **S5**. It supersedes the relevant parts of `docs/specs/2026-06-23-save-design.md`
> (the pre-redesign Save design with a lone-`.py` fast-path). Verdicts come from
> `docs/specs/2026-06-23-redesign-open-decisions.md` (#3 always-zip, #6 upload routing) and the seam map
> `docs/specs/2026-06-23-redesign-decision-context-map.md` (`always-zip-save`, `upload-routing-collisions`).
> S2 (true subdirectories + Python packages) has **already landed** on `redesign`, so all line refs below were
> re-confirmed against the live `index.html` (3202 lines), not the older context-map numbers.

---

## 0.1 Orchestrator resolutions (settles §8.3 open questions — binding for implementation)

- **Q1 — Auto-`__init__.py` in the zip → INCLUDE.** JS-derived at zip time from the `.py`-bearing dirs;
  **NEVER overwrite a user-authored `__init__.py`**. Makes a downloaded `pygame-project.zip` a faithful
  importable package on desktop Python. (Reject the engine-`_AUTO_INITS`-bridge alternative — don't couple
  Save to a live run.)
- **Q2 — `.zip`-restore upload → DEFER to fast-follow** (consistent with the #6 verdict). S5 = always-zip-out
  + loose-file routing-in only.
- **Q3 — Per-item download test → real `page.on('download')` flow** (reuse `save.mjs`'s download/`readZip`
  context).
- **Q4 — New `test/upload.mjs`** (do NOT extend `assets.mjs`) — after confirming no `assets.mjs` check
  asserts `.py`-as-asset.
- **Q5 — `assetFS.add` name-override → optional `name` arg** threaded through (not a renamed `File`).
- **Accepted regression:** with Branch A deleted, an offline single-file Save now needs JSZip; the per-row
  bare-`.py` download is the offline escape hatch. Acceptable per the always-zip + per-item-download verdict.

---

## 0. Current state (re-confirmed against `index.html` on `redesign`)

Key seams as they exist today (post-S2/S3/S4):

- **`saveProject()`** — index.html:2528-2557. Has the **Branch A lone-`.py` fast-path** at 2530-2533
  (`if (!project.isMulti() && assetFS.list.length === 0)` → `downloadBlob(project.text(project.entry), project.entry, …)`),
  then **Branch B zip** (2534-2556): `loadJSZip()`, `zip.file(name, files[name])` for every `project.serialize().files`
  entry, and the **`asset_` clash prefix** (2542-2552, now path-aware: prefixes the LEAF within its directory,
  `sprites/ship.py` → `sprites/asset_ship.py`). `#saveBtn` listener at 2558.
- **`loadJSZip()`** — index.html:2509-2519. Lazy one-shot (`_jszip ??= …`), loads cdnjs JSZip 3.10.1 on first
  zip, cached. Must STAY lazy (landmine c).
- **`downloadBlob(data, filename, type?)`** — index.html:2520-2527. Blob + `URL.createObjectURL` + synthesized
  `a[download]` + `revokeObjectURL`. The shared download primitive.
- **`#saveBtn`** — index.html:352 (toolbar, aria "Download project (.py or .zip)"); keymap `Cmd-S`/`Ctrl-S` →
  `saveProject()` at 1444-1445.
- **`project`** — model at 1496. `serialize()` (1511-1519) returns `{ files, order, entry, emptyDirs }` with
  **POSIX path keys** (`sprites/enemy.py`). `add(name, text)` (1538-1543): **REFUSES** on invalid/dup
  (`isModuleName` + `this.files[name]` → `return false`), does NOT swapDoc/renderTabs (caller's job).
  `adoptDoc(name, doc)` (1547-1553): same refusal, adopts a live Doc. `text(name)` (1500) reads the live Doc.
- **`isModuleName`** — index.html:1481-1484, now **path-aware**: `/^([A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/` and
  rejects `..`. `isAssetPath` (1490-1495) is the asset-path validator (leaf needn't be an identifier stem).
  `isFolderSegment` (1486).
- **`assetFS`** — model at 1779. `add(file)` (1804-1816): writes IndexedDB via `assetStore.put`, then
  `_memfs(file.name, bytes)` (1787-1795, nested-capable: `mkdirTree` the dir under cwd), pushes `{name,size,type,warn}`
  to `.list` (DEDUPES by name with `.filter` then `.push` — i.e. **silently OVERWRITES** a same-name entry).
  `addFiles(files)` (1826) loops `add`. `hydrateAll()` (1797-1802) rehydrates IndexedDB → MEMFS on boot.
  `window.assetFS` test seam at 1828.
- **Upload entry points (all three funnel to `assetFS.addFiles`):** `#assetInput` change (1899-1901);
  `#dropOverlay` drop (1909-1913, drop-anywhere, overlay markup at 451, css 307-310); `assetFS.hydrateAll` on
  boot (2933). `#assetInput` markup at 364; `uploadBtn` → opens `#assetInput` (2420); `assetChip` → opens it (1891).
- **`renderTabs()`** — index.html:2172-2215 (the S2 nested tree). `buildTree()` (2145-2170) derives a transient
  tree from `project.order` + `assetFS.list` + `project.emptyDirs`. `emit()` (2179-2211) renders **folder rows**
  (2186-2191, has `.tab-menu` ⋯) and **file rows** — asset rows (2197-2201, NO menu) and `.py` rows (2203-2208,
  has `.tab-menu` ⋯ + `●` moddot). `tabsEl` click delegation at 2220-2242. `basename`/`dirname` at 2217-2218.
- **`selectedFolder`** — index.html:2142 (the S2b "create relative to" folder). Set on file click (2239,
  `dirname(name)`) and folder click (2229, the folder path); auto-cleared to `""`/ROOT when stale (2175-2176)
  or via the create flows. This is the "land in the SELECTED folder, root default" anchor for #6.
- **Engine (Python, BOOT_PY):** `writePath(relpath, text)` (1262-1271, `mkdirTree` + write under `_ROOT`);
  `_ensure_init_py(new_paths)` (1290-1305) auto-creates **empty `__init__.py`** in every `.py`-bearing dir,
  tracked in **`_AUTO_INITS`** (a Python set of ABSOLUTE paths, 1220); `_run_project` (1331-…) writes files,
  ensures inits, reconciles. **`_AUTO_INITS` is Python-side only — it is NOT in `project.serialize()`**, so the
  zip (built from the JS `serialize().files`) currently OMITS the auto-init markers (the §5 fidelity gap).
- **`logLine(text, cls)`** — index.html:1418 (console line; `"sys"` class for system messages).

---

## 1. Scope + non-goals

**In scope (S5):**
1. **Always-zip Download.** Toolbar `#saveBtn` → `saveProject` ALWAYS emits `pygame-project.zip` (delete
   Branch A). One mental model: "Download = my whole project."
2. **Per-item row download** (the `.dl` affordance that S2 OMITTED). A `.py`/asset row downloads the **bare
   item**; a **folder** row downloads a **zip of its subtree**.
3. **Upload routing (#6).** Route by extension: `.py` → `project.add` (validated, editor via fresh Doc/swapDoc,
   NEVER `setValue`); images/audio/other → `assetFS.add`. Land in the **selected folder** (root default). On a
   same-PATH clash: **warn + auto-suffix**, applied **consistently to BOTH helpers** via ONE collision helper.
   Keep drop-anywhere + `#dropOverlay`.
4. **Auto-`__init__.py`-in-zip fidelity.** S5 owns the zip; decide whether the auto-created package markers
   ride along (recommended) and how.

**Out / FAST-FOLLOW (designed here, recommended deferred):**
- **`.zip`-restore upload** — detect a dropped/selected `.zip`, unzip, recreate paths. Pairs naturally with
  always-zip (round-trips a downloaded project) but is **net-new** and larger. Sketched in §6; recommend
  **defer to a fast-follow**, pull into the first cut only on request.

**Explicit non-goals (unchanged):** cloud save; choosing a save location (browser flow only); a name prompt
(one-click, rename in OS); auto-rewriting imports on rename (#10, kept warn-only); a second visible
"download .py" toolbar button (verdict #3 routes the single-file affordance to the per-ROW download, not a
second toolbar control).

---

## 2. Always-zip Download

### 2.1 The change
Delete **Branch A** (index.html:2529-2533, the lone-`.py` fast-path). `saveProject()` becomes
unconditionally the zip path: `loadJSZip()` → build `zip` from `project.serialize().files` (path keys give
folders for free) + `assetStore.getAll()` bytes (keeping the existing `asset_` per-directory clash prefix at
2542-2552, which is independent and STAYS) → `zip.generateAsync({type:'blob'})` →
`downloadBlob(blob, "pygame-project.zip")`. A lone-`.py` project therefore downloads a zip containing one
`.py` (acceptable; round-trips as a real desktop project).

**JSZip stays lazy.** `loadJSZip()` (2509-2519) is untouched; it still loads on first SAVE only. The
behavioral change is only that the FIRST save now always crosses the JSZip path (a lone-`.py`-only project
used to skip it). First PAINT still loads no JSZip — that invariant is preserved and re-asserted (§7).

**Error handling unchanged:** the `try/catch` around `loadJSZip()` already logs a `sys` line and aborts
(2536-2537). With Branch A gone there is no longer a "library-free single-file save" fallback — an offline
single-file save now also needs JSZip. This is the accepted cost of one model; the per-item row download
(§3) gives an offline-capable bare-`.py` escape for a single file (no JSZip needed for a single file row).

### 2.2 EXACT `save.mjs` assertions that invert (the 4) + the lockstep edit
All four live in `test/save.mjs` and assert the OLD lone-`.py` behavior. They invert in lockstep with the
Branch A deletion:

1. **Check 2 — "lone file downloads as main.py"** (save.mjs:29-37). Today asserts
   `dl.suggestedFilename() === 'main.py'`. **Inverts** → assert `'pygame-project.zip'` (and that the zip
   contains `main.py` with the editor content — fold the old content check 41-42 into a zip-entry read via
   the existing `readZip` helper at 66-78).
2. **Check 3 — ".py content matches the editor" / renamed lone file** (save.mjs:40-42 + 44-48). Today asserts
   the raw `.py` text equals the editor and a renamed lone file downloads as `game.py`. **Inverts** → the
   content assertion moves inside the zip (`z['main.py']`); the renamed-file assertion becomes
   `'pygame-project.zip'` with the zip containing `game.py`.
3. **Check 4 / Cmd-S** (save.mjs:50-58). Today asserts `dl3.suggestedFilename() === 'main.py'` after a focused
   `Cmd/Ctrl-S` on a lone file. **Inverts** → `'pygame-project.zip'`. (The shortcut wiring itself is
   unchanged; only the expected filename flips.)
4. **Check 5 — JSZip laziness** (save.mjs:60-63). Today asserts `typeof window.JSZip === 'undefined'` AFTER a
   `.py`-only save (because the old fast-path never loaded it). **Inverts** → the laziness assertion moves to
   **first paint** (assert undefined BEFORE any save), and AFTER the first save `window.JSZip` is now defined
   (the always-zip path loaded it). This matches the seam-map note ("flips from 'undefined after a .py-only
   save' to 'absent at first paint, present after first save'").

**Lockstep edit:** these four are edited in the SAME commit as the Branch A deletion (RED→GREEN TDD: invert
the assertions first, watch them fail against the current always-skip behavior, then delete Branch A).
Checks 1 (button exists) and 6-9 (multi-file zip, asset bundling, multi-file+asset, asset/code collision) are
**already always-zip** and stay green unchanged — they exercise the path that now becomes universal.

---

## 3. Per-item row download (the `.dl` OMITTED in S2)

### 3.1 Behavior (verdict #3, refining the proto)
The proto (`proto/sandbox.html`) put a `.dl` button on **every** row but its `downloadItem(n)` (sandbox.html:702-707)
zipped EVERYTHING (a mock that always toasted "Downloaded <base>.zip"). The verdict **refines** this:

- **`.py` row** → download the **bare file** via `downloadBlob(project.text(path), basename(path), "text/x-python")`.
  No JSZip. (This is exactly the deleted Branch A, re-homed onto the row where it belongs.)
- **asset row** → download the **bare asset** bytes: read from `assetStore` (the durable source —
  `assetStore.getAll()` records carry `{name, bytes}`; find by `name === path`) → `downloadBlob(new Blob([bytes]), basename(path))`.
  No JSZip.
- **folder row** → download a **zip of that folder's subtree**: `await loadJSZip()` (lazy, on click), collect
  every `project.order` path AND every `assetFS.list` name under `folderPath + "/"`, add each to the zip under
  its path **relative to the folder** (so the zip root is the folder's contents, not the whole project), apply
  the same `asset_` per-directory clash prefix for an asset that collides with a code path, then
  `downloadBlob(blob, basename(folderPath) + ".zip")`.

This gives the single-file student a true bare-`.py` download (offline, no library) without a second toolbar
button — the toolbar is always-zip, the row is per-item.

### 3.2 Where the `.dl` lives in `renderTabs`
Add a `.dl` button to the existing action clusters in `emit()` (index.html:2179-2211):

- **`.py` file row** (2203-2208): add `<button class="dl" …>` alongside the existing `.tab-menu` ⋯.
- **asset file row** (2197-2201): asset rows have NO `.tab-menu` today; add a `.dl` button (the only action a
  read-only asset row needs besides remove, which lives in the asset panel). Keep markup minimal.
- **folder row** (2186-2191): add `<button class="dl" …>` alongside the existing folder `.tab-menu` ⋯.

Use a download-glyph SVG (the proto's `download` path is reusable: `M12 5v11 / M8 12l4 4 4-4 / M5 19h14`).
Each `.dl` gets `aria-label` + `data-tip` ("Download <name>" for files, "Download <name> (zip)" for folders).

### 3.3 Handlers
Extend the `tabsEl` click delegation (index.html:2220-2242). It already `closest()`-matches `.tab-add`,
`.tab.folder`, `.tab-menu`, and `.tab`. Insert a `.dl` check FIRST (before the folder/select branches, since a
`.dl` click must NOT also select the row or toggle the folder — mirror the proto's `e.stopPropagation()`):

```
const dl = e.target.closest(".dl");
if (dl) {
  e.stopPropagation();
  const folder = e.target.closest(".tab.folder");
  if (folder) downloadFolder(folder.dataset.path);
  else downloadItem(e.target.closest(".tab").dataset.name);
  return;
}
```

New helpers near `saveProject` (the save/download section, ~2506-2558):
- **`downloadItem(path)`** — dispatch on kind: `project.files[path]` → bare `.py` (`downloadBlob(project.text(path), basename(path), "text/x-python")`);
  else an asset (`assetStore.getAll()` lookup by name → `downloadBlob`). No JSZip.
- **`downloadFolder(folderPath)`** — `await loadJSZip()`, gather code+asset descendants under `folderPath + "/"`,
  add relative paths, apply the `asset_` clash prefix, `downloadBlob(blob, basename(folderPath) + ".zip")`. Wrap
  `loadJSZip()` in the same try/catch sys-line as `saveProject`.

**Seam reuse:** `downloadBlob` (2520), `loadJSZip` (2509), `project.text`/`project.order`/`project.files`,
`assetFS.list`, `assetStore.getAll`, `basename` (2217). No new download primitive.

---

## 4. Upload routing + collisions (#6)

### 4.1 The problem (re-confirmed)
All three upload entry points funnel to `assetFS.addFiles` (1899-1901 input, 1909-1913 drop, 2933 boot
hydrate) — so **everything currently becomes an asset**, including dropped `.py` files. And the two add-helpers
DISAGREE on collisions:
- **`assetFS.add`** (1804-1816) silently **OVERWRITES** (`assetStore.put` upserts by name; `.list` is filtered
  then re-pushed by name).
- **`project.add`** (1538-1543) **REFUSES** (returns `false` on dup/invalid) and leaves swapDoc/renderTabs to
  the caller.

The only existing collision handling is the **save-time `asset_` zip prefix** (2542-2552) — zip-only, does not
touch live MEMFS. Live MEMFS is flat-within-a-dir and shared by code + assets, so an asset CAN clobber a `.py`
at the same path at runtime today.

### 4.2 Routing by extension
Introduce a single `routeUpload(file)` (or a router inside a new `uploadFiles(files, destFolder)`), called by
all three live entry points (NOT boot hydrate — hydrate replays already-classified IndexedDB records and must
stay asset-only):

- **`.py`** (case-insensitive `/\.py$/`) → a **code** upload via `project.add` (validated by the path-aware
  `isModuleName`). Read the file text (`await file.text()`), then `project.add(targetPath, text)`. On success:
  `renderTabs()` + (optionally) `project.setActive(targetPath)` so the new file shows — **the editor is reached
  via `project.add` building a fresh Doc + `setActive`/`swapDoc`, NEVER `editor.setValue`** (landmine b: setValue
  arms lint + breaks first-paint laziness; `change` → `armLint` at the editor change hook).
- **`.zip`** → §6 fast-follow; until then, treat as "other" (an asset) so nothing breaks, OR reject with a
  sys-line "Zip restore is coming soon." **Recommendation: route `.zip` to the asset path for now** (it stores
  harmlessly and is visible), and let §6 promote it.
- **everything else** (images/audio/other) → `assetFS.add` (asset), unchanged routing, but now path-aware and
  collision-checked (§4.4).

Routing is **by extension only** (the verdict). No content sniffing.

### 4.3 Land in the SELECTED folder (root default)
Both branches compute a **target PATH** = `selectedFolder ? selectedFolder + "/" + file.name : file.name`
(`selectedFolder` is index.html:2142; `""` = root default). So a `.py` dropped while `sprites/` is selected
becomes `sprites/<name>.py` (validated by the path-aware `isModuleName`); an image becomes `sprites/<name>.png`
(written by `assetFS._memfs`, which already `mkdirTree`s the nested dir, 1787-1795). Drop-anywhere on the page
uses the CURRENT `selectedFolder` (the overlay is full-page; we keep that and route by the selected folder, not
the drop coordinates — simplest and consistent with click-to-select). The `#dropOverlay` copy can soften from
"add them as assets" to "add them to your project" since code now routes too.

### 4.4 Collision behavior — ONE helper, warn + auto-suffix, path-scoped
Unify the disagreement: BOTH helpers must **warn + auto-suffix** on a same-PATH clash (never silently
overwrite, never silently refuse). Specify **one** collision helper, used by both branches:

**`uniquePath(path, exists)`** — pure function:
- `exists(p)` is a predicate the caller supplies (`p => p in project.files || assetFS.list.some(a => a.name === p) || project.emptyDirs.has(dirOf(p))-style code/asset existence` — i.e. the path is taken by a code file
  OR an asset, since they share the MEMFS namespace within a dir).
- If `path` is free, return it. Else split into `dir`/`stem`/`ext` and try `stem-2`, `stem-3`, … (suffix
  applied to the LEAF, before the extension: `sprites/ship.png` → `sprites/ship-2.png`; `enemy.py` →
  `enemy-2.py`) until free. Return the suffixed path.

Flow per upload:
1. Compute `targetPath` (§4.3).
2. `final = uniquePath(targetPath, existsAnywhere)`.
3. If `final !== targetPath`: `logLine("\"" + targetPath + "\" already exists — added as \"" + final + "\".", "sys")`
   (the warn).
4. Route by extension to `project.add(final, text)` (code) or `assetFS.add(file)` **at `final`** (asset).

**Implementation detail for the asset branch:** `assetFS.add` keys off `file.name`. To land at `final` (which
may differ from `file.name` after suffixing AND carries the selected-folder prefix), either (a) add an
optional `targetPath` arg to `assetFS.add`/`_memfs`/`assetStore.put` so the stored name = `final`, or (b)
construct a renamed `File`/blob. **Recommend (a)** — a single `name` override threaded through
`add(file, name = file.name)` is minimal and keeps `assetStore`'s name = the real project path (which the zip,
the tree, and `_memfs` all already use as the path). The existing silent-overwrite `.filter`/`.push` in
`assetFS.add` (1812-1813) is then **dead for collisions** (the path is pre-uniquified) but harmless to keep;
optionally tighten it to never overwrite.

**Path-scoping note (cross-cutting landmine a):** real subdirs make collisions path-scoped (`a/ship.png` and
`b/ship.png` coexist), but within ONE directory code and assets STILL share names — so `existsAnywhere` must
check BOTH code and assets at the full path. This is the UX-truth: folders give path isolation, not name
isolation within a folder.

### 4.5 Keep drop-anywhere + overlay
`#dropOverlay` (markup 451, css 307-310) and the dragenter/over/leave/drop listeners (1906-1913) are kept. Only
the `drop` handler's body changes: instead of `assetFS.addFiles([...files])`, call the new
`uploadFiles([...files], selectedFolder)` router. Same for `#assetInput` change (1899-1901).

---

## 5. Auto-`__init__.py` zip fidelity

### 5.1 The gap (S2a code review, derisk-findings §1)
The engine auto-creates **empty `__init__.py`** in every `.py`-bearing directory (`_ensure_init_py`,
index.html:1290-1305) so `import sprites.enemy` resolves. These markers are tracked in **`_AUTO_INITS`**
(Python set of absolute paths, 1220) — they live ONLY in MEMFS + Python state. The zip is built from the JS
`project.serialize().files` (2539), which contains ONLY the user's `.py` files. So a downloaded zip of a
package project OMITS the `__init__.py` markers. On desktop CPython:
- modern Python (3.3+) treats a dir without `__init__.py` as a **namespace package**, so `import sprites.enemy`
  often STILL works — but namespace packages have subtle differences (no package `__init__` code runs, some
  tools/relative-import edge cases differ), and it is surprising that the in-browser project and the
  downloaded project differ in structure.

### 5.2 Recommendation: **include the empty `__init__.py` markers in the zip**
Make the zip a faithful, self-contained copy of what runs in the browser. Two viable mechanisms — recommend
the **JS-side serialize-for-zip** approach (no engine round-trip, no async Python call on the save path):

- **(Recommended) JS computes the markers at zip time.** In `saveProject` (and `downloadFolder`), after adding
  the user's `.py` files, derive the set of directories that contain ≥1 `.py` (reuse `project._fileDirs()` at
  1503-1510, filtered to dirs that actually hold a `.py`), and for each such dir add an empty
  `zip.file(dir + "/__init__.py", "")` **iff** the project doesn't already have a real `<dir>/__init__.py`
  (a user-authored one must win — never overwrite). This mirrors the engine's `_ensure_init_py` rule in JS and
  needs no engine change. Apply the SAME logic in `downloadFolder` for the subtree.
- **(Alternative) Engine exposes `_AUTO_INITS`.** Add a tiny bridge (e.g. `pyodide.runPython` returning the
  relative auto-init paths, or stash them on a JS-readable global on each run) and have the zip include them.
  Rejected as the default: it couples Save to a live Python call + a fresh run's state, and the auto-inits only
  exist after a run — a project saved before its first run would miss them. The JS-derivation is run-independent.

**Decision recorded:** include markers, JS-derived at zip time, never overwriting a user `__init__.py`. This is
an **open question for sign-off** (include-vs-defer): the alternative is to rely on desktop namespace packages
and NOT ship markers (smaller zip, one fewer rule to maintain). Recommendation = include (fidelity > minimalism;
the marker is a zero-byte file and removes a "works in browser, subtly differs on desktop" footgun).

### 5.3 Test
A new save.mjs assertion (or in §7's plan): a project with `sprites/enemy.py` + `main.py`, Save, assert the zip
contains `sprites/__init__.py` as an empty entry, and that a user-authored `sprites/__init__.py` with content is
NOT overwritten.

---

## 6. `.zip`-restore upload (FAST-FOLLOW)

### 6.1 Sketch
The natural inverse of always-zip: drop/select a `pygame-project.zip` (or any zip) and recreate the project.

Detection: the extension router (§4.2) sees `.zip` → branch to `restoreZip(file)` instead of the asset path.

Flow:
1. `await loadJSZip()`; `const z = await JSZip.loadAsync(await file.arrayBuffer())`.
2. Confirm-gate (it REPLACES the project): "Replace your project with the contents of this zip?" — mirror the
   examples/load confirm pattern.
3. Walk `z.files`. For each entry, classify by extension exactly like §4.2:
   - **`.py`** → text (`entry.async("string")`); recreate via `project.add(path, text)` (path = the zip
     entry's path, validated by `isModuleName`). Skip auto-`__init__.py` markers if you want them re-derived,
     OR keep them (harmless; they re-validate as module names).
   - **other** → bytes (`entry.async("uint8array")`); recreate via `assetFS.add` at `path` (S2a nested
     `_memfs` writes the real MEMFS path; `assetStore.put` persists).
4. Honor real subdirs throughout — paths come straight from the zip entry names (`sprites/enemy.py`), so the
   S2a nested-write machinery (`writePath` / `assetFS._memfs` `mkdirTree`) recreates the tree.
5. Set `entry` (prefer `main.py`, else first `.py`), `renderTabs()`, `flushSave()`.
6. Validate + skip unsafe entries: reject `..`, absolute paths, empty segments (reuse `isModuleName` /
   `isAssetPath`); a malformed entry → sys-line + skip, not a hard failure.

Decision sub-points to resolve when built:
- **Replace vs merge.** Recommend **replace** (a zip IS a project) with the confirm; "merge into current" is a
  later nicety that runs each entry through the §4.4 collision suffixing instead.
- **`__init__.py` markers.** If §5 ships markers in the zip, restore should either skip them and let
  `_ensure_init_py` recreate them, or accept them (idempotent). Either is fine; skip-and-recreate keeps a
  single source of truth.

### 6.2 Recommendation: **DEFER to a fast-follow** (don't pull into the first S5 cut)
Reasons: (1) it's net-new (no current code reads zips into the project); (2) it multiplies the test surface
(replace/merge, collisions, malformed/hostile zips, large zips, entry selection); (3) S5's core value
(always-zip out + per-item + routing-in for loose files) lands without it. Pull it into the first cut ONLY on
explicit request. When built, it gets its own RED battery (`test/upload-zip.mjs` or an extension of
`test/upload.mjs`).

---

## 7. TDD test plan

Batteries run individually as `node test/<name>.mjs <url>` against a local static server (the `_harness.mjs`
launches headless Chromium; `acceptDownloads` context for download capture, as `save.mjs` already does). RED
first (write/inverts the assertions, watch them fail), then implement to GREEN. The 6 batteries that must stay
green: `assets.mjs`, `collab.mjs`, `history.mjs`, `lint.mjs`, `multifile.mjs`, `save.mjs` (+ the S2 additions
`subdirs.mjs`, `explorer-tree.mjs`, `examples.mjs`).

### 7.1 `test/save.mjs` — always-zip inversions (LOCKSTEP with §2.2)
Invert the 4 lone-`.py` assertions in the SAME commit as the Branch A deletion:
- **Check 2** (29-37): expect `'pygame-project.zip'`; read the zip (existing `readZip` 66-78) and assert
  `z['main.py']` content equals the editor text (folds in the old 40-42 content check).
- **Check 3** (44-48): renamed lone file → `'pygame-project.zip'` containing `game.py`.
- **Check 4 / Cmd-S** (50-58): focused `Cmd/Ctrl-S` → `'pygame-project.zip'`.
- **Check 5** (60-63): move laziness to **first paint** (`window.JSZip` undefined BEFORE any save) and assert
  it BECOMES defined after the first save.
- Checks 1, 6-9 (button exists; multi-file zip; asset bundling; multi-file+asset; `asset_` collision) stay as-is.

### 7.2 NEW `test/upload.mjs` (or extend `test/assets.mjs`) — routing #6
New battery (recommended separate file; `assets.mjs` is the asset-only contract and several of its checks
assert "everything routes to assetFS" which would now be wrong for `.py`). Assertions:
1. **Route `.py` → code.** `setInputFiles('#assetInput', {name:'helper.py', …})` (or a drop); assert
   `'helper.py' in window.project.files` (NOT in `assetFS.list`), the tree shows a `.py` row, and the editor's
   Doc count grew via `project.add` (assert `window.project.order.includes('helper.py')`).
2. **NEVER setValue for code upload.** Assert lint is NOT armed by the upload (first-paint zero-network
   invariant holds: no JSZip/Automerge/lint network from an upload). Mirror the examples.mjs "no setValue"
   technique (a code path arms lint only on a real edit).
3. **Route image/audio → asset.** Upload a PNG; assert it lands in `assetFS.list` (NOT `project.files`).
4. **Land in the selected folder.** Set `selectedFolder = 'sprites'` (via a folder-row click or
   `window`-exposed seam), upload `enemy.py` + `ship.png`; assert paths are `sprites/enemy.py` (in
   `project.files`) and `sprites/ship.png` (in `assetFS.list`), and MEMFS has the nested files.
5. **Warn + auto-suffix on a same-path clash (code).** With `main.py` present, upload another `main.py`; assert
   the result is `main-2.py` (not an overwrite, not a silent refusal) and a sys console line warned.
6. **Warn + auto-suffix (asset).** With `ship.png` present, upload `ship.png`; assert `ship-2.png` and the sys
   warn. (Proves the UNIFIED helper — both branches suffix identically.)
7. **Cross-namespace clash within a dir.** Upload an asset named like an existing code file at the same path
   (e.g. `data.py` asset while `data.py` code exists) → suffixes to `data-2.py` (the `existsAnywhere` check
   spans code+assets). Complements save.mjs check 9 (which is the zip-time `asset_` prefix, a different layer).
8. **Drop-anywhere still routes** via `#dropOverlay` (synthesize a drop with a `.py` + a `.png`; assert one
   routed to code, one to asset).

Reconcile in `assets.mjs`: any existing assertion that a dropped/selected `.py` becomes an ASSET (if present)
must flip to "routes to code." (Scan `assets.mjs` checks at 25/70/114/130/149/170 — they upload PNG/MP3
fixtures, so they likely DON'T assert `.py`-as-asset; confirm none does before changing. If one does, it
inverts in lockstep.)

### 7.3 Per-item download test (approach — OPEN QUESTION)
The current `save.mjs` proves downloads are capturable via Playwright `page.on('download')` /
`waitForEvent('download')` on a `download`-accepting context. Two viable seams:
- **(A) `page.on('download')`** — click a row's `.dl`, capture the download, assert `suggestedFilename()` and
  (for a folder) unzip via the existing `readZip` helper and assert the subtree. Highest-fidelity (tests the
  real browser download), consistent with save.mjs. **Recommended.**
- **(B) function seam** — expose/stub `downloadBlob` (already a named function) or assert against
  `downloadItem`/`downloadFolder` return values. Lighter but tests the seam, not the browser flow.

Assertions (approach A): `.py` row → bare `<name>.py` with editor content; asset row → bare `<name>.<ext>`
with byte-identical content (reuse `fixtures.mjs` PNG); folder row → `<folder>.zip` whose entries are the
subtree relative to the folder (and JSZip loaded lazily — undefined before the first folder download if no
other zip happened). **Recommendation: A**, in a small new `test/row-download.mjs` (or appended to `save.mjs`,
since it shares the download-context + `readZip` machinery — appending to `save.mjs` is the lower-overhead
option and keeps all download tests together).

### 7.4 Auto-`__init__.py`-in-zip test (if §5 recommendation accepted)
In `save.mjs`: a project with `sprites/enemy.py` + `main.py`, Save, assert `z['sprites/__init__.py'] === ''`
(empty marker present); and a separate case where the user authored `sprites/__init__.py` with content asserts
it is NOT overwritten.

### 7.5 JSZip first-paint laziness (cross-cutting, re-asserted)
Keep a first-paint assertion that `window.JSZip` is undefined on load (moved here from save.mjs check 5's old
spot). Per-item bare-file download and per-item asset download must NOT load JSZip (only the folder-zip and the
toolbar zip do).

### 7.6 Existing assertions to reconcile (summary)
- `save.mjs` checks 2, 3, 4(Cmd-S), 5 — **invert** (always-zip).
- `save.mjs` checks 1, 6, 7, 8, 9 — unchanged (already zip path).
- `assets.mjs` — confirm none asserts `.py`-as-asset; flip any that does.
- `docs/specs/2026-06-23-save-design.md` — superseded re: the lone-`.py` fast-path (note at top of this doc).
- The architecture map (`2026-06-23-redesign-architecture-map.md:111,172,205,249`) references the old check-5
  semantics + Branch A/B — update its prose when S5 lands (doc hygiene, not a test).

---

## 8. Seam preservation + landmines + risks

### 8.1 Seams to preserve
- **JSZip stays lazy** (`loadJSZip` 2509-2519) — loads on first zip (toolbar Save OR folder download), never at
  first paint. Re-asserted (§7.5).
- **The `asset_` zip clash prefix** (2542-2552) is independent of Branch A and STAYS (now path-aware per dir).
  The per-row folder zip + §5 markers reuse the same prefix rule.
- **`downloadBlob`** (2520) is the ONE download primitive — toolbar zip, bare file, bare asset, folder zip all
  go through it.
- **`#saveBtn`** (352, listener 2558) + the `Cmd-S`/`Ctrl-S` keymap (1444-1445) — unchanged wiring; only the
  produced filename flips to always-zip.
- **`#assetInput`** (364) + **`.asset-row`** (asset panel rows 1875) + **`#dropOverlay`** (451) — kept; only the
  drop/change handler BODIES re-route through the new `uploadFiles` router.
- **NEVER `editor.setValue` for code-upload** (landmine b): code uploads reach the editor via `project.add`
  (fresh Doc) + `setActive`/`swapDoc`. `setValue` fires `change` → arms lint → breaks zero-network first paint.
- **ONE CodeMirror** — uploads never create a second editor; `project.add` builds a Doc, the single editor
  `swapDoc`s to it.
- **`window.*` test seams** — `window.project`, `window.assetFS`, `window.renderTabs`, `window.runFile` stay
  the assertion surface; expose `selectedFolder` (or a setter) if §7.2 check 4 needs to drive it headlessly.
- **`assetStore` is the durable byte source** — bare-asset download + zip read from `assetStore.getAll()`, not
  from MEMFS (MEMFS is reconstructed; IndexedDB is the source of truth).

### 8.2 Risks
- **Offline single-file save regresses.** Deleting Branch A means a lone-`.py` save now needs JSZip; offline it
  fails (with a sys-line). Mitigated by the per-row bare-`.py` download (no JSZip). Accepted (verdict #3).
- **`assetFS.add` name override** (§4.4) touches `add`/`_memfs`/`assetStore.put` signatures — keep
  backward-compatible defaults (`name = file.name`) so boot `hydrateAll` and existing callers are untouched.
- **Drop-anywhere vs selected folder.** A page-wide drop uses the CURRENT `selectedFolder`, which may surprise a
  user who expected "drop = root." Mitigation: the sys-line names the final path; revisit drop-onto-a-specific-
  folder-row as a later nicety (out of scope here).
- **`.zip` routing stopgap.** Until §6 ships, a dropped `.zip` falls to the asset path (stored, visible,
  inert). Make sure it does NOT get treated as code.
- **Hostile zip entries (§6, deferred)** — `..`/absolute paths in a malicious zip; the validators
  (`isModuleName`/`isAssetPath` reject `..` and leading `/`) must gate every restored entry.

### 8.3 OPEN QUESTIONS (for sign-off)
1. **Auto-`__init__.py`-in-zip — include vs defer?** Recommendation: **INCLUDE**, JS-derived at zip time, never
   overwriting a user `__init__.py` (§5). Alternative = rely on desktop namespace packages, ship no markers
   (smaller zip). Decision needed because S5 owns the zip.
2. **`.zip`-restore upload — first cut vs fast-follow?** Recommendation: **DEFER to a fast-follow** (§6.2); pull
   into the first cut only on request. Always-zip OUT + loose-file routing IN deliver S5's value without it.
3. **Per-item download test approach?** Recommendation: **(A) `page.on('download')`** (real browser flow,
   reuses save.mjs's download context + `readZip`), appended to `save.mjs` (or a small `row-download.mjs`).
   Alternative = stub the `downloadBlob` seam (lighter, lower fidelity).
4. **New `test/upload.mjs` vs extend `test/assets.mjs`?** Recommendation: **new `upload.mjs`** (assets.mjs is
   the asset-only contract; routing `.py`-to-code would contradict some of its premises). Confirm no assets.mjs
   check asserts `.py`-as-asset before deciding.
5. **`assetFS.add` name-override mechanism** — thread an optional `name` arg (recommended) vs construct a
   renamed `File`? Minor, but it's the cleanest way to land an asset at a suffixed/folder-prefixed path.
