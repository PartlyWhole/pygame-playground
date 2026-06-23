# Auto-lint — design

**Date:** 2026-06-23 · **Status:** approved-by-delegation, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages)

> Feature 3 of 4 (Multi-file → Save → **Lint** → History). The user delegated
> end-to-end; decisions recorded for review.

## Goal

Surface Python problems in the editor **as you type** — undefined names (typos),
unused imports, and syntax errors — as gutter markers with hover tooltips, so a
beginner sees `speeed` is undefined before they hit Run. Debounced, never freezes
typing or a running game, zero cost until the user edits.

Non-goals (v1): style/formatting lint (deliberately suppressed — see noise); a
"fix it" / autofix action; configurable rule sets in the UI; type checking.

## What the spikes proved (`test/spike-lint.mjs`, `test/spike-lint-rules.mjs`)

- **ruff-wasm-web loads no-build from esm.sh** and lints a ~200-line file in
  ~1.8 ms (init ~420 ms). It's a self-contained wasm module — **off the Python
  thread**, so it never competes with a running pygame loop, and works
  independently of Pyodide.
- **CodeMirror 5's lint addon wires up no-build** from the same cdnjs 5.65.16 path
  the app already uses; an async lint source renders gutter markers.
- **Rule curation works (make-or-break):** `new Workspace({ lint: { select:
  ['F'] } })` reports only the high-value `F` codes (F821 undefined-name, F401
  unused-import, F811 redefinition, F841 unused-var, …) **plus syntax errors**
  (reported as `invalid-syntax`, independent of `select`), and **suppresses the
  `E`/`W` style noise** (E701 "multiple statements", E401 …) that the app's own
  compact-`if` examples would otherwise trigger. Without this, the gutter would be
  a wall of formatting nits on perfectly good game code.
- **Diagnostic shape** (ruff-wasm-web 0.15.18): each diagnostic has `code`,
  `message`, and **1-based** `start_location`/`end_location` `{ row, column }`.
  CodeMirror `Pos` is 0-based → subtract 1 from row and column.

## Decisions (locked)

- **Engine: `@astral-sh/ruff-wasm-web`, pinned `@0.15.18`, loaded lazily from
  esm.sh.** Chosen over pyflakes-in-Pyodide because it runs in its own wasm module,
  independent of the Pyodide interpreter (so a check never competes with a running
  game for the Python runtime, and a check is ~2 ms vs pyflakes' ~27 ms — no
  perceptible hitch), needs no Pyodide boot or `micropip` install, and gives syntax
  + semantic checks in one tool. **Trade-offs (accepted):** a new CDN origin
  (esm.sh — pinned for reproducibility; jsdelivr `/+esm` is a documented backup)
  and a one-time wasm download — both paid lazily, so the solo first-paint /
  run-a-game path is unaffected. (Alternative considered: pyflakes via the
  already-loaded Pyodide — no new origin and zero style noise, but main-thread
  (would hitch a running game), boot-dependent, and slower. Recorded for the
  reviewer.)
- **Ruleset: `select: ['F']`** → undefined-name / unused-import / unused-var /
  redefinition + syntax errors; no style noise. (E/W intentionally omitted.)
- **Lazy:** ruff-wasm **and** the CM lint addon load on the **first editor
  change** after the page is interactive (one-shot, behind a cached promise), then
  lint is enabled. First paint and the run-a-game path load neither.
- **Severity:** `invalid-syntax` and `F821` (undefined name) → **error** (red
  marker); every other `F` code → **warning** (yellow). Both get a hover tooltip
  with ruff's message.
- **Debounce ~350 ms** after the last keystroke (ruff is ~2 ms, so the debounce
  is just to avoid re-linting every character).
- **Multi-file:** lint follows the **active tab** — the CM lint addon operates on
  the editor instance, which holds the active file's doc; switching tabs re-lints
  the newly-shown file. (No cross-file analysis; each file is linted alone, which
  matches ruff's per-file model.)
- **Graceful degradation:** if ruff or the addon fails to load (offline / CDN
  down), lint silently stays off — the editor is fully usable; no error surfaced
  beyond a single `sys` console note.
- **Always on (no UI toggle) in v1** — markers are unobtrusive (gutter + hover);
  a toggle can come later if anyone finds it distracting.

## Architecture

All additions in `index.html`, additive and lazy. Units:

- **`loadLinter()`** — a one-shot cached promise (like `loadAutomerge`/`loadJSZip`)
  that (a) injects the CM5 `addon/lint/lint.min.js` + `lint.min.css` from cdnjs,
  (b) `import()`s ruff-wasm-web from the pinned esm.sh URL and `await`s its wasm
  `init()`, (c) constructs one `Workspace({ lint: { select: ['F'] } })`. Resolves
  to `{ workspace }`; rejects → caller disables lint.
- **`lintSource(text)`** — runs `workspace.check(text)`, maps each diagnostic to a
  CM5 annotation `{ from: Pos(row-1, col-1), to: Pos(endRow-1, endCol-1), message,
  severity }`. Pure; no I/O.
- **Wiring:** on the **first** `editor` `"change"`, call `loadLinter()`; on
  success, set `editor.setOption("gutters", [...existing, "CodeMirror-lint-markers"])`
  and `editor.setOption("lint", { async: true, getAnnotations, lintOnChange: true,
  delay: 350 })`, where `getAnnotations(text, cb)` calls `cb(lintSource(text))`.
  (CM5's lint addon already debounces via `delay`; the addon re-runs on doc change
  and on `swapDoc`, so tab switches re-lint automatically.)
- **`#editorPane`/gutters:** the editor currently has line-number gutters; adding
  `"CodeMirror-lint-markers"` puts the marker column beside them.

**What it does / how / depends on:** shows live Python problem markers; automatic
once you start typing; depends on ruff-wasm-web (esm.sh) + the CM lint addon
(cdnjs), both lazy.

## Data flow

```
first editor change ─► loadLinter() (CM lint addon + ruff-wasm, once)
                        └─► editor.setOption("lint", {async, getAnnotations, delay:350})
edit / switch tab ─► CM lint addon (debounced 350ms) ─► getAnnotations(text)
                        └─► workspace.check(text) ─► map (1-based → CM 0-based)
                              └─► gutter markers + hover tooltips
```

## Error handling

- **ruff/addon load failure:** `loadLinter()` rejects; a single `sys` console line
  ("Linting unavailable — couldn't load the checker") and lint stays off.
- **`workspace.check` throws** (shouldn't on any string): catch, return `[]` (no
  markers) so a linter hiccup never blocks editing.
- Lint output is advisory; it never affects Run.

## Testing (TDD, headless Chromium — `test/lint.mjs`)

1. **Undefined name → error marker.** Type code with `speeed` (undefined); assert
   a `.CodeMirror-lint-marker-error` appears and the lint annotation is on the
   right line.
2. **Syntax error → marker.** `def f(:` → a marker appears.
3. **Unused import → warning marker.** `import random` unused → a
   `.CodeMirror-lint-marker-warning`.
4. **No style noise.** Paste a compact-`if` snippet styled like the app's examples
   (valid code) → assert **zero** markers (curation working — this is the key
   anti-regression).
5. **Clean code → no markers.**
6. **Lazy:** at first paint, ruff is not loaded and the editor has no lint option;
   after an edit, lint becomes active.
7. **Multi-file:** with two files, an undefined name in the active file marks; after
   switching tabs, the other file is linted (markers reflect the shown file).
8. **Non-regression:** `verify.mjs` / `assets.mjs` / `collab.mjs` / `multifile.mjs`
   / `save.mjs` stay green; first paint loads no ruff (a network assertion).

## Constraints preserved

Single static `index.html`, no backend, no app build step, no API keys. The
linter (ruff-wasm + CM lint addon) loads lazily on first edit, so first paint and
the run-a-game path are unchanged. Lint is independent of Pyodide and advisory.
