// 時間處理：聚會時間以「當地日期＋當地時間＋時區」儲存；
// 簽到等事件時刻以 UTC ISO 字串儲存。此檔負責兩者換算與顯示。

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** 把 UTC 毫秒轉成指定時區的日期時間零件。 */
export function zoneParts(ms, timeZone) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

/** 該時刻在該時區的 UTC 偏移（毫秒）。 */
export function zoneOffsetMs(ms, timeZone) {
  const p = zoneParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * 把「當地日期 YYYY-MM-DD ＋ 當地時間 HH:MM」解讀成 UTC 時刻。
 * 兩次校正可處理日光節約切換前後的偏移變化。
 */
export function zonedToUtc(dateStr, timeStr, timeZone = 'Asia/Hong_Kong') {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ms = guess - zoneOffsetMs(guess, timeZone);
  ms = guess - zoneOffsetMs(ms, timeZone);
  return new Date(ms);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(ms, timeZone) {
  const p = zoneParts(toMs(ms), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatClock(ms, timeZone) {
  const p = zoneParts(toMs(ms), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTime(ms, timeZone) {
  const p = zoneParts(toMs(ms), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTimeSeconds(ms, timeZone) {
  const p = zoneParts(toMs(ms), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** 兩個時刻相差幾分鐘（四捨五入到整分）。 */
export function diffMinutes(fromMs, toMsValue) {
  return Math.round((toMs(toMsValue) - toMs(fromMs)) / 60000);
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function weekdayLabel(dateStr) {
  if (!isValidDateString(dateStr)) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 例：135 分鐘 → 「2 小時 15 分」 */
export function humanDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} 分`;
  if (m === 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分`;
}

/** 「YYYY-MM-DDTHH:MM」→ 該時區的 UTC 時刻；格式不對回 null。 */
export function parseLocalDateTime(value, timeZone) {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  return zonedToUtc(m[1], m[2], timeZone);
}

/** 今天的當地日期字串。 */
export function todayInZone(timeZone) {
  return formatDate(Date.now(), timeZone);
}

export function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTimeString(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value))) return false;
  const [h, m] = String(value).split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
