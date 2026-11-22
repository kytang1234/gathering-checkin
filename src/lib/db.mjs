import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** 資料庫檔案位置：DB_FILE 優先，其次 DATA_DIR/attendance.db。 */
export function resolveDbPath() {
  return process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'attendance.db');
}

/** 開啟（必要時建立）資料庫，並套用本專案依賴的 PRAGMA。 */
export function openDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

let cached = null;

/** 伺服器共用的單一連線。 */
export function getDb() {
  if (!cached) cached = openDb(resolveDbPath());
  return cached;
}

export function closeDb() {
  if (cached) {
    cached.close();
    cached = null;
  }
}
