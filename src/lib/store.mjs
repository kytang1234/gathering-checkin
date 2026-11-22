// 資料存取：所有 SQL 集中在這裡，路由層只負責流程與畫面。

import { newId, randomToken } from './tokens.mjs';
import { nowIso } from './time.mjs';
import { computeLate, normalizePhone } from './rules.mjs';
import { HttpError } from './http.mjs';

const EVENT_COLUMNS = [
  'name',
  'event_date',
  'start_time',
  'end_time',
  'location',
  'notes',
  'internal_notes',
  'status',
  'timezone',
  'capacity',
  'fee_amount',
  'fee_note',
  'contact_name',
  'contact_phone',
  'meal_options',
  'registration_deadline',
  'late_after_minutes',
  'allow_self_checkin',
  'allow_self_checkout',
];

// ---------------------------------------------------------------- events

export function listEvents(db) {
  return db
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = e.id) AS roster_count,
              (SELECT COUNT(*) FROM checkins c WHERE c.event_id = e.id) AS present_count,
              (SELECT COUNT(*) FROM checkins c WHERE c.event_id = e.id AND c.checked_out_at IS NOT NULL) AS left_count,
              (SELECT COUNT(*) FROM event_attendees ea
                JOIN checkins c ON c.event_id = ea.event_id AND c.attendee_id = ea.attendee_id
               WHERE ea.event_id = e.id AND ea.fee_paid = 1) AS paid_count
         FROM events e
        ORDER BY e.event_date DESC, e.start_time DESC, e.created_at DESC`,
    )
    .all();
}

export function getEvent(db, id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) || null;
}

export function getEventByPublicToken(db, token) {
  return db.prepare('SELECT * FROM events WHERE public_token = ?').get(token) || null;
}

export function createEvent(db, data) {
  const id = newId('evt');
  const token = randomToken(24);
  const at = nowIso();
  db.prepare(
    `INSERT INTO events (id, name, event_date, start_time, end_time, location, notes, internal_notes,
                         status, timezone, capacity, fee_amount, fee_note, contact_name, contact_phone,
                         meal_options, registration_deadline, late_after_minutes,
                         allow_self_checkin, allow_self_checkout, public_token, created_at, updated_at)
     VALUES (@id, @name, @event_date, @start_time, @end_time, @location, @notes, @internal_notes,
             @status, @timezone, @capacity, @fee_amount, @fee_note, @contact_name, @contact_phone,
             @meal_options, @registration_deadline, @late_after_minutes,
             @allow_self_checkin, @allow_self_checkout, @public_token, @created_at, @updated_at)`,
  ).run({
    ...data,
    meal_options: JSON.stringify(data.meal_options || []),
    id,
    public_token: token,
    created_at: at,
    updated_at: at,
  });
  return getEvent(db, id);
}

export function updateEvent(db, id, data) {
  const sets = EVENT_COLUMNS.map((col) => `${col} = @${col}`).join(', ');
  const payload = { ...data, id, updated_at: nowIso() };
  payload.meal_options = JSON.stringify(data.meal_options || []);
  db.prepare(`UPDATE events SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(payload);
  return getEvent(db, id);
}

export function setEventStatus(db, id, status) {
  db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
}

export function regeneratePublicToken(db, id) {
  const token = randomToken(24);
  db.prepare('UPDATE events SET public_token = ?, updated_at = ? WHERE id = ?').run(token, nowIso(), id);
  return token;
}

export function deleteEvent(db, id) {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- attendees

export function createAttendee(db, { name, phone, groupName = null, notes = null }) {
  const id = newId('att');
  const at = nowIso();
  db.prepare(
    `INSERT INTO attendees (id, name, phone, group_name, notes, personal_token, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, name, normalizePhone(phone) || null, groupName, notes, randomToken(24), at, at);
  return getAttendee(db, id);
}

export function getAttendee(db, id) {
  return db.prepare('SELECT * FROM attendees WHERE id = ?').get(id) || null;
}

export function updateAttendee(db, id, { name, phone, groupName, notes }) {
  db.prepare(
    `UPDATE attendees SET name = ?, phone = ?, group_name = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(name, normalizePhone(phone) || null, groupName, notes, nowIso(), id);
}

export function findAttendeesByQuery(db, query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  const digits = normalizePhone(q);
  return db
    .prepare(
      `SELECT * FROM attendees
        WHERE is_active = 1 AND (name LIKE ? OR (phone IS NOT NULL AND phone LIKE ?))
        ORDER BY name COLLATE NOCASE
        LIMIT ?`,
    )
    .all(like, digits ? `%${digits.slice(-8)}%` : like, limit);
}

export function findAttendeeByPersonalToken(db, token) {
  return db.prepare('SELECT * FROM attendees WHERE personal_token = ?').get(String(token || '')) || null;
}

/** 卡片上的 8 碼短碼 → 人員；必須唯一，否則視為失敗。 */
export function findAttendeeByShortCode(db, code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,12}$/.test(clean)) return null;
  const rows = db
    .prepare('SELECT * FROM attendees WHERE upper(substr(personal_token, 1, 8)) = ?')
    .all(clean);
  return rows.length === 1 ? rows[0] : null;
}

// ---------------------------------------------------------------- roster

const ROSTER_SQL = `
  SELECT a.id AS attendee_id, a.name, a.phone, a.group_name, a.personal_token,
         a.notes AS person_notes, a.is_active,
         ea.seat_no, ea.meal_choice, ea.fee_paid, ea.fee_paid_at, ea.note AS roster_note, ea.source,
         ea.created_at AS joined_at,
         c.id AS checkin_id, c.checked_in_at, c.method, c.is_late, c.late_minutes,
         c.checked_out_at, c.checkout_method, c.operator_user_id,
         u.name AS operator_name
    FROM event_attendees ea
    JOIN attendees a ON a.id = ea.attendee_id
    LEFT JOIN checkins c ON c.event_id = ea.event_id AND c.attendee_id = ea.attendee_id
    LEFT JOIN users u ON u.id = c.operator_user_id
   WHERE ea.event_id = ?`;

export function listRoster(db, eventId) {
  return db.prepare(`${ROSTER_SQL} ORDER BY a.name COLLATE NOCASE, a.created_at`).all(eventId);
}

export function getRosterEntry(db, eventId, attendeeId) {
  return db.prepare(`${ROSTER_SQL} AND a.id = ?`).get(eventId, attendeeId) || null;
}

export function searchRoster(roster, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return roster;
  const digits = normalizePhone(q);
  return roster.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true;
    if (row.group_name && row.group_name.toLowerCase().includes(q)) return true;
    if (digits && row.phone && row.phone.includes(digits.slice(-8))) return true;
    return false;
  });
}

export function addAttendeeToEvent(db, { eventId, attendeeId, source = 'manual', seatNo = null, mealChoice = null, note = null }) {
  const result = db
    .prepare(
      `INSERT INTO event_attendees (event_id, attendee_id, source, seat_no, meal_choice, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, attendee_id) DO NOTHING`,
    )
    .run(eventId, attendeeId, source, seatNo, mealChoice, note, nowIso());
  return result.changes > 0;
}

export function removeFromRoster(db, eventId, attendeeId) {
  db.transaction(() => {
    db.prepare('DELETE FROM checkins WHERE event_id = ? AND attendee_id = ?').run(eventId, attendeeId);
    db.prepare('DELETE FROM event_attendees WHERE event_id = ? AND attendee_id = ?').run(eventId, attendeeId);
  })();
}

export function updateRosterMeta(db, eventId, attendeeId, { seatNo, mealChoice, note }) {
  db.prepare(
    'UPDATE event_attendees SET seat_no = ?, meal_choice = ?, note = ? WHERE event_id = ? AND attendee_id = ?',
  ).run(seatNo || null, mealChoice || null, note || null, eventId, attendeeId);
}

export function setFeePaid(db, eventId, attendeeId, paid) {
  db.prepare('UPDATE event_attendees SET fee_paid = ?, fee_paid_at = ? WHERE event_id = ? AND attendee_id = ?').run(
    paid ? 1 : 0,
    paid ? nowIso() : null,
    eventId,
    attendeeId,
  );
}

// ---------------------------------------------------------------- checkins

export function getCheckin(db, eventId, attendeeId) {
  return (
    db
      .prepare('SELECT * FROM checkins WHERE event_id = ? AND attendee_id = ?')
      .get(eventId, attendeeId) || null
  );
}

function insertCheckin(db, { eventId, attendeeId, method, operatorUserId, note, event, at }) {
  const stamp = at || nowIso();
  const { isLate, lateMinutes } = computeLate(event, stamp);
  db.prepare(
    `INSERT INTO checkins (id, event_id, attendee_id, checked_in_at, method, is_late, late_minutes,
                           operator_user_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('chk'),
    eventId,
    attendeeId,
    stamp,
    method,
    isLate ? 1 : 0,
    lateMinutes,
    operatorUserId || null,
    note || null,
    stamp,
  );
  return getCheckin(db, eventId, attendeeId);
}

/**
 * 簽到。已簽到時不新增第二筆，回傳既有記錄（idempotent）。
 * `at` 只供種子資料與測試指定時間，一般流程一律用伺服器現在時間。
 * @returns {{ created: boolean, checkin: object }}
 */
export function checkIn(db, { event, attendeeId, method, operatorUserId = null, note = null, at = null }) {
  const existing = getCheckin(db, event.id, attendeeId);
  if (existing) return { created: false, checkin: existing };
  try {
    return {
      created: true,
      checkin: insertCheckin(db, { eventId: event.id, attendeeId, method, operatorUserId, note, event, at }),
    };
  } catch (error) {
    if (String(error.code || '').includes('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/.test(String(error.message))) {
      const race = getCheckin(db, event.id, attendeeId);
      if (race) return { created: false, checkin: race };
    }
    throw error;
  }
}

export function checkOut(db, { eventId, attendeeId, method, operatorUserId = null, at = null }) {
  const result = db
    .prepare(
      `UPDATE checkins
          SET checked_out_at = ?, checkout_method = ?, operator_user_id = COALESCE(?, operator_user_id)
        WHERE event_id = ? AND attendee_id = ? AND checked_out_at IS NULL`,
    )
    .run(at || nowIso(), method, operatorUserId, eventId, attendeeId);
  return result.changes > 0;
}

export function undoCheckout(db, eventId, attendeeId) {
  db.prepare(
    'UPDATE checkins SET checked_out_at = NULL, checkout_method = NULL WHERE event_id = ? AND attendee_id = ?',
  ).run(eventId, attendeeId);
}

export function undoCheckin(db, eventId, attendeeId) {
  db.prepare('DELETE FROM checkins WHERE event_id = ? AND attendee_id = ?').run(eventId, attendeeId);
}

export function recentCheckins(db, eventId, limit = 10) {
  return db
    .prepare(
      `SELECT c.*, a.name, u.name AS operator_name
         FROM checkins c
         JOIN attendees a ON a.id = c.attendee_id
         LEFT JOIN users u ON u.id = c.operator_user_id
        WHERE c.event_id = ?
        ORDER BY c.checked_in_at DESC
        LIMIT ?`,
    )
    .all(eventId, limit);
}

/** 自助簽到：在一個交易內建立 walk-in 人員、加入名單、寫入簽到。 */
export function checkInWalkIn(db, { event, name, phone, groupName = null, seatNo = null, mealChoice = null, method, operatorUserId = null }) {
  return db.transaction(() => {
    const attendee = createAttendee(db, { name, phone, groupName });
    addAttendeeToEvent(db, {
      eventId: event.id,
      attendeeId: attendee.id,
      source: 'walkin',
      seatNo,
      mealChoice,
    });
    const { checkin } = checkIn(db, { event, attendeeId: attendee.id, method, operatorUserId });
    return { attendee, checkin };
  })();
}

/** 已存在的人（可能來自其他聚會）加入本場並簽到。 */
export function checkInExisting(db, { event, attendeeId, method, operatorUserId = null, mealChoice = null, seatNo = null }) {
  return db.transaction(() => {
    addAttendeeToEvent(db, { eventId: event.id, attendeeId, source: 'walkin', mealChoice, seatNo });
    return checkIn(db, { event, attendeeId, method, operatorUserId });
  })();
}

/** 用電話（後 8 位）找既有的人；香港號碼 +852 前綴也能對上。 */
export function findAttendeeByPhone(db, phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 4) return null;
  const key = digits.slice(-8);
  const rows = db.prepare('SELECT * FROM attendees WHERE phone IS NOT NULL').all();
  return rows.find((row) => normalizePhone(row.phone).slice(-8) === key) || null;
}

export function countRoster(db, eventId) {
  return db.prepare('SELECT COUNT(*) AS n FROM event_attendees WHERE event_id = ?').get(eventId).n;
}

export function assertEventOpen(event) {
  if (!event) throw new HttpError(404, '找不到這個聚會');
  if (event.status !== 'open') {
    throw new HttpError(409, event.status === 'closed' ? '聚會已結束，不能再簽到' : '聚會未開放簽到');
  }
}
