// SCRATCH build for the history de-risking spike. Copy of build.mjs but with a
// different entry + a NEW output file (../vendor/automerge-history-spike.mjs).
// Does NOT clobber ../vendor/automerge-collab.mjs.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

// Same WASM-inlining recipe as build.mjs: force every automerge import onto the
// self-initializing base64 builds so the bundle is ready the instant it imports.
const amgDir = here + "node_modules/@automerge/automerge/";
const stable = amgDir + "dist/mjs/entrypoints/fullfat_base64.js";
const next = amgDir + "dist/mjs/entrypoints/fullfat_next_base64.js";

mkdirSync("../vendor", { recursive: true });
await build({
  entryPoints: ["entry-history-spike.mjs"],
  bundle: true,
  format: "esm",
  outfile: "../vendor/automerge-history-spike.mjs",
  alias: {
    "@automerge/automerge": stable,
    "@automerge/automerge/slim": stable,
    "@automerge/automerge/next": next,
    "@automerge/automerge/slim/next": next,
  },
  target: "es2022",
  logLevel: "info",
});
console.log("built vendor/automerge-history-spike.mjs");
