# Slice C — Row de-clutter — design

## 0. Context
File-Explorer clarity cluster, **Slice C** (A ✅ `df90b13`, B ✅ `f3ac010`). Resolves request **#3** — "my main.py
comes with a snake emoji and two play icons; too much; the game stage already labels what's running." Also clears
two LOW Slice-B review follow-ups. Built under full autonomy; decisions documented for review.

## 1. The problem (grounded in index.html)
A `.py` row renders: 🐍 `.ic` type glyph + `.tab-name` with CSS `::before "▸ "` (entry marker, ~line 149) and
`::after " ▶"` (running marker, ~line 153) + optional `.moddot` + `.dl` + `.tab-menu`. When `main.py` is the entry
AND running, the row shows **🐍 ▸ main.py ▶** — a snake plus two play-looking triangles. The running `▶` is
redundant: the stage `#runFileBadge` names the running file, and `.tab.running` already highlights the row
(left-border + warm color).

## 2. Decisions
- **Remove the in-row running `▶`** (`.tab.running .tab-name::after`, ~line 153). Keep running indication via the
  existing `.tab.running` left-border + warm color (at-a-glance) — the stage badge stays the authoritative
  "what's running."
- **Calm the entry marker** (`.tab.entry .tab-name::before "▸ "`, ~line 149): the triangle reads as a second
  play button. Replace it with a **non-play** indicator — the entry filename in the accent color plus a small,
  unobtrusive "start" tag (text/dot), visually distinct from the running highlight. Still signals which file
  Start runs; never a play-triangle.
- **Keep 🐍** as the `.py` type glyph (consistency with asset glyphs 🖼️/🔊/📄 in the unified tree).
- Net calm row: **🐍 name** *(subtle entry style if it's the entry)* · ⬇ · ⋯ — no play-button-looking glyphs;
  running shown by border/color + the stage badge.

## 3. Slice-B LOW follow-ups (cleared here)
- **code+asset same-path selector ambiguity:** when a code file and an asset share a path, the `⋯` menu could act
  on the wrong one. Disambiguate by the clicked row's TYPE (`.tab.py` vs `.tab.asset`), not path lookup alone.
- **popup-menu `Tab` focus-trap (a11y):** `Tab` inside the open menu must be handled (preventDefault + keep focus
  within items, or close cleanly) rather than leaking focus to the page.

## 4. Test plan (RED → GREEN)
Extend `test/explorer-tree.mjs` (+ a small `explorer-actions.mjs` addition for the follow-ups):
- a RUNNING `.py` row has **no in-row `▶` glyph** (assert the row's text/`::after` carries no `▶`) but IS still
  marked running (`.tab.running` class + border/color present).
- the ENTRY row is shown by the calm marker (assert the entry indicator class/element) and NOT by a `▸`/play triangle.
- 🐍 type glyph still present on `.py` rows; asset glyphs unchanged.
- (follow-up) the `⋯` menu acts on the correct row when a code file + asset share a path; `Tab` inside an open
  menu does not leak focus (traps or closes).
- `verify.mjs` + all batteries stay green; `#status` tokens untouched; no first-paint regression.

## 5. Seams
Preserve `.tab.running` + `.tab.entry` semantics (tests rely on the running highlight), `.tab-menu`,
`.tab[data-name]`. No `editor.setValue`.

## 6. Out of scope
Refactor-D (engine extraction) follows this cluster; then lesson-UI L1–L6.
