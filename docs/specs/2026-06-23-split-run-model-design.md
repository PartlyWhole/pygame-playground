# Slice S3 — Split run model — DESIGN (2026-06-23)

> Design only. **No implementation, no code changes, no commit.** Branch `redesign`.
> Built by reading the de-risk findings (§2 pause/resume), the decision context map (run-model),
> the direction-team Iteration Log, the proto shots, and the **current** `index.html` wiring.
> All line numbers below were re-confirmed against `index.html` on the `redesign` branch
> (S1 chrome + S2a `PROJECT_PY` engine already applied — the line refs in the older docs have
> shifted; the numbers here are the live ones).

---

## 0.1 Orchestrator resolutions (settles the open questions — binding for implementation)

- **Q1 — Multi-file Start → Start runs the PROJECT (its current `entry`); for a single-file project or
  an example the open file IS the entry, so Start runs it.** This keeps today's `run()` dispatch
  UNCHANGED (`collab.active || !isMulti()` → `_start(editor.getValue())`; else
  `_start_project(serialize().files, entry)`) — NO net-new dispatch, zero risk to `multifile`/`subdirs`.
  The editor is independent (browse any file while the entry runs); the `▶ running: <file>` badge shows
  the running **entry**. To run a DIFFERENT file as the program, use the existing **set-as-entry**
  affordance (`tabMenu`). Rationale: the Iteration Log's "runs the open file" is honored literally for
  single-file + examples; for a multi-file project the only sensible program is the entry (running a
  library module standalone errors). FLAGGED for the user to override on review if they want per-file
  standalone runs.
- **Q2 — End control → restyle `#stopBtn` to `✕` (keep its id + `_stop()` listener); drop the reserved
  `#endBtn`.** Pause/End show only while a task is live.
- **Q3 — Paused color → retarget `--color-status-paused` from `--accent` to `--warn` (#f0a45d)** (paused
  visually distinct from running), per de-risk §2.
- **Q4 — Disabled-Start while live → a VISIBLE disabled affordance** (disabled attr/class + a tooltip
  like "stop or end the running program first"), NOT `display:none` (`shell.mjs` probes `#runBtn`
  visibility for `.py`; keep it visible, just disabled) and NOT a silent no-op.
- **Fold-in (deferred S2b Minor):** add `closedFolders.clear()` on `project.load` (S3 touches
  `index.html` anyway) so collapsed-folder state from a prior project doesn't leak across a load.

---

## 0. Where we already are (live `index.html`, redesign branch)

S1 + S2a already landed the seams S3 needs. **S3 is mostly activation + ~5 lines of Python**, not net-new chrome:

- **`#pauseBtn` already exists, reserved inert** — `index.html:406`
  `<button id="pauseBtn" class="btn" aria-label="Pause program" hidden>⏸ Pause</button>`, with a
  CSS guard `#pauseBtn[hidden], #endBtn[hidden] { display:none !important; }` (index.html:41) so the
  `.btn`'s own `display` can't beat the `hidden` attribute. There is also a reserved `#endBtn`
  (`✕`, index.html:407) — a chev-style end button next to the always-visible `#stopBtn`.
- **`#stopBtn` is the kept End target**, deliberately NOT in the hidden list (index.html:39-40 comment),
  always laid out, listener calls `_stop()` (index.html:2738-2740).
- **`#runBtn` = `▶ Start`** (index.html:389), listener → `run()` (index.html:2737).
- **`runBtnEl` already hides for non-`.py` files** — `renderViewer` sets `runBtnEl.style.display=""`
  for `.py` (index.html:1995) and `"none"` for image/audio/other (index.html:2003). `shell.mjs:173-186`
  already asserts this.
- **`.pill.paused` CSS already present** (index.html:86) using `--color-status-paused` (index.html:28,
  currently aliased to `--accent`; derisk §2 calls for `--warn` #f0a45d — see §3 note).
- **`setStatus(cls, text)`** is the single status writer (index.html:1367); the only writer the
  batteries gate (`shell.mjs:121-146`).
- **`run()`** dispatch (index.html:2699-2727): `collab.active || !project.isMulti()` →
  `_start(editor.getValue())`; else `_start_project(project.serialize().files, project.entry)`.
- **`runTask`** is a module-scope JS var (index.html:2657, set at 2717) — the live-task handle.
- **`window.renderTabs`** (index.html:2127) + **`window.project`** (index.html:1549) test seams exist.
- **Python engine** — `_state` (820), shared `__yield__` (873), `_run(src)` (990), `_start(src)` (1013),
  `_stop()` (1019); `PROJECT_PY` adds `_run_project(files, entry)` (~1262) + `_start_project` (1329),
  whose `glb` wires the **same** `__yield__` (1307). The AST transform appends `await __yield__()` to
  every while-body for BOTH engines, so one gate at the top of `__yield__` covers both.

The spike (`test/spike-pause.{html,mjs}`, GREEN both flavors) proves the exact recipe below.

---

## 1. Scope + non-goals

**In scope (S3):**
1. Pause/Resume **engine wiring** (Python) — the derisk §2 `_pause_gate` recipe, composing with both
   `_run` and `_run_project`.
2. The split run-model **UI**: editor `▶ Start` (already there), stage `⏸ Pause ⇄ ▶ Resume` (activate
   `#pauseBtn`) + `✕ End` (kept `#stopBtn` / reserved `#endBtn`), shown **only while a task is live**.
3. The **`▶ running: <file>` / `⏸ paused: <file>` badge** on the stage; click jumps the editor/viewer
   to the running file.
4. **Explorer highlight** of the running file (a class on its `.tab[data-name]` row).
5. **Editor ↔ program independence** (browse/edit other files while running; the run snapshots files
   at Start).
6. **Re-run semantics**: Start allowed iff no live task; blocked while running OR paused; a fresh Start
   clears console + captures a history snapshot (as today).
7. The additive `'paused'` **status token**.
8. A new TDD battery `test/runmodel.mjs` + reconciliation of existing assertions.

**Out of scope (deferred):**
- Examples-as-runnable-files (**S4** — `examples-promote-semantics`). S3 must not assume examples are
  already promoted; it just runs whatever `.py` is open.
- Collab multi-file room (**S6**), save/always-zip (**S5**), upload routing.
- `⌘/Ctrl-Enter` shortcut (LOCKED: **dropped** — decision context map; do not re-home it onto Start).
- Pane resize/collapse, fullscreen plumbing (chrome already in S1; S3 doesn't touch it).

---

## 2. Engine wiring (Python) — straight from derisk §2

All additions go in **`BOOT_PY`**, near `_state` (index.html:820) and `__yield__` (index.html:873).
Nothing is added to `PROJECT_PY` — it reuses `BOOT_PY`'s `__yield__`/`_state`/`_stop`.

### 2.1 The gate (after `_state`, ~821)
```python
_pause_gate = asyncio.Event()
_pause_gate.set()              # created ALREADY-SET -> unpaused path is a cheap no-op
_state["paused"] = False
```

### 2.2 The one new line in `__yield__` (the FIRST line, ~874)
```python
async def __yield__():
    await _pause_gate.wait()   # +PAUSE: blocks here only while cleared (paused); else returns instantly
    d, ticked, flipped = _state["delay"], _state["ticked"], _state["flipped"]
    ...                        # rest unchanged
```
This is the **single chokepoint**. Both `_run` (single-file, glb at 991) and `_run_project` (glb at
1307) bind this same `__yield__`, and the transform appends `await __yield__()` to every loop in both —
so the gate covers single-file AND project loops with zero per-engine change. **Composes with S2a:**
`PROJECT_PY`'s wrapper/native-import path leaves `__yield__` structurally unchanged (it only changes how
modules are *resolved/transformed*, not the yield primitive), so the gate sits at its top regardless of
how the entry coroutine was produced.

### 2.3 The controls (additive; do NOT touch `_state['task']` — pause ≠ stop)
```python
def _pause():
    if _state["task"] and not _state["task"].done():
        _pause_gate.clear()
        _state["paused"] = True
        return True
    return False

def _resume():
    if _state["paused"]:
        _pause_gate.set()
        _state["paused"] = False
        return True
    return False
```
`_pause()` guards on a live task (no-op if nothing is running / already finished). `_resume()` guards on
the paused flag.

### 2.4 Defensive resets (so a stale pause never wedges a fresh/cancelled task behind the gate)
- **`_start` (index.html:1013-1017):** in the existing `_state.update(...)` add `paused=False`, and add
  `_pause_gate.set()` before scheduling the task.
- **`_start_project` (index.html:1329-1333):** same — add `paused=False` to its `_state.update(...)`
  and `_pause_gate.set()`.
- **`_stop` (index.html:1019-1024):** after `t.cancel()`, add `_pause_gate.set()` and
  `_state["paused"] = False` — otherwise a task cancelled WHILE paused stays suspended behind the gate
  and never reaches its `CancelledError`.

This is verbatim the GREEN recipe in `test/spike-pause.html:71-136`. **Total Python delta: ~12 lines,
all additive**; `_run`/`_run_project`/`_transform` bodies are otherwise untouched.

### Granularity caveat (carry into UI copy / tests)
Pause is per-cooperative-frame: a frame-paced loop pauses within one frame; a pure-compute loop yields
only every 256 iters (so pause can lag up to 256 iterations); a no-loop program never yields but finishes
instantly (nothing to pause). Acceptable — surfaced here so the test uses a frame-paced program.

---

## 3. DOM / seam mapping

| Action | Element | id | State | Wiring |
|---|---|---|---|---|
| Start / restart | editor header button | `#runBtn` (exists, 389) | shown for `.py` open files; **hidden** for image/audio/other (already 1995/2003); disabled-look while a task is live (see §6) | → `run()` (2737) |
| Pause ⇄ Resume | stage button | `#pauseBtn` (exists inert, 406) | shown ONLY while a task is live; label/icon toggles `⏸ Pause` ⇄ `▶ Resume` | new listener toggles `_pause()`/`_resume()` + `setStatus('paused'…)`/`setStatus('running'…)` |
| End | stage button | `#stopBtn` (kept, 410) **and/or** `#endBtn` (reserved, 407) | `#stopBtn` stays the kept click target; per proto the visible "end" is a small `✕` | → `_stop()` (2738-2740, unchanged) |
| Running badge | stage header text | NEW `#runFileBadge` | shown only while live; `▶ running: <file>` / `⏸ paused: <file>`; click → jump | reads the running-file seam (§5) |

### Decisions / clarifications
- **`#stopBtn` vs `#endBtn`.** The proto shows the end control as a small `✕` (matches `#endBtn`,
  407). But ~50 test sites + `spike-runstop.mjs`/`verify.mjs` click **`#stopBtn`**, and `#stopBtn` is
  deliberately kept visible (index.html:39-40). **Recommendation:** keep `#stopBtn` as the real End
  target and **style it as the `✕`** (or visually swap `#stopBtn`↔`#endBtn` but keep the `#stopBtn`
  listener live and the element present + clickable while running). Do NOT remove `#stopBtn`. If
  `#endBtn` becomes the visual end, wire BOTH to `_stop()` so either click works; simplest is to drop
  `#endBtn` and just restyle `#stopBtn`. **Open sub-question for the orchestrator: keep `#stopBtn`
  visually as `■ Stop` or restyle to `✕`? Either is test-safe as long as `#stopBtn` stays present +
  clickable while running.**
- **Visibility gating.** Pause + End shown **only while a task is live** (running OR paused). At
  ready/finished/stopped they are hidden. `#stopBtn` currently is *always* visible — changing it to
  while-running-only is the one visibility change; reconciled in §7 (the existing clicks happen WHILE
  running, so they still pass).
- **Start hidden for non-runnable files** — already implemented (1995/2003); S3 keeps it.
- **`'paused'` status token is ADDITIVE.** `setStatus('paused','paused')` writes a new token value;
  do NOT reword `running`/`finished`/`stopped`/`error`/`boot`. The batteries gate exact strings of the
  *existing* tokens, so a new value is safe (`spike-pause.mjs:114-122` already proves the full set
  `running/finished/stopped/error/paused` coexists).
- **Status color.** `.pill.paused` exists (86) on `--color-status-paused`. Derisk §2 specifies
  **`--warn` (#f0a45d)**. **Recommendation:** retarget `--color-status-paused` from `--accent` to
  `--warn` so paused reads as a distinct "held" state, not "running-green." Trivial one-token edit.
- **Preserve ~50 test sites.** `#runBtn`/`#stopBtn` ids + listeners unchanged; only `#pauseBtn` gains a
  listener (no battery gates it yet) and `#runFileBadge` is net-new.

---

## 4. THE KEY DESIGN QUESTION — "Start runs the open file" for a MULTI-FILE project

**The conflict.** The LOCKED direction says editor `▶ Start` "runs/restarts the **currently-open
file**." But today `run()` dispatches by `project.isMulti()`: single-file → `_start(editor.getValue())`;
multi-file → `_start_project(files, project.entry)` — i.e. a multi-file project **always runs
`project.entry`, ignoring which file is open**. And the proto `run-indicator.png` *visualizes the
conflict*: the editor shows `enemy.py` open while the stage runs `main.py` — so "Start runs the open
file" and "running ≠ open file" are both shown on the same screen. Running a non-entry **library** module
(`sprites/enemy.py`, a `from sprites import ...` consumer with no `if __name__=="__main__"`) standalone
is usually wrong — it errors or does nothing.

### Options

**(a) Start always runs the PROJECT via its entry** (ignore which file is open).
*Pros:* simplest; exactly today's multi-file semantics; a library module run alone never errors; the
badge always shows the entry (truthful: "this is the program that's running"). *Cons:* contradicts the
literal words "runs the open file"; a learner editing `enemy.py` and hitting Start sees `main.py` run,
which can confuse ("why didn't MY file run?"). Mitigated by the badge clearly showing `▶ running:
main.py` and by Start's tooltip ("Runs the project (entry: main.py)").

**(b) Start runs the OPEN file as the program** — `_start(project.text(openFile))`, single-file engine,
even in a multi-file project.
*Pros:* matches the words exactly; lets you run any file standalone. *Cons:* a library module run via the
single-file engine has no package resolution for its siblings → `ImportError`/no-op for the common case;
breaks the "one project, one entry" mental model; the single-file engine wouldn't write sibling modules
to MEMFS, so intra-project imports fail. High footgun for exactly the multi-file projects S2a just
enabled.

**(c) Hybrid — Start runs the open file when it's a "program," else runs the project entry.**
Concretely: if the project is single-file OR the open `.py` IS `project.entry` → run it as the program
(today's path); if the open file is a **non-entry** module in a multi-file project → run the **project
via its entry** (option-a behavior for that case), and surface this clearly (badge shows the entry; Start
tooltip: "Runs <entry> (open file is a module of the project)"). Optionally pair with an explorer
"Set as entry point" action (the `entry` model field already exists, 1438) so a user who *wants* a
different file to be the program can promote it, then Start runs it. For single-file projects + examples,
all options collapse to "run the file."

### RECOMMENDATION → **(c) hybrid**, with the open file run as program **only when it is the entry or
the project is single-file**, otherwise run the project entry.

Rationale:
- Honors the words in the common cases people actually mean (single-file, examples, and "I'm editing the
  entry") — those are "run the open file."
- Avoids the option-b footgun: a learner who hits Start while a *library* module is open gets a working
  program (the entry), not an `ImportError`. The badge makes "running: main.py" unambiguous, so it's
  honest rather than surprising.
- It is a **superset of today's behavior** (multi-file still runs the entry), so the existing multi-file
  battery (`multifile.mjs`, `subdirs.mjs` — all click `#runBtn` expecting the entry to run) keeps
  passing **unchanged**.
- Net-new dispatch is small: `run()` already branches on `isMulti()`; the only addition is "if the open
  `.py` is not the entry, still run the project entry" (which is what it does today) **plus** the
  optional set-entry affordance as a fast-follow.

This stays an **OPEN QUESTION flagged for the orchestrator** because it is a product call (literal words
vs least-surprise). My recommendation is (c); the cheapest also-defensible fallback is (a) (pure "run the
project entry" for any multi-file project — even simpler, zero new dispatch, just adjust the Start
tooltip + always show the entry in the badge). **Avoid (b).** The set-entry-and-run affordance can be a
separate slice if wanted.

---

## 5. Running-file badge + explorer highlight + independence

### 5.1 The seam: a window-readable running-file path + a render hook
Add a module-scope JS value alongside `runTask` (index.html:2657), e.g.:
```js
let runFile = null;              // the file path the LIVE program is running (entry or open file per §4)
window.runFile = () => runFile;  // test seam (mirrors window.project / window.renderTabs)
```
- Set in `run()` at Start, AFTER §4 decides what runs: `runFile = (single-file or open-is-entry) ?
  project.active : project.entry;` (or just `project.entry` for multi-file under option-c).
- Clear it (`runFile = null`) in the task `.then(...)`/`.catch(...)` settle (index.html:2719-2726) when
  `runTask === task` — i.e. when the program finishes/stops/errors — and on End.
- Pause/Resume do NOT change `runFile` (the program is still that file, just held).

### 5.2 The badge (`#runFileBadge`, new, in the stage `.pane-head`)
A small button: `▶ running: <basename(runFile)>` while running, `⏸ paused: <basename(runFile)>` while
paused, hidden otherwise. Reuse the existing `stageHint` slot pattern (index.html:403 `#stageHint`
"press start to run" — hide it while live, show the badge). Click handler:
```js
runFileBadge.onclick = () => { if (runFile) { renderViewer(runFile); /* jumps editor/viewer to it */ } };
```
`renderViewer(name)` (index.html:1985) already does the type-aware swap (`.py` → `setActive`/`swapDoc`,
never `setValue`) and updates the explorer selection via `viewerSel`.

### 5.3 Explorer highlight
Add a class (e.g. `.running`) to the running file's row in `renderTabs` (the `.tab[data-name]` builder,
index.html:2115). Compute it the same way `active`/`entry` are: pass `runFile` into the row template and
add `${f.path === runFileNow ? " running" : ""}`. Add a CSS rule `.tab.running { ... }` (e.g. a left
accent bar / `--accent` tint, distinct from `.active`'s selection bg). **`renderTabs()` must be called
when `runFile` changes** (at Start, and at settle/End) so the highlight tracks the run. Because
`renderTabs` is the single row builder and `runFile` is module-scope, this is a one-line read inside the
existing loop + one extra `renderTabs()` call at the two transition points.

### 5.4 Independence (the snapshot invariant)
The program already runs off a **snapshot taken at Start**: single-file passes `editor.getValue()` by
value (2709); project passes `project.serialize().files` (2713), which reads each Doc's text at that
instant. So later edits to ANY file (the running one included) do NOT affect the live program until the
next Start — this is already true; S3 just **documents and tests** it. The editor is free to
`renderViewer`/`setActive` to any other file while the program runs (no coupling between `viewerSel`/
`project.active` and `runFile`). Pause/Resume operate on the already-snapshotted, already-scheduled task,
so editing during a pause likewise has no effect until re-Start.

---

## 6. Re-run semantics

- **Start allowed iff no live `_state['task']`** — i.e. status is ready/finished/stopped (task `done()`
  or `None`). **Blocked while running OR paused** (a paused task is alive: `not done()`), so the same
  guard covers both — exactly the derisk §2 / `spike-pause` note ("paused task is alive → Start stays
  blocked"; resume or End first).
  - Implementation: at the top of `run()`, read the live signal
    `pyodide.runPython("_state['task'] is not None and not _state['task'].done()")` (the same expression
    `spike-runstop.mjs:49` reads) and **early-return** if live. Reflect it visually: while live, give
    `#runBtn` a disabled look (`disabled` attr or a `.is-running` class) and tooltip "Stop or pause+stop
    to re-run." This is additive — today `run()` stop-and-restarts; the new guard makes Start a true
    no-op while live (matches the locked model). NOTE: keep the guard a *runtime* check, not removal of
    the listener, so `#runBtn` stays a clickable test target.
- **A fresh Start** keeps today's two side effects (index.html:2701-2702): `clearConsole()` and
  `captureSnapshot()` (history). It also replaces the frozen last frame (the new program draws over it).
- **End (`_stop`)** leaves the last frame on the canvas (cancel doesn't clear it — proven by
  `spike-runstop.mjs:69-76`) and leaves the console intact (`clearConsole` only runs on Start, not Stop
  — `spike-runstop.mjs:78-83`). Sets status `stopped`. After End, `runFile=null`, badge hidden,
  Pause/End hidden, explorer highlight cleared.
- **Pause** freezes the last frame (gate suspends at the frame boundary; canvas pixel stable — proven
  `spike-pause`), task stays alive, status `paused`. **Resume** continues from the exact state, status
  `running`. Neither clears the console nor takes a snapshot.

---

## 7. TDD test plan

### New battery: `test/runmodel.mjs`
Use a **frame-paced** program (draws every loop + `clock.tick(60)`) so pause lands within a frame
(avoid the 256-iter compute-loop lag). Model it on `spike-pause.mjs` + `spike-runstop.mjs` harness.

1. **Start runs the open file (single-file/example):** set a known program, click `#runBtn`, assert
   status `running`, canvas shows the known frame, `window.runFile()` === the open file.
2. **Start + multi-file (gated on the §4 decision):** under recommended (c), load a 2-file project where
   `main.py` (entry) draws RED and an open non-entry `lib.py`; click `#runBtn`; assert the **entry** ran
   (RED frame), `runFile === project.entry`, and the badge reads `running: main.py` even though `lib.py`
   is open. (If the orchestrator picks (a), same assertion. If (b), invert — flag in the test.)
3. **Pause freezes:** click `#pauseBtn`; assert status `paused`, `_state['paused']` True, task **alive**
   (`not done()`), and the canvas pixel is identical after a 700ms wait (frozen over a window — the
   `spike-pause` freeze check).
4. **Resume continues:** click `#pauseBtn` again (toggle); assert status `running`, `_state['paused']`
   False, the animation advances (a moving pixel changes) — state preserved (counter continued, not
   reset).
5. **End keeps frame + console:** while running, click `#stopBtn`; assert status `stopped`, last frame
   stays + frozen (`spike-runstop` pixel check), printed marker survives in `#console`, `runFile===null`,
   badge hidden, Pause/End hidden.
6. **Re-run after finish works:** run a program that finishes; assert status `finished`/`stopped`, then
   click `#runBtn` again → status `running` and console was cleared (fresh-Start semantics).
7. **Start blocked while running AND while paused:** while running, click `#runBtn` → no new run (task
   identity unchanged / console NOT re-cleared / no extra snapshot); pause, click `#runBtn` → still no
   new run; the live-task signal is the guard.
8. **Badge shows + click jumps + explorer highlight:** while running, assert `#runFileBadge` visible and
   text matches `runFile`; click it → editor/viewer shows `runFile` (vName updates); assert the running
   file's `.tab[data-name]` row has the `.running` class and no other row does.
9. **Editor independence:** while running, `renderViewer`/edit a DIFFERENT file (and/or edit the running
   file's Doc); assert the live program's output is unchanged (same animation) — proving the run uses the
   Start-time snapshot, not live edits.
10. **No JS console errors** across the battery (mirror `spike-runstop.mjs:105-107`).

### Existing assertions to reconcile / keep GREEN
- **`spike-runstop.mjs`** — clicks `#runBtn` (42) then `#stopBtn` (64) **WHILE running** (after the
  program reached `running`), so changing `#stopBtn` to while-running-only visibility is **safe**; its
  re-run-after-stop check (98-103) matches §6. ✅ no change needed. (If End is restyled to `✕`, keep the
  `#stopBtn` element + listener so this still resolves.)
- **`verify.mjs`** — clicks `#stopBtn`; confirm it does so WHILE running (same as spike-runstop). Keep
  `#stopBtn` present + clickable while live. ✅
- **`shell.mjs`** — (a) status check (121-146) gates exactly `running/error/boot/dim` + the `.pill`
  survival — `'paused'` is additive, won't break it; (b) `#runBtn` visible-for-`.py` / hidden-for-asset
  (173-186) — unchanged behavior; but **note:** the new "disabled-look while running" must NOT make
  `runBtnVisible()` (offsetParent/display check) return false for a `.py` file at rest — use `disabled`/
  a class, **not** `display:none`, for the running-disabled state, so 173-186 still see it laid out. ⚠
  reconcile by gating the *hidden* path strictly on file-kind, the *disabled* path on run-state.
- **`history.mjs`, `subdirs.mjs`, `multifile.mjs`, `assets.mjs`, `spike-assets.mjs`, `spike-bridge.mjs`**
  — all click `#runBtn` expecting a run to start (and multi-file ones expect the **entry** to run). The
  recommended option (c)/(a) keeps "multi-file runs the entry," so these pass unchanged. ⚠ If the
  orchestrator picks (b) they break — another reason to avoid (b).
- **`spike-pause.{html,mjs}`** — the living reference for the engine recipe; the new `runmodel.mjs`
  re-proves the same in-app. Keep the spike as-is.

Keep all 6 batteries + the named spikes GREEN.

---

## 8. Seam preservation + landmines

- **`#runBtn` / `#stopBtn` ids + listeners** — unchanged (preserve ~50 test sites). New `#pauseBtn`
  listener + `#runFileBadge` are additive.
- **Status tokens** — only ADD `'paused'`; never reword existing tokens. `setStatus` stays the single
  writer; preserve the `.pill` chrome class (shell.mjs:139-142).
- **Never `editor.setValue`** (landmine b) — the badge-jump uses `renderViewer`→`setActive`→`swapDoc`;
  any file switch goes through the project seam. No path in S3 introduces `setValue`.
- **Lazy-load invariants** (landmine c) — S3 touches neither JSZip nor Automerge; first-paint
  zero-network laziness is unaffected.
- **Disabled-while-running must not equal hidden** — keep `#runBtn` laid out (use `disabled`/class) so
  `shell.mjs` visibility probe still passes for `.py` at rest (see §7).
- **`_stop` defensive `_pause_gate.set()`** is REQUIRED — without it, End-while-paused wedges the task.
- **Run uses a Start-time snapshot** — independence is already true (run() reads values by-copy);
  document it so future edits to `run()` don't accidentally start reading live Docs.

### Risks / open questions for the orchestrator
1. **#4 — multi-file Start semantics (the product call).** Recommend **(c) hybrid** (open file runs as
   program iff it's the entry or single-file/example, else run the project entry), with **(a)** as the
   simplest defensible fallback and **(b) to avoid**. Optional fast-follow: an explorer "Set as entry
   point" affordance for users who genuinely want a different program file. **Needs a verdict.**
2. **End control styling — `■ Stop` vs `✕`.** Proto shows `✕`; tests require `#stopBtn` present +
   clickable. Recommend restyle `#stopBtn` to `✕` (keep id + listener), drop the reserved `#endBtn`. Cosmetic — confirm.
3. **Paused color token.** Recommend retargeting `--color-status-paused` from `--accent` to `--warn`
   (#f0a45d) per derisk §2 so paused ≠ running visually. Confirm.
4. **Disabled-Start affordance.** Confirm Start while-live should be a visible no-op (disabled look) vs
   silently ignored — recommend disabled look + tooltip for discoverability.
