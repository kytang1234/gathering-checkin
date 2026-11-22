import { html, raw } from '../lib/html.mjs';
import { page, stat, statusBadge, whenText, csrf, money } from './ui.mjs';
import { methodLabel } from '../lib/rules.mjs';
import { formatDateTime } from '../lib/time.mjs';

export function eventOverviewPage({ user, event, summary, selfUrl, flash, csrfToken }) {
  const isOpen = event.status === 'open';
  return page({
    title: event.name,
    user,
    flash,
    csrfToken,
    body: html`
      <div class="page-head">
        <div>
          <p class="crumb"><a href="/">聚會</a> / ${event.name}</p>
          <h1 class="h1">${event.name} ${statusBadge(event.status)}</h1>
          <p class="muted">${whenText(event)}${event.location ? ` · ${event.location}` : ''}</p>
        </div>
        <div class="head-actions">
          ${user.role === 'admin' ? html`<a class="btn btn-ghost" href="/events/${event.id}/edit">編輯</a>` : ''}
          <a class="btn btn-primary" href="/events/${event.id}/checkin">現場簽到</a>
        </div>
      </div>

      <div class="stat-grid">
        ${stat('名單', `${summary.total} 人`)}
        ${stat('已簽到', `${summary.presentCount} 人`, `出席率 ${summary.rate}%`)}
        ${stat('未到', `${summary.absentCount} 人`)}
        ${stat('遲到', `${summary.lateCount} 人`, `準時 ${summary.onTimeCount} 人`)}
        ${stat('已簽退', `${summary.leftCount} 人`, summary.avgStayText === '—' ? '未有簽退' : `平均停留 ${summary.avgStayText}`)}
        ${event.fee_amount > 0
          ? stat('費用', `${money(summary.collectedFee)}／${money(summary.expectedFee)}`, `${money(event.fee_amount)}/人 · 未繳 ${summary.unpaidCount} 人`)
          : stat('費用', '免費')}
      </div>

      <div class="quick-grid">
        <a class="quick" href="/events/${event.id}/qr">
          <span class="quick-icon" aria-hidden="true">▣</span>
          <span class="quick-title">顯示 QR code</span>
          <span class="quick-desc">投影或列印，貼在入口給大家掃</span>
        </a>
        <a class="quick" href="/events/${event.id}/roster">
          <span class="quick-icon" aria-hidden="true">☷</span>
          <span class="quick-title">名單管理</span>
          <span class="quick-desc">匯入、加人、桌號、餐飲、繳費</span>
        </a>
        <a class="quick" href="/events/${event.id}/checkin">
          <span class="quick-icon" aria-hidden="true">✓</span>
          <span class="quick-title">現場簽到</span>
          <span class="quick-desc">掃個人 QR 或搜尋名字</span>
        </a>
        <a class="quick" href="/events/${event.id}/summary">
          <span class="quick-icon" aria-hidden="true">≡</span>
          <span class="quick-title">總結</span>
          <span class="quick-desc">出席名單、匯出 Excel</span>
        </a>
      </div>

      <section class="card">
        <h2 class="h2">自助簽到連結</h2>
        <p class="muted">參加者用手機開這條連結，就可以自己按簽到。QR code 的內容就是它。</p>
        <div class="copybox">
          <input class="copy-target" value="${selfUrl}" readonly aria-label="自助簽到連結">
          <button class="btn btn-sm" type="button" data-copy>複製</button>
          <a class="btn btn-sm btn-ghost" href="${selfUrl}" target="_blank" rel="noreferrer">開啟</a>
        </div>
        ${!event.allow_self_checkin
          ? html`<p class="hint">此聚會已關閉自助簽到，連結只會顯示聚會資料。</p>`
          : ''}
      </section>

      <section class="card">
        <h2 class="h2">狀態</h2>
        <form method="post" action="/events/${event.id}/status" class="inline-form">
          ${csrf(csrfToken)}
          <button class="btn btn-sm ${isOpen ? '' : 'btn-primary'}" name="status" value="open" type="submit">開放簽到</button>
          <button class="btn btn-sm ${event.status === 'closed' ? '' : 'btn-ghost'}" name="status" value="closed" type="submit">結束聚會</button>
          <button class="btn btn-sm btn-ghost" name="status" value="draft" type="submit">改回草稿</button>
        </form>
        <p class="hint">結束後工作人員不能再簽到；要補簽就先改回「開放簽到」。</p>
      </section>

      ${event.internal_notes
        ? html`<section class="card note-internal">
            <h2 class="h2">內部備註</h2>
            <p class="pre">${event.internal_notes}</p>
          </section>`
        : ''}

      ${summary.present.length > 0
        ? html`<section class="card">
            <h2 class="h2">最近簽到</h2>
            <table class="table compact">
              <thead><tr><th>姓名</th><th>時間</th><th>方式</th><th>狀態</th></tr></thead>
              <tbody>
                ${summary.present
                  .slice()
                  .sort((a, b) => String(b.checked_in_at).localeCompare(String(a.checked_in_at)))
                  .slice(0, 6)
                  .map(
                    (row) => html`<tr>
                      <td data-label="姓名">${row.name}</td>
                      <td data-label="時間">${formatDateTime(row.checked_in_at, event.timezone)}</td>
                      <td data-label="方式">${methodLabel(row.method)}</td>
                      <td data-label="狀態">${Number(row.is_late) === 1
                        ? html`<span class="badge badge-warn">遲到 ${row.late_minutes} 分</span>`
                        : html`<span class="badge badge-ok">準時</span>`}</td>
                    </tr>`,
                  )}
              </tbody>
            </table>
          </section>`
        : ''}
    `,
  });
}
