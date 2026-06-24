# S4 — Examples become editable, runnable files that promote-on-edit (design only)

> **Slice S4 of the pygame-playground redesign.**
> Design document — **no implementation, no code changes, no commit.** Produced 2026-06-23 on
> branch `redesign`. Drives a later TDD implementation; precision is the point.
>
> **Sources of truth, in priority order:**
> 1. `docs/specs/2026-06-23-redesign-decision-context-map.md` — the `examples-promote-semantics`
>    recipe (Doc-adoption + `swapDoc`, NEVER `editor.setValue`; per-file undo is free; reset = fresh
>    Doc; `●` modified dot; old `change` handler + `loadedExample` become dead).
> 2. `docs/specs/2026-06-23-redesign-open-decisions.md` — the verdict (examples = promote-on-edit;
>    supersedes the old copy-to-clipboard #9).
> 3. `docs/specs/2026-06-23-redesign-direction-team.md` — Iteration Log ("editing makes it your
>    file"; reset icon + confirm; per-file undo).
> 4. `proto/sandbox.html` — the examples UI the team shaped (editable files, `↺` reset with confirm,
>    `●` modified dot, the panel note "editing makes it your file"). The proto **already contains the
>    full promote machinery** (`markModified` / `promoteExampleToTree` / `recomputeModified` /
>    `exampleOf`, lines 871–887) — S4 ports that logic onto the **real** `index.html` CodeMirror/Doc
>    engine.
> 5. `index.html` — the current S1 **inert** Examples panel + the real engine seams (re-confirmed
>    line refs below).
> 6. `docs/specs/2026-06-23-shell-restyle-design.md` (S1) — the inert Examples panel + the
>    `setValue`/lint landmine; `test/shell.mjs` is the battery to reconcile in lockstep.

**Every `index.html` line ref below was re-confirmed against the file on branch `redesign`** (3042
lines). Where this design says "the proto does X via Y", Y is the proto's contenteditable mock; S4
re-expresses the same UX over the real CodeMirror.Doc model.

---

## 0. Orchestrator resolutions to confirm (READ FIRST)

These are the calls S4 needs from the orchestrator. Recommendations are given; §9 expands the
reasoning. The design below assumes the recommended answers unless the orchestrator overrides.

> **✅ ORCHESTRATOR (2026-06-23): all recommendations ACCEPTED, with one correction.**
> **Q2 CORRECTION — the collision suffix is UNDERSCORE (`bouncy_balls_2.py`), NOT hyphen.** A hyphen
> (`bouncy_balls-2.py`) fails `isModuleName` (`-` is not a valid identifier char), so it cannot be a real
> code file. Use `_N` (matching how `isModuleName` accepts `bouncy_balls_2.py`). Q1 fixed filename table ✅,
> Q3 clean reset ✅, Q4 DROP the legacy `#examples` select ✅, Q5 native `confirm()` ✅. **Q5b (preview +
> Start in a multi-file project): promote the preview, then run via the normal S3 dispatch** (fresh/
> single-file project → runs the example; established multi-file project → runs the entry, set-as-entry to
> choose). Re-opening an already-promoted example **selects the existing file** (no duplicate).

- **Q1 — Promote naming.** Map the example display name → a snake_case `.py` stem
  (`"Bouncing balls"` → `bouncy_balls.py`). Recommend a **fixed per-example filename table** (each
  `EXAMPLES` key has a canonical filename), not a slugify-at-runtime guess. See §3.2.
- **Q2 — Collision on promote** (the target filename already exists as a real project file).
  Recommend **auto-suffix** (`bouncy_balls.py` → `bouncy_balls-2.py`), consistent with the
  upload-routing verdict's warn-and-suffix rule. NOT silent reuse (would clobber a different file's
  Doc — violates the HARD invariant), NOT block (loses the user's keystroke). See §3.3.
- **Q3 — Reset undoability.** Recommend **clean reset** (fresh Doc, fresh undo stack) — matches the
  decision-context-map's "fresh Doc = fresh undo". The proto's "snapshot-first so reset is itself
  undoable" is the alternative; it's more code and a confusing two-layer undo. See §4.2.
- **Q4 — Legacy `#examples` `<select>` seam: KEEP or DROP?** Recommend **DROP it entirely** (markup +
  the `change` handler + `loadedExample`). **No test references it** — re-confirmed: `grep` for
  `getElementById('examples')` / `#examples` / a dispatched `change` across `test/` returns **zero
  hits**, and **there is no `verify.mjs`** (the S1 comment at index.html:2516-2518 claiming
  "verify.mjs drives it" is **stale**). Dropping is test-safe. See §6.
- **Q5 — Confirm component.** `index.html` today uses the **native `window.confirm()`** for all
  destructive actions (delete folder/file at 2343/2366, share-link replace at 2428). The proto's
  styled `.scrim`/`.dialog` modal is **not yet in `index.html`**. Recommend S4 use the **same
  `window.confirm()`** the rest of `index.html` uses for the reset confirm — do **not** introduce the
  modal in S4 (that's its own shared-component slice). See §4.1.

---

## 1. Scope & non-goals

### 1.1 What S4 IS

S4 turns the S1 **inert** Examples rail panel into **editable, runnable files that promote-on-edit**:

1. **Open** — clicking an example shows its source in the ONE CodeMirror, **without
   `editor.setValue`**: a preview `CodeMirror.Doc` built from `EXAMPLES[name]`, `swapDoc`'d in. The
   preview Doc is **not yet** in `project.files`. Lint stays **unarmed** until the user actually
   edits.
2. **Promote-on-edit** — the **first** real `change` to a preview Doc **adopts that exact Doc** into
   `project.files` under a real `.py` name (keystroke + undo history preserved), shows a `●` modified
   dot in **both** the Examples list and the Explorer tree, and makes it a normal runnable project
   file (Start runs it per S3).
3. **Reset-to-default (`↺`)** — behind the shared confirm, restore the example to `EXAMPLES[name]` as
   a **fresh Doc** (fresh undo stack); clears the `●`.
4. **Per-file undo** — confirmed free: each file/example owns its own `CodeMirror.Doc`, which carries
   its own undo history, so `⌘Z` is per-file automatically (no extra work beyond never destroying a
   Doc).
5. **The `●` modified indicator** — rendered in the Examples list row and (once promoted) the
   Explorer tree row.

It also **removes the dead code** the new model obsoletes (the old destructive `#examples` `change`
handler + `loadedExample`), and **reconciles `test/shell.mjs`** (the panel is no longer inert).

### 1.2 Explicit non-goals

| Out of scope | Why / where it lives |
|---|---|
| **Collab of examples** | Examples promote to ordinary project files; multi-file collab is S6. A preview Doc is never synced. |
| **Save/Download semantics** | A promoted example is just a project file; Download (S5 always-zip) already covers it. No S4 change to `saveProject`. |
| **Upload routing** | Separate slice; the only shared rule borrowed here is warn-and-suffix on a name collision (§3.3). |
| **The styled confirm modal** | S4 reuses the existing native `confirm()` (§0 Q5). Building the `.scrim`/`.dialog` shared component is its own slice. |
| **Editing `EXAMPLES` content** | `EXAMPLES` is the **immutable** source for preview + reset; never mutated (landmine: see §9). |
| **New folders for examples** | A promoted example lands at the **root** as a bare `bouncy_balls.py` (no folder); folders are S2's concern. |

**Bounding principle:** S4 changes the Examples panel's JS (render + open + promote + reset), adds
**one** Doc-adoption method to the `project` model, removes the legacy select seam, and updates
`test/shell.mjs` + adds `test/examples.mjs`. It touches **no Python**, no persistence format beyond
what `project.add`/serialize already do, and never `editor.setValue`.

---

## 2. Open semantics — the core mechanism (landmine b)

### 2.1 The preview Doc

Clicking an example must **show its content in the editor without arming lint and without putting it
in the project yet.** The mechanism:

1. Build a fresh `CodeMirror.Doc` from the immutable source:
   `const previewDoc = new CodeMirror.Doc(EXAMPLES[name], "python");`
   (Same constructor `project.load`/`project.add` use at index.html:1503/1514 — so it's a normal
   Python-mode Doc with its own undo history, but it is **not** registered in `project.files`.)
2. Tag the Doc so later code can recognise it as a preview of a specific example. Store an
   **example-preview descriptor** in a module-local variable (NOT on the Doc, to avoid coupling to
   CM internals):

   ```js
   // module-local, near viewerSel (index.html:2020)
   let previewExample = null;   // { name, doc } while an UNPROMOTED example is shown; null otherwise
   ```

   `name` is the `EXAMPLES` key; `doc` is the `previewDoc`. (The proto uses an `exampleOf` field on
   the file object; on the real engine we keep the descriptor in `previewExample` while unpromoted,
   and move to an `exampleOf` map keyed by filename once promoted — see §3.1.)
3. Show it via **`editor.swapDoc(previewDoc)`** — the exact same call `project.setActive`/`load` use
   (1509/1511). **Never `editor.setValue`** (which fires `change` → `armLint` at 1633 → eager-arms
   the linter → breaks first-paint zero-network laziness, landmine b).
4. Update the viewer chrome to "preview" mode: `vNameEl` = the **prospective filename** (e.g.
   `bouncy_balls.py`), `vMetaEl` = `· Python · from example`, `runBtnEl` shown (an example IS
   runnable — see §7). Mark the Examples list row `.sel`.

### 2.2 How preview state differs from a real file

| | Real project file | Example **preview** (unpromoted) |
|---|---|---|
| In `project.files` / `project.order`? | yes | **no** |
| `editor.getDoc()` is its Doc? | yes (via `setActive`) | yes (via `swapDoc`) |
| `project.active`? | = its name | **unchanged** (stays whatever was active before; the preview is *displayed* but not the active project file) |
| Appears in the Explorer tree (`renderTabs`)? | yes | **no** |
| Persisted (autosave/serialize)? | yes | **no** (not in `project.files`, so `serialize()` at 1490-1498 never sees it) |
| Runnable by Start? | yes | yes (see §7 — Start of a single-file preview runs `editor.getValue()`) |

The key safety property: a preview Doc lives **entirely outside** `project.files`, so nothing in the
persistence/serialize/render paths can touch a real file's content because of it.

### 2.3 Lint stays UNARMED until a real edit

`armLint` is wired at index.html:1633 to `editor.on("change", armLint)`. `editor.swapDoc` does **not**
fire `change` (it replaces the document; CM's `change` is for content edits within the active doc).
Therefore opening a preview via `swapDoc` keeps `lintArmed` false and never calls `loadLinter`
(esm.sh ruff-wasm + cdnjs lint addon). The first **user keystroke** fires `change`, which (a) arms
lint as today AND (b) triggers promotion (§3). Both ride the same first-`change` signal but are
independent handlers.

> **Test hook (examples.mjs (a)):** after opening an example, the CM instance is the same object and
> `cm.getOption('lint')` is falsy. See §8.

### 2.4 What "open" replaces

There is no destructive overwrite anymore. The S1 inert rows (index.html:2539-2540) currently render
a non-clickable list; S4 makes each row **clickable → open preview**, and adds the `●` dot + `↺`
reset affordances (§4). The legacy `#examples` select's load-and-run-and-overwrite path (2519-2531)
is **removed** (§6), not reused.

---

## 3. Promote-on-edit

### 3.1 The mechanism — ADOPT the preview Doc (do NOT re-create it)

The hard requirement from the decision-context-map: the first edit must **adopt the exact preview
Doc** so the keystroke and undo history are preserved. `project.add(name, text)` (index.html:1512-1517)
**re-creates** a Doc from a string — it would discard the preview Doc's identity, the in-flight
keystroke, and the undo stack. So S4 adds **one new method** to the `project` model: a Doc-adopting
add.

```js
// project model (index.html:1475-1587). NEW method — adopts an existing Doc instead of
// constructing a new one. Mirrors add() but takes the live Doc so undo history survives.
adoptDoc(name, doc) {
  if (!isModuleName(name) || this.files[name]) return false;   // same validation + collision refusal as add()
  this.files[name] = doc;                                       // ADOPT (not `new CodeMirror.Doc`)
  this.order.push(name);
  this.active = name;                                           // it's now the active file
  return true;
}
```

Promotion flow, triggered on the **first** `change` of a preview Doc:

1. A dedicated `change` listener (separate from `armLint`) checks: is `previewExample` set AND is
   `editor.getDoc() === previewExample.doc`? If yes, this is the promoting edit.
2. Compute the target filename via the naming rule (§3.2) and collision rule (§3.3) →
   `finalName`.
3. `project.adoptDoc(finalName, previewExample.doc)` — the **exact** Doc the user is typing into
   becomes a real project file. Because it's the same Doc, the keystroke that triggered promotion and
   all undo history are intact (no re-create, no `setValue`).
4. Record the promotion link so reset (§4) and the `●` recompute (`recomputeModified` analogue) can
   find the source example:

   ```js
   // module-local: filename -> EXAMPLES key, for promoted examples.
   const exampleOf = Object.create(null);   // { "bouncy_balls.py": "Bouncy balls", ... }
   exampleOf[finalName] = previewExample.name;
   ```

5. Clear `previewExample = null` (it's now a real file, no longer a floating preview).
6. Set `project.setEntry`? **No** — a promoted example does not steal entry. But if the project was
   single-file and this is now the only/active runnable file, Start already runs `editor.getValue()`
   (single-file path); see §7. Mark it modified, render both surfaces:
   - `renderTabs()` (index.html:2171 hook) now shows the promoted file as an Explorer row, carrying a
     `●` (new render token — §3.4).
   - `renderExamplesPanel()` re-renders the Examples list so its matching row shows the `●` and (now)
     a "this example is your file" affordance.
7. `flushSave()` — the new file now participates in autosave/serialize like any project file.

> **Why a separate `change` listener, not folded into `armLint`:** `armLint` (1620-1632) is a
> single-purpose lazy-loader guard with an early-return on `lintArmed`. Promotion has different
> lifecycle (fires once per preview, must run even after lint is armed by a prior file's edits).
> Keep them as two independent `editor.on("change", …)` handlers; order doesn't matter (both are
> idempotent guards).

### 3.2 Naming rule (Q1)

The proto promotes to the file's *display* name. On the real engine the name must satisfy
`isModuleName` (index.html:1460-1463: `^([A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$`). Recommend a **fixed
table** mapping each `EXAMPLES` key to a canonical filename (deterministic, reviewable, avoids a
slugify edge case producing an invalid module name):

| `EXAMPLES` key (index.html) | Promoted filename |
|---|---|
| `"Swimming fish"` (454) | `swimming_fish.py` |
| `"Bouncy balls"` (627) | `bouncy_balls.py` |
| `"Arrow-key square"` (662) | `arrow_key_square.py` |
| `"Mouse painter"` (700) | `mouse_painter.py` |
| `"Starfield"` (727) | `starfield.py` |
| `"Snake"` (758) | `snake.py` |

(There are **6** examples, re-confirmed.) Implement as a constant `EXAMPLE_FILENAME` map alongside
`EXAMPLES`. A slugify fallback (`lowercase, non-word→_, collapse, strip, + ".py"`, validated against
`isModuleName`, fall back to `example.py` if it fails) can cover any future key, but the explicit
table is the source of truth for the current six.

### 3.3 Collision rule (Q2)

If `EXAMPLE_FILENAME[name]` (e.g. `bouncy_balls.py`) already exists in `project.files`:

- **Auto-suffix** to the first free `…-N.py`: `bouncy_balls-2.py`, `bouncy_balls-3.py`, … (note:
  `bouncy_balls-2.py` satisfies `isModuleName` — `\w` includes digits but the leaf still starts with
  a letter; the `-` is the problem → use `_2` not `-2` to stay identifier-safe:
  **`bouncy_balls_2.py`**). Compute by incrementing until `!project.files[candidate]`.
- Log a `sys` line (`logLine`, the existing console writer): *"That name was taken — saved your edit
  as bouncy_balls_2.py."* (Consistent with the upload-routing warn-and-suffix UX.)

**Why not reuse the existing file?** Adopting into an existing key would mean **overwriting a
different file's Doc** — the exact HARD invariant S4 must never violate (§8 (e)). **Why not block?**
Blocking the promote would strand the user's keystroke (they typed; nothing happened). Suffix
preserves the edit and the other file. Use `_N` (underscore) so the result is a valid module name.

> Open nuance for the orchestrator: should re-opening the *same* example after it was already
> promoted re-preview a *new* copy (→ a second `bouncy_balls_2.py` on edit) or jump to the existing
> promoted file? Recommend: **opening an example whose canonical file already exists and is still
> linked via `exampleOf` SELECTS that existing file** (no second preview) — so a student doesn't
> accidentally fork their own work. See §9 open questions.

### 3.4 The `●` modified token in `renderTabs`

`renderTabs` (index.html:2105-2170) emits `.tab.py` rows. Today a row carries `.active`, `.entry`,
`.running`. S4 adds a `●` when the file is a promoted+modified example. Two clean options:

- **(A)** add a `modified` set/flag the renderer consults, OR
- **(B)** derive it: a file is "modified vs its example" when `exampleOf[name]` exists AND
  `project.text(name) !== EXAMPLES[exampleOf[name]]`.

Recommend **(A) an explicit `modifiedExamples` Set** (cheap, no per-render string compare of full
example bodies) updated by `markModified`/`recompute`; the renderer adds
`<span class="moddot" data-tip="Modified">●</span>` (proto class `.moddot`, already styled in proto;
add the rule to `index.html` CSS — see §5) to the row when `modifiedExamples.has(f.path)`. Keep
`renderTabs` a zero-arg `window.renderTabs` hook (unchanged signature).

---

## 4. Reset-to-default (`↺`)

### 4.1 Trigger + confirm (Q5)

Each Examples list row that is **promoted+modified** shows a `↺` reset button (proto class `.reset`,
appears on row hover, lines 168-170 of the proto CSS). Clicking it:

1. `if (!confirm("Reset \"" + name + "\" to the original example? Your edits to this file will be lost.")) return;`
   — the **same native `confirm()`** used by every other destructive action in `index.html`
   (2343/2366/2428). (S4 does **not** introduce the styled modal; §0 Q5.)
2. On confirm, restore (§4.2).

### 4.2 Restore mechanism — a FRESH Doc (Q3)

Restore replaces the promoted file's Doc with a **fresh** Doc built from the immutable
`EXAMPLES[name]`:

```js
function resetExampleFile(fileName) {
  const exName = exampleOf[fileName];
  if (!exName) return;
  const fresh = new CodeMirror.Doc(EXAMPLES[exName], "python");   // FRESH Doc = FRESH undo stack
  project.files[fileName] = fresh;                                // replace the Doc in-place (key unchanged)
  if (project.active === fileName) editor.swapDoc(fresh);         // re-show it (swapDoc, never setValue)
  modifiedExamples.delete(fileName);                              // clears the ● (it now == EXAMPLES[exName])
  renderTabs(); renderExamplesPanel(); flushSave();
}
```

- **Fresh Doc → fresh undo.** This is the decision-context-map's stated behavior ("re-load
  `EXAMPLES[name]` (fresh Doc = fresh undo)"). Reset is **not** itself undoable by `⌘Z` (the new Doc
  has an empty undo stack). **Recommended (Q3): clean reset.** The alternative (proto's "snapshot the
  current body first so reset is undoable") means keeping the old body in a redo-able stash and a
  two-layer undo model — more code and a confusing "undo my reset" gesture that most users won't
  expect. The shared `confirm()` already guards against accidental loss; clean reset is the simpler,
  honest model. (If the orchestrator wants reset-undoable, the snapshot-first variant is a small
  addition: stash `project.text(fileName)` before swapping and offer a one-shot "Undo reset" — but
  default is clean.)
- **Key unchanged.** Reset replaces the **value** of `project.files[fileName]`, never the key, so
  order/entry/active and every other file are untouched.
- **`●` cleared** because the file body now equals `EXAMPLES[name]` again.

> Note: replacing `project.files[fileName]` directly (not via a model method) is acceptable because
> the contract (a name→Doc map) is preserved and no other invariant (order/entry/active) changes. If
> the reviewer prefers a method, add `project.replaceDoc(name, doc)` symmetric with `adoptDoc`.

---

## 5. Per-file undo (confirm — free)

The decision-context-map and the project model already guarantee this: `project.files` is a
`name → CodeMirror.Doc` map (index.html:1476, docs created at 1503/1514), and **each
`CodeMirror.Doc` carries its own undo/redo history.** `setActive`/`swapDoc` swap the active doc, so
`⌘Z` (CM's built-in) always operates on the currently-shown file's own history.

S4's only obligation is **never to destroy a Doc**:
- Open uses `swapDoc` into a Doc (preview or real) — never `setValue`.
- Promote **adopts** the live preview Doc (`adoptDoc`) — does **not** re-create it, so the undo
  history built up to the promoting keystroke survives.
- Reset deliberately **does** create a fresh Doc (that's the point — a clean default with a clean
  undo stack).

No new undo machinery is written. The proto's hand-rolled `f.undo[]/f.redo[]` arrays
(proto lines 818-869) are **not** ported — they were a stand-in for CM's native per-Doc undo, which
the real engine already provides.

> **CSS to add to `index.html`** (the proto has these; `index.html` only has the inert `.exrow`
> base at 187-189). Add additively: `.exrow:hover{background:…}`, `.exrow.sel{…}`,
> `.exrow .moddot{color:var(--accent);…}`, `.exrow .reset{opacity:0;…}` +
> `.exrow:hover .reset{opacity:1}`, and a `.tab .moddot{…}` for the Explorer row dot. Reuse existing
> tokens (`--accent`, `--color-py-icon`, the row-hover token added in S1). No new raw colors.

---

## 6. Dead code removal

The new model makes the OLD destructive path dead. Remove (in lockstep with the new wiring):

| Dead seam (index.html) | Disposition |
|---|---|
| `let loadedExample = EXAMPLES[exampleSel.value];` (**2377**) | **Remove.** Only used by the old change handler + `loadInitialProject`'s default seed (2395). |
| `project.load({ files: { "main.py": loadedExample } });` in `loadInitialProject` (**2395**) | **Replace** the reference: the default-seed should read `EXAMPLES["Swimming fish"]` (or a named `DEFAULT_EXAMPLE` constant) directly, not the now-removed `loadedExample` var. Behavior identical (first example seeds a blank project), no `loadedExample` needed. |
| The legacy `#examples` `<select>` markup (**371**) + the populate loop (**1429-1434**) | **Remove (Q4).** No test references it; there is no `verify.mjs`. |
| `exampleSel.addEventListener("change", …)` destructive load-and-run handler (**2519-2531**) | **Remove.** This is the overwrite path the new model replaces. |
| The stale comment at **2516-2518** ("verify.mjs drives it…") | **Remove** with the select. |

**Re-confirmed test-safety:** `grep -rn "getElementById('examples')\|#examples\|dispatchEvent.*change"
test/` → **zero** hits on the legacy select; `ls test/verify.mjs` → **does not exist**. So dropping
the select is a clean deletion. `loadedExample` removal is internal. (Keep a `DEFAULT_EXAMPLE`
constant for the boot seed so `loadInitialProject` still seeds the same first example.)

> If the orchestrator prefers to **keep** the hidden `#examples` select as a defensive compat seam
> (Q4 = keep), it must be detached from the destructive handler (the handler is removed regardless);
> the select would then be a do-nothing element. Recommend **DROP** — there's nothing to be
> compatible with.

---

## 7. Running examples (confirm — no special-casing)

- **Preview (unpromoted) example:** while shown, `editor.getDoc()` is the preview Doc, and the
  single-file Start path runs `editor.getValue()` (index.html:2800: `start(editor.getValue())`). So
  pressing **▶ Start** on a previewed example runs exactly what's on screen — **no special-casing**;
  Start already runs "the open file" (S3). (If `project.isMulti()`, the project path runs
  `project.serialize().files` at 2804, which does NOT include the unpromoted preview — but a
  single-example project is single-file, so the single-file branch applies. The multi-file + preview
  combination is an edge case: recommend that pressing Start while previewing in a multi-file project
  promotes-then-runs, OR simply runs the preview as a one-off via the single-file path. Default: the
  preview shows over whatever project exists, and Start runs `editor.getValue()` when not multi; when
  multi, the example must be promoted first to be part of the run. Flag in §9.)
- **Promoted example:** it's an ordinary `project.files` entry. Start runs it via the normal S3 path
  (single-file: `editor.getValue()`; multi-file: it's in `serialize().files`, runs if it's the
  entry). The `runFile` highlight + `▶ running:` badge (index.html:2706-2737) work unchanged because
  it's a real file in `project.order`.
- **`▶ Start` visibility:** `renderViewer` already shows `runBtnEl` for `kind === "py"`
  (index.html:2039) and hides it otherwise. A previewed example is `.py`, so Start is visible. No
  change.

Confirmed: **no engine special-casing**. A previewed single-file example runs via the existing
single-file Start; a promoted example is a plain project file.

---

## 8. TDD test plan

A new battery **`test/examples.mjs`** (Playwright, same harness/style as `shell.mjs`/`multifile.mjs`:
`ok()`/`fail()` + `process.exitCode`, short per-assertion timeouts). Run:
`python3 -m http.server 8923` then `node test/examples.mjs http://localhost:8923/`.

> All assertions are engine-light (no game need run) and must not trip a lazy-loader except where a
> real edit legitimately arms lint. Use the real seams: `window.project`, `window.renderTabs`,
> `#examplesPanel .exrow`, `#tabs .tab[data-name]`, the CM instance.

### 8.1 New assertions (`test/examples.mjs`)

- **(a) Open shows content, lint UNARMED, no `setValue`, CM identity preserved.**
  Capture `cm0 = document.querySelector('.CodeMirror').CodeMirror`. Click an Examples row
  (`#examplesPanel .exrow` for, say, "Bouncy balls"). Assert: `editor.getValue()` ===
  `EXAMPLES["Bouncy balls"]` (exposed via a tiny read-only test hook, or compare the first line);
  `cm0 === document.querySelector('.CodeMirror').CodeMirror` (same instance, no recreate);
  `cm0.getOption('lint')` is **falsy** (lint not armed); the file is **NOT** yet in
  `window.project.files` (preview lives outside the project).

- **(b) First edit PROMOTES.** With "Bouncy balls" previewed, type a char (e.g.
  `cm0.replaceRange('\n', {line:0,ch:0})` or a Playwright keypress into the editor). Assert:
  `window.project.files["bouncy_balls.py"]` now exists; `window.project.order` includes it; the
  Explorer tree shows a `#tabs .tab[data-name="bouncy_balls.py"]` row carrying a `.moddot` (the `●`);
  the Examples row for "Bouncy balls" shows its `●`. Then assert **runnable**: with it the active
  single file, `await click('#runBtn')` reaches `status` `running` (or, lighter, assert
  `window.runFile()` becomes `"bouncy_balls.py"` — actually `project.active` for single-file —
  without requiring a full game). (Use the lightest reliable signal the harness supports; `shell.mjs`
  drives `setStatus` directly, but here we want the real Start path — gate on `#status` reaching
  `running`.)

- **(c) Per-file undo within that file only.** After promotion, the promoting keystroke is in the
  Doc's undo history. `cm0.undo()` (or `⌘Z`) reverts that file's content back toward
  `EXAMPLES["Bouncy balls"]`; assert the content changed and that a **different** file's content
  (seed `main.py` plus a second file) is **unchanged** by the undo. (Confirms undo is scoped to the
  active Doc.)

- **(d) Reset-to-default behind confirm restores the original (fresh undo).** Stub
  `window.confirm = () => true` (Playwright `page.evaluate` to override before the click, mirroring
  how other batteries auto-accept native confirms). Click the row's `.reset` (`↺`). Assert:
  `project.text("bouncy_balls.py") === EXAMPLES["Bouncy balls"]`; the `●` is gone from both the
  Examples row and the Explorer row; and `cm0.historySize().undo === 0` (fresh undo stack — proves a
  fresh Doc). Also assert a **cancel** path: `window.confirm = () => false`, edit, click `↺`, content
  unchanged.

- **(e) HARD invariant — opening/promoting an example NEVER overwrites a DIFFERENT existing file.**
  Seed a project with `main.py` (known sentinel content) + `enemy.py` (different sentinel). Open and
  **promote** an example (edit it). Assert `project.text("main.py")` and `project.text("enemy.py")`
  are **byte-identical** to their sentinels (the example became its own `*.py` Doc; no other Doc was
  touched). **Collision sub-case:** create a real `bouncy_balls.py` with sentinel content, then
  open+edit the "Bouncy balls" example; assert the example promoted to `bouncy_balls_2.py` (suffix)
  and the original `bouncy_balls.py` sentinel is **unchanged**.

- **(f) First-paint laziness.** After boot, **open the Examples panel and click an example
  (preview)** WITHOUT editing. Assert no heavy lib loaded: `window.__amLoaded` falsy,
  `typeof window.JSZip === 'undefined'`, `typeof window.Diff === 'undefined'`, and
  `cm0.getOption('lint')` falsy. (Opening + previewing arms nothing; only a real edit arms lint.)

### 8.2 `test/shell.mjs` reconciliation (lockstep — panel is no longer inert)

The current `shell.mjs` does **not** have a dedicated "examples panel is inert/read-only" assertion
(re-confirmed: it references examples only in the rail-views list and the laziness loop). So the
reconciliation is **surgical**, not a rewrite:

1. **Rail-views list (lines 52, 60, 69):** `'examples'` stays a rail view — **no change**.
2. **First-paint laziness loop (lines 390-402):** it opens `['history','examples','collab']` and
   asserts lint stays falsy. **This must STAY GREEN** — opening the Examples *panel* (not editing an
   example) still arms nothing, because rendering rows and even building a preview Doc uses `swapDoc`,
   not `setValue`. **Keep as-is.** *Caveat to honor in impl:* `renderExamplesPanel` must not, on
   render, open any example (no auto-`swapDoc` at panel-open) — the laziness loop would still pass
   because `swapDoc` doesn't arm lint, but to keep the *intent* (panel-open touches nothing), the
   panel must only render rows, never preview until a click.
3. **The panel-note (index.html:369)** "Read-only in this build — full editable examples are
   coming." must change to the proto's note: **"Open one to edit & run — editing makes it your
   file."** No `shell.mjs` assertion gates the note text today, so this is a copy change only — but
   if any assertion is added that reads the note, update it in lockstep.

> **No `shell.mjs` assertion needs to flip from pass→fail.** The S1 inert-examples behavior was never
> encoded as an explicit "must be inert" assertion in `shell.mjs` (it was an *implementation choice*,
> Q4 of S1, asserted only indirectly via the laziness loop, which S4 keeps passing). The new
> interactive behavior is covered by the **new** `test/examples.mjs`. This satisfies "reconcile in
> lockstep without weakening coverage" — coverage strictly increases.

### 8.3 Guardrails (must stay green, no change)

`test/multifile.mjs`, `test/lint.mjs`, `test/assets.mjs`, `test/history.mjs`, `test/save.mjs`,
`test/explorer-tree.mjs`, `test/subdirs.mjs`, `test/runmodel.mjs`, `test/collab.mjs`, and the spikes
must pass unchanged — none reference the examples select or panel beyond the rail view (which is
preserved). The promote path reuses `project.add`-style validation + `renderTabs`/`flushSave`, so the
explorer/multifile/save contracts are untouched.

---

## 9. Seam preservation, landmines, risks & open questions

### 9.1 Seams preserved

- **The single CodeMirror** — one instance for the session; open/preview/promote/reset all use
  `swapDoc` (1509/1511 pattern), never `CodeMirror.fromTextArea` a second time, never destroy.
- **No `editor.setValue`, ever** (landmine b). Every editor-touching path in S4 uses `swapDoc` /
  `adoptDoc` (which doesn't touch the editor's text directly — the Doc is already the active doc) /
  fresh-Doc-then-`swapDoc` (reset). The only `editor.setValue` in `index.html` is the collab
  remote-apply at 3000, which S4 does not touch.
- **Lazy-load invariants** (landmine c) — opening + previewing arms **nothing**; lint arms only on a
  real edit (which also promotes). JSZip/Automerge/jsdiff are never touched by S4.
- **`EXAMPLES` immutable** — used as the source for preview (`new Doc(EXAMPLES[name])`), reset (fresh
  `new Doc(EXAMPLES[name])`), and the default boot seed. **Never mutated.** (Risk: a careless impl
  that did `project.files[name] = ... EXAMPLES[name] ...` by reference is fine because strings are
  immutable in JS — but never assign a Doc *into* `EXAMPLES`.)
- **`window.project` / `window.renderTabs` / `window.__flushSave` / `window.runFile`** — shapes
  unchanged; `adoptDoc` is an **additive** method.
- **`#examplesPanel`** id preserved (1's panel body); rows keep `.exrow`/`.nm`/`.ic`, gain
  `.moddot`/`.reset`.

### 9.2 Open questions for the orchestrator

1. **Naming/collision on promote (Q1+Q2).** Confirm the fixed `EXAMPLE_FILENAME` table (§3.2) and
   the **underscore** auto-suffix `bouncy_balls_2.py` (NOT `-2`, which fails `isModuleName`) on
   collision (§3.3). And confirm the re-open-an-already-promoted-example behavior: **select the
   existing file** rather than spawning a second preview/copy (§3.3 nuance). *Recommended as written.*

2. **Reset undoability (Q3).** Confirm **clean reset** (fresh Doc, reset not `⌘Z`-undoable; the
   `confirm()` is the safety). The proto's snapshot-first "undo your reset" is the alternative.
   *Recommend clean.*

3. **Legacy `#examples` select (Q4).** Confirm **DROP** the select + its populate loop + the
   destructive change handler + `loadedExample` (§6). Re-confirmed test-safe (no references, no
   `verify.mjs`). *Recommend drop.*

4. **Confirm component (Q5).** Confirm S4 uses the existing **native `confirm()`** for the reset
   dialog (matches index.html's other destructive actions); the styled `.scrim`/`.dialog` modal is a
   separate slice. *Recommend native confirm.*

5. **Preview + Start in a MULTI-FILE project (§7 edge).** When a multi-file project exists and the
   user previews an example then presses Start: the single-file Start branch won't fire (project is
   multi), and the unpromoted preview isn't in `serialize().files`. Options: (a) Start auto-promotes
   the preview first, then runs; (b) Start of a preview always runs it standalone via the single-file
   path regardless of project multiplicity; (c) Start is disabled/ignored for an unpromoted preview
   in a multi-file project (must edit to promote first). *Recommend (a) auto-promote-then-run* — it
   matches "editing makes it your file" and avoids a surprising no-op. Needs a verdict before build.

6. **`adoptDoc` vs `replaceDoc` as model methods.** S4 adds `adoptDoc` (promote) and does reset via a
   direct `project.files[name] = fresh` assignment. If the reviewer wants symmetry, add
   `project.replaceDoc(name, doc)` for reset too. *Cosmetic; recommend `adoptDoc` + direct assign,
   add `replaceDoc` only if review asks.*

### 9.3 Residual risks

- **The promoting `change` listener must fire before/independently of `armLint`.** Both are
  `editor.on("change", …)`. Promotion guards on `previewExample && editor.getDoc() === previewExample.doc`
  and clears `previewExample` after — idempotent. `armLint` guards on `lintArmed`. No ordering
  dependency, but the impl must register the promote listener so a previewed example's first edit is
  caught (register at the same place `armLint` is wired, 1633).
- **Autosave during preview.** The autosave `change` listener (2410) sets `dirty` and debounces
  `flushSave`. During a preview edit, `flushSave` runs **after** promotion has added the file to
  `project.files`, so it serializes correctly. But if the debounce fired *between* the keystroke and
  promotion, `serialize()` wouldn't see the preview — promotion is synchronous within the same
  `change` tick, so it completes before the 400ms debounce; no race in practice. Worth a comment.
- **`isModuleName` on the suffix.** `bouncy_balls_2.py` passes; `bouncy_balls-2.py` does **not**
  (hyphen) — the impl MUST use `_N`. Covered by test (e) collision sub-case.

---

## 10. Summary (one-paragraph recap)

S4 makes the Examples rail panel **editable, runnable, promote-on-edit files** over the **one**
CodeMirror, with **zero `editor.setValue`**: clicking an example builds a preview `CodeMirror.Doc`
from the immutable `EXAMPLES[name]` and `swapDoc`s it in (lint stays unarmed, the Doc is **outside**
`project.files`); the **first edit adopts that exact Doc** into `project.files` via a new additive
`project.adoptDoc(name, doc)` (preserving the keystroke + undo history — never re-created), names it
from a fixed `EXAMPLE_FILENAME` table with underscore auto-suffix on collision, and shows a `●` in
both the Examples list and the Explorer tree; **reset (`↺`)** behind the existing native `confirm()`
swaps in a **fresh** Doc from `EXAMPLES[name]` (fresh undo, clears the `●`); **per-file undo is free**
(each Doc owns its history). The old destructive `#examples` `change` handler + `loadedExample` + the
hidden `<select>` are **removed** (test-safe — no references, no `verify.mjs`); a previewed example
runs via the existing single-file Start and a promoted example is an ordinary project file (no engine
special-casing). A new **`test/examples.mjs`** covers open/promote/per-file-undo/reset/the
no-overwrite HARD invariant/first-paint laziness; **`test/shell.mjs`** needs only the panel-note copy
change and keeps its laziness loop green (coverage strictly increases).

**Doc path:** `docs/specs/2026-06-23-examples-promote-design.md`
