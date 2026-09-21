import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReceiptModel } from './receipt.ts';

test('the printed receipt carries the restaurant, order, and payment context', () => {
  const bill = {
    order: {
      order_number: 'A001',
      order_type: 'dine_in',
      opened_at: '2026-07-29T10:00:00Z',
      closed_at: '2026-07-29T10:30:00Z',
      table: { display_label: 'โต๊ะ A1' },
      staff: { nickname: 'มะลิ', first_name: '', last_name: '' },
    },
    items: [{
      ID: 1,
      menu_name: 'ข้าวผัด',
      quantity: 2,
      subtotal: 120,
      selected_options: [{ ID: 1, option_name: 'ไข่ดาว' }],
      note: 'ไม่ใส่หอม',
    }],
    subtotal: 120,
    discount_amount: 0,
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 120,
    payment_status: 'paid',
    payments: [{
      method: 'promptpay_qr',
      paid_at: '2026-07-29T10:30:00Z',
    }],
  };
  const restaurant = {
    name: 'ร้านตัวอย่าง',
    branch_name: 'สาขากลาง',
    address: 'กรุงเทพฯ',
    phone: '0000000000',
  };

  const model = buildReceiptModel(bill, restaurant);

  assert.deepEqual(model.heading, [
    'ร้านตัวอย่าง',
    'สาขากลาง',
    'กรุงเทพฯ',
    'Tel. 0000000000',
  ]);
  assert.equal(model.title, 'ใบเสร็จรับเงิน');
  assert.deepEqual(
    model.meta.map((entry) => [entry.label, entry.value]).filter(([label]) => label !== 'วันที่'),
    [
      ['เลขอ้างอิง', 'A001'],
      ['โต๊ะ / ช่องทาง', 'โต๊ะ A1'],
      ['พนักงาน', 'มะลิ'],
    ],
  );
  assert.deepEqual(model.items, [{
    key: '1',
    quantity: '2',
    name: 'ข้าวผัด',
    amount: '฿120.00',
    options: 'ไข่ดาว',
    note: 'ไม่ใส่หอม',
  }]);
  assert.equal(model.paymentLine, 'ชำระโดย PromptPay QR');
  assert.equal(model.footer, 'ขอบคุณที่ใช้บริการ');
});

test('optional identity fields fall back rather than printing blanks', () => {
  const model = buildReceiptModel({
    order: {
      order_number: 'A002',
      order_type: 'takeaway',
      opened_at: 'not-a-date',
    },
    items: [],
    subtotal: 0,
    discount_amount: 0,
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 0,
    payment_status: 'unpaid',
    payments: [],
  });

  assert.deepEqual(model.heading, ['Dishy']);
  const byLabel = Object.fromEntries(model.meta.map((entry) => [entry.label, entry.value]));
  assert.equal(byLabel['โต๊ะ / ช่องทาง'], 'ซื้อกลับบ้าน');
  assert.equal(byLabel['วันที่'], '-');
  assert.equal(byLabel['พนักงาน'], '-');
  assert.equal(model.paymentLine, 'ยังไม่ชำระ');
});

test('labels, money, and payment method localise to English', () => {
  const model = buildReceiptModel({
    order: {
      order_number: 'A003',
      order_type: 'takeaway',
      opened_at: '2026-07-29T10:00:00Z',
      staff: { nickname: 'May', first_name: '', last_name: '' },
    },
    items: [{
      ID: 1,
      menu_name: 'Fried rice',
      quantity: 2,
      subtotal: 1200,
      selected_options: [],
    }],
    subtotal: 1200,
    discount_amount: 0,
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 1200,
    payment_status: 'paid',
    payments: [{ method: 'cash', paid_at: '2026-07-29T10:30:00Z' }],
  }, undefined, 'en');

  assert.equal(model.title, 'Receipt');
  const byLabel = Object.fromEntries(model.meta.map((entry) => [entry.label, entry.value]));
  assert.equal(byLabel.Reference, 'A003');
  assert.equal(byLabel['Table / channel'], 'Takeaway');
  assert.equal(byLabel.Staff, 'May');
  assert.equal(model.items[0].amount, '฿1,200.00');
  assert.equal(model.paymentLine, 'Paid by Cash');
  assert.equal(model.footer, 'Thank you');
});

test('the totals block only carries the lines the bill actually has', () => {
  const base = {
    order: { order_number: 'A004', order_type: 'dine_in' },
    items: [],
    subtotal: 100,
    discount_amount: 0,
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 100,
    payment_status: 'paid',
    payments: [],
  };

  assert.deepEqual(
    buildReceiptModel(base).totals.map((total) => total.key),
    ['subtotal', 'grand'],
  );
  assert.deepEqual(
    buildReceiptModel({
      ...base,
      discount_amount: 10,
      service_charge_enabled: true,
      service_charge_amount: 9,
      vat_enabled: true,
      vat_amount: 7,
    }).totals.map((total) => total.key),
    ['subtotal', 'discount', 'service', 'vat', 'grand'],
  );
});

test('each promotion the till applied gets its own deduction line', () => {
  const model = buildReceiptModel({
    order: { order_number: 'A006', order_type: 'dine_in' },
    items: [],
    subtotal: 500,
    discount_amount: 130,
    promotions: [
      { ID: 1, order_id: 1, promotion_id: 7, name: 'ชาเย็น 1 แถม 1', type: 'buy_x_get_y', times: 2, amount: 80 },
      { ID: 2, order_id: 1, promotion_id: 9, name: 'ครบ 300 ลด 10%', type: 'bill_discount', times: 1, amount: 50 },
    ],
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 370,
    payment_status: 'paid',
    payments: [],
  });

  assert.deepEqual(
    model.totals.map((total) => [total.key, total.label, total.amount]),
    [
      ['subtotal', 'ยอดอาหาร', '฿500.00'],
      ['promotion-1', 'ชาเย็น 1 แถม 1 ×2', '−฿80.00'],
      ['promotion-2', 'ครบ 300 ลด 10%', '−฿50.00'],
      ['grand', 'ยอดสุทธิ', '฿370.00'],
    ],
  );
});

test('only the grand total is emphasised, and a discount reads as a deduction', () => {
  const model = buildReceiptModel({
    order: { order_number: 'A005', order_type: 'dine_in' },
    items: [],
    subtotal: 100,
    discount_amount: 10,
    service_charge_enabled: false,
    service_charge_amount: 0,
    vat_enabled: false,
    vat_amount: 0,
    grand_total: 90,
    payment_status: 'paid',
    payments: [],
  });

  const emphasised = model.totals.filter((total) => total.emphasis);
  assert.equal(emphasised.length, 1);
  assert.equal(emphasised[0].key, 'grand');
  assert.equal(emphasised[0].amount, '฿90.00');
  assert.equal(model.totals.find((total) => total.key === 'discount').amount, '−฿10.00');
});
