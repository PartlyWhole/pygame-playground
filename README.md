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

## Images & sounds (your own assets)

Drop image or sound files anywhere on the page (or click the **📁** chip in the
header to browse). Uploaded files are written into the runtime's filesystem, so
ordinary pygame code loads them by name:

```python
sprite = pygame.image.load("ship.png").convert_alpha()
screen.blit(sprite, (100, 100))

pygame.mixer.init()
blip = pygame.mixer.Sound("blip.wav")
blip.play()                 # call from a key/mouse handler — see the autoplay note
```

- **Image formats:** PNG, JPG, GIF, BMP.
- **Sound formats:** **WAV and OGG only.** MP3 has no decoder in the in-browser
  audio engine (you'll see a ⚠ on MP3 uploads) — convert to WAV or OGG.
- **Autoplay:** browsers won't play audio until you interact with the page.
  Pressing **▶ Run** counts, and so does clicking the canvas; if a sound seems
  silent, click the canvas once.
- **Where they live:** uploads persist in your browser (IndexedDB) — as much as
  your browser's storage quota allows (often a few GB). The 📁 popover shows how
  much storage is used vs available and warns when you cross ~80%; if a save ever
  fails you're told the file works for that session only. Assets are **local to
  your browser** — they do not travel with 🔗 Share links or collab rooms. Use the
  popover to remove or clear them.

`test/assets.mjs` is the headless asset test battery (upload → blit → pixel,
persistence across reload, sound API path, drop-anywhere). Audio *output* can't be
checked headlessly — verify it by ear in a real browser (see below).

### Quick manual test (sprite + sound)

Upload a PNG named `sprite.png` and a WAV named `beep.wav`, then run:

```python
import pygame
pygame.init()
screen = pygame.display.set_mode((480, 320))
pygame.mixer.init()
sprite = pygame.image.load("sprite.png").convert_alpha()
beep = pygame.mixer.Sound("beep.wav")
clock = pygame.time.Clock()
x = 0
while True:
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            raise SystemExit
        if e.type == pygame.KEYDOWN:
            beep.play()                       # press a key to hear it
    screen.fill((18, 22, 30))
    x = (x + 2) % 480
    screen.blit(sprite, (x, 140))
    pygame.display.flip()
    clock.tick(60)
```

Click the canvas, press a key, and confirm you **hear** the beep and **see** the
sprite slide across — that's the manual audio-output check headless tests can't do.

Known limitation: an infinite loop inside a helper function that never touches
`flip`/`tick`/`event.get` can't be auto-yielded and will freeze the tab — game loops and
top-level loops are always safe, and the Stop button covers those.

Uploaded assets are kept in your browser only (IndexedDB); clearing site data removes them,
and they're never uploaded anywhere.

## Multiple files

Click **+** in the editor tab strip to add `.py` files. One file is the **entry**
(marked with a ▸ badge, defaults to `main.py`); **▶ Run** always runs the entry,
which can `import` the others by name. The **⋯** menu on each tab handles *set as
entry* / *rename* / *delete*.

```python
# main.py  (the entry)
import pygame
from enemy import Enemy
pygame.init()
screen = pygame.display.set_mode((480, 320))
goblin = Enemy("goblin.png")     # a normal cross-file import
clock = pygame.time.Clock()
while True:
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            raise SystemExit
    screen.fill((18, 22, 30))
    goblin.draw(screen)
    pygame.display.flip()
    clock.tick(60)
```

```python
# enemy.py
import pygame
class Enemy:
    def __init__(self, sprite):
        self.image = pygame.image.load(sprite).convert_alpha()   # returns a real value
    def draw(self, screen):
        screen.blit(self.image, (200, 140))
```

**Pacing works across files.** A game loop, `time.sleep`, or `pygame.time.wait`
inside a **module-level function** of an imported file runs cooperatively — it
paces without freezing the tab, exactly like a loop in the entry. And **pure
helper functions and classes work normally**: a call like
`self.image = sprites.load("x.png")` in a method, or a module-level
`IMG = load(...)`, returns a real value (not something you have to await).

Limitations (v1):

- **Flat files only** — no folders, packages, or subdirectories. Names are bare
  `name.py` sharing one namespace.
- **Renaming a file does not rewrite `import` statements** in other files — fix
  those references by hand (you'll get an inline reminder when you rename).
- **A game loop at a module's top level, or inside a class method, isn't
  supported.** You'll get a clear message instead of a freeze. Keep game loops in
  the entry or in a module-level function.
- **A loop/pause-bearing function must be called from the entry or another
  cooperative function.** Calling one by its bare same-module name from a class
  method or module-level code gives a friendly error; reaching it indirectly via a
  cross-module attribute (`other.run()`) or an alias is skipped, and Python prints
  a *coroutine was never awaited* warning naming the function (a rare edge — you
  don't normally call a game-loop function that way).
- **Multi-file projects are solo.** Live **👥 Collaborate** shares only the entry
  file (you'll be asked to confirm); your full project stays saved locally and
  returns when you reload. The **🔗 Share** link carries the *whole* project — but
  a very large project may exceed the URL size limit, in which case use the browser
  save instead.

`test/multifile.mjs` is the headless battery for this feature.

## Save

Click **💾 Save** (or press **⌘**/**Ctrl**+**S** with the editor focused) to download
your program. A lone file downloads as a plain `.py` (named after the entry file).
A multi-file project — or *any* project with uploaded assets — downloads as a
`pygame-project.zip` bundling all your `.py` files and assets together, so it runs
as an ordinary desktop pygame project with no missing pieces. Everything happens
client-side: the zip library ([JSZip](https://stuk.github.io/jszip/)) loads lazily
from a CDN only the first time a zip is produced, so the common single-file path
and first paint stay library-free.

`test/save.mjs` is the headless battery for this feature.

`verify.mjs` is a local headless-Chromium smoke test (boot, animation, input, error paths);
it expects a local server on port 8923 and a machine with Playwright's Chromium cache.
