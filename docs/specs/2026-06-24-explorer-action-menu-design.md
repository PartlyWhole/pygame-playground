# Slice B — Polished action menu (replace the typed prompt) — design

## 0. Context & decisions
File-Explorer clarity cluster, **Slice B** (Slice A ✅ done at `df90b13`). Resolves request **#1a** — "it asks me
to type entry/rename/delete; I want beautiful UI, not typing it in." Built under **full build autonomy**
(user 2026-06-24): decisions made + documented here for later review; only a push needs a nod.

## 1. Goal / observable behavior
Clicking a row's `⋯` opens a small **popup action menu** anchored to the button — no more typing the action
word into a dialog. Action set by row type:
- **code file:** Rename · Set as start file · Delete
- **folder:** Rename · Delete
- **asset:** Rename · Delete · Download

**Rename = inline edit** [my recommendation]: the row label becomes a text field (Enter commits, Esc cancels) —
calm and dialog-free, the most direct answer to "not typing it in." **Delete** keeps the existing `confirm()`
(safety). **Set as start** / **Download** act immediately. All reuse existing handlers: `project.rename` /
`project.setEntry` / `project.remove`, `assetFS.rename` / `assetFS.remove` (incl. the Slice-A warn-on-move +
storage-full guard), `downloadItem`.

## 2. The popup menu component
- Anchored to the clicked `⋯`; viewport-flip if near an edge. One shared instance; only one open at a time.
- Dismiss on outside-click, Esc, or after an action.
- Keyboard-accessible: `role="menu"` / `menuitem`, `aria-haspopup` on `⋯`; arrow keys move, Enter activates,
  Esc closes; focus returns to the `⋯` on close.
- Calm styling: minimal, consistent with the app; no motion beyond a subtle appear (respect reduced-motion).

## 3. Inline rename
- On "Rename", swap the row name span for an `<input>` prefilled with the basename (stem selected).
- Enter → validate + commit via the row type's rename (`project.rename` / `assetFS.rename`); Esc or blur → revert.
- Invalid name (collision via `existsAnywhere` / bad segment) → stay in edit with a calm inline hint; never crash.
- Re-render via `renderTabs` after commit. **No `editor.setValue`** (engine landmine).

## 4. Replaces (the typed prompts)
- `tabMenu` file prompt `"…type: entry / rename / delete"` (~2552), folder prompt `"…rename / delete"` (~2502),
  and the Slice-A `assetMenu` prompt actions → ALL route through the popup menu + inline rename.

## 5. Test plan (RED → GREEN)
New battery `test/explorer-actions.mjs` (or extend `explorer-tree.mjs`):
- clicking `⋯` opens a `[role=menu]` with the correct items per row type; **action selection invokes no `prompt()`**.
- Rename via menu → inline input appears → type + Enter renames (file: `project.files` re-keyed; asset: `assetFS`
  re-keyed + `pygame.image.load(new)` still works); Esc cancels with no change.
- Delete via menu → confirm-gated removal (file + asset).
- Set-as-start (file) sets entry; Download (asset) triggers a download.
- Keyboard: Esc closes the menu; arrow/Enter operate an item (basic a11y).
- No first-paint laziness regression; `#status` tokens unchanged. **verify.mjs + all batteries stay green.**

## 6. Seams
New: popup-menu open/close + inline-rename mechanism (test-reachable). Preserve: `.tab-menu` button,
`.tab[data-name]` / `.tab.folder[data-path]` row seams, `#status` tokens, first-paint laziness.

## 7. Out of scope
Slice C (row glyph de-clutter: drop the redundant in-row running `▶`; simplify 🐍/▸/▶).
