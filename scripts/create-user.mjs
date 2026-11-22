import { openDb, resolveDbPath } from '../src/lib/db.mjs';
import { hashPassword } from '../src/lib/auth.mjs';
import { newId, randomToken } from '../src/lib/tokens.mjs';

const args = process.argv.slice(2);
const db = openDb(resolveDbPath());

function usage() {
  console.log(`用法：
  npm run user                          列出所有帳號
  npm run user -- add <名稱> [admin|staff] [密碼]
  npm run user -- reset <名稱> [新密碼]`);
}

function list() {
  const rows = db.prepare('SELECT name, role, is_active, created_at FROM users ORDER BY role, name').all();
  if (rows.length === 0) {
    console.log('（還沒有任何帳號，先跑 npm run seed 建立管理員）');
    return;
  }
  for (const row of rows) {
    console.log(`${row.is_active ? '✓' : '×'} ${row.name.padEnd(12)} ${row.role.padEnd(6)} ${row.created_at.slice(0, 10)}`);
  }
}

const [command, name, roleOrPassword, maybePassword] = args;

if (!command || command === 'list') {
  list();
} else if (command === 'add') {
  if (!name) {
    usage();
    process.exit(1);
  }
  const role = roleOrPassword === 'admin' || roleOrPassword === 'staff' ? roleOrPassword : 'staff';
  const password = maybePassword || (roleOrPassword && role !== roleOrPassword ? roleOrPassword : '') || randomToken(9);
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) {
    console.error(`帳號「${name}」已存在，請用 reset 重設密碼`);
    process.exit(1);
  }
  db.prepare('INSERT INTO users (id, name, role, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    newId('usr'),
    name,
    role,
    hashPassword(password),
    new Date().toISOString(),
  );
  console.log(`✓ 已建立 ${role}「${name}」`);
  console.log(`  密碼：${password}`);
} else if (command === 'reset') {
  if (!name) {
    usage();
    process.exit(1);
  }
  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user) {
    console.error(`找不到帳號「${name}」`);
    process.exit(1);
  }
  const password = roleOrPassword || randomToken(9);
  db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`✓ 已重設「${name}」的密碼`);

  // 重設後必須把新密碼印出來，所以即使用 CLI 傳入也提醒一次。
  console.log(`  新密碼：${password}`);
} else {
  usage();
  process.exit(1);
}

db.close();
