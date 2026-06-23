# Redesign — decision context map (engine-verified)

> Built 2026-06-23 by a fan-out "understand" pass (5 readers over the architecture map + `index.html`
> + `proto/sandbox.html` + the de-risk reports, then synthesis). **Every line ref below was
> re-confirmed against `index.html` directly.** This is the per-decision SEAM MAP that complements the
> architecture map: for each open fork it records the framing, options, what the prototype already
> settles (so we don't re-litigate UI), the exact engine constraint/seam, and the recommendation.
> Verdicts are recorded in `2026-06-23-redesign-open-decisions.md`; this doc is the reasoning + seams.

## ✅ Verdicts applied (2026-06-23) — these OVERRIDE the ★ defaults below where they differ
Full verdicts live in `2026-06-23-redesign-open-decisions.md`. Where a verdict diverged from this map's ★,
the verdict wins:
- **run-model:** full split model; Pause/Resume **kept** + spiked before building.
- **folder-model:** ★ was organizational — **OVERRIDDEN → TRUE SUBDIRECTORIES + FULL PYTHON PACKAGES**
  (real paths, `__init__.py`, dotted imports). The redesign's largest spike.
- **collab-scope:** ★ was ship-single-file — **OVERRIDDEN → BUILD THE MULTI-FILE ROOM NOW** (synced doc
  must carry folder paths; re-validate the path-bearing CRDT shape in a spike).
- **always-zip-save:** ★ was pure always-zip — **adjusted → always-zip project Download + a per-item bare
  single-file download** (option B).
- **keyboard-shortcut:** ★ was Enter=Start — **OVERRIDDEN → DROP the run shortcut** entirely.
- **share-link-load-paths:** ★ was keep-read-only — **OVERRIDDEN → REMOVE the legacy `#code=`/`#project=`
  readers too** (keep `#room=`; grep tests for `#project=` setup before removal).
- **upload-routing** (by-extension + warn/suffix into selected folder; `.zip`-restore = fast-follow),
  **examples-promote** (promote-on-edit), **start-stop-ids** (keep both), **rename-imports** (warn-only),
  **collab-view-scope** (reuse seams + per-file presence): as ★.

## Walk order & dependencies
`run-model` → `start-stop-ids` · `keyboard-shortcut` (gated by run-model) · **`folder-model`** →
`upload-routing-collisions` · `rename-imports` (gated by folder-model) · `always-zip-save` ·
`examples-promote-semantics` · `collab-scope` → `collab-view-scope` (gated by collab-scope) ·
`share-link-load-paths`.

**Decide `run-model` (✅ done) and `folder-model` FIRST — they unblock the most downstream items.**

### Genuine product forks needing a verdict
`folder-model` (biggest engine fork), `collab-scope` (single vs multi-file investment),
`upload-routing-collisions` (depends on folder-model), `always-zip-save` (breaks 4 test assertions),
`share-link-load-paths` (keep vs drop legacy readers), `keyboard-shortcut` (⌘Enter scope).
`run-model` + `examples-promote-semantics` are proto-EMBODIED but warrant a quick CONFIRM because they
change engine/persistence behavior.

### Settled / engineering-FYI (no verdict needed, still listed)
`start-stop-ids` (keep both ids behind the chrome), `collab-view-scope` (reuse existing seams; rides
collab-scope), `rename-imports` (status quo by omission; rides folder-model).

### Doc conflicts to remember (don't re-ask the obsolete framings)
1. open-decisions **#9** (examples copy-to-clipboard vs add-as-new-file) is **OBSOLETE** — the team
   chose a *third* option: editable promote-on-edit files. The live decision is `examples-promote-semantics`.
2. open-decisions **#4** (re-run after finish) is **RESOLVED** by the new run model.
3. open-decisions **#5/#11** were framed under the OLD single-button model — re-interpret: "primary
   action" = Start; `#stopBtn` now homes the End/Pause action.
4. direction-team's **"9 points"** body is superseded by its own **Iteration Log** — cite the log + proto.

### Cross-cutting engine landmines (recur across decisions)
- **(a) Flat MEMFS namespace.** Code + assets share bare names in one `/home/pyodide` dir. Underlies
  `folder-model`, `upload-routing-collisions`, and the save-time `asset_` prefix. Organizational folders
  do **not** create real isolation — same bare name still collides. Name this UX-truth gap if folders
  are meant to imply isolation.
- **(b) The lint-arming `setValue` trap.** Every path that touches the editor (examples promote, code
  upload, reset, preview) MUST use `swapDoc` / `project.load` / `project.add`+`setActive` — **never
  `editor.setValue`**, which fires `change` → eager-arms lint (`editor.on('change', armLint)` at
  index.html:1168) → breaks first-paint zero-network laziness. Spans `examples-promote-semantics` +
  `upload-routing-collisions`.
- **(c) Lazy-load invariants.** JSZip loads on first SAVE, Automerge on first ROOM — never at first
  paint. Preserve across `always-zip-save` and the collab decisions.

---

## run-model — ✅ LOCKED (full split model; Pause/Resume spiked before building)
- **Framing:** editor-header `▶ Start` (runs/restarts open file) + stage `⏸ Pause ⇄ ▶ Resume` + `✕ End`,
  shown only while running; editor independent of the running program.
- **Engine:** PROVEN buildable. One global task slot `_state['task']` (index.html:566) = exactly one
  program; `__yield__` (619-631) is the **single** cooperative-frame chokepoint shared by BOTH single-file
  and project engines — ONE `asyncio.Event` gate covers both. Pause = event-wait at top of `__yield__`
  (freezes last frame like Stop, task stays live so re-run stays blocked while paused). End = existing
  `_stop()` (765-770), no Python change. Start = today's `run()` (1814-1818). `'paused'` is a
  purely-additive status token (every battery gates exact strings — add, don't break).
- **Caveats:** pause granularity is per-cooperative-frame (a pure-compute loop yields every 256 iters; a
  no-loop program never yields). "Start restarts the OPEN file" = single-file `_start(editor.getValue())`;
  multi-file today always runs `project.entry`, so "restart the open file" for a multi-file project is
  net-new dispatch, not reuse.

## start-stop-ids — FYI, keep both ids (no verdict)
Keep `#runBtn` (Start) + `#stopBtn` (homes End/Pause) as the click targets behind the new chrome —
preserves ~50 test sites (26 direct click sites), zero lockstep churn. `#runBtn`→`run()` (1845);
`#stopBtn`→`_stop()` (1846-1848). Pause/Resume can carry a new additive id (no test gates it yet).

## keyboard-shortcut — ⌘/Ctrl-Enter = Start (re-run open file) ★, needs verdict
Today ⌘/Ctrl-Enter → `run()` (1031). Under the split model "primary action" collapses to Start (no single
button flips to Stop). Recommend Enter = Start only (no-op while a task is live); leave Pause/End to the
stage controls — one key→four states is ambiguous. Trivial re-home onto the Start guard.

## folder-model — organizational (UI-only) ★ vs true subdirs, needs verdict
- **Proto settles** the folder UI (create/name/delete, carets, drag-reorder + move-into-folder with
  descendant-guard, inline rename, per-row download). Only the **namespace truth** (flat vs paths) is open.
- **Engine:** ONE flat `/home/pyodide` dir, bare unique names shared by code AND assets. No `chdir`;
  `_run_project` writes `os.path.join(cwd, fname)` with bare `fname` keyed by flat STEM (947-951);
  `_ProjectFinder` matches bare `fullname` (no dotted-path machinery — `import folder.enemy` would NOT
  resolve); assetFS writes bare names (1276); `isModuleName = /^[A-Za-z_][A-Za-z0-9_]*\.py$/` forbids `/`
  (1075-1076). **Organizational = ZERO engine change** (imports, `image.load`, writes/unlinks, regex, JS
  model keys, assetStore keyPath, localStorage + `#project=` share formats all unchanged). **True subdirs
  = L cross-cutting**: package-aware import finder (`__init__.py`), nested asset bridge, every
  write/unlink/reconcile path (`mkdirTree`), `isModuleName`, JS model keys, 3 persistence/share formats +
  test fixtures — plus user code must carry paths. Multi-file design doc lists folders/packages as an
  explicit **v1 NON-GOAL**.
- **Caveat to surface:** organizational folders do NOT create MEMFS isolation — a code file and an asset
  with the same bare name still collide in one dir (ties to upload collision policy).

## upload-routing-collisions — by-extension + warn-and-suffix ★, needs verdict (depends folder-model)
- **Proto:** uploadBtn is a mock (pushes `uploaded.png` to root) — net-new.
- **Engine:** three upload paths funnel to `assetFS.addFiles` (#assetInput change 1386-1388; #dropOverlay
  1396-1399; hydrateAll boot). **The two add-helpers DISAGREE:** `assetFS.add` (1285-1297) silently
  **OVERWRITES** by bare name; `project.add` (1097-1102) **REFUSES** (returns false on dup/invalid) and
  does NOT swapDoc/renderTabs (caller must). Live MEMFS is flat+shared, so an asset CAN clobber a `.py` at
  runtime today; the only existing collision handling is the save-time `asset_` zip prefix (1677, zip-only).
- **Recommendation:** route `.py`→`project.add` (validated), images/audio/other→`assetFS.add`; keep
  drop-anywhere + overlay; **warn + auto-suffix** (`ship-2.png`) applied **consistently to BOTH helpers**
  (stop the disagreement). Code-upload must reach the editor via `project.add` (fresh Doc), never `setValue`.

## rename-imports — FYI, keep warn-don't-rewrite (no verdict; rides folder-model)
`project.rename` (1103-1111) unlinks old bare name (`FS.unlink` guarded by `analyzePath().exists`),
re-keys JS model; inline reminder (~1551) warns imports aren't rewritten. Auto-rewrite = L (AST/string
rewrite across Docs) and compounds badly with true subdirs. Keep status quo.

## always-zip-save — pure always-zip ★, needs verdict (breaks 4 test assertions)
- **Engine:** `saveProject` (1662-1683); Branch A bare-`.py` fast path (1664-1667) fires only when
  `!isMulti()` AND zero assets (via `downloadBlob`, no JSZip). Always-zip = delete Branch A. JSZip stays
  lazy (`loadJSZip` 1643-1653, one-shot cached) — loads on first SAVE, never first paint.
- **Test impact (test/save.mjs):** check 2 (line 36 `suggestedFilename==='main.py'`), check 3 (41 `.py`
  content), Cmd-S check (51-57), check 5 (60-63 laziness) all break/INVERT — check 5 flips from "JSZip
  undefined AFTER a `.py`-only save" to "absent at first paint, present after first save." Update in
  lockstep. `asset_` zip-prefix path (1675-1679) is independent and stays.

## examples-promote-semantics — promote-on-edit ★, quick CONFIRM (changes persistence)
- **Proto settles** promote-on-edit: first edit → `markModified`→`promoteExampleToTree`; `●` dot in
  Examples + Explorer; per-example reset `↺` (shared-confirm) restores `EXAMPLES[name]`; each example owns
  its own undo/redo (reset is itself undoable). Panel note "editing makes it your file." **Supersedes
  open-decisions #9.**
- **Engine:** net-new. `project.files = name→CodeMirror.Doc` (1078); each Doc carries its own undo, so
  per-file undo is free once promoted. Build via **Doc-adoption + swapDoc / project.add+setActive — NEVER
  `editor.setValue`** (landmine b). `EXAMPLES` (189-1011) KEPT as immutable source for preview + reset;
  old destructive change handler (1686-1696) + `loadedExample` (1560) become dead code. Reset = confirm →
  re-load `EXAMPLES[name]` (fresh Doc = fresh undo); snapshot-first to make the reset undoable.

## collab-scope — ship single-file now ★, multi-file pre-validated fast-follow, needs verdict
- **De-risk VERDICT: multi-file is FEASIBLE** (spike 12/12 live vs `wss://sync.automerge.org`, 13/13
  offline; `{files,order,entry}` mirrors `project.serialize/load`). CRDT risk RETIRED; residual is
  UI-integration: two L items — #4 `bindEditor` multi-file reconciliation (1870-1895, today hardwired to
  `['code']` + one CM) and #5 structural file-ops to `handle.change()` (1524-1558) — plus M items
  (rename=copy-and-delete loses char history; per-file presence; joinRoom adopt; restore-in-room).
- **Recommendation:** ship single-file (`{code:string}`, 1978) now; invest ~1.5–2.5 eng-weeks **with the
  two-peer tests** only on demonstrated demand. A half-finished multi-file room (gates relaxed
  inconsistently at renderTabs 1513 + run() 1814, reconciliation untested) is worse than today's honest
  single-file room. If built: revise `2026-06-18-collab-sharing-design.md` (lines 26, 47-51).

## collab-view-scope — FYI, reuse existing seams (no verdict; rides collab-scope)
Proto settles the two-state view (idle explainer + "Start a room"; active roster + read-only room link +
Copy link + Leave) and that the Share LINK button is GONE. All seams exist: `startRoom()` (1966),
`#room=`→`joinRoom()` (1564/1985), `setLive(state,peers)` (1862-1867), `startPresence`(1903)/`renderPeers`
(1918), `copyRoomLink` (2007-2009, shares the LIVE `#room=`, not a static snapshot). Solo path must keep
loading ZERO Automerge (`__amLoaded` falsy). Per-file presence only matters if collab-scope=multi-file.

## share-link-load-paths — keep readers read-only ★, needs verdict
- **Proto settles** the toolbar Share button is GONE. Fate of the legacy LOADERS is boot-parse logic, not
  visual — open.
- **Engine:** removal is PAIRED — `#shareBtn` markup (156) + listener (1623-1638) must delete **together**
  or `getElementById('shareBtn').addEventListener` throws at boot (no battery references `#shareBtn`,
  removal is test-safe). Two consume sites read `#code=`/`#project=`: boot `loadInitialProject` (1568-1579,
  precedence `#room`>`#project`>`#code`>saved>legacy>default) and hashchange (1602-1621, guarded by
  `collab.active` + confirm). **Keep-read-only (A)** = leave both loaders, remove only the button (≈free).
  **Drop (B)** = remove both consume sites. `#room=` kept either way.
