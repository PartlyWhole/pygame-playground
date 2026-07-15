export { Repo, Presence } from "@automerge/automerge-repo";
export { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
export { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
export { TrysteroNetworkAdapter } from "./trystero-adapter.mjs";
export { updateText } from "@automerge/automerge/next";
// trystero internals re-exported for diagnostics (test batteries + console debugging)
export { joinRoom as trysteroJoinRoom, getRelaySockets, selfId as trysteroSelfId } from "trystero/nostr";
