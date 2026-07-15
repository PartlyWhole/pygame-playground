// TrysteroNetworkAdapter — automerge-repo NetworkAdapter over trystero WebRTC.
//
// Peers meet through trystero's Nostr strategy: room discovery + WebRTC signaling
// ride on ~a dozen public Nostr relays (free, no accounts, no API keys), then all
// sync traffic flows peer-to-peer over WebRTC data channels. Signaling payloads
// are encrypted with a password derived from the room id (the room link is already
// the capability), so relays can't read SDP/IPs.
//
// The arrive/welcome handshake mirrors @automerge/automerge-repo-network-broadcastchannel:
// trystero tells us a peer's *transport* id; the handshake exchanges automerge peerIds
// so we can emit peer-candidate / route send() by targetId. Repo messages are CBOR-encoded
// (they mix strings and Uint8Arrays) and sent as one binary payload — trystero chunks
// and reassembles large payloads itself, so multi-megabyte first syncs are fine.
import { NetworkAdapter } from "@automerge/automerge-repo/slim";
import { joinRoom } from "trystero/nostr";
import { encode, decode } from "cbor-x";

export class TrysteroNetworkAdapter extends NetworkAdapter {
  #roomId; #appId; #room = null;
  #hello = null; #sync = null;
  #byPeerId = new Map();      // automerge peerId -> trystero peer id
  #byTid = new Map();         // trystero peer id -> automerge peerId
  #announced = new Set();     // automerge peerIds we've emitted peer-candidate for
  #ready = false; #readyResolve; #readyPromise;
  #disconnected = false;

  #extraConfig;
  constructor({ roomId, appId = "pygame-playground-collab", config }) {
    super();
    this.#roomId = roomId;
    this.#appId = appId;
    this.#extraConfig = config ?? {};   // extra trystero room config (rtcConfig, test knobs)
    this.#readyPromise = new Promise(r => { this.#readyResolve = r; });
  }

  isReady() { return this.#ready; }
  whenReady() { return this.#readyPromise; }
  #markReady() { if (!this.#ready) { this.#ready = true; this.#readyResolve(); } }

  /** live WebRTC peer count — for status UI */
  peerCount() { return this.#byTid.size; }

  connect(peerId, peerMetadata) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.#disconnected = false;

    // The relay connections open in the background; the adapter reports ready
    // immediately (like the BroadcastChannel adapter) so a Repo with several
    // transports never blocks on this one. Peers announce whenever they arrive.
    this.#markReady();

    this.#room = joinRoom(
      { appId: this.#appId, password: "pw:" + this.#roomId, ...this.#extraConfig },
      this.#roomId
    );
    this.#hello = this.#room.makeAction("amhello");
    this.#sync = this.#room.makeAction("amsync");

    // trystero ≥0.25: onPeerJoin/onPeerLeave are assignable properties, not methods
    this.#room.onPeerJoin = tid => {
      if (this.#disconnected) return;
      this.#hello.send({ kind: "arrive", peerId: this.peerId, peerMetadata: this.peerMetadata ?? null }, { target: tid });
    };

    this.#room.onPeerLeave = tid => {
      const remote = this.#byTid.get(tid);
      if (remote === undefined) return;
      this.#byTid.delete(tid);
      this.#byPeerId.delete(remote);
      this.#announced.delete(remote);
      if (!this.#disconnected) this.emit("peer-disconnected", { peerId: remote });
    };

    this.#hello.onMessage = (data, { peerId: tid }) => {
      if (this.#disconnected || !data || typeof data.peerId !== "string") return;
      if (data.kind === "arrive") {
        this.#hello.send({ kind: "welcome", peerId: this.peerId, peerMetadata: this.peerMetadata ?? null }, { target: tid });
      }
      this.#byTid.set(tid, data.peerId);
      this.#byPeerId.set(data.peerId, tid);
      if (!this.#announced.has(data.peerId)) {
        this.#announced.add(data.peerId);
        this.emit("peer-candidate", { peerId: data.peerId, peerMetadata: data.peerMetadata ?? undefined });
      }
    };

    this.#sync.onMessage = (payload, { peerId: tid }) => {
      if (this.#disconnected || !this.#byTid.has(tid)) return;
      let message;
      try {
        message = decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload));
      } catch (e) { console.warn("collab p2p: undecodable message dropped", e); return; }
      if (message?.targetId && message.targetId !== this.peerId) return;
      // cbor-x may hand back a Buffer subclass or plain view — normalize to Uint8Array
      if (message && "data" in message && message.data != null && !(message.data instanceof Uint8Array)) {
        message.data = new Uint8Array(message.data.buffer ?? message.data);
      }
      this.emit("message", message);
    };
  }

  send(message) {
    if (this.#disconnected || !this.#sync) return;
    const tid = this.#byPeerId.get(message.targetId);
    if (!tid) return;   // peer not (or no longer) on this transport; repo routed here in error
    // Fire-and-forget: trystero's send promise rejects if the peer vanished mid-send;
    // the sync protocol re-converges after onPeerLeave, so a lost message is safe.
    this.#sync.send(encode(message), { target: tid }).catch(() => {});
  }

  disconnect() {
    this.#disconnected = true;
    for (const remote of this.#announced) this.emit("peer-disconnected", { peerId: remote });
    this.#announced.clear(); this.#byPeerId.clear(); this.#byTid.clear();
    const room = this.#room;
    this.#room = null; this.#hello = null; this.#sync = null;
    room?.leave().catch(() => {});
  }
}
