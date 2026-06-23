// SCRATCH entry for the history de-risking spike. Mirrors entry.mjs but ALSO
// re-exports the change-history / time-travel / diff APIs so the spike can prove
// what a future "history panel" feature could rely on. Outputs to a NEW vendor
// file (automerge-history-spike.mjs); the committed entry.mjs / vendor bundle
// are left untouched.
export { Repo, Presence } from "@automerge/automerge-repo";
// encodeHeads: raw Heads (hex hash[]) -> UrlHeads (tagged); decodeHeads: reverse.
// Needed because handle.heads()/history()/view()/diff() speak UrlHeads, while the
// bare automerge view(doc,heads)/diff(doc,a,b) speak raw Heads.
export { encodeHeads, decodeHeads } from "@automerge/automerge-repo";
export { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
export { updateText } from "@automerge/automerge/next";

// --- history / time-travel / diff surface (all live in @automerge/automerge/next) ---
// build.mjs aliases "@automerge/automerge/next" onto the inlined-WASM `next`
// build, so these come through a self-initializing specifier.
export {
  getAllChanges,   // (doc) => Change[]          -- raw encoded changes (one per edit)
  getHistory,      // (doc) => State<T>[]         -- [{ change: DecodedChange, snapshot: T }]
  getHeads,        // (doc) => Heads (string[])   -- current version pointer
  view,            // (doc, heads) => Doc<T>      -- materialize doc AT a past version
  diff,            // (doc, beforeHeads, afterHeads) => Patch[]
  decodeChange,    // (Change) => DecodedChange   -- { actor, seq, time, message, deps, hash, ops }
  getLastLocalChange,
  inspectChange,   // (doc, hash) => DecodedChange | null
} from "@automerge/automerge/next";
