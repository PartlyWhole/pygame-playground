// src/examples-data.mjs — the built-in examples (pure data; ~10% of the old index.html).
// EAGER on purpose: loadInitialProject's fallback seed reads EXAMPLES[DEFAULT_EXAMPLE] at
// boot, and the hidden #examples select (a verify.mjs seam) is populated from the keys.
// One list is the single source of truth so name/filename/source can't drift (spec §3.2 #4).
const LIST = [
  { name: "Swimming fish", filename: "swimming_fish.py", source: String.raw`# Procedural fish, after argonaut's "A simple procedural animation technique"
# https://www.youtube.com/watch?v=qlfh_rv6khY
# A chain of joints trails the head; the body is drawn around the chain.
# Move the mouse over the canvas and the fish follow it.
import pygame, math, random

W, H = 640, 480
S = 0.26                                  # fish scale
TAU = math.tau

pygame.init()
screen = pygame.display.set_mode((W, H))
pygame.display.set_caption("procedural fish")
clock = pygame.time.Clock()
overlay = pygame.Surface((W, H), pygame.SRCALPHA)

def polar(angle, length=1.0):
    return pygame.Vector2(math.cos(angle), math.sin(angle)) * length

def heading(v):
    return math.atan2(v.y, v.x)

def wrap(angle):                          # to (-pi, pi]
    return (angle + math.pi) % TAU - math.pi

def steer(angle, want, limit):            # turn angle toward want, at most limit
    return angle + max(-limit, min(limit, wrap(want - angle)))

def hsva(h, s, v):
    color = pygame.Color(0)
    color.hsva = (h % 360, s, v, 100)
    return color

def smooth(pts, steps=6):                 # closed Catmull-Rom spline through pts
    out = []
    for i in range(len(pts)):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % len(pts)], pts[(i + 2) % len(pts)]
        for k in range(steps):
            t = k / steps
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - 3 * p2 + p3 - p0) * t ** 3))
    return out

def ellipse(c, rx, ry, rot, steps=18):
    return [c + pygame.Vector2(rx * math.cos(k * TAU / steps),
                               ry * math.sin(k * TAU / steps)).rotate_rad(rot)
            for k in range(steps)]

def shape(pts, color):
    pygame.draw.polygon(screen, color, pts)
    pygame.draw.aalines(screen, (170, 185, 200), True, pts)

class Chain:                              # joints trail the head, bending at most bend per link
    def __init__(self, n, link, bend):
        self.link, self.bend = link, bend
        self.joints = [pygame.Vector2(W / 2, H / 2 + i * link) for i in range(n)]
        self.angles = [0.0] * n

    def resolve(self, head):
        self.angles[0] = heading(head - self.joints[0])
        self.joints[0] = pygame.Vector2(head)
        for i in range(1, len(self.joints)):
            self.angles[i] = steer(self.angles[i - 1],
                                   heading(self.joints[i - 1] - self.joints[i]), self.bend)
            self.joints[i] = self.joints[i - 1] - polar(self.angles[i], self.link)

class Fish:
    WIDTHS = [w * S for w in (68, 81, 84, 83, 77, 64, 51, 38, 32, 19)]

    def __init__(self, hue):
        self.hue = hue
        self.dir = 0.0
        self.spine = Chain(12, 64 * S, math.pi / 8)

    def side(self, i, off, extra=0.0):    # a point on the body edge at joint i
        return self.spine.joints[i] + polar(self.spine.angles[i] + off, self.WIDTHS[i] + extra)

    def swim(self, target):               # pursue the target with a capped turn rate
        head = self.spine.joints[0]
        self.dir = steer(self.dir, heading(target - head), 0.04)
        self.spine.resolve(head + polar(self.dir, min((target - head).length(), 8 * S)))

    def draw(self):
        j, a = self.spine.joints, self.spine.angles
        body, fin = hsva(self.hue, 85, 72), hsva(self.hue, 55, 85)
        bend = wrap(a[6] - a[0]) + wrap(a[11] - a[6])     # spine curvature flexes the fins

        for s in (1, -1):                                 # pectoral and ventral fin pairs
            shape(ellipse(self.side(3, s * math.pi / 3), 80 * S, 32 * S, a[2] - s * math.pi / 4), fin)
            shape(ellipse(self.side(7, s * math.pi / 2), 48 * S, 16 * S, a[6] - s * math.pi / 4), fin)

        web = max(-13 * S, min(13 * S, bend * 6))
        tail = ([j[i] + polar(a[i] - math.pi / 2, 1.5 * bend * (i - 8) ** 2) for i in range(8, 12)]
                + [j[i] + polar(a[i] + math.pi / 2, web) for i in reversed(range(8, 12))])
        shape(smooth(tail), fin)

        outline = ([self.side(i, math.pi / 2) for i in range(10)] + [self.side(9, math.pi)]
                   + [self.side(i, -math.pi / 2) for i in reversed(range(10))]
                   + [self.side(0, o, x) for o, x in ((-math.pi / 6, 0), (0, 4 * S), (math.pi / 6, 0))])
        shape(smooth(outline), body)

        dorsal = [j[4], j[5], j[6], j[7],
                  j[6] + polar(a[6] + math.pi / 2, wrap(a[7] - a[0]) * 16 * S),
                  j[5] + polar(a[5] + math.pi / 2, wrap(a[6] - a[0]) * 16 * S)]
        shape(smooth(dorsal), fin)

class Bubble:
    def __init__(self):
        self.respawn(random.uniform(0, H))

    def respawn(self, y=H + 10):
        self.pos = pygame.Vector2(random.uniform(0, W), y)
        self.r = random.uniform(1, 4)
        self.speed = random.uniform(0.3, 1.1)
        self.phase = random.uniform(0, TAU)
        self.alpha = random.randint(20, 60)

    def update(self):
        self.phase += 0.02
        self.pos += (math.sin(self.phase) * 0.3, -self.speed)
        if self.pos.y < -10:
            self.respawn()
        pygame.draw.circle(overlay, (180, 220, 255, self.alpha), self.pos, self.r, 1)

def caustics(t):                          # drifting light blobs on the water
    for i in range(6):
        c = pygame.Vector2(W * 0.3 + math.sin(t * 0.0003 + i * 1.2) * W * 0.3,
                           H * 0.3 + math.cos(t * 0.0004 + i * 0.9) * H * 0.3)
        r = 80 + math.sin(t * 0.001 + i) * 40
        pygame.draw.polygon(overlay, (74, 143, 184, 8), ellipse(c, r, r * 0.6, t * 0.0001 + i))

fish = [Fish(0), Fish(180)]               # a complementary pair, half an orbit apart
bubbles = [Bubble() for _ in range(30)]
ORBIT = (11 * 64 * S + max(Fish.WIDTHS) * 6) / math.pi    # both fish fit the circle comfortably
center = pygame.Vector2(W / 2, H / 2)
mouse = pygame.Vector2(center)
credit = pygame.font.Font(None, 22).render("after argonaut - youtu.be/qlfh_rv6khY", True, (255, 255, 255))
credit.set_alpha(90)

def swim_all(t):
    for k, f in enumerate(fish):
        r = ORBIT * (1 + 0.08 * math.sin(t * 0.003 + k * 0.7 * math.pi))
        f.swim(center + polar(t * 0.0009 + k * math.pi + 0.5, r))

for i in range(400):                      # warm-up so the fish start mid-glide
    swim_all(i * 16.0)

t = 0.0
while True:
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            raise SystemExit
        if e.type == pygame.MOUSEMOTION:
            mouse.update(e.pos)

    center += (mouse - center) * 0.03
    swim_all(t)

    screen.fill((10, 22, 40))
    overlay.fill((0, 0, 0, 0))
    caustics(t)
    for b in bubbles:
        b.update()
    screen.blit(overlay, (0, 0))
    for f in reversed(fish):
        f.draw()
        f.hue += 0.2                      # the pair drifts around the color wheel together
    screen.blit(credit, credit.get_rect(midbottom=(W // 2, H - 10)))

    pygame.display.flip()
    t += clock.tick(60)
`},
  { name: "Bouncy balls", filename: "bouncy_balls.py", source: String.raw`import pygame, random

pygame.init()
screen = pygame.display.set_mode((640, 480))
pygame.display.set_caption("bouncy balls")
clock = pygame.time.Clock()

balls = []
for i in range(14):
    balls.append({
        "x": random.randint(40, 600), "y": random.randint(40, 440),
        "vx": random.choice([-4, -3, 3, 4]), "vy": random.choice([-4, -3, 3, 4]),
        "r": random.randint(10, 26),
        "c": (random.randint(80, 255), random.randint(80, 255), random.randint(80, 255)),
    })

running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False

    for b in balls:
        b["x"] += b["vx"]
        b["y"] += b["vy"]
        if b["x"] < b["r"] or b["x"] > 640 - b["r"]: b["vx"] *= -1
        if b["y"] < b["r"] or b["y"] > 480 - b["r"]: b["vy"] *= -1

    screen.fill((18, 18, 26))
    for b in balls:
        pygame.draw.circle(screen, b["c"], (int(b["x"]), int(b["y"])), b["r"])
    pygame.display.flip()
    clock.tick(60)
`},
  { name: "Arrow-key square", filename: "arrow_key_square.py", source: String.raw`# Click the canvas first so it gets keyboard focus!
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 480))
clock = pygame.time.Clock()

x, y, size, speed = 320.0, 240.0, 36, 5
trail = []

while True:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            raise SystemExit

    keys = pygame.key.get_pressed()
    if keys[pygame.K_LEFT]:  x -= speed
    if keys[pygame.K_RIGHT]: x += speed
    if keys[pygame.K_UP]:    y -= speed
    if keys[pygame.K_DOWN]:  y += speed
    x = max(size, min(640 - size, x))
    y = max(size, min(480 - size, y))

    trail.append((x, y))
    if len(trail) > 30:
        trail.pop(0)

    screen.fill((14, 16, 22))
    for i, (tx, ty) in enumerate(trail):
        s = int(size * i / len(trail))
        pygame.draw.rect(screen, (40 + 5 * i, 60, 90),
                         (tx - s / 2, ty - s / 2, s, s), border_radius=6)
    pygame.draw.rect(screen, (120, 220, 160),
                     (x - size / 2, y - size / 2, size, size), border_radius=8)
    pygame.display.flip()
    clock.tick(60)
`},
  { name: "Mouse painter", filename: "mouse_painter.py", source: String.raw`# Hold the mouse button and drag to paint. Press C to clear.
import pygame, math

pygame.init()
screen = pygame.display.set_mode((640, 480))
clock = pygame.time.Clock()
screen.fill((16, 16, 22))
hue = 0

while True:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            raise SystemExit
        if event.type == pygame.KEYDOWN and event.key == pygame.K_c:
            screen.fill((16, 16, 22))

    if pygame.mouse.get_pressed()[0]:
        mx, my = pygame.mouse.get_pos()
        hue = (hue + 2) % 360
        color = pygame.Color(0)
        color.hsva = (hue, 90, 100, 100)
        pygame.draw.circle(screen, color, (mx, my), 12)

    pygame.display.flip()
    clock.tick(120)
`},
  { name: "Starfield", filename: "starfield.py", source: String.raw`import pygame, random

pygame.init()
W, H = 640, 480
screen = pygame.display.set_mode((W, H))
clock = pygame.time.Clock()

stars = [[random.uniform(-W, W), random.uniform(-H, H), random.uniform(1, W)]
         for _ in range(220)]

while True:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            raise SystemExit

    screen.fill((4, 5, 12))
    for s in stars:
        s[2] -= 6
        if s[2] <= 1:
            s[0], s[1], s[2] = random.uniform(-W, W), random.uniform(-H, H), W
        sx = int(W / 2 + s[0] / s[2] * 240)
        sy = int(H / 2 + s[1] / s[2] * 240)
        if 0 <= sx < W and 0 <= sy < H:
            b = int(255 * (1 - s[2] / W))
            r = 2 if s[2] < W / 3 else 1
            pygame.draw.circle(screen, (b, b, min(255, b + 40)), (sx, sy), r)

    pygame.display.flip()
    clock.tick(60)
`},
  { name: "Snake", filename: "snake.py", source: String.raw`# Arrow keys to steer. R restarts after game over. (Click the canvas first!)
import pygame, random

CELL, COLS, ROWS = 20, 32, 24

def main():
    pygame.init()
    screen = pygame.display.set_mode((COLS * CELL, ROWS * CELL))
    clock = pygame.time.Clock()
    font = pygame.font.Font(None, 42)

    while True:  # one iteration per game
        snake = [(COLS // 2, ROWS // 2)]
        d = (1, 0)
        food = (random.randrange(COLS), random.randrange(ROWS))
        score, alive = 0, True

        while alive:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    raise SystemExit
                if event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_LEFT  and d != (1, 0):  d = (-1, 0)
                    if event.key == pygame.K_RIGHT and d != (-1, 0): d = (1, 0)
                    if event.key == pygame.K_UP    and d != (0, 1):  d = (0, -1)
                    if event.key == pygame.K_DOWN  and d != (0, -1): d = (0, 1)

            head = (snake[0][0] + d[0], snake[0][1] + d[1])
            if (head in snake or not (0 <= head[0] < COLS) or not (0 <= head[1] < ROWS)):
                alive = False
            else:
                snake.insert(0, head)
                if head == food:
                    score += 1
                    food = (random.randrange(COLS), random.randrange(ROWS))
                else:
                    snake.pop()

            screen.fill((15, 18, 15))
            fx, fy = food
            pygame.draw.rect(screen, (235, 90, 90), (fx * CELL + 2, fy * CELL + 2, CELL - 4, CELL - 4), border_radius=6)
            for i, (sx, sy) in enumerate(snake):
                g = max(90, 210 - i * 6)
                pygame.draw.rect(screen, (70, g, 90), (sx * CELL + 1, sy * CELL + 1, CELL - 2, CELL - 2), border_radius=4)
            img = font.render(str(score), True, (200, 210, 200))
            screen.blit(img, (10, 6))
            pygame.display.flip()
            clock.tick(9 + score // 3)

        # game over screen
        img = font.render(f"Game over — {score} points. Press R", True, (240, 220, 180))
        screen.blit(img, img.get_rect(center=(COLS * CELL // 2, ROWS * CELL // 2)))
        pygame.display.flip()
        waiting = True
        while waiting:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    raise SystemExit
                if event.type == pygame.KEYDOWN and event.key == pygame.K_r:
                    waiting = False
            clock.tick(30)

main()
`}
];

export const EXAMPLES = Object.freeze(Object.fromEntries(LIST.map(e => [e.name, e.source])));
export const EXAMPLE_FILENAME = Object.freeze(Object.fromEntries(LIST.map(e => [e.name, e.filename])));
export const DEFAULT_EXAMPLE = LIST[0].name;   // "Swimming fish" — the boot seed

if (typeof window !== "undefined") {
  window.EXAMPLES = EXAMPLES;                    // PINNED test seam (examples.mjs; verify.mjs 'Snake')
  window.EXAMPLE_FILENAME = EXAMPLE_FILENAME;    // transitional mirror (legacy bare refs) — Plan 4 retires
  window.DEFAULT_EXAMPLE = DEFAULT_EXAMPLE;      // transitional mirror — Plan 4 retires
}
