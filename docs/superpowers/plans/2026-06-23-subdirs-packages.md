# S2 — Subdirs + Packages + Folder Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The SPEC is
> `docs/specs/2026-06-23-subdirs-packages-design.md` — **read it in full; §0.1 holds the binding
> orchestrator resolutions + the S2a/S2b execution split.** This plan only sequences the test-first
> execution (DRY against the design). TDD; commit per task; never weaken a test.

**Goal:** Real nested MEMFS paths + true Python packages (dotted imports, `__init__.py`, relative
imports) + a real nested explorer folder tree — replacing the flat bare-name model. Built on the
proven package-imports spike recipe (`docs/specs/2026-06-23-redesign-derisk-findings.md` §1,
`test/spike-packages.*`, 18/18 green).

**Architecture:** Replace the bare-stem `_ProjectFinder` with native `importlib` (project root on
`sys.path`); re-add the cooperative transform via a `MetaPathFinder` that delegates to `PathFinder`
and wraps the returned loader (gated to project-origin files). One `writePath` for all writes;
`invalidate_caches` after each reconcile; JS `project` keys become POSIX paths (+ `move`); persistence
carries path keys (+ additive `emptyDirs`); `renderTabs` derives a nested tree from the path set.

**Tech Stack:** static `index.html`, Pyodide 0.27.2 + pygame-ce (engine), CodeMirror 5, headless
Playwright (`test/_harness.mjs`). No build step.

**Serve + run (every task):** `python3 -m http.server 8923` then `node <test> http://localhost:8923/`.
**Guardrails green throughout (no edits):** `verify.mjs`, `test/{assets,collab,multifile,save,lint,history,shell}.mjs`, `test/spike-viewer.mjs`, `test/spike-runstop.mjs`.

---

## Sub-slice S2a — ENGINE (high-risk core; green BEFORE the UI)

**Files:** Modify `index.html` (`PROJECT_PY` engine §2; `isModuleName` §3.1; JS `project` model + `move`
§4.2; `serialize`/`load`/`deserializeProject`/`#project=`/`saveProject` zip path keys + `emptyDirs`
§4.3-4.6; `assetFS` nested-write mechanism §6). Create `test/subdirs.mjs` (engine assertions).

- [ ] **T1 — Author `test/subdirs.mjs` (engine, RED).** Implement the ENGINE assertions from design
  §7.1 (#2 `from sprites import enemy` RUNS; #3 dotted + `__init__` re-export; #4 relative+absolute
  intra-package; #5 imported cooperative loop does NOT freeze — the wrapper's proof; #6 stdlib import
  inside a project module still works; #7 nested asset load by path; #11 path round-trip save→reload→
  import; #12 `#project=` round-trip with paths; #13 `isModuleName` path validation accept/reject set;
  #14 flat-`.py` coexistence via `BOOT_PY`; #16 first-paint laziness) PLUS model-level checks: `move`
  re-keys (file + folder-prefix), `rename`/`remove` by path, and `emptyDirs` serialize/load round-trip.
  Drive everything PROGRAMMATICALLY via `window.project` + `run()` (no tree-DOM dependency). Run →
  confirm RED for the right reason (engine is still flat); confirm the guardrails still GREEN against
  today's engine. Commit `test(S2a): engine subdirs+packages battery (RED)`.
- [ ] **T2 — Implement the engine (GREEN).** Apply design §2-§4 + §6 to `index.html`. Make
  `test/subdirs.mjs` + ALL guardrails green. The `MetaPathFinder` wrapper (§2.2, design Q6) is required;
  if it can't be made robust, STOP/escalate — do not relax `multifile.mjs` checks 2/3. Commit
  `feat(S2a): true nested paths + native package imports (engine, all green)`.
- [ ] **T3 — Spec-compliance review, then code-quality review** (subagents); implementer fixes; re-review
  until both ✅. Independent full-suite verify by the controller.

## Sub-slice S2b — TREE UI (built on the green engine)

**Files:** Modify `index.html` (`renderTabs` nested tree §5.2; `#tabs` click delegate carets/DnD §5.3/
§5.5; folder create/rename/delete §5.4; `#newFolderBtn` enable; assets nested per Q2 §5.6). Create
`test/explorer-tree.mjs`. Modify `test/multifile.mjs` (the single lockstep tighten, line ~282).

- [ ] **T1 — Author `test/explorer-tree.mjs` (RED)** for the UI assertions (design §7.1 #1 folder row +
  nested file row; #8 folder-rename UI re-keys + warn note; #9 folder-delete subtree + prune; #10
  drag-move-into-folder + descendant guard blocked; #15 empty-folder renders; assets appear nested as
  `.tab.asset[data-name=path]`; first-paint laziness on the tree). Apply the lockstep tighten
  `multifile.mjs:~282` (`#tabs .tab` → `#tabs .tab[data-name]`, value unchanged). Run → RED for the
  right reason (tree not built); guardrails GREEN. Commit `test(S2b): explorer tree battery (RED) + multifile lockstep`.
- [ ] **T2 — Implement the nested tree (GREEN).** Apply design §5. Folders are `.tab.folder[data-path]`
  (NEVER `data-name`); file/asset rows keep `.tab[data-name]` (path-valued) + `.active`/`.entry`; open
  via swapDoc/setActive, NEVER `editor.setValue` (landmine b); folder ops via model+render. Make
  `test/explorer-tree.mjs` + ALL guardrails + `test/subdirs.mjs` + `test/shell.mjs` green. Commit
  `feat(S2b): nested explorer folder tree + folder ops + drag-move (all green)`.
- [ ] **T3 — Spec + code-quality reviews**; fix; re-review; controller independent full-suite verify;
  headless screenshot of the nested tree vs `proto/shots/sandbox-rail-full.png`. Mark task #5 complete.

---

## Self-review (author checklist — done)
- **Coverage:** every design §2-§6 area maps to S2a (engine) or S2b (tree); §7.1 assertions split per
  §0.1; §7.3 lockstep (only `multifile.mjs:282`) in S2b-T1; §7.4 guardrails enforced in every task.
- **Placeholders:** none — code-bearing specifics live in the complete design §2-§6 + the proven
  `test/spike-packages.*`; commands + RED/GREEN expectations explicit.
- **Consistency:** `data-name`=files/assets (path-valued), `data-path`=folders; `writePath`/`move`/
  `emptyDirs`/`isModuleName`(path)/`isFolderSegment` named consistently with the design.
