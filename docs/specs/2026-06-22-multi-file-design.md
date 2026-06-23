# Multi-file support + project model — design

**Date:** 2026-06-22 · **Status:** approved-by-delegation, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages,
https://partlywhole.github.io/pygame-playground/)

> The user delegated end-to-end orchestration and will review afterward. Every
> non-trivial decision is recorded with its trade-off. This doc was hardened
> after a 4-lens adversarial review (10 blockers / 14 majors); the resolutions
> are folded in below and summarized in the appendix. The biggest scope call is
> flagged **★ REVIEW**.

## Goal

Let a user write a pygame program split across several flat `.py` files — an
entry program that `import`s sibling modules — and run it in the browser exactly
as a single-file program runs today. Introduce a small **project model** (the set
of named files + which one is the entry) that the later features (Save, Lint,
History) build on.

Non-goals (v1): folders/packages/subdirectories; multi-file **collaboration**
(rooms stay single-file — see ★); per-file lint (lands with Lint); running a
non-entry file directly (a module runs by being imported by the entry);
auto-rewriting `import` statements on rename.

## What the spike proved (real headless Chromium — `test/spike-multifile.mjs`)

Load-bearing facts this design is built on:

- **Cross-file import from MEMFS works** once cwd is on the path: write each
  module to MEMFS by bare name (`pyodide.FS.writeFile("enemy.py", bytes)`) and
  ensure `'' in sys.path` (insert at index 0 if absent). cwd is `/home/pyodide`.
- **Module cache must be cleared per run** — `sys.modules.pop(name)` for every
  project module + `importlib.invalidate_caches()`, or a re-run serves the
  previous version of an edited module.
- **Cooperative async across files works** via a `sys.meta_path` import hook that
  runs a cooperative transform on each project module at import time (transitive:
  any imported project module, even one imported by another module, goes through
  the hook). Measured: canvas animates, main-thread round-trip 0–1 ms during an
  imported infinite loop, pauses honored as real time (1686 ms, no busy-wait),
  edited module re-run picks up new code. Negative control: a *sync* imported
  busy-loop froze the thread 2022 ms.
- **The transform the spike proved is the BLANKET one:** `_AsyncifyAll` converts
  **every** module-level function to `async def`, and `_AwaitCalls` wraps **every**
  call node in `await __maybe_await__(...)` (awaits if the result is a coroutine,
  else passes the value through). This design uses that proven blanket transform
  (see the run-model section for why, and the one optional perf lever).
- **Two hard lessons:** (1) entry/user code must `eval` into a **dedicated globals
  dict, never `pyodide.globals`** — a stray global `_start = …` clobbered the
  page's `_start()` and broke Run. (2) `_start_project` must return the asyncio
  Future like `_start` does; the spike's "destroy the task and return nothing"
  was a Playwright-serialization workaround and must NOT be copied into `run()`.
- **Known-unsupported edges:** a game loop at a non-entry module's top level (a
  synchronous import can't host top-level `await`), and a game loop inside a class
  **method** (v1 doesn't async-convert methods, so it would freeze). Both are
  detected at transform time and raised as a friendly error (see Error handling).

CodeMirror 5.65.16 `CodeMirror.Doc(text, 'python')` + `cm.swapDoc(doc)` verified:
per-file documents with isolated undo history; content preserved across swaps;
`mode` is a per-Doc property (must be passed), other editor options are
instance-level and carry across swaps.

## Decisions (locked)

- **UI: editor tabs.** A thin tab strip at the *top* of the editor pane lists the
  `.py` files (`main.py ▸ | enemy.py | + `). One CodeMirror instance; each file is
  a `CodeMirror.Doc(text, 'python')`; clicking a tab `swapDoc`s it in (preserving
  per-file undo & cursor). The bootstrap `main.py` Doc **is `editor.getDoc()`**
  (adopted, not replaced) so existing tooling/tests that use
  `cm.getValue()/setValue()` keep working in single-file mode. Assets stay in the
  existing 📁 popover, unchanged.
- **Run = the designated entry.** The project has one **entry** file (defaults to
  `main.py`, else the first file). ▶ Run always runs the entry regardless of the
  focused tab; the entry imports the rest. The entry tab shows a non-interactive
  ▸ badge; per-tab actions (Set as entry, Rename, Delete) live in an explicit
  per-tab menu (a `⋯` affordance), not bare destructive icons.
- **Flat files only.** Module names are bare `name.py` in one cwd namespace. No
  subdirectories/packages in v1. Names must be unique, end in `.py`, and have a
  valid Python module identifier stem.
- **★ REVIEW — Multi-file is solo-only in v1; collaboration rooms stay
  single-file.** A room is entered until page reload (the app has no in-session
  room-teardown), so **rooms and multi-file never coexist within one session**.
  Loading a `#room=` link forces single-file mode (tabs hidden, project key not
  written). Clicking Collaborate while multi-file `confirm()`s and shares the
  **entry** file only, leaving the full project saved in localStorage (it returns
  on the next non-room load). Multi-file never *regresses* collab. **Trade-off:**
  no multi-file collaboration yet — revisit as its own project.
- **Cooperative guarantee (v1):** the entry (top level + its loop-functions) and
  **all module-level functions** of imported files are cooperative. **Class
  methods are not async-converted** — a game loop inside a method is an
  unsupported edge (friendly error). The common pattern (loop in the entry,
  classes with quick per-frame `update()/draw()`, helpers in modules) is fully
  supported.
- **Persistence & sharing become project-aware**, single canonical (de)serialize,
  legacy single-file path preserved (see Persistence).

## Architecture

All additions live in `index.html`. Three units: a JS **project model**, a
**tabs UI**, and an additive **Python run-model** that never touches the existing
single-file path.

### 1. Project model (JS) — `project`

Single source of truth for files + entry. Zero pyodide dependency (it exists at
editor-init, before boot).

- Shape: `{ files: { [name]: CodeMirror.Doc }, order: string[], entry: string,
  active: string }`. Text lives in each Doc (per-file undo); `order` drives tabs.
- `text(name)` → `files[name].getValue()` (**live Doc read, never a cached
  snapshot**). `serialize()` → `{ files: {name: text}, order, entry }` by
  iterating `order` and reading each Doc (works on detached docs) — used by both
  autosave and Share so non-active tabs are never dropped.
- `add/rename/remove/setEntry/setActive`, `isMulti()` → `order.length > 1`.
- **Single-file invariant:** a fresh/legacy project has one file (`main.py`,
  whose Doc is the editor's own); `isMulti()` is false and Run takes the existing
  `_start(editor.getValue())` line verbatim (byte-identical, zero regression).
- `remove(name)` also `pyodide.FS.unlink`s `name` (guarded) — MEMFS hygiene,
  mirroring asset removal.

### 2. Tabs UI

- `#tabs` strip inside `#editorPane`, **above** the editor. To avoid breaking
  CodeMirror sizing, `#editorPane` becomes `flex-direction: column` (tabs
  `flex: 0 0 auto`; `.CodeMirror` `flex: 1`, with `min-height: 0`). The splitter
  still sets the pane's *width* (`flex-basis`) — unaffected by inner direction.
  The strip is **removed from the DOM (not `display:none`)** in single-file mode
  and in a room, so the solo layout is pixel-identical to today.
- **Mount/unmount of the strip calls `editor.refresh()`** (CM caches viewport
  geometry; the splitter handler already does this at index.html:1036). The
  canvas is unaffected (its ResizeObserver is on `#stage`).
- **Switch:** click a tab → `project.setActive(name)` → `cm.swapDoc(files[name])`.
- **Add (`+`):** `prompt()` for a name; validate (`.py`, unique, identifier
  stem); `new CodeMirror.Doc('', 'python')`; show it. (`prompt()`/`confirm()`
  match the app's existing no-framework style — the example guard already uses
  `confirm()`.)
- **Per-tab menu (`⋯`):** *Set as entry* (re-points `entry`, moves the ▸ badge);
  *Rename* (`prompt`, revalidate, update the doc key + MEMFS name) — **name-only,
  with an inline warning that `import` references in other files are not rewritten
  and must be fixed manually**; *Delete* (`confirm()`, then `remove()`); deleting
  the entry reassigns entry to the next file; the last remaining file's Delete is
  **visibly disabled**.
- Hidden in single-file mode and in a room.

### 3. Python run-model (additive) — `PROJECT_PY`

A second Python boot string appended after `BOOT_PY`, adding **only new names**.
It **reuses, read-only**, BOOT_PY's `_SyncBarrier`, `_is_gameloop`, `_shallow`,
`_Awaiter`, `_InjectYield`, `_time_names`, `_YIELD`, `__yield__`, `__sleep__`,
`_state`. It **defines its own** `_AsyncifyAll`, `_AwaitCalls`, `__maybe_await__`,
`_transform_module`, `_transform_entry_project`, `_ProjectFinder`/`_ProjectLoader`,
`_install_finder`, `_run_project`, `_start_project`, and a `_PROJECT_FILES` set.
It **does not touch** `_Asyncify`, `_transform`, `_start`, `_run` — so the
single-file path is provably byte-identical (a TDD case locks a solo sync helper
that contains only `time.sleep`).

`_start_project(files: dict[str,str], entry: str)`:
1. Reconcile MEMFS: `pyodide.FS.writeFile` every current `name → text`; unlink any
   `.py` in the previous `_PROJECT_FILES` no longer present. Set `_PROJECT_FILES`
   to exactly the current module names (the finder only ever claims current
   names → no cross-run contamination).
2. `_install_finder()` (idempotent: one `_ProjectFinder` on `sys.meta_path`).
3. `importlib.invalidate_caches()`; `sys.modules.pop(name, None)` for each module.
4. Ensure `'' in sys.path` (insert at 0 if missing).
5. Transform the **entry** via `_transform_entry_project`, compile with
   `PyCF_ALLOW_TOP_LEVEL_AWAIT`, `eval` into a **fresh dedicated globals dict**
   (mirroring `_run`'s `glb`), `ensure_future` it into `_state["task"]`, and
   return that Future. Same ok/error/stopped/exit protocol & `_stop()` as `_run`.

`_ProjectLoader.exec_module` runs `_transform_module` on the module source and
injects the helpers (`__yield__`, `__sleep__`, `__maybe_await__`) into the module
dict before `exec`.

#### The cross-module await problem — use the PROVEN blanket transform

An imported module's loop/sleep function becomes `async def`; the entry must
`await` a call into it, but can't statically know the callee is a coroutine. The
spike solved this by **converting every module function to async (`_AsyncifyAll`)
and wrapping every call in `await __maybe_await__(call)` (`_AwaitCalls`)**. This
design ships exactly that, because its failure mode (a missed await → imported
game logic silently doesn't run, no error) is unacceptable and the blanket
version is the one with real headless proof. Key properties:

- `__maybe_await__(v)` → `await v if inspect.iscoroutine(v) else v`. Semantically
  transparent for non-coroutines (`await __maybe_await__(len(x))` == `len(x)`).
- `_AsyncifyAll` converts every **module-level** `def` to `async def` (via
  `_SyncBarrier`, never descending into classes/nested defs — methods stay sync).
  This makes `_Awaiter`'s `time.sleep → await __sleep__` / `pygame.time.wait →
  await __sleep__` rewrites always valid (the function is async), so module pauses
  are honored where written. No hand-waved sleep-predicate; conversion and
  rewrite can't desync.
- `_AwaitCalls` wraps **every** `Call` node (all positions: Expr/assign/arg/
  return) in async scopes, closing the returned-then-called and non-Expr gaps.
- Module pipeline: `_AsyncifyAll` → `_Awaiter`(this module's converted set + its
  `_time_names`) → `_AwaitCalls` → `_InjectYield`.
- Entry pipeline (`_transform_entry_project`): the existing entry passes
  (`_Asyncify` loop-only → `_Awaiter` → `_InjectYield`) **plus** `_AwaitCalls`,
  composed here from the read-only classes (the shared `_transform` is untouched).

**Perf lever (optional, gated):** blanket wrapping adds an `await __maybe_await__`
per call in multi-file hot loops (single-file is untouched). If perf test #8
shows an unacceptable drop, enable a **safe exclusion**: skip wrapping calls that
are provably sync — bare-`Name` calls to Python builtins, and attribute calls
whose root `Name` is a **non-project** import alias (pygame/math/random/stdlib;
asname-aware). Excluded targets are never project async functions, so the
never-miss-an-await property holds. This lever ships **only** with the full
cross-module correctness matrix green (see tests 1–4, 8): `mod.fn()`,
`import mod as m; m.fn()`, `from mod import fn; fn()`, `f = fn; f()`, same-module
converted call in arg/return position. Exotic higher-order indirection
(`funcs[0]()`, `get()()`) is documented unsupported.

### Dispatch (JS `run()`)

```
run():
  if collab.active or not project.isMulti():
      _start(editor.getValue())             # the existing line, verbatim — zero regression
  else:
      task = _start_project(project.serialize().files, project.entry)
  # consume `task` exactly like today: task.then(kind => setStatus...) with the
  # existing `runTask !== task` staleness guard. _start_project returns the Future.
```

## Bootstrap, persistence, sharing, examples

- **`loadInitialProject()`** replaces the synchronous load block (index.html
  955–962) and runs once at editor init (before boot; the model has no pyodide
  dependency). Precedence, each step building a project object then
  `cm.swapDoc(active)`:
  `#room=` (async join, project stays a single empty/shared file) → `#project=`
  (multi-doc) → `#code=` (one file) → saved `pygame-playground:project` →
  legacy `pygame-playground:code` (seed one-file project + keep mirroring, below)
  → default example. The `#room` branch remains the existing async path.
- **One canonical `deserialize(obj)`** tolerant of partial shapes: missing
  `order` → `Object.keys(files)`; missing `entry` → `main.py` if present else
  first; missing `active` → `entry`. Used uniformly by saved-project, `#project=`,
  and the legacy-migration seed, so all converge on a valid in-memory project.
- **localStorage:** project record under `pygame-playground:project`
  (`serialize()` output + `active`). **A single project-aware writer** owns
  persistence — the legacy `editor.on("change")`/`beforeunload` writers (index.html
  965–970) are **replaced**, not left co-running. The writer is debounced (400 ms),
  flushed on `beforeunload`, and **early-returns while `collab.active`** (as
  today). For rollback safety (a stale GitHub-Pages build reading the old key), it
  **also mirrors the text to the legacy `pygame-playground:code` key when
  `!isMulti()`** — so single-file work is never lost to an older cached build, and
  the legacy key never holds a misleading partial multi-file state.
- **Migration:** on load, if `pygame-playground:project` is absent but the legacy
  key exists, seed `{ files: { "main.py": <legacy> } }` via `deserialize`.
- **Share button:** branches on `project.isMulti()`. Single → existing
  `#code=` + `b64url.enc(editor.getValue())` (unchanged, short URLs, back-compat).
  Multi → `#project=` + `b64url.enc(JSON.stringify(project.serialize()))` (full
  map + entry; flush docs via `serialize()` first; unicode-safe `b64url`). **URL
  size guard:** if the encoded URL exceeds ~16 KB, warn and suggest Save/collab
  instead of emitting a silently-broken link.
- **`projectFromHash()`** mirrors `codeFromHash`'s defensiveness: try/catch
  decode+parse, validate (`files` is a non-empty object of string→string, `entry`
  is a key, each name passes the Add-path rules), return `null` on any failure so
  precedence falls through and a bad link never clobbers the saved project.
- **Examples dropdown:** the dirty-check (index.html 979–987) becomes
  project-aware — `confirm()` whenever `project.isMulti()` OR the active text
  differs from `loadedExample`; the message says "Replace your whole project
  (N files) with this example?" when multi. Accepting replaces the whole project
  with a one-file `main.py`. `loadedExample` stays the single-file baseline so
  verify.mjs step 5 is unchanged.

## Collab interplay (single-file invariant)

- `#room=` on load → single-file mode, tabs hidden, project autosave never writes
  (paused on `collab.active`); any local project in localStorage is untouched and
  returns on the next non-room load.
- Clicking Collaborate while multi-file → `confirm("Live collaboration is
  single-file. Share only your entry file (<entry>)? Your full project stays saved
  locally and returns when you reload.")`. If accepted, `startRoom()` seeds from
  the **entry** text (not the active tab); the in-memory project object is not
  mutated by the room's buffer.
- Because a room is entered-until-reload, the room→solo→multi-file transition
  can't happen mid-session; `bindEditor`'s listeners (attached once, guarded by
  `if (!collab.active) return`) are never exercised against a multi-file project
  in the same session. No new collab listener logic is needed.

## Error handling

- **Bad new-file/rename name** (not `.py`, dup, non-identifier): rejected inline
  with a message; nothing changes.
- **Missing import / syntax error in a module:** the normal Python traceback in
  the on-page console (the loader lets `SyntaxError`/`ModuleNotFoundError`
  propagate through `_run_project`'s try/except, same routing as `_run`). A rename
  that orphans an import surfaces here as `ModuleNotFoundError` (the rename warning
  pre-warns the user).
- **Unsupported game-loop placement — friendly, transform-time:** `_transform_module`
  scans (a) the module body for a `While` matching `_is_gameloop` at top level and
  (b) any `ClassDef` body/method for a `_is_gameloop` `While`, and raises a clear
  message (e.g. *"enemy.py: a game loop must be in the entry file or a module-level
  function — not at module top level / inside a class method"*) instead of a raw
  `SyntaxError` or a silent freeze. Documented in README.
- **Entry deleted/renamed:** the model keeps the entry pointer valid (reassign on
  delete; follow on rename).

## Testing (TDD, real headless Chromium — `test/multifile.mjs`)

Mirrors `verify.mjs`/`assets.mjs`. New battery (every item asserts in a real
browser):

1. **Cross-file import runs** — `main.py` imports `enemy.py`; canvas animates,
   status running.
2. **Imported cooperative loop doesn't freeze** — a loop in `enemy.py` called by
   the entry; main-thread round-trip < 500 ms while running.
3. **Imported pause honored** — `pygame.time.wait`/`time.sleep` in an imported
   function pauses without freezing; post-pause draw appears. Include a
   `from time import sleep` alias case.
4. **Cross-module await matrix** — `mod.fn()`, `import mod as m; m.fn()`,
   `from mod import fn; fn()`, `f = fn; f()` (returned/aliased value), and a
   same-module converted call in arg/return position all run (no silent dead
   logic). Edit a module + re-run picks up new code (`sys.modules` cleared).
5. **Tabs** — add a file (asserts Python highlighting on the new Doc, proving
   `mode:'python'` and `editor.refresh()` ran), switch tabs (content swaps,
   per-file undo isolated), set-entry changes what Run executes, delete reassigns
   entry, last-file delete disabled.
6. **Persistence** — reload restores all files + entry + active tab, **including an
   edit made in a non-active tab** (proves `serialize()` reads every Doc).
7. **Project share link** — the Share *button* in multi-file mode emits
   `#project=`, and a reload of that URL round-trips the full project; a malformed
   `#project=` falls through without clobbering the saved project.
8. **Perf sanity** — a 2-file game with a **per-frame cross-module call** sustains
   animation over N frames within a bounded time (guards the blanket-await cost;
   the gate for the optional exclusion lever).
9. **Friendly errors** — a top-level loop in a non-entry module AND a game loop in
   a class method each raise the friendly message (no raw SyntaxError, no silent
   freeze).
10. **No cross-run contamination** — run a 2-file project, delete back to one
    file, run a solo program importing the old module name → `ModuleNotFoundError`
    (stale MEMFS module unlinked).
11. **Single-file byte-identity** — when `!isMulti()`, `_start` (not
    `_start_project`) is invoked, and a solo sync helper containing only
    `time.sleep` behaves exactly as today.
12. **Collab unchanged** — start a room from a 2-file project shares the entry and
    warns; `verify.mjs`, `test/assets.mjs`, `test/collab.mjs` stay green unchanged.

Documented-manual: switching tabs while a game runs moves keyboard focus to the
editor (hint bar already says "click canvas for keys").

## Constraints preserved

Single static `index.html`, no app backend, no app build step, no API keys. The
run-model is additive Python adding only new names; the existing single-file
`_start`/`_run`/`_transform` are untouched, so first paint and the solo battery
don't regress. Multi-file machinery engages only once a 2nd file exists and you're
not in a room.

## Appendix — hardening from the 4-lens adversarial review

Resolved before coding: blanket (proven) transform instead of an unproven scoped
inclusion-list (closes silent missed-await); PROJECT_PY owns its transform classes
(no shared-name mutation → solo byte-identity); single `loadInitialProject()`
bootstrap + tolerant `deserialize`; one project-aware autosave writer
(`serialize()` reads every Doc; legacy key mirrored only single-file; paused in
room); `main.py` Doc adopted from `editor.getDoc()`; `#editorPane` → column +
`editor.refresh()` on strip toggle; Share/examples/`#project=` made project-aware
+ validated + size-guarded; rename name-only + warning; collab single-file with
the no-leave reality stated (no phantom "restore on leaving"); MEMFS reconcile +
unlink-on-delete; friendly transform-time errors for both bad loop placements;
`_start_project` returns the Future (no spike destroy-and-return). Documented
unsupported: higher-order indirection of converted functions, game loops inside
methods / at non-entry top level, multi-file collaboration.
