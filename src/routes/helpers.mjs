import { requireUser } from '../lib/auth.mjs';
import { getEvent, listRoster } from '../lib/store.mjs';
import { HttpError, Redirect, safeNext } from '../lib/http.mjs';
import { summarize } from '../lib/reports.mjs';

export function loadEvent(ctx) {
  requireUser(ctx);
  const event = getEvent(ctx.db, ctx.params.id);
  if (!event) throw new HttpError(404, '找不到這個聚會');
  return event;
}

export function eventWithSummary(ctx, event) {
  const roster = listRoster(ctx.db, event.id);
  return { roster, summary: summarize(event, roster) };
}

/** 帶提示訊息導向（msg=成功、err=失敗、note=自訂句子）。 */
export function backWith(res, path, kind = 'msg', code = 'saved', note = '') {
  const url = new URL(path, 'http://local');
  if (kind === 'err') url.searchParams.set('err', code);
  else url.searchParams.set('msg', code);
  if (note) url.searchParams.set('note', String(note).slice(0, 120));
  throw new Redirect(url.pathname + url.search);
}

export function backField(ctx, fallback) {
  return safeNext(ctx.fields?.back, fallback);
}
