import { html } from '../lib/html.mjs';
import { page, stat, money } from './ui.mjs';
import { formatDateTime } from '../lib/time.mjs';
import { methodLabel } from '../lib/rules.mjs';

export function summaryPage({ user, event, summary, flash, csrfToken = '' }) {
  const feeEnabled = Number(event.fee_amount) > 0;
  return page({
    title: `總結 · ${event.name}`,
    user,
    flash,
    csrfToken,
    wide: true,
    body: html`
      <div class="page-head print-hide">
        <div>
          <p class="crumb"><a href="/">聚會</a> / <a href="/events/${event.id}">${event.name}</a> / 總結</p>
          <h1 class="h1">總結</h1>
          <p class="muted">${event.name} · ${event.event_date} ${event.start_time}${event.end_time ? `–${event.end_time}` : ''}${event.location ? ` · ${event.location}` : ''}</p>
        </div>
        <div class="head-actions">
          <a class="btn btn-sm" href="/events/${event.id}/summary.csv">匯出 CSV</a>
          <a class="btn btn-sm btn-primary" href="/events/${event.id}/summary.xlsx">匯出 Excel</a>
          <button class="btn btn-sm btn-ghost" type="button" onclick="window.print()">列印</button>
        </div>
      </div>

      <div class="print-only print-head">
        <h1>${event.name} — 出席總結</h1>
        <p>${event.event_date} ${event.start_time}${event.end_time ? `–${event.end_time}` : ''}${event.location ? ` · ${event.location}` : ''}</p>
      </div>

      <div class="stat-grid">
        ${stat('名單', `${summary.total} 人`)}
        ${stat('出席', `${summary.presentCount} 人`)}
        ${stat('未出席', `${summary.absentCount} 人`)}
        ${stat('出席率', `${summary.rate}%`)}
        ${stat('遲到', `${summary.lateCount} 人`)}
        ${stat('平均停留', summary.avgStayText)}
      </div>

      <div class="split">
        <section class="card">
          <h2 class="h2">出席名單（${summary.presentCount}）</h2>
          ${summary.present.length === 0
            ? html`<p class="muted">還沒有人簽到。</p>`
            : html`<table class="table compact">
                <thead><tr><th>姓名</th><th>簽到</th><th>簽退</th><th>方式</th><th>狀態</th></tr></thead>
                <tbody>
                  ${summary.present.map(
                    (row) => html`<tr>
                      <td data-label="姓名">${row.name}${row.group_name ? html`<span class="muted small">${row.group_name}</span>` : ''}</td>
                      <td data-label="簽到">${formatDateTime(row.checked_in_at, event.timezone)}</td>
                      <td data-label="簽退">${row.checked_out_at ? formatDateTime(row.checked_out_at, event.timezone) : '—'}</td>
                      <td data-label="方式">${methodLabel(row.method)}</td>
                      <td data-label="狀態">
                        ${Number(row.is_late) === 1
                          ? html`<span class="badge badge-warn">遲到 ${row.late_minutes} 分</span>`
                          : html`<span class="badge badge-ok">準時</span>`}
                        ${Number(row.fee_paid) === 1 ? html`<span class="badge badge-quiet">已繳</span>` : ''}
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table>`}
        </section>

        <div class="stack">
          <section class="card">
            <h2 class="h2">未出席（${summary.absentCount}）</h2>
            ${summary.absent.length === 0
              ? html`<p class="muted">全員到齊。</p>`
              : html`<ul class="plain-list">
                  ${summary.absent.map(
                    (row) => html`<li>${row.name}${row.group_name ? html`<span class="muted small">${row.group_name}</span>` : ''}</li>`,
                  )}
                </ul>`}
          </section>

          ${summary.notLeftCount > 0
            ? html`<section class="card">
                <h2 class="h2">已簽到但未簽退（${summary.notLeftCount}）</h2>
                <p class="muted small">如果是活動進行中，這是正常的。</p>
                <ul class="plain-list">
                  ${summary.present
                    .filter((row) => !row.checked_out_at)
                    .map((row) => html`<li>${row.name}</li>`)}
                </ul>
              </section>`
            : ''}

          ${feeEnabled
            ? html`<section class="card">
                <h2 class="h2">費用</h2>
                <p>每人 <strong>${money(event.fee_amount)}</strong>${event.fee_note ? html`<span class="muted">（${event.fee_note}）</span>` : ''}</p>
                <p>應收 <strong>${money(summary.expectedFee)}</strong> ／ 實收 <strong>${money(summary.collectedFee)}</strong></p>
                <p class="muted">未繳 ${summary.unpaidCount} 人${summary.unpaidCount > 0 ? `：${summary.unpaid.map((r) => r.name).join('、')}` : ''}</p>
              </section>`
            : ''}

          ${summary.meals.length > 0
            ? html`<section class="card">
                <h2 class="h2">餐飲</h2>
                <ul class="plain-list">
                  ${summary.meals.map(([meal, count]) => html`<li>${meal}<span class="muted"> ${count} 人</span></li>`)}
                </ul>
              </section>`
            : ''}

          <section class="card">
            <h2 class="h2">簽到方式</h2>
            <ul class="plain-list">
              ${summary.methods.length === 0
                ? html`<li class="muted">尚無資料</li>`
                : summary.methods.map((item) => html`<li>${item.label}<span class="muted"> ${item.count} 人次</span></li>`)}
            </ul>
          </section>
        </div>
      </div>

      <p class="hint print-hide">匯出的 CSV 用 Excel 直接開不會亂碼；Excel 檔含「出席／未出席／統計」三個工作表。</p>
    `,
  });
}
