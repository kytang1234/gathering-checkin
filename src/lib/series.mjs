// 系列統計：全部即時由名單＋簽到計算，不另存統計表。
//
// 分母規則（重要）：
//   baseEvents = 系列中 status='closed' 的場次；
//   可選 includeOpen 把 status='open' 且日期已過的場次也算；
//   日期未到的場次永不計入分母（否則出席率會無故下跌）。

import { humanDuration, diffMinutes, weekdayLabel } from './time.mjs';

export function pickBaseEvents(events, { includeOpen = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  return events
    .filter((event) => {
      // 未舉行的場次永不計入分母（即使狀態已被手動設為 closed）
      if (event.event_date > today) return false;
      if (event.status === 'closed') return true;
      if (includeOpen && event.status === 'open') return true;
      return false;
    })
    .sort((a, b) => `${a.event_date}${a.start_time}`.localeCompare(`${b.event_date}${b.start_time}`));
}

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function memberFromRow(row) {
  return {
    attendee_id: row.attendee_id,
    name: row.name,
    group_name: row.group_name,
    phone: row.phone,
    seat_no: row.seat_no,
    meal_choice: row.meal_choice,
  };
}

/**
 * @param {object} input
 * @param {object} input.series
 * @param {object[]} input.events 系列內所有聚會（含未來）
 * @param {Map<string, object[]>} input.rosterByEvent 每場名單（含簽到欄位）
 */
export function buildSeriesStats({ series, events, rosterByEvent, includeOpen = false, today }) {
  const baseEvents = pickBaseEvents(events, { includeOpen, today });
  const baseIds = new Set(baseEvents.map((event) => event.id));

  // 成員：出現在系列任何一場名單的人（含未來場次）
  const members = new Map();
  for (const event of events) {
    for (const row of rosterByEvent.get(event.id) || []) {
      if (!members.has(row.attendee_id)) members.set(row.attendee_id, memberFromRow(row));
    }
  }

  // 每場出席情況
  const perEvent = baseEvents.map((event) => {
    const roster = rosterByEvent.get(event.id) || [];
    const present = roster.filter((row) => row.checked_in_at);
    const late = present.filter((row) => Number(row.is_late) === 1);
    const stays = present
      .filter((row) => row.checked_out_at)
      .map((row) => Math.max(0, diffMinutes(row.checked_in_at, row.checked_out_at)));

    return {
      event,
      rosterCount: roster.length,
      presentCount: present.length,
      rate: rate(present.length, roster.length),
      onTimeCount: present.length - late.length,
      lateCount: late.length,
      avgStay: stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
    };
  });

  // 逐人統計
  const rows = [];
  for (const member of members.values()) {
    const cells = [];
    let attended = 0;
    let registered = 0;
    let onTime = 0;
    let late = 0;
    let lateMinutes = 0;
    let owed = 0;
    let paid = 0;
    const stays = [];
    const absent = [];
    const missed = [];
    const notInvited = [];
    let firstAttended = null;
    let lastAttended = null;

    for (const event of baseEvents) {
      const roster = rosterByEvent.get(event.id) || [];
      const entry = roster.find((row) => row.attendee_id === member.attendee_id);
      if (!entry) {
        cells.push('not_registered');
        absent.push(event);
        notInvited.push(event);
        continue;
      }
      registered += 1;
      if (!entry.checked_in_at) {
        cells.push('absent');
        absent.push(event);
        missed.push(event);
        continue;
      }

      attended += 1;
      const isLate = Number(entry.is_late) === 1;
      cells.push(isLate ? 'late' : 'present');
      if (isLate) {
        late += 1;
        lateMinutes += Number(entry.late_minutes) || 0;
      } else {
        onTime += 1;
      }
      if (entry.checked_out_at) {
        stays.push(Math.max(0, diffMinutes(entry.checked_in_at, entry.checked_out_at)));
      }
      owed += Number(event.fee_amount) || 0;
      if (entry.fee_paid) paid += Number(event.fee_amount) || 0;

      if (!firstAttended || event.event_date < firstAttended) firstAttended = event.event_date;
      if (!lastAttended || event.event_date > lastAttended) lastAttended = event.event_date;
    }

    // 連續出席：由最近一場往前數
    let streak = 0;
    for (let i = baseEvents.length - 1; i >= 0; i -= 1) {
      const roster = rosterByEvent.get(baseEvents[i].id) || [];
      const entry = roster.find((row) => row.attendee_id === member.attendee_id);
      if (entry?.checked_in_at) streak += 1;
      else break;
    }

    rows.push({
      ...member,
      attended,
      registered,
      seriesRate: rate(attended, baseEvents.length),
      registeredRate: rate(attended, registered),
      streak,
      onTime,
      late,
      avgLate: late > 0 ? Math.round(lateMinutes / late) : 0,
      avgStay: stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
      owed,
      paid,
      firstAttended,
      lastAttended,
      absent,
      missed,
      notInvited,
      cells,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

  const attendedSeats = rows.reduce((sum, row) => sum + row.attended, 0);
  const eventRates = perEvent.filter((item) => item.rate !== null).map((item) => item.rate);
  const firstBaseDate = baseEvents[0]?.event_date || null;

  return {
    series,
    baseEvents,
    includeOpen,
    perEvent,
    members: rows,
    totals: {
      eventCount: events.length,
      baseCount: baseEvents.length,
      memberCount: rows.length,
      attendedSeats,
      overallRate: rate(attendedSeats, rows.length * baseEvents.length),
      avgEventRate: eventRates.length
        ? Math.round((eventRates.reduce((a, b) => a + b, 0) / eventRates.length) * 10) / 10
        : null,
      avgPerEvent: baseEvents.length ? Math.round((attendedSeats / baseEvents.length) * 10) / 10 : null,
      openPastCount: events.filter((event) => event.status === 'open' && event.event_date <= (today || new Date().toISOString().slice(0, 10))).length,
      newMembers: rows.filter((row) => firstBaseDate && row.firstAttended && row.firstAttended > firstBaseDate).length,
      activeMembers: rows.filter((row) => row.seriesRate !== null && row.seriesRate >= 50).length,
      owed: rows.reduce((sum, row) => sum + row.owed, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
    },
  };
}

export function eventLabel(event) {
  return `${event.event_date.slice(5)} ${weekdayLabel(event.event_date)} ${String(event.start_time).slice(0, 5)}`;
}

export function seriesMatrixCsv(stats) {
  const header = ['姓名', '組別', ...stats.baseEvents.map((event) => eventLabel(event)), '出席場次', '系列出席率'];
  const rows = [header];
  for (const member of stats.members) {
    rows.push([
      member.name,
      member.group_name || '',
      ...member.cells.map((cell) =>
        cell === 'present' ? '準時' : cell === 'late' ? '遲到' : cell === 'absent' ? '缺席' : '未報名',
      ),
      member.attended,
      member.seriesRate === null ? '' : `${member.seriesRate}%`,
    ]);
  }
  return rows;
}

export function seriesMembersCsv(stats) {
  const header = [
    '姓名',
    '組別',
    '電話',
    '出席場次',
    '基準場次',
    '系列出席率',
    '報名出席率',
    '連續出席',
    '準時',
    '遲到',
    '最近出席',
    '缺席場次',
    '缺席日期',
    '未報名場次',
    '應繳',
    '實繳',
  ];
  const rows = [header];
  for (const member of stats.members) {
    rows.push([
      member.name,
      member.group_name || '',
      member.phone || '',
      member.attended,
      stats.baseEvents.length,
      member.seriesRate === null ? '' : `${member.seriesRate}%`,
      member.registeredRate === null ? '' : `${member.registeredRate}%`,
      member.streak,
      member.onTime,
      member.late,
      member.lastAttended || '',
      member.absent.length,
      member.absent.map((event) => event.event_date).join(' '),
      member.notInvited.length,
      (member.owed / 100).toFixed(2),
      (member.paid / 100).toFixed(2),
    ]);
  }
  return rows;
}

export function seriesEventsCsv(stats) {
  const header = ['日期', '星期', '聚會', '名單數', '出席', '出席率', '準時', '遲到', '平均停留', '狀態'];
  const rows = [header];
  for (const item of stats.perEvent) {
    rows.push([
      item.event.event_date,
      weekdayLabel(item.event.event_date),
      item.event.name,
      item.rosterCount,
      item.presentCount,
      item.rate === null ? '' : `${item.rate}%`,
      item.onTimeCount,
      item.lateCount,
      item.avgStay === null ? '' : humanDuration(item.avgStay),
      item.event.status === 'closed' ? '已結束' : '進行中',
    ]);
  }
  return rows;
}
