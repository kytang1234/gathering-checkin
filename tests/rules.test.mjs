import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSelfCheckIn,
  computeLate,
  formatMoney,
  maskPhone,
  mealOptionsOf,
  normalizePhone,
  parseEventInput,
  parseMealOptions,
  parseMoneyToCents,
  phoneKey,
  registrationClosed,
} from '../src/lib/rules.mjs';

const EVENT = {
  event_date: '2026-11-22',
  start_time: '19:00',
  timezone: 'Asia/Hong_Kong',
  late_after_minutes: 15,
  status: 'open',
  allow_self_checkin: 1,
  allow_self_checkout: 0,
  capacity: null,
};

test('電話正規化與配對鍵', () => {
  assert.equal(normalizePhone('9123 4567'), '91234567');
  assert.equal(normalizePhone('+852 9123-4567'), '85291234567');
  assert.equal(phoneKey('+852 9123 4567'), '91234567');
  assert.equal(phoneKey('91234567'), '91234567');
  assert.equal(phoneKey(''), '');
});

test('電話遮蔽只露頭 4 位', () => {
  assert.equal(maskPhone('91234567'), '9123****');
  assert.equal(maskPhone('12345'), '1234*');
  assert.equal(maskPhone(''), '');
});

test('遲到：寬限 15 分，19:16 才算遲到', () => {
  const onTime = computeLate(EVENT, '2026-11-22T11:15:00.000Z'); // 19:15 香港
  assert.deepEqual(onTime, { isLate: false, lateMinutes: 0 });

  const late = computeLate(EVENT, '2026-11-22T11:16:00.000Z'); // 19:16
  assert.equal(late.isLate, true);
  assert.equal(late.lateMinutes, 16);

  const early = computeLate(EVENT, '2026-11-22T10:40:00.000Z'); // 18:40
  assert.equal(early.isLate, false);
});

test('自助簽到開關與截止時間', () => {
  assert.equal(canSelfCheckIn(EVENT), true);
  assert.equal(canSelfCheckIn({ ...EVENT, status: 'draft' }), false);
  assert.equal(canSelfCheckIn({ ...EVENT, allow_self_checkin: 0 }), false);

  const closed = { ...EVENT, registration_deadline: '2026-11-20T23:59' };
  assert.equal(registrationClosed(closed, Date.parse('2026-11-21T00:00:00Z')), true);
  assert.equal(registrationClosed(closed, Date.parse('2026-11-20T00:00:00Z')), false);
  assert.equal(registrationClosed(EVENT, Date.now()), false);
});

test('金額：字串轉分、顯示', () => {
  assert.equal(parseMoneyToCents('128'), 12800);
  assert.equal(parseMoneyToCents('128.5'), 12850);
  assert.equal(parseMoneyToCents('1,280.00'), 128000);
  assert.equal(parseMoneyToCents(''), 0);
  assert.throws(() => parseMoneyToCents('12.345'));
  assert.throws(() => parseMoneyToCents('abc'));

  assert.equal(formatMoney(12800), 'HK$128');
  assert.equal(formatMoney(12850), 'HK$128.50');
});

test('餐飲選項解析與 JSON 讀回', () => {
  assert.deepEqual(parseMealOptions('葷、素, 葷'), ['葷', '素']);
  assert.deepEqual(mealOptionsOf({ meal_options: '["葷","素"]' }), ['葷', '素']);
  assert.deepEqual(mealOptionsOf({ meal_options: '壞資料' }), []);
  assert.deepEqual(mealOptionsOf(null), []);
});

test('聚會表單驗證與正規化', () => {
  const parsed = parseEventInput({
    name: '  年終聚餐  ',
    event_date: '2026-12-05',
    start_time: '19:00',
    end_time: '22:00',
    fee_amount: '380',
    capacity: '40',
    late_after_minutes: '20',
    meal_options: '葷、素',
    allow_self_checkin: '1',
    timezone: 'Asia/Hong_Kong',
  });
  assert.equal(parsed.name, '年終聚餐');
  assert.equal(parsed.fee_amount, 38000);
  assert.equal(parsed.capacity, 40);
  assert.equal(parsed.late_after_minutes, 20);
  assert.deepEqual(parsed.meal_options, ['葷', '素']);
  assert.equal(parsed.allow_self_checkin, 1);
  assert.equal(parsed.allow_self_checkout, 0);
  assert.equal(parsed.end_time, '22:00');

  assert.throws(() => parseEventInput({ ...{ name: 'x', event_date: '2026-12-05', start_time: '19:00' }, end_time: '18:00' }), /結束時間/);
  assert.throws(() => parseEventInput({ name: '', event_date: '2026-12-05', start_time: '19:00' }), /名稱/);
  assert.throws(() => parseEventInput({ name: 'x', event_date: '2026-13-01', start_time: '19:00' }), /日期/);
});
