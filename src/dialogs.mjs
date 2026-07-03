// src/dialogs.mjs — modal (user choices), toast (notices), the shared popup action menu,
// and the shared inline-edit input machinery. Zero app-model coupling (spec §3.2 #3).
import { esc } from "./util.mjs";

// =============================================================== Slice B: popup action menu
// ONE shared popup instance, anchored to the clicked row's ⋯. Opening it (via tabMenu /
// folderMenu / assetMenu) replaces the typed prompt; selecting an item runs the existing
// handler directly. role=menu / role=menuitem for a11y; arrow/Enter/Esc keyboard; focus
// returns to the ⋯ on close; viewport-flip near an edge; outside-click / Esc / action dismiss.
const popMenuEl = document.createElement("div");
popMenuEl.className = "popmenu";
popMenuEl.setAttribute("role", "menu");
popMenuEl.tabIndex = -1;
document.body.appendChild(popMenuEl);
let popAnchor = null;   // the ⋯ button the menu is currently anchored to (focus returns here)

function closePopMenu(restoreFocus = true) {
  if (!popMenuEl.classList.contains("open")) return;
  popMenuEl.classList.remove("open");
  popMenuEl.innerHTML = "";
  const anchor = popAnchor; popAnchor = null;
  if (anchor) anchor.setAttribute("aria-expanded", "false");
  if (restoreFocus && anchor && anchor.isConnected) anchor.focus();
}
window.__closePopMenu = closePopMenu;   // PINNED test seam (explorer-actions.mjs)

// Open the popup for `anchorBtn` with a list of {label, icon, danger, run} items.
function openPopMenu(anchorBtn, items) {
  closePopMenu(false);
  popAnchor = anchorBtn;
  anchorBtn.setAttribute("aria-haspopup", "menu");
  anchorBtn.setAttribute("aria-expanded", "true");
  popMenuEl.innerHTML = "";
  for (const it of items) {
    const mi = document.createElement("button");
    mi.type = "button";
    mi.className = "mi" + (it.danger ? " danger" : "");
    mi.setAttribute("role", "menuitem");
    mi.tabIndex = -1;
    mi.innerHTML = `<span class="mi-ic" aria-hidden="true">${it.icon || ""}</span><span class="mi-label">${esc(it.label)}</span>`;
    mi.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      closePopMenu(false);
      it.run();
    });
    popMenuEl.appendChild(mi);
  }
  popMenuEl.classList.add("open");
  // Position: anchored under the ⋯, flipped above / left if it would overflow the viewport.
  // position:absolute (so offsetParent is the body, not null as it would be for fixed), so the
  // menu reads as VISIBLE; coordinates are page-space (viewport rect + scroll offset).
  const r = anchorBtn.getBoundingClientRect();
  const mw = popMenuEl.offsetWidth, mh = popMenuEl.offsetHeight;
  const sx = window.scrollX || 0, sy = window.scrollY || 0;
  let top = r.bottom + 4, left = r.left;
  if (left + mw > window.innerWidth - 6) left = Math.max(6, r.right - mw);
  if (top + mh > window.innerHeight - 6) top = Math.max(6, r.top - mh - 4);
  popMenuEl.style.top = (top + sy) + "px";
  popMenuEl.style.left = (left + sx) + "px";
  // Move keyboard focus into the first item so arrow/Enter work immediately.
  const first = popMenuEl.querySelector(".mi");
  if (first) first.focus();
}

// Keyboard nav within the menu: ArrowUp/Down move, Enter/Space activate, Esc/Tab close.
popMenuEl.addEventListener("keydown", (e) => {
  const its = [...popMenuEl.querySelectorAll(".mi")];
  if (!its.length) return;
  let i = its.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); its[(i + 1 + its.length) % its.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); its[(i - 1 + its.length) % its.length].focus(); }
  else if (e.key === "Home") { e.preventDefault(); its[0].focus(); }
  else if (e.key === "End") { e.preventDefault(); its[its.length - 1].focus(); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (document.activeElement.click ? document.activeElement : its[0]).click(); }
  else if (e.key === "Escape") { e.preventDefault(); closePopMenu(); }
  // Focus-trap: suppress the browser's native Tab so it can't leak focus to the next page control;
  // close the menu and return focus to the ⋯ anchor (a11y — Slice C follow-up B).
  else if (e.key === "Tab") { e.preventDefault(); closePopMenu(true); }
});
// Global Esc closes (test dispatches Escape on document/activeElement). Capture so it wins
// even when focus is outside the menu.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && popMenuEl.classList.contains("open")) { closePopMenu(); }
}, true);
// Outside-click / scroll / resize dismiss (don't steal focus on an outside click).
document.addEventListener("mousedown", (e) => {
  if (!popMenuEl.classList.contains("open")) return;
  if (popMenuEl.contains(e.target) || (popAnchor && popAnchor.contains(e.target))) return;
  closePopMenu(false);
}, true);
addEventListener("resize", () => closePopMenu(false));
// Scroll on the explorer tree dismisses the menu. dialogs doesn't import explorer (leaf module) — the tree is reached by id; explorer re-wires this via a callback in Plan 2.
document.getElementById("tabs").addEventListener("scroll", () => closePopMenu(false), true);

// Find the ⋯ button for a row identified by its model key (data-name file/asset, data-path folder).
function rowMenuBtn(rowSel) {
  const row = document.querySelector(rowSel);
  return row ? row.querySelector(".tab-menu") : null;
}
export { closePopMenu, openPopMenu, rowMenuBtn };

// #13: aesthetic modal (user CHOICES) + calm toast (non-choice notices) — replaces native browser
// confirm()/alert() (no ugly OS dialogs). The modal is ASYNC (Promise<boolean>) because it can't block
// the JS thread the way confirm() did, so callers `await` it. Single instance, focus-trapped, with
// Escape / backdrop-click = cancel and focus returned to the opener. `danger` styles confirm delete-red.
let _modalState = null;   // { backdrop, resolve, lastFocus } while a modal is open
function confirmModal({ title = "", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  closeModal(false);   // single instance: a new modal supersedes the old (resolving it as cancel)
  return new Promise((resolve) => {
    const lastFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.id = "modalBackdrop";
    const card = document.createElement("div");
    card.className = "modal";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.innerHTML =
      (title ? `<div class="modal-title"></div>` : "") +
      `<div class="modal-msg"></div>` +
      `<div class="modal-acts">` +
        `<button type="button" class="modal-btn" data-act="cancel"></button>` +
        `<button type="button" class="modal-btn confirm${danger ? " danger" : ""}" data-act="confirm"></button>` +
      `</div>`;
    if (title) card.querySelector(".modal-title").textContent = title;   // textContent: never inject markup
    card.querySelector(".modal-msg").textContent = message;
    card.querySelector('[data-act="cancel"]').textContent = cancelLabel;
    card.querySelector('[data-act="confirm"]').textContent = confirmLabel;
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    _modalState = { backdrop, resolve, lastFocus };
    card.querySelector('[data-act="confirm"]').addEventListener("click", () => closeModal(true));
    card.querySelector('[data-act="cancel"]').addEventListener("click", () => closeModal(false));
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModal(false); });   // click OUTSIDE the card
    // Default focus = Cancel, so a stray Enter never confirms a destructive action.
    card.querySelector('[data-act="cancel"]').focus();
  });
}
function closeModal(result) {
  const st = _modalState; _modalState = null;
  if (!st) return;
  st.backdrop.remove();
  if (st.lastFocus && st.lastFocus.isConnected) try { st.lastFocus.focus(); } catch {}
  st.resolve(!!result);
}
// Modal key handling (capture): Escape cancels; Tab is trapped within the dialog.
document.addEventListener("keydown", (e) => {
  if (!_modalState) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModal(false); return; }
  if (e.key === "Tab") {
    const f = [..._modalState.backdrop.querySelectorAll("button, [tabindex]:not([tabindex='-1'])")].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || !_modalState.backdrop.contains(a))) { e.preventDefault(); e.stopPropagation(); last.focus(); }
    else if (!e.shiftKey && (a === last || !_modalState.backdrop.contains(a))) { e.preventDefault(); e.stopPropagation(); first.focus(); }
  }
}, true);

// Calm, non-blocking toast for NON-choice notices (e.g. "Can't delete the only file"). No backdrop;
// fades in at the bottom, auto-dismisses, and stacks.
let _toastHost = null;
function toast(message, { ms = 3200 } = {}) {
  if (!_toastHost) { _toastHost = document.createElement("div"); _toastHost.id = "toastHost"; document.body.appendChild(_toastHost); }
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  _toastHost.appendChild(el);
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 220); }, Math.max(300, ms));
}
export { confirmModal, closeModal, toast };

// ============================================================== shared inline-edit machinery
// Distilled from the formerly-duplicated create/rename rows. Contract (all preserved
// behaviors are load-bearing for explorer-actions.mjs/upload.mjs):
//   - Enter commits; Escape cancels; blur cancels ON THE NEXT TICK (so a commit-triggered
//     repaint doesn't race the blur).
//   - commit(raw, hint, cancel) returns: true/undefined = success (row was re-rendered by
//     the handler), false = stay open (hint already shown), Promise<boolean> = async commit.
//   - During an async commit the input is FROZEN via readOnly — NOT disabled: disabling a
//     focused input fires blur, which would race the pending guard.
//   - On async false the calm hint keeps the row in edit; on rejection likewise.
export function inlineInput({ value = "", ariaLabel = "" } = {}) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = value;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  return input;
}
export function wireInlineEdit(input, row, { commit, cancel, asyncFailHint = "invalid or in use" }) {
  let done = false, pending = false;
  const hint = (msg) => {
    input.classList.add("invalid");
    let h = row.querySelector(".rename-hint");
    if (!h) { h = document.createElement("span"); h.className = "rename-hint"; row.appendChild(h); }
    h.textContent = msg; input.focus();
  };
  const doCancel = () => { if (done || pending) return; done = true; cancel(); };
  const tryCommit = () => {
    if (done || pending) return;
    const res = commit(input.value.trim(), hint, doCancel);
    if (res && typeof res.then === "function") {
      pending = true;
      input.readOnly = true;   // freeze, never disable (blur race — see contract above)
      res.then((okd) => {
        pending = false;
        if (done) return;                  // a success repaint already replaced the input
        input.readOnly = false;
        if (okd) { done = true; }
        else hint(asyncFailHint);
      }, () => { pending = false; if (!done) { input.readOnly = false; hint("rename failed"); } });
      return;
    }
    if (res !== false) done = true;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); tryCommit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); doCancel(); }
  });
  input.addEventListener("input", () => {
    input.classList.remove("invalid");
    const h = row.querySelector(".rename-hint"); if (h) h.remove();
  });
  input.addEventListener("blur", () => { setTimeout(() => doCancel(), 0); });
}
