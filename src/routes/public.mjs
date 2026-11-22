import { HttpError } from '../lib/http.mjs';
import { rateLimit } from '../lib/ratelimit.mjs';
import {
  addAttendeeToEvent,
  checkIn,
  checkOut,
  countRoster,
  createAttendee,
  findAttendeeByPhone,
  findAttendeesByQuery,
  getAttendee,
  getCheckin,
  getEventByPublicToken,
  getRosterEntry,
} from '../lib/store.mjs';
import { canSelfCheckIn, canSelfCheckOut, maskPhone, normalizePhone, registrationClosed } from '../lib/rules.mjs';
import {
  publicCandidatesPage,
  publicClosedPage,
  publicDonePage,
  publicErrorPage,
  publicFormPage,
} from '../views/public.mjs';
import { errorPage } from '../views/ui.mjs';

const PUBLIC_RATE_LIMIT = (() => {
  const n = Number(process.env.PUBLIC_RATE_LIMIT);
  return Number.isFinite(n) && n >= 20 ? Math.floor(n) : 180;
})();

function findEvent(ctx) {
  return getEventByPublicToken(ctx.db, ctx.params.token);
}

function limit(ctx) {
  // 以「IP＋聚會」為單位；同一間辦公室的 NAT 會共用 IP，所以額度要夠一群人同時掃。
  const gate = rateLimit(`public:${ctx.ip}:${ctx.params.token}`, PUBLIC_RATE_LIMIT, 60_000);
  if (!gate.allowed) throw new HttpError(429, '操作太頻繁，請稍後再試。');
}

function fail(event, error) {
  return {
    html: publicErrorPage({ event, message: error.message || '發生錯誤，請再試一次。' }),
    status: error.status || 400,
  };
}

export function registerPublicRoutes(router) {
  router.get('/s/:token', (ctx) => {
    const event = findEvent(ctx);
    if (!event) {
      return {
        html: errorPage({ status: 404, message: '這個簽到連結不存在，可能已經重新產生。請向主辦單位索取新的 QR code。' }),
        status: 404,
      };
    }
    if (event.status === 'closed') return publicClosedPage({ event, reason: 'closed' });
    if (event.status === 'draft') return publicClosedPage({ event, reason: 'notstarted' });
    return publicFormPage({ event });
  }, { public: true });

  router.post('/s/:token/lookup', (ctx) => {
    const event = findEvent(ctx);
    if (!event) throw new HttpError(404, '連結不存在');
    limit(ctx);
    try {
      if (!canSelfCheckIn(event)) throw new HttpError(409, '這個聚會沒有開放自助簽到。');
      const q = String(ctx.fields.q || '').trim().slice(0, 40);
      if (!q) throw new HttpError(400, '請輸入姓名或電話。');

      const found = findAttendeesByQuery(ctx.db, q, 8).map((row) => ({
        id: row.id,
        name: row.name,
        group_name: row.group_name,
        phone_masked: maskPhone(row.phone),
      }));

      if (found.length === 0) {
        return publicFormPage({
          event,
          notice: `找不到「${q}」。如果不在名單上，請用下面的「新增」直接簽到。`,
        });
      }
      return publicCandidatesPage({ event, candidates: found, query: q });
    } catch (error) {
      if (error instanceof HttpError) return fail(event, error);
      throw error;
    }
  }, { public: true });

  router.post('/s/:token/checkin', (ctx) => {
    const event = findEvent(ctx);
    if (!event) throw new HttpError(404, '連結不存在');
    limit(ctx);
    try {
      if (!canSelfCheckIn(event)) throw new HttpError(409, '這個聚會沒有開放自助簽到。');
      const attendee = getAttendee(ctx.db, String(ctx.fields.attendee_id || ''));
      if (!attendee) throw new HttpError(400, '找不到你的資料，請重新搜尋。');

      const inRoster = Boolean(getRosterEntry(ctx.db, event.id, attendee.id));
      if (!inRoster) {
        if (event.capacity && countRoster(ctx.db, event.id) >= Number(event.capacity)) {
          return publicClosedPage({ event, reason: 'full' });
        }
        addAttendeeToEvent(ctx.db, { eventId: event.id, attendeeId: attendee.id, source: 'walkin' });
      }

      const { checkin } = checkIn(ctx.db, { event, attendeeId: attendee.id, method: 'qr_self' });
      return publicDonePage({
        event,
        attendee,
        checkin,
        late: Number(checkin.is_late) === 1,
        canCheckout: canSelfCheckOut(event) && Boolean(attendee.phone),
      });
    } catch (error) {
      if (error instanceof HttpError) return fail(event, error);
      throw error;
    }
  }, { public: true });

  router.post('/s/:token/walkin', (ctx) => {
    const event = findEvent(ctx);
    if (!event) throw new HttpError(404, '連結不存在');
    limit(ctx);
    try {
      if (!canSelfCheckIn(event)) throw new HttpError(409, '這個聚會沒有開放自助簽到。');
      if (registrationClosed(event)) throw new HttpError(409, '報名已經截止，請找工作人員協助。');

      const name = String(ctx.fields.name || '').trim().slice(0, 80);
      if (!name) throw new HttpError(400, '請填姓名。');
      const phone = normalizePhone(ctx.fields.phone);

      let attendee = phone ? findAttendeeByPhone(ctx.db, phone) : null;
      const isNew = !attendee;
      if (!attendee) {
        attendee = createAttendee(ctx.db, { name, phone: phone || null });
      }

      if (!getRosterEntry(ctx.db, event.id, attendee.id)) {
        if (event.capacity && countRoster(ctx.db, event.id) >= Number(event.capacity)) {
          return publicClosedPage({ event, reason: 'full' });
        }
        addAttendeeToEvent(ctx.db, { eventId: event.id, attendeeId: attendee.id, source: 'walkin' });
      }

      const { checkin } = checkIn(ctx.db, { event, attendeeId: attendee.id, method: 'qr_self' });
      return publicDonePage({
        event,
        attendee,
        checkin,
        late: Number(checkin.is_late) === 1,
        canCheckout: canSelfCheckOut(event) && Boolean(attendee.phone),
      });
    } catch (error) {
      if (error instanceof HttpError) return fail(event, error);
      throw error;
    }
    finally {
      void ctx;
    }
  }, { public: true });

  router.post('/s/:token/checkout', (ctx) => {
    const event = findEvent(ctx);
    if (!event) throw new HttpError(404, '連結不存在');
    limit(ctx);
    try {
      if (!canSelfCheckOut(event)) throw new HttpError(409, '這個聚會沒有開放自助簽退。');
      const attendee = getAttendee(ctx.db, String(ctx.fields.attendee_id || ''));
      if (!attendee) throw new HttpError(400, '找不到你的資料。');
      const checkin = getCheckin(ctx.db, event.id, attendee.id);
      if (!checkin) throw new HttpError(409, '你還沒有簽到。');
      if (checkin.checked_out_at) {
        return publicDonePage({
          event,
          attendee,
          checkin,
          late: false,
          canCheckout: false,
          checkoutDone: true,
        });
      }

      const last4 = String(ctx.fields.last4 || '').replace(/\D/g, '').slice(-4);
      const phone = normalizePhone(attendee.phone);
      if (!phone) throw new HttpError(409, '沒有電話記錄，請找工作人員協助簽退。');
      if (phone.slice(-4) !== last4) throw new HttpError(403, '電話後 4 碼不正確。');

      checkOut(ctx.db, { eventId: event.id, attendeeId: attendee.id, method: 'qr_self' });
      const updated = getCheckin(ctx.db, event.id, attendee.id);
      return publicDonePage({
        event,
        attendee,
        checkin: updated,
        late: false,
        canCheckout: false,
        checkoutDone: true,
      });
    } catch (error) {
      if (error instanceof HttpError) return fail(event, error);
      throw error;
    }
  }, { public: true });
}
