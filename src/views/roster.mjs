import { html, raw } from '../lib/html.mjs';
import { page, csrf, statusBadge, empty, money, whenText } from './ui.mjs';
import { formatDateTime, weekdayLabel } from '../lib/time.mjs';
import { methodLabel, maskPhone } from '../lib/rules.mjs';

function mealSelect(name, options, current) {
  return html`<select name="${name}">
    <option value="">未填</option>
    ${options.map(
      (option) => html`<option value="${option}" ${option === current ? raw('selected') : ''}>${option}</option>`,
    )}
  </select>`;
}

function checkinCell(row, tz) {
  if (!row.checked_in_at) return html`<span class="badge badge-quiet">未到</span>`;
  return html`<span class="badge badge-ok">${formatDateTime(row.checked_in_at, tz)}</span>
    ${row.checked_out_at ? html`<span class="badge badge-quiet">已簽退 ${formatDateTime(row.checked_out_at, tz)}</span>` : ''}`;
}

export function rosterPage({ user, event, roster, filtered, query, flash, csrfToken, mealOptions }) {
  const present = roster.filter((r) => r.checked_in_at).length;
  return page({
    title: `${event.name} 名單`,
    user,
    flash,
    csrfToken,
    wide: true,
    body: html`
      <div class="page-head">
        <div>
          <p class="crumb"><a href="/">聚會</a> / <a href="/events/${event.id}">${event.name}</a> / 名單</p>
          <h1 class="h1">名單管理</h1>
          <p class="muted">共 ${roster.length} 人 · 已簽到 ${present} 人 · ${whenText(event)}</p>
        </div>
        <div class="head-actions">
          <a class="btn btn-ghost btn-sm" href="/events/${event.id}/roster/import">匯入 CSV</a>
          <a class="btn btn-ghost btn-sm" href="/events/${event.id}/roster/cards">列印個人 QR</a>
          <a class="btn btn-sm" href="/events/${event.id}/checkin">去簽到</a>
        </div>
      </div>

      <section class="card">
        <form method="get" action="/events/${event.id}/roster" class="searchbar">
          <input name="q" value="${query}" placeholder="搜尋姓名、電話或組別" aria-label="搜尋名單">
          <button class="btn" type="submit">搜尋</button>
          ${query ? html`<a class="btn btn-ghost btn-sm" href="/events/${event.id}/roster">清除</a>` : ''}
        </form>

        <details class="addbox">
          <summary>＋ 加入一個人</summary>
          <form method="post" action="/events/${event.id}/roster/add" class="form-grid">
            ${csrf(csrfToken)}
            <label class="field"><span>姓名 <em>必填</em></span><input name="name" required maxlength="80"></label>
            <label class="field"><span>電話</span><input name="phone" inputmode="tel" maxlength="30"></label>
            <label class="field"><span>組別</span><input name="group_name" maxlength="60"></label>
            <label class="field"><span>桌號</span><input name="seat_no" maxlength="30"></label>
            <label class="field"><span>餐飲</span>${mealSelect('meal_choice', mealOptions, '')}</label>
            <label class="field"><span>備註</span><input name="note" maxlength="200"></label>
            <div class="span-2">
              <button class="btn btn-primary" type="submit">加入名單</button>
              <span class="hint">電話相同會接上舊有記錄，不會重複建立。</span>
            </div>
          </form>
        </details>

        ${roster.length === 0
          ? empty('名單還是空的。可以逐個加入，或匯入 CSV。')
          : filtered.length === 0
            ? empty('找不到符合的人。')
            : html`<table class="table roster-table">
                <thead>
                  <tr>
                    <th>姓名</th><th>電話</th><th>桌號</th><th>餐飲</th>
                    <th>繳費</th><th>簽到</th><th class="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map(
                    (row) => html`<tr>
                      <td data-label="姓名">
                        <a href="/events/${event.id}/roster/${row.attendee_id}"><strong>${row.name}</strong></a>
                        ${row.group_name ? html`<span class="muted small">${row.group_name}</span>` : ''}
                      </td>
                      <td data-label="電話">${row.phone || html`<span class="muted">—</span>`}</td>
                      <td data-label="桌號">${row.seat_no || html`<span class="muted">—</span>`}</td>
                      <td data-label="餐飲">${row.meal_choice || html`<span class="muted">—</span>`}</td>
                      <td data-label="繳費">
                        <form method="post" action="/events/${event.id}/roster/${row.attendee_id}/paid">
                          ${csrf(csrfToken)}
                          <input type="hidden" name="paid" value="${Number(row.fee_paid) === 1 ? '0' : '1'}">
                          <button class="chip ${Number(row.fee_paid) === 1 ? 'chip-ok' : ''}" type="submit">
                            ${Number(row.fee_paid) === 1 ? '已繳' : '未繳'}
                          </button>
                        </form>
                      </td>
                      <td data-label="簽到">${checkinCell(row, event.timezone)}</td>
                      <td data-label="操作" class="col-actions">
                        <a class="btn btn-sm btn-ghost" href="/events/${event.id}/roster/${row.attendee_id}">編輯</a>
                        <form method="post" action="/events/${event.id}/roster/${row.attendee_id}/remove" class="inline-form"
                              data-confirm="從名單移除「${row.name}」？他的簽到記錄也會刪除。">
                          ${csrf(csrfToken)}
                          <button class="btn btn-sm btn-danger btn-ghost" type="submit">移除</button>
                        </form>
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table>`}
      </section>
      <p class="hint">按一下「已繳／未繳」可以切換；匯入或新增的人員資料會存進全域人名庫，下場聚會可以直接搜尋。</p>
    `,
  });
}

export function rosterEditPage({ user, event, row, error, csrfToken, mealOptions, personalQrUrl, shortCode }) {
  return page({
    title: `${row.name} · 名單`,
    user,
    csrfToken,
    body: html`
      <p class="crumb"><a href="/">聚會</a> / <a href="/events/${event.id}">${event.name}</a> /
        <a href="/events/${event.id}/roster">名單</a> / ${row.name}</p>
      <div class="page-head">
        <h1 class="h1">${row.name}</h1>
        <div class="head-actions">
          <a class="btn btn-ghost" href="/events/${event.id}/roster">返回名單</a>
        </div>
      </div>

      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}

      <div class="split">
        <form method="post" action="/events/${event.id}/roster/${row.attendee_id}" class="card stack">
          ${csrf(csrfToken)}
          <h2 class="h2">基本資料</h2>
          <label class="field"><span>姓名 <em>必填</em></span><input name="name" value="${row.name}" required maxlength="80"></label>
          <label class="field"><span>電話</span><input name="phone" value="${row.phone || ''}" inputmode="tel" maxlength="30"></label>
          <label class="field"><span>組別</span><input name="group_name" value="${row.group_name || ''}" maxlength="60"></label>
          <label class="field"><span>個人備註</span><textarea name="person_notes" rows="2" maxlength="500">${row.person_notes || ''}</textarea></label>

          <h2 class="h2">這場聚會</h2>
          <label class="field"><span>桌號</span><input name="seat_no" value="${row.seat_no || ''}" maxlength="30"></label>
          <label class="field"><span>餐飲</span>${mealSelect('meal_choice', mealOptions, row.meal_choice || '')}</label>
          <label class="check">
            <input type="checkbox" name="fee_paid" value="1" ${Number(row.fee_paid) === 1 ? raw('checked') : ''}>
            <span>已繳費（${money(event.fee_amount)}）</span>
          </label>
          <label class="field"><span>本場備註</span><input name="note" value="${row.roster_note || ''}" maxlength="200"></label>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">儲存</button>
          </div>
        </form>

        <div class="stack">
          <section class="card">
            <h2 class="h2">個人 QR</h2>
            <p class="muted">工作人員用「現場簽到」的鏡頭掃這張卡，就會直接完成簽到。</p>
            <div class="personal-qr">
              <img src="${personalQrUrl}" alt="${row.name} 的個人 QR" width="220" height="220">
              <div class="personal-qr-meta">
                <p class="strong">${row.name}</p>
                <p class="muted small">${row.group_name || '—'} · ${maskPhone(row.phone) || '無電話'}</p>
                <p class="muted small">短碼：<code>${shortCode}</code></p>
              </div>
            </div>
            <a class="btn btn-sm" href="/api/qr/attendee/${row.attendee_id}?size=1024&download=1" download>下載 PNG</a>
          </section>

          <section class="card">
            <h2 class="h2">簽到狀況</h2>
            ${row.checked_in_at
              ? html`<p>簽到：<strong>${formatDateTime(row.checked_in_at, event.timezone)}</strong>（${methodLabel(row.method)}）</p>
                  ${row.checked_out_at ? html`<p>簽退：<strong>${formatDateTime(row.checked_out_at, event.timezone)}</strong></p>` : ''}
                  <form method="post" action="/events/${event.id}/checkin/${row.attendee_id}/undo" class="inline-form"
                        data-confirm="撤銷「${row.name}」的簽到？">
                    ${csrf(csrfToken)}
                    <button class="btn btn-sm btn-danger btn-ghost" type="submit">撤銷簽到</button>
                  </form>`
              : html`<p class="muted">未簽到。</p>
                  <form method="post" action="/events/${event.id}/checkin" class="inline-form">
                    ${csrf(csrfToken)}
                    <input type="hidden" name="attendee_id" value="${row.attendee_id}">
                    <input type="hidden" name="back" value="/events/${event.id}/roster/${row.attendee_id}">
                    <button class="btn btn-sm btn-primary" type="submit">替他簽到</button>
                  </form>`}
          </section>
        </div>
      </div>
    `,
  });
}

export function importPage({ user, event, error, csrfToken, preview = null, payload = '' }) {
  return page({
    title: `匯入名單 · ${event.name}`,
    user,
    csrfToken,
    body: html`
      <p class="crumb"><a href="/">聚會</a> / <a href="/events/${event.id}">${event.name}</a> /
        <a href="/events/${event.id}/roster">名單</a> / 匯入</p>
      <div class="page-head">
        <h1 class="h1">匯入 CSV</h1>
        <a class="btn btn-ghost" href="/events/${event.id}/roster">返回名單</a>
      </div>

      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}

      ${preview
        ? html`<section class="card">
            <h2 class="h2">確認匯入</h2>
            <p>可匯入 <strong>${preview.items.length}</strong> 人；
              已存在名單 <strong>${preview.existing.length}</strong> 人（會略過）；
              空白列 <strong>${preview.skipped}</strong> 行。</p>
            ${preview.existing.length > 0
              ? html`<p class="muted small">略過：${preview.existing.map((x) => x.name).join('、')}</p>`
              : ''}
            <table class="table compact">
              <thead><tr><th>姓名</th><th>電話</th><th>組別</th><th>桌號</th><th>餐飲</th></tr></thead>
              <tbody>
                ${preview.items.map(
                  (item) => html`<tr>
                    <td data-label="姓名">${item.name}</td>
                    <td data-label="電話">${item.phone || '—'}</td>
                    <td data-label="組別">${item.group_name || '—'}</td>
                    <td data-label="桌號">${item.seat_no || '—'}</td>
                    <td data-label="餐飲">${item.meal_choice || '—'}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
            <form method="post" action="/events/${event.id}/roster/import" class="form-actions">
              ${csrf(csrfToken)}
              <input type="hidden" name="payload" value="${payload}">
              <button class="btn btn-primary" type="submit" name="confirm" value="1">確定匯入 ${preview.items.length} 人</button>
              <a class="btn btn-ghost" href="/events/${event.id}/roster/import">重新貼上</a>
            </form>
          </section>`
        : html`<section class="card">
            <h2 class="h2">貼上或選擇 CSV</h2>
            <p class="muted">欄位順序：姓名、電話、組別、桌號、餐飲、備註。第一行是標題也可以，系統會自動辨識。
              用 Excel 的話，直接「另存新檔 → CSV UTF-8」。</p>
            <form method="post" action="/events/${event.id}/roster/import" class="stack">
              ${csrf(csrfToken)}
              <label class="field">
                <span>CSV 內容</span>
                <textarea name="csv" rows="12" placeholder="姓名,電話,組別&#10;陳大文,91234567,&#10;李小明,62345678,B 組"></textarea>
              </label>
              <label class="field">
                <span>或選擇檔案</span>
                <input type="file" accept=".csv,text/csv" data-csv-file>
              </label>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">預覽</button>
              </div>
            </form>
          </section>`}
    `,
  });
}

/** 列印用的個人 QR 卡：3 欄，A4。 */
export function cardsPage({ event, rows, baseTitle }) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${baseTitle}</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="cards-body">
  <div class="cards-toolbar">
    <a class="btn" href="/events/${event.id}/roster">返回名單</a>
    <button class="btn btn-primary" type="button" onclick="window.print()">列印</button>
    <span class="muted">${event.name} · ${event.event_date} · ${rows.length} 張</span>
  </div>
  <div class="cards-grid">
    ${rows.map(
      (row) => html`<article class="qr-card">
        <p class="qr-card-event">${event.name}</p>
        <img src="/api/qr/attendee/${row.attendee_id}?size=300" alt="${row.name} 的 QR" width="300" height="300">
        <p class="qr-card-name">${row.name}</p>
        <p class="qr-card-code">${row.short_code}</p>
      </article>`,
    )}
  </div>
</body>
</html>`;
}

export function rosterSummaryLine(event, roster) {
  return `${event.name}：${roster.length} 人（${weekdayLabel(event.event_date)}）${statusBadge(event.status)}`;
}
