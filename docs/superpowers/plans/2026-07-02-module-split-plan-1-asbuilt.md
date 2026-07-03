# Module Split — Plan 1 (Foundations): As-Built Record

> Executed 2026-07-02 via subagent-driven development (fresh implementer per task,
> independent spec + quality review per task). Plan:
> [`2026-07-02-module-split-plan-1-foundations.md`](2026-07-02-module-split-plan-1-foundations.md).
> Spec: [`../specs/2026-07-01-es-module-decomposition-design.md`](../specs/2026-07-01-es-module-decomposition-design.md).
> **This file is the primary input for authoring Plan 2 (project/viewer/assets/explorer).**

## End state

- `index.html`: **4,069 → 3,203 lines** (baseline `348d352`; it briefly grew ~20 lines
  during step-0 seam hardening before the extractions). Now: markup + CSS + CodeMirror CDN tags + a classic
  script = prelude (`let pyodide` + `pySeam`) → `window.__appMain = async function () {…}`
  (the remaining legacy body) → explicit-seam block → dynamic-import bootstrap of
  `src/main.mjs` with a `boot failed` DOM fallback.
- `src/` (8 modules, 1,076 lines): `main.mjs` 47 · `util.mjs` 76 · `ui.mjs` 52 ·
  `dialogs.mjs` 225 · `lint.mjs` 57 · `editor.mjs` 56 · `examples-data.mjs` 379 ·
  `lessons-data.mjs` 184.
- New battery: `test/seams.mjs` — the executable seam inventory (10 checks: bare pyodide,
  17 window fn seams, 8 object seams, project API + live Docs, ONE-CodeMirror identity,
  selectedFolder bare-write, closedFolders, lazy gates incl. resource-timing eager-load
  detection, status vocabulary, zero JS errors). **Zero existing test files modified.**
- Merges on main (each gated on the full 23-suite battery):
  `7c75c68` step-0 · `4c8d26b` step-1 bootstrap+examples · `4d344f7` step-2 lessons-data ·
  `3b5dbf6` step-3 util · `960becf` step-4 ui · `d51ffe1` step-5 dialogs ·
  `138ba11` step-6 lint · `b7836cf` step-7 editor.

## Transitional mirrors (authoritative list = the `Object.assign` in `src/main.mjs`)

27 entries + `window.__pySeam`. PINNED (permanent test seams, never delete): `setStatus`,
`confirmModal`, `toast`, `editor` (+ `window.__closePopMenu`, assigned in dialogs.mjs).
All others are transitional — Plan 4 deletes each when its last bare consumer leaves
`__appMain`. Five window names live OUTSIDE the Object.assign, self-published by the data
modules: `EXAMPLES` (PINNED), `EXAMPLE_FILENAME`, `DEFAULT_EXAMPLE` (transitional),
`LESSONS`, `FRIENDLY_ERRORS` (assign-once contract). The host's explicit-seam block
retains: `run`, `tabMenu`, `newFilePrompt`, `renderHistory`, `restoreSnapshot`,
`showView`, `closedFolders` (each moves to main.mjs when its subsystem extracts).

## Deviations from the plan (all reviewed and approved)

1. **Task-1 RED expectation corrected**: 3 failures from 2 root causes (seams check 5
   reads `window.editor`, so it fails downstream of the same root as check 3).
2. **seams.mjs hardened beyond the plan block** (review findings, before freeze):
   `__engineDiag` in the fn inventory; jsErrors + `/favicon/` filter + final check;
   resource-timing eager-load detection (`/automerge|jszip|jsdiff|ruff|addon\/lint\//i`)
   — the sentinel checks are blind to a static-import regression; `closedFolders` check;
   `!!window.project` guard; sibling summary line instead of `process.exit`.
3. **The Step-0 implicit-seam inventory was incomplete.** Wrapping the body (Task 5) broke
   two bare seams the plan missed: `closedFolders` (caught BY NAME by seams.mjs) and
   `showView` (caught by history.mjs). Fixed with two annotated seam-block lines. A
   post-hoc AST free-variable sweep of all in-page test callbacks (quality review, Task 5)
   confirmed no further gaps. Also: the plan's Task-2 "17 references" header was wrong —
   15 reference lines / 22 tokens + declaration = 23 `window.selectedFolder` occurrences.
4. **`b64url` DELETED at wrap-up** (final holistic review): it was already dead code at
   the pre-plan baseline — share-removed.mjs asserts the legacy `#project=`/`#code=`
   readers stay REMOVED, so nothing decodes those links. The extraction had initially
   moved it with an invented "legacy compat" contract; the final review caught the false
   contract and the code is gone.
5. **`idbStore` factory deferred to Plan 2** — its only consumers (assetStore,
   historyStore) extract there; no untested speculative code shipped.
6. **lint's "overlapping retries" kept** — inspection showed `_linter = null` (re-fetch)
   and `lintArmed = false` (re-invoke) are complementary, not redundant; now documented
   in-module. Offline→recover choreography verified empirically via request interception.
7. **lessons-data exports deleted post-review** (capturable bindings under a
   "never capture" contract = footgun; zero importers existed). Python literals converted
   to `String.raw` (byte-identical today; guards future backslashes). The module is a pure
   side-effect import.
8. **`importOnce` semantics documented as loadEngine-parity ONLY.** ⚠ Plan-4 trap
   averted: `loadAutomerge` caches only on SUCCESS (a failed collab click retries on the
   next click); recomposing it on `importOnce` as-is would cache the rejection
   permanently. `onFirst` is awaited. Dead mirrors `b64url`/`isAssetPath` dropped.
9. **esc/escTab**: behavior-identical (not byte-identical — quote style) twins; deduped
   to one implementation, two mirrors.
10. **verify.mjs lives at the REPO ROOT** (not `test/`). A Task-7 implementer missed it
    for one battery run (coordinator re-ran it green). Battery scripts must list it as
    root-level `verify.mjs`.

## Genuine bugs found (not regressions)

- **Stuck rename input on ext-appending no-op rename** (rename `main.py` → `main`):
  commit returns true with no repaint; input stays inert in the row. Reproduces
  identically pre-refactor. Filed as a spawned task chip (task_52ad848f).
- Vestigial CSS: `.vbody.hide-cm .CodeMirror` — no JS ever adds `hide-cm`. Cleanup
  candidate for a later pass.

## Environment facts (needed to run the battery)

- `PLAYWRIGHT_CORE=/Users/alan/Desktop/Projects/Trellis/verification/node_modules/playwright-core/index.mjs`
  (the harness default `~/Desktop/Trellis/...` path is stale on this machine).
- Static server from repo root on :8923 (`python3 -m http.server 8923`). A stale server
  with a dead directory handle 404s everything — curl `/` for 200 before trusting it.
- Battery = 22 `test/*.mjs` suites (spike-* are historical, not gates; `fixtures.mjs` and
  `_fixtures.mjs`/`_harness.mjs` are fixture/harness shims, not suites) + root `verify.mjs`.
- Known flakes (re-run once, note it): the three collab suites (public sync server);
  verify.mjs 'boot failed' before interaction (jsdelivr Pyodide CDN).

## Handoff notes for Plan 2 (project/viewer/assets/explorer)

- **dialogs.mjs:93** couples the leaf module to `#tabs` at module eval (scroll-dismiss).
  Explorer must re-wire this via a registered callback when it extracts.
- **`wireInlineEdit`**: add a `rejectHint` option when a consumer needs async CREATE
  ("rename failed" is rename-specific copy); document the cancel-protocol
  ("call `cancel()` then return `false`") in the contract comment — Plan-2 consumers will
  copy from it.
- **`stashEditor`/`showEditorIn`** are exported but unadopted (the body still hand-rolls
  the wrapper dance via mirrors — verified equivalent today). Adopt them in Plan 2's
  viewer extraction, and add a comment: call `showEditorIn` after the doc is in place (or
  rely on setActive's refresh); the helper does NOT clear `.imgview/.sound/.empty`
  surfaces — that stays with the caller.
- The history-diff renderer's local `const before = rec.project.files[active] ?? ""`
  (search for that string — line numbers drift every step) shadows the mirrored name —
  rename to `beforeText` when history extracts (Plan 3).
- **`isAssetPath`** has no consumer anywhere — asset-path validation appears to happen
  inline; investigate during the assets extraction.
- Registration order of the four `editor.on("change")` listeners (armLint hook 1st,
  autosave, promote, collab-on-join) is preserved and was shown NOT load-bearing —
  main.mjs may consolidate them in Plan 4 without fear, but document the order anyway.
  ⚠ The spec's module row 19 originally stated this order BACKWARDS and called it
  load-bearing; corrected in the spec at wrap-up. **This as-built supersedes spec #19.**
- Wrap-up fix pass (this commit): `b64url` deleted; `showView` added to seams.mjs's fn
  inventory (now 18); stale/imprecise comments freshened in lint.mjs, main.mjs
  (`__pySeam` — Plan 2 is its first consumer), util.mjs (importOnce forward-provisioning),
  dialogs.mjs (closeModal export rationale), lessons-data.mjs (bare-window idiom),
  index.html (all four change-listeners named).
- The lessons-data-as-JSON question (non-engineer authoring) remains open by design
  (spec §10).

## Process notes

- Two-stage review per task earned its cost: it caught a plan under-count (Task 1), seven
  seam-battery coverage holes (Task 1), the missing-seam wrap casualties (Task 5), the
  export footgun (Task 6), the importOnce/loadAutomerge doc trap (Task 7), and a
  pre-existing UI bug (Task 9) — none of which the green battery alone would have flagged.
- Implementer subagents must run the battery as ONE FOREGROUND command with a tee'd log
  (background runs lose results across turn boundaries).
