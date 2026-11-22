// 統計：所有「總結」數字都由名單＋簽到記錄算出，不另外存表，避免對不上。

import { diffMinutes, humanDuration } from './time.mjs';
import { methodLabel } from './rules.mjs';

export function stayMinutes(row) {
  if (!row?.checked_in_at || !row?.checked_out_at) return null;
  return Math.max(0, diffMinutes(row.checked_in_at, row.checked_out_at));
}

export function summarize(event, roster) {
  const present = roster.filter((r) => Boolean(r.checked_in_at));
  const absent = roster.filter((r) => !r.checked_in_at);
  const left = present.filter((r) => Boolean(r.checked_out_at));
  const late = present.filter((r) => Number(r.is_late) === 1);
  const onTime = present.length - late.length;

  const stays = left.map(stayMinutes).filter((m) => m !== null);
  const avgStay = stays.length ? Math.round(stays.reduce((sum, m) => sum + m, 0) / stays.length) : null;

  const byMethod = new Map();
  for (const row of present) {
    const key = row.method || 'manual';
    byMethod.set(key, (byMethod.get(key) || 0) + 1);
  }

  const meals = new Map();
  for (const row of present) {
    const key = row.meal_choice || '未填';
    meals.set(key, (meals.get(key) || 0) + 1);
  }

  const fee = Number(event?.fee_amount || 0);
  const paidRows = present.filter((r) => Number(r.fee_paid) === 1);
  const unpaidRows = present.filter((r) => Number(r.fee_paid) !== 1);

  const total = roster.length;
  const rate = total === 0 ? 0 : Math.round((present.length / total) * 1000) / 10;

  return {
    total,
    presentCount: present.length,
    absentCount: absent.length,
    leftCount: left.length,
    notLeftCount: present.length - left.length,
    lateCount: late.length,
    onTimeCount: onTime,
    rate,
    avgStay,
    avgStayText: avgStay === null ? '—' : humanDuration(avgStay),
    expectedFee: fee * present.length,
    collectedFee: fee * paidRows.length,
    unpaidCount: unpaidRows.length,
    meals: [...meals.entries()].sort((a, b) => b[1] - a[1]),
    methods: [...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ method: k, label: methodLabel(k), count: v })),
    present,
    absent,
    late,
    left,
    unpaid: unpaidRows,
  };
}

export function csvRows(event, summary, tzFormatter) {
  const header = [
    '姓名',
    '電話',
    '組別',
    '桌號',
    '餐飲',
    '簽到時間',
    '遲到',
    '遲到分鐘',
    '簽退時間',
    '停留分鐘',
    '簽到方式',
    '已繳費',
    '備註',
  ];
  const rows = [header];
  for (const row of summary.present) {
    rows.push([
      row.name,
      row.phone || '',
      row.group_name || '',
      row.seat_no || '',
      row.meal_choice || '',
      tzFormatter(row.checked_in_at),
      Number(row.is_late) === 1 ? '是' : '否',
      Number(row.is_late) === 1 ? String(row.late_minutes ?? '') : '0',
      row.checked_out_at ? tzFormatter(row.checked_out_at) : '',
      stayMinutes(row) ?? '',
      methodLabel(row.method),
      Number(row.fee_paid) === 1 ? '是' : '否',
      row.roster_note || row.person_notes || '',
    ]);
  }
  for (const row of summary.absent) {
    rows.push([
      row.name,
      row.phone || '',
      row.group_name || '',
      row.seat_no || '',
      row.meal_choice || '',
      '',
      '',
      '',
      '',
      '',
      '未出席',
      Number(row.fee_paid) === 1 ? '是' : '否',
      row.roster_note || row.person_notes || '',
    ]);
  }
  void event;
  return rows;
}
