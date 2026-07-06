# Folder Upload — Design

> Status: **approved** (2026-07-06). Decisions by the human: keep-folder-as-folder mapping;
> upload button opens a Files…/Folder… popup menu. Built pre-Plan-2 in index.html's upload
> section (moves wholesale into `src/assets.mjs` with Plan 2).

## Behavior

1. **Two entry points.** (a) `#uploadBtn` now opens the shared popup menu
   (`openPopMenu`, existing `[role=menu]` semantics): **Files…** clicks the existing
   `#assetInput`; **Folder…** clicks a new `<input id="folderInput" type="file"
   webkitdirectory hidden>`. (b) Drag-and-drop anywhere accepts any mix of files and
   folders (`DataTransferItem.webkitGetAsEntry()` traversal); browsers without the entry
   API keep today's files-only behavior.
2. **Mapping.** Keep-folder-as-folder: dropping/picking `mygame/` creates
   `<selectedFolder>/mygame/…` with substructure preserved. Loose files land directly in
   the destination (unchanged). Empty directories are not materialized.
3. **Names.** FOLDER segments are sanitized uniformly for both lanes so code + assets
   share one tree folder: chars outside `[A-Za-z0-9_]` → `_`, leading digit → `_`-prefix,
   empty → `_` (`My Game/` → `My_Game/`, valid as a Python package). File LEAF names keep
   the existing per-lane machinery (`uniquePath`, `isModuleName` validation, `asset_`
   zip-prefix rules) untouched.
4. **Junk skiplist**, silently skipped with ONE console summary line (`N system files
   skipped`): any dot-prefixed name (`.DS_Store`, `.git`…), `__pycache__/`, `*.pyc`,
   `node_modules/`, `Thumbs.db`. Applied on both FOLDER pipelines (drop traversal and the
   folder picker); a deliberately-selected single file uploads as-is (explicit choice
   wins). An unreadable file mid-walk is skipped + counted, never fatal. Sanitize-renamed
   folders get a console note (`Folder "My Game" arrives as "My_Game"`).
5. **Collisions.** Existing folder at the target: contents MERGE; per-file collisions use
   the existing rules (code `_N` underscore-suffix vs `existsAnywhere`; asset `-N` hyphen
   vs `assetExists`). No folder-suffix scheme.
6. **Limits.** > 200 files in one upload → `confirmModal` before anything is added;
   cancel adds nothing. Existing storage warnings + MP3 ⚠ apply per file.
7. **Collab.** `.py` files mirror to a live room via the existing per-file `roomOp` path
   (same as today's uploads); assets stay local (existing rule).

## Implementation shape (index.html upload section, anchors as of `50fa059`)

- `routeUpload(file, destFolder, relPath)` — new optional third arg replacing `file.name`
  in the target computation (`index.html:1083-1085`). Default = current behavior; all
  downstream machinery (path-validating `project.add`, path-capable `assetFS.add`, MEMFS
  mirror `assetFS._memfs`, `roomOp` mirroring) already handles nested paths (subdirs
  feature).
- `uploadFiles(items, destFolder)` (PINNED seam `window.uploadFiles`) — items may be
  `File` or `{ file, relPath }`; normalized internally; existing callers unchanged. Owns
  the >200 confirm and the junk summary line.
- `sanitizeSegment` / `isJunkName` helpers + `walkEntries(entries)` — async traversal of
  duck-typed FileSystemEntry objects returning `[{ file, relPath }]`. **Two platform traps
  encoded:** entries are collected SYNCHRONOUSLY in the drop handler before any await (the
  DataTransferItemList is neutered once the handler yields), and
  `directoryReader.readEntries()` is called in a LOOP (Chrome returns ≤ ~100 entries per
  call). Exposed as `window.__walkEntries` (test seam — real directory DataTransfers
  cannot be synthesized in-page, so the battery feeds fake entry trees).
- `#folderInput` change handler maps `file.webkitRelativePath` (which includes the picked
  folder's name as its first segment) through the same sanitize/junk pipeline.
- Drop handler (`index.html:1169-1175`): synchronous `webkitGetAsEntry` collection; any
  directory entry → entry pipeline for the whole drop; else legacy `[...files]` path.

## Verification

- New battery `test/upload-folder.mjs` (upload.mjs house style; existing suites
  untouched): traversal correctness incl. nesting + sanitization; the readEntries >100
  loop; junk skipping + summary; path-carrying uploads through `window.uploadFiles` into
  project/assetFS/MEMFS/tree assertions; merge-collision suffixing; the >200 confirm
  (cancel = nothing added); `#uploadBtn` menu contract (`[role=menu]`, Files…/Folder…,
  Folder… reaches `#folderInput` which carries `webkitdirectory`); a
  plain-file regression guard; asset reload persistence.
- Full 23-suite battery before merge. Manual real-browser check of an actual Finder
  folder drop (headless cannot produce one).
