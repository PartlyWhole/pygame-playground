# pygame-playground — Design System: Token Foundation

> **Status:** Token foundation for the UX/visual redesign. **Single source of truth** for
> colors, type, spacing, radius, and the layout-independent component primitives.
> **Documentation only — does not modify `index.html` or any app code.**
> Produced 2026-06-23. Source of truth for current values: `index.html` `:root` (9–12) +
> CSS (9–147). Semantic mapping derived from
> `docs/specs/2026-06-23-redesign-architecture-map.md` §0.

## How to read this doc

The app today ships **8 raw CSS custom properties** plus a handful of inline hex literals.
This doc does **two** things:

1. **Formalizes** those 8 raws into a **named semantic layer** (e.g. `--color-accent-run-ok`)
   that the redesign builds on, one component at a time.
2. **Names** the type / spacing / radius values that are currently magic numbers scattered
   through the CSS, so new components stop reinventing them.

**Hard rule — additive, not a rename.** The existing `var(--bg)` etc. names are referenced
all over the CSS and the semantics are *load-bearing for tests* (tests read **class
presence**, e.g. `#status.running`, not token *values*). So:

- The 8 raw vars (`--bg`, `--panel`, …) **MUST keep existing and keep their current values.**
- The semantic names below are introduced **as aliases that point at the raws**, e.g.
  `--color-surface-bg: var(--bg);`. New components reference the **semantic** name; the raws
  stay as the physical anchor. Nothing that exists today breaks.
- Retheming is allowed (§0 of the architecture map) but the brief is **formalization, not a
  recolor** — values below stay identical to today's. If a value is ever changed, change the
  **raw** and every alias inherits.

A full WCAG audit is **out of scope here** — contrast notes below are rough sanity checks.
The real pass happens later via the `design:accessibility-review` skill.

---

## 1. Color tokens

### 1.1 The 8 raws (physical layer — keep as-is)

These are the literal anchors. Do not rename, do not change values during formalization.

| Raw var    | Hex       | Today's role in CSS                                              |
|------------|-----------|-----------------------------------------------------------------|
| `--bg`     | `#14151a` | App background (`body`)                                          |
| `--panel`  | `#1c1e26` | Header, tab strip, popovers (`#assetPanel`/`#historyPanel`)      |
| `--edge`   | `#2c2f3a` | Borders, dividers, splitters (rest state), canvas hairline       |
| `--text`   | `#d8dae5` | Primary foreground text                                          |
| `--dim`    | `#8a8fa3` | Muted/secondary text, inactive tabs, the **default** status pill |
| `--accent` | `#7bd88f` | Run/OK green — focus ring, active markers, live dot, drop overlay |
| `--warn`   | `#f0a45d` | Boot/in-progress orange — `#status.boot`, asset warnings          |
| `--bad`    | `#ff6e7f` | Error red — `#status.error`, console `.err`, remove/clear actions |

### 1.2 Semantic layer (additive aliases — what new components use)

> Proposed naming convention: `--color-<group>-<role>`. Each **points at a raw**, so the raw
> stays the single place a value lives. Group prefixes: `surface`, `border`, `text`, `accent`,
> `status`. Tints (the `#234430`-family inline literals) are promoted to named tokens so the
> "run" button and diff bands stop hardcoding hex.

#### Surfaces

| Semantic token            | → resolves to | Hex       | Used by                                              | Contrast note (vs `--text` #d8dae5) |
|---------------------------|---------------|-----------|------------------------------------------------------|-------------------------------------|
| `--color-surface-bg`      | `var(--bg)`   | `#14151a` | App canvas background                                | ~13.0:1 — passes AA & AAA           |
| `--color-surface-panel`   | `var(--panel)`| `#1c1e26` | Header, tabs, popovers, raised chrome                 | ~11.4:1 — passes AA & AAA           |
| `--color-surface-sunken`  | `#121318`     | `#121318` | Console background (`#console`)                        | ~13.5:1 — passes AA & AAA           |
| `--color-surface-stage`   | `#0e0f13`     | `#0e0f13` | Canvas stage backdrop (`#stage`)                      | n/a (frames the game canvas)        |
| `--color-surface-control` | `#262936`     | `#262936` | Default button / `<select>` / `kbd` face              | ~9.6:1 — passes AA & AAA            |
| `--color-surface-pill`    | `#20222c`     | `#20222c` | Status pill bg + hovered/selected history row          | ~10.7:1 vs #d8dae5; vs #8a8fa3 ~3.7:1 (AA large/UI only) |

> `surface-sunken`, `surface-stage`, `surface-control`, `surface-pill` are today **inline hex
> literals**. Promoting them to tokens is the main formalization win on surfaces — these are
> the values most likely to drift if left unnamed.

#### Borders

| Semantic token            | → resolves to  | Hex       | Used by                                          |
|---------------------------|----------------|-----------|--------------------------------------------------|
| `--color-border-default`  | `var(--edge)`  | `#2c2f3a` | Panel borders, dividers, splitter rest, row tops |
| `--color-border-hover`    | `#4a4f63`      | `#4a4f63` | Button/select hover border                       |
| `--color-border-focus`    | `var(--accent)`| `#7bd88f` | Canvas focus ring, active splitter               |

#### Text

| Semantic token         | → resolves to | Hex       | Used by                                  | Contrast note |
|------------------------|---------------|-----------|------------------------------------------|---------------|
| `--color-text-primary` | `var(--text)` | `#d8dae5` | Body, active tab, history time           | AAA on all surfaces above |
| `--color-text-muted`   | `var(--dim)`  | `#8a8fa3` | Secondary labels, inactive tabs, hints   | ~4.7:1 on `--bg` → passes AA normal text (borderline — flag for a11y pass) |
| `--color-text-on-tint` | `#b8f0c6`     | `#b8f0c6` | Text on green tint (run btn, `.d-add`)   | high contrast on dark-green tint |
| `--color-text-on-bad`  | `#f3b0ba`     | `#f3b0ba` | Stop btn label, `.d-del` text            | high contrast on dark-red tint |
| `--color-text-on-flag` | `#0b0d12`     | `#0b0d12` | Remote-cursor name flag (dark on bright) | inverse — dark text on peer color |

#### Accent & status (the load-bearing semantics)

> **These three are load-bearing and must not be repurposed** (architecture map §0):
> **accent = run/ok green · warn = boot/in-progress orange · bad = error red.** Tests assert
> the *class* (`.running`/`.boot`/`.error`); keeping the semantic meaning constant is what
> keeps colors meaningful even if hexes are later retuned.

| Semantic token             | → resolves to  | Hex       | Meaning / used by                                                  |
|----------------------------|----------------|-----------|--------------------------------------------------------------------|
| `--color-accent-run-ok`    | `var(--accent)`| `#7bd88f` | Success/run green: `#status.running`, `#liveDot`, focus, drop overlay, active tab underline, entry marker |
| `--color-status-warn-boot` | `var(--warn)`  | `#f0a45d` | In-progress orange: `#status.boot`, asset ⚠, `#liveDot.connecting`, low-storage |
| `--color-status-error-bad` | `var(--bad)`   | `#ff6e7f` | Error red: `#status.error`, console `.err`, `#liveDot.offline`, remove/clear/restore-destructive |

#### Component tints (promoted from inline literals)

These supported the "run" button and history diff bands as hardcoded hex; naming them keeps
the green/red tint families consistent across components.

| Semantic token              | Hex       | Used by                                            |
|-----------------------------|-----------|----------------------------------------------------|
| `--color-tint-run-bg`       | `#234430` | Run button face, restore button face               |
| `--color-tint-run-bg-hover` | `#2b5a3d` | Run button hover                                    |
| `--color-tint-run-border`   | `#2f6a44` | Run/restore button border                          |
| `--color-tint-add-band`     | `rgba(123,216,143,.14)` | Diff added-line band (`.d-add`)      |
| `--color-tint-del-band`     | `rgba(255,110,127,.14)` | Diff removed-line band (`.d-del`)    |
| `--color-overlay-drop`      | `rgba(20,30,40,.78)`    | Drop overlay scrim (`#dropOverlay`)  |
| `--color-overlay-popover`   | `rgba(0,0,0,.4)`        | Popover drop shadow                  |
| `--color-overlay-fsbtn`     | `rgba(38,41,54,.65)`    | Fullscreen button translucent face   |

**Contrast summary:** primary text (`--text`) clears AA/AAA on every surface. The one to watch
is **`--text-muted` (#8a8fa3) ≈ 4.7:1 on `--bg`** — passes AA for normal text but is close to
the 4.5:1 floor; muted-on-`--panel` is slightly lower. Flagged for the later
`design:accessibility-review` pass; **do not "fix" by changing the raw here** (formalization only).

---

## 2. Type scale

Base: `14px / 1.45`, system sans stack `-apple-system, "Segoe UI", sans-serif`.
Code/console: `"SF Mono", Menlo, monospace`. All sizes below are **already in the CSS** — this
just names them. Range observed: ~11px → 22px.

| Token          | Size     | Line-height | Family | Where it appears today                                      |
|----------------|----------|-------------|--------|-------------------------------------------------------------|
| `--font-h1`    | `15px`   | 1.45        | sans   | `header h1` (app title), weight 600                         |
| `--font-body`  | `14px`   | 1.45        | sans   | `body` base — the default for everything unscoped          |
| `--font-editor`| `13.5px` | (CM)        | mono*  | `.CodeMirror` editor text                                   |
| `--font-small` | `12.5px` | 1.45        | sans   | `#status`, `#liveDot`, `#assetChip`, panels (`12.5px`)      |
| `--font-meta`  | `12px`   | 1.5         | sans/mono | `#console` (mono 12/1.5), tabs, `.hint`, `kbd`-adjacent  |
| `--font-code`  | `12px`   | 1.5         | mono   | `#console` body, asset/history meta (`"SF Mono"`)           |
| `--font-micro` | `11.5px` | 1.5         | mono   | diff body (`.hp-diffbody`), `.ap-storage`                   |
| `--font-nano`  | `11px`   | —           | sans   | `kbd` label, `.remote-flag` (`10px` is the true floor)      |
| `--font-display` | `22px` | 1.2         | sans   | `#dropOverlay` message (the one large display size)        |

> \* The editor uses the CodeMirror `material-darker` theme's own font sizing; `--font-editor`
> documents the `13.5px` override only. `--font-display` (22px) and `--font-nano`/10px flag are
> the extremes; everything else clusters 11.5–15px. **Weights in use:** 400 (default), 600
> (title, Run button, active emphasis). No weight token needed beyond `normal` / `600`.

---

## 3. Spacing scale

Derived from the paddings/gaps actually used. A loose **2px-step** scale; not every value is a
clean multiple of 4 (the design predates a strict grid — these are the real numbers).

| Token         | Value | Seen in                                                        |
|---------------|-------|----------------------------------------------------------------|
| `--space-1`   | `3px` | `#fsBtn` v-padding, asset-row v-padding                        |
| `--space-2`   | `4px` | `#status` v-padding, `#liveDot`/`#assetChip` v-padding, list tops |
| `--space-3`   | `5px` | button v-padding, tab v-padding                               |
| `--space-4`   | `6px` | splitter width, panel internal gaps, row gaps                 |
| `--space-5`   | `8px` | header v-padding, `#console` v-padding, title margin, gaps    |
| `--space-6`   | `10px`| header gap, panel padding, `#status` h-padding                |
| `--space-7`   | `12px`| button h-padding, `#stage`/`#console` h-padding               |
| `--space-8`   | `14px`| header h-padding, `#fsBtn` offset                             |

> **Recommended forward default:** new components should prefer the **4 / 8 / 12** rhythm
> (`--space-2`, `--space-5`, `--space-7`) and treat 3/5/6/10/14 as legacy fits to match
> existing chrome. Don't retrofit existing values — name them, build new on the rhythm.

---

## 4. Radius scale

Four distinct radii in the CSS; one name each.

| Token            | Value  | Used by                                                       |
|------------------|--------|--------------------------------------------------------------|
| `--radius-canvas`| `4px`  | `#canvas`, `kbd`, diff body, history rows, flag corner       |
| `--radius-button`| `6px`  | buttons, `<select>`                                          |
| `--radius-panel` | `8px`  | `#assetPanel`, `#historyPanel`                              |
| `--radius-pill`  | `99px` | `#status`, `#assetChip` (fully rounded)                     |

---

## 5. Global component primitives (layout-independent)

> These primitives appear in **every** candidate layout (A/B/C). Specced here so the redesign
> can build them once, before the layout is locked. Each: **purpose · variants · states ·
> tokens · a11y note.** Layout-specific *arrangement* is deferred (see §6).

### 5.1 Button

- **Purpose:** All toolbar/panel actions.
- **Variants:**
  - **default** — neutral action (Save, Collaborate, History, examples). Face
    `--color-surface-control`, border `--color-border-default`, text `--color-text-primary`.
  - **primary / "run"** — the Run action. Green tint: bg `--color-tint-run-bg`, border
    `--color-tint-run-border`, text `--color-text-on-tint`, weight 600. (Restore button reuses
    this exact treatment.)
  - **danger / "stop"** — the Stop action. Default face but text `--color-text-on-bad`.
  - **ghost** — text-only affordances inside panels (`.ap-browse`, `.ap-clear`, `.tab-add`,
    `.hp-clear`): no border/bg, colored text (`--color-accent-run-ok` for additive,
    `--color-status-error-bad` for destructive).
- **States:** rest · **hover** (default→`--color-border-hover`; run→`--color-tint-run-bg-hover`)
  · focus (no explicit ring today — **a11y gap**) · disabled (none defined today).
- **Tokens:** `--radius-button`, `--space-3`/`--space-7` padding, `--font-body`.
- **a11y:** No visible focus ring on buttons today (only `#canvas` has one). The redesign
  should add a focus-visible ring (reuse `--color-border-focus`). Danger/primary must not rely
  on color alone — keep the `▶`/`■` glyphs as a non-color signal.

### 5.2 Status pill (`#status`)

- **Purpose:** Single live indicator of engine state. **Only writer is `setStatus(cls,text)`
  (index.html 1024).** `className` drives color; `textContent` is what tests gate on.
- **Variants (by class) — load-bearing:**

  | State      | Class      | Color token                  | Note                          |
  |------------|------------|------------------------------|-------------------------------|
  | running    | `.running` | `--color-accent-run-ok`      | green                         |
  | boot/load  | `.boot`    | `--color-status-warn-boot`   | orange (starting/loading…)    |
  | error      | `.error`   | `--color-status-error-bad`   | red                           |
  | ready      | *(none)*   | falls back to `--color-text-muted` | dim                     |
  | finished   | *(none)*   | falls back to `--color-text-muted` | dim                     |
  | stopped    | *(none)*   | falls back to `--color-text-muted` | dim                     |

- **States:** the six text tokens are fixed (`starting…`, `loading Python…`, `loading pygame…`,
  `ready`, `running`, `finished`, `error — see console`, `stopped`, `boot failed`) — **every
  test battery gates on these strings; do not reword.**
- **Tokens:** bg `--color-surface-pill`, border `--color-border-default`, `--radius-pill`,
  `--font-small`, `--space-2`/`--space-6` padding.
- **a11y:** Color-only state today. ready/finished/stopped share dim — distinguished only by
  text. Consider `role="status"` / `aria-live="polite"` so screen readers announce transitions
  (additive — won't disturb the class/text seams).

### 5.3 Panel / popover (`#assetPanel`, `#historyPanel`)

- **Purpose:** Floating surfaces for assets and history.
- **Variants:** asset panel (300px) · history panel (340px) — same chrome, different width/body.
- **States:** shown / hidden (`[hidden]` attribute → `display:none`).
- **Tokens:** bg `--color-surface-panel`, border `--color-border-default`, `--radius-panel`,
  padding `--space-6`, shadow `0 8px 24px var(--color-overlay-popover)`, `--font-small`.
  Section heads/foots use `--color-text-muted` + `--color-border-default` top-rules.
- **a11y:** No focus trap / Escape-to-close documented today. Redesign should add Escape +
  return-focus and `role="dialog"`. **Positioning is `top:44px; right:14px` anchored to
  `header{position:relative}` — that anchoring is layout-coupled and deferred (§6).**

### 5.4 Console line (`#console`)

- **Purpose:** Program stdout/stderr + system messages. Survives Stop; cleared only on Run.
- **Variants (per-line class):** **out** (default, `--color-text-primary`) · **err** (`.err`,
  `--color-status-error-bad`) · **sys** (`.sys`, `--color-text-muted`, italic).
- **States:** scrollable; `white-space:pre-wrap`. Cleared at top of `run()` only.
- **Tokens:** surface `--color-surface-sunken`, `--font-code` (mono 12/1.5), padding
  `--space-5`/`--space-7`.
- **a11y:** err vs out is color-only — consider a prefix/glyph for colorblind users. A live
  region would announce errors but may be noisy; defer to a11y pass.

### 5.5 Code surface (editor)

- **Purpose:** The single CodeMirror 5 instance — the live editor for all `.py`.
- **Variants:** one. (CM `material-darker` theme provides syntax colors — **out of scope for
  these tokens**; do not duplicate them.)
- **States:** focused (CM-managed) · **lint markers** in the gutter
  (`CodeMirror-lint-marker-error/-warning/-multiple`) — gutter is added only after first edit
  (first-paint lazy invariant). Marker *colors* come from the CM lint addon, not our tokens.
- **Tokens:** `--font-editor` (13.5px). Lint-marker semantics conceptually align with
  `--color-status-error-bad` (error) / `--color-status-warn-boot` (warning) but are **owned by
  the addon** — note the alignment, don't override.
- **a11y:** Editor a11y is CodeMirror's domain. Keep the **one-CM identity invariant** (§3 of
  architecture map) — never a second instance.

### 5.6 File row (explorer/tab item)

- **Purpose:** One entry per project file (today: `#tabs .tab[data-name]`; redesign promotes to
  a persistent explorer row that ALSO lists assets).
- **Variants / states:**
  - **default** — `--color-text-muted`.
  - **hover** — `--color-text-primary`.
  - **active** — `--color-text-primary` on `--color-surface-panel`, plus
    `box-shadow: inset 0 -2px 0 --color-accent-run-ok` (the green active marker).
  - **entry** — `▸` prefix in `--color-accent-run-ok` (the run entrypoint file).
  - **warn** (asset rows) — `.asset-warn` in `--color-status-warn-boot` (unsupported audio ⚠).
- **Tokens:** `--font-meta` (12px), `--space-3`/`--space-4` padding, name in mono for assets
  (`--font-code`), border `--color-border-default` row-tops.
- **a11y:** active is marked by both color underline AND background — good (not color-only).
  Keep `data-name` + active/entry classes (test seam: `multifile.mjs`, `lint.mjs`).

### 5.7 Splitter (`#splitter`, `#vsplit`)

- **Purpose:** Drag handle to resize panes (one horizontal, one vertical).
- **Variants:** col-resize (`#splitter`) · row-resize (`#vsplit`).
- **States:** rest (`--color-border-default`) · **hover / active**
  (`--color-accent-run-ok`). `body.resizing-x/-y` swaps cursor + disables select.
- **Tokens:** `6px` track (`--space-4`), color tokens above.
- **a11y:** Pointer-only today; no keyboard resize. Consider `role="separator"` +
  `aria-orientation` + arrow-key support in the redesign (additive).

### 5.8 Drop overlay (`#dropOverlay`)

- **Purpose:** Full-viewport affordance shown while dragging files in.
- **Variants:** one.
- **States:** hidden (default `display:none`) · shown (`.show` → flex).
- **Tokens:** scrim `--color-overlay-drop`, text + `3px dashed` border
  `--color-accent-run-ok`, `--font-display` (22px).
- **a11y:** Visual-only; fine as a transient hint. Ensure the underlying drop target still works
  without seeing the overlay (it does — drop is gated on `dataTransfer.types` includes `Files`).

### 5.9 Live dot (collab presence, `#liveDot`)

- **Purpose:** Connection/presence indicator while in a collab room (hidden when solo).
- **Variants / states (by class):** connected (default `●` `--color-accent-run-ok`) ·
  **connecting** (`.connecting` → `--color-status-warn-boot`) · **offline** (`.offline` →
  `--color-status-error-bad`). `#peerCount` is a numeric badge.
- **Tokens:** `--font-small`, `--space-2`/`--space-5` padding. Reuses the same three semantic
  status colors as the pill — **consistency by design** (green=ok, orange=connecting,
  red=offline mirrors run-ok/boot/error).
- **a11y:** Color-only `●`. Pair with text (peer count is already text); consider `aria-label`
  reflecting the state word.

> **Related collab bits (not standalone primitives):** `.remote-cursor` / `.remote-flag` use a
> per-peer color (assigned at runtime, not a token) with `--color-text-on-flag` (#0b0d12) for
> the dark-on-bright name label. Documented for completeness; peer colors stay dynamic.

---

## 6. Deferred until layout is locked

The following are **arrangement / placement** decisions that depend on which of the A/B/C
layouts is chosen. They are intentionally **not** specced here (tokens and primitives above are
layout-agnostic and stable; these will move):

- **Explorer placement & visibility** — sidebar vs rail vs only-when-multi (architecture map
  fork #6). The file-row *primitive* (§5.6) is settled; *where the list lives* is not.
- **Toolbar grouping & order** — how Run/Stop, Save, Collaborate, History, examples-trigger are
  grouped/segmented. The button *primitive* (§5.1) is settled; the bar's composition is not.
- **Unified Start/Stop control shape** — the single toggle that replaces `#runBtn`+`#stopBtn`
  (fork #3). Uses the button primitive; its exact form (toggle vs split) is layout/UX-coupled.
- **Viewer pane** — the type-aware viewer (code / image / audio / "unable to open"). The
  *surfaces* it composes (code surface §5.5, panels §5.3) are settled; the pane's placement is not.
- **Popover anchoring** — `#assetPanel`/`#historyPanel` `top:44px right:14px` anchor depends on
  final header geometry; re-anchor once the toolbar is placed.
- **History re-homing** — shared sidebar vs docked rail vs timeline strip (fork #7). Row/diff
  primitives are settled; the home is not.
- **Examples popup** — the read-only "load an example" copy popup (capability #1). Uses the
  panel primitive; placement deferred.

---

## Appendix — proposed `:root` shape (illustrative, NOT to be applied here)

> Shows how the additive aliases would sit on top of the raws. **Do not edit `index.html` from
> this doc** — this is the target the redesign migrates toward, component by component.

```css
:root {
  /* ── physical raws (unchanged, load-bearing, keep existing names) ── */
  --bg: #14151a; --panel: #1c1e26; --edge: #2c2f3a;
  --text: #d8dae5; --dim: #8a8fa3;
  --accent: #7bd88f; --warn: #f0a45d; --bad: #ff6e7f;

  /* ── semantic surfaces ── */
  --color-surface-bg:      var(--bg);
  --color-surface-panel:   var(--panel);
  --color-surface-sunken:  #121318;
  --color-surface-stage:   #0e0f13;
  --color-surface-control: #262936;
  --color-surface-pill:    #20222c;

  /* ── borders ── */
  --color-border-default: var(--edge);
  --color-border-hover:   #4a4f63;
  --color-border-focus:   var(--accent);

  /* ── text ── */
  --color-text-primary: var(--text);
  --color-text-muted:   var(--dim);
  --color-text-on-tint: #b8f0c6;
  --color-text-on-bad:  #f3b0ba;
  --color-text-on-flag: #0b0d12;

  /* ── accent & status (semantics load-bearing) ── */
  --color-accent-run-ok:    var(--accent);
  --color-status-warn-boot: var(--warn);
  --color-status-error-bad: var(--bad);

  /* ── component tints ── */
  --color-tint-run-bg:       #234430;
  --color-tint-run-bg-hover: #2b5a3d;
  --color-tint-run-border:   #2f6a44;
  --color-tint-add-band:     rgba(123,216,143,.14);
  --color-tint-del-band:     rgba(255,110,127,.14);
  --color-overlay-drop:      rgba(20,30,40,.78);
  --color-overlay-popover:   rgba(0,0,0,.4);
  --color-overlay-fsbtn:     rgba(38,41,54,.65);

  /* ── type ── */
  --font-display: 22px; --font-h1: 15px; --font-body: 14px;
  --font-editor: 13.5px; --font-small: 12.5px; --font-meta: 12px;
  --font-code: 12px; --font-micro: 11.5px; --font-nano: 11px;

  /* ── spacing ── */
  --space-1: 3px; --space-2: 4px; --space-3: 5px; --space-4: 6px;
  --space-5: 8px; --space-6: 10px; --space-7: 12px; --space-8: 14px;

  /* ── radius ── */
  --radius-canvas: 4px; --radius-button: 6px;
  --radius-panel: 8px; --radius-pill: 99px;
}
```
