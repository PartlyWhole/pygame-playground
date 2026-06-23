# S1 Shell Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Re-skin `index.html`'s shell to match `proto/sandbox.html` (vertical rail + 4 views, minimal
toolbar, type-aware viewer, resizable panes with console-collapse + per-pane fullscreen) **without
changing the engine, persistence, the CRDT, or any test-observable run behavior.**

**Architecture:** Pure DOM + CSS + shell-wiring changes inside the single `index.html`. Every load-bearing
seam from the architecture map is preserved id-intact or relocated id-intact (id-reconciliation rule:
`index.html` engine ids win over the proto's prettier ids). Deep features are deferred (real folders→S2,
split run model→S3, editable examples→S4, multi-file collab→S6, always-zip→S5).

**Tech Stack:** static HTML/CSS/JS, CodeMirror 5, Pyodide 0.27.2 (untouched), headless Playwright tests
(`test/_harness.mjs` → playwright-core). No build step.

**Spec (authoritative — read in full before any task):** `docs/specs/2026-06-23-shell-restyle-design.md`
(esp. **§0 resolutions**, **§2 seam map + id-reconciliation §2.3**, **§5 viewer**, **§6 panes**,
**§7 test reconciliation**, **§9 tokens**, **§10 test plan**). Visual source: `proto/sandbox.html`
(adopt its chrome/CSS/interaction, NOT its fake `fitCanvas()`/mock engine). Landmines:
`docs/specs/2026-06-23-redesign-decision-context-map.md` (flat MEMFS, `setValue`/lint-arm trap, lazy-load).

**Serve + run (all tasks):**
```
python3 -m http.server 8923          # repo root, one terminal
node verify.mjs           http://localhost:8923/
node test/<battery>.mjs   http://localhost:8923/
node test/spike-viewer.mjs   http://localhost:8923/test/spike-viewer.html   # spike URLs per each spike
```
The 6 batteries: `assets collab multifile save lint history`. Guardrails that must stay green with NO
changes: `verify.mjs`, `test/spike-viewer.mjs`, `test/spike-runstop.mjs`.

---

## File structure

- **Modify:** `index.html` — the `<head>` `<style>` (new shell CSS + token aliases referenced), the
  `<body>` shell markup (§2.1 skeleton), and the in-page `<script>` shell-wiring (rail switching,
  tooltip, viewer type-switch, splitters, collapse, fullscreen, explorer/asset re-home, share-button
  removal, keyboard-hint removal). Engine/Python/`project`/collab/lint/history/save logic is NOT touched
  except where a seam is relocated or the keyboard binding is removed.
- **Modify:** `docs/design-system/tokens.md` — add the new token groups (§9: rail, tooltip, pane chrome,
  paused placeholder, tree-row extensions), additive aliases over the 8 raws, one group/table at a time.
- **Create:** `test/shell.mjs` — the new shell battery (§10.1, 12 assertions).
- **Modify (lockstep, §10.2):** `test/multifile.mjs` (invert the "tab strip absent" assertion),
  `test/history.mjs` (open History via the rail icon), `test/assets.mjs` (re-home asset selectors),
  `test/save.mjs` (keep `#saveBtn` — only if the id moves). `test/lint.mjs` should pass UNCHANGED if
  explorer rows keep the `.tab[data-name]` selector (design §7.3) — verify, don't edit unless needed.

---

## Task 1: Lock the contract — new shell battery (RED) + lockstep test edits

**Files:** Create `test/shell.mjs`; Modify `test/multifile.mjs`, `test/history.mjs`, `test/assets.mjs`,
`test/save.mjs` (only as §10.2 requires).

- [ ] **Step 1 — Author `test/shell.mjs`** implementing the **12 assertions in design §10.1** verbatim
  to that spec (rail+4 views; view switching; click-collapse; status pill reflects `#status`; viewer
  type switching incl. `#runBtn` hidden for non-`.py`; one-CM identity + lint-falsy across switches;
  fullscreen buttons exist + call a stubbed `requestFullscreen` on the right pane; console collapse +
  inline-flex stash/restore; panes present + side-splitter drag changes width within clamp; explorer
  always-on shows the file row(s); first-paint laziness regression guard; tooltip a11y). Model the
  harness boilerplate on `test/spike-viewer.mjs`/`test/_harness.mjs` (launch, `page.goto`, `ok`/`fail`,
  `process.exitCode`). Each assertion must be engine-independent (no game need run) and must not trip a
  lazy-loader.

- [ ] **Step 2 — Apply the lockstep edits (§7 / §10.2), each encoding the NEW correct IA:**
  - `test/multifile.mjs:264–269` — replace "tab strip absent in single-file mode" with: assert `#tabs`
    is **visible** and contains exactly one row `.tab[data-name="main.py"]` in single-file mode. Leave
    the rest of the tab section (render both files, click-switch by `data-name`, `.entry` badge) intact.
  - `test/history.mjs` — change the opener from `page.click('#historyBtn')` to clicking the History rail
    icon `page.click('[data-view="history"]')`; KEEP all `#historyPanel`/`.hist-row[data-id]`/
    `.hp-restore`/`.hp-clear`/`.hp-diffbody` selectors.
  - `test/assets.mjs` — keep `#assetInput`, `.asset-row[data-name]`, `.asset-warn`, `.asset-remove`, and
    the click-not-close rule; adjust ONLY selectors that genuinely move (re-homed into the Explorer).
    Keep `#assetChip`/`#assetPanel` (design §0 Risk-7). If the asset panel is no longer a popover that
    "toggles", update only the open/visibility step to match the always-on Explorer, not the row asserts.
  - `test/save.mjs` — no change unless `#saveBtn` literally ceases to exist; per §0 Q5 the id moves onto
    the download control, so check 1 (`#saveBtn` exists) still passes — verify, don't edit.

- [ ] **Step 3 — Run the suite; confirm RED for the RIGHT reasons.**
  ```
  node test/shell.mjs http://localhost:8923/      # expect: many FAIL (shell DOM absent)
  node test/multifile.mjs http://localhost:8923/  # expect: FAIL on the inverted assertion
  node test/history.mjs http://localhost:8923/    # expect: FAIL (no [data-view=history] yet)
  ```
  Expected: the new/edited assertions FAIL because the shell isn't built yet; the UNCHANGED guardrails
  (`verify.mjs`, spikes, `lint.mjs`, `collab.mjs`) still PASS. If a guardrail fails now, the test edit
  was wrong — fix the test, not the engine.

- [ ] **Step 4 — Commit (RED contract).**
  ```
  git add test/shell.mjs test/multifile.mjs test/history.mjs test/assets.mjs
  git commit -m "test(S1): shell battery + lockstep reconciliations (RED)"
  ```

---

## Task 2: Design tokens (additive, isolated)

**Files:** Modify `docs/design-system/tokens.md`; the `:root` token aliases land in `index.html`'s
`<style>` in Task 3 (the doc and the CSS must agree).

- [ ] **Step 1 — Add the §9 token groups to `tokens.md`**, one table at a time in this order: rail
  (§9.1), tooltip (§9.2), status-paused placeholder (§9.3), pane chrome (§9.4), run/control tints delta
  (§9.5), tree-row extensions (§9.6). Each new token is a **semantic alias over an existing raw** (values
  = the proto's current literals); **do not rename or revalue the 8 raws.** Mark `--color-status-paused`
  "reserved — emitted in S3, not S1."

- [ ] **Step 2 — Commit.**
  ```
  git add docs/design-system/tokens.md
  git commit -m "design(S1): add rail/tooltip/pane/row token aliases (additive)"
  ```

---

## Task 3: Implement the shell (GREEN) — DOM + CSS + wiring in `index.html`

This is the cohesive core. Port `proto/sandbox.html`'s shell into `index.html` while preserving every
seam per design §2. Work in this internal order, re-running tests continuously. **Do not** advance to a
later sub-step while an earlier guardrail is red.

**Files:** Modify `index.html` (style, body markup, shell-wiring script). Reference: design §2 (DOM +
seam map + §2.3 id-reconciliation), §3 (rail+tooltip), §4 (toolbar), §5 (viewer), §6 (panes), §9 (token
`:root` aliases). Source markup/CSS/interaction: `proto/sandbox.html` (adapt; ids per §2.3).

- [ ] **Step 1 — Token `:root` aliases + base shell CSS.** Add the §9 aliases to the `<style>` `:root`
  (matching tokens.md from Task 2). Port the proto's shell CSS (rail, side panel, panelview, splitters,
  pane-head, drawer, tooltip, tree rows, pill) — referencing semantic tokens. Keep the existing engine
  CSS (CodeMirror, canvas, console, lint markers) intact.

- [ ] **Step 2 — Replace the `<body>` shell markup with design §2.1**, applying §2.3 id-reconciliation:
  keep `#tabs` (explorer tree container), `#runBtn` (→ editor-header `▶ Start`), `#stopBtn` (kept, hidden
  on stage), `#canvas` (640×480, in `#stage` wrap), `#console` (in drawer), `#assetInput` (real hidden
  input, in Explorer), `#status` (toolbar pill, `role=status aria-live=polite`), `#saveBtn` id on the
  download control, `#collabBtn`/`#liveDot`/`#peerCount` (Collaboration panel), `#historyPanel`+`.hist-*`
  (History panel), `#assetChip`/`#assetPanel`/`.asset-row` (Explorer asset section), `#fsBtn` (stage
  fullscreen), `#dropOverlay`. Reserve inert DOM hooks for S3 (pause/end/badge) and hide `#newFolderBtn`.
  **Remove the `#shareBtn` markup (Q3) — and its listener in Step 6 (paired).**

- [ ] **Step 3 — Rail switching + shared tooltip + click-collapse (§3).** Port the proto's delegated
  `data-tip` tooltip (one floating `[role=tooltip]`, show on hover+focus, hide on out/mousedown/scroll/
  Esc) and the rail tablist behavior (switch view → toggle `.panelview[hidden]` + `aria-selected`;
  re-click active icon → `#side.collapsed` + hide side splitter, rail stays; roving tabindex + arrow/
  Home/End/Enter/Space per §8.1). Run `node test/shell.mjs …` → assertions 1,2,3,12 should pass.

- [ ] **Step 4 — Type-aware viewer (§5), keeping ONE CM (landmine b/Risk-9).** Wire the viewer body to
  swap by file kind using the spike-viewer classifier: `.py` → `swapDoc` into the active Doc on the
  single persistent CM (never `setValue`, never re-`fromTextArea`); image → `<img>` on checkerboard;
  audio → `<audio>` player (+ ⚠ MP3 banner); other → "unable to open". `#runBtn` shown only for `.py`
  (`display` toggle; element stays in DOM). Run shell.mjs → assertions 5,6 pass; re-run
  `spike-viewer.mjs` (must stay green).

- [ ] **Step 5 — Panes: splitters, console collapse, fullscreen (§6).** Port splitter drag (side/viewer/
  console) writing inline flex-basis with clamps; console `#drawerCollapse` toggling `.drawer.collapsed`
  with the inline-flex **stash/restore** quirk (§6.2) + `aria-expanded`/chevron; `⛶` on `#viewerFs`/
  `#fsBtn`/`#consoleFs` calling the Fullscreen API on the pane element. **Do NOT port `fitCanvas()`**
  (Risk-8): the SDL `#canvas` stays 640×480, CSS-scaled. Run shell.mjs → assertions 7,8,9 pass.

- [ ] **Step 6 — Re-home explorer/assets/history/examples/collab + remove share + drop keyboard hint.**
  - Explorer: `renderTabs()` renders per-file tree rows into `#tabs` keeping `.tab[data-name]`/`.active`/
    `.entry`; `renderAssetPanel()` renders `.asset-row[data-name]`/`.asset-warn`/`.asset-remove` into the
    Explorer asset section; `#assetChip` becomes a count/storage indicator; storage readout in `#apStorage`.
    Always-on (no hide-when-single-file). Flat list — no folder rows (Q1); `#newFolderBtn` hidden.
  - History/Examples/Collab content relocated into their rail panels (placement only). Examples panel =
    **inert read-only list** from `EXAMPLES` (Q4): no load-into-editor, no `change`-at-boot, no `setValue`.
  - **Remove the `#shareBtn` listener** (paired with the Step-2 markup removal). Leave the `#code=`/
    `#project=` readers untouched (S7).
  - **Keyboard (Q6):** remove the hint text. Then `grep -rn "Enter" test/ | grep -i run` (and check for
    `Meta`/`Control`+`Enter` presses); if NO battery presses ⌘/Ctrl-Enter to run, remove the binding from
    the CM `extraKeys`. If one does, keep the binding (remove only the hint) and note it for S3.
  - Run `node test/multifile.mjs`, `node test/history.mjs`, `node test/assets.mjs`, `node test/lint.mjs`
    → all green.

- [ ] **Step 7 — First-paint laziness regression guard (landmine c).** Confirm shell.mjs assertion 11:
  after boot + opening each rail panel WITHOUT Run/diff/collab-start, `__amLoaded` falsy, `JSZip`
  undefined, no jsdiff global, CM `lint` option falsy. Confirm boot loads zero new network. Fix any eager
  load (e.g. an `import`/`new Audio` at panel render).

- [ ] **Step 8 — FULL SUITE GREEN.** Run, in order, all must pass:
  ```
  node verify.mjs http://localhost:8923/
  for b in assets collab multifile save lint history; do node test/$b.mjs http://localhost:8923/; done
  node test/shell.mjs http://localhost:8923/
  node test/spike-viewer.mjs  http://localhost:8923/test/spike-viewer.html
  node test/spike-runstop.mjs http://localhost:8923/   # (use this spike's documented URL)
  ```
  Every one GREEN. No test weakened. If any battery is red, fix `index.html` (or, only if the failure
  encodes OLD behavior that a §7 reconciliation should have changed, fix the test in lockstep — but never
  weaken coverage).

- [ ] **Step 9 — Commit (GREEN).**
  ```
  git add index.html
  git commit -m "feat(S1): shell restyle — vertical rail, type-aware viewer, resizable panes (all green)"
  ```

---

## Task 4: Review + finalize

- [ ] **Step 1 — Spec-compliance review** (subagent): does the implementation satisfy every item of
  design §0/§1/§2/§5/§6/§9 and preserve every seam in §2.2? List deviations.
- [ ] **Step 2 — Code-quality review** (subagent): DRY/clarity/no dead code, no `setValue`, no
  `fitCanvas()`, single CM, no eager loaders, tokens used (not hardcoded hex) for new components.
- [ ] **Step 3 — Address review findings** (TDD: add/adjust a shell.mjs assertion if a real gap is found,
  then fix), re-run the full suite green.
- [ ] **Step 4 — Visual check (headless screenshot).** Use `proto/shoot-sandbox.mjs` as a model to
  screenshot the built `index.html` shell; compare against `proto/shots/sandbox-rail-full.png` for gross
  layout fidelity. Save to a scratch path (not committed).
- [ ] **Step 5 — Final commit / mark task #4 complete.** Confirm `main` untouched; everything on
  `redesign`. Do NOT push (no deploy without explicit user auth).

---

## Self-review (author checklist — done)

- **Spec coverage:** rail+views (T3.3), toolbar+share-removal+hint (T3.2/T3.6), explorer always-on +
  asset re-home (T3.6), viewer (T3.4), panes/collapse/fullscreen (T3.5), tokens (T2), laziness (T3.7),
  a11y (T3.3 + design §8), test plan (T1) + lockstep (T1.2) — all mapped.
- **Placeholders:** none — code-bearing specifics live in the referenced design sections (complete) +
  `proto/sandbox.html` (the working source); commands + expected results are explicit.
- **Consistency:** ids per design §2.3 reconciliation table used uniformly; `#saveBtn`/`#runBtn`/`#tabs`/
  `#stopBtn`/`#canvas`/`#console`/`#assetInput`/`#status` preserved across all tasks.
