# Slice S6 — Multi-file collaboration room + per-file presence — DESIGN

**Date:** 2026-06-23 · **Branch:** `redesign` · **Status:** design only (no code, no commit)
**Slice:** S6 — the largest, riskiest slice of the redesign.
**De-risk:** GREEN. `test/spike-collab-paths.mjs` (23/23 live, 24/24 offline) proved the path-keyed
CRDT shape converges across two real peers. This design builds *to that proven shape*.

> Companion docs: the path-keyed proof (`test/spike-collab-paths.mjs`), the de-risk recipe
> (`2026-06-23-redesign-derisk-findings.md` §3), the feasibility/cost report
> (`2026-06-23-multifile-collab-derisk.md`), the verdict (`2026-06-23-redesign-open-decisions.md` #1),
> and the OLD single-file shape this revises (`2026-06-18-collab-sharing-design.md`).

---

## 0.1 Orchestrator resolutions (settles the open questions + the split — binding)

- **Sub-slice split ACCEPTED:** **S6a** = path-keyed CRDT + `bindEditor` multi-file reconciliation +
  seed/adopt (gates G1-G6; CRDT-adjacent reconciliation risk). **S6b** = structural file-ops via
  `handle.change()` + per-file presence + rail-view wiring + restore-in-room (gates G7-G10; interaction
  risk). Each lands green (with its two-peer tests) before the next.
- **Q1 — Missing `file` field → STRICT:** a peer with no `file` field renders NO remote cursor (the roster
  still counts them).
- **Q2 — Relay (`wss://sync.automerge.org`) unreachable → SKIP the live two-peer assertions** (report
  skipped, exit 0) rather than FAIL — the app has no in-browser loopback like the Node spike. Run them
  when the relay is up.
- **Q3 — `collab.mjs` KEEPS as a separate single-file (depth-1) guardrail;** reconcile ONLY assertions
  that implicitly assumed `setValue(doc.code)`.
- **Q4 — Restore-in-room → S6b**, behind a confirm that WARNS it overwrites the project for ALL peers.
- **Q5 — Empty-folder propagation → SHIP WITHOUT** (keep the CRDT shape identical to the proven spike; an
  empty folder syncs as soon as a file lands in it).
- **Q6 — ADD same-file-concurrent-edit + rename-vs-edit two-peer assertions** (capture the accepted
  char-history / keystroke-loss tradeoff as a test).
- Automerge stays LAZY (the solo path loads ZERO Automerge) throughout both sub-slices.

---

## 0. One-paragraph summary

Today a collaboration room is a single `{ code: string }` Automerge document. A multi-file local
project collapses to its entry file the moment it is shared (a `confirm()` warns and seeds entry-only).
S6 replaces that with a **path-keyed multi-file CRDT** — `{ files: {[encodeURIComponent(path)]: text},
order, entry }` — so two people can edit *different* files (including nested files in folders) live, with
**per-file presence** (you only see a peer's cursor when they are on the file you are looking at). The
CRDT risk is fully retired by the spike; the residual cost is **UI-integration reconciliation** — the two
**L** items (`bindEditor` multi-file reconciliation and structural file-ops routed to `handle.change()`)
where ghost-tab / lost-file / cursor-jump bugs hide. The single hardest mistake to avoid is **relaxing
the single-file gates inconsistently**, which yields a half-multi-file room that is worse than today's
honest single-file room. Automerge stays **lazy**: the solo path loads zero Automerge/WASM.

---

## 0.1 Current-state line map (re-confirmed on `redesign`, `index.html` = 3388 lines)

The line refs in the older de-risk docs (1870-1895, 1524-1558, 1966-1983, etc.) are **stale** — the
`redesign` branch has moved everything. These are the **current** seams S6 touches:

| Seam | Current location | Today's behavior |
|------|------------------|------------------|
| `collab` object | `index.html:2120` | `{ repo, handle, presence, active, applyingRemote }` + later `.lib/.bound/.markers/.starting` |
| `loadAutomerge()` (lazy) | `3205-3214` | dynamic `import()` of the vendor bundle; sets `window.__amLoaded` |
| `setLive(state, peers)` | `3216-3221` | toggles `#liveDot`, writes `#peerCount` |
| `applyingRemoteSet(fn)` | `3223` | echo-loop guard wrapper |
| **`bindEditor()`** (L#4) | `3224-3249` | **hardwired to `doc.code` + the one `editor` CM**; prefix/suffix splice |
| `startPresence()` / `renderPeers` | `3257-3302` | cursor = `{line,ch,anchor}` — **no `file` field**; renders all peers' cursors |
| `findWithRetry()` | `3304-3318` | fresh Repo per attempt; relay race retry |
| **`startRoom()`** (seed) | `3320-3337` | `isMulti()` confirm → seeds `{ code: project.text(entry) }` |
| **`joinRoom()`** (adopt) | `3339-3351` | `editor.setValue(doc.code)` |
| `enterRoom()` | `3353-3359` | sets `active`, binds, presence, `renderTabs()` |
| `copyRoomLink()` / `flashBtn()` | `3361-3368` | copies `location…+hash` |
| `#collabBtn` listener | `3370-3377` | start-or-copy; `#collabStartBtn` delegates (`3379`) |
| online/offline listeners | `3381-3382` | reflect connection in `#liveDot` |
| **`run()` gate** (L-adjacent) | `3142` | `const isSingle = collab.active \|\| !project.isMulti();` — **forces single-file in any room** |
| `project` model | `1500-1644` | `serialize/load/add/adoptDoc/rename/move/remove/setActive/setEntry/addFolder` — **HUMAN paths** |
| **structural file-ops** (L#5) | `newFilePrompt 2452`, `folderMenu 2481`, `tabMenu 2524`, drop handler `2424-2451` | call `project.*` + `renderTabs()` + **`flushSave()`** (a no-op in a room) |
| `renderTabs()` | `2279-2326` | **always-on** explorer (no `!collab.active` gate any more — S1/S2 already landed) |
| `renderViewer()` | `2180+` | `.py` → `setActive`/`swapDoc`; asset → media surface |
| `captureSnapshot()` / `restoreSnapshot()` | `1789-1797` / `2098-2110` | serialize/`project.load` + `flushSave()` |
| `flushSave()` | `2571-2579` | **early-returns when `collab.active`** |
| boot precedence + `#room=` | `loadInitialProject 2556-2567`, join at `2549-2552` | `#room` joins async; blank `main.py` until room arrives |
| Collaboration rail markup | `panel-collab 386-394` | `#collabStartBtn` + `#collabPanel` + `#liveDot`/`#peerCount` |

**Key finding for the orchestrator:** two of the old "single-file gates" have **already changed** on
`redesign` from what the de-risk report assumed:
- `renderTabs` **no longer** has the `isMulti() && !collab.active` gate — the explorer is **always-on**
  (decision #7 already landed). So "re-enable the tab strip in a room" is a **no-op** now; the work is
  making the explorer's data come from the shared doc, not local-only.
- The `run()` gate is now `collab.active || !project.isMulti()` (line 3142). **This is the live
  single-file gate that must flip** to `!project.isMulti()` so a multi-file room runs the project path.

These two facts shrink S6 slightly vs. the original estimate and re-point the work at `bindEditor`,
structural-ops routing, presence, and seed/adopt.

---

## 1. Scope + non-goals

**In scope (S6):**
1. The **multi-file room** — a path-keyed CRDT (`{files, order, entry}` with `encodeURIComponent(path)`
   keys) replacing the single-file `{code}` doc.
2. **`bindEditor` multi-file reconciliation** (L#4) — diff *every* changed file, splice the active CM Doc
   (cursor-preserving), set non-active Docs, reconcile added/removed keys + `order`/`entry`.
3. **Structural file-ops to `handle.change()`** (L#5) — create / rename / move / delete routed through
   the shared doc when `collab.active`, instead of the local-only `flushSave()` (a no-op in a room).
4. **Per-file presence** — a `file` field on each cursor; the roster counts everyone, but remote cursors
   render only for peers on the *local active file*; repaint on file switch.
5. **Wiring the S1 Collaboration rail view** — idle → `startRoom`; `#room=`/Join → `joinRoom`; active →
   roster + read-only room link + Copy link + Leave; `setLive(state, peers)`.
6. **Seed/adopt + restore-in-room** consistency, and revising `2026-06-18-collab-sharing-design.md`.

**Non-goals (explicitly OUT):**
- **Share-link removal** (`#shareBtn`, `#code=`/`#project=` readers) — that is **S7** (decision #2). `#room=`
  stays. S6 does not touch the share-link load paths.
- **Folder/package engine work** — S2 (true subdirs + native imports) is a separate, already-de-risked
  slice. S6 only carries *paths through the CRDT*; it does not change MEMFS, `isModuleName`, or imports.
- **Import-rewrite on rename** — keep the warn-don't-rewrite reminder (decision #10).
- **Auto-zip Save / upload routing / examples promote** — S3/S5 concerns, untouched here.
- **History-preserving rename** — not expressible via a map rekey; v1 rename = copy-and-delete with
  accepted char-history loss (see §11).
- **Collaborative undo across peers** — stays local/best-effort (carried over from the old spec).
- **Streaming a running canvas** — each peer runs Pyodide locally (unchanged).

**Hard invariant — Automerge stays LAZY.** The solo path must load **zero** Automerge/WASM. `loadAutomerge()`
fires only on a `#collabBtn`/`#collabStartBtn` click or when joining a `#room=` link. The two-peer test
asserts `0` automerge/vendor requests on the solo path (carried from `collab.mjs`).

---

## 2. CRDT shape + the encode/decode boundary

### 2.1 The shared document shape (proven by the spike)

```js
{
  files: { [encodeURIComponent(path)]: AutomergeText },  // e.g. "sprites%2Fenemy.py" -> text
  order: string[],                                        // ENCODED keys, positional (Automerge list)
  entry: string                                           // ENCODED key (last-writer-wins scalar)
}
```

- Keys are `encodeURIComponent(humanPath)` — `"sprites/enemy.py"` → `"sprites%2Fenemy.py"`.
- **Why encoded:** the vendor bundle's `updateText` **splits its path argument on `/`**, so
  `updateText(d, ['files', 'sprites/enemy.py'], …)` is misread as a 4-component path and throws
  *"invalid path … referenced a nonexistent object"*. A slash-free encoded key is a valid map key for
  assignment, read (`String()`), `delete`, `order`, `entry`, **and** `updateText`. This is the HEADLINE
  BLOCKER the path spike exists to retire; the encoded key is the fix.
- `files` is a **map** → add-file = set a key, delete-file = delete a key (clean concurrent ops).
- `order` is an **Automerge list** → concurrent reorders/adds merge positionally.
- `entry` is a **LWW scalar** → rare-conflict last-writer-wins.
- Two peers editing **different** files touch **disjoint CRDT paths** → no contention (the whole point).
  Two peers editing the **same** file get character-level merge (exactly as today's `['code']` path).

> **`emptyDirs` is NOT in the shared doc for v1.** The local model carries `emptyDirs` (created-but-empty
> folders), but a folder with no files is invisible in the CRDT (no key to hold it). v1 accepts that an
> empty folder does not propagate to peers until a file lands in it. Documented as a known limitation
> (see §11 open questions) — adding an `emptyDirs` array to the doc is a trivial later extension, but it
> is out of scope to keep the shape identical to the proven spike.

### 2.2 The encode/decode boundary — the single most important rule

> **The shared Automerge doc is the ONLY place `%2F`-encoded keys exist. Everywhere else — the local
> `project` model, `#project=`, the zip, localStorage, the UI — paths are HUMAN (`sprites/enemy.py`).
> Nothing outside `encodeProject`/`decodeProject` and per-file `updateText` may ever see or produce an
> encoded key. Never double-encode.**

This is enforced with a **thin boundary layer** of four pure helpers (new, in the collab section):

```js
const encPath = (p) => encodeURIComponent(p);          // human path -> CRDT key
const decKey  = (k) => decodeURIComponent(k);          // CRDT key -> human path

// project.serialize() returns HUMAN {files:{[path]:text}, order, entry, emptyDirs}.
// encodeProject re-keys it for the doc; emptyDirs is dropped (see §2.1).
function encodeProject(rec) {
  const files = {};
  for (const p of rec.order) files[encPath(p)] = rec.files[p];   // order drives the key set
  return { files, order: rec.order.map(encPath), entry: encPath(rec.entry) };
}

// docToRecord materializes a doc into a HUMAN record project.load() consumes.
function docToRecord(doc) {
  const files = {};
  for (const k of Object.keys(doc.files)) files[decKey(k)] = String(doc.files[k]);
  return { files, order: [...doc.order].map(decKey), entry: decKey(doc.entry) };
}
```

**Invariants (the spike proves these are total inverses for valid paths):**
- `decodeProject` is exactly `docToRecord` — there is one function; `project.load(docToRecord(doc))` is the
  adopt path. (The spike calls its materializer `docToRecord` too; same contract.)
- `encodeProject(project.serialize())` on create/seed; `project.load(docToRecord(doc))` on join/adopt.
- These round-trip: `docToRecord(encodeProject(rec))` ≡ `rec` (minus `emptyDirs`/`active`, which are
  local-only). The two-peer test asserts a create→join→back round-trip is byte-identical.
- **`order` is the source of truth for the key set** when seeding (we iterate `rec.order`, not
  `Object.keys(rec.files)`), so a file missing from `order` can never silently seed an orphan key.

### 2.3 Where the boundary lives in the data flow

```
 LOCAL (human paths)                         SHARED DOC (encoded keys)
 ───────────────────                         ─────────────────────────
 project.serialize() ──encodeProject()────►  repo.create({files,order,entry})   [seed]
 project.load(rec)   ◄──docToRecord()──────  handle.doc()                        [adopt / remote change]
 per-file edit       ──updateText(['files', encPath(activePath)], next)──►       [local→remote]
 structural op       ──handle.change(d => …encPath(new)… delete …encPath(old))►  [create/rename/move/del]
 presence cursor     ──broadcast({…, file: encPath(project.active)})──►          [per-file presence]
```

`#project=`, the zip download, and localStorage autosave **never** call `encodeProject` — they keep using
`project.serialize()` (human paths) exactly as today. The boundary is *only* the create/adopt/edit/op/
presence arrows above.

---

## 3. `bindEditor` multi-file reconciliation (L item #4 — the largest change)

### 3.1 Today (single-file, `3224-3249`)

`bindEditor()` wires the ONE `editor` CM both ways to `doc.code`:
- **local→remote:** on CM `"change"`, `handle.change(d => updateText(d, ["code"], editor.getValue()))`.
- **remote→local:** on `handle.on("change")`, prefix/suffix-diff `doc.code` vs `editor.getValue()` and
  `replaceRange` only the differing middle (preserves cursor/scroll) under `applyingRemoteSet`.

This is the seam that must become multi-file. The danger zone — **ghost tabs** (a key removed remotely
but its tab lingers), **lost files** (a key added remotely never gets a Doc / tab), **cursor jumps** (a
remote splice on the active file clobbers the local caret), and **active-file pointing at a deleted key**.

### 3.2 Redesign — local→remote (the easy direction)

Each file's local edits push `updateText` on **that file's encoded key**, not a hardwired `['code']`.
The app already has exactly one CM (`editor`), and `editor.getDoc()` is whichever file `setActive` last
swapped in. So the local edit always concerns `project.active`:

```js
editor.on("change", () => {
  if (!collab.active || collab.applyingRemote) return;
  const path = project.active;
  const key = encPath(path);
  const next = editor.getValue();                       // == project.files[path] live Doc
  if (String(collab.handle.doc().files[key]) === next) return;
  collab.handle.change(d => updateText(d, ['files', key], next));
});
```

> **Note — this listener is in addition to the existing autosave `editor.on("change")` (line 2581),
> which already `return`s when `collab.active`. Keep both; they are disjoint by the `collab.active` guard.**

Because the CRDT key is keyed by the *active* path and `setActive`/`swapDoc` keeps `editor` pointing at
the active Doc, switching files needs no rebinding — the next `"change"` simply targets the new active
key. (Non-active Docs are never edited by the user directly; they only change via remote patches, §3.3.)

### 3.3 Redesign — remote→local (the reconciliation, the real work)

On `handle.on("change", ({ doc }))`, run a **full reconciliation** under `applyingRemoteSet`. The handler
must NOT assume which file(s) changed — it diffs the whole doc against the local `project`. Pseudocode:

```js
collab.handle.on("change", ({ doc }) => {
  applyingRemoteSet(() => reconcileFromDoc(doc));
});

function reconcileFromDoc(doc) {
  const remotePaths = Object.keys(doc.files).map(decKey);          // human paths
  const remoteSet = new Set(remotePaths);
  const localSet  = new Set(project.order);

  // (A) REMOVED keys: present locally, gone remotely -> project.remove (but never the active/last file
  //     blindly — see active-file repair below). Defer removing the active file until after we pick a
  //     new active, so the editor never points at a dead Doc.
  const removed = [...localSet].filter(p => !remoteSet.has(p));

  // (B) ADDED keys: present remotely, absent locally -> create a Doc + tab. Use project.add(path, text)
  //     (it builds a fresh CodeMirror.Doc and pushes order). NEVER setValue.
  const added = remotePaths.filter(p => !localSet.has(p));
  for (const p of added) project.add(p, String(doc.files[encPath(p)]));   // add() validates + refuses dups

  // (C) CHANGED text in EXISTING files: for every path in both sets, diff doc text vs the local Doc.
  for (const p of remotePaths) {
    if (!localSet.has(p) && !added.includes(p)) continue;
    const remoteText = String(doc.files[encPath(p)]);
    if (p === project.active) {
      spliceActiveDoc(remoteText);            // cursor-preserving prefix/suffix replaceRange on `editor`
    } else {
      const d = project.files[p];
      if (d && d.getValue() !== remoteText) setNonActiveDoc(d, remoteText);   // splice the CM.Doc directly
    }
  }

  // (D) REMOVED: now safe — if the active file was removed, repoint active FIRST, then remove.
  for (const p of removed) {
    if (p === project.active) project.setActive(pickSurvivingActive(doc));   // repair before removal
    project.remove(p);
  }

  // (E) ORDER + ENTRY: adopt the remote order (decoded) and entry, so tab order + the entry badge match.
  reconcileOrder(project, doc.order.map(decKey));
  const remoteEntry = decKey(doc.entry);
  if (project.files[remoteEntry]) project.entry = remoteEntry;

  renderTabs();                              // ONE repaint at the end, not per-file
  // repaint remote cursors for the (possibly new) active file — see §5
  if (collab.renderPeers) collab.renderPeers();
}
```

**Key reconciliation rules (these are where the bugs hide — call them out in the test plan §9):**

- **`spliceActiveDoc(remoteText)`** reuses today's prefix/suffix algorithm (`3239-3247`) verbatim, on the
  active Doc only. This is the *only* path that touches the live caret, so it is the only one that must
  preserve cursor/scroll. **Cursor-jump avoidance:** only the active file is spliced via the cursor-aware
  path; non-active files are spliced on their detached `CodeMirror.Doc` (no visible caret to disturb).
- **`setNonActiveDoc(d, text)`** must splice the `CodeMirror.Doc` (the same prefix/suffix `replaceRange`
  on `d`, NOT `d.setValue(text)`) so a non-active file keeps its own undo history and any local cursor
  position for when the user switches to it. (A `setValue` would nuke that file's local undo stack.)
- **Ghost-tab avoidance:** removals are driven by the *remote key set*, and `renderTabs` is called once
  at the end from the reconciled `project.order`. A tab can only exist if `project.files[path]` exists.
- **Lost-file avoidance:** additions are driven by the *remote key set*; every remote key that is not
  local gets a `project.add` (fresh Doc) before order reconciliation, so `order` can never reference a
  path with no Doc.
- **`pickSurvivingActive(doc)`** = remote `entry` if it still exists, else the first remote `order` path,
  else (degenerate) the first remaining local path. Never leaves `editor` on a deleted Doc.
- **`reconcileOrder(project, remoteOrder)`** sets `project.order` to the remote order **filtered to paths
  that have a Doc** (defensive: a transient doc state could list a key mid-add). Active file is per-peer
  and is NOT driven by remote order — only `entry` and tab order are shared; `active` stays local.
- **Idempotence / echo:** the whole handler runs under `applyingRemoteSet`, so the `editor.on("change")`
  splices it causes do not loop back as local edits. The local→remote guard
  (`String(doc.files[key]) === next`) is a second backstop.

### 3.4 The "active file is per-peer" principle (critical, easy to get wrong)

`project.active` / `editor.swapDoc` is a **local** concern — each peer looks at whatever file they
choose. The shared doc carries `entry` (which file *runs*) but NOT which file each peer is *viewing*.
Therefore:
- Remote changes never call `setActive` *except* to repair a deleted active file (rule D).
- A peer switching files (`setActive`) is purely local — it does **not** write the doc; it only
  re-broadcasts presence with the new `file` and repaints remote cursors (§5).
- This keeps two peers on two different files fully independent, which is the headline feature.

---

## 4. Structural file-ops routed to `handle.change()` (L item #5)

Today the explorer's create/rename/move/delete handlers all do `project.<op>()` → `renderTabs()` →
`flushSave()`. In a room, `flushSave()` early-returns (line 2572), so the local model changes but the
**shared doc never learns of it** — a half-multi-file room. The fix: when `collab.active`, every
structural op ALSO mutates the shared doc via a single `handle.change()` transaction.

### 4.1 The pattern — one `roomOp` helper wrapping each structural mutation

Introduce a small `roomOp(fn)` helper that runs the doc mutation only in a room, under the remote guard
to suppress the echo it triggers in `bindEditor`'s remote handler:

```js
function roomOp(mutator) {
  if (!collab.active) return;
  applyingRemoteSet(() => collab.handle.change(mutator));   // guard: our own change echoes back via on("change")
}
```

Then each explorer handler, after its successful local `project.<op>()`, calls the matching `roomOp`:

| Op (local handler) | Local model call | `roomOp` mutator (encoded keys) |
|--------------------|------------------|----------------------------------|
| **create** (`newFilePrompt 2452`) | `project.add(name)` | `d.files[encPath(name)] = ""; d.order.push(encPath(name));` — **plain assignment, NOT `updateText`** (it can't create a key) |
| **rename file** (`tabMenu 2529`) | `project.rename(old,new)` | copy-and-delete (below) |
| **move file/folder** (drop `2436`, `folderMenu rename`) | `project.move(p,dest)` / per-child `rename` | copy-and-delete **per affected key** |
| **delete file** (`tabMenu 2536`) | `project.remove(name)` | `delete d.files[encPath(name)]; d.order = d.order.filter(k => k !== encPath(name));` + fix `entry` |
| **delete folder** (`folderMenu delete 2511`) | per-child `project.remove` | delete each child key + filter order + fix entry |
| **set entry** (`tabMenu entry 2528`) | `project.setEntry(name)` | `d.entry = encPath(name);` |
| **reorder** (drop on a file row `2438-2447`) | local `order.splice` | `d.order = project.order.map(encPath);` (rewrite from the reconciled local order) |
| **new folder** (`newFolderPrompt 2468`) | `project.addFolder(path)` | **no doc op** (empty dirs not in the doc, §2.1) — folder appears for peers when a file lands in it |

### 4.2 Copy-and-delete (rename / move) — the single-transaction recipe

Rename and move are the same shape: in ONE `handle.change()`, copy the old value to the new encoded key,
delete the old key, rewrite `order`, and fix `entry` if it pointed at the old key. This mirrors the spike
exactly (spike lines 235-263):

```js
// for rename old->new (a move is the same with new = destFolder/basename):
roomOp(d => {
  const ok = encPath(oldPath), nk = encPath(newPath);
  d.files[nk] = String(d.files[ok]);                       // copy current value (plain assignment)
  delete d.files[ok];                                       // delete old key
  d.order = d.order.map(k => k === ok ? nk : k);            // rewrite order in place
  if (d.entry === ok) d.entry = nk;                         // keep entry consistent
});
```

For a **folder rename/move** that re-keys N descendants, do all N copy-and-deletes inside ONE
`handle.change()` so peers see the folder move atomically (no half-moved tree). The local
`folderMenu`/`move` already iterates children; the `roomOp` mutator iterates the same child list.

**ACCEPTED COST (documented):** copy-and-delete **destroys that file's character-level CRDT history** and
any **in-flight keystrokes a peer was typing on the old key** at the moment of rename (they land on the
orphaned old key and are dropped on next sync). This is unavoidable with a map rekey and is the documented
v1 rename semantics (carried from the feasibility report §2). A history-preserving rename is out of scope.

### 4.3 Routing — do NOT duplicate the model logic

The explorer handlers keep calling `project.<op>()` for the **local** model (so the editor Docs, tabs,
viewer, and `active` repair all stay correct), and additionally call the matching `roomOp` for the
**shared doc**. The local op runs first (it validates + may refuse, e.g. duplicate name); only on success
do we mirror to the doc. This avoids a doc mutation for a refused local op. `flushSave()` stays a no-op in
a room (the doc IS the persistence). On the existing handlers, the minimal change is:

```js
// e.g. newFilePrompt, after the successful project.add:
if (project.add(name)) {
  …existing local renders…
  roomOp(d => { d.files[encPath(name)] = ""; d.order.push(encPath(name)); });   // NEW
}
```

### 4.4 The consistency rule for `order` + `entry`

After ANY structural op, the doc must satisfy: **`order` key-set === `files` key-set**, and **`entry` is a
key that exists**. The spike asserts both (lines 271-279). The mutators above maintain this by construction;
the test plan re-asserts it after each op (§9).

---

## 5. Per-file presence (M item)

### 5.1 Today (`startPresence` 3257-3302)

The broadcast cursor is `{ line, ch, anchor }` — **no file identity**. `renderPeers` (3272-3299) draws
EVERY peer's cursor on the one `editor`, regardless of which file they are on. With one file that is
correct; with many files it is **silent visual corruption** — a peer editing `enemy.py` at line 5 paints
a ghost caret at line 5 of *your* `main.py`.

### 5.2 Redesign — add a `file` field + filter on render

**Broadcast** (cursorActivity handler, `3263-3268`): tag every cursor with the encoded active path.

```js
editor.on("cursorActivity", () => {
  const head = editor.getCursor("head"), anchor = editor.getCursor("anchor");
  collab.presence.broadcast("cursor", {
    line: head.line, ch: head.ch,
    anchor: { line: anchor.line, ch: anchor.ch },
    file: encPath(project.active),               // NEW — which file this cursor is in
  });
});
```

**Render** (`renderPeers`, `3272-3299`): the roster counts EVERYONE; the cursor markers render ONLY for
peers whose `file` === the local active file.

```js
const renderPeers = () => {
  const peers = Object.values(collab.presence.getPeerStates().value);
  setLive("", peers.length + 1);                 // roster count = all peers + you (unchanged)
  renderRoster(peers);                           // NEW: the rail roster lists ALL peers + their file (§6)
  collab.markers.forEach(m => m.clear());
  const here = encPath(project.active);
  collab.markers = peers.flatMap(p => {
    const cur = p.value?.cursor;
    if (!cur || cur.file !== here) return [];     // NEW FILTER — only peers on MY active file get a caret
    …existing selection-band + caret-bookmark rendering…
  });
};
collab.renderPeers = renderPeers;                // expose so reconcileFromDoc + setActive can repaint
```

### 5.3 Repaint on file switch

When the local user switches files (`setActive`), the set of "peers on my file" changes, so cursors must
be repainted. Add a `collab.renderPeers?.()` call after `setActive`/`renderViewer` when `collab.active`
(or simpler: call it at the end of `reconcileFromDoc` and from a small wrapper around the file-switch
path). The presence `cursor` broadcast also re-fires on switch because `swapDoc` triggers a
`cursorActivity`, so peers learn your new file automatically.

**Backward-compat:** a peer on an OLD single-file build broadcasts a cursor with **no `file` field**. Two
clean options — pick one in build:
- **(a) Treat a missing `file` as "the entry file"** so an old peer's cursor shows on entry (lenient).
- **(b) Treat a missing `file` as "no file" → never render** (strict; an old peer just shows in the
  roster with no caret).
Recommended: **(b)** — strict and unsurprising; old single-file rooms are being phased out anyway, and a
mis-placed caret is worse than an absent one. (This is an OPEN QUESTION for the orchestrator, §11.)

### 5.4 Idle / solo loads zero Automerge

`startPresence` only runs inside `enterRoom`, which only runs from `startRoom`/`joinRoom`, which only run
on a collab gesture. The solo path never constructs `Presence`. (Test asserts 0 automerge requests solo.)

---

## 6. Collaboration rail view wiring (S1 chrome → S6 data)

The S1 chrome already exists: `panel-collab` (`386-394`) with `#collabStartBtn`, `#collabPanel`,
`#liveDot`/`#peerCount`; the off-screen `#collabBtn` engine seam (`329`) keeps the click listener; the
proto (`proto/sandbox.html` `renderCollab` 1086-1110, `proto/shots/sandbox-3-collab.png`) shows the two
states. S6 wires the data into that chrome.

### 6.1 Idle state → `startRoom`

`#collabStartBtn` delegates to `#collabBtn` (existing, `3379`), whose listener calls `startRoom()`.
**The change in `startRoom` (3320-3337):** delete the `isMulti()` confirm + entry-only seed; seed the
*whole project*:

```js
async function startRoom() {
  collab.lib = await loadAutomerge();
  const seed = encodeProject(project.serialize());     // WHOLE project, encoded keys (replaces {code})
  collab.repo = new collab.lib.Repo({ network: [new collab.lib.WebSocketClientAdapter("wss://sync.automerge.org")] });
  collab.handle = collab.repo.create(seed);
  await collab.handle.whenReady();
  location.hash = "#room=" + collab.handle.url;
  await enterRoom();
  copyRoomLink();
}
```

### 6.2 `#room=` / Join → `joinRoom` (adopt)

`joinRoom` (3339-3351) currently does `editor.setValue(doc.code)`. Replace with a full adopt via the
boundary + a render, all under the remote guard:

```js
async function joinRoom(url) {
  collab.starting = true;
  try {
    collab.lib = await loadAutomerge();
    collab.handle = await findWithRetry(collab.lib, url);
    if (!collab.handle) { …stay solo… return; }
    applyingRemoteSet(() => { project.load(docToRecord(collab.handle.doc())); renderTabs(); renderViewer(project.active); });
    await enterRoom();
  } finally { collab.starting = false; }
}
```

`project.load` rebuilds every file's Doc and `swapDoc`s the active one (it already does this for
`#project=`/saved loads) — so adopting a multi-file room is the SAME code path as opening a multi-file
saved project, just sourced from `docToRecord(doc)`.

### 6.3 Active state → roster + room link + Leave

Replace the static `#collabPanel` body with a `renderRoster(peers)` that, when `collab.active`, renders
(matching the proto):
- **You** row (your name + color + "· editing `<basename(active)>`").
- One **peer row** per remote peer: colored dot + name + the file they're on
  (`· <basename(decKey(cur.file))>`) so the roster doubles as a per-file presence indicator.
- A **read-only room-link input** showing the LIVE `#room=` URL (`location.origin+pathname+hash`) +
  **Copy link** (→ existing `copyRoomLink`).
- **Leave room** (→ new `leaveRoom()`).

`renderRoster` is called from `renderPeers` (so it updates as peers join/leave/switch files) and once from
`enterRoom`. `setLive("", peers.length + 1)` continues to drive `#liveDot`/`#peerCount` (the test surface).

### 6.4 `leaveRoom()` (new — completes the lifecycle)

The current code has no leave path (the button becomes "Copy room link" forever). S6 adds:

```js
function leaveRoom() {
  try { collab.presence?.stop?.(); } catch {}
  try { collab.repo?.shutdown?.(); } catch {}
  collab.active = false;
  collab.markers?.forEach(m => m.clear());
  location.hash = "";                          // drop #room=
  setLive("offline", 1); document.getElementById("liveDot").hidden = true;
  flushSave();                                 // NOW captures the room work into local autosave (was a no-op in-room)
  renderRoster([]);                            // back to idle chrome
}
```

**Important:** on leave, the local `project` already holds the full multi-file state (it was kept in sync
by `reconcileFromDoc`), so leaving simply stops syncing and `flushSave()` persists it locally — the user
keeps the collaborative work as their solo project. (The OLD spec discarded room work on leave because the
room was entry-only; now it is the whole project.)

---

## 7. Consistency — every single-file gate, made multi-file (the half-relaxed footgun)

The feasibility report's #1 warning: **relaxing the single-file gates INCONSISTENTLY = a half-multi-file
room** (gates relaxed in one place, not another → ghost tabs / lost files / a file that edits but doesn't
run). This is the exhaustive enumeration of every `code`/`isMulti`/`collab.active`-single-file assumption
and how it becomes multi-file CONSISTENTLY. **All of these must flip together, or not at all.**

| # | Gate / assumption | Location | Today (single-file) | S6 (multi-file) |
|---|-------------------|----------|---------------------|-----------------|
| G1 | doc shape | `startRoom 3332` | `create({ code: seed })` | `create(encodeProject(project.serialize()))` |
| G2 | seed = entry only | `startRoom 3323-3330` | `isMulti()` confirm + `seed = project.text(entry)` | **delete the block**; seed whole project |
| G3 | adopt = `setValue` | `joinRoom 3346` | `editor.setValue(doc.code)` | `project.load(docToRecord(doc)); renderTabs(); renderViewer(active)` |
| G4 | `bindEditor` path | `bindEditor 3231` | `updateText(d, ["code"], …)` | `updateText(d, ['files', encPath(active)], …)` |
| G5 | `bindEditor` remote | `bindEditor 3234-3248` | diff `doc.code` → one CM | `reconcileFromDoc(doc)` — diff every file + structure (§3.3) |
| G6 | run gate | `run() 3142` | `collab.active \|\| !project.isMulti()` | `!project.isMulti()` — **drop `collab.active`** so a multi-file room runs the project path |
| G7 | presence cursor | `startPresence 3265` | `{line,ch,anchor}` | + `file: encPath(active)` |
| G8 | cursor render | `renderPeers 3276` | render ALL peers | render only peers whose `file === active` (§5) |
| G9 | structural ops | `newFilePrompt/folderMenu/tabMenu/drop` | `project.*` + `flushSave()` (no-op in room) | + `roomOp(…)` to `handle.change()` (§4) |
| G10 | restore-in-room | `restoreSnapshot 2104-2108` | `project.load` + `flushSave()` (invisible to peers) | + when `collab.active`, overwrite the whole doc (§7.2) |
| G11 | explorer visibility | `renderTabs` | **already always-on** (no gate) | no change — but its data is now reconciled from the doc (§3.3) |
| G12 | autosave in room | `flushSave 2572`, `editor.on change 2581` | early-return in room | unchanged in-room; **on leave**, `flushSave()` captures room work (§6.4) |

**G6 nuance:** `run()` reads `project.serialize().files` (line 3150) and `project.entry`. In a room those
are the locally-reconciled values — identical across peers after convergence — so every peer runs the same
project. `runFile` becomes `project.entry` (multi-file) as it does solo. No collab-specific run code.

### 7.1 Seeding consistency

- Only the room **creator** calls `repo.create` (seeds). Joiners only `find` → no double-seed race
  (carried from the old spec, lines 76-78).
- Seed iterates `project.order` (not `Object.keys(files)`) so `order`/`files`/`entry` are internally
  consistent from creation (§2.2).
- If the creator's project is **single-file**, the seed is a `{files,order,entry}` doc with one key — the
  depth-1 case of the same shape. No special path. (This is why the existing single-file `collab.mjs` can
  keep passing — see §9.4.)

### 7.2 Restore-in-room consistency (G10)

`restoreSnapshot` (2098-2110) does `project.load(rec.project)` + `flushSave()`. In a room the `flushSave`
is a no-op, so a restore is **invisible to peers and clobbered on the next remote change**. Fix: when
`collab.active`, after the local `project.load`, overwrite the WHOLE shared doc in one transaction:

```js
// in restoreSnapshot, after project.load(rec.project):
if (collab.active) {
  const enc = encodeProject(project.serialize());
  roomOp(d => {
    // replace files/order/entry wholesale: delete keys not in enc, set/replace the rest
    for (const k of Object.keys(d.files)) if (!enc.files[k]) delete d.files[k];
    for (const k of Object.keys(enc.files)) {
      if (d.files[k] == null) d.files[k] = enc.files[k];          // new key: assign
      else updateText(d, ['files', k], enc.files[k]);             // existing: char-merge to restored text
    }
    d.order = enc.order;
    d.entry = enc.entry;
  });
}
```

This makes a restore a normal multi-file structural change that propagates to peers. (`captureSnapshot`
already serializes the full project — no change there; it just tags `mode: "room"`.)

> **Restore-in-room is inherently destructive to peers' in-flight edits** (it overwrites every file to the
> snapshot). v1 keeps the existing `confirm("Replace your current code with this version?")` — acceptable,
> but flagged as an OPEN QUESTION (§11): should restore-in-room warn that it overwrites for *everyone*?

---

## 8. Revising `docs/specs/2026-06-18-collab-sharing-design.md`

The old spec **locks the single-file shape** and must be revised (implementation-time; this is the
inventory of what changes, not the edit itself):

| Line(s) | Current text | Change to |
|---------|--------------|-----------|
| **26** | "Run stays local. Sync covers `{ code: string }` plus ephemeral cursors." | "Run stays local. Sync covers the multi-file project `{files, order, entry}` (path-keyed CRDT) plus ephemeral **per-file** cursors." |
| **47-51** | the `{ code: string }` shared-document-shape block | the `{ files: {[encodeURIComponent(path)]: text}, order, entry }` block + the encode/decode-boundary rule (§2). |
| 80-92 (Data flow) | `bindEditor` against `["code"]`, prefix/suffix on the one CM | the multi-file reconciliation (§3) — local→remote per active key; remote→local full reconcile. |
| 98-115 (Cursors) | cursor `{line, ch}`, all peers rendered | cursor gains `file`; render filtered to the active file (§5). |
| 117-124 (Interaction) | "autosave paused in room … resume from last solo draft" | on leave, the **whole** reconciled project is kept locally via `flushSave` (§6.4) — not discarded. |

Recommended: add a short pointer at the top of the old spec to **this** doc as the multi-file successor,
rather than rewriting it wholesale — the old spec's transport/bundle/lazy-load rationale (the `vendor/`
bundle, `wss://sync.automerge.org`, lazy import) is all still correct and load-bearing.

---

## 9. TDD test plan — TWO-PEER browser tests

The de-risk's emphasis: the residual risk is **UI-integration reconciliation**, which CRDT-level spikes
cannot catch. It needs **two real browser contexts in ONE Playwright run**, both joining the SAME room.

### 9.1 New file: `test/collab-multifile.mjs`

Pattern: reuse the existing `test/collab.mjs` harness (`./_harness.mjs` `launch()`, `b.newPage()`,
`localhost:8923`, `#room=` hash hand-off, `waitForFunction` polling) and the spike's two-tier connection
idea (live `wss://sync.automerge.org` with an **offline fallback** when the relay is unreachable). Concretely:

- **Localhost-pinned**, same as `collab.mjs` (`http://localhost:8923/`). Two pages A and B; A starts a room
  (`#collabStartBtn`), B joins via the `#room=` hash A produced — the exact hand-off `collab.mjs` already
  does (lines 26-30).
- **Offline fallback:** the *app* always uses the live relay (it has no loopback adapter). So unlike the
  Node spike, the browser test cannot inject a loopback. Mitigation: the test is **relay-dependent like
  today's `collab.mjs`**; gate it the same way `collab.mjs` is gated (it already tolerates relay flakiness
  with generous `waitForFunction` timeouts + retry on join). If the relay is down, the test reports SKIP
  (not FAIL), mirroring `collab.mjs`'s `findWithRetry`/timeout tolerance. **Decision point for the
  orchestrator (§11):** is a relay-down run a SKIP or a FAIL in CI? Recommended SKIP (the CRDT layer is
  already proven offline by the spike; this test proves *UI wiring*, which needs a live transport).

### 9.2 Assertions (the reconciliation risk surface)

Drive both pages' CodeMirror via `window.project` / `window.renderTabs` / the explorer DOM. Assert:

1. **Concurrent edits to two DIFFERENT nested files converge on BOTH peers.** A edits `sprites/enemy.py`,
   B edits `sounds/blip.py` (both must exist in the seed — seed a 3-file nested project). After settle,
   both files have both edits on A and B; the untouched sibling (`main.py`) is byte-identical. (Mirrors
   spike assertion 2; here it must survive the *full reconcile + render*, not just the CRDT.)
2. **Add-file propagates + gets a tab + a Doc (no lost file).** A creates `sprites/boss.py` via the
   explorer (`newFilePrompt`/`+ new file`); B's `window.project.order` includes `sprites/boss.py`, a tab
   row renders, and B can `setActive` it and edit it (→ converges back to A). (Lost-file guard.)
3. **Rename propagates + no ghost tab.** A renames `sprites/enemy.py`→`sprites/villain.py`; on B the old
   tab is GONE and the new one present; `window.project.files` has the new key, not the old; the entry
   badge is correct if entry was renamed. (Ghost-tab guard.)
4. **Move-into-folder propagates.** A moves `main.py`→`core/main.py` (drag or folder menu); B's tree shows
   it under `core/`, `order`/`entry` updated, old key gone. (Mirrors spike assertions 5-6 at the UI level.)
5. **Per-file presence isolation.** A is on `main.py`, B is on `sprites/enemy.py`. Assert A renders **NO**
   `.remote-cursor` while B is on a different file; then A `setActive("sprites/enemy.py")` → A now renders
   B's `.remote-cursor`. (The single most bug-prone presence assertion.)
6. **Roster count is right regardless of file.** With A and B on different files, `#peerCount` on A is
   `2` (count = peers + you) — proving the roster counts everyone even though the cursor filter hides B's
   caret. (Distinguishes "count" from "render".)
7. **`order`/`entry` stay consistent after each structural op:** on B, `order` key-set === `files` key-set
   and `entry` is a live key (mirrors spike assertions 8). Re-check after add/rename/move/delete.
8. **Delete propagates + active repair.** A deletes the file B is *actively viewing*; B's active repoints
   to a surviving file (entry), no dead Doc, no console error. (Active-file repair guard, §3.3 rule D.)
9. **Cursor preserved on remote edit to the active file.** A and B both on `main.py`; A types at the top;
   B's caret (lower in the file) does not jump. (Cursor-preservation guard — `spliceActiveDoc`.)
10. **Restore-in-room propagates** (if S6b includes it): A restores a snapshot; B's whole project updates.
11. **Solo path loads ZERO Automerge** — carried verbatim from `collab.mjs` (the `reqs.length === 0`
    assertion). This is the lazy-load guardrail and MUST stay green.

### 9.3 Helper structure

Factor the two-peer seed + settle helpers (e.g. `seedNestedRoom(A)`, `waitConverge(page, predicate)`)
into the new file; do NOT modify `_harness.mjs`. Use `window.project`/`window.renderTabs`/`window.runFile`
test seams already exported (lines 1644, 2326, 2139) plus the explorer DOM (`.tab[data-name]`,
`.remote-cursor`, `#peerCount`, `#collabStartBtn`).

### 9.4 Does the existing single-file `collab.mjs` EVOLVE or stay a separate guardrail?

**Recommendation: KEEP `collab.mjs` as a separate guardrail; do NOT fold it into the new file.** Rationale:
- Single-file is the **depth-1 case** of the multi-file shape (§7.1) — a one-key `{files,order,entry}` doc.
  `collab.mjs`'s scenarios (start a room from a single file, B adopts, two-way sync, concurrent edits
  survive, presence count + remote cursor + peer name, unavailable-room fallback) are all still valid and
  are the **smallest** reproduction of the room machinery. Losing them would lose the cheapest regression
  signal.
- BUT several `collab.mjs` assertions **assume the single-file `{code}` doc** and must be **reconciled to
  the new shape** (they will otherwise break the moment G1-G3 flip):
  - It seeds via `CodeMirror.setValue('seeded_by_A = 123')` then `#collabBtn`, and asserts B's CM
    `getValue().includes('seeded_by_A')`. Under the new shape the room is still single-file (one file), so
    this **should keep working** as the depth-1 case — but verify the adopt path (`project.load` +
    `swapDoc`) lands the text in B's CM, not the old `setValue(doc.code)`.
  - The concurrent-edit assertion (`line_one`/concurrent survive) is now a *same-file* char-merge on the
    single key — still valid.
  - The presence assertions (`#peerCount === '2'`, `.remote-cursor`, `.remote-flag` name) — with both
    peers on the same single file, the per-file filter is a **no-op** (same `file`), so they keep passing.
  - The unavailable-room fallback (`#room=automerge:doesNotExist999` → stays usable) — unchanged.
- **Action:** after G1-G3 land, re-run `collab.mjs`; fix any assertion that implicitly depended on
  `editor.setValue(doc.code)` semantics (likely none, since the depth-1 path produces the same observable
  CM text). Treat `collab.mjs` as the **single-file regression** and `collab-multifile.mjs` as the
  **multi-file feature test** — two files, two scopes, both in the battery.

---

## 10. RECOMMENDED sub-slice split (S6a / S6b)

S6 is the largest slice (2×L + several M/S). Split it like S2 was split, so each half lands behind a
**green two-peer checkpoint** before the next begins. The split is along the natural seam: **S6a proves a
multi-file room SYNCS and RECONCILES; S6b makes it fully editable structurally + presence + chrome.**

### S6a — Path-keyed CRDT + `bindEditor` multi-file reconciliation + seed/adopt

**Scope:**
- The encode/decode boundary (§2): `encPath`/`decKey`/`encodeProject`/`docToRecord`.
- `startRoom` seed = `encodeProject(project.serialize())`; delete the `isMulti()` confirm/entry-only block
  (G1, G2).
- `joinRoom` adopt = `project.load(docToRecord(doc))` + render (G3).
- `bindEditor` rewrite: local→remote per active key (G4); remote→local `reconcileFromDoc` (G5) — added/
  removed keys, per-file text splices (active = cursor-preserving, non-active = Doc splice), `order`/
  `entry` reconcile, active-file repair.
- `run()` gate flip to `!project.isMulti()` (G6).
- Keep `collab.mjs` green (single-file = depth-1).

**Green checkpoint (S6a):**
- New `collab-multifile.mjs` assertions **1, 2 (add via doc, not explorer), 7, 8, 9** pass: concurrent
  nested edits converge on both peers; a remotely-added file appears (no lost file); a remotely-removed
  file disappears with active repair (no ghost tab, no dead Doc); cursor preserved on remote active-file
  edit; `order`/`entry` consistent.
- `collab.mjs` (single-file) still green. Solo loads 0 Automerge.
- At S6a, structural ops from the EXPLORER are not yet routed to the doc — so a *local* explorer add in a
  room won't propagate yet. That is exactly what S6b adds. (S6a proves the room *reconciles* doc-level
  changes; S6b *produces* them from the UI.)

### S6b — Structural file-ops via `handle.change()` + per-file presence + rail-view wiring

**Scope:**
- `roomOp` helper + routing every explorer op (create/rename/move/delete/setEntry/reorder) to the doc
  (§4, G9), incl. copy-and-delete for rename/move.
- Per-file presence: `file` field on the cursor, render filter, repaint on switch (§5, G7, G8).
- Rail-view wiring: idle/active states, roster with per-peer file, room link + Copy + Leave, `leaveRoom()`
  (§6).
- Restore-in-room (§7.2, G10).
- Revise `2026-06-18-collab-sharing-design.md` (§8).

**Green checkpoint (S6b):**
- `collab-multifile.mjs` assertions **2 (add via explorer), 3, 4, 5, 6, 10** pass: explorer add/rename/
  move-into-folder propagate to the peer; per-file presence isolation (a peer on another file renders NO
  caret; switching reveals it); roster count correct regardless of file; restore-in-room propagates.
- Full battery green; `collab.mjs` reconciled (§9.4) and green.

**Why this seam:** S6a is "can a multi-file room exist and stay consistent under remote change" (the CRDT-
adjacent reconciliation risk). S6b is "can the UI drive every structural change + show who's where" (the
interaction risk). Each is independently testable; a broken S6b can't corrupt S6a's proven reconciliation.

---

## 11. Risks + open questions

### Risks (with mitigations)

| Risk | Severity | Mitigation |
|------|:--------:|-----------|
| **Ghost tabs / lost files** in `reconcileFromDoc` | High | Drive add/remove from the remote key set; one `renderTabs` at the end; `order` filtered to paths with a Doc (§3.3). Test assertions 2, 3, 8. |
| **Cursor jump** on remote edit to the active file | Med | Only the active file uses the cursor-aware splice; non-active Docs spliced without touching the caret (§3.3). Test assertion 9. |
| **Per-file presence filter forgotten** = silent caret corruption (not a crash) | High | The `cur.file !== here` filter in `renderPeers` (§5.2). Test assertion 5 (the highest-value presence test). |
| **Rename char-history + in-flight-keystroke loss** | Accepted | Documented v1 semantics (§4.2). Not a bug — a known map-rekey limitation. Flag in UI copy if desired. |
| **Half-relaxed gates** (one gate flipped, another not) | High | The exhaustive G1-G12 table (§7); S6a/S6b checkpoints force the related gates to flip together. |
| **Restore-in-room overwrites peers' in-flight edits** | Accepted | Keep the existing confirm; flagged as an open question (warn-for-everyone?). |
| **Double-encoding** (a `%2F` key leaking into `#project=`/zip/localStorage) | Med | The boundary rule (§2.2): only create/adopt/edit/op/presence cross the boundary; `serialize`/zip/`#project=` stay human. Round-trip test (§2.2). |
| **Empty folders don't propagate** (not in the doc) | Low/Accepted | Documented (§2.1). A folder appears for peers when a file lands in it. Trivial later extension (`emptyDirs` array in the doc). |

### Open questions for the orchestrator

1. **Backward-compat for a missing `file` field on an old peer's cursor (§5.3):** render on entry
   (lenient) vs. don't render (strict)? **Recommendation: strict.** Decide before S6b presence lands.
2. **Relay-down in CI: SKIP or FAIL for `collab-multifile.mjs` (§9.1)?** The app has no in-browser loopback,
   so a relay-down two-peer browser run can't fall back like the Node spike. **Recommendation: SKIP** (the
   CRDT is already proven offline by `spike-collab-paths.mjs`; this test proves UI wiring and needs a live
   transport) — but confirm the CI policy, and whether `collab.mjs` is already treated this way.
3. **`collab.mjs` — evolve or keep separate (§9.4)?** **Recommendation: keep separate** as the single-file
   (depth-1) regression; reconcile only the assertions that implicitly assumed `setValue(doc.code)`.
   Confirm this is the desired test topology before touching it.
4. **Restore-in-room (§7.2):** should it warn the user that restoring overwrites the project for *everyone*
   in the room (not just locally)? And is restore-in-room even in S6b's first cut, or a fast-follow?
   **Recommendation: include in S6b with the existing confirm**; upgrade the confirm copy to mention peers.
5. **Empty-folder propagation (§2.1):** ship v1 without it (a folder shows for peers only once it holds a
   file), or add an `emptyDirs` array to the doc now? **Recommendation: ship without** — it keeps the doc
   shape identical to the proven spike; revisit if users hit it.
6. **`order` LWW vs concurrent reorder churn:** `order` is an Automerge list; concurrent reorders merge but
   can produce a surprising interleaving. The spike proved consistency, not *intuitive* ordering under
   simultaneous reorder. Low risk (reorders are rare), but worth a manual two-peer reorder sanity check
   in S6b. No code decision needed unless it surfaces.
7. **Rename-vs-edit and same-file concurrent edit** were NOT asserted in the path spike (noted in the
   feasibility report §4 caveats). **Recommendation:** add a two-peer assertion for same-file concurrent
   edit (S6a) and a rename-while-peer-edits assertion documenting the accepted keystroke loss (S6b), so the
   accepted tradeoff is captured as a test, not just prose.

---

## Appendix — proven-spike → real-impl mapping (quick reference)

| Spike (`spike-collab-paths.mjs`) | Real impl (this design) |
|----------------------------------|--------------------------|
| `enc`/`dec` (l.72-73) | `encPath`/`decKey` (§2.2) |
| `seedDoc()` (l.168-172) | `encodeProject(project.serialize())` in `startRoom` (§6.1) |
| `docToRecord(doc)` (l.88-92) | `docToRecord` → `project.load(...)` in `joinRoom`/reconcile (§2.2, §6.2) |
| `editFile` = `updateText(['files', enc(p)], …)` (l.83) | `bindEditor` local→remote (§3.2) |
| `addFile` = plain assignment (l.85) | create op mutator (§4.1) |
| move/rename copy-and-delete (l.235-263) | `roomOp` copy-and-delete (§4.2) |
| `entry` LWW (l.266) | set-entry mutator (§4.1) |
| order==keys + entry-live asserts (l.271-279) | §4.4 + test assertion 7 (§9.2) |
| concurrent disjoint-file convergence (l.204-216) | test assertion 1 (§9.2) |
