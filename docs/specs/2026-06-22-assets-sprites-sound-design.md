# Sprites & sound (uploadable assets) — design

**Date:** 2026-06-22 · **Status:** approved, pre-implementation
**App:** pygame playground (single static `index.html` on GitHub Pages,
https://partlywhole.github.io/pygame-playground/)

## Goal

Let users run pygame programs that load their own images and sounds —
`pygame.image.load("ship.png")`, `pygame.mixer.Sound("blip.wav")`,
`pygame.mixer.music.load(...)` — entirely in the browser, no backend. Users
**upload** files; the files land in Pyodide's in-memory filesystem (MEMFS) so the
ordinary pygame API resolves them by name.

Non-goals: a built-in/starter asset pack; loading assets from a URL; sharing
assets through `#code=` links or collab rooms. (All explicitly decided against —
see Decisions.)

## What the spike proved (real headless Chromium, pygame-ce on Pyodide 0.27.2)

Two throwaway spikes (`test/spike-assets.mjs`, `test/spike-formats.mjs`) ran in
real headless Chromium before this design. Findings — these are load-bearing:

- **Images work fully.** `pygame.image.load` decodes PNG/JPG/GIF (BMP native);
  `convert_alpha()` preserves alpha; blits land on the visible canvas
  (pixel-verified). SDL_image is present with PNG+JPG codecs.
- **Sound works** — the high-risk unknown is de-risked. `pygame.mixer.init()` →
  `(48000, -16, 2)`; `Sound("x.wav").play()` returns a live Channel
  (`get_busy()==True`); SDL creates a Web Audio `AudioContext` (via a
  deprecated-but-functional `ScriptProcessorNode`).
- **🔑 Assets MUST be real files in MEMFS.** `pygame.image.load(io.BytesIO(...))`
  fails hard: `RuntimeError("can't access resource on platform")`. Same lesson for
  sound. So the only viable bridge is: write user bytes to a MEMFS file, then load
  by name. This is exactly what desktop pygame code already expects.
- **Sound formats: WAV and OGG/Vorbis decode; MP3 does NOT.** MP3 →
  `"Unrecognized audio format"` (no codec in this build). Verified with a real
  Vorbis file (a fixture bug initially produced FLAC-in-Ogg and gave a false
  negative — corrected using pygame's own `examples/data/house_lo.ogg`).
- **Autoplay:** headless Chromium is permissive (context `running` with no
  gesture), so it cannot reproduce the headed-browser restriction where an
  `AudioContext` starts suspended until a user gesture. Run is a click (a gesture),
  so we resume on Run; the actual "you hear the beep" check is manual.

## Decisions (locked)

- **Input model: upload only.** Drag-drop anywhere on the page + a click-to-browse
  fallback. No bundled/starter pack, no load-from-URL.
- **Persistence: IndexedDB.** Uploaded files persist across reloads, re-hydrated
  into MEMFS on each boot. (localStorage is ~5 MB and already holds the code;
  IndexedDB handles binary and is far larger.)
- **Sharing: local-only.** Assets live only in the local browser's IndexedDB.
  `#code=` links and collab rooms keep syncing **code only**, exactly as today —
  no regression risk, no CRDT/URL bloat. A shared program that loads `ship.png`
  expects the recipient to upload their own `ship.png`.
- **UI: drop-anywhere + header chip.** A `📁 N` chip in the header opens a compact
  popover (browse, file list, remove, clear-all). No always-on panel.
- **No new examples-dropdown entry.** The feature is documented with a usage
  snippet in the README; a paste-in sprite+sound test program is provided in the
  handoff and exercised by the test harness. (User decision — keeps shipped
  surface small.)
- **Formats:** images PNG/JPG/GIF/BMP; sound **WAV/OGG only** (warn on MP3/M4A).
- **Size budget:** ~~10 MB per file, 64 MB total; oversize rejected~~ —
  **superseded 2026-06-22 (post-deploy, at user request):** no app-imposed cap.
  The popover shows real browser storage used vs available (Storage API
  `navigator.storage.estimate()`), warns at ~80% full, and a failed save degrades
  to session-only with a message.
- **Name collision:** a new upload with an existing name **overwrites** it (noted
  in the UI).

## Architecture

All additions live inside `index.html` (single static file preserved). The asset
machinery is lazy and cheap: it adds no work to first paint, and a user who never
uploads anything sees the existing solo path unchanged. Three small units:

### 1. `assetStore` — IndexedDB persistence

A self-contained object wrapping one IndexedDB database.

- DB `pygame-playground`, object store `assets`, `keyPath: "name"`.
- Record: `{ name, bytes: ArrayBuffer, type: string, size: number, addedAt: number }`.
- API: `getAll()`, `put(name, bytes, type)`, `remove(name)`, `clear()`,
  `totalSize()` (sum of sizes, cached in memory after first load).
- Opened lazily; `getAll()` is called once during boot to rehydrate. Empty store =
  negligible cost. All methods Promise-based, failures swallowed to a safe default
  (same defensive pattern as the existing `storage` localStorage wrapper).

**What it does:** durably stores uploaded bytes by filename. **How you use it:**
add/remove/list. **Depends on:** IndexedDB only.

### 2. `assetFS` — the MEMFS bridge

Glue between `assetStore`, Pyodide's FS, and the UI. Keeps MEMFS in sync so user
code resolves assets by name.

- `hydrateAll()` — after pygame import on boot, write every stored asset into MEMFS
  (`pyodide.FS.writeFile(name, new Uint8Array(bytes))`) at the FS working
  directory that `pygame.image.load("name")` resolves against (the spike confirmed
  cwd-relative `open()`/`load()` round-trips; an implementation test pins this).
- `add(file)` — validate (size budget, surface a format warning), read bytes,
  `assetStore.put(...)`, write to MEMFS, refresh UI. Overwrites on name collision.
- `remove(name)` — `assetStore.remove(...)` + `pyodide.FS.unlink(name)` (guarded)
  + refresh UI.
- `clear()` — clear store + unlink all + refresh.

MEMFS persists for the page session across Runs (it is independent of
`pygame.quit()` / re-init — the existing verify battery already re-runs cleanly),
so assets are written once per session, not per Run.

**Depends on:** `assetStore`, the booted `pyodide`.

### 3. Asset UI — drop-anywhere + chip + popover

- **Whole-window drag-drop:** `dragover`/`dragleave`/`drop` listeners on the
  document; a translucent "Drop files to add" overlay shown during a drag; on drop,
  each `File` → `assetFS.add(file)`.
- **Header chip `📁 N`:** placed by the existing header buttons; `N` = asset count.
  Click opens a small popover anchored to it.
- **Popover:** a "browse" button (triggers a hidden `<input type="file" multiple>`),
  a scrollable file list (each row: `name` · human size · remove ✕, plus a ⚠ badge
  + tooltip for unsupported audio like MP3), a "used X.X / 64 MB" line, and a
  "Clear all" button.
- All asset DOM/CSS is additive; the chip is the only always-visible new element.
  It always shows (so click-to-browse is discoverable even at zero assets): a plain
  `📁` when empty, `📁 N` once files exist.

### Audio autoplay unlock

In `boot()`, **before** `loadPackage("pygame-ce")`, install a transparent
`AudioContext` capture shim (`new Proxy(AudioContext, { construct })`) that pushes
each created context to an array — the spike confirmed this captures SDL's context.
On the Run click and on canvas click (both real user gestures), call `.resume()` on
all captured contexts. This is belt-and-suspenders with SDL's own
resume-on-first-input listener. The shim only matters once `mixer` is used and is
otherwise inert.

## Data flow

```
upload (drop / browse)
  └─ assetFS.add(file)
       ├─ validate size  ─► reject + message if over budget
       ├─ read ArrayBuffer
       ├─ assetStore.put(name, bytes, type)   (IndexedDB)
       ├─ pyodide.FS.writeFile(name, bytes)   (MEMFS, if booted)
       └─ refresh chip + popover

boot()
  └─ after pygame import ─► assetFS.hydrateAll()  (IndexedDB → MEMFS)

Run (▶, user gesture)
  ├─ resume captured AudioContext(s)
  └─ user code: pygame.image.load("ship.png"), pygame.mixer.Sound("blip.wav")
```

## Error handling

- **Over budget / read error:** rejected in `assetFS.add`, message in the popover
  and a console `sys` line; nothing written.
- **Unsupported audio (MP3/M4A):** stored anyway (valid bytes), shown with a ⚠
  badge + tooltip. If user code then `Sound("x.mp3")`, pygame raises its own error,
  which already routes to the on-page console — acceptable and self-explanatory.
- **Missing asset at load:** user code referencing a not-uploaded name raises a
  normal pygame error in the console (no special handling; the chip shows what's
  available).
- **IndexedDB unavailable** (private mode, quota): `assetStore` degrades to
  session-only — adds still write to MEMFS so the current session works; persistence
  silently no-ops, matching the existing localStorage wrapper's swallow-and-continue.
- **Pyodide not yet booted when a file is dropped:** queue to MEMFS after `booted`
  resolves (the file is already safe in IndexedDB); `hydrateAll()` covers it anyway.

## Testing (TDD)

New `test/assets.mjs` (same harness as `verify.mjs`, real headless Chromium),
reusing committed fixtures (`test/fixtures.mjs`: a real PNG, WAV, OGG):

1. **Upload → blit → pixel.** `setInputFiles` a PNG through the real hidden
   file-input → run code that `image.load` + `convert_alpha` + `blit` → assert the
   canvas pixel at the blit site became the sprite color.
2. **Persistence.** After upload, reload the page → assert the asset rehydrated
   (chip shows it; a program that loads it succeeds), proving IndexedDB → MEMFS.
3. **Sound API path.** Upload a WAV → run `mixer.init` + `Sound(...).play()` →
   assert no exception and an `AudioContext` exists. (Audio output documented as a
   manual check — not headlessly verifiable.)
4. **Format warning.** Adding an `.mp3` surfaces the ⚠ flag.
5. **Non-regression.** The existing `verify.mjs` 11-step battery stays green, run
   unchanged.

Tests drive the real UI: the hidden file-input is real DOM, so Playwright's
`setInputFiles` exercises the actual upload path with no app-internal test hook.

## Manual verification (documented for the deploy step)

In a real (headed) browser: upload a WAV, run a program that plays it on a key
press, **confirm the sound is audible**, and confirm the `AudioContext` reaches
`running` after the Run click. This covers what headless cannot.

## Constraints preserved

Single static file, no backend, no build step, no API keys. Asset machinery is
lazy and additive — no first-paint cost when unused. Existing
code-persistence/share/collab paths are untouched (assets are local-only).
