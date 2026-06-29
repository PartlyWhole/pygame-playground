// vendor/engine.mjs — cooperative pygame engine (hand-authored, no build step).
//
// Refactor Option D. Extracted VERBATIM from index.html. This module is loaded by a
// dynamic import() cached-promise gate (mirrors vendor/automerge-collab.mjs), so it adds
// no first-paint cost. It knows only Pyodide, a canvas element, a status-token callback,
// a log sink, and plain string/dict program snapshots — never project/renderTabs/collab/
// assetFS or any DOM id. The Python below is byte-identical to the original index.html
// source; do not reformat (String.raw stops backslash + brace processing; there are no
// ${ } interpolations). P1 = these two consts only; createEngine() arrives in P2/P3.
//
// CRITICAL: the host (index.html) keeps a classic <script> and a top-level `let pyodide`
// holding the booted instance, because ~40 tests reach the interpreter by BARE NAME
// `pyodide` (not window.pyodide). Do not change that seam.

export const BOOT_PY = String.raw`
import os, ast, asyncio, traceback, copy, time as _time

import pygame

_state = {"task": None, "delay": 0.0, "flipped": False, "ticked": False, "n": 0, "via_project": False, "flips": 0}

# +PAUSE (S3): a gate the cooperative loop awaits at the top of every frame.
# set() == running, clear() == paused. Created already-set so the un-paused path
# is a cheap no-op. Shared by single-file (_run) AND project (_run_project) loops
# because both bind the SAME __yield__ — one gate covers both engines.
_pause_gate = asyncio.Event()
_pause_gate.set()
_state["paused"] = False

def _flag_flip(fn):
    def wrapper(*a, **k):
        _state["flipped"] = True
        _state["flips"] += 1          # frame counter the host watchdog reads to detect a stage stall
        return fn(*a, **k)
    return wrapper

pygame.display.flip = _flag_flip(pygame.display.flip)
pygame.display.update = _flag_flip(pygame.display.update)

class _Clock:
    """tick() never busy-waits: it banks the frame budget, which the injected
    loop yield sleeps off cooperatively."""
    def __init__(self):
        self._last = pygame.time.get_ticks()
        self._dt = 0
    def tick(self, fps=0):
        now = pygame.time.get_ticks()
        self._dt, self._last = now - self._last, now
        _state["ticked"] = True
        if fps:
            _state["delay"] = max(0.0, 1.0 / fps - self._dt / 1000.0)
        return self._dt
    tick_busy_loop = tick
    def get_time(self): return self._dt
    get_rawtime = get_time
    def get_fps(self): return 1000.0 / self._dt if self._dt else 0.0
pygame.time.Clock = _Clock

# Pyodide's time.sleep busy-waits the browser main thread. Statement-level
# sleeps become real awaits via _Awaiter below; banking is the no-freeze
# fallback for sleeps buried in sync helper functions.
def _bank(secs):
    try:
        _state["delay"] += max(0.0, float(secs))
    except Exception:
        pass

def _wait_ms(ms):
    _bank(ms / 1000.0)
    return int(ms)

pygame.time.delay = pygame.time.wait = _wait_ms
_time.sleep = _bank

async def __sleep__(secs):
    try:
        secs = max(0.0, float(secs))
    except Exception:
        secs = 0.0
    await asyncio.sleep(secs)

async def __yield__():
    await _pause_gate.wait()              # +PAUSE (S3): blocks here only while paused; else returns instantly
    d, ticked, flipped = _state["delay"], _state["ticked"], _state["flipped"]
    _state.update(delay=0.0, ticked=False, flipped=False)
    if d > 0:
        await asyncio.sleep(d)
    elif ticked:
        await asyncio.sleep(0)
    elif flipped:
        await asyncio.sleep(1 / 60)       # flip but no tick: default to ~60fps
    else:
        _state["n"] += 1
        if _state["n"] % 256 == 0:        # plain compute loop: yield occasionally
            await asyncio.sleep(0)

# ---- source transform: plain pygame code -> cooperative async ----

_YIELD = ast.parse("await __yield__()").body[0]

def _shallow(node):
    """Walk child nodes without crossing into nested function/class scopes."""
    stack = list(ast.iter_child_nodes(node))
    while stack:
        n = stack.pop()
        yield n
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            stack.extend(ast.iter_child_nodes(n))

def _is_gameloop(loop):
    for n in _shallow(loop):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
            f = n.func
            owner = f.value.attr if isinstance(f.value, ast.Attribute) else None
            if (f.attr in ("flip", "tick", "tick_busy_loop")
                    or (f.attr, owner) == ("update", "display")
                    or (f.attr in ("get", "poll", "wait") and owner == "event")):
                return True
    return False

def _time_names(tree):
    """Names the user's code binds to the time module / time.sleep."""
    mods, sleeps = set(), set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            mods.update(a.asname or "time" for a in n.names if a.name == "time")
        elif isinstance(n, ast.ImportFrom) and n.module == "time":
            sleeps.update(a.asname or "sleep" for a in n.names if a.name == "sleep")
    return mods, sleeps

class _SyncBarrier(ast.NodeTransformer):
    """Base for the passes below: never descend into sync defs or classes,
    where an inserted await would be a syntax error."""
    def visit_FunctionDef(self, node): return node
    def visit_ClassDef(self, node): return node

class _Asyncify(_SyncBarrier):
    """def f(): while ...flip()...  ->  async def f(), remembering names."""
    def __init__(self):
        self.converted = set()
    def visit_FunctionDef(self, node):
        if any(isinstance(n, ast.While) and _is_gameloop(n) for n in _shallow(node)):
            node.__class__ = ast.AsyncFunctionDef
            self.converted.add(node.name)
        return node

class _Awaiter(_SyncBarrier):
    """Statement-level rewrites in async contexts:
       main()                        -> await main()      (converted functions)
       asyncio.run(x)                -> await x
       time.sleep(s)                 -> await __sleep__(s)
       pygame.time.wait|delay(ms)    -> await __sleep__(ms / 1000)"""
    def __init__(self, converted, time_mods, sleep_names):
        self.converted, self.time_mods, self.sleep_names = converted, time_mods, sleep_names
    @staticmethod
    def _sleep(secs):
        return ast.Call(func=ast.Name("__sleep__", ast.Load()), args=[secs], keywords=[])
    def visit_Expr(self, node):
        self.generic_visit(node)
        v = node.value
        if not isinstance(v, ast.Call):
            return node
        f, simple = v.func, len(v.args) == 1 and not v.keywords
        target = None
        if isinstance(f, ast.Name):
            if f.id in self.converted:
                target = v
            elif simple and f.id in self.sleep_names:
                target = self._sleep(v.args[0])
        elif isinstance(f, ast.Attribute):
            owner = f.value
            if f.attr == "run" and isinstance(owner, ast.Name) and owner.id == "asyncio" and v.args:
                target = v.args[0]
            elif simple and f.attr == "sleep" and isinstance(owner, ast.Name) and owner.id in self.time_mods:
                target = self._sleep(v.args[0])
            elif simple and f.attr in ("wait", "delay") and isinstance(owner, ast.Attribute) and owner.attr == "time":
                target = self._sleep(ast.BinOp(left=v.args[0], op=ast.Div(), right=ast.Constant(1000.0)))
        if target is not None:
            node.value = ast.copy_location(ast.Await(value=target), v)
        return node

class _InjectYield(_SyncBarrier):
    """Insert 'await __yield__()' at the START of every while- AND for-body in async contexts, so a
    heavy/infinite loop yields to the browser instead of freezing the tab. START (not end) is load-
    bearing: a continue or break statement jumps past the rest of the body, so an END-of-body yield
    would be SKIPPED — a gameloop using 'continue' (start/pause/game-over screens) would never yield
    and freeze. A start-of-body yield runs on every iteration regardless of control flow. __yield__ is
    throttled (it only round-trips the browser every 256th plain iteration), so tight loops stay fast.
    _SyncBarrier stops us descending into sync def/class bodies, where an inserted await is a syntax error."""
    def visit_While(self, node):
        self.generic_visit(node)
        node.body.insert(0, copy.deepcopy(_YIELD))
        return node
    def visit_For(self, node):
        self.generic_visit(node)
        node.body.insert(0, copy.deepcopy(_YIELD))
        return node

def _transform(src):
    tree = ast.parse(src)
    asyncify = _Asyncify()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, "<your code>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

# ---- run management ----

async def _run(src):
    glb = {"__name__": "__main__", "__yield__": __yield__, "__sleep__": __sleep__,
           "__builtins__": __builtins__}
    try:
        code = _transform(src)
    except SyntaxError:
        traceback.print_exc(limit=0)
        return "error"
    try:
        if pygame.get_init():
            pygame.event.clear()
        res = eval(code, glb)
        if asyncio.iscoroutine(res):
            await res
        return "ok"
    except asyncio.CancelledError:
        return "stopped"
    except SystemExit:
        return "exit"
    except BaseException:
        traceback.print_exc()
        return "error"

def _start(src):
    _stop()
    _state.update(delay=0.0, flipped=False, ticked=False, n=0, paused=False, flips=0)
    _pause_gate.set()                     # +PAUSE (S3): clear any leftover pause from a prior run
    _state["task"] = asyncio.ensure_future(_run(src))
    return _state["task"]

def _stop():
    t = _state["task"]
    if t and not t.done():
        t.cancel()
        _pause_gate.set()                 # +PAUSE (S3): release the gate so a task parked there gets CancelledError
        _state["paused"] = False
        return True
    return False

# +PAUSE (S3): additive controls. They do NOT touch _state['task'] — pause != stop.
def _pause():
    if _state["task"] and not _state["task"].done():
        _pause_gate.clear()
        _state["paused"] = True
        return True
    return False

def _resume():
    if _state["paused"]:
        _pause_gate.set()
        _state["paused"] = False
        return True
    return False
`;

// ---------------------------------------------------------------- multi-file run model (additive)
// Appended after BOOT_PY. Adds ONLY new names; reuses BOOT_PY's _SyncBarrier,
// _is_gameloop, _Asyncify, _Awaiter, _InjectYield, _time_names, __yield__,
// __sleep__, _state, _stop. Never touches _start/_run/_transform. Module functions
// are SELECTIVELY async (only those that loop/pause); pure helpers stay sync so
// class methods / module-level code can use their real return values. Every call
// is still wrapped in await __maybe_await__ (non-coroutines pass straight through).
export const PROJECT_PY = String.raw`
import sys, ast, importlib, importlib.abc, importlib.util, importlib.machinery, inspect, traceback, os

class _ProjectError(Exception):
    pass

async def __maybe_await__(value):
    if inspect.iscoroutine(value):
        return await value
    return value

class _AwaitCalls(_SyncBarrier):
    _HELPERS = ('__maybe_await__', '__yield__', '__sleep__')
    def _wrap(self, call):
        return ast.copy_location(ast.Await(value=ast.Call(
            func=ast.Name('__maybe_await__', ast.Load()), args=[call], keywords=[])), call)
    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id in self._HELPERS:
            return node
        return self._wrap(node)
    def visit_Await(self, node):
        # _Awaiter may already have produced 'await f()' (converted name) or 'await x'
        # (asyncio.run). Wrap the inner call ONCE here so visit_Call doesn't add a
        # second await on top (double-await -> TypeError when the call returns None).
        v = node.value
        if isinstance(v, ast.Call) and not (isinstance(v.func, ast.Name) and v.func.id in self._HELPERS):
            self.generic_visit(v)        # process the call's args, not the call itself
            return ast.copy_location(ast.Await(value=ast.Call(
                func=ast.Name('__maybe_await__', ast.Load()), args=[v], keywords=[])), node)
        self.generic_visit(node)
        return node

def _needs_async(node, time_mods, sleep_names):
    # True iff this function body (NOT nested defs/classes) contains a game loop or
    # a sleep/wait that _Awaiter rewrites to await — exactly the things that must yield.
    for n in _shallow(node):
        if isinstance(n, ast.While) and _is_gameloop(n):
            return True
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name) and f.id in sleep_names:
                return True
            if isinstance(f, ast.Attribute):
                o = f.value
                if f.attr == 'sleep' and isinstance(o, ast.Name) and o.id in time_mods:
                    return True
                if f.attr in ('wait', 'delay') and isinstance(o, ast.Attribute) and o.attr == 'time':
                    return True
    return False

class _AsyncifyCoop(ast.NodeTransformer):
    """Convert ONLY functions that must yield/pause (game loop or sleep/wait).
    Pure helpers stay sync so class methods / module-level code can call them and
    use real return values. Methods (inside classes) are never converted."""
    def __init__(self, time_mods, sleep_names):
        self.time_mods, self.sleep_names = time_mods, sleep_names
        self.converted = set()
    def visit_FunctionDef(self, node):
        self.generic_visit(node)            # decide nested defs first
        if _needs_async(node, self.time_mods, self.sleep_names):
            node.__class__ = ast.AsyncFunctionDef
            self.converted.add(node.name)
        return node
    def visit_ClassDef(self, node):
        return node                         # methods stay sync (game loop in a method is caught elsewhere)

def _check_loop_placement(tree, filename):
    base = filename.rsplit('/', 1)[-1]
    for n in _shallow(tree):                       # module-level, not crossing into defs
        if isinstance(n, ast.While) and _is_gameloop(n):
            raise _ProjectError(base + ': a game loop must be in the entry file or a '
                                'module-level function — not at module top level.')
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for n in ast.walk(node):
                if isinstance(n, ast.While) and _is_gameloop(n):
                    raise _ProjectError(base + ': a game loop inside a class method '
                                        "isn't supported — move it to a module-level function or the entry file.")

class _CoopCallCheck(ast.NodeVisitor):
    """Raise a friendly error if a cooperative (converted) function is called by
    bare name from a SYNC context (module top level / a sync function / a class
    method), where its coroutine would be silently dropped. Such functions must be
    called from the entry file or another cooperative (async) function."""
    def __init__(self, converted, base):
        self.converted, self.base = converted, base
    def visit_AsyncFunctionDef(self, node):
        pass                                # inside async, calls are awaited -> safe; don't descend
    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in self.converted:
            raise _ProjectError(self.base + ": '" + node.func.id + "' contains a game loop or pause, "
                "so it can't be called from module top level, a class method, or a non-cooperative "
                "function — call it from the entry file or another function that loops or waits.")
        self.generic_visit(node)

class _ModuleCoop(ast.NodeTransformer):
    """Apply the cooperative passes (_Awaiter / _AwaitCalls / _InjectYield) ONLY
    inside async-function bodies. Module top-level code stays plain sync Python:
    the module is imported synchronously, so a top-level await won't compile."""
    def __init__(self, converted, time_mods, sleep_names):
        self.converted, self.time_mods, self.sleep_names = converted, time_mods, sleep_names
    def visit_AsyncFunctionDef(self, node):
        # The sub-passes recurse into nested async defs, so do NOT generic_visit
        # here (that would process nested functions twice).
        _Awaiter(self.converted, self.time_mods, self.sleep_names).visit(node)
        _AwaitCalls().visit(node)
        _InjectYield().visit(node)
        return node
    def visit_ClassDef(self, node):
        return node     # methods stay sync

def _transform_module(src, filename):
    tree = ast.parse(src)
    _check_loop_placement(tree, filename)
    time_mods, sleep_names = _time_names(tree)
    asyncify = _AsyncifyCoop(time_mods, sleep_names)
    tree = asyncify.visit(tree)
    base = filename.rsplit('/', 1)[-1]
    _CoopCallCheck(asyncify.converted, base).visit(tree)
    # Modules are exec'd SYNCHRONOUSLY (no top-level-await flag), so the cooperative
    # passes run only inside the now-async function bodies — never at module top level.
    _ModuleCoop(asyncify.converted, time_mods, sleep_names).visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, 'exec')

_ROOT = os.getcwd()      # absolute project root anchor (MEMFS cwd, e.g. /home/pyodide)
_PROJECT_PATHS = set()   # abs paths written last run (for unlink reconcile)
_AUTO_INITS = set()      # abs paths of auto-created empty __init__.py markers
_MOD_HELPERS = {'__maybe_await__': __maybe_await__, '__yield__': __yield__, '__sleep__': __sleep__}

def _is_project_origin(origin):
    # Only PROJECT source files under ROOT are cooperatively transformed; stdlib,
    # pygame and site-packages live elsewhere and go through the unmodified loader.
    return bool(origin) and origin.endswith('.py') and origin.startswith(_ROOT + '/')

# Native importlib does NOT run _transform_module on imported modules, so an
# imported module with a blocking 'while True' would freeze. To preserve the
# cooperative loop on imported PROJECT modules (multifile checks 2/3, subdirs #4),
# we install a MetaPathFinder that DELEGATES dotted/package resolution to the
# stdlib PathFinder (packages, __init__.py, relative imports — all free) and only
# wraps the returned spec's loader for project-origin .py files.
class _CoopLoader(importlib.abc.Loader):
    def __init__(self, inner, origin):
        self.inner, self.origin = inner, origin
    def create_module(self, spec):
        return None                                   # default module creation
    def exec_module(self, module):
        with open(self.origin, 'r') as f:
            src = f.read()
        code = _transform_module(src, self.origin)    # cooperative transform
        module.__dict__.update(_MOD_HELPERS)          # __yield__/__sleep__/__maybe_await__
        exec(code, module.__dict__)

class _CoopPathFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
        if spec is None or spec.origin is None:
            return None
        if not _is_project_origin(spec.origin):
            return None                               # let the default finder claim it
        spec.loader = _CoopLoader(spec.loader, spec.origin)
        return spec

def _install_finder():
    if _ROOT not in sys.path:
        sys.path.insert(0, _ROOT)                     # absolute anchor for imports + open()
    if not any(isinstance(f, _CoopPathFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, _CoopPathFinder())

def writePath(relpath, text):
    # One helper for every code write: mkdirTree(dirname) + write under ROOT.
    # A bare name (no '/') is a depth-1 path: dirname is '' and no dir is made.
    full = os.path.join(_ROOT, relpath)
    d = os.path.dirname(full)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(full, 'w') as f:
        f.write(text)
    return full

def _dotted_names_for(relpath):
    # 'sprites/enemy.py' -> ['sprites.enemy', 'sprites'] (module + every ancestor
    # package). Popping ancestors too is conservative: a package object caches its
    # submodules, so re-running edited code needs the whole chain dropped.
    stem = relpath[:-3] if relpath.endswith('.py') else relpath
    parts = stem.split('/')
    names = []
    for i in range(len(parts), 0, -1):
        seg = parts[:i]
        if seg and seg[-1] == '__init__':
            seg = seg[:-1]                            # 'pkg/__init__.py' -> package 'pkg'
        if seg:
            name = '.'.join(seg)
            if name not in names:                     # dedupe: 'pkg/__init__.py' yields 'pkg' twice
                names.append(name)
    return names

def _ensure_init_py(new_paths):
    # Auto-create an empty __init__.py in every directory that contains >=1 .py file
    # (so 'import sprites.enemy' resolves). Tracked in _AUTO_INITS; written to MEMFS.
    dirs = set()
    for p in new_paths:
        if p.endswith('.py'):
            dirs.add(os.path.dirname(p))
    for d in dirs:
        if d == _ROOT or not d.startswith(_ROOT + '/'):
            continue                                  # ROOT itself needs no package marker
        init = os.path.join(d, '__init__.py')
        if init not in new_paths and not os.path.exists(init):
            os.makedirs(d, exist_ok=True)
            with open(init, 'w') as f:
                f.write('')
            _AUTO_INITS.add(init)

def _prune_empty_dirs():
    # Remove directories under ROOT that hold no project file (walk bottom-up; never
    # remove ROOT; skip __pycache__ defensively even though dont_write_bytecode is set).
    for dirpath, dirnames, filenames in os.walk(_ROOT, topdown=False):
        if dirpath == _ROOT:
            continue
        if os.path.basename(dirpath) == '__pycache__':
            continue
        try:
            if not os.listdir(dirpath):               # truly empty -> safe to drop
                os.rmdir(dirpath)
        except Exception:
            pass

def _transform_entry(src):
    tree = ast.parse(src)
    asyncify = _Asyncify()
    tree = asyncify.visit(tree)
    tree = _Awaiter(asyncify.converted, *_time_names(tree)).visit(tree)
    tree = _AwaitCalls().visit(tree)
    tree = _InjectYield().visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, '<entry>', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

async def _run_project(files, entry):
    if _ROOT not in sys.path:
        sys.path.insert(0, _ROOT)
    new_paths = set()
    for relpath, msrc in files.items():
        new_paths.add(writePath(relpath, msrc))       # mkdirTree + write under ROOT
    _ensure_init_py(new_paths)                         # empty __init__.py per .py-bearing dir
    # Keep only auto-__init__.py whose directory still holds a .py THIS run. An auto-init
    # for an emptied package dir is NOT wanted: leaving it in new_paths would keep an empty
    # package importable across runs. Dropping it lets it fall into _PROJECT_PATHS-new_paths,
    # so it is unlinked and the dir prunes → an emptied package becomes un-importable (§2.6).
    cur_py_dirs = {os.path.dirname(p) for p in new_paths if p.endswith('.py')}
    new_paths |= {p for p in _AUTO_INITS
                  if os.path.exists(p) and os.path.dirname(p) in cur_py_dirs}
    # unlink files dropped since last run (incl. now-orphaned auto-inits), then prune dirs
    for old in _PROJECT_PATHS - new_paths:
        try:
            if os.path.exists(old): os.unlink(old)
        except Exception:
            pass
        for dotted in _dotted_names_for(os.path.relpath(old, _ROOT).replace(os.sep, '/')):
            sys.modules.pop(dotted, None)              # forget DROPPED module names too (§2.6)
        _AUTO_INITS.discard(old)
    _PROJECT_PATHS.clear(); _PROJECT_PATHS.update(new_paths)
    _prune_empty_dirs()

    _install_finder()
    importlib.invalidate_caches()                      # MANDATORY after nested write/unlink
    for relpath in files:                              # pop DOTTED module names (+ ancestors)
        for dotted in _dotted_names_for(relpath):
            sys.modules.pop(dotted, None)
    if '' not in sys.path:
        sys.path.insert(0, '')

    glb = {'__name__': '__main__', '__yield__': __yield__, '__sleep__': __sleep__,
           '__maybe_await__': __maybe_await__, '__builtins__': __builtins__}
    try:
        code = _transform_entry(files[entry])
    except SyntaxError:
        traceback.print_exc(limit=0); return 'error'
    try:
        if pygame.get_init():
            pygame.event.clear()
        res = eval(code, glb)
        if asyncio.iscoroutine(res):
            await res
        return 'ok'
    except asyncio.CancelledError:
        return 'stopped'
    except SystemExit:
        return 'exit'
    except _ProjectError as e:
        print(str(e)); return 'error'
    except BaseException:
        traceback.print_exc(); return 'error'

def _start_project(files, entry):
    _stop()
    _state.update(delay=0.0, flipped=False, ticked=False, n=0, via_project=True, paused=False, flips=0)
    _pause_gate.set()                     # +PAUSE (S3): clear any leftover pause from a prior run
    _state['task'] = asyncio.ensure_future(_run_project(dict(files), str(entry)))
    return _state['task']

def _purge_project_files():
    # Reconcile MEMFS when leaving the project path (e.g. dropping back to a single
    # file): unlink every module a prior project run wrote (incl. nested + auto
    # __init__.py), forget its DOTTED import, and prune the now-empty subdirs, so a
    # solo program can't import a stale sibling. Safe to call with nothing tracked.
    for path in list(_PROJECT_PATHS):
        try:
            if os.path.exists(path): os.unlink(path)
        except Exception:
            pass
        rel = os.path.relpath(path, _ROOT).replace(os.sep, '/')
        for dotted in _dotted_names_for(rel):
            sys.modules.pop(dotted, None)
    _PROJECT_PATHS.clear()
    _AUTO_INITS.clear()
    _prune_empty_dirs()
    importlib.invalidate_caches()
`;

// createEngine(deps) — thin JS wrapper over the SAME Pyodide globals. deps.getPyodide()
// returns the live (bare-name) pyodide instance the host owns. No DOM/project imports.
// The Python namespace is byte-identical to today; this only relocates the JS dispatch.
export function createEngine(deps) {
  const py = () => deps.getPyodide();
  return {
    // Full boot, in the EXACT order of the old host boot(): audio-proxy first, then Pyodide
    // load, canvas+SDL registration, pygame-ce, BOOT_PY then PROJECT_PY (strict order —
    // PROJECT_PY reuses BOOT_PY's names), then host asset hydration. Returns the pyodide
    // instance so the host can assign it to its top-level `let pyodide` (the bare-name test
    // seam). deps for boot:
    //   loadPyodide: async () => pyodide   (host owns the CDN base + version pin)
    //   setPyodide: (inst) => void         (host publishes the instance to its top-level
    //                                       `let pyodide` IMMEDIATELY — before stdout/canvas/
    //                                       runPython/hydrate, all of which read the host var;
    //                                       e.g. assetFS._memfs guards on `if (!pyodide)`)
    //   canvas: the #canvas element
    //   setStatus: (cls, token) => void    (host owns the exact #status token strings)
    //   logSink: { out:(s)=>void, err:(s)=>void }
    //   hydrateAssets: async () => void     (host's assetFS.hydrateAll)
    async boot(d) {
      // Capture SDL's Web Audio context(s) so the Run click (a user gesture) can resume
      // them — headed browsers start an AudioContext suspended until a gesture. Inert
      // unless the user's program calls pygame.mixer. (Proxy returns real instances.)
      // MUST run before pygame.mixer loads → keep it first.
      window.__audioContexts = window.__audioContexts || [];
      for (const key of ["AudioContext", "webkitAudioContext"]) {
        const Orig = window[key];
        if (!Orig || Orig.__wrapped) continue;
        const Wrapped = new Proxy(Orig, { construct(T, a) { const c = new T(...a); window.__audioContexts.push(c); return c; } });
        Wrapped.__wrapped = true;
        window[key] = Wrapped;
      }
      d.setStatus("boot", "loading Python…");
      const inst = await d.loadPyodide();
      // Publish to the host's bare-name `pyodide` NOW (matches the original boot order, where
      // `pyodide = await loadPyodide()` was set before everything below). hydrateAssets()/
      // _memfs and the lazy loaders read the host var, not this local `inst`.
      if (d.setPyodide) d.setPyodide(inst);
      inst.setStdout({ batched: (s) => d.logSink.out(s) });
      inst.setStderr({ batched: (s) => d.logSink.err(s) });
      // Register the canvas with SDL BEFORE pygame is imported (load-bearing order),
      // and scope SDL's keyboard capture to the canvas so the editor keeps working.
      if (inst.canvas && inst.canvas.setCanvas2D) {
        inst.canvas.setCanvas2D(d.canvas);
      } else {
        inst._module.canvas = d.canvas;
      }
      inst.runPython(
        'import os; os.environ["SDL_EMSCRIPTEN_KEYBOARD_ELEMENT"] = "#canvas"');
      d.setStatus("boot", "loading pygame…");
      await inst.loadPackage("pygame-ce");
      await inst.runPythonAsync(BOOT_PY);
      await inst.runPythonAsync(PROJECT_PY);
      await d.hydrateAssets();   // rehydrate any persisted uploads into MEMFS
      d.setStatus("ready", "ready");
      return inst;
    },
    // Single-file path: snapshot `src` NOW and schedule the cooperative task.
    start(src) {
      const f = py().globals.get("_start");
      const task = f(src);
      f.destroy();
      return task;
    },
    // Multi-file path: toPy the {path: text} snapshot, schedule, then free the proxies.
    startProject(filesObj, entry) {
      const startP = py().globals.get("_start_project");
      const filesPy = py().toPy(filesObj);
      const task = startP(filesPy, entry);
      startP.destroy(); filesPy.destroy();
      return task;
    },
    // Reset the single-file path's project-import state (mirrors the old inline runPython).
    purgeProjectFiles() {
      py().runPython("_state['via_project'] = False; _purge_project_files()");
    },
    stop() { py().runPython("_stop()"); },
    pause() { return py().runPython("_pause()"); },
    resume() { return py().runPython("_resume()"); },
    isPaused() {
      try { return !!py().runPython("bool(_state.get('paused'))"); } catch { return false; }
    },
  };
}
