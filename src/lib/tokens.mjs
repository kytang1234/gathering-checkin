import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe 隨機字串，預設 24 bytes（32 個字元）。 */
export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

/** 帶前綴的識別碼，例如 evt_xxx / att_xxx / chk_xxx。 */
export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** 常數時間比較，避免用長度或內容差異推算 secret。 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 個人 QR 卡上印的短碼：token 前 8 碼，大寫。 */
export function shortCode(token) {
  return String(token).slice(0, 8).toUpperCase();
}
