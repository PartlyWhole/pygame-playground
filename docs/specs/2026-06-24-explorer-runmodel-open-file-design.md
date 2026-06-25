# Request #9 — "the open file is what runs" (run-model + entry-cue) — design

## 0. Context & decision
File-Explorer refinement v2 (requests #6–#10). Resolves request **#9** — the `.start-tag` entry cue reads
as a fake button, and the run model forces "open the file first, then use the editor's Start." **User
decision (2026-06-24): the open file IS what runs.** Start runs the file currently open in the editor, with
all other project files available for import. The fixed per-file "entry" designation and its `start` tag are
retired from the UI. Built under full autonomy; documented here for review.

## 1. Goal / observable behavior
- **Start (▶) runs the currently-open (active) file**, always — single file, example, or a file inside a
  multi-file project. Sibling project files are written to MEMFS so `import`s still resolve.
- **No `start` tag** on file rows; **no `.tab.entry` accent cue**; **no "Set as start file"** menu item.
- The stage `#runFileBadge` still names the running file (now = the open file when Start was pressed).
- Examples: opening an example and pressing Start runs it (already true); promote-on-edit no longer needs to
  "set entry."

## 2. The model change (the crux)
Today (S3/S6 model): `run()` branches `isSingle = !project.isMulti()` → single runs `editor.getValue()` via
`_start`; multi runs `_start_project(files, project.entry)`. The entry is a fixed, persisted field.

New model: **the entry is the active file.** `run()` runs the OPEN file as the entry:
- Keep the single-file fast path for a 1-file project (unchanged: `engine.start(editor.getValue())`).
- For a multi-file project, call `engine.startProject(project.serialize().files, project.active)` — i.e. pass
  **`project.active`** as the entry instead of `project.entry`. All files are in MEMFS; the open one is run.
- `runFile = project.active` (the open file) in both paths (already effectively the case for single).

`project.entry` the FIELD: leave it in the model/serialize/load schema for backward-compat (saved projects,
collab records) but **stop using it in `run()` and stop surfacing it**. It becomes vestigial; a later cleanup
can remove it. Do NOT break `serialize()/load()` shape (collab + history records depend on it).

## 3. Removal surface (UI)
- `renderTabs()` (index.html ~1823–1830): drop the `${f.entry ? " entry" : ""}` class and the
  `<span class="start-tag" …>start</span>` markup.
- CSS (~149–151): remove the `.tab.entry .tab-name` accent cue + `.start-tag` rule.
- `fileMenu` (~2235): remove the **"Set as start file"** item (and `fileSetEntry` if now unused — or keep the
  function dormant if other callers exist; verify).
- Examples promote (S4): wherever promote-on-edit calls `project.setEntry`/sets entry — drop that side effect
  (promote still creates/owns the file; it just no longer designates entry).

## 4. Preserve (do NOT break)
- `project.serialize()/load()` shape incl. the `entry` key (collab/history/`#room=` records). Keep writing a
  sane `entry` value on save (e.g. `entry = active` or the existing value) so old readers don't choke.
- `#runFileBadge`, `runFile`/`runTask`, `syncRunControls`, the `#status` tokens, `_start`/`_start_project`
  Python (engine unchanged — only WHICH entry string the host passes changes).
- The `.tab.running` highlight (tests rely on it) — running indication stays; only the ENTRY cue goes.

## 5. Test impact (map exhaustively in the understand pass)
Expect updates in: `runmodel.mjs` (single-file uses `_start`; "running file is the entry" → now "running file
is the open file"), `multifile.mjs` (entry runs → open file runs; opening a sibling + Start runs that sibling),
`explorer-tree.mjs` / `explorer-actions.mjs` (`.tab.entry` / `start` tag / "Set as start" menu assertions —
remove), `examples.mjs` (promote-sets-entry assertions — remove/adjust). **Rule: update drivers to the new
model; do NOT weaken or delete `ok()` assertions beyond what the model change makes obsolete — replace an
obsolete assertion with the new-model equivalent.**

## 6. Out of scope
The other v2 items: #6 reorder bug, #7 download→`⋯`, #8 inline create UI, #10 redundant `+ new file`.
