// src/ui.mjs — console/status plumbing + the shared tooltip. DOM-only leaf; nearly every
// later module imports logLine/setStatus, so this extracts early (spec §3.2 #2).
// Module eval runs after HTML parse (dynamic import from the tail script), so the
// getElementById calls below are safe.

// ---------------------------------------------------------------- UI plumbing
export const consoleEl = document.getElementById("console");
export const statusEl = document.getElementById("status");
export const canvasEl = document.getElementById("canvas");

export function logLine(text, cls) {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = text;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
export function clearConsole() { consoleEl.textContent = ""; }
// THE single #status writer (spec §4.6): exact token strings are compared with === in ~28
// test files, and shell.mjs asserts the 'pill'/'pill <state>' className on every write.
// Byte-identical to the original. Never add a second writer.
export function setStatus(cls, text) { statusEl.className = "pill" + (cls ? " " + cls : ""); statusEl.textContent = text; }

// ---------------------------------------------------------------- Shared hover/focus tooltip (ran as an IIFE in the host; module scope now provides the closure). Installed at module eval — same effective timing (before any interaction). Registers before all __appMain listeners; safe — no same-phase document peers, and stopImmediatePropagation appears nowhere in the codebase.
const tip = document.createElement("div");
tip.className = "tooltip"; tip.setAttribute("role", "tooltip");
document.body.appendChild(tip);
let cur = null;
function show(el) {
  const t = el.getAttribute("data-tip"); if (!t) { hide(); return; }
  cur = el; tip.textContent = t;
  const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let left, top;
  if (el.getAttribute("data-tip-side") === "right") {
    left = r.right + 8; top = r.top + r.height / 2 - th / 2;
    if (left + tw > window.innerWidth - 6) left = r.left - tw - 8;
    top = Math.max(6, Math.min(top, window.innerHeight - th - 6));
  } else {
    left = r.left + r.width / 2 - tw / 2; left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
    top = r.bottom + 7; if (top + th > window.innerHeight - 6) top = r.top - th - 7;
  }
  tip.style.left = Math.round(left) + "px"; tip.style.top = Math.round(top) + "px";
  tip.classList.add("show");
}
function hide() { cur = null; tip.classList.remove("show"); }
document.addEventListener("mouseover", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el !== cur) show(el); });
document.addEventListener("mouseout", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hide(); });
document.addEventListener("focusin", e => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) show(el); });
document.addEventListener("focusout", hide);
document.addEventListener("mousedown", hide);
document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
window.addEventListener("scroll", hide, true);
