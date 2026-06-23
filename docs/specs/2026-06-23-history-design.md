# History panel — design

**Date:** 2026-06-23 · **Status:** approved-by-delegation, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages)

> Feature 4 of 4 (Multi-file → Save → Lint → **History**). **★ The user said this
> UI is tricky and wanted hands-on, iterative input — then delegated end-to-end
> ("I'll review and iterate on that version").** So this builds a complete,
> working, conventionally-designed first cut and surfaces the real UX forks
> prominently (see "Forks for the user") plus a visual mockup, so it's something
> concrete to iterate on rather than a blank slate.

## Goal

A **History** panel: see the previous versions of your program, view the diff
between a past version and now, and restore (revert to) a chosen version. Works
solo and in a collaboration room. The core asks — *version list + diffs + revert*
— delivered simply and robustly.

Non-goals (v1): the full multi-peer **shared** Automerge timeline (deferred — see
Forks); branching/merge-graph views; per-file side-by-side diff (v1 diffs the
active file); editing history.

## What the spikes proved

- **`test/spike-history.mjs`:** Automerge 2.2.9 exposes full change history,
  view-at-heads (time-travel), `diff`, and revert-as-new-change (peer convergence)
  — usable, **but** raw changes are **per-keystroke** (hundreds of micro-versions
  → unusable without coalescing) and carry **null messages** by default. The
  spike's recommendation: **solo history should use lightweight local snapshots,
  not Automerge** (otherwise every solo user loads the 2.9 MB bundle — a regression
  against the locked "no Automerge on the solo path" decision).
- **Diff renderer (probed):** `jsdiff` (the `diff` package) loads no-build from
  cdnjs as a UMD global (`window.Diff`); `Diff.diffLines(a, b)` returns clean
  `{ added, removed, value }` parts — exactly what a readable line-diff needs.

## Decision: local snapshots in BOTH modes (the simple, robust v1)

Rather than two backends (Automerge for collab, snapshots for solo) with the hard
per-keystroke **coalescing** problem the spike flagged, v1 uses **one mechanism in
both modes: a local snapshot of the whole project captured on every Run**, stored
per-browser in IndexedDB. This:

- delivers the core asks (version list + diff + revert) with meaningful,
  already-coalesced checkpoints ("each version is one you actually ran"),
- needs no Automerge on the solo path (no 2.9 MB regression),
- is multi-file aware (snapshots `project.serialize()`),
- is uniform solo/collab (one code path, simpler to reason about and iterate on).

**Trade-off (flagged):** in a room, each peer's history is their own local runs,
not the shared multi-peer timeline. That still lets you diff/revert your versions;
it just isn't everyone's merged checkpoint stream. The Automerge-backed shared
timeline (with coalescing) is the **primary iteration fork** below.

## Decisions (locked for v1)

- **Capture on Run.** `run()` snapshots `project.serialize()` + a timestamp + the
  mode (`solo`/`room`). **Deduped:** skip if identical to the most recent snapshot
  (re-running unchanged code adds nothing). Fire-and-forget (never blocks Run).
- **Storage:** a dedicated IndexedDB database `pygame-playground-history` (a new
  store, separate from `assetStore`'s DB so it can't disturb asset versioning),
  keyed by an autoincrement id. **Capped at 100** most-recent snapshots (evict
  oldest) — each is a few KB of text, so this is tiny.
- **Panel:** a `🕘 History` header button opens a popover (same pattern as the 📁
  asset popover) listing snapshots newest-first: each row shows a relative time
  ("2 min ago"), a `+a / −b` line-delta badge vs the previous snapshot, and a
  multi-file marker (`N files`) when applicable. Selecting a row reveals a
  **line-diff** (active file: selected version → current code) below the list and
  a **Restore** button.
- **Diff:** rendered with lazily-loaded `jsdiff` `diffLines` over the **active
  file's** text (snapshot vs current), colored adds/removes. (Single-file projects
  → the whole program.) A note shows how many *other* files differ.
- **Restore:** `confirm()` ("Replace your current code with this version?"), then
  `project.load(snapshot.project)` + `renderTabs()`. Restoring is itself a normal
  edit (the next Run snapshots it), so it's non-destructive to history.
- **Empty state:** before any Run, the panel says "No versions yet — press Run to
  save one."
- **Collab:** snapshots capture the shared single-file buffer while in a room
  (multi-file is solo-only, already locked). No Automerge history APIs are used in
  v1 (the committed `vendor/automerge-collab.mjs` is untouched; no new exports).

## Architecture

All additions in `index.html`, additive and lazy. Units:

### 1. `historyStore` (IndexedDB) — durable snapshots
- DB `pygame-playground-history`, store `snapshots` (`keyPath: "id"`,
  `autoIncrement`). Record: `{ id, at: <ms>, mode: "solo"|"room", project:
  { files, order, entry } }`.
- API: `add(rec)` (insert + evict beyond 100), `getAll()` (newest-first),
  `latest()`, `clear()`. Promise-based, failures swallowed to safe defaults (same
  defensive style as `assetStore`). Opened lazily.

### 2. Capture hook — in `run()`
- `captureSnapshot()`: build `project.serialize()`; if it deep-equals
  `historyStore.latest().project`, skip; else `historyStore.add(...)`. Called
  fire-and-forget from `run()`; never awaited, never throws into Run.

### 3. History UI — `#historyBtn` + popover
- `🕘 History` chip/button in the header; a `#historyPanel` popover (anchored like
  `#assetPanel`).
- `renderHistory()`: list rows from `historyStore.getAll()`; relative-time + delta
  badge + file-count; click selects a row → `showDiff(rec)`.
- `showDiff(rec)`: `await loadDiffLib()`; compute `Diff.diffLines(rec.project
  .files[active] ?? "", project.text(active) ?? "")`; render colored lines in the
  panel's diff pane; show a Restore button.
- `restoreSnapshot(rec)`: confirm → `project.load(rec.project)` + `renderTabs()` +
  close panel.
- `loadDiffLib()`: lazy one-shot `<script>` loader for jsdiff (cdnjs, `window.Diff`),
  cached promise (same shape as `loadJSZip`/`loadLinter`).

## Data flow

```
▶ Run ─► captureSnapshot() ─► (dedup) historyStore.add({at, mode, project})  [fire-and-forget]
🕘 History click ─► renderHistory() ─► historyStore.getAll() ─► rows
  click a row ─► showDiff(rec) ─► loadDiffLib() ─► Diff.diffLines(snapshot, current) ─► colored diff
  Restore ─► confirm ─► project.load(rec.project) ─► renderTabs()
```

## Error handling

- **IndexedDB unavailable** (private mode): `historyStore` degrades to no-ops;
  the panel shows the empty state; nothing else breaks.
- **jsdiff load failure:** `showDiff` catches and shows "Couldn't load the diff
  view — check your connection" in the pane; the version list + Restore still work.
- History is advisory; it never affects Run or the saved draft.

## Testing (TDD, headless Chromium — `test/history.mjs`)

1. **Run captures a snapshot.** Run once → the panel lists one version.
2. **Dedup.** Run the same code twice → still one version; edit + Run → two.
3. **Diff.** Two versions → selecting the older shows a line-diff with the changed
   line marked added/removed.
4. **Restore.** Restore an older version → the editor content becomes that version
   (confirm stubbed true); a subsequent Run snapshots the restored code.
5. **Multi-file.** A 2-file project snapshot restores all files; the row shows the
   file count.
6. **Cap.** (Light) inserting >100 keeps 100 newest (can drive `historyStore`
   directly).
7. **Lazy + non-regression:** jsdiff not loaded until a diff is viewed; first paint
   loads no history libs; `verify.mjs`/`assets.mjs`/`collab.mjs`/`multifile.mjs`/
   `save.mjs`/`lint.mjs` stay green; `run()` snapshot is fire-and-forget (a
   `historyStore` failure doesn't break Run).

## Forks for the user (iterate on these)

1. **★ Shared multi-peer timeline (collab).** v1 history is local per-browser
   (your runs). The spike proved Automerge can back a *shared* timeline (everyone's
   checkpoints, time-travel, revert-with-peer-convergence) — but raw changes are
   per-keystroke and need **coalescing** (bucket by time gaps, or explicit
   "checkpoint" markers via `handle.change(fn, {message})`). This is the biggest
   call and the one you wanted to weigh in on: keep history local, or add the
   shared timeline (and which coalescing rule)? It would require rebuilding
   `vendor/automerge-collab.mjs` with the history exports the spike identified.
2. **Snapshot cadence.** v1 snapshots on Run only (clean checkpoints). Alternatives:
   also on Save; also on a periodic/idle timer (captures between-run work, at the
   cost of more versions). Manual "snapshot now" button?
3. **Diff scope.** v1 diffs the active file. Alternative: a per-file summary (which
   files changed) with expandable per-file diffs; or a whole-project unified diff.
4. **Panel placement/shape.** v1 is a header popover (matches the asset popover).
   Alternative: a docked side panel, or a timeline rail.
5. **Naming versions.** v1 labels versions by time + delta. Alternative: editable
   labels / auto-labels ("before you added the enemy class").

## Constraints preserved

Single static `index.html`, no backend, no app build step, no API keys. Snapshots
use IndexedDB (no network); jsdiff loads lazily from cdnjs only when a diff is
viewed; the solo path loads no Automerge. First paint and the run-a-game path are
unaffected.
