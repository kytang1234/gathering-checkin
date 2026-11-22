import { html, raw } from '../lib/html.mjs';
import { page, csrf } from './ui.mjs';
import { isValidTimezone, statusLabel } from '../lib/rules.mjs';

const COMMON_ZONES = [
  'Asia/Hong_Kong',
  'Asia/Macau',
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Europe/London',
  'America/New_York',
  'UTC',
];

function zoneOptions(current) {
  const zones = [...COMMON_ZONES];
  if (current && !zones.includes(current)) zones.unshift(current);
  return zones.map(
    (zone) => html`<option value="${zone}" ${zone === current ? raw('selected') : ''}>${zone}</option>`,
  );
}

function dollars(cents) {
  const value = Number(cents || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function eventFormPage({ user, event = null, values = null, error = '', csrfToken = '' }) {
  const v = values || {
    name: event?.name || '',
    event_date: event?.event_date || '',
    start_time: event?.start_time || '19:00',
    end_time: event?.end_time || '',
    location: event?.location || '',
    notes: event?.notes || '',
    internal_notes: event?.internal_notes || '',
    status: event?.status || 'draft',
    timezone: event?.timezone || 'Asia/Hong_Kong',
    capacity: event?.capacity ?? '',
    fee_amount: event ? dollars(event.fee_amount) : '',
    fee_note: event?.fee_note || '',
    contact_name: event?.contact_name || '',
    contact_phone: event?.contact_phone || '',
    meal_options: event ? (JSON.parse(event.meal_options || '[]') || []).join('、') : '',
    registration_deadline: event?.registration_deadline || '',
    late_after_minutes: event?.late_after_minutes ?? 15,
    allow_self_checkin: event ? Boolean(event.allow_self_checkin) : true,
    allow_self_checkout: event ? Boolean(event.allow_self_checkout) : false,
  };

  const isEdit = Boolean(event);

  return page({
    title: isEdit ? '編輯聚會' : '新增聚會',
    user,
    active: isEdit ? '' : '/events/new',
    csrfToken,
    body: html`
      <div class="page-head">
        <div>
          <h1 class="h1">${isEdit ? '編輯聚會' : '新增聚會'}</h1>
          <p class="muted">日期時間會按你選的時區原樣顯示，不會被時區換算改掉。</p>
        </div>
        ${isEdit ? html`<a class="btn btn-ghost" href="/events/${event.id}">返回</a>` : ''}
      </div>

      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}

      <form method="post" action="${isEdit ? `/events/${event.id}/edit` : '/events'}" class="card stack form-grid">
        ${csrf(csrfToken)}

        <label class="field span-2">
          <span>聚會名稱 <em>必填</em></span>
          <input name="name" value="${v.name}" maxlength="80" required placeholder="例：年終聚餐" autofocus>
        </label>

        <label class="field">
          <span>日期 <em>必填</em></span>
          <input name="event_date" type="date" value="${v.event_date}" required>
        </label>

        <div class="field">
          <span>時間 <em>必填</em></span>
          <div class="inline">
            <input name="start_time" type="time" value="${v.start_time}" required aria-label="開始時間">
            <span class="muted">至</span>
            <input name="end_time" type="time" value="${v.end_time}" aria-label="結束時間（可留空）">
          </div>
        </div>

        <label class="field span-2">
          <span>地點</span>
          <input name="location" value="${v.location}" maxlength="120" placeholder="例：銅鑼灣 ABC 酒家 2 樓">
        </label>

        <label class="field span-2">
          <span>備註 <em>會顯示在自助簽到頁</em></span>
          <textarea name="notes" rows="2" maxlength="2000" placeholder="例：19:00 入席，請提早 15 分鐘到場">${v.notes}</textarea>
        </label>

        <label class="field span-2">
          <span>內部備註 <em>只有工作人員看到</em></span>
          <textarea name="internal_notes" rows="2" maxlength="2000" placeholder="例：記得帶抽獎箱">${v.internal_notes}</textarea>
        </label>

        <label class="field">
          <span>名額上限</span>
          <input name="capacity" type="number" min="1" max="100000" value="${v.capacity}" placeholder="留空＝不限">
        </label>

        <label class="field">
          <span>每人費用（HK$）</span>
          <input name="fee_amount" inputmode="decimal" value="${v.fee_amount}" placeholder="0">
        </label>

        <label class="field">
          <span>費用備註</span>
          <input name="fee_note" value="${v.fee_note}" maxlength="120" placeholder="例：現場繳費，可 PayMe">
        </label>

        <label class="field">
          <span>遲到寬限（分鐘）</span>
          <input name="late_after_minutes" type="number" min="0" max="240" value="${v.late_after_minutes}">
        </label>

        <label class="field">
          <span>聯絡人</span>
          <input name="contact_name" value="${v.contact_name}" maxlength="60">
        </label>

        <label class="field">
          <span>聯絡電話</span>
          <input name="contact_phone" inputmode="tel" value="${v.contact_phone}" maxlength="30">
        </label>

        <label class="field">
          <span>餐飲選項</span>
          <input name="meal_options" value="${v.meal_options}" maxlength="120" placeholder="例：葷、素（用逗號分隔）">
        </label>

        <label class="field">
          <span>報名截止</span>
          <input name="registration_deadline" type="datetime-local" value="${v.registration_deadline}">
          <small class="muted">留空＝不設截止。過了截止時間，自助頁只接受已報名者簽到。</small>
        </label>

        <label class="field">
          <span>時區</span>
          <select name="timezone">${zoneOptions(v.timezone)}</select>
        </label>

        <label class="field">
          <span>狀態</span>
          <select name="status">
            ${['draft', 'open', 'closed'].map(
              (status) => html`<option value="${status}" ${v.status === status ? raw('selected') : ''}>${statusLabel(status)}</option>`,
            )}
          </select>
        </label>

        <div class="field span-2">
          <span>自助簽到</span>
          <label class="check">
            <input type="checkbox" name="allow_self_checkin" value="1" ${v.allow_self_checkin ? raw('checked') : ''}>
            <span>讓參加者掃聚會 QR 自己按簽到</span>
          </label>
          <label class="check">
            <input type="checkbox" name="allow_self_checkout" value="1" ${v.allow_self_checkout ? raw('checked') : ''}>
            <span>讓參加者自己按簽退（需驗電話後 4 碼）</span>
          </label>
        </div>

        <div class="span-2 form-actions">
          <button class="btn btn-primary" type="submit">${isEdit ? '儲存變更' : '建立聚會'}</button>
          <a class="btn btn-ghost" href="${isEdit ? `/events/${event.id}` : '/'}">取消</a>
          ${isEdit
            ? html`<button class="btn btn-danger btn-ghost" type="submit" formaction="/events/${event.id}/delete"
                     data-confirm="確定要刪除「${event.name}」？名單與所有簽到記錄會一併刪除，無法復原。">刪除聚會</button>`
            : ''}
        </div>
      </form>
    `,
  });
}

export function isSupportedTimezone(zone) {
  return isValidTimezone(zone);
}
