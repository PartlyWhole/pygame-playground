# Multi-file Collaboration — Feasibility, Cost & Recommendation

**Date:** 2026-06-23
**Status:** De-risk complete (spike green). Decision pending.
**Scope:** Should live collaboration rooms expand from single-file to multi-file? This report covers what the room is today, the proposed CRDT shape, the full rework cost, what the spike proved vs. what stays as risk, and a recommendation framed for a team go/no-go.
**Spike:** `/Users/alan/Desktop/pygame-playground/test/spike-collab-multifile.mjs` — `node test/spike-collab-multifile.mjs` (live relay 12/12, exit 0; `SPIKE_NO_NET=1` offline fallback 13/13, exit 0).
**Constraint:** No `index.html` changes were made; this is analysis only.

---

## 1. What a room is today (single-file)

Live collaboration is **single-file by design**. The shared Automerge document is `{ code: string }` and nothing else — created at `index.html:1978` as `collab.repo.create({ code: seed })`. The existing spec (`docs/specs/2026-06-18-collab-sharing-design.md`) **locks this shape** at lines 47–51 and explicitly scopes collaboration as single-file at line 26: *"Sync covers `{ code: string }` plus ephemeral cursors."* There is no `files` map, no `order`, no `entry` in the doc.

Concretely, the single-file assumption is baked into several seams in `index.html`:

- **`startRoom()` (1966–1983):** if the local project is multi-file, a `confirm()` warns *"Live collaboration is single-file. Share only your entry file"* and seeds the room with the **entry file only** (`project.text(project.entry)`); declining backs out to `setLive('offline')`.
- **`bindEditor()` (1870–1895):** a two-way binding hardwired to the single `['code']` path and the one `editor` CodeMirror instance, with a prefix/suffix diff that preserves the cursor.
- **`renderTabs()` gate (1513):** `const show = project.isMulti() && !collab.active` — the tab strip is **hidden in any room** because a room is single-file.
- **`run()` gate (1814):** `if (collab.active || !project.isMulti())` forces the single-file `_start(editor.getValue())` path in any room.
- **`startPresence()` (1903–1948):** cursors carry `{line, ch, anchor}` only — **no file identity**.

The result is correct and shippable today, but a multi-file local project collapses to one file the moment it is shared.

---

## 2. Proposed multi-file CRDT shape

Mirror the existing local serialization so the bridge to the data model is near-verbatim. `project.serialize()` (`index.html:1081-1085`) already returns exactly `{ files, order, entry }`, and `project.load(rec)` already consumes it.

```js
{
  files: { [name: string]: AutomergeText },  // per-file text; key = module name, e.g. "main.py"
  order: string[],                           // tab order (Automerge list)
  entry: string                              // entry module (last-writer-wins scalar)
}
```

**Key decision — per-file Automerge text, not one concatenated blob.** Each `files[name]` is its own text object, edited via `updateText(d, ['files', name], next)`:

- Two students editing **different** files touch **disjoint CRDT paths** — their edits never contend. This file-level parallelism is the entire point of going multi-file, and it comes for free.
- Two students editing the **same** file get character-level merge, exactly as today's single `['code']` path does.
- `order` as an Automerge list merges concurrent reorders/adds; `files` as a map makes add-file = set a key and delete-file = delete a key (clean concurrent ops); `entry` is a rare-conflict LWW scalar.

**This deliberately supersedes the locked single-file shape** in `docs/specs/2026-06-18-collab-sharing-design.md` (lines 26, 47–51). It is a scope expansion, not a drift — the spec must be revised (or a new spec authored) before implementation so the decision is intentional.

**Rename semantics (must be decided up front).** Recommended v1: rename = a single `handle.change()` transaction that copies the old file's current value into the new key, deletes the old key, and rewrites `order`. This is simple and concurrent-safe but **destroys that file's char-level history**, and if peer A renames while peer B is mid-edit on the old name, B's in-flight keystrokes land on the orphaned old key and are lost on next sync. Accept and document this for v1. A history-preserving rename is not expressible via a plain map rekey and is out of scope.

---

## 3. Rework list with effort, and rough total

All line references are in `index.html`. Effort is S (≈hours), M (≈half-day to a day), L (≈multi-day, where merge bugs hide).

| # | Area | Change | Effort |
|---|------|--------|:---:|
| 1 | Spec revision (`2026-06-18-collab-sharing-design.md` lines 26, 47–51) | Replace locked `{ code: string }` with `{ files, order, entry }`; update single-file scoping language. A spec change, authored before building. | **S** |
| 2 | `startRoom()` seed (1966–1983) | Delete the `isMulti()` confirm / seed-entry-only block (the single biggest seam); replace `create({ code: seed })` with `create(project.serialize())`. | **S** |
| 3 | `joinRoom()` adopt (1985–1997) | Replace `editor.setValue(doc.code)` with `applyingRemoteSet(() => { project.load(docToRecord(doc)); renderTabs(); })`; add `docToRecord()` helper. Wrap the whole load in `applyingRemoteSet`. | **M** |
| 4 | `bindEditor()` per-file binding + rebind (1870–1895) | **Largest change.** Local: push `updateText(d, ['files', project.active], …)` keyed by active file. Remote: diff *every* changed file, splice the active CodeMirror.Doc (preserve cursor), `setValue` non-active Docs; **also reconcile structural deltas** (key set + `order` array) into the project. | **L** |
| 5 | Structural file ops route to shared doc (tab handlers 1524–1558) | When `collab.active`, add/rename/delete/setEntry become `handle.change()` mutations instead of `flushSave()` (a no-op in a room). `setActive` stays local (active file is per-peer). | **L** |
| 6 | Re-enable tab strip in a room (`renderTabs` gate 1513) | Drop `&& !collab.active`. Trivial flip; the real work is in #4/#5. | **S** |
| 7 | `run()` multi-file path in a room (1814) | Change gate to `if (!project.isMulti())` so a multi-file room takes the `_start_project(files, entry)` branch. | **S** |
| 8 | Per-file presence/cursors (`startPresence` 1903–1948) | Add a `file` field to broadcast cursor; in `renderPeers`, **filter to peers whose `cur.file === project.active`**; repaint on file switch. Forgetting the filter = silent cursor-position corruption. | **M** |
| 9 | History restore-in-room (`captureSnapshot` 1264–1272, `restoreSnapshot` 1477) | Capture already serializes the full project (no change). Restore must, when `collab.active`, be a `handle.change()` that overwrites `files/order/entry` — otherwise restore is invisible to peers and clobbered on next sync. | **M** |
| 10 | `flushSave` / autosave coexistence (1583–1596) | Mostly unchanged; on **leaving** a room, add an explicit `flushSave()` to capture room work locally. | **S** |

**Rough total:** 2 × L, 3 × M, 5 × S. As a single focused effort, roughly **1.5–2.5 engineer-weeks** including the Tier-2 two-peer browser tests, the rename transaction, and the spec revision. The two L items (#4 `bindEditor` reconciliation and #5 structural ops) dominate and carry essentially all the residual risk; the S items are gate flips and a `create()`/`adopt()` swap.

---

## 4. What the spike proved vs. what stays as risk

The spike ran against **two independent `Repo`s and the real committed vendor bundle** (no rebuild — the existing 4-export bundle `Repo / Presence / WebSocketClientAdapter / updateText` is sufficient), over the **live relay the app actually uses** (`wss://sync.automerge.org`), with the same mandatory unavailable-retry loop.

**PROVEN (CRDT layer — high confidence):**

- The shape `{ files: {[name]: text}, order: string[], entry: string }` **creates, syncs, and is adopted whole** by a second peer → validates `seed = project.serialize()` and `adopt = project.load(docToRecord(doc))`.
- **`updateText` on a nested path `['files', name]`** produces the same minimal-splice merge as today's single `['code']` path — **risk (a), the #1 spike objective, is cleared.**
- **Concurrent edits to different files converge cleanly** (disjoint paths, both survive on both peers) — the headline "two students, two files" feature works.
- Editing one file leaves siblings byte-identical; adding a file propagates; `order` (list CRDT) and `entry` (LWW scalar) stay consistent; both peers end fully identical.
- A real gotcha surfaced and is now documented: **`updateText` cannot create a new map key** (throws *"invalid path … referenced a nonexistent object"*). Add-file must be a plain assignment `d.files[name] = initialString` inside `change()`; `updateText` is only for subsequent char-level edits. The real `renderTabs` add-file handler must follow this. This is exactly the class of bug the spike existed to catch.

**NOT proven — stays as UI-integration risk (medium confidence on end-to-end shipping):**

- **The `bindEditor` remote-change handler** that must diff every changed file *plus* structural deltas and reconcile into CodeMirror Docs — the L-effort item where merge bugs hide: ghost tabs, lost files, active-file pointing at a deleted key.
- **Per-file cursor presence** with the `file` filter (forgetting it is silent visual corruption, not a crash).
- **Rename = copy-and-delete** and its documented mid-edit keystroke loss.
- **Relaxing the two single-file gates** (`run()` 1814, `renderTabs` 1513) **consistently** — miss one and you get a half-multi-file room.
- **Restore-in-room** writing back to the shared doc.

These are **application reconciliation logic, not CRDT-feasibility risks** — Automerge handles the merges. They need their own **two-peer browser tests** (Tier-2 Playwright on a scratch harness, per the spike plan).

**Two minor caveats:** concurrent **same-file** edits and concurrent **rename-vs-edit** were not asserted in the spike (the design already flags rename keystroke-loss as expected/accepted) — worth adding before the rename code lands, but they do not change the go/no-go. A benign `TimeoutNegativeWarning` from the race wrapper is cosmetic.

---

## 5. Recommendation

**The multi-file doc shape is feasible and de-risked at the CRDT level. The remaining cost is UI-integration reconciliation, not collaboration risk.** Both options below are legitimate; the right one depends on demand, not on technical doubt.

### Recommended default: ship single-file now, invest in multi-file when demand is demonstrated

Keep today's single-file room as the shipped collaboration feature, and treat multi-file as a **fast-follow that is now pre-validated**. The CRDT spike clears the only question that couldn't be answered without building, so the multi-file work can be scheduled with confidence whenever it is prioritized — there is no remaining feasibility unknown to retire.

**Invest in multi-file when any of these hold:**

- Students/users actually hit the single-file wall — the "share only your entry file" `confirm()` is a real friction point in observed sessions, not a hypothetical.
- The redesign is committing to multi-file projects as a first-class workflow anyway (the local model already is multi-file), making single-file rooms the odd one out.
- There is **1.5–2.5 engineer-weeks** of capacity that can absorb the two L items **and** their two-peer browser tests — the reconciliation logic must not ship without those tests, or merge bugs (ghost tabs, lost files) will reach users.

**Stay single-file when:**

- Collaboration usage is light or experimental and the single-file `confirm()` flow is an acceptable limitation — the cost is hard to justify against low demand.
- Engineering capacity is committed elsewhere in the redesign and cannot absorb the L items *with* their tests. A half-finished multi-file room (gates relaxed inconsistently, reconciliation untested) is **worse** than today's honest single-file room.
- The team is not ready to own the documented v1 rename keystroke-loss tradeoff.

### Conditions for a clean multi-file build, in order

1. **Revise the spec first** (`docs/specs/2026-06-18-collab-sharing-design.md` lines 26, 47–51) so superseding the locked single-file shape is an intentional, recorded decision.
2. **Budget for the two L items as the real risk surface** and require **two-peer browser tests** for `bindEditor` reconciliation and per-file presence before they merge.
3. **Decide and document rename semantics** (recommended: single-transaction copy-and-delete; accept and document mid-edit keystroke loss).
4. **Relax all single-file gates together** (`run()` 1814, `renderTabs` 1513, `enterRoom` comments) — partial relaxation is a known footgun.
5. **Do not modify the committed vendor bundle** — the existing 4 exports are sufficient; only a structural-op *inspection* need would warrant the history-spike scratch-build pattern.

**Bottom line:** Proceed with confidence *if and when* multi-file collaboration is prioritized — the CRDT risk is retired. Until then, the shipped single-file room is correct and honest, and multi-file should wait on demonstrated demand and a capacity window large enough to do the reconciliation work *with its tests*, not a partial cut.
