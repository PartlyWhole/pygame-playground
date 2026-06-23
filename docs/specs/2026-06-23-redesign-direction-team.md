# Redesign direction — team input (2026-06-23)

> Concrete layout + behavior direction from the user's team. Supersedes parts of the A/B/C
> comparison and several open-decision defaults. Realized (visual only) in `proto/sandbox.html`;
> we refine each item one-by-one. Engine still untouched; nothing committed/deployed.

## The direction (9 points)

1. **Activity bar = horizontal tab strip at the TOP of the left side panel.** Tabs switch the
   panel content: **Explorer · History · Examples · Collaboration**. (A refinement of prototype C —
   horizontal tabs instead of a vertical icon rail.)
2. **Top toolbar is minimal — Start/Stop only (for now).** Upload + Download move *into* the
   Explorer; Collaborate becomes the activity-bar Collaboration tab.
3. **Examples become editable, runnable FILES** (no popup, no copy button). Editing+saving an
   example promotes it to a real code file that replaces the example. A **reset icon button** (with
   a **confirmation popup**) restores the original default. Recent edits come back via **per-file
   undo** (each file keeps its own history — the project model already gives each file its own
   editor doc + undo).
4. **Explorer delete → confirmation popup**, using one shared confirmation component reused for all
   destructive actions.
5. **Folders in the explorer** — create / name / delete for organization.
   ⚠ **Engine tension:** MEMFS is a single FLAT namespace; `import enemy` and
   `pygame.image.load("ship.png")` resolve by **bare name**. Decide (when we reach this item):
   **organizational folders** (visual grouping; flat + unique names underneath — cheap, engine-safe)
   vs **true subdirectories** (real paths — bigger engine change). Prototype shows folders working;
   underlying model TBD.
   **✅ VERDICT (user, 2026-06-23): TRUE SUBDIRECTORIES + FULL PYTHON PACKAGES.** Real MEMFS paths
   (`sprites/ship.png`), package imports (`from sprites import ship`, `__init__.py`). Non-default, **L**,
   the redesign's **largest de-risk spike** (native MEMFS package imports replacing the bare-name finder;
   paths carried through serialize/load + `#project=` + zip). Gives folders genuine name isolation.
6. **Drag-and-drop** files/folders in the explorer (reorder / move into folders).
7. **Pane resizing** — explorer, code/viewer, game stage, console all resizable.
8. **Pane collapse/expand** — each major pane can be collapsed and restored.
9. **Explorer shows browser storage metrics** — the existing `navigator.storage.estimate` readout
   moves into the Explorer.

## Resolves / updates these open decisions
- **Layout (A/B/C):** → a **C-variant** (horizontal activity bar). `sandbox.html` is the new working direction.
- **#9 Examples:** → editable files with reset+confirm (a *third* option, not copy-to-clipboard nor add-as-new-file).
- **#4 (delete confirm), storage metrics:** → into the Explorer, with a shared confirm popup.
- **Toolbar:** minimal (Start/Stop); upload/download in Explorer; collaborate in activity bar.

## New items the team added (beyond the original 11)
- Folders (with the flat-MEMFS tension above).
- Drag-and-drop in the explorer.
- Pane resize + collapse/expand for all four panes.
- Examples reset-to-default with confirmation + per-file undo guarantee.

## Iteration log — decisions made live on `proto/sandbox.html` (2026-06-23)
These refine/supersede earlier points and the original PM invariants. The sandbox embodies them.

- **Activity bar → vertical icon rail** (far left), icon-only with hover tooltips; **clicking the
  already-open view's icon collapses the panel** (rail stays). Replaced the divider collapse-pill.
- **Icons:** consistent stroke-SVG set everywhere (rail, explorer tree + toolbar, row actions);
  **no visible labels on icon controls — one shared aesthetic hover tooltip** (`data-tip`).
- **Explorer header:** actions (upload/download/new-file/new-folder) merged onto the EXPLORER label row.
- **Per-row download** on every file AND folder (zips the item).
- **Panes:** editor + game stage are **no longer collapsible** (resize only); **console keeps its
  collapse**. **Fullscreen ⛶ on editor, game stage, AND console**, all top-right of their headers.
- **Run model (supersedes "must stop before re-running"):**
  - **Editor header has only `▶ Start`** — runs/restarts the **currently-open file** (works for
    examples). Hidden for non-runnable files (image/sound/text).
  - **Game stage has `⏸ Pause` ⇄ `▶ Resume`** (suspends/continues the loop, frame frozen) **plus a
    small `✕` to fully end** (last frame stays, console kept). Pause/End show only while running.
  - Pause/resume is **feasible in the real engine** (gate `__yield__` on a paused flag — de-risk
    spike later).
  - **✅ VERDICT (user, 2026-06-23): LOCKED — full split model adopted.** Pause/Resume is **kept**
    and **de-risked with a spike (gate `__yield__` on a paused `asyncio.Event`) BEFORE it is built.**
    Supersedes the old "unified Start/Stop, must Stop before re-run" invariant; resolves open-decision #4.
- **Editor ↔ running program are independent** (browse/edit while it runs), **but the running file
  is shown**: a clickable **`▶ running: <file>` badge** on the stage (`⏸ paused: <file>` when
  paused) + the running file **highlighted in the explorer**; clicking the badge jumps to it.
- **Examples render a distinct canned animation each** (so different files look different).
- **Prototype stage is visual-only** — it does NOT execute Python (no engine); canned per-file
  clips are stand-ins. **Decision: leave as-is, unlabeled** (the real Pyodide+pygame engine renders
  actual output when built). Tension to remember when building for real: scenes are illustrative, not execution.

## Still open — to walk through one-by-one (not yet specified by the team)
#1 collab scope (single vs multi-file — de-risked: feasible) · #2 old share-link load paths ·
#3 always-zip vs a `.py` escape hatch · #5 ⌘/Ctrl-Enter (under the new run model) ·
#6 upload routing + name collisions · #10 rename-rewrites-imports · #11 Start/Stop element ids
(the engine seam is `#runBtn`/`#stopBtn` + `_stop()`; new model needs a deliberate mapping) ·
folder model (organizational vs true subdirs) · examples promote-on-edit vs explicit-save · collab tab scope.
(#4 "re-run after finish" is resolved by the new run model: Start always re-runs the open file.)
