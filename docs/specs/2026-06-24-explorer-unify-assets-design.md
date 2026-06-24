# Slice A — Unify assets into the file tree (retire `#assetPanel`) — design

## 0. Context & resolved decisions
Part of the **File-Explorer clarity cluster** (A → B → C; see the request backlog). Slice A resolves
request **#2** (files + assets shown as duplicates) and the asset half of **#1** (can't rename/delete
images/sounds).

- **Scope (user, 2026-06-24): Option 2 — full folder-parity.** Assets become first-class tree citizens:
  rename, delete, download, **and drag-move into folders**, exactly like code files.
- **Path-break handling (user, 2026-06-24): (A) warn-on-move.** A move/rename that would break a
  `pygame.image.load("…")` reference is allowed but surfaces a friendly, non-destructive notice. The app
  NEVER rewrites student code.

## 1. Goal / observable behavior
Each asset renders **once**, as a `.tab.asset` row in the unified tree; the legacy `#assetPanel` is gone.
Asset rows support rename / delete / download (via the `⋯` action affordance, like code rows) and can be
dragged into folders. When a move/rename changes the path of an asset that is referenced in code, a calm
notice names the references to update — and keeps the line numbers.

## 2. The load-path invariant (the crux — do not violate)
An asset's key is identical in three places: `assetFS.list[].name` == the IndexedDB `assetStore` key ==
the MEMFS path == **the exact string the student passes to `pygame.image.load(...)`** (write path:
`assetFS._memfs`, index.html:1790–1798). Therefore any rename/move MUST, atomically:
1. re-key the IndexedDB record (`assetStore.put` new + `assetStore.remove` old),
2. `_unlink(old)` then `_memfs(new, bytes)` so the byte content lives at the new MEMFS path, and
3. scan code for the old path and **warn if referenced** (§5). No code rewriting.

## 3. Model changes — `assetFS` (index.html:1782–1834)
- `async rename(oldName, newName)`: validate `newName` (path-valid; no collision in the unified namespace —
  reuse `existsAnywhere`); fetch bytes (MEMFS or `assetStore`); `assetStore.put(newRec)` + `assetStore.remove(old)`;
  `_unlink(old)` + `_memfs(newName, bytes)`; update `.list`; `renderAssets()`. Returns boolean.
- `async move(name, destFolder)`: `newName = destFolder ? destFolder + "/" + basename(name) : basename(name)`;
  delegate to `rename(name, newName)`.
- Both invoke the warn-on-move check (§5).
- Expose `window.assetFS` (already present) so batteries can drive these.

## 4. Retire `#assetPanel` — exact removal surface
- **HTML 359–364:** remove `#assetSection`, `#assetChip`, `#assetPanel`. **Keep `#assetInput`** (the hidden
  file input) — relocate it out of the section but keep the id/seam (upload still routes through it).
- **CSS 172–189:** remove all `#assetPanel*` selectors and `#apStorage`.
- **JS:** delete `renderAssetPanel()` (1966–1991) and its listeners (`#assetChip` click, `.ap-browse`,
  `.ap-clear`, `.asset-remove`).
- **JS:** `renderAssets()` (1926–1931) drops the `renderAssetPanel()` call; keeps `renderTabs()`.
- **JS:** view-switch (2897) drops `assetPanelEl.hidden = false; renderAssetPanel();`; keeps `renderTabs()`.
- **Storage metric:** the explorer tree already surfaces storage metrics (verify) — so drop `#apStorage`;
  if the tree does NOT already show it, fold the estimate into the existing tree footer.
- **Upload affordance must remain:** the tree's upload-into-selected-folder path (`#assetInput` change @1993
  + drop @2003) stays; surface a small "add files" control in the explorer if the panel's `+ add files` was
  the only entry point.

## 5. Drag-move + warn-on-move (handlers ~2392–2469)
- `dragstart` already reads `dragPath` from `data-name` → works for `.tab.asset` rows unchanged.
- `drop` onto a folder: today calls `project.move` (code-only). Branch on type: if the dragged path is an
  asset (in `assetFS.list`, not `project.files`) → `assetFS.move(dragged, dest)`; else existing
  `project.move`. Re-render + `flushSave` as today.
- Assets cannot contain children → no descendant guard needed for asset sources; rename validation handles
  collisions.
- **warn-on-move:** after a successful asset move/rename, scan every `project.files` doc's text for the old
  path string; collect `file:line` hits; if any, surface a calm, dismissible notice: *"`<old>` is now at
  `<new>` — update your load path to match"* listing the hits (keep line numbers). Non-blocking; if no hits,
  silent.

## 6. Asset-row actions
- Give `.tab.asset` rows the `⋯` `.tab-menu` (mirror code rows @2324). Asset menu = **Rename · Delete ·
  Download** (no "set as entry"). Wire to `assetFS.rename` / `assetFS.remove` / `downloadItem`.
- The trigger reuses the existing (typed-prompt) menu mechanism for now; **Slice B** replaces it with the
  polished popup for files *and* assets. The durable part Slice A lands is the action *logic* + parity.
- The existing per-row `.dl` download button (@2316) stays.

## 7. Test plan (RED contract → GREEN)
- **test/assets.mjs:** drop checks 1 & 7–10 (they assert `#assetPanel` / `#assetChip` / `.asset-remove`).
  Replace with: (a) asset renders as `.tab.asset[data-name]` in the tree and **no `#assetPanel` exists in the
  DOM**; (b) asset row exposes a `⋯` menu; (c) **rename re-keys** — after rename, MEMFS has the new path and
  not the old, and `pygame.image.load(new)` works; (d) **delete** unlinks MEMFS + removes from `.list`; (e)
  **drag-move into a folder** updates `assetFS` path + MEMFS path; (f) **warn-on-move fires** when the old
  path is referenced in a code file (assert the notice + that code is unchanged). Keep checks 2–6
  (upload/hydrate/load/sound/large-file).
- **test/explorer-tree.mjs check 7:** assert the nested asset as `.tab.asset` only; remove the `#assetPanel`
  compat assertions; add asset-drag-into-folder → path updates.
- **test/upload.mjs:** unchanged (routing) — must stay green.
- **verify.mjs + all other batteries:** stay green.

## 8. Seams the implementer must expose / preserve
- New: `assetFS.rename`, `assetFS.move` (reachable via `window.assetFS`).
- Preserve: `.tab.asset[data-name=path]` row seam; `#assetInput` id; `#status` tokens; first-paint laziness
  (no `editor.setValue`; assets must not arm lint). **Removed from DOM after this slice:** `#assetPanel`,
  `#assetChip`, `#apStorage`, `.asset-row`/`.asset-remove`/`.ap-*`.

## 9. Out of scope (later slices)
- **Slice B:** the polished popup action menu (replaces the typed `prompt()` for files + assets).
- **Slice C:** row glyph de-clutter (drop the redundant in-row running `▶`; simplify 🐍/▸/▶).
