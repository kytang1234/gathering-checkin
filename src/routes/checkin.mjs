import { requireUser } from '../lib/auth.mjs';
import { HttpError } from '../lib/http.mjs';
import {
  addAttendeeToEvent,
  assertEventOpen,
  checkIn,
  checkOut,
  countRoster,
  createAttendee,
  findAttendeeByPersonalToken,
  findAttendeeByPhone,
  findAttendeeByShortCode,
  getAttendee,
  getCheckin,
  getRosterEntry,
  listRoster,
  recentCheckins,
  searchRoster,
  undoCheckin,
  undoCheckout,
} from '../lib/store.mjs';
import { maskPhone, mealOptionsOf, normalizePhone } from '../lib/rules.mjs';
import { formatClock, formatDateTime } from '../lib/time.mjs';
import { summarize } from '../lib/reports.mjs';
import { checkinPage } from '../views/checkin.mjs';
import { flashFrom } from '../views/ui.mjs';
import { backField, backWith, eventWithSummary, loadEvent } from './helpers.mjs';

function cleanName(value) {
  return String(value ?? '').trim().slice(0, 80);
}

/** 容許掃到完整的 `ATT:<token>`，也容許只貼 token。 */
function qrCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/^ATT:/i, '');
}

function openGuard(ctx, event, back, allowClosed = false) {
  if (allowClosed) return;
  try {
    assertEventOpen(event);
  } catch (error) {
    if (error instanceof HttpError) {
      backWith(ctx.res, back, 'err', event.status === 'closed' ? 'closed' : 'notstarted');
    }
    throw error;
  }
}

function signedNote(checkin, event) {
  return `已於 ${formatClock(checkin.checked_in_at, event.timezone)} 簽到（${checkin.method === 'qr_self' ? '自助' : checkin.method === 'qr_scan' ? '掃描' : '人手'}）`;
}

export function registerCheckinRoutes(router) {
  router.get('/events/:id/checkin', (ctx) => {
    const event = loadEvent(ctx);
    const { summary } = eventWithSummary(ctx, event);
    const query = String(ctx.query.get('q') || '').trim();
    const roster = listRoster(ctx.db, event.id);
    const results = query ? searchRoster(roster, query).slice(0, 12) : [];

    return checkinPage({
      user: ctx.user,
      event,
      summary,
      results,
      query,
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
      recent: recentCheckins(ctx.db, event.id, 8),
      mealOptions: mealOptionsOf(event),
    });
  });

  // 人手簽到
  router.post('/events/:id/checkin', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const back = backField(ctx, `/events/${event.id}/checkin`);
    const attendeeId = String(ctx.fields.attendee_id || '');
    const attendee = getAttendee(ctx.db, attendeeId);
    if (!attendee) backWith(ctx.res, back, 'err', 'invalid', '找不到這個人');
    openGuard(ctx, event, back);

    if (!getRosterEntry(ctx.db, event.id, attendeeId)) {
      addAttendeeToEvent(ctx.db, { eventId: event.id, attendeeId, source: 'manual' });
    }

    const result = checkIn(ctx.db, { event, attendeeId, method: 'manual', operatorUserId: ctx.user.id });
    if (!result.created) backWith(ctx.res, back, 'msg', 'checkedin', signedNote(result.checkin, event));
    backWith(ctx.res, back, 'msg', 'checkedin');
  });

  // 現場臨時新增並簽到
  router.post('/events/:id/checkin/add', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const back = `/events/${event.id}/checkin`;
    const name = cleanName(ctx.fields.name);
    if (!name) backWith(ctx.res, back, 'err', 'invalid', '姓名不能空白');
    openGuard(ctx, event, back);

    const phone = normalizePhone(ctx.fields.phone);
    let attendee = phone ? findAttendeeByPhone(ctx.db, phone) : null;
    if (!attendee) {
      attendee = createAttendee(ctx.db, { name, phone: phone || null, groupName: null });
    }

    addAttendeeToEvent(ctx.db, {
      eventId: event.id,
      attendeeId: attendee.id,
      source: 'walkin',
      mealChoice: String(ctx.fields.meal_choice || '') || null,
    });
    const result = checkIn(ctx.db, { event, attendeeId: attendee.id, method: 'manual', operatorUserId: ctx.user.id });
    if (!result.created) backWith(ctx.res, back, 'msg', 'checkedin', signedNote(result.checkin, event));
    backWith(ctx.res, back, 'msg', 'checkedin');
  });

  // 手動輸入卡上短碼
  router.post('/events/:id/checkin-by-code', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const back = `/events/${event.id}/checkin`;
    const code = qrCode(ctx.fields.code);
    const attendee = findAttendeeByPersonalToken(ctx.db, code) || findAttendeeByShortCode(ctx.db, code);
    if (!attendee) backWith(ctx.res, back, 'err', 'invalid', '找不到這個短碼，請確認卡片');
    openGuard(ctx, event, back);

    if (!getRosterEntry(ctx.db, event.id, attendee.id)) {
      addAttendeeToEvent(ctx.db, { eventId: event.id, attendeeId: attendee.id, source: 'manual' });
    }
    const result = checkIn(ctx.db, { event, attendeeId: attendee.id, method: 'qr_scan', operatorUserId: ctx.user.id });
    if (!result.created) backWith(ctx.res, back, 'msg', 'checkedin', signedNote(result.checkin, event));
    backWith(ctx.res, back, 'msg', 'checkedin', `${attendee.name} 簽到完成`);
  });

  router.post('/events/:id/checkin/:attendeeId/undo', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    undoCheckin(ctx.db, event.id, ctx.params.attendeeId);
    backWith(ctx.res, backField(ctx, `/events/${event.id}/checkin`), 'msg', 'undone');
  });

  router.post('/events/:id/checkout/:attendeeId', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const back = backField(ctx, `/events/${event.id}/checkin`);
    const changed = checkOut(ctx.db, {
      eventId: event.id,
      attendeeId: ctx.params.attendeeId,
      method: 'manual',
      operatorUserId: ctx.user.id,
    });
    backWith(ctx.res, back, changed ? 'msg' : 'err', changed ? 'checkedout' : 'invalid', changed ? '' : '這個人還未簽到');
  });

  router.post('/events/:id/checkout/:attendeeId/undo', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    undoCheckout(ctx.db, event.id, ctx.params.attendeeId);
    backWith(ctx.res, backField(ctx, `/events/${event.id}/checkin`), 'msg', 'undone');
  });

  // ---------------- 掃描頁用的 JSON API

  router.post('/api/events/:id/resolve', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const payload = ctx.json || ctx.fields || {};
    const code = qrCode(payload.code);
    const attendee = findAttendeeByPersonalToken(ctx.db, code) || findAttendeeByShortCode(ctx.db, code);
    if (!attendee) return { json: { ok: false, error: '找不到這個 QR code' }, status: 404 };

    const entry = getRosterEntry(ctx.db, event.id, attendee.id);
    const checkin = getCheckin(ctx.db, event.id, attendee.id);
    return {
      json: {
        ok: true,
        attendee: {
          id: attendee.id,
          name: attendee.name,
          group_name: attendee.group_name,
          phone_masked: maskPhone(attendee.phone),
          in_roster: Boolean(entry),
        },
        checkin: checkin
          ? {
              checked_in_at: checkin.checked_in_at,
              checked_in_label: formatDateTime(checkin.checked_in_at, event.timezone),
              method: checkin.method,
              is_late: checkin.is_late,
              late_minutes: checkin.late_minutes,
              checked_out_at: checkin.checked_out_at,
            }
          : null,
      },
    };
  });

  router.post('/api/events/:id/scan-checkin', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    if (event.status !== 'open') {
      return { json: { ok: false, error: event.status === 'closed' ? '聚會已結束' : '聚會未開放簽到' }, status: 409 };
    }
    const attendeeId = String((ctx.json || ctx.fields || {}).attendee_id || '');
    const attendee = getAttendee(ctx.db, attendeeId);
    if (!attendee) return { json: { ok: false, error: '找不到這個人' }, status: 404 };

    if (!getRosterEntry(ctx.db, event.id, attendeeId)) {
      addAttendeeToEvent(ctx.db, { eventId: event.id, attendeeId, source: 'manual' });
    }
    const result = checkIn(ctx.db, { event, attendeeId, method: 'qr_scan', operatorUserId: ctx.user.id });
    return {
      json: {
        ok: true,
        created: result.created,
        name: attendee.name,
        checked_in_at: result.checkin.checked_in_at,
        checked_in_label: formatDateTime(result.checkin.checked_in_at, event.timezone),
        is_late: result.checkin.is_late,
        late_minutes: result.checkin.late_minutes,
        roster_count: countRoster(ctx.db, event.id),
      },
    };
  });

  void summarize;
}
