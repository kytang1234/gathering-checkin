import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, stayMinutes, csvRows } from '../src/lib/reports.mjs';
import { formatDateTime } from '../src/lib/time.mjs';

const EVENT = { fee_amount: 38000, timezone: 'Asia/Hong_Kong', name: '年終聚餐', event_date: '2026-11-22', start_time: '19:00' };

function row(overrides = {}) {
  return {
    attendee_id: 'att_1',
    name: '陳大文',
    phone: '91234567',
    group_name: 'A 組',
    seat_no: '1 號桌',
    meal_choice: '葷',
    fee_paid: 0,
    checked_in_at: null,
    method: null,
    is_late: 0,
    late_minutes: 0,
    checked_out_at: null,
    ...overrides,
  };
}

test('停留時間', () => {
  assert.equal(stayMinutes(row({ checked_in_at: '2026-11-22T11:00:00.000Z', checked_out_at: '2026-11-22T13:30:00.000Z' })), 150);
  assert.equal(stayMinutes(row({ checked_in_at: '2026-11-22T11:00:00.000Z' })), null);
});

test('統計數字：出席率、遲到、停留、費用', () => {
  const roster = [
    row({ attendee_id: 'a', name: '陳大文', phone: '91111111', checked_in_at: '2026-11-22T11:00:00.000Z', method: 'qr_scan', checked_out_at: '2026-11-22T13:00:00.000Z', fee_paid: 1 }),
    row({ attendee_id: 'b', name: '李小明', phone: '92222222', checked_in_at: '2026-11-22T11:40:00.000Z', method: 'manual', is_late: 1, late_minutes: 40 }),
    row({ attendee_id: 'c', name: '王美玲', phone: '93333333', checked_in_at: '2026-11-22T11:10:00.000Z', method: 'qr_self', checked_out_at: '2026-11-22T12:40:00.000Z', fee_paid: 1, meal_choice: '素' }),
    row({ attendee_id: 'd', name: '張家輝', phone: '94444444' }),
  ];

  const summary = summarize(EVENT, roster);
  assert.equal(summary.total, 4);
  assert.equal(summary.presentCount, 3);
  assert.equal(summary.absentCount, 1);
  assert.equal(summary.rate, 75);
  assert.equal(summary.lateCount, 1);
  assert.equal(summary.onTimeCount, 2);
  assert.equal(summary.leftCount, 2);
  assert.equal(summary.notLeftCount, 1);
  assert.equal(summary.avgStay, 105); // (120 + 90) / 2
  assert.equal(summary.avgStayText, '1 小時 45 分');
  assert.equal(summary.expectedFee, 38000 * 3);
  assert.equal(summary.collectedFee, 38000 * 2);
  assert.equal(summary.unpaidCount, 1);
  assert.deepEqual(summary.meals, [
    ['葷', 2],
    ['素', 1],
  ]);
});

test('空名單不會除以零', () => {
  const summary = summarize(EVENT, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.rate, 0);
  assert.equal(summary.avgStay, null);
  assert.equal(summary.avgStayText, '—');
  assert.equal(summary.expectedFee, 0);
});

test('CSV 列：出席在前、未出席在後，時間按聚會時區', () => {
  const roster = [
    row({ attendee_id: 'a', name: '陳大文', checked_in_at: '2026-11-22T11:00:00.000Z', method: 'qr_scan', checked_out_at: '2026-11-22T13:00:00.000Z', fee_paid: 1 }),
    row({ attendee_id: 'd', name: '張家輝' }),
  ];
  const summary = summarize(EVENT, roster);
  const rows = csvRows(EVENT, summary, (iso) => formatDateTime(iso, EVENT.timezone));

  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], '姓名');
  assert.equal(rows[1][0], '陳大文');
  assert.equal(rows[1][5], '2026-11-22 19:00');
  assert.equal(rows[1][9], 120);
  assert.equal(rows[2][0], '張家輝');
  assert.equal(rows[2][10], '未出席');
});
