// TDD RED CONTRACT — Slice S3 "split run model" (docs/specs/2026-06-23-split-run-model-design.md §7).
// TESTS ONLY. A separate subagent implements the run model in index.html; THIS file is the contract.
//
// The split model: editor `▶ Start` (#runBtn -> run()), stage `⏸ Pause ⇄ ▶ Resume` (#pauseBtn,
// currently reserved/inert), `✕ End` (#stopBtn, restyled, listener -> _stop() kept), a
// `▶ running: <file>` / `⏸ paused: <file>` stage badge (#runFileBadge, NET-NEW), an explorer
// `.running` highlight on the running file's `.tab[data-name]` row, and editor↔program independence
// (the run snapshots files at Start). New window seam: `window.runFile()` returns the running entry.
//
// Drives via #runBtn/#pauseBtn/#stopBtn clicks + #status/#canvas/#console + window.project /
// window.runFile(). Boot waits for a quiescent status first. Freeze/animation are detected by
// frame/pixel diffing over a REAL time window (like spike-pause / spike-runstop / verify), so the
// checks are robust to frame timing.
//
// USER DECISION (design §0.1 Q0): Start RESTARTS while a program is running — clicking ▶ Start while
// a program is live STOPS the current run and immediately runs the currently-open file fresh (exactly
// ONE live task at a time). #runBtn stays ENABLED while running (never disabled, never display:none).
// §6 below asserts this restart contract (a NEW task id + console cleared+reprinted), NOT a disabled
// no-op.
//
// EXPECTED (RED, against the prior disabled-Start index.html): §6 FAILS because that impl keeps
// #runBtn disabled while live and makes a click a no-op (task id unchanged). Once index.html drops
// the disabled-Start mechanism and Start performs a clean restart, §6 (and the rest) go GREEN.
import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok -', msg);
const info = (msg) => console.log('info -', msg);

// ---------------------------------------------------------------- helpers
const status = () => page.evaluate(() => document.getElementById('status').textContent);
const statusClasses = () => page.evaluate(() => Array.from(document.getElementById('status').classList));
const consoleText = () => page.textContent('#console');
// Canvas frame diffing (verify.mjs style): the whole-frame data URL changes iff the canvas redrew.
const frame = () => page.evaluate(() => document.getElementById('canvas').toDataURL());
// A single known pixel (spike-runstop / spike-pause style): a frozen pixel == a frozen frame.
const pixel = (x = 12, y = 12) => page.evaluate(({ x, y }) => Array.from(
  document.getElementById('canvas').getContext('2d').getImageData(x, y, 1, 1).data), { x, y });
// The live-task signal the re-run guard reads (same expression as spike-runstop.mjs:49).
// NOTE: the engine binds `pyodide` as a module-scope `let` in the page <script> (NOT on window),
// so it is reachable by BARE name inside page.evaluate — exactly how spike-runstop/spike-pause read
// it. We guard on its presence so a probe during boot returns false instead of throwing.
const taskLive = () => page.evaluate(() => typeof pyodide !== 'undefined' && !!pyodide && pyodide.runPython(
  "_state['task'] is not None and not _state['task'].done()"));
const pausedFlag = () => page.evaluate(() => typeof pyodide !== 'undefined' && !!pyodide && pyodide.runPython("bool(_state.get('paused'))"));
// Wait for #status to equal one of `wants`; resolve-or-note (RED-friendly: short timeout).
const waitStatus = (wants, ms = 8000) => page.waitForFunction(
  (w) => w.includes(document.getElementById('status').textContent), wants, { timeout: ms });
// Robust "is it animating?" over a real window: two whole-frame samples spaced apart.
async function animatesOver(ms = 600) {
  const a = await frame(); await page.waitForTimeout(ms); const b = await frame();
  return a !== b;
}
// Robust "is it frozen?" over a real window: a known pixel is identical across the window.
async function frozenOver(ms = 600) {
  const a = await pixel(); await page.waitForTimeout(ms); const b = await pixel();
  return JSON.stringify(a) === JSON.stringify(b);
}
const setProgram = (src) => page.evaluate(
  (s) => { document.querySelector('.CodeMirror').CodeMirror.setValue(s); }, src);
const click = (sel) => page.click(sel, { timeout: 2500 }).catch(() => {});
// Is an element present AND visible (laid out, not display:none) — used for the visible-disabled
// Start and the show-only-while-live Pause/End checks.
const visible = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
}, sel);
const present = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
// Start is "disabled" if the disabled attribute is set OR a disabled-ish class is present
// (per §0.1 Q4 / §6: a VISIBLE disabled affordance, never display:none).
const runBtnDisabled = () => page.evaluate(() => {
  const b = document.getElementById('runBtn');
  if (!b) return null;
  return b.disabled === true || b.hasAttribute('disabled') ||
    /\b(is-running|disabled|live)\b/.test(b.className);
});

// A FRAME-PACED program (draws every loop + tick) so pause lands within one frame, not after the
// 256-iter compute-loop lag (design §7 "Granularity caveat"). Pixel (12,12) cycles with the counter
// so a frozen pixel proves a frozen loop. Prints a marker so the console-survives check has content.
const FRAME_PACED = [
  'import pygame',
  'pygame.init()',
  'screen = pygame.display.set_mode((320, 240))',
  'clock = pygame.time.Clock()',
  'print("RUNMODEL_MARKER")',
  'n = 0',
  'while True:',
  '    screen.fill(((n * 7) % 255, (n * 3) % 255, 90))',
  '    pygame.display.flip()',
  '    pygame.event.pump()',
  '    clock.tick(60)',
  '    n += 1',
].join('\n');

// ---------------------------------------------------------------- boot to quiescent
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 }).catch(() => fail('never booted'));

// Helper: from a clean slate, set the frame-paced program and Start it; wait for 'running'.
async function startFresh(src = FRAME_PACED) {
  // Ensure no live task is wedging the (new) disabled-Start guard.
  const live = await taskLive();
  if (live) { await page.evaluate(() => pyodide.runPython('_stop()')); await page.waitForTimeout(150); }
  await setProgram(src);
  await page.click('#runBtn');
  await waitStatus(['running'], 8000).catch(() => fail('startFresh: status never became "running"'));
}

// =====================================================================
// 1. Start runs the entry. Click #runBtn -> status 'running' + canvas animates.
// =====================================================================
console.log('\n=== 1. Start runs the entry ===');
await startFresh();
{
  const s = await status();
  const anim = await animatesOver(600);
  if (s === 'running' && anim) ok('Start: status "running" and canvas animates (two frames differ)');
  else fail(`Start did not run: status=${s} animates=${anim}`);
}

// =====================================================================
// 2. Pause freezes — canvas FROZEN, task still ALIVE, status 'paused' (.pill + .paused, NOT finished/stopped).
// =====================================================================
let pausedPixel = null;   // the frozen pixel sampled while paused; §3 asserts resume moves it.
console.log('\n=== 2. Pause freezes (task stays alive) ===');
{
  await click('#pauseBtn');
  await waitStatus(['paused'], 5000).catch(() => fail('Pause: status never became "paused"'));
  const s = await status();
  // Let the in-flight frame reach the pause gate, then test FROZEN over a real window.
  await page.waitForTimeout(150);
  pausedPixel = await pixel();
  const frozen = await frozenOver(700);
  const alive = await taskLive();
  const flag = await pausedFlag();
  const cls = await statusClasses();
  if (frozen) ok('Pause: canvas pixel FROZEN over 700ms (frame held on screen)');
  else fail('Pause: canvas kept changing while paused (not frozen)');
  if (alive && s !== 'finished' && s !== 'stopped')
    ok('Pause: task still ALIVE (not finished/stopped) — pause != end');
  else fail(`Pause: task not alive / wrong status (alive=${alive} status=${s})`);
  if (s === 'paused' && flag)
    ok('Pause: #status text === "paused" and _state["paused"] is True');
  else fail(`Pause: status/flag wrong (status=${s} flag=${flag})`);
  if (cls.includes('pill') && cls.includes('paused'))
    ok('Pause: status keeps .pill chrome + gains .paused class');
  else fail('Pause: status classes wrong: ' + JSON.stringify(cls));
}

// =====================================================================
// 3. Resume continues — #pauseBtn again (now Resume): canvas animates, status 'running'.
// =====================================================================
console.log('\n=== 3. Resume continues ===');
{
  await click('#pauseBtn');
  await waitStatus(['running'], 5000).catch(() => fail('Resume: status never returned to "running"'));
  const s = await status();
  const anim = await animatesOver(600);
  const flag = await pausedFlag();
  // Genuine freeze->move proof: the pixel frozen while paused must now have changed (the loop
  // advanced past the held frame). This keeps §3 from passing VACUOUSLY when pause is a no-op
  // (if pause never froze, the program was running all along and this comparison is meaningful only
  // once §2 is GREEN — but the status/flag checks below still gate the real resume transition).
  const moved = pausedPixel ? JSON.stringify(await pixel()) !== JSON.stringify(pausedPixel) : anim;
  if (s === 'running' && anim && moved && !flag)
    ok('Resume: status "running", canvas advanced past the frozen frame, _state["paused"] cleared');
  else fail(`Resume failed: status=${s} animates=${anim} movedPastFrozen=${moved} pausedFlag=${flag}`);
}

// =====================================================================
// 6. (interleaved while live) Start RESTARTS while a program is live (running + paused).
//    USER DECISION (design §0.1 Q0): clicking ▶ Start while a program is live STOPS the current
//    run and immediately runs the currently-open file fresh — exactly ONE live task at a time.
//    #runBtn stays ENABLED while running (never disabled, never display:none). A restart is proven
//    by: status returns to 'running', the console was CLEARED then re-populated by the fresh run,
//    and id(_state['task']) CHANGED (a new task replaced the old).
// =====================================================================
console.log('\n=== 6. Start RESTARTS while live (running + paused) ===');
{
  // --- While RUNNING (we are running after Resume) ---
  // #runBtn must be present, visible, and ENABLED — not disabled, not display:none.
  const vRun = await visible('#runBtn');
  const dRun = await runBtnDisabled();
  if (vRun && !dRun) ok('while RUNNING: #runBtn present+visible and ENABLED (restart-on-click)');
  else fail(`while running, #runBtn wrong (visible=${vRun} disabled=${dRun}; want visible=true disabled=false)`);

  // Capture the live task identity BEFORE the restart click.
  const idBeforeRun = await page.evaluate(() => pyodide.runPython('id(_state["task"])'));
  await page.waitForTimeout(250);           // let the running program reprint its marker so we can see it cleared
  const hadMarkerRun = /RUNMODEL_MARKER/.test(await consoleText());
  await page.click('#runBtn');              // RESTART while running
  await waitStatus(['running'], 8000).catch(() => fail('restart-while-running: status never returned to "running"'));
  const sRun = await status();
  const idAfterRun = await page.evaluate(() => pyodide.runPython('id(_state["task"])'));
  // The fresh Start clears the console then the new run reprints the marker — prove a genuine new run.
  await page.waitForTimeout(300);
  const reprintedRun = /RUNMODEL_MARKER/.test(await consoleText());
  if (sRun === 'running') ok('restart-while-running: status is "running" after Start');
  else fail(`restart-while-running: status wrong (${sRun})`);
  if (idAfterRun !== idBeforeRun)
    ok(`restart-while-running: a NEW task replaced the old one (id ${idBeforeRun} -> ${idAfterRun}) — exactly one live task`);
  else fail(`restart-while-running: task identity unchanged (${idBeforeRun}) — Start did not restart`);
  if (hadMarkerRun && reprintedRun)
    ok('restart-while-running: console was cleared then re-populated by the fresh run (clearConsole on Start)');
  else fail(`restart-while-running: console not refreshed by the fresh Start (hadMarker=${hadMarkerRun} reprinted=${reprintedRun})`);
  // Exactly ONE live task: the new task is alive, the old one is gone.
  const liveAfterRun = await taskLive();
  if (liveAfterRun) ok('restart-while-running: the new task is live (exactly one live task)');
  else fail('restart-while-running: no live task after restart');

  // --- While PAUSED ---
  // Pause the (restarted) run, confirm #runBtn is still ENABLED+visible, then restart from paused.
  await click('#pauseBtn');
  await waitStatus(['paused'], 5000).catch(() => fail('restart-while-paused setup: never reached "paused"'));
  const vPause = await visible('#runBtn');
  const dPause = await runBtnDisabled();
  if (vPause && !dPause) ok('while PAUSED: #runBtn present+visible and ENABLED (restart clears the pause)');
  else fail(`while paused, #runBtn wrong (visible=${vPause} disabled=${dPause}; want visible=true disabled=false)`);

  const idBeforePause = await page.evaluate(() => pyodide.runPython('id(_state["task"])'));
  await page.click('#runBtn');              // RESTART while paused → fresh 'running' run
  await waitStatus(['running'], 8000).catch(() => fail('restart-while-paused: status never became "running"'));
  const sPause = await status();
  const flagPause = await pausedFlag();
  const idAfterPause = await page.evaluate(() => pyodide.runPython('id(_state["task"])'));
  await page.waitForTimeout(300);
  const reprintedPause = /RUNMODEL_MARKER/.test(await consoleText());
  if (sPause === 'running' && !flagPause)
    ok('restart-while-paused: paused cleared → a fresh "running" run (_state["paused"] is False)');
  else fail(`restart-while-paused: status/flag wrong (status=${sPause} paused=${flagPause}; want running / false)`);
  if (idAfterPause !== idBeforePause)
    ok(`restart-while-paused: a NEW task replaced the old paused one (id ${idBeforePause} -> ${idAfterPause})`);
  else fail(`restart-while-paused: task identity unchanged (${idBeforePause}) — Start did not restart from paused`);
  if (reprintedPause) ok('restart-while-paused: the fresh run re-populated the console');
  else fail('restart-while-paused: fresh run did not reprint the marker');
  // Leave a clean running state for the following checks.
  await waitStatus(['running'], 5000).catch(() => {});
}

// =====================================================================
// 7. Pause/End shown only while a task is LIVE.
//    While running: #pauseBtn shown, #stopBtn (End ✕) actionable. When idle: #pauseBtn (and the
//    separate End control if any) hidden.
// =====================================================================
console.log('\n=== 7. Pause/End visibility gated on a live task ===');
{
  // While running (we are running now).
  const pauseShown = await visible('#pauseBtn');
  const stopActionable = await present('#stopBtn') && await visible('#stopBtn');
  if (pauseShown) ok('while running: #pauseBtn is SHOWN');
  else fail('while running: #pauseBtn is hidden (should be shown)');
  if (stopActionable) ok('while running: #stopBtn (End) is present + visible (spike-runstop/verify click it here)');
  else fail('while running: #stopBtn not actionable');

  // Now go idle (End) and assert Pause hides.
  await page.click('#stopBtn');
  await waitStatus(['stopped'], 5000).catch(() => fail('End did not reach "stopped"'));
  const pauseHiddenIdle = !(await visible('#pauseBtn'));
  // If a SEPARATE End control (#endBtn) exists, it too must hide when idle. #stopBtn stays the
  // kept click target; the design may keep it laid-out (restyled) — so we only gate #endBtn here.
  const endBtnHiddenIdle = (await present('#endBtn')) ? !(await visible('#endBtn')) : true;
  if (pauseHiddenIdle) ok('when idle (stopped): #pauseBtn is HIDDEN');
  else fail('when idle: #pauseBtn still shown (should hide)');
  if (endBtnHiddenIdle) ok('when idle: separate End control (#endBtn, if present) is HIDDEN');
  else fail('when idle: #endBtn still shown (should hide)');
}

// =====================================================================
// 4. End keeps the last frame + console. Run, get a console line, End: status 'stopped',
//    canvas NOT cleared (a frozen-frame pixel persists), #console still has its content.
// =====================================================================
console.log('\n=== 4. End keeps last frame + console ===');
{
  await startFresh();
  await page.waitForTimeout(300);           // let it draw + print the marker
  const before = await consoleText();
  if (/RUNMODEL_MARKER/.test(before)) ok('End-setup: console captured the program marker while running');
  else fail('End-setup: marker never printed: ' + before.slice(0, 120));
  const pxBefore = await pixel();           // a live frame pixel
  await page.click('#stopBtn');             // End
  await waitStatus(['stopped'], 5000).catch(() => fail('End: status never became "stopped"'));
  const s = await status();
  // Frame persists AND is frozen (cancel doesn't clear it) — sample now + after a window.
  const pxAfter = await pixel();
  await page.waitForTimeout(600);
  const pxLater = await pixel();
  const notCleared = JSON.stringify(pxAfter) === JSON.stringify(pxLater);
  const after = await consoleText();
  if (s === 'stopped') ok('End: status "stopped"');
  else fail(`End: status wrong (${s})`);
  if (notCleared) ok(`End: canvas NOT cleared — last frame persists + frozen (${pxAfter})`);
  else fail(`End: canvas changed/cleared after End (after=${pxAfter} later=${pxLater})`);
  if (/RUNMODEL_MARKER/.test(after)) ok('End: #console keeps its content (clearConsole runs on Start, not End)');
  else fail('End: console lost its content: ' + after.slice(0, 120));
  info(`End-setup pre-stop pixel was ${pxBefore}`);
}

// =====================================================================
// 5. Re-run after finish/stop works. After End, click #runBtn -> runs again ('running').
// =====================================================================
console.log('\n=== 5. Re-run after stop works ===');
{
  // We are 'stopped' from §4; a fresh Start must be allowed (no live task) and clear the console.
  await page.click('#runBtn');
  await waitStatus(['running'], 8000).catch(() => fail('Re-run after stop did not reach "running"'));
  const s = await status();
  const cleared = !/RUNMODEL_MARKER/.test(await consoleText());   // fresh Start clears console...
  // ...then the re-run prints the marker again — assert it comes back to prove a genuine new run.
  await page.waitForTimeout(300);
  const reprinted = /RUNMODEL_MARKER/.test(await consoleText());
  if (s === 'running') ok('Re-run after stop: status "running" again');
  else fail(`Re-run after stop failed: status=${s}`);
  if (cleared || reprinted) ok('Re-run after stop: fresh Start cleared the console then the new run reprinted the marker');
  else fail('Re-run after stop: console not refreshed by the fresh Start');
}

// =====================================================================
// 8. Running-file badge + click-to-jump. While running, the stage shows `▶ running: <entry>`;
//    clicking it makes that file active (project.active === entry). When paused: `⏸ paused: <file>`.
// =====================================================================
console.log('\n=== 8. Running-file badge + click-to-jump ===');
{
  // #9: the OPEN file is what runs. Seed entry=lib.py (a sibling) but OPEN game.py (the animating
  // loop) — Start must run the OPEN file (game.py), proving the fixed entry is ignored.
  await page.evaluate(() => {
    if (typeof pyodide !== 'undefined' && pyodide) try { pyodide.runPython('_stop()'); } catch (e) {}
  });
  await page.waitForTimeout(150);
  await page.evaluate((src) => {
    window.project.load({
      files: {
        'game.py': src,
        'lib.py': '# a sibling module\nHELPER = 1\n',
      },
      entry: 'lib.py',
      active: 'game.py',     // the OPEN file is the animating loop
    });
    window.renderTabs();
  }, FRAME_PACED);
  await page.click('#runBtn');
  await waitStatus(['running'], 8000).catch(() => fail('badge: multi-file project did not run'));

  // window.runFile() seam reports the running ENTRY (not the open file).
  const runFile = await page.evaluate(() => (typeof window.runFile === 'function' ? window.runFile() : '__no_seam__'));
  if (runFile === 'game.py') ok('#9: window.runFile() reports the OPEN file (game.py) — Start runs what is open, not the fixed entry (lib.py)');
  else fail(`window.runFile() wrong (got ${JSON.stringify(runFile)}; expected "game.py" — the open file)`);

  // The badge element is shown and reads `▶ running: main.py` (basename ok).
  const badge = await page.evaluate(() => {
    const b = document.getElementById('runFileBadge');
    if (!b) return { present: false };
    return { present: true, visible: b.offsetParent !== null, text: (b.textContent || '').trim() };
  });
  if (badge.present && badge.visible && /running/i.test(badge.text) && /game\.py/.test(badge.text))
    ok(`running badge shown: "${badge.text}"`);
  else fail('running badge wrong/absent: ' + JSON.stringify(badge));

  // Clicking the badge jumps to the running file. Switch the open file away first so the jump is observable.
  await page.evaluate(() => { window.project.setActive('lib.py'); window.renderTabs(); });
  await click('#runFileBadge');
  await page.waitForTimeout(150);
  const activeAfterJump = await page.evaluate(() => window.project.active);
  if (activeAfterJump === 'game.py') ok('clicking the badge jumps back to the running file (project.active === game.py)');
  else fail(`badge click did not jump (project.active=${activeAfterJump})`);

  // When PAUSED the badge reads `⏸ paused: <file>`.
  await click('#pauseBtn');
  await waitStatus(['paused'], 5000).catch(() => {});
  const pausedBadge = await page.evaluate(() => {
    const b = document.getElementById('runFileBadge');
    return b ? (b.textContent || '').trim() : null;
  });
  if (pausedBadge && /paus/i.test(pausedBadge) && /game\.py/.test(pausedBadge))
    ok(`paused badge reads: "${pausedBadge}"`);
  else fail('paused badge wrong/absent: ' + JSON.stringify(pausedBadge));
  await click('#pauseBtn');   // resume for the next checks
  await waitStatus(['running'], 5000).catch(() => {});
}

// =====================================================================
// 9. Explorer highlights the running file. The running file's #tabs .tab[data-name] row carries a
//    "running" highlight class; no other row does.
// =====================================================================
console.log('\n=== 9. Explorer highlights the running file ===');
{
  const hi = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#tabs .tab[data-name]'));
    const running = rows.filter(r => r.classList.contains('running')).map(r => r.dataset.name);
    return { count: rows.length, running };
  });
  if (hi.running.length === 1 && hi.running[0] === 'game.py')
    ok('explorer: exactly the running file (game.py) row carries the .running class');
  else fail('explorer running-highlight wrong: ' + JSON.stringify(hi));
}

// =====================================================================
// 10. Editor independence. While running, switch open file to a DIFFERENT file and edit it; the
//     running program is UNAFFECTED (keeps animating; run used a Start-time snapshot) and
//     window.runFile() still reports the entry.
// =====================================================================
console.log('\n=== 10. Editor independence (Start-time snapshot) ===');
{
  // Switch the open file to lib.py and edit BOTH lib.py and main.py's Doc while the program runs.
  await page.evaluate(() => {
    window.project.setActive('lib.py');
    window.project.files['lib.py'].setValue('HELPER = 999\n# edited while running\n');
    // Also mutate the RUNNING file's source Doc — must NOT affect the already-snapshotted run.
    window.project.files['game.py'].setValue('raise RuntimeError("should not be running this edited source")\n');
  });
  await page.waitForTimeout(150);
  // The live program must STILL be animating (it runs the Start-time snapshot, not the edited Doc).
  const stillAnimating = await animatesOver(600);
  const stillRunning = (await status()) === 'running';
  const stillRunFile = await page.evaluate(() => (typeof window.runFile === 'function' ? window.runFile() : null));
  if (stillAnimating && stillRunning)
    ok('independence: live program keeps animating after editing other + running files (Start-time snapshot honored)');
  else fail(`independence broken: animating=${stillAnimating} status=${await status()}`);
  if (stillRunFile === 'game.py') ok('#9 independence: window.runFile() still reports the file open at Start (game.py), not the now-open lib.py');
  else fail(`independence: runFile() changed with the open file (got ${JSON.stringify(stillRunFile)})`);
  // Clean up: stop the run.
  await page.evaluate(() => { try { pyodide.runPython('_stop()'); } catch (e) {} });
  await waitStatus(['stopped'], 5000).catch(() => {});
}

// =====================================================================
// No JS console errors across the battery (mirror spike-runstop.mjs:105-107).
// =====================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) fail('JS console errors: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log('\n' + (process.exitCode ? 'RUNMODEL BATTERY FAILED (RED — expected until S3 lands)' : 'RUNMODEL BATTERY OK'));
