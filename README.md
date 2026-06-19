# 🐍 pygame playground

Write ordinary [pygame](https://pyg.ame.org/) code and run it instantly in your browser —
no install, no backend. **[Open the playground →](https://partlywhole.github.io/pygame-playground/)**

Powered by [Pyodide](https://pyodide.org/) 0.27.2 + [pygame-ce](https://pyga.me/), with an AST
transform that lets plain blocking game loops (`while running:` + `clock.tick(60)`) run
cooperatively on the browser main thread:

- functions containing a game loop are converted to `async def` and their call sites awaited
- every `while` body gets a cooperative `await __yield__()` appended
- `Clock.tick` / `display.flip` / `time.delay` are monkeypatched to *bank* the frame budget,
  which the injected yield sleeps off — frame pacing without ever busy-waiting

So normal desktop pygame snippets paste in and just work. Keyboard goes to the canvas
(click it for focus), `⌘`/`Ctrl`+`Enter` runs, and tracebacks land in the on-page console.

First load downloads ~15–20 MB of Python runtime from the jsDelivr CDN; it's cached after that.

## Collaborate (live, real-time)

Click **👥 Collaborate** to start a room: the link is copied to your clipboard, and
anyone who opens it edits the same code with you — live keystrokes and colored remote
cursors, a "● Live (N)" peer count in the header. Each person still presses **Run** and
executes pygame locally in their own browser; only the code and cursors are shared.

Built on [Automerge](https://automerge.org/) (a CRDT) syncing over Automerge's free public
sync server `wss://sync.automerge.org`. Because `automerge-repo` can't be loaded from a CDN
with no build step, it ships as a committed, pre-built vendor bundle (`vendor/automerge-collab.mjs`,
built by `build/build.mjs` with esbuild) that GitHub Pages serves statically — the deployed
site stays 100% static, no backend. The bundle (~2.9 MB) loads lazily only when you start or
join a room, so the solo playground is unaffected.

Caveats: the sync server is a free community service — great for playing together,
occasionally flaky, and **anyone with the room link can edit**. Don't put anything private
in a shared room. Your solo autosaved draft is left untouched while you're in a room.

Known limitation: an infinite loop inside a helper function that never touches
`flip`/`tick`/`event.get` can't be auto-yielded and will freeze the tab — game loops and
top-level loops are always safe, and the Stop button covers those.

`verify.mjs` is a local headless-Chromium smoke test (boot, animation, input, error paths);
it expects a local server on port 8923 and a machine with Playwright's Chromium cache.
