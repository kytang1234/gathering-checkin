-- 001_init.sql — 聚會簽到系統初始結構
-- 時間欄位一律 UTC ISO8601（毫秒）；聚會日期時間另存當地值＋時區。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')),
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE events (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  event_date            TEXT NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT,
  location              TEXT,
  notes                 TEXT,
  internal_notes        TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','open','closed')),
  timezone              TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
  capacity              INTEGER,
  fee_amount            INTEGER NOT NULL DEFAULT 0,
  fee_note              TEXT,
  contact_name          TEXT,
  contact_phone         TEXT,
  meal_options          TEXT,
  registration_deadline TEXT,
  late_after_minutes    INTEGER NOT NULL DEFAULT 15,
  allow_self_checkin    INTEGER NOT NULL DEFAULT 1,
  allow_self_checkout   INTEGER NOT NULL DEFAULT 0,
  public_token          TEXT NOT NULL UNIQUE,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(event_date DESC);

CREATE TABLE attendees (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  group_name     TEXT,
  notes          TEXT,
  personal_token TEXT NOT NULL UNIQUE,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_attendees_name  ON attendees(name);
CREATE INDEX idx_attendees_phone ON attendees(phone);

CREATE TABLE event_attendees (
  event_id    TEXT NOT NULL REFERENCES events(id)    ON DELETE CASCADE,
  attendee_id TEXT NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','import','walkin')),
  seat_no     TEXT,
  meal_choice TEXT,
  fee_paid    INTEGER NOT NULL DEFAULT 0,
  fee_paid_at TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, attendee_id)
);
CREATE INDEX idx_ea_attendee ON event_attendees(attendee_id);

CREATE TABLE checkins (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id)    ON DELETE CASCADE,
  attendee_id      TEXT NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  checked_in_at    TEXT NOT NULL,
  method           TEXT NOT NULL CHECK (method IN ('qr_self','qr_scan','manual')),
  is_late          INTEGER NOT NULL DEFAULT 0,
  late_minutes     INTEGER,
  checked_out_at   TEXT,
  checkout_method  TEXT CHECK (checkout_method IN ('qr_self','qr_scan','manual')),
  operator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (event_id, attendee_id)
);
CREATE INDEX idx_checkins_event_time ON checkins(event_id, checked_in_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
