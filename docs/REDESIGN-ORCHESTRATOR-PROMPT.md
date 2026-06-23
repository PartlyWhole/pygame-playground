# Redesign orchestrator prompt

Paste the fenced block below into a **fresh** Claude Code session (in this repo, with the
`superpowers` and `design` plugins installed) to kick off the pygame-playground UX + visual
redesign. It folds in everything learned from the first attempt — most importantly, the *actual*
design tooling (`design:*` skills + Figma/Notion/etc. connectors, **not** the `DesignSync` /
`/design-login` / claude.ai-design path, which is a dead end in the SDK session) — and the
de-risk artifacts already on disk (green baseline + two passing spikes) so the new session builds
on them instead of redoing them.

```text
You are the orchestrator for a MAJOR UX + visual redesign of the pygame playground. You own it
end to end: de-risk, brainstorm with the user, spec, plan, and implement — orchestrating subagents
as needed. You have a fresh context; everything you need is below or discoverable in the repo. A
prior orchestrator session already did the de-risk groundwork (results below) — confirm it, don't
blindly redo it.

## The project
- Repo: `/Users/alan/Desktop/pygame-playground` — a SINGLE static `index.html` deployed on GitHub
  Pages (public repo `PartlyWhole/pygame-playground`, live at
  https://partlywhole.github.io/pygame-playground/). Pushing `main` publishes the live site.
- Stack: Pyodide 0.27.2 + pygame-ce, CodeMirror 5, no backend, no build step for the app, no API
  keys. The one exception is `vendor/automerge-collab.mjs`, built by `build/build.mjs` (esbuild)
  for collaboration. Pyodide has an in-memory filesystem (MEMFS) at cwd `/home/pyodide`.
- Read first, fully, in order: `README.md`; `index.html` (one file, ~2030 lines — read it all);
  all of `docs/specs/*.md` and `docs/superpowers/plans/*.md`; and the test files. They document
  the cooperative AST-transform run model, multi-file support, uploadable assets, save/download,
  auto-lint, history, and live collaboration. Your job is to reorganize and restyle the shell
  around this existing engine — REUSE it, don't rebuild it.

## Design tooling (CORRECTED — this is what is actually installed)
The user has a `design` plugin exposing these SKILLS (invoke via the Skill tool):
  - `design:design-system` — audit / document / extend a design system (produces markdown:
    tokens, component variants/states/a11y, new patterns). This is your design-system workhorse.
  - `design:design-critique` — structured feedback on a mockup/screen.
  - `design:accessibility-review` — WCAG 2.1 AA audit.
  - `design:design-handoff` — dev handoff spec (layout, tokens, props, states, breakpoints).
  - `design:ux-copy` — microcopy / button labels / error + empty states.
  - `design:user-research`, `design:research-synthesis` — only if user-research is in scope.
And these design CONNECTORS (MCP tools, surfaced via ToolSearch; each needs auth via its
`authenticate` / `complete_authentication` pair BEFORE use): Figma, Notion, Linear, Slack,
Atlassian, Intercom.

  IMPORTANT: The `DesignSync` tool + `/design-login` + claude.ai/design flow referenced by the
  PREVIOUS prompt is NOT what's installed here — it could not be authorized in the SDK session and
  is a dead end. Do NOT use it. Plugins/skills register at session START, so if a `design:*`
  command is missing, the fix is to restart the session (already done once).

  EARLY, before designing: ask the user where their design system lives — (a) a Figma file
  (authenticate the Figma connector and read it as source of truth), (b) Notion/another connector,
  or (c) nothing yet / start fresh. If fresh, you ESTABLISH the design system in-repo via
  `design:design-system`: formalize the app's existing CSS `:root` variables
  (--bg/--panel/--edge/--text/--dim/--accent/--warn/--bad) into named tokens, and document each
  new UI component (toolbar, unified run/stop, file explorer, type-aware viewers, popovers,
  panels) — variants, states, a11y — keeping the app and its design-system docs in sync as you
  build, one component at a time (never a wholesale rewrite). Run `design:design-critique` on
  mockups and `design:accessibility-review` before each slice lands.

## What already exists (architecture you must respect and largely reuse)
Key modules inside `index.html`:
- Cooperative run model (`BOOT_PY` + `PROJECT_PY`): an AST transform rewrites blocking pygame
  loops into cooperative async so the tab never freezes; multi-file projects run via a
  `sys.meta_path` import hook (`_start_project`). `_start`/`_start_project`/`_stop` drive it.
  Dispatch in `run()`: `collab.active || !project.isMulti()` -> `_start(editor.getValue())`, else
  `_start_project(serialize().files, entry)`. Keep the engine; rework only the run/stop controls.
- Project model (`window.project`): the set of `.py` files as CodeMirror `Doc`s + `entry` +
  `active`, with `serialize()`/`load()`/`text()`/`isMulti()`/`add`/`rename`/`remove`/`setActive`/
  `setEntry`. The active Doc IS `editor.getDoc()` (adopted via `swapDoc`). Persists to
  localStorage `pygame-playground:project` (+ legacy `pygame-playground:code` mirror in
  single-file mode). Currently surfaced as editor tabs (`#tabs`) — you will likely replace the tab
  UI with a file explorer.
- Assets (`assetStore` IndexedDB `pygame-playground` + `assetFS` MEMFS bridge): uploaded
  images/sounds written into MEMFS as REAL files so `pygame.image.load` / `pygame.mixer.Sound`
  resolve by bare name. Proven facts: assets MUST be real MEMFS files (io.BytesIO does NOT work);
  pygame sound is WAV/OGG only. Currently a `📁` header popover (`#assetChip`/`#assetPanel`) —
  fold this into the explorer and add type-aware viewers.
- Save (`saveProject`/`downloadBlob`/`loadJSZip`): currently lone `.py` fast-path OR a JSZip
  project zip (lazy). You will change this to ALWAYS zip the whole project (all `.py` + all
  assets, with the existing `asset_`-prefix clash handling).
- Auto-lint (`loadLinter`/`armLint`): ruff-wasm + CM lint gutter, lazy on first edit, style noise
  suppressed (`select:['F']`). Keep; it applies to the `.py` code editor only.
- History (`historyStore` IndexedDB `pygame-playground-history` + `🕘 History` popover): a project
  snapshot saved fire-and-forget on each Run, with line-diff (jsdiff, lazy) + restore. Keep.
- Collaboration (`loadAutomerge`/`startRoom`/`joinRoom`/`enterRoom`/`bindEditor`/presence over
  `vendor/automerge-collab.mjs` -> `wss://sync.automerge.org`): real-time room, SINGLE-FILE (the
  Automerge doc is exactly `{ code: string }`). Keep the room; REMOVE the `🔗 Share` link
  mechanism entirely (and `#code=`/`#project=` share-link loading + the same-tab hashchange share
  handling). Keep `#room=` for joining rooms.
- Tests (real headless Chromium via Playwright, `test/_harness.mjs` -> Trellis playwright-core):
  `verify.mjs` (solo smoke) + `test/{assets,collab,multifile,save,lint,history}.mjs`. Serve with
  `python3 -m http.server 8923`, then `node <test> http://localhost:8923/` (collab is
  localhost-pinned). Keep them green and extend them.

## De-risk STATUS from the prior session (verified — on disk; confirm, don't redo)
- Baseline: 7/7 GREEN (verify.mjs + all six batteries). Re-run once to confirm before starting.
- Spike `test/spike-viewer.mjs` (PASSES): type-aware viewer is feasible — uploaded bytes from
  MEMFS (`pyodide.FS.readFile`) -> Blob -> object URL -> `<img>` decodes PNG; `<audio>` loads
  WAV + OGG metadata; `.txt` routes to "unable to open". CAVEAT to design around: `<audio>` also
  decodes MP3, but pygame's SDL_mixer here does NOT — so the in-app player and the runtime
  diverge; the viewer must message "plays here, but not in your pygame game — convert to WAV/OGG".
- Spike `test/spike-runstop.mjs` (PASSES): unified Start/Stop is feasible — Stop cancels the run,
  the last rendered frame STAYS frozen on the canvas (the task cancel does NOT clear it), the
  console stays intact, "running" is observable (status text + live asyncio task) so one button
  can BLOCK re-run until stopped, and a fresh Run clears the console.
- No app code was changed; the only new files are those two `test/spike-*.mjs`.
- OPEN strategic fork (not yet decided with the user): multi-file collaboration. The collab doc is
  a single `{ code: string }` field; making the room multi-file is a real rework (new doc shape +
  rebind sync/presence; history/lint inherit it), deliberately deferred. Surface honestly.

## Critical invariants + test seams the redesign MUST preserve (or update tests in lockstep)
- `#status` element whose textContent uses exactly: boot / running / ready / finished / error /
  stopped. EVERY battery gates on these tokens.
- `#runBtn` and `#stopBtn` are clicked by the batteries. The unified one-button control should
  either keep these IDs as the click targets or update every battery in lockstep — decide
  deliberately.
- `.CodeMirror` DOM node with a live `.CodeMirror` instance exposing setValue/getValue/getDoc is
  THE editor seam used everywhere; keep ONE CodeMirror for `.py`, and preserve the identity
  `project.files[active] === document.querySelector('.CodeMirror').CodeMirror.getDoc()`. Per-file
  separate editor instances break lint + multiple batteries.
- window.* test seams to keep: `window.project`, `window.renderTabs` (explorer must still expose a
  re-render hook + clickable per-file element carrying `data-name=<file>`, active + entry states),
  `window.__flushSave`, `window.historyStore` (record shape `{id, at, mode, project:{files,order,
  entry}}`), `window.__amLoaded`, `window.__audioContexts`.
- Python seams: `pyodide` reachable by BARE name in page.evaluate; `pyodide.FS.analyzePath(name)
  .exists`; `_stop()`; `_state['via_project']`; the `_start`/`_start_project` dispatch condition.
- Assets seams: `#assetInput` (a REAL hidden `<input type=file multiple>`, driven by Playwright
  setInputFiles), `#assetChip` (textContent carries the count), `#assetPanel` with
  `.asset-row[data-name]` / `.asset-warn` / `.asset-remove`, `#apStorage`, and a bare-name
  `renderAssetPanel()`. A click on `#assetInput` must NOT close an open panel.
- Collab seams: `#collabBtn`, `#liveDot`, `#peerCount`, `.remote-cursor`, `.remote-flag` (text
  matches `/^[A-Z][a-z]+ [A-Z][a-z]+$/`), and the shared-selection highlight (CM markText emitting
  inline `background-color`).
- Save seams: `#saveBtn`, and Cmd-S/Ctrl-S -> saveProject (the CM keymap handler must return
  undefined so the browser save dialog is suppressed).
- `#canvas` (`.toDataURL()` / `getContext('2d').getImageData`) and `#console` (children
  textContent) are asserted throughout.
- LAZY invariants (non-negotiable, asserted by network checks): first paint and the solo run path
  load ZERO of Automerge (2.9 MB), ruff-wasm, JSZip, jsdiff. Triggers only: collab on
  Collaborate/`#room=`; lint on first editor change; JSZip on first zip; jsdiff on first diff. Do
  NOT eager-arm lint by programmatic setValue at shell init, and keep example-loading an explicit
  user action (not boot-time) or you break the first-paint network assertions.
- MEMFS is a single FLAT namespace; assets + project `.py` share it by bare name. Folders/subdirs
  would break `pygame.image.load("ship.png")` — if the explorer shows a tree, do NOT change the
  flat MEMFS write paths.
- Removing Share: deletes `#shareBtn`, the `#code=`/`#project=` load precedence, the share-link
  copy, and the same-tab hashchange share handler; KEEP `#room=` joining. The multifile battery's
  share tests (7/7b) + hashchange cases change in lockstep.
- Always-zip download: replaces the lone-`.py` fast path; rewrite save.mjs checks 2/3/5 in
  lockstep; preserve the `asset_`-prefix code/asset clash handling; keep JSZip lazy.

## The redesign (from the PM — capabilities, not a finished layout)
Rework the toolbar/shell "starting first from what we want the user to be able to do."
1. Hide the examples. Replace the examples dropdown with a tiny button (e.g. bottom of the screen)
   opening a popup showing example code with an easy copy button — read-only display presented
   separately from the editor (selecting an example must NOT silently overwrite the user's work).
2. Create and explore multiple files via a VS-Code-like file-system explorer. Selecting a file
   opens the right viewer by type: code editor for `.py`, image viewer for images, sound player
   for audio; any other type shows "unable to open." The explorer manages ALL files (code +
   uploaded assets) and supports save, rename, delete. Only code files are editable, so "save"
   applies only to the code editor (clarify exact save semantics with the user — the project
   already autosaves).
3. Unified Start/Stop button (one button). A student must interrupt execution before running
   again — only one main program at a time (no run while running). Stopping ends the process/game
   but the last rendered frame stays in view and the console stays intact.
4. Download = project zip. One action that zips the WHOLE project (all files) and downloads it.
5. Upload files into the project (code or assets).
6. Collaborate button (Automerge room). Keep the live room. REMOVE the `🔗 Share` link entirely.
   Keep `#room=`. Decide with the user whether the room is single-file (as today) or multi-file
   (a real fork — see de-risk status).
7. History panel. Keep, placed sensibly in the new layout.

## Non-negotiable constraints
- Stays a single static `index.html`, no app backend, no app build step, no API keys (the
  Automerge esbuild bundle is the only exception and already exists).
- Don't regress the engine: cooperative run model, multi-file imports, lint, history,
  assets->MEMFS bridge, and collab sync keep working; verify.mjs + the feature batteries stay
  green; first paint stays fast (heavy libs stay lazy).
- Keep it elegant and consistent. This is mostly information-architecture + visual work over a
  working engine; prefer reworking the shell to rewriting internals.

## Process you must follow (this project enforces it)
- Superpowers skills: `brainstorming` (HARD GATE before ANY feature design — no feature code until
  the user approves a design), then `writing-plans`, then `subagent-driven-development` (fresh
  implementer subagent per task + two-stage review: spec-compliance, then code-quality) or
  `executing-plans`. Use `test-driven-development` and `finishing-a-development-branch`. Decompose
  into separate spec -> plan -> implement cycles per cohesive slice, each landing working, tested
  software. Do NOT batch everything into one design.
- Brainstorm the genuine forks with the user, ONE question at a time, before building. Surface at
  least: overall layout/IA (where explorer, editor/viewer, game stage, console live; VS-Code-style
  sidebar?); where the design system lives + which connector (Figma/Notion/fresh) and how its
  tokens/components map onto the app's surfaces; "save" semantics (explicit Save vs autosave);
  explorer interactions (new-file, rename's effect on `import`s, delete, file-type detection);
  examples popup (copy to clipboard vs copy into a new file); collab scope (single- vs multi-file
  room); and whether drop-anywhere upload stays. Offer visual mockups for the layout questions
  (the brainstorming skill's visual companion, or the `visualize` widget tool).
- TDD with real headless assertions. Extend the Playwright harness meaningfully (image viewer
  shows an uploaded PNG; a `.txt` says "unable to open"; Stop leaves the last frame + console and
  blocks re-run until stopped; download produces a zip of the whole project; rename/delete update
  the explorer + MEMFS; examples popup copy works; the removed Share link is gone but `#room=`
  still joins). Document anything only a human can check (e.g. audio output).
- Save design docs to `docs/specs/YYYY-MM-DD-<topic>-design.md` and plans to
  `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` (existing conventions).
- Commit locally as you go. Push/deploy to the live site ONLY with the user's explicit,
  per-change authorization — prior approval never carries to the next push. After any deploy,
  re-run verify.mjs + the feature batteries against the live URL and confirm green.
- Persistent memory dir:
  `/Users/alan/.claude/projects/-Users-alan-Desktop-pygame-playground/memory/` — recalled facts
  are background context; verify any named file/flag still exists before relying on it. The user
  delegates big builds end-to-end, reviews the finished local `main` after, wants forks surfaced,
  and enforces no-deploy-without-explicit-auth.

Environment: macOS, zsh. Use `gh` for GitHub; git user is set up. End commit messages with a
`Co-Authored-By` trailer if your harness convention requires it.

## First actions
1. Read the repo (files above) to build context — especially how `project` / `assetStore` /
   `historyStore` / collab / run modules work, so you reuse them.
2. Confirm the baseline is green: `python3 -m http.server 8923` then run verify.mjs + the six
   batteries. Skim the two `test/spike-*.mjs` to absorb the proven viewer + Start/Stop semantics.
3. Confirm design tooling: invoke `design:design-system` to learn its workflow, and ask the user
   where their design system lives (Figma/Notion/fresh) — authenticate that connector if needed.
4. Brainstorm with the user: propose an IA/layout (with mockups) and how the design system maps
   onto the app, work the forks one at a time, then take the redesign through the full
   design -> plan -> implement loop in cohesive slices.
```
