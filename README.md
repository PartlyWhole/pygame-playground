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

Known limitation: an infinite loop inside a helper function that never touches
`flip`/`tick`/`event.get` can't be auto-yielded and will freeze the tab — game loops and
top-level loops are always safe, and the Stop button covers those.

`verify.mjs` is a local headless-Chromium smoke test (boot, animation, input, error paths);
it expects a local server on port 8923 and a machine with Playwright's Chromium cache.
