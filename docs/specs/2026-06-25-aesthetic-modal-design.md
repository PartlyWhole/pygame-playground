# Request #13 — aesthetic modal + calm toast (no native browser dialogs) — design

## 0. Context & decision
User: "never use browser prompting. Use an aesthetic popup, with everything else blurred in the background,
whenever we need user choice like whether to delete or not." Replace ALL native `confirm()`/`alert()` (and any
`prompt()`, already retired in #8) with in-app surfaces. Same spirit as #1/#8 (retiring the ugly browser `prompt`)
and the learner's calm/low-clutter UX.

**Decision (user, 2026-06-25):**
- **Choices** (delete, replace-project, reset, restore) → a centered **modal with a blurred backdrop**.
- **Non-choice notices** (the 2 "can't delete" errors) → a **calm, auto-dismissing toast** (no backdrop) — reserves
  the modal for real decisions.

## 1. Components (additive; no build step)
- `confirmModal({ title, message, confirmLabel="Confirm", cancelLabel="Cancel", danger=false }) → Promise<boolean>`
  — resolves `true` on confirm, `false` on cancel / Escape / backdrop-click. Native `confirm()` was SYNCHRONOUS
  (`if (!confirm(m)) return;`); the modal is async, so each call site becomes `if (!(await confirmModal(…))) return;`
  and its enclosing function becomes `async` (the callers are fire-and-forget user actions).
- `toast(message, { ms=3200 } = {})` — a calm notice that fades in at the bottom, auto-dismisses, and stacks.

## 2. Behavior / a11y
- Modal: `role="dialog"` `aria-modal="true"`, single instance (a second call closes/replaces), centered card on a
  `#modalBackdrop` (semi-opaque + `backdrop-filter: blur`). Focus moves into the card on open (default = Cancel, so a
  stray Enter doesn't delete); **focus-trap** (Tab cycles within — mirrors the `openPopMenu` trap); **Escape** and
  **backdrop click** = cancel; focus returns to the previously-focused element on close. Fade/scale-in.
- `danger:true` styles the confirm button with `--bad` (delete-red); otherwise `--accent`.
- Toast: bottom-center, `--panel` card, no backdrop, pointer-through, auto-removed after `ms`.

## 3. Call sites (index.html)
Confirms → `confirmModal` (enclosing fn → async): history restore (~1615, already async), folderDelete (~2381),
fileDelete (~2422), assetDelete (~2450), example-replace change handler (~2617), resetExampleFile (~2720).
Alerts → `toast`: "Can't delete every file…" (~2380), "Can't delete the only file." (~2421).

## 4. Seams (for tests + reuse)
`#modalBackdrop`, `.modal[role="dialog"]`, buttons `[data-act="confirm"]` / `[data-act="cancel"]`; `#toastHost .toast`.
`window.confirmModal` / `window.toast` exposed as test seams. The batteries that mock `window.confirm`/`window.alert`
(assets, examples, explorer-tree, explorer-actions, explorer-dnd, history) drive the delete/replace flows by clicking
`[data-act="confirm"]` instead — a real-UX assertion, not a synchronous mock.

## 5. Slices (green-checkpointed; TDD)
- **M1 — components:** `confirmModal` + `toast` + CSS + new battery `test/modal.mjs` (open → confirm/cancel/Escape/
  backdrop resolution, focus-trap, danger style, toast appears + auto-dismisses). No call sites changed yet → the rest
  of the suite stays green.
- **M2 — wire it:** convert the 6 confirms + 2 alerts; update the 6 batteries' delete/replace flows to drive the modal.

## 6. Out of scope (v1)
`assetMsg`/`#console` notices (NOT browser dialogs — left as-is); replacing the popup ACTION menu (already in-app);
modal text-input (no `prompt()` remains; inline create/rename already covers authoring).
