import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAttendeeToEvent,
  checkIn,
  checkOut,
  countRoster,
  findAttendeeByPhone,
  findAttendeeByShortCode,
  getCheckin,
  getRosterEntry,
  listRoster,
  removeFromRoster,
  undoCheckout,
} from '../src/lib/store.mjs';
import { memoryDb, makeEvent, makeAttendee, makeRoster } from './helpers.mjs';

test('簽到是 idempotent：第二次回傳同一筆，不會多一列', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const attendee = makeRoster(db, event, makeAttendee(db));

  const first = checkIn(db, { event, attendeeId: attendee.id, method: 'manual', at: '2026-11-22T11:05:00.000Z' });
  assert.equal(first.created, true);

  const second = checkIn(db, { event, attendeeId: attendee.id, method: 'qr_scan' });
  assert.equal(second.created, false);
  assert.equal(second.checkin.id, first.checkin.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 1);
});

test('簽到時算好遲到分鐘', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const attendee = makeRoster(db, event, makeAttendee(db));
  const { checkin } = checkIn(db, {
    event,
    attendeeId: attendee.id,
    method: 'qr_scan',
    at: '2026-11-22T11:42:00.000Z', // 19:42 香港，聚會 19:00 開始
  });
  assert.equal(checkin.is_late, 1);
  assert.equal(checkin.late_minutes, 42);
});

test('簽退只能成功一次，撤銷後可再簽退', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const attendee = makeRoster(db, event, makeAttendee(db));
  checkIn(db, { event, attendeeId: attendee.id, method: 'manual', at: '2026-11-22T11:00:00.000Z' });

  assert.equal(checkOut(db, { eventId: event.id, attendeeId: attendee.id, method: 'manual', at: '2026-11-22T13:00:00.000Z' }), true);
  assert.equal(checkOut(db, { eventId: event.id, attendeeId: attendee.id, method: 'manual' }), false);

  undoCheckout(db, event.id, attendee.id);
  assert.equal(getCheckin(db, event.id, attendee.id).checked_out_at, null);

  assert.equal(checkOut(db, { eventId: event.id, attendeeId: attendee.id, method: 'manual' }), true);
});

test('名單重複加入不會爆，移除時連簽到一齊清', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const attendee = makeAttendee(db);

  assert.equal(addAttendeeToEvent(db, { eventId: event.id, attendeeId: attendee.id }), true);
  assert.equal(addAttendeeToEvent(db, { eventId: event.id, attendeeId: attendee.id }), false);
  assert.equal(countRoster(db, event.id), 1);

  checkIn(db, { event, attendeeId: attendee.id, method: 'manual' });
  removeFromRoster(db, event.id, attendee.id);
  assert.equal(countRoster(db, event.id), 0);
  assert.equal(getCheckin(db, event.id, attendee.id), null);
});

test('資料庫層的 UNIQUE 是最後防線', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const attendee = makeRoster(db, event, makeAttendee(db));
  checkIn(db, { event, attendeeId: attendee.id, method: 'manual' });

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO checkins (id, event_id, attendee_id, checked_in_at, method, created_at)
           VALUES ('chk_dup', ?, ?, ?, 'manual', ?)`,
        )
        .run(event.id, attendee.id, '2026-11-22T11:00:00.000Z', '2026-11-22T11:00:00.000Z'),
    /UNIQUE/i,
  );
});

test('用電話找既有的人（+852 也對得上）', () => {
  const db = memoryDb();
  const attendee = makeAttendee(db, { name: '陳大文', phone: '9123 4567' });
  assert.equal(findAttendeeByPhone(db, '+852 91234567').id, attendee.id);
  assert.equal(findAttendeeByPhone(db, '91234567').id, attendee.id);
  assert.equal(findAttendeeByPhone(db, '99999999'), null);
  assert.equal(findAttendeeByPhone(db, ''), null);
});

test('8 碼短碼唯一才可解析', () => {
  const db = memoryDb();
  const first = makeAttendee(db, { name: '陳大文' });
  const second = makeAttendee(db, { name: '李小明' });
  db.prepare('UPDATE attendees SET personal_token = ? WHERE id = ?').run('ABCD1234aaaaaaaa', first.id);
  db.prepare('UPDATE attendees SET personal_token = ? WHERE id = ?').run('WXYZ9876bbbbbbbb', second.id);

  assert.equal(findAttendeeByShortCode(db, 'abcd1234').id, first.id);
  assert.equal(findAttendeeByShortCode(db, 'ABCD1234').id, first.id);
  assert.equal(findAttendeeByShortCode(db, 'ZZZZ9999'), null);
});

test('名單查詢帶出簽到狀態', () => {
  const db = memoryDb();
  const event = makeEvent(db);
  const present = makeRoster(db, event, makeAttendee(db, { name: '陳大文', phone: '91111111' }));
  const absent = makeRoster(db, event, makeAttendee(db, { name: '李小明', phone: '92222222' }));
  checkIn(db, { event, attendeeId: present.id, method: 'qr_scan', at: '2026-11-22T11:05:00.000Z' });

  const roster = listRoster(db, event.id);
  assert.equal(roster.length, 2);
  const presentRow = roster.find((r) => r.attendee_id === present.id);
  const absentRow = roster.find((r) => r.attendee_id === absent.id);
  assert.ok(presentRow.checked_in_at);
  assert.equal(presentRow.method, 'qr_scan');
  assert.equal(absentRow.checked_in_at, null);

  const entry = getRosterEntry(db, event.id, present.id);
  assert.equal(entry.name, '陳大文');
});
