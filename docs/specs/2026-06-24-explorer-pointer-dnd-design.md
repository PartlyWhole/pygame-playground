# Request #11 — pointer-events drag-reorder (files + folders) — design

## 0. Context & decision
Follow-up to #6 (drag-reorder), which regressed in real browsers. **Root cause (systematic-debugging
Phase 1):** the feature is built on **native HTML5 drag-and-drop**, which is (a) fragile — `clearDropMarks()`
runs every `dragover` and the drop-line is inserted into the DOM mid-drag, so hovering the 2px line removes it
and DOM mutation shifts rows under the cursor; (b) **structurally incomplete** — folders render alphabetically
and only files have an order (`project.order`), so folders can't be reordered and cross-directory file reorder
is a no-op; and (c) **untestable in headless** — confirmed: a real mouse-gesture in headless Chromium fires
ZERO native-DnD events, which is exactly why #6's synthetic-`DragEvent` tests gave false confidence.

**User decision (2026-06-24): pointer-events rewrite, files + folders reorderable.** Replace native DnD with a
pointer-events drag controller (reliable cross-browser, headless-testable) and add explicit folder ordering.

## 1. Goal / observable behavior
- Drag any file or folder row in `#tabs` to **reorder** it among its siblings (files among files, folders among
  folders, within the same parent directory), or **drop it onto a folder** to move it in. Works reliably in real
  browsers; a calm drop indicator shows where it will land.
- A short movement threshold distinguishes a *drag* from a *click* (click still selects/opens; the `⋯` menu and
  inline rename/create inputs never start a drag).
- Reordering persists (`flushSave`) and mirrors into a collab room.

## 2. Model change — explicit folder ordering (low-ripple)
Keep `project.order` (the **files** order) UNTOUCHED to avoid disturbing its many consumers (serialize, collab
`d.order`, mirrorMove, the file-reorder splice). Add a SEPARATE, additive:
- **`project.dirOrder`** — an array of folder paths in desired render order.
- `buildTree`'s `emit()` orders each node's child dirs by their index in `dirOrder` (fallback: alphabetical for
  dirs not listed — preserves today's behavior for un-reordered/old projects). Files within a node stay ordered
  by `project.order` (unchanged). **Folders-first, then files** within each directory (familiar, VS-Code-like).
- Folder ops maintain `dirOrder`: `addFolder` appends; `rename`/`move` re-key the entry (and descendants' entries);
  `remove` drops it (+ descendants).
- **serialize/load**: include `dirOrder` (default `[]`). Back-compat: an older record without `dirOrder` → folders
  render alphabetical (today's behavior). **collab**: add `dirOrder` to the shared doc shape (LWW array, like
  `order`); encode/decode re-key folder paths the same way `order` file paths are encoded.

### Implementation notes (R1, as built — two deliberate deviations from the prose above)
1. **`dirOrder` is LOCAL-only, NOT collab-mirrored** — modeled exactly on `emptyDirs` (which the v1 shared doc
   already drops). The collab doc shape stays `{files, order, entry}`, so there is **zero collab-schema change**
   and every collab/round-trip battery is unaffected. `serialize`/`load`/`deserializeProject` carry `dirOrder`
   (default `[]`); `encodeProject`/`docToRecord` do not. (A collab reconcile resets local folder order to
   alphabetical — identical to how empty folders are not mirrored. Acceptable for v1.) This supersedes the
   "add `dirOrder` to the shared doc shape" clause above.
2. **`addFolder` does NOT seed `dirOrder`** (it does not "append"). With the alphabetical-fallback comparator
   (`dirOrder` index else `+Infinity`, then name), seeding on create would make a brand-new folder sort to the
   *top* (index 0, ahead of unlisted alphabetical siblings) — a position jump, and a behavior change for
   un-reordered projects that contradicts the "preserves today's behavior" guarantee. `dirOrder` is populated
   only by an explicit reorder (R2). `move`/`rename` re-key its entries (+ descendants) and `remove`/delete drop
   them, so a reordered folder keeps its position through those ops. `serialize` also prunes `dirOrder` to
   folders that still exist (hygiene). No existing battery asserts created-folder order; this is the
   behavior-preserving reading the spec's own guarantee requires.

## 3. The pointer-events drag controller (replaces the native-DnD block)
Replace the entire `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` block + `draggable="true"` on rows.
- **Start:** `pointerdown` on a `.tab` row (NOT on `.tab-menu`, `.dl`-less now, or an `input`) records the path +
  start (x,y). On the first `pointermove` past a ~5px threshold, begin dragging: `setPointerCapture`, add a
  `.dragging` class to the source (dim), create ONE persistent drop-indicator element (reused, not rebuilt every
  move — avoids the thrash).
- **Move:** compute the drop target from the cursor Y over the rendered rows (NOT from `e.target`): find the row
  whose rect the cursor is in (or nearest); decide intent — over a **folder row's middle** → *move-into* (highlight
  the folder); over a row's **top/bottom half** → *reorder before/after* (position the single drop-indicator line).
  Auto-scroll the panel when near its top/bottom edge. This cursor-Y computation is the robustness fix.
- **End:** `pointerup` → apply via the model: reorder a file in `project.order`, a folder in `project.dirOrder`
  (within the same parent), or move-into-folder (`project.move` / `assetFS.move` for assets). Then `renderTabs` +
  `flushSave` + collab mirror. `Escape`/`pointercancel` → abort cleanly (remove indicator + `.dragging`).
- **Scope v1:** assets keep *move-into-folder* (via `assetFS.move`); asset *reorder* is out of scope (assets have
  no order). Cross-directory **move-and-position** (drop a file into folder X at a spot) = move into X (position
  within X is a follow-up; v1 lands it in X at the natural spot).

## 4. Test strategy (the point of the rewrite — now headless-testable)
Pointer events ARE dispatchable in headless Playwright (`page.mouse.move/down/up` fire real `pointerdown/move/up`),
so the drag is now genuinely exercised end-to-end (unlike native DnD). New/updated battery `test/explorer-dnd.mjs`
(or extend `explorer-tree.mjs`) drives `page.mouse` gestures and asserts the MODEL + RENDER + persistence:
- file reorder within a dir (mouse drag B above A → `project.order` + rendered rows + reload).
- **folder reorder** (drag folder Z above folder A → `dirOrder` + rendered folder order + reload). ← the new capability.
- move file/folder into a folder (drag onto a folder row → path re-keyed).
- threshold: a click (down+up, no move) still selects/opens; the `⋯` button doesn't start a drag.
- abort: Escape mid-drag leaves the model unchanged.
- Model-only unit checks for `dirOrder` (buildTree render order, folder ops maintain it, serialize round-trip).

## 5. Seams to preserve
`project.order` semantics + serialize/load shape (add `dirOrder`, don't break existing keys); `#status` tokens;
`renderTabs` row seams (`.tab[data-name]`, `.tab.folder[data-path]`); the `⋯` menu + inline rename/create
(must not be hijacked by the drag-start); collab convergence (extend, don't break). No `editor.setValue`.

## 6. Slices (green-checkpointed; TDD)
- **R1 — folder-ordering model:** `project.dirOrder` + `buildTree` render-by-dirOrder + folder ops + serialize/
  load/collab. Headless model/render tests (no drag yet). Folders become orderable *in the model*.
- **R2 — pointer drag controller:** replace native DnD; file + folder reorder via `page.mouse` gestures + drop
  indicator + click/menu coexistence + abort. Headless pointer-gesture tests.
- **R3 — move-into-folder via pointer (files/folders/assets) + remove native-DnD remnants + adversarial review.**

## 7. Out of scope (v1)
Asset reordering; ~~precise cross-dir move-AND-position~~ (partially shipped in #12 — see below); keyboard-driven
reorder (a11y follow-up); multi-select drag.

### Follow-up #12 — drag a file OUT of a folder (move-and-position, shipped)
Original v1 deferred cross-dir move-and-position, which made "drag a file out of a folder" impossible: a file's
folder membership IS its path key, but `reorder-file` only spliced `project.order` and never re-keyed the path, so
reordering a nested file relative to a root file left it nested (no visible move). Fix: a **file reorder now adopts
the target row's directory** — dropping a nested file on a root item moves it OUT to root; dropping a file on an
item inside folder X moves it INTO X at that position — reusing the tested `project.move` (root = `move(path,"")`),
mirrored to peers via `mirrorMove` + an `order` roomOp. Same-directory reorders are unchanged (no move). **Known v1
edge (not handled):** with ZERO root files there is no root item to drop onto, so a file can't be pulled fully back
to root that way (rare — the default project keeps `main.py` at root). A bounded "drop in the explorer's empty area
→ root" gesture was considered and deferred (it needs panel-bounds geometry to avoid a drop over the editor moving a
file to root). Tests: `test/explorer-dnd.mjs` MO.1–MO.3.
**Touch devices:** drag-reorder is desktop-first. We deliberately do NOT set `touch-action: none` on rows — it would
enable touch-drag but block touch-*scrolling* the file list by dragging on a row (a worse trade for a long list on a
device this tool doesn't target). On touch, a drag attempt falls back to a scroll (`pointercancel`) and the model is
left unchanged. Touch reorder is a follow-up alongside keyboard reorder.

### Implementation notes (R3 — adversarial review + hardening)
Built R3 as a *review + hardening* slice (move-into-folder was folded into R2 — see the R2 commit: the native drop
handler was monolithic, so splitting move-into out would have left a window where tests AND real behavior were broken
at a checkpoint). A 5-lens adversarial review (each finding independently verified, 13 of 20 refuted) plus an
orchestrator pass produced these hardening fixes (all desktop-neutral):
1. **Measure-before-paint:** the drop indicator is removed BEFORE `computeDrop` reads row rects each frame, so its 2px
   height never perturbs the measurement (the last residue of the native drop-line thrash this rewrite set out to kill).
2. **Multi-pointer safety:** `pointerdown` ignores a second concurrent pointer (`if (drag) return`); `pointermove`/
   `pointerup`/`pointercancel` act only for the gesture's own `pointerId` — a second finger can no longer hijack or
   abort an active drag.
3. **Reorder-folder guard:** if the drop's reference row vanished mid-gesture (e.g. a concurrent remote re-render), the
   `seq.indexOf(ref) < 0` case bails instead of `splice(-1, …)` writing a wrong (local-only) `dirOrder`.
4. **Escape** now cancels even a pre-threshold press; stale-comment fixes (serialize/encodeProject now name `dirOrder`).
