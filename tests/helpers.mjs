import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createEvent, createAttendee, addAttendeeToEvent } from '../src/lib/store.mjs';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'db', 'migrations');

function schemaSql() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

/** 記憶體資料庫，套用全部 migration（去掉 WAL，記憶體庫不需要）。 */
export function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql().replace(/PRAGMA journal_mode = WAL;/gi, ''));
  return db;
}

export function makeEvent(db, overrides = {}) {
  return createEvent(db, {
    name: '測試聚會',
    event_date: '2026-11-22',
    start_time: '19:00',
    end_time: '22:00',
    location: '測試地點',
    notes: null,
    internal_notes: null,
    status: 'open',
    timezone: 'Asia/Hong_Kong',
    capacity: null,
    fee_amount: 0,
    fee_note: null,
    contact_name: null,
    contact_phone: null,
    meal_options: [],
    registration_deadline: null,
    late_after_minutes: 15,
    allow_self_checkin: 1,
    allow_self_checkout: 0,
    ...overrides,
  });
}

export function makeAttendee(db, overrides = {}) {
  return createAttendee(db, {
    name: '陳大文',
    phone: '91234567',
    groupName: 'A 組',
    ...overrides,
  });
}

export function makeRoster(db, event, attendee, overrides = {}) {
  addAttendeeToEvent(db, { eventId: event.id, attendeeId: attendee.id, ...overrides });
  return attendee;
}
