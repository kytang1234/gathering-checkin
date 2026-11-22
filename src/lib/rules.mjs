// 商業規則：電話正規化、配對、遲到判定、輸入驗證。

import { HttpError } from './http.mjs';
import { zonedToUtc, diffMinutes, isValidDateString, isValidTimeString, parseLocalDateTime } from './time.mjs';

export const STATUS_LABELS = {
  draft: '草稿',
  open: '開放簽到',
  closed: '已結束',
};

export const METHOD_LABELS = {
  qr_self: '自助 QR',
  qr_scan: '掃描 QR',
  manual: '人手',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function methodLabel(method) {
  return METHOD_LABELS[method] || method || '—';
}

/** 去掉所有非數字字元。 */
export function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D+/g, '');
}

/** 配對用的電話鍵：香港號碼只比後 8 位，其餘保留全部數字。 */
export function phoneKey(phone) {
  const digits = normalizePhone(phone);
  if (digits.length >= 8) return digits.slice(-8);
  return digits;
}

/** 顯示用：91234567 → 9123**** */
export function maskPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 5) return digits ? `${digits.slice(0, 1)}***` : '';
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(0, digits.length - 4))}`;
}

/** 簽到時刻相對聚會開始的遲到判定。 */
export function computeLate(event, checkedInIso) {
  if (!event) return { isLate: false, lateMinutes: 0 };
  const startMs = zonedToUtc(event.event_date, event.start_time, event.timezone || 'Asia/Hong_Kong').getTime();
  const minutes = diffMinutes(startMs, checkedInIso);
  const grace = Number(event.late_after_minutes ?? 15);
  if (minutes > grace) {
    return { isLate: true, lateMinutes: Math.max(0, minutes) };
  }
  return { isLate: false, lateMinutes: 0 };
}

export function canSelfCheckIn(event) {
  return Boolean(event) && event.status === 'open' && Number(event.allow_self_checkin) === 1;
}

export function canSelfCheckOut(event) {
  return Boolean(event) && event.status === 'open' && Number(event.allow_self_checkout) === 1;
}

/** 截止時間是否已過（以聚會時區解讀）。 */
export function registrationClosed(event, nowMs = Date.now()) {
  if (!event?.registration_deadline) return false;
  const deadline = parseLocalDateTime(String(event.registration_deadline).replace(' ', 'T'), event.timezone);
  if (!deadline) return false;
  return nowMs > deadline.getTime();
}

export function formatMoney(cents, { withSymbol = true, decimals = null } = {}) {
  const value = Number(cents || 0) / 100;
  const fixed = decimals === null ? (Number.isInteger(value) ? 0 : 2) : decimals;
  const text = value.toFixed(fixed);
  return withSymbol ? `HK$${text}` : text;
}

/** 表單金額字串（例如 "128.5"）→ 分。 */
export function parseMoneyToCents(input) {
  const text = String(input ?? '').trim().replace(/[,\s$]/g, '');
  if (text === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new HttpError(400, '費用的格式不正確（例：128 或 128.50）');
  return Math.round(Number(text) * 100);
}

export function parseMealOptions(input) {
  const list = String(input ?? '')
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [...new Set(list)].slice(0, 8);
  for (const item of unique) {
    if (item.length > 12) throw new HttpError(400, '餐飲選項每項最多 12 個字');
  }
  return unique;
}

export function mealOptionsOf(event) {
  if (!event?.meal_options) return [];
  try {
    const parsed = JSON.parse(event.meal_options);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Shanghai', 'UTC'];
  }
})();

export function isValidTimezone(value) {
  return TIMEZONES.includes(String(value));
}

function text(fields, key, max = 200) {
  const value = String(fields?.[key] ?? '').trim();
  if (value.length > max) throw new HttpError(400, `欄位內容太長（上限 ${max} 字）`);
  return value;
}

function intOrNull(value, { min = 0, max = 1000000 } = {}) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, '數字欄位格式不正確');
  return n;
}

/** 驗證並正規化聚會表單。 */
export function parseEventInput(fields) {
  const name = text(fields, 'name', 80);
  if (!name) throw new HttpError(400, '聚會名稱不能空白');

  const eventDate = String(fields?.event_date ?? '').trim();
  if (!isValidDateString(eventDate)) throw new HttpError(400, '聚會日期格式不正確');

  const startTime = String(fields?.start_time ?? '').trim();
  if (!isValidTimeString(startTime)) throw new HttpError(400, '開始時間格式不正確');

  const endTime = String(fields?.end_time ?? '').trim();
  if (endTime && !isValidTimeString(endTime)) throw new HttpError(400, '結束時間格式不正確');
  if (endTime && endTime <= startTime) throw new HttpError(400, '結束時間必須晚於開始時間');

  const timezone = String(fields?.timezone ?? '').trim() || 'Asia/Hong_Kong';
  if (!isValidTimezone(timezone)) throw new HttpError(400, '時區不正確');

  const status = String(fields?.status ?? 'draft');
  if (!STATUS_LABELS[status]) throw new HttpError(400, '狀態不正確');

  const capacity = intOrNull(fields?.capacity, { min: 1, max: 100000 });
  const lateAfter = intOrNull(fields?.late_after_minutes, { min: 0, max: 240 });
  const deadlineRaw = String(fields?.registration_deadline ?? '').trim();
  let registrationDeadline = null;
  if (deadlineRaw) {
    if (!parseLocalDateTime(deadlineRaw.replace(' ', 'T'), timezone)) {
      throw new HttpError(400, '報名截止時間格式不正確');
    }
    registrationDeadline = deadlineRaw.replace(' ', 'T');
  }

  return {
    name,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime || null,
    location: text(fields, 'location', 120) || null,
    notes: text(fields, 'notes', 2000) || null,
    internal_notes: text(fields, 'internal_notes', 2000) || null,
    status,
    timezone,
    capacity,
    fee_amount: parseMoneyToCents(fields?.fee_amount),
    fee_note: text(fields, 'fee_note', 120) || null,
    contact_name: text(fields, 'contact_name', 60) || null,
    contact_phone: normalizePhone(fields?.contact_phone) || null,
    meal_options: parseMealOptions(fields?.meal_options),
    registration_deadline: registrationDeadline,
    late_after_minutes: lateAfter ?? 15,
    allow_self_checkin: fields?.allow_self_checkin ? 1 : 0,
    allow_self_checkout: fields?.allow_self_checkout ? 1 : 0,
  };
}
