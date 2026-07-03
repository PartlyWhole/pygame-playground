// src/lessons-data.mjs — declarative lesson + friendly-error content (pure data).
// EAGER and assigned to window EXACTLY ONCE at module eval: test/lessons.mjs REPLACES
// window.LESSONS wholesale and then calls window.renderLessons() — a late (re-)assignment
// would clobber the test's array (spec red-flag §3.2 #5). The renderer re-reads
// window.LESSONS on every call; nothing may capture this module's binding.
// NOT frozen: the whole-array replacement contract implies callers own the value.

// Declarative lesson content (data, not code) so non-engineers can author lessons by editing this.
// L1 seeds id/title stubs (steps:[]); the five-phase step content (Concept→Demo→Tweak→Recreate→
// Verify) arrives in L6. Rendered as a calm list in the Lessons rail view — pure DOM, so opening the
// panel costs nothing at first paint (no Pyodide/ruff/Automerge).
window.LESSONS = [
  { id: "lesson-0", title: "Welcome", steps: [
    { phase: "concept", text: "This first lesson is about the workshop itself — not pygame yet. The rhythm never changes: change one small thing, say what you think will happen, press Start, then look at the canvas. Press End to stop and start over. Nothing here is timed, and nothing can break." },
    { phase: "demo", file: "demo_lesson0.py", instruction: "Press Start and watch — a small window fills with a near-black blue. That's your first run: you pressed Start, and the screen changed.",
      source: `# The workshop. Read it top to bottom, then press Start.
import pygame

WIDTH, HEIGHT = 400, 300
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))

blue = 40                  # <- the number we'll play with
screen.fill((0, 0, blue))  # paint the whole canvas: (red, green, blue)
pygame.display.flip()      # show what we painted
` },
    { phase: "tweak", instruction: "Change blue = 40 to blue = 255 (the brightest a colour goes). Pick your prediction below — that unlocks Start — then press Start and compare.",
      predict: { mode: "choices", prompt: "After you raise blue to 255 and press Start, the canvas will be…",
        choices: ["A much brighter, fuller blue", "Exactly the same dark blue", "The window turns red", "An error — 255 is too big"] } },
    { phase: "recreate", referenceFile: "demo_lesson0.py", instruction: "Press End (watch the canvas clear — End is always safe), then set blue to a new number of your choice between 0 and 255, and Start again. You're practising the rhythm, not learning pygame yet.",
      scaffold: `# Press End (the canvas clears), pick a NEW blue, predict, then Start again.
import pygame

WIDTH, HEIGHT = 400, 300
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))

blue = 120                 # <- pick any NEW number, 0-255
screen.fill((0, 0, blue))
pygame.display.flip()
` },
    { phase: "verify", prompt: "Did the blue brighten when you raised the number, and did End clear the canvas while Start brought a fresh paint back? If yes, you've got the rhythm — change, Start, look, End — and it carries every lesson from here. Mark done." },
  ] },

  { id: "warmup-0a", title: "Draw once", steps: [
    { phase: "concept", text: "Today we draw on the screen exactly once. The new idea hides in set_mode: a SIZE is not two loose numbers — it is ONE value made of two, a (width, height) pair. The COMMA makes the pair; the parentheses just keep it tidy. set_mode wants to be handed that ONE pair." },
    { phase: "demo", file: "demo_0a.py", instruction: "Press Start. The window opens, fills with dark blue, and almost instantly disappears. That's correct — the program drew once, reached the end, and stopped. Nothing told it to stay.",
      source: `# Draw once, then stop. Watch the window flash open and disappear.
import pygame

WIDTH, HEIGHT = 800, 600
pygame.init()
WINDOW_SIZE = (WIDTH, HEIGHT)                  # build the pair, name it
screen = pygame.display.set_mode(WINDOW_SIZE)  # hand set_mode ONE thing
screen.fill((20, 30, 80))                      # a colour is also a bundle (r, g, b)
pygame.display.flip()                          # show what we painted
` },
    { phase: "tweak", instruction: "Now the deliberate mistake — the real lesson. Change the set_mode line to hand it two LOOSE numbers: screen = pygame.display.set_mode(WIDTH, HEIGHT) (remove the pair). Predict, then Start, and read the message out loud.",
      predict: { mode: "choices", prompt: "set_mode(WIDTH, HEIGHT) — two loose numbers instead of one pair. On Start…",
        choices: ["It crashes: 'size must be two numbers'", "A wider window opens — two numbers is fine", "It says 'too many arguments'", "A blank window, no error"] } },
    { phase: "recreate", referenceFile: "demo_0a.py", instruction: "Write it yourself: build the pair, hand set_mode ONE thing, fill, flip. Fill the blanks (___). 'Show the demo' puts the reference beside your work without erasing it. It should flash open and disappear, like the demo.",
      scaffold: `import pygame

WIDTH, HEIGHT = 800, 600
pygame.init()

# A) build the size pair (the COMMA makes the pair; parens keep it tidy)
WINDOW_SIZE = ___

# B) hand set_mode ONE thing — the pair
screen = pygame.display.set_mode(___)

# C) fill the window with a colour (a TRIPLE: r, g, b) — same pattern, three parts
screen.fill(___)

# D) show what we painted
pygame.display.___()
` },
    { phase: "verify", prompt: "When you Start, does a window open, fill, and then disappear? Point at the line where you built the PAIR — is the comma there doing its real job, and is set_mode handed exactly ONE thing? The disappearing is the itch we fix next (0b). Mark done." },
  ] },

  { id: "warmup-0b", title: "Make it move", steps: [
    { phase: "concept", text: "Last time the window flashed and died. This time we keep it alive with a LOOP: 'while True:' runs the lines underneath, then goes back to the top — over and over. Each trip is one frame. The new trick: keep one number, blue, and make it one bigger every trip (blue = blue + 1). As blue climbs, the colour (0, 0, blue) gets stronger. A loop that repeats + one number that changes is the secret behind all motion." },
    { phase: "demo", file: "demo_0b.py", instruction: "Press Start and watch for a few seconds — there's nothing to press. The screen fades, slowly getting more blue: proof the loop is running and blue is climbing. After a while it crashes on purpose (we fix that in 0c). Use End to stop it any time.",
      source: `import pygame

WINDOW_SIZE = (800, 600)
FPS = 60                       # paces the loop (we'll turn this knob in a minute)
pygame.init()
screen = pygame.display.set_mode(WINDOW_SIZE)
clock = pygame.time.Clock()

blue = 0                       # our one changing number
while True:
    blue = blue + 1            # a little bigger every frame
    screen.fill((0, 0, blue))  # paint (red, green, blue)
    pygame.display.flip()      # show it
    clock.tick(FPS)            # the metronome — paces the loop
` },
    { phase: "tweak", instruction: "Turn the metronome knob: change FPS = 60 to FPS = 10. The colour rule is unchanged — blue still goes up by 1 each frame — only the timing changes. Predict, then Start.",
      predict: { mode: "choices", prompt: "With FPS 60 → 10 (blue still +1 per frame), what changes on screen?",
        choices: ["The fade is SLOWER — it creeps up, and crashes later", "The fade is FASTER and crashes sooner", "Nothing changes — FPS doesn't affect the colour", "The colours come out different (red or green)"] } },
    { phase: "recreate", referenceFile: "demo_0b.py", instruction: "Write the four lines INSIDE the loop, in order: make blue one bigger; fill with (0, 0, blue); flip; tick the clock at FPS. The SHAPE is what matters. 'Show the demo' peeks without erasing your work.",
      scaffold: `import pygame

WINDOW_SIZE = (800, 600)
FPS = 60
pygame.init()
screen = pygame.display.set_mode(WINDOW_SIZE)
clock = pygame.time.Clock()

blue = 0
while True:
    # 1) make blue one bigger
    ___
    # 2) fill the screen with (0, 0, blue)
    ___
    # 3) show it
    ___
    # 4) tick the clock at FPS
    ___
` },
    { phase: "verify", prompt: "Does your screen start dark and slowly fade toward blue? Can you point to the ONE line that makes the number change each frame? Say it: 'a loop on its own is not motion — motion is a number changing between frames.' Mark done. Next (0c) fixes the crash with a single guard line." },
  ] },

  { id: "warmup-0c", title: "Keep it looping", steps: [
    { phase: "concept", text: "Last time the fade CRASHED: blue kept climbing past 255, but a colour channel is only allowed 0–255. The new tool: when a value crosses a limit, correct it. Every frame we ask ONE question — has blue gone past 255? — and if yes, put it back to 0. One question, one fix. That turns the one-shot fade into a fade that repeats forever (a sawtooth)." },
    { phase: "demo", file: "demo_0c.py", instruction: "Press Start. The screen brightens to blue, snaps back to black, and brightens again — forever, never crashing. That snap-back is the guard firing the instant blue passed 255. Use End to stop.",
      source: `import pygame

pygame.init()
WINDOW_SIZE = (800, 600)
screen = pygame.display.set_mode(WINDOW_SIZE)
clock = pygame.time.Clock()
FPS = 60

blue = 0
while True:
    blue += 1
    if blue > 255:        # has the value crossed the limit?
        blue = 0          # yes -> correct it
    screen.fill((0, 0, blue))
    pygame.display.flip()
    clock.tick(FPS)
` },
    { phase: "tweak", instruction: "Change the reset value: make the guard's blue = 0 into blue = 200. Predict where the fade falls back TO, then Start.",
      predict: { mode: "choices", prompt: "With the guard resetting to 200 instead of 0…",
        choices: ["It fades between a dim blue and full blue — never reaching black", "Exactly the same as before", "It crashes — 200 isn't allowed", "It freezes on solid blue"] } },
    { phase: "recreate", referenceFile: "demo_0c.py", instruction: "Only the GUARD is missing. Write the two lines: the question (is blue past 255?) and the fix (put blue back to 0) indented under it. Say the shape: 'when a value crosses a limit, correct it.' 'Show the demo' keeps your work safe while you peek.",
      scaffold: `import pygame

pygame.init()
WINDOW_SIZE = (800, 600)
screen = pygame.display.set_mode(WINDOW_SIZE)
clock = pygame.time.Clock()
FPS = 60

blue = 0
while True:
    blue += 1
    # the guard: when a value crosses a limit, correct it (one question, one fix)
    # 1) the question: has blue crossed the limit 255?
    ___
    # 2) the fix (indented under the question): put blue back to 0
    ___
    screen.fill((0, 0, blue))
    pygame.display.flip()
    clock.tick(FPS)
` },
    { phase: "verify", prompt: "Does the screen brighten, snap to black, and brighten again — forever, without ever crashing? Can you point to the two lines that ARE the guard? You now own a tool you'll reuse — correcting a value when it crosses a limit (later it stops a falling player at the floor). Mark done." },
  ] },
];
// Friendly-error map (declarative): a known runtime error is rewritten in the instructor's
// encouraging voice — framed as "the computer telling us the exact rule we crossed," never failure.
// The original traceback is ALWAYS preserved and the line number is ALWAYS re-attached (locating the
// line is part of the skill). First matching entry wins; unmapped errors fall through untouched.
window.FRIENDLY_ERRORS = [
  { match: /size must be two numbers/,
    say: "set_mode wants ONE thing: a (width, height) pair in parentheses — like set_mode((800, 600)). It looks like you passed two separate numbers." },
  { match: /NameError: name '([^']+)' is not defined/,
    say: "Python doesn't recognize that name yet. Check the spelling, or make sure it's defined (with =) above the line that uses it." },
  { match: /(SyntaxError|IndentationError)/,
    say: "Python couldn't read this line as a valid instruction — look for a typo, a missing ':' '(' ')' or quote, or indentation that doesn't line up." },
];

export const LESSONS = window.LESSONS;                 // module-side handles (same objects)
export const FRIENDLY_ERRORS = window.FRIENDLY_ERRORS;
