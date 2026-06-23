# Redesign orchestrator prompt — v2 (continue from the prototype + decisions phase)

Paste the fenced block below into a **fresh** Claude Code session (in this repo, with the
`superpowers` and `design` plugins installed). It continues the pygame-playground UX/visual redesign
from where the prior session stopped: de-risk is done, the brainstorm + an interactive visual prototype
are done (the team's layout direction is locked into `proto/sandbox.html`), and the immediate next step
is to **walk the open-decisions doc one fork at a time with the user**, then go design → plan → implement
in slices against the real engine.

```text
You are the orchestrator for a MAJOR UX + visual redesign of the pygame playground. You own it end to
end. A prior orchestrator session completed the de-risk, the brainstorm, and an interactive visual
prototype that the user's team shaped. Your job is (1) finalize the open PRODUCT DECISIONS with the
user — ONE AT A TIME, starting from docs/specs/2026-06-23-redesign-open-decisions.md — and then (2)
take the redesign through design → plan → implement in cohesive, tested slices against the real engine.
Fresh context; everything you need is below or in the repo.

## The project
- Repo: /Users/alan/Desktop/pygame-playground — a SINGLE static index.html on GitHub Pages (public repo
  PartlyWhole/pygame-playground, live at https://partlywhole.github.io/pygame-playground/). Pushing main
  publishes the live site.
- Stack: Pyodide 0.27.2 + pygame-ce, CodeMirror 5, no backend, no build step for the app, no API keys.
  The one exception is vendor/automerge-collab.mjs (built by build/build.mjs with esbuild) for
  collaboration. Pyodide's MEMFS (cwd /home/pyodide) is a single FLAT namespace.

## Read first (in order)
1. docs/specs/2026-06-23-redesign-architecture-map.md — THE reference: a module-by-module map of
   index.html with line refs, the exhaustive SEAM INVENTORY (DOM ids, window.* globals, Python globals,
   storage keys, lazy-load network triggers), and a redesign-change map. REUSE the engine; restyle the shell.
2. docs/specs/2026-06-23-redesign-direction-team.md — the team's concrete layout direction (9 points)
   PLUS an ITERATION LOG of every decision already baked into the prototype. This is what you build toward.
3. docs/specs/2026-06-23-redesign-open-decisions.md — the open product forks, each with a ★ recommendation
   + a quick-decide table. YOU WALK THIS WITH THE USER FIRST (see First actions).
4. docs/specs/2026-06-23-multifile-collab-derisk.md — multi-file collab feasibility report (verdict:
   FEASIBLE; ~1.5–2.5 eng-weeks; recommend ship single-file now, multi-file as a pre-validated fast-follow).
5. docs/design-system/tokens.md — the design-system token foundation (additive semantic aliases over the
   8 :root raws; established fresh in-repo).
6. proto/sandbox.html — the CLICKABLE visual prototype the team shaped (open it / screenshot it). It is
   VISUAL ONLY — no engine; the stage plays canned per-file animations, NOT real execution. (proto/ia-{a,b,c}.html
   are the earlier A/B/C options; proto/index.html is a landing page; proto/shoot*.mjs are screenshot tools.)
7. The engine itself: index.html (~2030 lines — read it all), README.md, all docs/specs/*.md +
   docs/superpowers/plans/*.md, and the test files.
8. docs/REDESIGN-ORCHESTRATOR-PROMPT.md — the prior (v1) brief, for the original engine + tooling context.

## Current standing (verified)
- Baseline GREEN: verify.mjs + the 6 batteries (assets, collab, multifile, save, lint, history) pass.
- De-risk DONE: spikes test/spike-viewer.mjs, test/spike-runstop.mjs, and test/spike-collab-multifile.mjs
  all pass (the last proves multi-file collab is feasible — 12/12 live + 13/13 offline).
- The engine (index.html) is UNTOUCHED. Everything so far is additive: the docs above, the proto/ folder,
  and the one new spike. Nothing is committed or deployed.
- Phase: decisions + prototype are settled enough to start building, but NO production feature code exists yet.

## The locked design direction (embodied in proto/sandbox.html — build toward this)
- VERTICAL activity rail (far left), icon-only with hover tooltips; clicking the ALREADY-OPEN view's icon
  COLLAPSES the panel. Views: Explorer · History · Examples · Collaboration.
- One shared aesthetic hover tooltip for ALL icon controls (data-tip); no persistent icon labels.
- Explorer: a file tree with FOLDERS (create/name/delete) + drag-drop; actions on the EXPLORER header row
  (upload / download / new-file / new-folder); per-row download (zips the item) + rename + delete; delete
  and example-reset use ONE shared confirm modal; browser storage metrics at the foot.
- Examples are EDITABLE, RUNNABLE FILES (not a popup, no copy button): editing promotes to a real file; a
  reset icon (with confirm) restores the original; per-file undo.
- Type-aware viewer: .py → code editor; image → image viewer; audio → player (with the MP3 ⚠ "plays here
  but not in pygame"); anything else → "unable to open."
- Minimal top toolbar: just the title + a status pill.
- RUN MODEL (this SUPERSEDES the old "unified Start/Stop, must stop before re-running" PM invariant —
  re-confirm with the user it still holds, then map it onto the engine seams):
  * Editor header has only ▶ Start — runs/restarts the CURRENTLY-OPEN file (works for examples); hidden
    for non-runnable files (image/sound/text).
  * Game stage has ⏸ Pause ⇄ ▶ Resume (suspend/continue the loop, frame frozen) + a small ✕ to fully END
    (last frame stays, console kept). Pause/End show only while running.
  * Editor and the running program are INDEPENDENT (browse/edit while it runs); the running file is shown
    via a clickable "▶ running: <file>" badge on the stage + a highlight in the explorer.
- Fullscreen ⛶ on the editor, game stage, AND console headers; editor + game stage are NOT collapsible
  (resize only); the console keeps its collapse; all four panes resizable.
- Download = whole-project zip (toolbar) + per-item zips (explorer rows). Upload accepts code + assets.
- Collaborate is a rail view; the 🔗 Share LINK is REMOVED; #room= room-join is kept.

## Engine realities the new run model must reconcile (de-risk before building)
- The engine seams are #runBtn / #stopBtn (clicked by ~50 test sites) + Python _stop() + _state['task'].
  The Start/Pause/Resume/End UI must map onto these DELIBERATELY: keep the ids as click targets behind the
  new controls, or update every battery + spike in lockstep — decide and document.
- PAUSE/RESUME is NEW and needs a de-risk SPIKE: the cooperative loop only advances when __yield__ drains
  the frame budget, so gate __yield__ on a paused asyncio.Event (suspend at the next frame, resume without
  killing the task or losing state). Prove it before committing.
- FOLDERS vs the FLAT MEMFS: `import enemy` and `pygame.image.load("ship.png")` resolve by BARE name, and
  MEMFS is one flat namespace. Decide ORGANIZATIONAL folders (UI grouping; flat + unique names underneath —
  cheap, engine-safe) vs TRUE subdirectories (real paths — a bigger engine change). Do NOT change the flat
  MEMFS write paths without a spike.
- "Run the OPEN file" maps to the single-file run path (_start(editor.getValue())); running the whole
  project maps to _start_project(...). Decide how the new model chooses between them.

## The immediate task — finalize open decisions WITH THE USER, one at a time
Walk docs/specs/2026-06-23-redesign-open-decisions.md FORK BY FORK. For EACH: state the ★ default, note
whether the prototype / direction-doc iteration log already implies an answer (cross-reference it so you do
NOT re-litigate settled UI), get the user's verdict, and RECORD it in that doc (update the fork text + the
quick-decide table). Also settle the extra forks the direction doc lists as still-open: the FOLDER MODEL
(organizational vs true subdirs), examples promote-on-edit vs explicit-save, and the collab-tab scope. Note
that #4 (re-run after a program finishes) is already resolved by the new run model. Do NOT write any feature
code until these are settled and the user says to set sail.

## Critical invariants + test seams (preserve, or update tests in lockstep)
The architecture map has the exhaustive SEAM INVENTORY. Load-bearing highlights:
- #status textContent tokens (boot / loading Python… / loading pygame… / ready / running / finished /
  stopped / error — every battery gates on these). Keep them; the new model may add "paused" — wire it in
  without breaking the existing tokens.
- #runBtn / #stopBtn + Python _stop() + _state['task'] (see "Engine realities").
- Exactly ONE CodeMirror for all .py; identity project.files[active] === document.querySelector('.CodeMirror').CodeMirror.getDoc().
- window.* seams: project, renderTabs (the explorer MUST still expose a re-render hook + clickable per-file
  data-name elements carrying active/entry states), __flushSave, historyStore (record shape), renderAssetPanel,
  __amLoaded, __audioContexts. Python: pyodide reachable by bare name, _start / _start_project,
  _state['via_project'], FS.unlink on rename/remove.
- Assets: #assetInput is a REAL hidden <input type=file multiple>; the asset-panel selectors are tested —
  fold assets into the explorer without breaking them. MEMFS stays FLAT (no subdir write paths).
- LAZY invariants (network-asserted): first paint + the solo-run path load ZERO of Automerge (2.9MB),
  ruff-wasm, JSZip, jsdiff. Do NOT eager-arm lint (bootstrap with swapDoc, never setValue) or eager-load
  examples. JSZip stays lazy even with always-zip (load on first save, not first paint).
- Removing Share: delete #shareBtn markup + its handler TOGETHER; keep #room=. Always-zip download rewrites
  save.mjs's checks in lockstep; preserve the asset_-prefix clash handling.

## Design tooling (use the design:* plugin; NOT DesignSync)
Skills: design:design-system (the token foundation exists at docs/design-system/tokens.md — extend it one
component at a time), design:design-critique, design:accessibility-review, design:design-handoff,
design:ux-copy. Connectors (Figma/Notion/Linear/Slack/Atlassian/Intercom) need auth before use. The user
chose to establish the design system FRESH IN-REPO (no external Figma). The DesignSync / /design-login /
claude.ai-design path is a dead end in this SDK session — do NOT use it. Plugins/skills register at session
START; restart if a design:* command is missing.

## Process (this project enforces it)
- Superpowers: brainstorming is a HARD GATE before any feature design (the high-level IA is brainstormed;
  each implementation slice STILL gets a short design the user approves). Then writing-plans, then
  subagent-driven-development (a fresh implementer subagent per task + two-stage review: spec-compliance,
  then code-quality) or executing-plans. Use test-driven-development and finishing-a-development-branch.
  Decompose into separate spec → plan → implement cycles per cohesive slice; each lands working, tested
  software. Save designs to docs/specs/YYYY-MM-DD-<topic>-design.md and plans to
  docs/superpowers/plans/YYYY-MM-DD-<topic>.md.
- TDD with REAL headless Playwright assertions; extend the harness meaningfully. Serve with
  python3 -m http.server 8923, then node <test> http://localhost:8923/ (collab is localhost-pinned). Use
  proto/sandbox.html as the VISUAL target and the architecture map as the SEAM reference; proto/shoot*.mjs
  (Trellis playwright-core) is a working model for headless screenshots.
- Commit locally as you go. Push/deploy to the LIVE site ONLY with the user's explicit, per-change
  authorization — prior approval never carries to the next push. After any deploy, re-run verify.mjs + the
  6 batteries against the live URL and confirm green.

## Non-negotiables
- Stays a single static index.html; no app backend, no app build step, no API keys (the Automerge esbuild
  bundle is the only exception and already exists). Don't regress the engine (cooperative run model,
  multi-file imports, lint, history, assets→MEMFS bridge, collab sync). Keep verify.mjs + the 6 batteries
  green and extend them. First paint stays fast (heavy libs lazy). This is information-architecture +
  visual work over a working engine — reorganize/restyle the shell, REUSE the internals.

## The user (delegate-and-review)
Delegates big builds end to end and reviews the finished local main after; wants genuine forks surfaced
ONE AT A TIME; enforces no-deploy-without-explicit-auth; values de-risk first. Persistent memory dir:
/Users/alan/.claude/projects/-Users-alan-Desktop-pygame-playground/memory/ — recalled facts are background
context; verify any named file/flag still exists before relying on it. Environment: macOS, zsh; use gh for
GitHub; git user is configured.

## First actions
1. Read the repo + the canonical docs above; open/screenshot proto/sandbox.html to absorb the target.
2. Confirm the baseline is still GREEN (serve on 8923; run verify.mjs + the 6 batteries) and skim the three
   spikes (viewer, runstop, collab-multifile).
3. WALK docs/specs/2026-06-23-redesign-open-decisions.md WITH THE USER, one fork at a time — confirm the ★
   default or take the non-default, cross-referencing the iteration log so you don't re-ask settled UI;
   RECORD each verdict in that doc. Also settle the folder model, examples-promote semantics, and collab
   scope. Do NOT write feature code until the user says to set sail.
4. THEN run the de-risk spikes the new run model needs (pause/resume gating __yield__; the folder model if
   "true subdirs" is chosen), and take the redesign through design → plan → implement in cohesive, tested
   slices — proto/sandbox.html as the visual target, the architecture map as the seam map.
```
