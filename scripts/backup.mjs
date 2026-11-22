import fs from 'node:fs';
import path from 'node:path';
import { openDb, resolveDbPath } from '../src/lib/db.mjs';

const dbFile = resolveDbPath();
if (!fs.existsSync(dbFile)) {
  console.error(`找不到資料庫：${dbFile}`);
  process.exit(1);
}

const backupDir = path.join(path.dirname(dbFile), 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' })
  .replace(/[- :]/g, '')
  .replace(/^(\d{8})(\d{6})$/, '$1-$2');
const target = path.join(backupDir, `attendance-${stamp}.db`);

const db = openDb(dbFile);
// VACUUM INTO 會產生一致性的快照，能安全包含尚未 checkpoint 的 WAL 內容。
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const size = (fs.statSync(target).size / 1024).toFixed(0);
console.log(`✓ 備份完成：${target}（${size} KB）`);

// 只保留最近 14 份
const files = fs
  .readdirSync(backupDir)
  .filter((name) => name.startsWith('attendance-') && name.endsWith('.db'))
  .sort()
  .reverse();
for (const old of files.slice(14)) {
  fs.unlinkSync(path.join(backupDir, old));
  console.log(`  已清除舊備份 ${old}`);
}
