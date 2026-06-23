# Save / download — design

**Date:** 2026-06-23 · **Status:** approved-by-delegation, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages)

> Feature 2 of 4 (Multi-file → **Save** → Lint → History). The user delegated
> end-to-end; decisions are recorded here for review.

## Goal

A **Save** button that downloads the user's program so they can keep it / run it
locally with desktop pygame. Project-aware (multi-file landed first): a lone file
downloads as a `.py`; a project with several files and/or uploaded assets
downloads as a self-contained `.zip`.

Non-goals (v1): a "load from disk" / import-project counterpart (drop-to-upload
already exists for assets; importing a `.py`/zip is a separate future feature);
saving to cloud; choosing a save location (browser download flow only).

## What the spike proved (`test/spike-save.mjs`, real headless Chromium)

- A `.py` download via `Blob` + a synthesized `a[download]` is capturable and
  round-trips its content exactly.
- **JSZip 3.10.1 loads no-build from cdnjs** (`window.JSZip`), and a zip
  containing a `.py` file plus a **binary asset** produces a valid `PK` archive
  that unzips back to identical bytes. So bundling code + assets is viable with no
  build step and no backend.

## Decisions (locked)

- **One Save button** in the header (a `💾 Save`, placed by the Share button).
- **What it downloads:**
  - **Lone file, no assets** (`!project.isMulti() && assetFS.list.length === 0`)
    → download the entry file's text directly as `<entry filename>` (e.g.
    `main.py`) via `Blob` + `a[download]`. Simplest, most common, zero dependency.
  - **Otherwise** (multi-file OR any uploaded assets) → download a `.zip`
    (`pygame-project.zip`) containing **all `.py` files** (by their project names)
    **and all uploaded assets** (by their names). Bundling assets makes the zip a
    complete, runnable desktop-pygame project — a saved game that
    `pygame.image.load("ship.png")`s isn't broken on the other end.
- **JSZip is lazy:** loaded from cdnjs **only** the first time a zip save is
  needed (mirrors the lazy Automerge/asset loads — the solo `.py`-only path and
  first paint stay zero-cost and library-free).
- **Asset bytes** come from `assetStore.getAll()` (IndexedDB — the durable source,
  records carry `{ name, bytes: ArrayBuffer }`); added to JSZip as `Uint8Array`.
- **Filenames:** lone file → the entry's filename; zip → `pygame-project.zip`. No
  name prompt (keep it one-click; users rename in their OS if they wish).
- **Keyboard:** `Cmd/Ctrl+S` while the editor has focus triggers Save
  (`preventDefault` so the browser's "save page" doesn't fire). The button is the
  primary affordance; the shortcut is a convenience.

## Architecture

All additions live in `index.html`. Small and additive:

- **`#saveBtn`** in the header; a `saveProject()` handler.
- **`saveProject()`** (async):
  1. If lone file & no assets → `downloadBlob(project.text(project.entry),
     project.entry, "text/x-python")` and return.
  2. Else → `await loadJSZip()`; build a zip: every `project.serialize().files`
     entry as a text file; every `assetStore.getAll()` record as a binary file;
     `zip.generateAsync({type:'blob'})` → `downloadBlob(blob, "pygame-project.zip")`.
- **`downloadBlob(data, filename, type?)`** — the shared `Blob` +
  `URL.createObjectURL` + synthesized `a[download]` + `revokeObjectURL` helper.
- **`loadJSZip()`** — lazy one-shot `<script src=cdnjs/jszip>` loader returning
  `window.JSZip` (cached promise, same pattern as `loadAutomerge`).
- **Editor keymap:** add `"Cmd-S"`/`"Ctrl-S"` → `saveProject` to the existing
  CodeMirror `extraKeys` (the handler returns `false`/calls `preventDefault` so
  CodeMirror swallows it; the editor keymap only fires when the editor is
  focused, which is the expected Save context).

**What it does / how you use it / depends on:** `saveProject` downloads the
current program; click Save (or Cmd-S); depends on `project`, `assetStore`, and
(for zips) lazily-loaded JSZip.

## Error handling

- **JSZip fails to load** (offline / CDN unreachable): catch, log a `sys` console
  line ("Couldn't load the zip library — check your connection") and abort the
  save. The lone-`.py` path needs no library, so single-file saves always work.
- **`assetStore.getAll()` failure:** already returns `[]` defensively (existing
  wrapper) — the zip then contains code only; not fatal.
- Download itself is the browser's flow; nothing to handle app-side.

## Testing (TDD, headless Chromium — `test/save.mjs`)

Playwright captures downloads (`acceptDownloads` context + `waitForEvent('download')`),
saves them to a temp dir, and inspects content (unzipping with JSZip in-page or a
node unzip):

1. **Lone file → `.py`.** Single-file project; click Save; assert the download is
   named after the entry and its content equals the editor text.
2. **Multi-file → zip.** Add a 2nd file; Save; assert a `pygame-project.zip` whose
   entries are all the `.py` files with correct contents.
3. **Assets bundled.** Upload an asset (reuse the asset fixtures); Save a project;
   assert the zip contains the asset with byte-identical content.
4. **Single file + an asset still zips** (the "or assets" branch).
5. **`Cmd-S`** triggers the same save (focus the editor, press the shortcut,
   assert a download fires).
6. **Non-regression:** `verify.mjs` / `assets.mjs` / `collab.mjs` / `multifile.mjs`
   stay green; first paint loads no JSZip (lazy).

## Constraints preserved

Single static `index.html`, no backend, no app build step, no API keys. JSZip
loads lazily from a CDN only when a zip is actually produced, so the common solo
path and first paint are unchanged.
