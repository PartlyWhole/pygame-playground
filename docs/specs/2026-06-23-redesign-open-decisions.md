# Redesign — open decisions for the team

> Companion to the A/B/C layout choice. These are **layout-independent** forks: they can be
> decided in the same conversation as the layout, and they unblock the implementation slices.
> Each has a recommendation so the default path is clear. Nothing here is committed or deployed.
> Cross-refs: [architecture map](2026-06-23-redesign-architecture-map.md) · multi-file collab
> de-risk report (in progress → `2026-06-23-multifile-collab-derisk.md`).

Legend: **★ = my recommendation.** Effort S/M/L is implementation size, not including tests.

---

## ✅ Recorded verdicts (decision walk — 2026-06-23, with the user)
> Updated live as each fork is decided, one at a time. The quick-decide table at the bottom mirrors these.

- **Run model (re-confirm + Pause/Resume scope).** ✅ **LOCKED — full split model.** ▶ Start in the
  editor header (runs/restarts the open file); ⏸ Pause ⇄ ▶ Resume + ✕ End on the game stage; editor
  independent of the running program (`▶ running: <file>` badge); re-run allowed whenever no live task.
  **Pause/Resume is kept**, and **de-risked with a spike (gate `__yield__` on a paused `asyncio.Event`)
  BEFORE it is built.** Supersedes the old "unified Start/Stop, must Stop before re-run" PM invariant
  and resolves #4. Engine seam mapping → #11.

- **Folder model (organizational vs true subdirectories).** ✅ **TRUE SUBDIRECTORIES** (deliberate
  non-default). Folders become **real MEMFS paths** (e.g. `sprites/ship.png`), not just UI grouping —
  this turns the multi-file v1 "no folders/packages" **non-goal into scope**. It is an **L** engine
  change and **requires its own de-risk spike BEFORE building** (nested write/unlink paths via
  `mkdirTree`, path-aware resolution, the `isModuleName` regex that forbids `/`, JS model keys, and the
  three persistence/share formats + test fixtures). Side effect: real paths give folders **genuine name
  isolation**, which changes the upload-collision rule (#6).
  - **Import depth: ✅ FULL PYTHON PACKAGES.** `from sprites import ship` with `__init__.py` and
    package-aware/dotted-path resolution; assets load by real path (`pygame.image.load("sprites/ship.png")`).
    This is the **largest spike** in the redesign: likely **replace the custom bare-name `_ProjectFinder`
    with native MEMFS package imports** (real dirs on `sys.path` + `__init__.py`), expand `isModuleName`
    to accept paths, and carry paths through `serialize`/`load`, the `#project=` share format, and the zip
    download/upload. **Build nothing here until the package-imports spike is green.**

- **Collaboration scope (#1).** ✅ **INVEST IN THE MULTI-FILE ROOM NOW** (non-default). Per-file CRDT
  room (`{files, order, entry}`, mirrors `project.serialize/load`) so peers edit different files live.
  CRDT risk already retired by the spike (12/12 live); residual cost is UI-integration: **~1.5–2.5
  eng-weeks WITH two-peer browser tests**, incl. the two L items — `bindEditor` multi-file reconciliation
  (index.html:1870-1895) and structural file-ops routed to `handle.change()` (1524-1558) — plus M items
  (rename = copy-and-delete, per-file presence, joinRoom adopt, restore-in-room). **Interaction with the
  folder verdict:** the synced doc must now also carry **folder paths** (the spike validated *flat* names)
  — re-validate the path-bearing shape in the multi-file-collab spike. The collab roster gains **per-file
  presence**. Revise `2026-06-18-collab-sharing-design.md` (lines 26, 47-51 lock the old single-file shape).

---

## 1. Collaboration room scope — single-file vs multi-file
**Today:** the Automerge room is a single `{ code: string }` CRDT (one file). Multi-file projects
collaborate by seeding only the entry file (with a confirm).

- **A. Keep single-file room** (entry-file only, as today). Effort: S (mostly leave as-is).
- **B. Invest in a multi-file room** (per-file CRDT, two students edit different files live).
  Effort: **~1.5–2.5 engineer-weeks** (2×L, 3×M, 5×S — incl. two-peer browser tests).

**De-risk verdict (✅ done — [report](2026-06-23-multifile-collab-derisk.md)):** **FEASIBLE.** A green
spike (`test/spike-collab-multifile.mjs`, **12/12 live** against `wss://sync.automerge.org` + 13/13
offline) proved the proposed shape `{files:{[name]:text}, order, entry}` (which mirrors
`project.serialize()/load()`) syncs and merges across two real peers: concurrent edits to *different*
files converge, added files propagate, order/entry stay consistent. The CRDT risk is **retired**;
residual cost is **UI-integration** (the two L items: `bindEditor` multi-file reconciliation, and
structural file-ops to the shared doc), not collaboration feasibility. One gotcha found: `updateText`
can't create a new map key — add-file must be a plain assignment.

**★ Recommendation:** **Ship single-file now** (it's correct and honest today), and treat multi-file as
a **pre-validated fast-follow** — invest when users actually hit the "share only your entry file" wall
*or* the redesign commits to multi-file as first-class anyway, *and* there's capacity for the two L
items **with their two-peer tests**. A half-finished multi-file room (gates relaxed inconsistently,
reconciliation untested) is worse than today's honest single-file room. If built: revise
`2026-06-18-collab-sharing-design.md` (lines 26, 47–51 lock the old shape) and document rename
semantics (single-transaction copy-and-delete, accept minor keystroke loss).

**✅ VERDICT (2026-06-23): B — invest in the multi-file room NOW** (see recorded verdicts at top). The
synced doc must additionally carry **folder paths** per the folder/packages verdict; roster gains
per-file presence.

- **Always-zip Save (#3).** ✅ **Always-zip the whole-project Download + keep a single-file download**
  (option **B**). Toolbar **Download = `pygame-project.zip` always** (one model: "Download = my project");
  the **per-item (row) download gives the item itself** — a bare `.py`/asset for a single file, a zip for
  a folder. (Refines the proto, whose per-row download zipped everything.) JSZip stays lazy; the 4
  `test/save.mjs` assertions for the old top-level bare-`.py` path invert in lockstep.

- **Upload routing + collisions (#6).** ✅ **By-extension routing + warn-and-auto-suffix, into the
  selected folder.** `.py` → `project.add` (validated); images/audio/other → `assetFS.add`; land in the
  selected folder (root default); a same-*path* clash warns + auto-suffixes (real subdirs make collisions
  path-scoped). Code-upload reaches the editor via `project.add` (fresh Doc), **never `setValue`**.
  **`.zip` upload that restores folder structure = FAST-FOLLOW** (pairs with always-zip; pull into the
  first cut on request).

- **Examples promote-on-edit (supersedes #9).** ✅ **Promote-on-edit.** First edit materializes the
  example as a real project file (`●` modified dot); per-file undo; `↺` reset-to-default behind the shared
  confirm. Built via Doc-adoption + `swapDoc`, **never `setValue`**. Old #9 (copy-to-clipboard vs
  add-as-new) is obsolete.

- **Keyboard shortcut (#5).** ✅ **DROP the run shortcut** (non-default). No ⌘/Ctrl-Enter run binding under
  the new model — remove the existing binding (index.html:1031); running is mouse-driven via the editor
  Start + stage controls. No run keyboard hint needed.

- **Old share-link load paths (#2).** ✅ **REMOVE the readers too** (non-default — option B). Delete the
  `#shareBtn` markup + listener AND both `#code=`/`#project=` consume sites (boot `loadInitialProject`
  ~1570-1573 + hashchange ~1606-1620). **`#room=` (live collab) is kept.** Old packed-project share links
  will stop opening — accepted. ⚠ **Build caveat:** grep tests/spikes for any setup that loads via
  `#code=`/`#project=` and update in lockstep before removal.

---

## 2. Fate of the old share-link *load* paths
We're removing the 🔗 Share **button** + its handler regardless. Separately: the app still *reads*
`#code=` / `#project=` hash links (so old shared links open). `#room=` is kept either way.

- **A. ★ Keep the load paths read-only** — delete the producer (Share button), keep the consumers so
  already-shared links in the wild still open. Effort: S. No broken links.
- **B. Drop the load paths too** — cleaner code, but any link a student already shared stops working.

**★ Recommendation:** A. Removing the button stops *new* share links; keeping the reader costs almost
nothing and avoids breaking links people already sent. Revisit later if we want the cleanup.

---

## 3. Always-zip Save — pure zip vs single-`.py` escape hatch
**PM ask:** Download = one action that zips the whole project. Today a lone `.py` with no assets
downloads as a bare `.py`.

- **A. ★ Always zip** (`pygame-project.zip` even for one file). Effort: S (delete the fast-path).
- **B. Always zip, but keep a secondary "download .py" for single-file projects.** Effort: S–M, more UI.

**★ Recommendation:** A. Matches the PM ask and keeps one mental model ("Download = your project").
The cost is a single-file student gets a zip with one `.py` inside — acceptable, and it round-trips as a
real desktop project. (JSZip stays lazy: it loads on first Save, never at first paint.)

---

## 4. Unified Start/Stop — re-run UX after a program *finishes*
One button. While a program is **running**, the only option is Stop (no run-while-running). Question:
once a program **finishes or is stopped** (no live task), what does the button do?

- **A. ★ Button returns to "Start", re-run allowed.** Running → Stop; ready/finished/stopped → Start.
  Only block Start while a task is genuinely live.
- **B. Require an explicit reset before re-running.** More clicks, no real benefit.

**★ Recommendation:** A. "Finished" isn't "running," so Start (= run again) is the natural next action.
We gate Start only on a live `_state['task']`; a fresh Start clears the console; the last frame stays
frozen until then.

**✅ VERDICT (2026-06-23):** resolved by the locked split run model — Start (editor header) re-runs the
open file whenever there is no live `_state['task']`. See recorded verdicts at top.

---

## 5. Keyboard shortcut under the unified control
Today ⌘/Ctrl-Enter = Run.

- **A. ★ ⌘/Ctrl-Enter = the primary action** (Start when idle; Stop when running) — mirrors the button.
- **B. ⌘/Ctrl-Enter = Start only** (ignored while running).
- **C. Drop the shortcut.**

**★ Recommendation:** A. One muscle-memory key that always does the obvious thing. The keyboard hint
copy gets re-homed in the new toolbar regardless.

---

## 6. Upload routing + name collisions
Upload should accept **code and assets** (capability 5). Today upload only creates assets.

- **Routing — ★** route by extension: `.py` → `project.add` (a code file, validated as a module name);
  images/audio/other → `assetFS.add` (asset). Keep drop-anywhere + the drop overlay.
- **Collision (same bare name)** — MEMFS is one flat namespace shared by code + assets. If an uploaded
  name collides with an existing file: **★** warn and auto-suffix (e.g. `ship-2.png`) rather than
  silently overwrite. (Export already disambiguates via the `asset_` prefix.)

**★ Recommendation:** extension-based routing + warn-and-suffix on collision. No subdirectories
(folders would break `pygame.image.load("ship.png")` by bare name).

---

## 7. Explorer visibility — always-on vs only-when-multi
Today the file UI (tab strip) appears only with ≥2 files. The new explorer also hosts **assets**, so it
has content even for a single-file project.

- **A. ★ Always-on explorer** (VS-Code style; shows files + assets even with one `.py`).
- **B. Only-when-multi** (hidden for a lone file with no assets).

**★ Recommendation:** A. It's the new home for uploads/assets/new-file, so it should always be present.
Note: a test currently asserts "tab strip absent in single-file mode" — we reconcile that assertion in
lockstep (it's testing the *old* tab behavior).

---

## 8. "Save" semantics in the explorer
The project **already autosaves** (debounced to localStorage). So what does an explicit "Save" mean?

- **A. ★ "Save" = Download the project zip** (i.e. there is no separate per-file save; the explorer's
  save action *is* Download). Autosave keeps the working copy; Download is how you take it with you.
- **B. Add an explicit per-file "save to disk"** in addition to autosave + Download. More concepts, little gain.

**★ Recommendation:** A. Avoid a confusing third concept. "Your work is always saved (locally);
**Download** gives you the project as a zip." `.py` editing autosaves; images/audio aren't editable.

---

## 9. Examples popup — copy-to-clipboard vs copy-into-a-new-file
The examples popup is **read-only** and must never overwrite the editor (hard invariant).

- **A. ★ Copy to clipboard** (student pastes where they want). Simplest, zero risk to their work.
- **B. "Add as a new file"** (creates `bouncing_ball.py` via `project.add`). Convenient, but more wiring
  and a naming/collision question.

**★ Recommendation:** A now (copy-to-clipboard), with B as an easy later addition if teachers want it —
B must route through `project.add`, never `editor.setValue` (which would arm lint + overwrite).

---

## 10. Rename behavior (unchanged, confirm)
Renaming a file does **not** rewrite `import` statements in other files (the app shows an inline
reminder). **★ Keep this** — auto-rewriting imports is a bigger feature and out of scope.

---

## 11. Unified Start/Stop — DOM seam (engineering, FYI)
~50 test sites click `#runBtn` / `#stopBtn`. Two implementation options: (A) ★ keep both ids as the
click targets *behind* the single visible control, or (B) introduce one new id and update every battery
+ spike in lockstep. **★ Recommendation:** A (keep the ids) — preserves the test surface with no
lockstep churn; the visible control just shows whichever is active. This is a build detail, not a
product decision — noted so nothing surprises you.

---

### Quick-decide summary (defaults)
| # | Fork | Default (★) |
|---|------|-------------|
| 1 | Collab scope | ✅ INVEST in multi-file room NOW (per-file CRDT; + folder paths; ~1.5–2.5 wks w/ two-peer tests) |
| 2 | Old share-link load paths | ✅ REMOVE readers too (keep `#room=`); old packed links stop opening |
| 3 | Always-zip Save | ✅ Always-zip project Download + per-item bare single-file download (option B) |
| 4 | Re-run after finish | ✅ Start re-runs (gate only while live) — part of the LOCKED split run model |
| 5 | ⌘/Ctrl-Enter | ✅ DROP the run shortcut (running is mouse-driven) |
| 6 | Upload routing | ✅ by extension; warn+suffix into selected folder; `.zip`-restore = fast-follow |
| 7 | Explorer visibility | always-on |
| 8 | "Save" meaning | = Download zip (autosave keeps working copy) |
| 9 | Examples popup | ✅ promote-on-edit (supersedes copy-to-clipboard; editable files + reset+undo) |
| 10 | Rename + imports | keep warn-don't-rewrite |
| 11 | Start/Stop ids | keep `#runBtn`/`#stopBtn` behind one control |

With the collab de-risk now in, if the team is happy with the ★ defaults the **only decision that truly
needs a verdict is the A/B/C layout**. Collab scope (#1) has a clear default — single-file now,
multi-file as a pre-validated fast-follow — and everything else rides the defaults.
