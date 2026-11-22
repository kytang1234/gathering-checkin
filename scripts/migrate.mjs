import fs from 'node:fs';
import path from 'node:path';
import { openDb, resolveDbPath } from '../src/lib/db.mjs';

const dbFile = resolveDbPath();
const db = openDb(dbFile);
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

const dir = path.join(import.meta.dirname, '..', 'db', 'migrations');
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
let count = 0;

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  })();
  console.log(`✓ 套用 ${file}`);
  count += 1;
}

console.log(count === 0 ? `資料庫已是最新：${dbFile}` : `完成，套用 ${count} 個 migration：${dbFile}`);
db.close();
