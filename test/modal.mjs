// MODAL + TOAST battery (request #13) — replace native browser dialogs with an aesthetic in-app
// modal (choices, blurred backdrop) + a calm auto-dismissing toast (non-choice notices).
//
// Design: docs/specs/2026-06-25-aesthetic-modal-design.md. M1 tests the COMPONENTS in isolation
// (confirmModal Promise resolution, focus-trap, danger style, backdrop blur; toast appears + dismisses).
// M2 wires the real call sites (delete/replace/reset/restore) and is covered by the explorer/examples/
// history batteries driving the modal.
//
// Seams: #modalBackdrop, .modal[role="dialog"], [data-act="confirm"]/[data-act="cancel"], #toastHost .toast.
// window.confirmModal / window.toast are the test seams.
//
// Run: node test/modal.mjs http://localhost:8923/

import { launch } from './_harness.mjs';

const URL = process.argv[2] || 'http://localhost:8923/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(String(e)));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok -', m);

const booted = () => page.waitForFunction(
  () => ['running', 'ready', 'finished'].includes(document.getElementById('status').textContent),
  null, { timeout: 120_000 });

// Open a confirmModal and capture its eventual resolution on window.__cm.
const openModal = (opts) => page.evaluate((o) => { window.__cm = 'pending'; window.confirmModal(o).then(v => { window.__cm = v; }); }, opts);
const modalShown = () => page.waitForSelector('#modalBackdrop .modal[role="dialog"]', { timeout: 3000 });
const modalGone = () => page.waitForFunction(() => !document.querySelector('#modalBackdrop'), null, { timeout: 3000 });
const resolved = () => page.evaluate(() => window.__cm);

await page.goto(URL, { waitUntil: 'load' });
await booted().catch(() => fail('never booted'));

// ================================================================================================
// 1. The component exists and opening it renders a dialog on a BLURRED backdrop.
// ================================================================================================
{
  const hasFn = await page.evaluate(() => typeof window.confirmModal === 'function' && typeof window.toast === 'function');
  if (hasFn) ok('window.confirmModal + window.toast exist (test seams)');
  else fail('confirmModal/toast not defined');

  await openModal({ title: 'Delete file', message: 'Delete "main.py"? This can\'t be undone.', confirmLabel: 'Delete', danger: true });
  await modalShown().catch(() => fail('modal did not render'));
  const look = await page.evaluate(() => {
    const bd = document.getElementById('modalBackdrop');
    const dlg = bd && bd.querySelector('.modal[role="dialog"]');
    const cs = bd ? getComputedStyle(bd) : null;
    const blurred = !!cs && /blur\(/.test((cs.backdropFilter || cs.webkitBackdropFilter || ''));
    return {
      backdrop: !!bd, dialog: !!dlg, ariaModal: dlg && dlg.getAttribute('aria-modal') === 'true', blurred,
      hasMessage: !!dlg && /main\.py/.test(dlg.textContent || ''),
      confirmBtn: !!bd.querySelector('[data-act="confirm"]'), cancelBtn: !!bd.querySelector('[data-act="cancel"]'),
      // covers the whole viewport (it's the "everything blurred" backdrop)
      coversViewport: !!cs && (cs.position === 'fixed'),
    };
  });
  if (look.backdrop && look.dialog && look.ariaModal && look.hasMessage && look.confirmBtn && look.cancelBtn)
    ok('confirmModal renders a [role=dialog] with the message + Confirm/Cancel buttons');
  else fail('modal structure wrong: ' + JSON.stringify(look));
  if (look.blurred && look.coversViewport)
    ok('the backdrop is full-viewport and blurred (everything-else-blurred)');
  else fail('backdrop is not a blurred full-viewport layer: ' + JSON.stringify(look));
}

// ================================================================================================
// 2. Focus moves INTO the modal on open, and Tab is trapped within it.
// ================================================================================================
{
  const focus = await page.evaluate(() => {
    const bd = document.getElementById('modalBackdrop');
    const inModal = bd && bd.contains(document.activeElement);
    return { inModal, active: document.activeElement && document.activeElement.getAttribute('data-act') };
  });
  if (focus.inModal) ok('focus moves into the modal on open (active element is inside the dialog)');
  else fail('focus did not move into the modal: ' + JSON.stringify(focus));
  // Tab repeatedly — focus must stay within the modal (trap).
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  const trapped = await page.evaluate(() => document.getElementById('modalBackdrop')?.contains(document.activeElement));
  if (trapped) ok('focus-trap: Tab keeps focus inside the modal');
  else fail('focus escaped the modal on Tab');
}

// ================================================================================================
// 3. Danger styling: the confirm button is the delete-red (--bad), distinct from the cancel button.
// ================================================================================================
{
  const danger = await page.evaluate(() => {
    const c = document.querySelector('#modalBackdrop [data-act="confirm"]');
    const x = document.querySelector('#modalBackdrop [data-act="cancel"]');
    const col = (el) => el ? getComputedStyle(el).backgroundColor + '|' + getComputedStyle(el).color + '|' + getComputedStyle(el).borderColor : '';
    return { confirm: col(c), cancel: col(x), differ: col(c) !== col(x) };
  });
  if (danger.differ) ok('danger confirm button is visually distinct from cancel: ' + danger.confirm);
  else fail('danger confirm not styled distinctly: ' + JSON.stringify(danger));
}

// ================================================================================================
// 4. Clicking Confirm resolves the promise TRUE and closes the modal.
// ================================================================================================
{
  await page.click('#modalBackdrop [data-act="confirm"]');
  await modalGone().catch(() => fail('modal did not close after Confirm'));
  const v = await resolved();
  if (v === true) ok('clicking Confirm resolves confirmModal → true and closes the modal');
  else fail('Confirm did not resolve true: ' + JSON.stringify(v));
}

// ================================================================================================
// 5. Clicking Cancel resolves FALSE.
// ================================================================================================
{
  await openModal({ title: 'X', message: 'Y', confirmLabel: 'OK' });
  await modalShown();
  await page.click('#modalBackdrop [data-act="cancel"]');
  await modalGone();
  if ((await resolved()) === false) ok('clicking Cancel resolves confirmModal → false');
  else fail('Cancel did not resolve false');
}

// ================================================================================================
// 6. Escape resolves FALSE (cancel).
// ================================================================================================
{
  await openModal({ title: 'X', message: 'Y' });
  await modalShown();
  await page.keyboard.press('Escape');
  await modalGone();
  if ((await resolved()) === false) ok('Escape resolves confirmModal → false (cancel)');
  else fail('Escape did not resolve false');
}

// ================================================================================================
// 7. Clicking the BACKDROP (outside the card) resolves FALSE (cancel).
// ================================================================================================
{
  await openModal({ title: 'X', message: 'Y' });
  await modalShown();
  // click near the top-left corner of the backdrop, away from the centered card.
  await page.mouse.click(8, 8);
  await modalGone().catch(() => {});
  if ((await resolved()) === false) ok('clicking the backdrop resolves confirmModal → false (cancel)');
  else fail('backdrop click did not resolve false: ' + JSON.stringify(await resolved()));
}

// ================================================================================================
// 8. Toast: appears with the message, no backdrop, and auto-dismisses.
// ================================================================================================
{
  await page.evaluate(() => window.toast('Can\'t delete the only file.', { ms: 600 }));
  const shown = await page.evaluate(() => {
    const t = document.querySelector('#toastHost .toast');
    return { present: !!t, text: t ? t.textContent : '', noBackdrop: !document.getElementById('modalBackdrop') };
  });
  if (shown.present && /only file/.test(shown.text) && shown.noBackdrop)
    ok('toast shows the notice with NO backdrop (calm, non-blocking)');
  else fail('toast did not appear correctly: ' + JSON.stringify(shown));
  await page.waitForFunction(() => !document.querySelector('#toastHost .toast'), null, { timeout: 3000 }).catch(() => {});
  const gone = await page.evaluate(() => !document.querySelector('#toastHost .toast'));
  if (gone) ok('toast auto-dismisses');
  else fail('toast did not auto-dismiss');
}

// ================================================================================================
const realErrors = jsErrors.filter(e => !/favicon/.test(e));
if (realErrors.length) console.log('info - JS console errors observed: ' + realErrors.join(' | '));
else ok('no JS console errors');

await browser.close();
console.log(process.exitCode ? 'MODAL BATTERY FAILED' : 'MODAL BATTERY OK');
