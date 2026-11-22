import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { randomToken, sha256, safeEqual } from './tokens.mjs';
import { HttpError, Redirect } from './http.mjs';
import { nowIso } from './time.mjs';

export const SESSION_COOKIE = 'gcs';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(String(password), salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 產生人類可讀、避免易混淆字元的密碼（沒有 O/0、I/l/1）。 */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 12) {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return out;
}

export function createSession(db, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sha256(token), userId, csrf, createdAt, expiresAt);
  return { token, csrf, expiresAt };
}

export function readSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf, s.expires_at,
              u.id AS user_id, u.name, u.role, u.is_active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  if (!row.is_active) return null;
  // 滑動續期：每次使用延長 12 小時。
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    row.session_id,
  );
  return {
    sessionId: row.session_id,
    csrf: row.csrf,
    user: { id: row.user_id, name: row.name, role: row.role },
  };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function requireUser(ctx) {
  if (!ctx.user) {
    const next = ctx.url.pathname + (ctx.url.search || '');
    throw new Redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return ctx.user;
}

export function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw new HttpError(403, '需要管理員權限');
  return user;
}

/** 所有已登入的 POST 都必須帶上 session 的 CSRF token。 */
export function requireCsrf(ctx) {
  const sent = ctx.fields?._csrf || ctx.json?._csrf;
  if (!ctx.session || !safeEqual(String(sent || ''), ctx.session.csrf)) {
    throw new HttpError(403, '表單已過期，請重新載入頁面');
  }
}

export function findUserByName(db, name) {
  return db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(String(name || '').trim());
}

export function authenticate(db, name, password) {
  const user = findUserByName(db, name);
  if (!user || !user.is_active) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}
