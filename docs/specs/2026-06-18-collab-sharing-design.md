# Real-time collaborative sharing — design

**Date:** 2026-06-18 · **Status:** approved, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages,
https://partlywhole.github.io/pygame-playground/)

## Goal

Let two or more people edit the same pygame program together in real time —
seeing each other's keystrokes and cursors — by sharing a room link. No backend
we operate, no account, free.

Non-goal: streaming one person's running pygame canvas to others. We sync the
**code and cursors**; each participant runs Pyodide locally in their own browser.

## Decisions (locked)

- **CRDT / transport:** Automerge (`@automerge/automerge-repo`) over the free
  public sync server `wss://sync.automerge.org`. Chosen by the user over Yjs.
- **Loading:** a committed, locally-built **vendor bundle** (`vendor/automerge-collab.mjs`),
  because automerge-repo cannot load from a CDN no-build (spike-proven). Deployed
  site stays static; local dev gains a one-time build step.
- **Collaboration is opt-in:** a "Collaborate" button starts a room from the
  current code. The solo playground path is unchanged and loads no Automerge/WASM.
- **Identity:** auto-assigned random name + color per session. No login.
- **Run stays local.** Sync covers `{ code: string }` plus ephemeral cursors.

## Architecture

A new lazily-loaded `collab` module inside `index.html`. Automerge is imported
from a **committed, pre-built vendor bundle** (`vendor/automerge-collab.mjs`,
built once locally with esbuild; GitHub Pages serves it as a static asset) and
only when collaboration is activated (button click or opening a `#room=` link),
so the normal solo path keeps its current load time and pulls in no Automerge/WASM.

**Why a vendor bundle, not a CDN:** the Task 1 spike proved (deterministically)
that `@automerge/automerge-repo`'s `Repo` export cannot be loaded from a CDN with
no build step — on esm.sh the package's entrypoints form a circular `export *`
loop that resolves to an empty object, and jsDelivr fails to resolve its WASM.
The accepted tradeoff: the repo gains a small build setup (`build/`: `package.json`
+ esbuild entry/config) and a committed `vendor/` artifact (a single ~2.9 MB
bundle with the WASM base64-inlined — self-initializing, no runtime fetch).
`node_modules/` is gitignored. The
deployed site stays 100% static, no backend; only local development gains a build
step that regenerates the bundle.

Shared document shape:

```
{ code: string }
```

Repo setup (network only; the sync server holds the doc, so no storage adapter
needed for v1):

```js
const repo = new Repo({
  network: [new WebSocketClientAdapter("wss://sync.automerge.org")],
});
```

## Room lifecycle & URLs

- **Collaborate button** (new, in the header):
  - Solo → `repo.create({ code: <current editor text> })`, set
    `location.hash = "#room=" + handle.url` (an `automerge:…` URL), copy the link
    to the clipboard, enter live mode.
  - Already live → copies the room link (and offers leave/solo).
- **Opening `#room=automerge:…`** → `repo.find(url)`, `await handle.whenReady()`,
  adopt `doc.code` into the editor, enter live mode.
- **Load precedence:** `#room` > `#code` (existing snapshot link) > localStorage
  > default example. The existing Share button and `#code=` snapshots are untouched.
- **Persistence:** because the public sync server persists the doc, a room link
  keeps working later — reopening it restores the latest code.

Only the room *creator* calls `repo.create` (seeds the code); joiners only
`repo.find`, so there is no double-seed race.

## Data flow — the editor binding

`bindEditor(handle)` wires CodeMirror 5 to the Automerge doc both ways, with an
`applyingRemote` guard to break the echo loop.

- **Local edit:** CodeMirror `"change"` (when `!applyingRemote`) →
  `handle.change(d => updateText(d, ["code"], editor.getValue()))`.
  `updateText` (from `@automerge/automerge`) diffs old→new internally and emits
  minimal splices, so concurrent edits merge without clobbering.
- **Remote edit:** `handle.on("change", ({ doc }) => …)` → if `doc.code !==
  editor.getValue()`, set `applyingRemote = true`, compute the common
  **prefix/suffix** between the editor text and `doc.code`, and `replaceRange`
  only the differing middle, then clear the guard. Touching only the changed span
  (not `setValue`) preserves the local cursor and scroll position.

Rationale for prefix/suffix diffing rather than consuming Automerge `patches`
directly: it is a few lines, depends on no patch-format details, and is robust
for a single-string field.

## Cursors / presence

Use the non-React `Presence` class from `@automerge/automerge-repo`:

```js
const presence = new Presence({ handle });
presence.start({
  initialState: { cursor: { line, ch }, user: { name, color } },
  heartbeatMs: 5000, peerTtlMs: 60000,
});
```

- On CodeMirror `cursorActivity`, `presence.broadcast("cursor", { line, ch })`.
- `presence.on("update", …)` → render each remote peer's cursor as a CodeMirror
  bookmark (a thin colored caret + name label) via `editor.setBookmark`, clearing
  and redrawing markers on each update; drop peers that age out (`peerTtlMs`).
- `presence.getPeerStates().peers().length + 1` drives a header indicator:
  **"● Live (N)"**, colored by connection state.

## Interaction with existing features

- **Run** stays local and unchanged.
- **Example dropdown / Share snapshot** keep working. Selecting an example in a
  room simply edits the shared text — expected.
- **localStorage autosave is paused while in a room**, so a collaborative session
  never clobbers the user's solo saved draft. On leaving the room, solo mode (and
  autosave) resume from the last solo draft.
- **Layout, splitters, fullscreen, fit-canvas** are independent and untouched.

## Error handling

- `WebSocketClientAdapter` auto-retries on disconnect; the indicator reflects
  `connecting… / live / offline`.
- If `repo.find` yields an unavailable doc (`handle.isUnavailable()` or a
  `whenReady` timeout), fall back to solo mode with a console note and the default
  example — never hang the page.
- Clipboard copy failures fall back to leaving the room URL in the address bar
  (same pattern as the existing Share button).

## Primary risk & de-risking plan

The CDN-load risk has been **resolved by the spike: it is not possible** — see
"Why a vendor bundle" above. The remaining risk is the **esbuild + Automerge-WASM
recipe** for producing the self-contained vendor bundle. De-risking: Task 1 builds
the bundle and does not let any feature task proceed until a document provably
round-trips between two browser contexts importing the **committed** bundle. The
likely-working recipe (subagent to confirm): bundle the `@automerge/automerge`
**slim** entry with esbuild and call `initializeWasm()` at runtime against a
sibling `vendor/automerge.wasm` (fetched at runtime — GitHub Pages serves `.wasm`
with the correct MIME type for `fetch`, the failure mode was only `import`-as-module).

## Testing

- **Bundle test:** two headless contexts load the committed `vendor/automerge-collab.mjs`,
  create a doc in A, `find` in B, assert `doc.code` round-trips.
- **Feature tests (headless, two contexts joining one `#room=` link):**
  - Type in A → text appears in B within a short window.
  - Concurrent edits in A and B both survive (no clobber).
  - Peer count shows "Live (2)"; a remote cursor marker renders.
  - Joining adopts the room's code; leaving returns to solo + autosave.
- **Regression:** the full 16-check `verify.mjs` battery must still pass with
  collaboration off (default), confirming the solo path is untouched and ships no
  Automerge on load.

## Out of scope (v1)

- Canvas/runtime streaming (each peer runs locally).
- Collaborative undo across peers (CM5 undo stays local/best-effort).
- Private/authenticated rooms (anyone with the link can edit — intended here).
- Self-hosted sync server (public `sync.automerge.org` is "free + easy"; revisit
  if reliability becomes a problem).
