import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// Resolve the base64-inlined, self-initializing automerge entrypoints.
// The default browser condition resolves automerge to its *bundler* WASM
// entrypoint, whose `.wasm` esbuild emits as a sibling file but never
// initializes at runtime (=> "wasm.__wbindgen_add_to_stack_pointer is not a
// function"). The `fullfat_*_base64` entrypoints inline the WASM as base64 and
// call wasm-bindgen `initSync` synchronously at module-eval time, so the bundle
// is ready the instant it imports — no async init / ensureReady needed.
const amgDir = here + "node_modules/@automerge/automerge/";
const stable = amgDir + "dist/mjs/entrypoints/fullfat_base64.js";
const next = amgDir + "dist/mjs/entrypoints/fullfat_next_base64.js";

mkdirSync("../vendor", { recursive: true });
await build({
  entryPoints: ["entry.mjs"],
  bundle: true,
  format: "esm",
  outfile: "../vendor/automerge-collab.mjs",
  // Force every automerge import (incl. the /slim entries that automerge-repo
  // pulls in) onto the self-initializing base64 builds. esbuild dedupes the
  // shared low_level/web modules, so the WASM initializes exactly once.
  alias: {
    "@automerge/automerge": stable,
    "@automerge/automerge/slim": stable,
    "@automerge/automerge/next": next,
    "@automerge/automerge/slim/next": next,
  },
  target: "es2022",
  logLevel: "info",
});
console.log("built vendor/automerge-collab.mjs");
