import { requireAdmin, requireUser } from '../lib/auth.mjs';
import { HttpError, Redirect } from '../lib/http.mjs';
import {
  createEvent,
  deleteEvent,
  getEvent,
  regeneratePublicToken,
  setEventStatus,
  updateEvent,
} from '../lib/store.mjs';
import { parseEventInput, STATUS_LABELS } from '../lib/rules.mjs';
import { eventFormPage } from '../views/eventForm.mjs';
import { eventOverviewPage } from '../views/event.mjs';
import { qrPage } from '../views/qr.mjs';
import { flashFrom } from '../views/ui.mjs';
import { backWith, eventWithSummary, loadEvent } from './helpers.mjs';

function selfUrl(ctx, event) {
  return `${ctx.baseUrl}/s/${event.public_token}`;
}

function valuesFromFields(fields) {
  return {
    ...fields,
    allow_self_checkin: Boolean(fields.allow_self_checkin),
    allow_self_checkout: Boolean(fields.allow_self_checkout),
  };
}

export function registerEventRoutes(router) {
  router.get('/events/new', (ctx) => {
    requireAdmin(ctx);
    return eventFormPage({ user: ctx.user, csrfToken: ctx.session.csrf });
  });

  router.post('/events', (ctx) => {
    requireAdmin(ctx);
    try {
      const data = parseEventInput(ctx.fields);
      const event = createEvent(ctx.db, data);
      throw new Redirect(`/events/${event.id}?msg=created`);
    } catch (error) {
      if (error instanceof Redirect) throw error;
      if (error instanceof HttpError) {
        return {
          html: eventFormPage({
            user: ctx.user,
            values: valuesFromFields(ctx.fields),
            error: error.message,
            csrfToken: ctx.session.csrf,
          }),
          status: 400,
        };
      }
      throw error;
    }
  });

  router.get('/events/:id', (ctx) => {
    const event = loadEvent(ctx);
    const { summary } = eventWithSummary(ctx, event);
    return eventOverviewPage({
      user: ctx.user,
      event,
      summary,
      selfUrl: selfUrl(ctx, event),
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
    });
  });

  router.get('/events/:id/edit', (ctx) => {
    const event = loadEvent(ctx);
    requireAdmin(ctx);
    return eventFormPage({ user: ctx.user, event, csrfToken: ctx.session.csrf });
  });

  router.post('/events/:id/edit', (ctx) => {
    const event = loadEvent(ctx);
    requireAdmin(ctx);
    try {
      const data = parseEventInput(ctx.fields);
      updateEvent(ctx.db, event.id, data);
      throw new Redirect(`/events/${event.id}?msg=saved`);
    } catch (error) {
      if (error instanceof Redirect) throw error;
      if (error instanceof HttpError) {
        return {
          html: eventFormPage({
            user: ctx.user,
            event,
            values: valuesFromFields(ctx.fields),
            error: error.message,
            csrfToken: ctx.session.csrf,
          }),
          status: 400,
        };
      }
      throw error;
    }
  });

  router.post('/events/:id/delete', (ctx) => {
    const event = loadEvent(ctx);
    requireAdmin(ctx);
    deleteEvent(ctx.db, event.id);
    throw new Redirect('/?msg=deleted');
  });

  router.post('/events/:id/status', (ctx) => {
    const event = loadEvent(ctx);
    requireUser(ctx);
    const status = String(ctx.fields.status || '');
    if (!STATUS_LABELS[status]) throw new HttpError(400, '狀態不正確');
    setEventStatus(ctx.db, event.id, status);
    backWith(ctx.res, `/events/${event.id}`, 'msg', 'saved');
  });

  router.get('/events/:id/qr', (ctx) => {
    const event = loadEvent(ctx);
    return qrPage({ user: ctx.user, event, selfUrl: selfUrl(ctx, event), csrfToken: ctx.session.csrf });
  });

  router.post('/events/:id/qr/regenerate', (ctx) => {
    const event = loadEvent(ctx);
    requireAdmin(ctx);
    regeneratePublicToken(ctx.db, event.id);
    throw new Redirect(`/events/${event.id}/qr?msg=token`);
  });

  void getEvent;
}
