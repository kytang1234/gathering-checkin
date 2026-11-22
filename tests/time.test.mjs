import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffMinutes,
  formatDate,
  formatDateTime,
  humanDuration,
  isValidDateString,
  isValidTimeString,
  parseLocalDateTime,
  weekdayLabel,
  zonedToUtc,
} from '../src/lib/time.mjs';

test('zonedToUtc：香港時間 19:00 等於 UTC 11:00', () => {
  const date = zonedToUtc('2026-11-22', '19:00', 'Asia/Hong_Kong');
  assert.equal(date.toISOString(), '2026-11-22T11:00:00.000Z');
});

test('zonedToUtc：日光節約切換前後偏移不同（America/New_York）', () => {
  // 2026-03-08 凌晨美國進入夏令時間
  const before = zonedToUtc('2026-03-07', '12:00', 'America/New_York');
  const after = zonedToUtc('2026-03-09', '12:00', 'America/New_York');
  assert.equal(before.toISOString(), '2026-03-07T17:00:00.000Z');
  assert.equal(after.toISOString(), '2026-03-09T16:00:00.000Z');
});

test('顯示：UTC 轉回聚會時區，跨日要換日期', () => {
  assert.equal(formatDateTime('2026-11-22T11:00:00.000Z', 'Asia/Hong_Kong'), '2026-11-22 19:00');
  assert.equal(formatDate('2026-11-22T16:30:00.000Z', 'Asia/Hong_Kong'), '2026-11-23');
  assert.equal(formatDateTime('2026-11-22T16:30:00.000Z', 'Asia/Hong_Kong'), '2026-11-23 00:30');
});

test('humanDuration 的組合', () => {
  assert.equal(humanDuration(0), '0 分');
  assert.equal(humanDuration(45), '45 分');
  assert.equal(humanDuration(120), '2 小時');
  assert.equal(humanDuration(135), '2 小時 15 分');
});

test('星期與日期驗證', () => {
  assert.equal(weekdayLabel('2026-11-22'), '星期日');
  assert.equal(weekdayLabel('2026-02-30'), '');
  assert.equal(isValidDateString('2026-02-28'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidTimeString('19:00'), true);
  assert.equal(isValidTimeString('24:01'), false);
});

test('parseLocalDateTime 解讀 datetime-local 字串', () => {
  const parsed = parseLocalDateTime('2026-11-22T18:30', 'Asia/Hong_Kong');
  assert.equal(parsed.toISOString(), '2026-11-22T10:30:00.000Z');
  assert.equal(parseLocalDateTime('乱碼', 'Asia/Hong_Kong'), null);
});

test('diffMinutes 四捨五入到整分', () => {
  assert.equal(diffMinutes('2026-11-22T11:00:00.000Z', '2026-11-22T11:16:20.000Z'), 16);
  assert.equal(diffMinutes('2026-11-22T11:00:00.000Z', '2026-11-22T11:16:40.000Z'), 17);
});
