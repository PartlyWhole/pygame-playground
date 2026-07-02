# pygame-playground — Technical Architecture

> How ordinary, blocking **desktop pygame code runs unmodified in a browser tab**, served
> as a **100% static site from GitHub Pages** (no backend, no build step for the app itself).
>
> Scope: this document explains the *runtime mechanism* — the Python interpreter, the
> SDL→canvas binding, and the cooperative-async source transform that is the heart of the
> project. For a line-by-line map of `index.html` (toolbar ids, panels, test seams) see
> [`specs/2026-06-23-redesign-architecture-map.md`](specs/2026-06-23-redesign-architecture-map.md).
> For feature designs see `docs/specs/*-design.md`.

---

## 1. The core problem

Desktop pygame is written as a **synchronous, blocking** program:

```python
import pygame
pygame.init()
screen = pygame.display.set_mode((640, 480))
clock = pygame.time.Clock()
while True:                          # <-- never returns
    for e in pygame.event.get():
        if e.type == pygame.QUIT: raise SystemExit
    screen.fill((20, 20, 30))
    pygame.display.flip()
    clock.tick(60)                   # <-- busy/blocking sleep on desktop
```

A browser tab has **one main thread**, shared by JavaScript, the DOM, rendering, and (via
WebAssembly) the Python interpreter. A `while True:` loop that never yields control **freezes
the entire tab**: no repaint, no input, no way to stop it. `clock.tick(60)` and `time.sleep()`
make it worse — under Pyodide they busy-wait the main thread.

The project's central design goal: **paste a normal pygame snippet and have it just work**,
without asking the user to rewrite it as `async def main()` + `await asyncio.sleep()` (the
pattern pygbag and raw Pyodide require). The solution is a **source-to-source AST transform**
applied at run time that rewrites the user's blocking code into cooperative async code — see
§5, the most important section of this document.

---

## 2. The static-hosting model

The deployed artifact is essentially **one file**: [`index.html`](../index.html) (~3700 lines:
HTML + CSS + a classic `<script>`). It is published verbatim by **GitHub Pages** at
`https://partlywhole.github.io/pygame-playground/`. There is:

- **No backend / no server code.** Nothing runs except in the visitor's browser.
- **No API keys, no database.** State lives in the browser (IndexedDB, localStorage, MEMFS).
- **No build step for the app.** `index.html` is hand-authored and edited directly.

### Two kinds of dependencies

| Kind | How loaded | Examples |
|------|-----------|----------|
| **CDN, at run time** | `import()` / `<script>` from public CDNs | Pyodide + pygame-ce (jsDelivr), CodeMirror (cdnjs), ruff-wasm (esm.sh), JSZip / jsdiff (cdnjs) |
| **Vendored, committed** | static files served by Pages | `vendor/engine.mjs` (the engine, §5), `vendor/automerge-collab.mjs` (collab CRDT bundle) |

Some libraries **cannot** be loaded from a CDN without a bundler (e.g. `automerge-repo`). Those
are pre-built **once** with esbuild (`build/build.mjs`) into a committed `vendor/*.mjs` bundle
that Pages serves statically. **The build step produces vendored artifacts, never the app
itself** — the deployed site stays fully static.

> **Relative-URL invariant (load-bearing for Pages).** The site lives under a *project
> subpath* (`/pygame-playground/`), not a domain root. Every vendored import resolves
> relative to `document.baseURI`, e.g.
> `import(new URL("./vendor/engine.mjs", document.baseURI).href)` (see `loadEngine()` in
> `index.html`). A leading-slash absolute path would break on Pages.

### First-paint lazy invariant

The "boot + run a game" path must download **zero** of: Automerge, ruff-wasm, the CodeMirror
lint addon, JSZip, jsdiff, or even `vendor/engine.mjs` eagerly. Each sits behind a one-shot
**cached-promise loader** (`loadEngine`, `loadAutomerge`, `loadLinter`, `loadJSZip`,
`loadDiffLib`). This keeps first paint cheap; the ~15–20 MB Python runtime is the only large
download, and it is browser-cached after the first visit. This invariant is tested.

---

## 3. The Python runtime: Pyodide + pygame-ce

The interpreter is **[Pyodide](https://pyodide.org/) 0.27.2** — CPython compiled to
WebAssembly — pinned and loaded from jsDelivr:

```js
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
const mod = await import(PYODIDE_BASE + "pyodide.mjs");
pyodide = await mod.loadPyodide({ indexURL: PYODIDE_BASE });
```

pygame itself is **[pygame-ce](https://pyga.me/)** (the community edition, which ships an
Emscripten/WASM build), loaded as a Pyodide package: `await inst.loadPackage("pygame-ce")`.

> **The bare-name `pyodide` seam.** The booted interpreter instance is held in a top-level
> `let pyodide` in `index.html`. ~40 tests reach the interpreter by the **bare name**
> `pyodide` (not `window.pyodide`). The engine module never touches this global directly — it
> receives `getPyodide()` / `setPyodide()` callbacks so the host owns the seam. Do not change it.

---

## 4. Binding SDL to an HTML canvas

pygame renders through **SDL2**, which the Emscripten build can target an HTML `<canvas>`. The
binding happens in a **strict, load-bearing order** during boot (`engine.boot()` in
`vendor/engine.mjs`), *before* pygame is imported:

1. **Audio-context proxy first** (see §8) — must precede `pygame.mixer`.
2. **Load Pyodide**, publish the instance to the host's `pyodide` global immediately (asset
   hydration and lazy loaders read that global, not a local).
3. **Register the canvas with SDL** *before* pygame import:
   ```js
   inst.canvas.setCanvas2D(d.canvas);   // d.canvas === document.getElementById("canvas")
   ```
   The stage is therefore a **2D canvas context**, not WebGL — this matters for clearing it
   safely (§9).
4. **Scope SDL keyboard capture to the canvas** so the code editor keeps receiving keystrokes:
   ```js
   inst.runPython('import os; os.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"');
   ```
   The user must **click the canvas to give it focus** before keyboard input reaches the game.
5. **`loadPackage("pygame-ce")`**, then run `BOOT_PY`, then `PROJECT_PY` (strict order —
   `PROJECT_PY` reuses names defined by `BOOT_PY`).
6. **Hydrate assets** from IndexedDB into MEMFS (§7).

The canvas is fixed at the SDL-bound size (640×480 by attributes); CSS only scales it *down*
to fit the pane, never changing the backing resolution.

---

## 5. The cooperative-async transform (the heart)

All of this lives in **[`vendor/engine.mjs`](../vendor/engine.mjs)** as two `String.raw`
Python blobs — `BOOT_PY` (single-file engine) and `PROJECT_PY` (multi-file engine) — plus a
thin JS wrapper `createEngine()`. The Python is run inside Pyodide; the JS only schedules and
controls it.

When the user presses **Run**, their source is **parsed to a Python AST, rewritten, recompiled,
and executed as a coroutine** on the browser's event loop. Three AST passes do the work:

### Pass A — Asyncify (`_Asyncify`)
Any `def` whose body contains a **game loop** becomes an `async def`, and its name is
remembered. A "game loop" is detected structurally (`_is_gameloop`): a `while` containing a
call to `display.flip` / `display.update` / `clock.tick` / `event.get|poll|wait`. The
top-level `while True:` is handled by compiling the whole program with
`PyCF_ALLOW_TOP_LEVEL_AWAIT`, so module-level loops can `await` too.

### Pass B — Awaiter (`_Awaiter`)
Statement-level rewrites inside async contexts:

| Original | Rewritten |
|----------|-----------|
| `main()` (a function Pass A converted) | `await main()` |
| `asyncio.run(x)` | `await x` |
| `time.sleep(s)` | `await __sleep__(s)` |
| `pygame.time.wait/delay(ms)` | `await __sleep__(ms/1000)` |

It tracks how the user *named* the time module (`import time as t`, `from time import sleep`)
so aliases are caught.

### Pass C — Inject yield (`_InjectYield`)
Inserts `await __yield__()` at the **START of every `while` and `for` body**.

> **Why START, not end (load-bearing).** A `continue` or `break` jumps past the rest of the
> body. An end-of-body yield would be **skipped** on those iterations — a loop using `continue`
> (start screen, pause screen, game-over screen) would never yield and would freeze the tab. A
> start-of-body yield runs every iteration regardless of control flow.

All three passes inherit `_SyncBarrier`, which **refuses to descend into `def`/`class`
bodies** — inserting an `await` into a still-sync function would be a `SyntaxError`. (Pass A
flips the function to async *first*; only then do B/C process its body.)

### The yield itself — frame pacing without busy-waiting

`__yield__()` is what actually keeps the tab alive *and* paces frames:

```python
async def __yield__():
    await _pause_gate.wait()          # blocks ONLY while paused (else instant)
    d, ticked, flipped = _state["delay"], _state["ticked"], _state["flipped"]
    _state.update(delay=0.0, ticked=False, flipped=False)
    if d > 0:        await asyncio.sleep(d)        # banked frame budget -> real sleep
    elif ticked:     await asyncio.sleep(0)        # ticked but no budget -> hand off once
    elif flipped:    await asyncio.sleep(1/60)     # drew but didn't tick -> default ~60fps
    else:
        _state["n"] += 1
        if _state["n"] % 256 == 0:                 # plain compute loop: yield occasionally
            await asyncio.sleep(0)
```

The frame budget is **banked, never busy-waited**. pygame's blocking timers are monkeypatched
to *record* how long they wanted to sleep, and the injected yield *sleeps it off cooperatively*:

- `pygame.time.Clock` is replaced with `_Clock`: `tick(fps)` computes the remaining frame time
  (`1/fps - elapsed`) and **banks it into `_state["delay"]`** instead of sleeping. It never
  busy-waits.
- `pygame.time.delay/wait` and `time.sleep` are repointed to `_bank()` (add to the delay
  budget). Statement-level sleeps become *real* `await asyncio.sleep` via Pass B; banking is
  the fallback for sleeps buried inside sync helper functions.
- `pygame.display.flip/update` are wrapped to set a `flipped` flag and bump a **frame counter**
  (`_state["flips"]`) that the host watchdog reads (§6).

The 256-iteration throttle means tight non-drawing loops (e.g. number crunching) stay fast —
they only round-trip the event loop occasionally — while still never freezing the tab.

### Run lifecycle: one task, a pause gate

A run is a single asyncio task:

- **`_start(src)`** → `_stop()` any prior task, reset state, `asyncio.ensure_future(_run(src))`.
- **`_run(src)`** transforms + `eval`s the code, awaits the resulting coroutine, and maps the
  outcome to a status string: `"ok"`, `"stopped"` (CancelledError), `"exit"` (SystemExit),
  `"error"` (printed traceback).
- **Stop/End** = `task.cancel()`. Exactly one live task ever exists; **Start while running
  restarts** (stop-then-start), so there are never two concurrent loops.
- **Pause/Resume** = an `asyncio.Event` **pause gate** that `__yield__` awaits at the top of
  every frame. `clear()` parks the loop there; `set()` resumes. Pause ≠ stop — the task stays
  alive. Both engines (single-file and project) bind the *same* `__yield__`, so one gate
  covers both.

---

## 6. Stage-stall watchdog

The cooperative transform prevents a **hard tab freeze**. It cannot prevent a **soft stage
stall**: a program that keeps running but stops drawing (a flip-less inner loop, a swallowed
exception, an accidental wait). The host polls `_state["flips"]` once a second while a program
is live; if frames *were* advancing and then stop for several seconds (and the program isn't
paused and had drawn ≥1 frame), it surfaces a calm "press End" notice and logs a diagnostic
(`window.__engineDiag`). It deliberately does **not** warn for pure-compute programs that
legitimately never draw.

---

## 7. The multi-file project engine

`PROJECT_PY` extends the single-file engine to support **multiple files, packages, and
subdirectories** — all in Pyodide's in-memory filesystem (**MEMFS**, rooted at the cwd, e.g.
`/home/pyodide`). It **reuses** `BOOT_PY`'s passes and helpers; it never modifies the
single-file path.

The key problem: Python's native `importlib` imports modules **without** running the
cooperative transform, so an imported module with a blocking `while True` would freeze. The
fix is a custom **`MetaPathFinder` + `Loader`** (`_CoopPathFinder` / `_CoopLoader`):

- Resolution (packages, `__init__.py`, relative imports) is **delegated to the stdlib
  `PathFinder`** — all free.
- Only for **project-origin `.py` files under the root** is the loader wrapped, so their source
  is run through `_transform_module` (a selectively-async variant) on import.
- stdlib, pygame, and site-packages go through the unmodified loader untouched.

Module functions are **selectively** converted to async — only those that loop or sleep; pure
helpers stay sync so class methods and module-level code can use their real return values.
Every cross-module call is wrapped in `await __maybe_await__(...)`, which passes non-coroutines
straight through. There are friendly errors for unsupported placements (a game loop at module
top level, or inside a class method, or a cooperative function called from a sync context).

On each run the engine **reconciles MEMFS**: writes the current files, auto-creates empty
`__init__.py` markers per package dir, unlinks files dropped since the last run, prunes empty
dirs, pops stale dotted module names from `sys.modules`, and `invalidate_caches()`. Leaving the
project path (back to a single file) purges all project files so a solo program can't import a
stale sibling.

---

## 8. Audio (autoplay policy)

Browsers start every `AudioContext` **suspended** until a user gesture. SDL creates its audio
context when `pygame.mixer` loads — too early to be allowed to play. The engine installs a
**`Proxy` over `AudioContext` / `webkitAudioContext` before pygame loads** that captures every
context SDL constructs into `window.__audioContexts`. On a user gesture (the **Run** click, or
a canvas click) the host calls `resumeAudio()`, which resumes any suspended captured context.
This is why a sound can be silent until the user clicks the canvas once. Supported formats:
**WAV and OGG** (MP3 has no in-browser decoder).

---

## 9. Assets and persistence

- **User assets** (images/sounds) are stored as bytes in **IndexedDB** and **mirrored into
  MEMFS** so ordinary `pygame.image.load("ship.png")` works by name. On boot, `hydrateAssets()`
  rehydrates persisted uploads into MEMFS. Relative paths are resolved against the MEMFS cwd.
- **Code drafts / history** persist in the browser (CodeMirror `Doc` objects for per-file undo;
  snapshots saved to history on each run). Assets are **local to the browser** — they do not
  travel with Share links or collab rooms.
- **Clearing the stage on end.** When a program ends, the host blanks the canvas to black with
  a **2D fill** (`getContext("2d")`), mirroring how a desktop pygame window disappears on exit.
  It must use 2D (never probe WebGL) because SDL bound a 2D context (§4) — a context-mode
  mismatch would strand the canvas for the next run.

---

## 10. Collaboration (optional, lazy)

Live multi-user editing is built on **[Automerge](https://automerge.org/)** (a CRDT) syncing
over Automerge's free public server `wss://sync.automerge.org`. Because `automerge-repo` can't
load from a CDN without a bundler, it ships as the committed, esbuild-built
`vendor/automerge-collab.mjs` (~2.9 MB), loaded **lazily** only when a room is started/joined —
the solo playground never downloads it. **Only code and cursors are shared**; each participant
still presses Run and executes pygame **locally in their own browser**. There is no shared
execution and no server-side state beyond the relay.

---

## 11. End-to-end: what happens on "Run"

1. `await booted` (Pyodide + pygame-ce + engine ready).
2. Clear console, snapshot to history, focus canvas, resume audio contexts.
3. Single file → `engine.start(editorText)`; multi-file → `engine.startProject(files, entry)`
   (the **open file is the entry**).
4. Inside Pyodide: source → AST → 3 passes → `compile` → `eval` → `await` the coroutine.
5. The cooperative loop runs frame-by-frame; SDL draws into the 2D canvas; banked frame budgets
   are slept off in `__yield__`; the watchdog polls `_state["flips"]`.
6. On settle: map status (`ok`/`stopped`/`exit`/`error`), clear the stage to black, update
   chrome, and on error rewrite the buffered traceback into a friendly message.

---

## 12. Constraints & gotchas (quick reference)

- **One main thread.** Everything (JS, Python/WASM, rendering) shares it — hence the entire
  cooperative-yield design. There is no web worker for Python.
- **Canvas is a 2D context**, fixed backing size 640×480; CSS only scales down.
- **Keyboard needs canvas focus** (SDL capture scoped to `#canvas`); click it first.
- **Audio needs a user gesture**; WAV/OGG only.
- **Pages serves from a subpath** → all vendored imports must be `document.baseURI`-relative.
- **First-paint lazy invariant** is tested — don't eagerly import the heavy/optional modules.
- **The `pyodide` bare-name global** is a tested seam — route interpreter access through the
  engine's `getPyodide`/`setPyodide` callbacks.
- **AST transform assumptions:** game loops are detected structurally (flip/tick/event calls);
  yields are injected at loop-body *start*; sync `def`/`class` bodies are never given `await`.

---

## 13. File map (runtime-relevant)

| Path | Role |
|------|------|
| `index.html` | The entire app: UI, editor, host boot, run dispatch, watchdog, assets, lazy loaders |
| `vendor/engine.mjs` | Cooperative pygame engine: `BOOT_PY`, `PROJECT_PY`, `createEngine()` |
| `vendor/automerge-collab.mjs` | Pre-built CRDT collab bundle (lazy) |
| `build/build.mjs` | esbuild script that produces the vendored bundles (not the app) |
| `verify.mjs` | Headless engine smoke test (Playwright) |
| `test/*.mjs` | Battery tests: assets, collab, history, lint, multifile, save, run/stop spikes |
| `docs/specs/*-design.md` | Per-feature design docs |
| `docs/specs/2026-06-23-redesign-architecture-map.md` | Line-by-line `index.html` seam map |
