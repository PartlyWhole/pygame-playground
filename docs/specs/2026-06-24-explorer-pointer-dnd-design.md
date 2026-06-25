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
Asset reordering; precise cross-dir move-AND-position; keyboard-driven reorder (a11y follow-up); multi-select drag.
