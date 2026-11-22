import { requireUser } from '../lib/auth.mjs';
import { HttpError, Redirect } from '../lib/http.mjs';
import { parseRosterCsv } from '../lib/csv.mjs';
import {
  addAttendeeToEvent,
  createAttendee,
  findAttendeeByPhone,
  getRosterEntry,
  listRoster,
  removeFromRoster,
  searchRoster,
  setFeePaid,
  updateAttendee,
  updateRosterMeta,
} from '../lib/store.mjs';
import { mealOptionsOf, normalizePhone, phoneKey } from '../lib/rules.mjs';
import { shortCode } from '../lib/tokens.mjs';
import { cardsPage, importPage, rosterEditPage, rosterPage } from '../views/roster.mjs';
import { flashFrom } from '../views/ui.mjs';
import { backWith, loadEvent } from './helpers.mjs';

function cleanText(value, max = 80) {
  return String(value ?? '').trim().slice(0, max);
}

/** 匯入時用來判斷「這個人是否已在名單」。 */
function rosterKeys(roster) {
  const phones = new Map();
  const names = new Map();
  for (const row of roster) {
    if (row.phone) phones.set(phoneKey(row.phone), row.name);
    names.set(row.name, row.name);
  }
  return { phones, names };
}

export function registerRosterRoutes(router) {
  router.get('/events/:id/roster', (ctx) => {
    const event = loadEvent(ctx);
    const roster = listRoster(ctx.db, event.id);
    const query = String(ctx.query.get('q') || '').trim();
    return rosterPage({
      user: ctx.user,
      event,
      roster,
      filtered: searchRoster(roster, query),
      query,
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
      mealOptions: mealOptionsOf(event),
    });
  });

  router.post('/events/:id/roster/add', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const name = cleanText(ctx.fields.name);
    if (!name) throw new HttpError(400, '姓名不能空白');

    const phone = normalizePhone(ctx.fields.phone);
    let attendee = phone ? findAttendeeByPhone(ctx.db, phone) : null;
    if (!attendee) {
      attendee = createAttendee(ctx.db, {
        name,
        phone: phone || null,
        groupName: cleanText(ctx.fields.group_name, 60) || null,
      });
    }

    const added = addAttendeeToEvent(ctx.db, {
      eventId: event.id,
      attendeeId: attendee.id,
      source: 'manual',
      seatNo: cleanText(ctx.fields.seat_no, 30) || null,
      mealChoice: cleanText(ctx.fields.meal_choice, 30) || null,
      note: cleanText(ctx.fields.note, 200) || null,
    });

    backWith(
      ctx.res,
      `/events/${event.id}/roster`,
      added ? 'msg' : 'err',
      added ? 'added' : 'duplicate',
      added ? '' : `${attendee.name} 已在名單內`,
    );
  });

  router.get('/events/:id/roster/import', (ctx) => {
    const event = loadEvent(ctx);
    return importPage({ user: ctx.user, event, csrfToken: ctx.session.csrf, error: '' });
  });

  router.post('/events/:id/roster/import', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const roster = listRoster(ctx.db, event.id);

    // 第二步：確認匯入
    if (ctx.fields.confirm && ctx.fields.payload) {
      let items;
      try {
        items = JSON.parse(String(ctx.fields.payload));
      } catch {
        throw new HttpError(400, '匯入資料已損壞，請重新貼上');
      }
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '沒有可匯入的資料');
      if (items.length > 1000) throw new HttpError(400, '一次最多匯入 1000 人');

      let created = 0;
      let skipped = 0;
      ctx.db.transaction(() => {
        for (const item of items) {
          const name = cleanText(item.name);
          if (!name) {
            skipped += 1;
            continue;
          }
          const existing = item.phone ? findAttendeeByPhone(ctx.db, item.phone) : null;
          const attendee =
            existing ||
            createAttendee(ctx.db, {
              name,
              phone: item.phone || null,
              groupName: cleanText(item.group_name, 60) || null,
            });
          const added = addAttendeeToEvent(ctx.db, {
            eventId: event.id,
            attendeeId: attendee.id,
            source: 'import',
            seatNo: cleanText(item.seat_no, 30) || null,
            mealChoice: cleanText(item.meal_choice, 30) || null,
            note: cleanText(item.note, 200) || null,
          });
          if (added) created += 1;
          else skipped += 1;
        }
      })();

      backWith(ctx.res, `/events/${event.id}/roster`, 'msg', 'imported', `新增 ${created} 人，略過 ${skipped} 人`);
    }

    // 第一步：預覽
    const text = String(ctx.fields.csv || '');
    if (!text.trim()) throw new HttpError(400, '請貼上 CSV 內容或選擇檔案');

    let parsed;
    try {
      parsed = parseRosterCsv(text);
    } catch {
      throw new HttpError(400, 'CSV 格式無法解析');
    }
    if (parsed.items.length === 0) throw new HttpError(400, '找不到任何姓名欄位');

    const { phones, names } = rosterKeys(roster);
    const fresh = [];
    const existing = [];
    for (const item of parsed.items) {
      const key = item.phone ? phoneKey(item.phone) : '';
      const hit = (key && phones.get(key)) || names.get(item.name);
      if (hit) existing.push({ name: hit });
      else fresh.push(item);
    }

    return importPage({
      user: ctx.user,
      event,
      csrfToken: ctx.session.csrf,
      error: '',
      preview: { items: fresh, existing, skipped: parsed.skipped },
      payload: JSON.stringify(fresh),
    });
  });

  router.get('/events/:id/roster/cards', (ctx) => {
    const event = loadEvent(ctx);
    const roster = listRoster(ctx.db, event.id);
    return cardsPage({
      event,
      rows: roster.map((row) => ({ ...row, short_code: shortCode(row.personal_token) })),
      baseTitle: `${event.name} · 個人 QR 卡`,
    });
  });

  router.get('/events/:id/roster/:attendeeId', (ctx) => {
    const event = loadEvent(ctx);
    const row = getRosterEntry(ctx.db, event.id, ctx.params.attendeeId);
    if (!row) throw new HttpError(404, '這個人不在名單內');
    return rosterEditPage({
      user: ctx.user,
      event,
      row,
      error: '',
      csrfToken: ctx.session.csrf,
      mealOptions: mealOptionsOf(event),
      personalQrUrl: `/api/qr/attendee/${row.attendee_id}?size=440`,
      shortCode: shortCode(row.personal_token),
    });
  });

  router.post('/events/:id/roster/:attendeeId', (ctx) => {
    const event = loadEvent(ctx);
    const row = getRosterEntry(ctx.db, event.id, ctx.params.attendeeId);
    if (!row) throw new HttpError(404, '這個人不在名單內');
    const name = cleanText(ctx.fields.name);
    if (!name) throw new HttpError(400, '姓名不能空白');

    updateAttendee(ctx.db, row.attendee_id, {
      name,
      phone: ctx.fields.phone,
      groupName: cleanText(ctx.fields.group_name, 60) || null,
      notes: cleanText(ctx.fields.person_notes, 500) || null,
    });
    updateRosterMeta(ctx.db, event.id, row.attendee_id, {
      seatNo: cleanText(ctx.fields.seat_no, 30),
      mealChoice: cleanText(ctx.fields.meal_choice, 30),
      note: cleanText(ctx.fields.note, 200),
    });
    setFeePaid(ctx.db, event.id, row.attendee_id, Boolean(ctx.fields.fee_paid));

    backWith(ctx.res, `/events/${event.id}/roster/${row.attendee_id}`, 'msg', 'saved');
  });

  router.post('/events/:id/roster/:attendeeId/remove', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    removeFromRoster(ctx.db, event.id, ctx.params.attendeeId);
    backWith(ctx.res, `/events/${event.id}/roster`, 'msg', 'removed');
  });

  router.post('/events/:id/roster/:attendeeId/paid', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    setFeePaid(ctx.db, event.id, ctx.params.attendeeId, String(ctx.fields.paid) === '1');
    backWith(ctx.res, `/events/${event.id}/roster`, 'msg', 'paid');
  });

  void Redirect;
}
