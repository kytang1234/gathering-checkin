import { requireAdmin, requireUser } from '../lib/auth.mjs';
import { HttpError, sendBytes } from '../lib/http.mjs';
import { toCsv } from '../lib/csv.mjs';
import {
  createSeries,
  deleteSeries,
  getSeries,
  listEventsBySeries,
  listRoster,
  listSeries,
  updateSeries,
} from '../lib/store.mjs';
import { buildSeriesStats, seriesEventsCsv, seriesMembersCsv, seriesMatrixCsv } from '../lib/series.mjs';
import { memberPage, seriesFormPage, seriesListPage, seriesPage } from '../views/series.mjs';
import { flashFrom } from '../views/ui.mjs';
import { backWith } from './helpers.mjs';

function loadSeries(ctx) {
  requireUser(ctx);
  const series = getSeries(ctx.db, ctx.params.id);
  if (!series) throw new HttpError(404, '找不到這個系列');
  return series;
}

function statsFor(db, series, includeOpen) {
  const events = listEventsBySeries(db, series.id);
  const rosterByEvent = new Map(events.map((event) => [event.id, listRoster(db, event.id)]));
  return buildSeriesStats({ series, events, rosterByEvent, includeOpen });
}

function contentDisposition(filename) {
  return `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function safeName(value) {
  return String(value || '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 50);
}

function sendCsv(ctx, filename, rows) {
  sendBytes(ctx.res, Buffer.from(toCsv(rows), 'utf8'), 'text/csv; charset=utf-8', 200, {
    'Content-Disposition': contentDisposition(filename),
  });
}

export function registerSeriesRoutes(router) {
  router.get('/series', (ctx) => {
    requireUser(ctx);
    return seriesListPage({
      user: ctx.user,
      series: listSeries(ctx.db),
      flash: flashFrom(ctx.query),
    });
  });

  router.get('/series/new', (ctx) => {
    requireAdmin(ctx);
    return seriesFormPage({ user: ctx.user, csrfToken: ctx.session.csrf });
  });

  router.post('/series', (ctx) => {
    requireAdmin(ctx);
    const name = String(ctx.fields.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, '系列名稱不能空白');
    const series = createSeries(ctx.db, { name, notes: String(ctx.fields.notes || '').trim() || null });
    backWith(ctx.res, `/series/${series.id}`, 'msg', 'created');
  });

  router.get('/series/:id', (ctx) => {
    const series = loadSeries(ctx);
    const includeOpen = ctx.query.get('include') === 'open';
    const sort = String(ctx.query.get('sort') || 'name');
    const stats = statsFor(ctx.db, series, includeOpen);
    return seriesPage({
      user: ctx.user,
      series,
      stats,
      includeOpen,
      sort,
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
    });
  });

  router.get('/series/:id/edit', (ctx) => {
    const series = loadSeries(ctx);
    requireAdmin(ctx);
    return seriesFormPage({ user: ctx.user, series, csrfToken: ctx.session.csrf });
  });

  router.post('/series/:id/edit', (ctx) => {
    const series = loadSeries(ctx);
    requireAdmin(ctx);
    const name = String(ctx.fields.name || '').trim().slice(0, 80);
    if (!name) {
      return {
        html: seriesFormPage({
          user: ctx.user,
          series,
          csrfToken: ctx.session.csrf,
          error: '系列名稱不能空白',
        }),
        status: 400,
      };
    }
    updateSeries(ctx.db, series.id, { name, notes: String(ctx.fields.notes || '').trim() || null });
    backWith(ctx.res, `/series/${series.id}`, 'msg', 'saved');
  });

  router.post('/series/:id/delete', (ctx) => {
    const series = loadSeries(ctx);
    requireAdmin(ctx);
    const deleteEvents = String(ctx.fields.mode || 'tag') === 'all';
    deleteSeries(ctx.db, series.id, { deleteEvents });
    backWith(ctx.res, '/series', 'msg', 'deleted', deleteEvents ? '系列與聚會已刪除' : '系列已刪除，聚會保留');
  });

  router.get('/series/:id/member/:attendeeId', (ctx) => {
    const series = loadSeries(ctx);
    const stats = statsFor(ctx.db, series, false);
    const member = stats.members.find((row) => row.attendee_id === ctx.params.attendeeId);
    if (!member) throw new HttpError(404, '這個人不在系列名單內');
    return memberPage({ user: ctx.user, series, member, stats });
  });

  router.get('/series/:id/events.csv', (ctx) => {
    const series = loadSeries(ctx);
    const stats = statsFor(ctx.db, series, false);
    sendCsv(ctx, `${safeName(series.name)}-場次.csv`, seriesEventsCsv(stats));
  });

  router.get('/series/:id/members.csv', (ctx) => {
    const series = loadSeries(ctx);
    const stats = statsFor(ctx.db, series, false);
    sendCsv(ctx, `${safeName(series.name)}-成員.csv`, seriesMembersCsv(stats));
  });

  router.get('/series/:id/matrix.csv', (ctx) => {
    const series = loadSeries(ctx);
    const stats = statsFor(ctx.db, series, false);
    sendCsv(ctx, `${safeName(series.name)}-出席矩陣.csv`, seriesMatrixCsv(stats));
  });
}
