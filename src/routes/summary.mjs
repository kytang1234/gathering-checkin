import { requireUser } from '../lib/auth.mjs';
import { sendBytes } from '../lib/http.mjs';
import { toCsv } from '../lib/csv.mjs';
import { buildSummaryWorkbook } from '../lib/xlsx.mjs';
import { summarize, csvRows } from '../lib/reports.mjs';
import { formatDateTime } from '../lib/time.mjs';
import { listRoster } from '../lib/store.mjs';
import { summaryPage } from '../views/summary.mjs';
import { flashFrom } from '../views/ui.mjs';
import { loadEvent } from './helpers.mjs';

function fileSafe(value) {
  return String(value || '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60);
}

function contentDisposition(filename) {
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="export"; filename*=UTF-8''${encoded}`;
}

export function registerSummaryRoutes(router) {
  router.get('/events/:id/summary', (ctx) => {
    const event = loadEvent(ctx);
    const roster = listRoster(ctx.db, event.id);
    return summaryPage({
      user: ctx.user,
      event,
      summary: summarize(event, roster),
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
    });
  });

  router.get('/events/:id/summary.csv', (ctx) => {
    const event = loadEvent(ctx);
    const roster = listRoster(ctx.db, event.id);
    const summary = summarize(event, roster);
    const rows = csvRows(event, summary, (iso) => formatDateTime(iso, event.timezone));
    const csv = toCsv(rows);
    sendBytes(
      ctx.res,
      Buffer.from(csv, 'utf8'),
      'text/csv; charset=utf-8',
      200,
      { 'Content-Disposition': contentDisposition(`${fileSafe(event.name)}-${event.event_date}-出席名單.csv`) },
    );
  });

  router.get('/events/:id/summary.xlsx', async (ctx) => {
    const event = loadEvent(ctx);
    const roster = listRoster(ctx.db, event.id);
    const summary = summarize(event, roster);
    const buffer = await buildSummaryWorkbook({ event, summary });
    sendBytes(
      ctx.res,
      Buffer.from(buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      200,
      { 'Content-Disposition': contentDisposition(`${fileSafe(event.name)}-${event.event_date}-出席總結.xlsx`) },
    );
  });

  void requireUser;
}
