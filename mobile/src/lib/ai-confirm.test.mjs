import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmDestination,
  confirmKicker,
  confirmLabel,
  confirmLayout,
  confirmRowName,
  confirmSavedAt,
  readableFigure,
} from './ai-confirm.ts';

const created = {
  title: 'หมูสามชั้นต้ม',
  change: 'เพิ่มเข้าคลัง · หน่วยกิโลกรัม · เริ่มที่ 3',
  kind: 'create_ingredient',
  facts: [{ label: 'หน่วย', value: 'กิโลกรัม' }, { label: 'สต๊อกเริ่มต้น', value: '3 กิโลกรัม' }],
};
const stockIn = { title: 'หมูสับ', change: '5 → 7', kind: 'adjust_ingredient_stock', field: 'สต๊อก', from: '5', to: '7', valueUnit: 'กิโลกรัม', delta: '+2' };
const minStock = { title: 'กุ้งสด', change: 'ขั้นต่ำ 1 → 2', kind: 'set_ingredient_min_stock', field: 'ขั้นต่ำ', from: '1', to: '2', valueUnit: 'กิโลกรัม', delta: '+1' };
const menuOff = { title: 'ต้มยำกุ้ง', change: 'เปิดขาย → ปิดขาย', kind: 'set_menu_availability', field: 'สถานะ', from: 'เปิดขาย', to: 'ปิดขาย' };

test('a new row lists what it holds, a moving value shows from → to, an old plan keeps its sentence', () => {
  assert.equal(confirmLayout(created), 'facts');
  assert.equal(confirmLayout(stockIn), 'delta');
  assert.equal(confirmLayout(menuOff), 'delta');
  assert.equal(confirmLayout({ title: 'หมูสับ', change: '5 → 7', unit: 'กิโลกรัม' }), 'sentence');
});

test('the kicker names the kind while pending and the ending afterwards', () => {
  assert.deepEqual(confirmKicker([created], 'pending', 'th'), { icon: 'add-circle-outline', text: 'เพิ่มวัตถุดิบใหม่' });
  assert.equal(confirmKicker([stockIn], 'pending', 'th').text, 'รับของเข้าคลัง');
  assert.equal(confirmKicker([{ ...stockIn, delta: '-2' }], 'pending', 'th').text, 'ตัดสต๊อก');
  assert.equal(confirmKicker([menuOff], 'pending', 'th').icon, 'eye-off-outline');
  assert.equal(confirmKicker([stockIn, minStock, menuOff], 'pending', 'th').text, 'แก้ข้อมูล 3 รายการ');
  assert.deepEqual(confirmKicker([created], 'done', 'th'), { icon: 'checkmark-circle', text: 'เพิ่มวัตถุดิบใหม่แล้ว' });
  assert.equal(confirmKicker([created], 'cancelled', 'th').text, 'ยกเลิกแล้ว');
  assert.equal(confirmKicker([created], 'expired', 'th').text, 'หมดเวลายืนยัน');
});

test('plan rows name the field only where the item name alone would mislead', () => {
  assert.equal(confirmRowName(minStock), 'กุ้งสด · ขั้นต่ำ');
  assert.equal(confirmRowName(stockIn), 'หมูสับ');
  assert.equal(confirmLabel(1, 'th'), 'ยืนยัน');
  assert.equal(confirmLabel(3, 'th'), 'ยืนยันทั้ง 3');
});

test('"see it" goes to the one screen a change landed on, and nowhere for a mixed plan', () => {
  assert.equal(confirmDestination([created, stockIn])?.href, '/inventory');
  assert.equal(confirmDestination([menuOff])?.href, '/menu');
  assert.equal(confirmDestination([{ title: 'ค่าไฟ', change: '', kind: 'create_expense' }])?.href, '/expenses');
  assert.equal(confirmDestination([stockIn, menuOff]), null);
  assert.equal(confirmDestination([{ title: 'x', change: '' }]), null);
});

test('the saved time is read on the restaurant clock', () => {
  assert.equal(confirmSavedAt(Date.UTC(2026, 8, 14, 13, 28)), '20:28');
});

test('figures get thousands separators and words pass through', () => {
  assert.equal(readableFigure('5073.91'), '5,073.91');
  assert.equal(readableFigure('+2000'), '+2,000');
  assert.equal(readableFigure('-150'), '-150');
  assert.equal(readableFigure('0.005'), '0.005');
  assert.equal(readableFigure('ปิดขาย'), 'ปิดขาย');
});
