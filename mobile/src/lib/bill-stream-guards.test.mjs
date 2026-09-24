import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { billActionFailureCode } from './bill-failure.ts';
import { createRequestGeneration } from './request-generation.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

/** The source from `start` up to the end of the statement block it opens. */
function block(source, start) {
  const from = source.indexOf(start);
  assert.ok(from !== -1, `${start} not found`);
  let depth = 0;
  for (let index = source.indexOf('{', from); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(from, index + 1);
  }
  throw new Error(`${start} never closes`);
}

// 2026-09-24: the bill loaded on focus and never again, so a cashier held at
// `ครัวยังทำไม่เสร็จ` stayed held until they left the screen and came back.
// The subscription is a call site, so it is asserted on the source.
test('the bill follows the order stream while it is on screen and unpaid', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(bill, /import \{ useOrderEvents \} from '@\/src\/hooks\/use-order-events';/);
  assert.match(bill, /const isFocused = useIsFocused\(\);/);
  const stream = block(bill, 'useOrderEvents(');
  // A quiet reload that fails silently: no spinner, and no red panel over a
  // bill that is already on screen.
  assert.match(stream, /^useOrderEvents\(\(\) => load\(true, true\), \{/);
  assert.match(bill, /const followingBill = isFocused && canAccessBill && validOrderId && bill\?\.payment_status !== 'paid';/);
  assert.match(stream, /enabled: followingBill,/);
  assert.match(stream, /restaurantId: activeMembership\?\.restaurant_id,/);
  // Every event counts: the server queues one event per phone and drops the
  // rest, so this order's change can arrive as another order's event.
  assert.doesNotMatch(stream, /accepts:/);
  assert.match(stream, /skipConnectedRefreshWithinMs: STREAM_CONNECTED_SKIP_MS,/);
});

test('a reload from the stream keeps the bill on failure and does not re-read the menu', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const load = block(bill, 'const load = useCallback(');
  assert.match(load, /async \(quiet = false, fromStream = false\) =>/);
  assert.match(load, /if \(!fromStream\) setError\(null\);/);
  const failure = block(load, 'catch (err)');
  // Silent once a bill has landed since focus; before that is its own test below.
  const silentAt = failure.indexOf('if (fromStream && landedSinceFocusRef.current) return;');
  assert.ok(silentAt !== -1, 'a failed stream reload raises the red panel');
  assert.ok(silentAt < failure.indexOf('setError('), 'a failed stream reload raises the red panel');
  // The menu is for photos only: read on focus, not on every event, and its
  // failure never becomes the bill's.
  assert.match(load, /canTakeOrder && \(!quiet \|\| !menuLoadedRef\.current\)/);
  assert.match(load, /await listMenuItems\(\)\.catch\(\(\) => null\);/);
});

test('the stream is a second way in, not a replacement for the focus load', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  // The cleanup it returns is asserted in its own test below.
  assert.match(bill, /useFocusEffect\(useCallback\(\(\) => \{\s*landedSinceFocusRef\.current = false;\s*void load\(\);\s*return \(\) => \{/);
  // Focus and the stream keep the bill current; no control asks the cashier to.
  assert.doesNotMatch(bill, /รีเฟรช|'Refresh'|refresh-outline|reload-outline/);
});

// Review, 2026-09-24: load() wrote whatever getBill resolved. With the stream
// reloading on every restaurant event, a reload that left before a change could
// land after the change's own re-read and put the old bill back - with payment
// live, because a load clears billStale.
test('a stream reload that left before a change never lands over the change', () => {
  const requests = createRequestGeneration();
  let shown = 'before';
  const streamReload = requests.begin();
  // The change lands and the bill is re-read as the newest request; beginning
  // it is what drops the reload.
  const reread = requests.begin();
  if (requests.isCurrent(reread)) shown = 'after';
  // The stream's answer, from before the change, comes back last.
  if (requests.isCurrent(streamReload)) shown = 'before';
  assert.equal(shown, 'after');
});

test('only the newest read of the bill may write it', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(bill, /import \{ createRequestGeneration, shouldStartRequest \} from '@\/src\/lib\/request-generation';/);
  assert.match(bill, /const requestGenerationRef = useRef\(createRequestGeneration\(\)\);/);
  const load = block(bill, 'const load = useCallback(');
  assert.match(load, /const request = requestGenerationRef\.current\.begin\(\);/);
  // Checked on the answer, before anything is written.
  assert.match(load, /const nextBill = await getBill\(orderId\);\s*if \(!requestGenerationRef\.current\.isCurrent\(request\)\) return;/);
  // An overtaken failure says nothing, not even quietly.
  assert.match(block(load, 'catch (err)'), /^catch \(err\) \{\s*if \(!requestGenerationRef\.current\.isCurrent\(request\)\) return;/);
  // The spinner's load keeps the spinner: until a bill is on screen, a quiet
  // reload waits for it, then runs. (Why only until then: see the test on the
  // focus load that never answers, below.)
  assert.match(load, /const heldForFirstBill = foregroundRequestRef\.current !== null && !billShownRef\.current;\s*if \(!shouldStartRequest\(quiet, heldForFirstBill\)\) \{\s*pendingQuietReloadRef\.current = true;\s*return;\s*\}/);
  assert.match(load, /if \(!quiet\) \{\s*foregroundRequestRef\.current = request;\s*setLoading\(true\);\s*\}/);
  const settle = block(load, 'finally');
  assert.match(settle, /if \(foregroundRequestRef\.current === request\) \{\s*foregroundRequestRef\.current = null;\s*setLoading\(false\);/);
  assert.match(settle, /pendingQuietReloadRef\.current = false;\s*void load\(true, true\);/);
});

test('a change re-reads the bill as the newest request, and drops the reads already out', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const reread = block(bill, 'async function refreshBillAfterMutation(');
  assert.match(reread, /rereadOwedRef\.current = true;\s*const request = requestGenerationRef\.current\.begin\(\);/);
  assert.match(reread, /const nextBill = await getBill\(orderId\);\s*if \(!requestGenerationRef\.current\.isCurrent\(request\)\) return;/);
  assert.match(block(reread, 'catch (err)'), /if \(!requestGenerationRef\.current\.isCurrent\(request\)\) return;\s*setBillStale\(true\);/);
  // Review, 2026-09-24: the re-read's begin() is what drops the reads already
  // out, and only once the change has landed. A change used to drop them as
  // it STARTED too, which was redundant on success and harmful on refusal: the
  // read that carried the correction (another phone already sent the round)
  // was thrown away and nothing replaced it.
  for (const start of [
    'async function sendRoundToKitchen(',
    'async function deletePendingItem(',
    'async function cancelBillItem(',
    'async function pay(',
  ]) {
    const mutation = block(bill, start);
    assert.doesNotMatch(
      mutation,
      /requestGenerationRef\.current\.invalidate\(\)/,
      `${start} drops the reads already out as it starts, so a refusal loses the read that explains it`,
    );
  }
});

test('a read that fails after a change leaves payment held, however quiet the failure', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const load = block(bill, 'const load = useCallback(');
  // A stream reload can overtake the change's re-read; if it then fails
  // silently, the totals on screen are still behind the server.
  const failure = block(load, 'catch (err)');
  const staleAt = failure.indexOf('if (rereadOwedRef.current) setBillStale(true);');
  assert.ok(staleAt !== -1, 'a failed read after a change no longer holds payment');
  assert.ok(staleAt < failure.indexOf('if (fromStream && landedSinceFocusRef.current) return;'), 'a silent stream failure returns before holding payment');
  assert.match(load, /rereadOwedRef\.current = false;\s*setBill\(nextBill\);\s*setBillStale\(false\);/);
});

// Review, 2026-09-24: on resume the foreground resync can fail while the
// network wakes, and the stream's greeting just after it is skipped as too
// soon - nothing asked again, so the bill stayed at `ครัวยังทำไม่เสร็จ`.
test('a failed stream reload is asked again by a slow quiet reload while the bill is followed', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(bill, /const BILL_RECOVERY_POLL_MS = 30_000;/);
  assert.match(bill, /import \{ AccessibilityInfo, AppState, /);
  const at = bill.search(/useEffect\(\(\) => \{\s*if \(!followingBill\) return;/);
  assert.ok(at !== -1, 'the recovery reload is gone, or no longer stops when the bill is not followed');
  const recovery = block(bill.slice(at), 'useEffect(');
  assert.match(
    recovery,
    /setInterval\(\(\) => \{\s*if \(AppState\.currentState !== 'active'\) return;\s*void load\(true, true\);\s*\}, BILL_RECOVERY_POLL_MS\);/,
  );
  assert.match(recovery, /return \(\) => clearInterval\(timer\);/);
  assert.match(bill.slice(at + recovery.length), /^\s*, \[followingBill, load\]\);/);
});

// Review, 2026-09-24: sending a round another phone had already sent was
// refused with `ไม่มีรายการรอส่งครัว`, and the stream read that was bringing
// the bill without those lines was dropped as the send started - so the
// refusal sat over a bill that still offered the same send.
test('a refused change keeps the read that carries the correction', () => {
  const requests = createRequestGeneration();
  let shown = 'still pending';
  // Another phone sent the round; the event's reload is on its way.
  const streamReload = requests.begin();
  // This phone's send starts and is refused. Nothing landed, so nothing is
  // re-read and nothing drops the reload.
  // The reload comes back with the round already sent.
  if (requests.isCurrent(streamReload)) shown = 'already sent';
  assert.equal(shown, 'already sent');

  // What dropping the reads as the change started did to the same sequence.
  const before = createRequestGeneration();
  let shownBefore = 'still pending';
  const droppedReload = before.begin();
  before.invalidate();
  if (before.isCurrent(droppedReload)) shownBefore = 'already sent';
  assert.equal(shownBefore, 'still pending');
});

// Review, 2026-09-24: every quiet reload waited for the focus load, even over a
// bill already on screen. getBill has no timeout on Android, so a focus load
// that never answered held back the stream, the 30 s recovery reload and the
// stale-bill retry - the recovery added for exactly that flaky network.
test('a focus load that never answers holds nothing back once a bill is on screen', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(bill, /const billShownRef = useRef\(false\);/);
  const load = block(bill, 'const load = useCallback(');
  // Held back only while no bill has loaded yet.
  assert.match(load, /const heldForFirstBill = foregroundRequestRef\.current !== null && !billShownRef\.current;/);
  assert.doesNotMatch(load, /shouldStartRequest\(quiet, foregroundRequestRef\.current !== null\)/, 'a quiet reload waits for the focus load over a bill already on screen');
  // Set by the reads that put a bill on screen, and only after they have.
  assert.match(load, /setBill\(nextBill\);\s*setBillStale\(false\);\s*setError\(null\);\s*billShownRef\.current = true;/);
  const reread = block(bill, 'async function refreshBillAfterMutation(');
  assert.match(reread, /setBill\(nextBill\);\s*setBillStale\(false\);\s*billShownRef\.current = true;/);

  // Leaving the screen lets go of the loads it started, as tables.tsx and
  // kitchen.tsx do.
  const focus = block(bill, 'useFocusEffect(useCallback(');
  assert.match(
    focus,
    /return \(\) => \{\s*requestGenerationRef\.current\.invalidate\(\);\s*foregroundRequestRef\.current = null;\s*pendingQuietReloadRef\.current = false;\s*\};/,
  );
  // The spinner stays for the next focus's load to own: taken down here, the
  // way back to a bill that never loaded would pass through `ไม่พบบิลนี้`.
  assert.doesNotMatch(focus, /setLoading\(false\)/);
});

// Review, 2026-09-24: once a bill had been on screen, a stream or poll read
// started while the focus load was out ran at once, and its begin() dropped the
// focus load's answer. If that read then failed it returned silently, so the
// bill from before the screen was left stayed up with no sign the latest one
// never arrived, and payment live on its old total.
//
// Review, 2026-09-25: the first fix decided that duty per read, from whether
// the focus load was still out as the read began. The duty was not handed on:
// stream read A dropped the focus load and hung, the focus load's dropped
// answer took `foregroundRequestRef` down, and poll read B then began with
// nothing out, dropped A, failed and said nothing - as did every poll after.
// The duty now lasts until a read has brought a bill since focus.
test('a quiet read fails silently only once a bill has landed since focus', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(bill, /const landedSinceFocusRef = useRef\(false\);/);
  const load = block(bill, 'const load = useCallback(');
  assert.doesNotMatch(bill, /takesOverFocusLoad/, 'the duty to report is snapshotted per read again');
  const failure = block(load, 'catch (err)');
  assert.doesNotMatch(failure, /if \(fromStream\) return;/, 'a stream read before any bill landed since focus fails silently');
  const silentAt = failure.indexOf('if (fromStream && landedSinceFocusRef.current) return;');
  assert.ok(silentAt !== -1 && silentAt < failure.indexOf('setError('), 'the focus load\'s failure is not reported');

  // Owed again on every focus, before that focus's load starts.
  const focus = block(bill, 'useFocusEffect(useCallback(');
  assert.match(focus, /^useFocusEffect\(useCallback\(\(\) => \{\s*landedSinceFocusRef\.current = false;\s*void load\(\);/);
  // Paid off only where a bill is written: every setBill(nextBill) is followed
  // by it, in load() and in the change's re-read.
  assert.match(load, /setBill\(nextBill\);\s*setBillStale\(false\);\s*setError\(null\);\s*billShownRef\.current = true;\s*landedSinceFocusRef\.current = true;/);
  const reread = block(bill, 'async function refreshBillAfterMutation(');
  assert.match(reread, /setBill\(nextBill\);\s*setBillStale\(false\);\s*billShownRef\.current = true;\s*landedSinceFocusRef\.current = true;/);
  assert.equal(bill.split('setBill(').length - 1, 2, 'a bill is written somewhere the landing is not recorded');
  assert.equal(bill.split('landedSinceFocusRef.current = true;').length - 1, 2, 'the landing is recorded without a bill written');
});

/**
 * load() and the focus effect over the request generation, reduced to what
 * decides whether a failure is reported. `silentWhen(read, landedSinceFocus)`
 * is the rule under test. The bill from before the screen was left is on
 * screen, so every quiet read runs at once.
 */
function billReads(silentWhen) {
  const requests = createRequestGeneration();
  let foreground = null;
  let landedSinceFocus = true;
  let reported = 0;
  const start = (quiet, fromStream) => {
    const takesOverFocusLoad = quiet && foreground !== null;
    const request = requests.begin();
    if (!quiet) foreground = request;
    return { request, fromStream, takesOverFocusLoad };
  };
  const settle = (read) => {
    if (foreground === read.request) foreground = null;
  };
  return {
    focus() {
      landedSinceFocus = false;
      return start(false, false);
    },
    stream: () => start(true, true),
    land(read) {
      if (requests.isCurrent(read.request)) landedSinceFocus = true;
      settle(read);
    },
    fail(read) {
      if (requests.isCurrent(read.request) && !silentWhen(read, landedSinceFocus)) reported += 1;
      settle(read);
    },
    get reported() { return reported; },
  };
}

const perReadRule = (read) => read.fromStream && !read.takesOverFocusLoad;
const sinceFocusRule = (read, landedSinceFocus) => read.fromStream && landedSinceFocus;

test('the focus load\'s failure is not lost to the read that dropped it', () => {
  // Focus load out, a stream read drops it, the focus load's answer is
  // dropped, the stream read fails.
  for (const rule of [perReadRule, sinceFocusRule]) {
    const reads = billReads(rule);
    const focus = reads.focus();
    const stream = reads.stream();
    reads.fail(focus);
    reads.fail(stream);
    assert.equal(reads.reported, 1);
  }
  const silentOnStream = billReads((read) => read.fromStream);
  const focus = silentOnStream.focus();
  const stream = silentOnStream.stream();
  silentOnStream.fail(focus);
  silentOnStream.fail(stream);
  assert.equal(silentOnStream.reported, 0, 'silence on every stream failure should lose it');
});

test('the duty to report passes to the read that drops a hanging one', () => {
  function run(rule) {
    const reads = billReads(rule);
    const focus = reads.focus();
    // Stream read A drops the focus load and never answers.
    reads.stream();
    // The focus load's answer comes back dropped, and lets go of the spinner.
    reads.fail(focus);
    // The poll's read B begins with nothing out, drops A, and fails; so does
    // the next poll.
    reads.fail(reads.stream());
    reads.fail(reads.stream());
    return reads.reported;
  }
  assert.equal(run(perReadRule), 0, 'the per-read rule should lose it - the case this guards');
  assert.equal(run(sinceFocusRule), 2);
});

test('once a bill has landed since focus, a failed quiet read stays silent', () => {
  const reads = billReads(sinceFocusRule);
  reads.land(reads.focus());
  reads.fail(reads.stream());
  assert.equal(reads.reported, 0);
  // The next focus owes it again.
  const focus = reads.focus();
  reads.stream();
  reads.fail(focus);
  reads.fail(reads.stream());
  assert.equal(reads.reported, 1);
});

// Review, 2026-09-24: a send, delete or take-off refused because another phone
// had already moved the order on left the refused rows up until the next event
// or the 30 s recovery reload.
test('a refusal that means the server moved on reads the bill again at once', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.match(
    bill,
    /import \{ billActionFailureCode, billActionFailureMessage, type BillActionFailureCode \} from '@\/src\/lib\/bill-failure';/,
  );
  const set = bill.match(/const SERVER_MOVED_FAILURES: ReadonlySet<BillActionFailureCode> = new Set<BillActionFailureCode>\(\[([\s\S]*?)\]\);/);
  assert.ok(set, 'the refusals that mean the server moved on are gone');
  assert.deepEqual(
    [...set[1].matchAll(/'(\w+)'/g)].map((match) => match[1]).sort(),
    ['already_sent', 'gone', 'nothing_to_send', 'order_closed'],
  );
  // Quiet and silent: the toast has already said what was refused.
  assert.match(
    block(bill, 'function rereadIfServerMoved('),
    /if \(SERVER_MOVED_FAILURES\.has\(billActionFailureCode\(err\)\)\) void load\(true, true\);/,
  );
  for (const start of [
    'async function sendRoundToKitchen(',
    'async function deletePendingItem(',
    'async function cancelBillItem(',
  ]) {
    assert.match(
      block(block(bill, start), 'catch (err)'),
      /rereadIfServerMoved\(err\);/,
      `${start} leaves the refused rows up until the next event`,
    );
  }
  // What the server actually says for each, so the set names codes that happen.
  assert.equal(billActionFailureCode(new Error('no pending items to send')), 'nothing_to_send');
  assert.equal(billActionFailureCode(new Error('only pending items can be edited')), 'already_sent');
  assert.equal(billActionFailureCode(new Error('cannot send a closed order to kitchen')), 'order_closed');
  assert.equal(billActionFailureCode(new Error('order item not found')), 'gone');
});
