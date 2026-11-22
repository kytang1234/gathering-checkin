import { html } from '../lib/html.mjs';
import { page, csrf, stat } from './ui.mjs';
import { formatDateTime } from '../lib/time.mjs';
import { methodLabel, maskPhone } from '../lib/rules.mjs';

function resultRow(row, event, csrfToken) {
  const signed = Boolean(row.checked_in_at);
  return html`<tr>
    <td data-label="姓名">
      <strong>${row.name}</strong>
      ${row.group_name ? html`<span class="muted small">${row.group_name}</span>` : ''}
    </td>
    <td data-label="電話">${row.phone ? maskPhone(row.phone) : html`<span class="muted">—</span>`}</td>
    <td data-label="狀態">
      ${signed
        ? html`<span class="badge badge-ok">${formatDateTime(row.checked_in_at, event.timezone)}</span>
            ${row.checked_out_at ? html`<span class="badge badge-quiet">已簽退</span>` : ''}`
        : html`<span class="badge badge-quiet">未到</span>`}
    </td>
    <td data-label="操作" class="col-actions">
      ${signed
        ? html`<form method="post" action="/events/${event.id}/checkin/${row.attendee_id}/undo" class="inline-form"
                 data-confirm="撤銷「${row.name}」的簽到？">
            ${csrf(csrfToken)}
            <button class="btn btn-sm btn-ghost btn-danger" type="submit">撤銷</button>
          </form>`
        : html`<form method="post" action="/events/${event.id}/checkin" class="inline-form">
            ${csrf(csrfToken)}
            <input type="hidden" name="attendee_id" value="${row.attendee_id}">
            <button class="btn btn-sm btn-primary" type="submit">簽到</button>
          </form>`}
    </td>
  </tr>`;
}

export function checkinPage({ user, event, summary, results, query, flash, csrfToken, recent, mealOptions }) {
  const open = event.status === 'open';
  return page({
    title: `現場簽到 · ${event.name}`,
    user,
    flash,
    csrfToken,
    wide: true,
    scripts: ['/scan.js'],
    body: html`
      <div class="page-head">
        <div>
          <p class="crumb"><a href="/">聚會</a> / <a href="/events/${event.id}">${event.name}</a> / 現場簽到</p>
          <h1 class="h1">現場簽到</h1>
          <p class="muted">${event.name} · 已簽到 ${summary.presentCount} / ${summary.total} 人</p>
        </div>
        <div class="head-actions">
          <a class="btn btn-ghost btn-sm" href="/events/${event.id}/roster">名單</a>
          <a class="btn btn-ghost btn-sm" href="/events/${event.id}/summary">總結</a>
        </div>
      </div>

      ${!open
        ? html`<div class="flash flash-err">這個聚會目前狀態是「${event.status === 'closed' ? '已結束' : '草稿'}」，
            不能簽到。請先回總覽按「開放簽到」。</div>`
        : ''}

      <section class="card scan-card" data-scan-root data-event-id="${event.id}" data-csrf="${csrfToken}">
        <div class="scan-head">
          <div>
            <h2 class="h2">掃個人 QR</h2>
            <p class="muted">對準參加者卡片上的 QR code。</p>
          </div>
          <button class="btn btn-primary" type="button" data-scan-start ${open ? '' : 'disabled'}>開啟鏡頭</button>
        </div>

        <div class="scanner" data-scanner hidden>
          <video data-scan-video playsinline muted></video>
          <div class="scanner-frame" aria-hidden="true"></div>
          <p class="scanner-status" data-scan-status>正在啟動鏡頭…</p>
          <button class="btn btn-sm" type="button" data-scan-stop>停止</button>
        </div>

        <div class="scan-result" data-scan-result hidden></div>

        <form class="manual-code" method="post" action="/events/${event.id}/checkin-by-code" data-manual-form>
          ${csrf(csrfToken)}
          <label class="field">
            <span>掃不到？輸入卡上的 8 碼短碼</span>
            <div class="inline">
              <input name="code" maxlength="12" placeholder="例：AB12CD34" autocapitalize="characters" spellcheck="false">
              <button class="btn" type="submit">簽到</button>
            </div>
          </label>
        </form>
      </section>

      <section class="card">
        <form method="get" action="/events/${event.id}/checkin" class="searchbar">
          <input name="q" value="${query}" placeholder="搜尋姓名或電話，按 Enter 簽到" aria-label="搜尋名單" autocomplete="off">
          <button class="btn" type="submit">搜尋</button>
          ${query ? html`<a class="btn btn-ghost btn-sm" href="/events/${event.id}/checkin">清除</a>` : ''}
        </form>

        ${results.length === 0
          ? html`<p class="muted">${query ? '找不到符合的人。' : '上面輸入姓名就會列出名單；或是用下面的「臨時新增」。'}</p>`
          : html`<table class="table">
              <thead><tr><th>姓名</th><th>電話</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>${results.map((row) => resultRow(row, event, csrfToken))}</tbody>
            </table>`}
      </section>

      <div class="split">
        <section class="card">
          <h2 class="h2">臨時新增（沒在名單上的朋友）</h2>
          <form method="post" action="/events/${event.id}/checkin/add" class="stack">
            ${csrf(csrfToken)}
            <label class="field"><span>姓名 <em>必填</em></span><input name="name" required maxlength="80"></label>
            <label class="field"><span>電話</span><input name="phone" inputmode="tel" maxlength="30"></label>
            <label class="field"><span>餐飲</span>
              <select name="meal_choice">
                <option value="">未填</option>
                ${mealOptions.map((option) => html`<option value="${option}">${option}</option>`)}
              </select>
            </label>
            <button class="btn btn-primary" type="submit">新增並簽到</button>
          </form>
        </section>

        <section class="card">
          <h2 class="h2">最近簽到</h2>
          ${recent.length === 0
            ? html`<p class="muted">還沒有人簽到。</p>`
            : html`<ul class="timeline">
                ${recent.map(
                  (row) => html`<li>
                    <span class="timeline-time">${formatDateTime(row.checked_in_at, event.timezone).slice(11)}</span>
                    <span class="timeline-name">${row.name}</span>
                    <span class="badge badge-quiet">${methodLabel(row.method)}</span>
                    ${Number(row.is_late) === 1 ? html`<span class="badge badge-warn">遲到</span>` : ''}
                  </li>`,
                )}
              </ul>`}
        </section>
      </div>

      <div class="stat-grid compact-stats">
        ${stat('已簽到', summary.presentCount)}
        ${stat('未到', summary.absentCount)}
        ${stat('遲到', summary.lateCount)}
        ${stat('已簽退', summary.leftCount)}
      </div>
    `,
  });
}
