import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeriesStats, seriesMatrixCsv, seriesMembersCsv, pickBaseEvents } from '../src/lib/series.mjs';
import { memoryDb, makeEvent, makeAttendee } from './helpers.mjs';
import { createSeries, deleteSeries, getSeries, listSeries, createEvent } from '../src/lib/store.mjs';

const EVENTS = [
  { id: 'e1', name: '第一場', event_date: '2026-01-04', start_time: '19:00', status: 'closed', fee_amount: 38000 },
  { id: 'e2', name: '第二場', event_date: '2026-01-11', start_time: '19:00', status: 'closed', fee_amount: 38000 },
  { id: 'e3', name: '第三場', event_date: '2026-01-18', start_time: '19:00', status: 'open', fee_amount: 38000 },
];

function row(id, name, overrides = {}) {
  return {
    attendee_id: id,
    name,
    group_name: 'A 組',
    phone: '91234567',
    checked_in_at: null,
    is_late: 0,
    late_minutes: 0,
    checked_out_at: null,
    fee_paid: false,
    ...overrides,
  };
}

const ROSTER = new Map([
  ['e1', [
    row('a', '陳大文', { checked_in_at: '2026-01-04T11:00:00.000Z' }),
    row('b', '李小明', { checked_in_at: '2026-01-04T11:25:00.000Z', is_late: 1, late_minutes: 25 }),
    row('c', '王美玲'),
  ]],
  ['e2', [
    row('a', '陳大文', { checked_in_at: '2026-01-11T11:00:00.000Z' }),
    row('b', '李小明'),
    row('c', '王美玲', { checked_in_at: '2026-01-11T11:15:00.000Z', is_late: 1, late_minutes: 15 }),
  ]],
  ['e3', [row('a', '陳大文')]],
]);

const TODAY = '2026-01-15';

const stats = buildSeriesStats({
  series: { id: 's1', name: '測試系列' },
  events: EVENTS,
  rosterByEvent: ROSTER,
  today: TODAY,
});

test('分母：只計已結束，未舉行的場次不計', () => {
  assert.equal(stats.baseEvents.length, 2);
  assert.equal(stats.totals.eventCount, 3);
  assert.equal(stats.totals.baseCount, 2);
});

test('個人出席率與連續出席', () => {
  const a = stats.members.find((m) => m.attendee_id === 'a');
  const b = stats.members.find((m) => m.attendee_id === 'b');
  const c = stats.members.find((m) => m.attendee_id === 'c');

  assert.equal(a.attended, 2);
  assert.equal(a.seriesRate, 100);
  assert.equal(a.streak, 2);
  assert.equal(a.onTime, 2);

  assert.equal(b.attended, 1);
  assert.equal(b.seriesRate, 50);
  assert.equal(b.streak, 0, '最近一場缺席，連續應為 0');
  assert.equal(b.late, 1);
  assert.equal(b.registeredRate, 50);

  assert.equal(c.attended, 1);
  assert.equal(c.seriesRate, 50);
  assert.equal(c.streak, 1);
  assert.equal(c.absent.length, 1);
});

test('集體統計', () => {
  assert.equal(stats.totals.attendedSeats, 4);
  assert.equal(stats.totals.memberCount, 3);
  assert.equal(stats.totals.overallRate, 66.7);
  assert.equal(stats.totals.avgEventRate, 66.7);
  assert.equal(stats.totals.avgPerEvent, 2);
  assert.equal(stats.totals.newMembers, 1, '王美玲首場之後才出現');
  assert.equal(stats.totals.activeMembers, 3);
});

test('矩陣格值：準時／遲到／缺席／未報名', () => {
  const a = stats.members.find((m) => m.attendee_id === 'a');
  const b = stats.members.find((m) => m.attendee_id === 'b');
  const c = stats.members.find((m) => m.attendee_id === 'c');

  assert.deepEqual(a.cells, ['present', 'present']);
  assert.deepEqual(b.cells, ['late', 'absent']);
  assert.deepEqual(c.cells, ['absent', 'late']);
});

test('includeOpen 會把已過期的 open 場次計入（但未來場次仍不計）', () => {
  const withOpen = buildSeriesStats({
    series: { id: 's1', name: '測試系列' },
    events: EVENTS,
    rosterByEvent: ROSTER,
    includeOpen: true,
    today: '2026-02-01',
  });
  assert.equal(withOpen.baseEvents.length, 3);
  const a = withOpen.members.find((m) => m.attendee_id === 'a');
  assert.equal(a.attended, 2);
  assert.equal(a.seriesRate, 66.7);

  const beforeStart = buildSeriesStats({
    series: { id: 's1', name: '測試系列' },
    events: EVENTS,
    rosterByEvent: ROSTER,
    includeOpen: true,
    today: '2026-01-01',
  });
  assert.equal(beforeStart.baseEvents.length, 0, '全部未舉行');
  assert.equal(beforeStart.members.length, 3, '成員仍可從名單得知');
  assert.equal(beforeStart.totals.overallRate, null);
  const first = beforeStart.members[0];
  assert.equal(first.seriesRate, null);
});

test('pickBaseEvents 排序與狀態', () => {
  const picked = pickBaseEvents([...EVENTS].reverse(), { today: TODAY });
  assert.deepEqual(picked.map((e) => e.id), ['e1', 'e2']);
});

test('CSV：矩陣欄數與格值', () => {
  const rows = seriesMatrixCsv(stats);
  assert.equal(rows[0].length, 2 + stats.baseEvents.length + 2);
  assert.equal(rows.length, 4);
  const aRow = rows.find((r) => r[0] === '陳大文');
  assert.deepEqual(aRow.slice(2, 4), ['準時', '準時']);
  assert.ok(!rows.some((r) => r.join(',').includes('undefined')));
});

test('CSV：成員統計有百分比與缺席日期', () => {
  const rows = seriesMembersCsv(stats);
  const header = rows[0];
  assert.ok(header.includes('系列出席率'));
  const bRow = rows.find((r) => r[0] === '李小明');
  assert.equal(bRow[header.indexOf('系列出席率')], '50%');
  assert.equal(bRow[header.indexOf('連續出席')], 0);
});

test('系列 CRUD：刪系列可保留或連帶刪聚會', () => {
  const db = memoryDb();
  const series = createSeries(db, { name: '2026 春季' });
  assert.ok(series.id);
  assert.equal(listSeries(db).length, 1);

  const event = makeEvent(db, { series_id: series.id, status: 'closed' });
  const list = listSeries(db);
  assert.equal(list[0].event_count, 1);

  deleteSeries(db, series.id, { deleteEvents: false });
  assert.equal(getSeries(db, series.id), null);
  assert.ok(db.prepare('SELECT id FROM events WHERE id = ?').get(event.id), '聚會應保留');

  const second = createSeries(db, { name: '第二個系列' });
  const event2 = makeEvent(db, { name: '會刪的聚會', series_id: second.id });
  deleteSeries(db, second.id, { deleteEvents: true });
  assert.equal(db.prepare('SELECT id FROM events WHERE id = ?').get(event2.id), undefined, '聚會應被刪除');
});

test('名單加入後，系列成員數會反映', () => {
  const db = memoryDb();
  const series = createSeries(db, { name: '統計系列' });
  const event = makeEvent(db, { series_id: series.id, status: 'closed' });
  const person = makeAttendee(db, { name: '新朋友' });
  db.prepare('INSERT INTO event_attendees (event_id, attendee_id, source, created_at) VALUES (?, ?, ?, ?)').run(
    event.id,
    person.id,
    'manual',
    new Date().toISOString(),
  );
  assert.equal(listSeries(db)[0].member_count, 1);
});
