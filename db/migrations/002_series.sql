-- 002_series.sql — 系列聚會與跨場統計
-- 系列只是一組聚會的標籤；統計即時計算，不另建統計表。

CREATE TABLE IF NOT EXISTS series (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE events ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
