import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerChips,
  formatCountdown,
  isConversationGone,
  matchesThreadQuery,
  parseSSE,
  readAIOutage,
  receiptDraftToCommand,
  splitChange,
  threadGroup,
  turnsToMessages,
  welcomeFor,
  bytesToBase64,
} from './ai-chat.ts';

test('parseSSE splits complete events and keeps the unfinished tail', () => {
  const wire = 'event: draft\ndata: {"text":"สวัส"}\n\nevent:draft\ndata:{"text":"สวัสดี"}\n\nevent: answer\ndata: {"ans';
  const { events, rest } = parseSSE(wire);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { event: 'draft', data: '{"text":"สวัส"}' });
  assert.deepEqual(events[1], { event: 'draft', data: '{"text":"สวัสดี"}' });
  assert.equal(rest, 'event: answer\ndata: {"ans');
});

test('parseSSE joins multi-line data and ignores comments and CRLF', () => {
  const { events } = parseSSE(': keep-alive\r\nevent: answer\r\ndata: {"a":\r\ndata: 1}\r\n\r\n');
  assert.deepEqual(events, [{ event: 'answer', data: '{"a":\n1}' }]);
});

test('answerChips puts the navigate chip first and sends follow-ups verbatim', () => {
  const chips = answerChips([' เทียบกับสัปดาห์ก่อน ', '', 'ดูกำไร'], { href: '/menu', label: 'เมนู' }, 'th');
  assert.equal(chips.length, 3);
  assert.equal(chips[0].id, 'nav-answer');
  assert.equal(chips[0].href, '/menu');
  assert.equal(chips[0].label, 'พาไปหน้าเมนู');
  assert.equal(chips[1].prompt, 'เทียบกับสัปดาห์ก่อน');
  assert.equal(chips[2].label, 'ดูกำไร');
});

test('answerChips returns nothing when the model wrote nothing', () => {
  assert.equal(answerChips([], undefined, 'th'), undefined);
  assert.equal(answerChips(undefined, null, 'en'), undefined);
});

test('answerChips caps at five', () => {
  const chips = answerChips(['a', 'b', 'c', 'd', 'e', 'f'], { href: '/x', label: 'X' }, 'en');
  assert.equal(chips.length, 5);
  assert.equal(chips[0].label, 'Go to X');
});

test('turnsToMessages makes a question and an answer per turn with the stored display', () => {
  const messages = turnsToMessages([
    {
      id: 't1',
      sequence: 1,
      question: 'ยอดขาย',
      answer: 'ขายได้ 4,120 บาท',
      tool: 'get_sales_today',
      latency_ms: 900,
      created_at: '2026-09-08T02:00:00Z',
      display: { follow_ups: ['เทียบเมื่อวาน'], chart: { kind: 'bar', title: 'x', categories: ['a'], series: [{ values: [1] }] }, action_plan_id: 'p1' },
    },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'ยอดขาย');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].chart?.title, 'x');
  assert.deepEqual(messages[1].toolsUsed, ['get_sales_today']);
  assert.equal(messages[1].planId, 'p1');
  assert.equal(messages[1].actions?.[0].prompt, 'เทียบเมื่อวาน');
});

test('threadGroup buckets by day like a chat app', () => {
  const now = new Date(2026, 8, 8, 12, 0, 0);
  assert.equal(threadGroup(new Date(2026, 8, 8, 1), now), 'today');
  assert.equal(threadGroup(new Date(2026, 8, 7, 23), now), 'yesterday');
  assert.equal(threadGroup(new Date(2026, 8, 3), now), 'week');
  assert.equal(threadGroup(new Date(2026, 8, 1), now), 'older');
});

test('matchesThreadQuery is a case-insensitive substring match', () => {
  assert.equal(matchesThreadQuery('เมนูขายดี', 'ขายดี'), true);
  assert.equal(matchesThreadQuery('Sales', 'SAL'), true);
  assert.equal(matchesThreadQuery('เมนู', 'กำไร'), false);
  assert.equal(matchesThreadQuery('อะไรก็ได้', '  '), true);
});

test('welcomeFor greets by the part of the day, and always ends on the name', () => {
  const at = (hour) => new Date(2026, 8, 8, hour, 0, 0);

  // The first line of each band, so the wording is pinned rather than sampled.
  assert.equal(welcomeFor('th', 'พี่กัน', at(7), 0), 'อรุณสวัสดิ์พี่กัน');
  assert.equal(welcomeFor('th', 'พี่กัน', at(12), 0), 'สวัสดีตอนกลางวันพี่กัน');
  assert.equal(welcomeFor('th', 'พี่กัน', at(15), 0), 'สวัสดีตอนบ่ายพี่กัน');
  assert.equal(welcomeFor('th', 'พี่กัน', at(20), 0), 'สวัสดีตอนเย็นพี่กัน');
  assert.equal(welcomeFor('th', 'พี่กัน', at(23), 0), 'ดึกแล้วนะพี่กัน');
  // Before 05:00 belongs to the night that started the evening before, not to
  // the morning — the owner is still on the same shift.
  assert.equal(welcomeFor('th', 'พี่กัน', at(2), 0), 'ดึกแล้วนะพี่กัน');

  assert.equal(welcomeFor('en', 'Kan', at(7), 0), 'Good morning, Kan');
  assert.equal(welcomeFor('en', 'Kan', at(20), 0), 'Good evening, Kan');

  // No title set: the default is used, in the language being read.
  assert.equal(welcomeFor('th', '', at(7), 0), 'อรุณสวัสดิ์คุณผู้จัดการ');
  assert.equal(welcomeFor('en', ' ', at(12), 0), 'Good afternoon, Manager');

  // The roll picks between the lines of one band and never runs off the end,
  // including at exactly 1 — Math.random() cannot return it, but a caller can.
  const rolled = new Set([0, 0.4, 0.9, 1].map((roll) => welcomeFor('th', 'พี่กัน', at(7), roll)));
  assert.ok(rolled.size > 1, 'the roll should choose between different lines');
  for (const line of rolled) assert.ok(line.endsWith('พี่กัน'), line);
});

test('formatCountdown never goes negative and pads seconds', () => {
  assert.equal(formatCountdown(61_000), '1:01');
  assert.equal(formatCountdown(4_200), '0:05');
  assert.equal(formatCountdown(-500), '0:00');
});

test('splitChange reads both arrow styles', () => {
  assert.deepEqual(splitChange('12 → 17'), { from: '12', to: '17' });
  assert.deepEqual(splitChange('เปิดขาย -> ปิดขาย'), { from: 'เปิดขาย', to: 'ปิดขาย' });
  assert.equal(splitChange('+5'), null);
});

test('isConversationGone and readAIOutage read the ApiError details body', () => {
  const gone = { details: JSON.stringify({ code: 'conversation_gone', error: 'x' }) };
  assert.equal(isConversationGone(gone), true);
  assert.equal(isConversationGone({ details: '{"code":"other"}' }), false);
  assert.equal(isConversationGone(new Error('nope')), false);
  const quota = readAIOutage({ details: JSON.stringify({ code: 'ai_quota_exceeded', error: 'โควตาเต็ม', retry_after_seconds: 900 }) });
  assert.deepEqual(quota, { kind: 'quota', message: 'โควตาเต็ม', retryAfterSeconds: 900 });
  assert.equal(readAIOutage({ details: '{"code":"nothing"}' }), null);
});

test('receiptDraftToCommand writes a sentence the expense command understands', () => {
  const text = receiptDraftToCommand({ category: 'utilities', amount: 3200, spent_at: '2026-09-08', vendor: 'การไฟฟ้า', note: 'ค่าไฟ ส.ค.', confidence: 'high' }, 'th');
  assert.equal(text, 'บันทึกค่าน้ำค่าไฟ การไฟฟ้า ค่าไฟ ส.ค. 3,200 บาท วันที่ 2026-09-08');
  const bare = receiptDraftToCommand({ category: 'other', amount: 0, spent_at: '', vendor: '', note: '', confidence: 'low' }, 'th');
  assert.equal(bare, 'บันทึกรายจ่ายอื่น');
});

test('bytesToBase64 matches the standard encoding, padding included', () => {
  const encode = (text) => bytesToBase64(new Uint8Array([...text].map((c) => c.charCodeAt(0))));
  assert.equal(encode(''), '');
  assert.equal(encode('f'), 'Zg==');
  assert.equal(encode('fo'), 'Zm8=');
  assert.equal(encode('foo'), 'Zm9v');
  assert.equal(encode('foob'), 'Zm9vYg==');
  assert.equal(encode('foobar'), 'Zm9vYmFy');
  // Bytes above 127 are where a naive string-based encoder goes wrong.
  assert.equal(bytesToBase64(new Uint8Array([0, 255, 128, 1])), Buffer.from([0, 255, 128, 1]).toString('base64'));
});
