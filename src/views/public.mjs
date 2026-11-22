import { html } from '../lib/html.mjs';
import { formatDateTime, weekdayLabel } from '../lib/time.mjs';
import { formatMoney } from '../lib/rules.mjs';

function shell({ event, body, footer = '' }) {
  const weekday = weekdayLabel(event.event_date);
  const timeRange = event.end_time ? `${event.start_time}–${event.end_time}` : event.start_time;
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#2f5d50">
  <title>${event.name} · 簽到</title>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="public-body">
  <main class="public-wrap">
    <header class="public-head">
      <p class="public-kicker">聚會簽到</p>
      <h1>${event.name}</h1>
      <p class="public-when">${event.event_date}（${weekday}）${timeRange}</p>
      ${event.location ? html`<p class="public-where">${event.location}</p>` : ''}
      ${event.notes ? html`<p class="public-notes">${event.notes}</p>` : ''}
      ${Number(event.fee_amount) > 0 || event.fee_note || event.contact_name
        ? html`<p class="public-meta">
            ${Number(event.fee_amount) > 0 ? html`<span>費用 ${formatMoney(event.fee_amount)}</span>` : ''}
            ${event.fee_note ? html`<span>${event.fee_note}</span>` : ''}
            ${event.contact_name ? html`<span>聯絡：${event.contact_name}${event.contact_phone ? ` ${event.contact_phone}` : ''}</span>` : ''}
          </p>`
        : ''}
    </header>
    ${body}
    <footer class="public-foot">${footer || '簽到記錄由主辦單位保存，只用於點名。'}</footer>
  </main>
</body>
</html>`;
}

export function publicFormPage({ event, error = '', notice = '' }) {
  return shell({
    event,
    body: html`<section class="public-card">
      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}
      ${notice ? html`<div class="flash flash-ok">${notice}</div>` : ''}

      ${event.allow_self_checkin
        ? html`<h2 class="public-h2">我到了，幫我簽到</h2>
          <form method="post" action="/s/${event.public_token}/lookup" class="stack">
            <label class="field">
              <span>你的姓名或電話</span>
              <input name="q" required autocomplete="name" placeholder="例：陳大文 或 91234567" autofocus>
            </label>
            <button class="btn btn-primary btn-block" type="submit">找我</button>
          </form>

          <details class="public-new">
            <summary>不在名單上？按這裡新增</summary>
            <form method="post" action="/s/${event.public_token}/walkin" class="stack">
              <label class="field"><span>姓名 <em>必填</em></span><input name="name" required maxlength="80"></label>
              <label class="field"><span>電話（方便下次點名）</span><input name="phone" inputmode="tel" maxlength="30"></label>
              <button class="btn btn-block" type="submit">簽到</button>
            </form>
          </details>`
        : html`<div class="public-card-inner">
            <p class="muted">這個聚會目前沒有開放自助簽到，請找工作人員幫你登記。</p>
          </div>`}
    </section>`,
  });
}

export function publicCandidatesPage({ event, candidates, query, error = '' }) {
  return shell({
    event,
    body: html`<section class="public-card">
      ${error ? html`<div class="flash flash-err">${error}</div>` : ''}
      <h2 class="public-h2">邊一位係你？</h2>
      <p class="muted">搜尋「${query}」的結果，按自己的名字完成簽到。</p>
      <ul class="candidate-list">
        ${candidates.map(
          (row) => html`<li>
            <div class="candidate-info">
              <strong>${row.name}</strong>
              <span class="muted small">${row.group_name || ''} ${row.phone_masked || ''}</span>
            </div>
            <form method="post" action="/s/${event.public_token}/checkin">
              <input type="hidden" name="attendee_id" value="${row.id}">
              <button class="btn btn-primary btn-sm" type="submit">係我，簽到</button>
            </form>
          </li>`,
        )}
      </ul>
      <p class="public-back"><a href="/s/${event.public_token}">← 重新搜尋</a></p>
    </section>`,
  });
}

export function publicDonePage({ event, checkin, attendee, late, canCheckout, checkoutDone = false }) {
  return shell({
    event,
    body: html`<section class="public-card public-done">
      <div class="done-mark" aria-hidden="true">✓</div>
      <h2 class="public-h2">${checkoutDone ? '已簽退，多謝參加' : '簽到完成'}</h2>
      <p class="done-name">${attendee.name}</p>
      <p class="done-time">${checkoutDone ? '簽退時間' : '簽到時間'}：${formatDateTime(
        checkoutDone ? checkin.checked_out_at : checkin.checked_in_at,
        event.timezone,
      )}</p>
      ${late && !checkoutDone ? html`<p class="badge badge-warn">遲到 ${checkin.late_minutes} 分鐘</p>` : ''}
      ${checkoutDone
        ? ''
        : html`<p class="muted small">如果簽到時間不對，請找工作人員協助。</p>`}

      ${canCheckout && !checkoutDone
        ? html`<details class="public-new">
            <summary>我要先離開（簽退）</summary>
            <form method="post" action="/s/${event.public_token}/checkout" class="stack">
              <input type="hidden" name="attendee_id" value="${attendee.id}">
              <label class="field"><span>確認身分：電話後 4 碼</span><input name="last4" inputmode="numeric" maxlength="4" required></label>
              <button class="btn btn-block" type="submit">簽退</button>
            </form>
          </details>`
        : ''}
    </section>`,
    footer: '可以關閉這個頁面了。',
  });
}

export function publicClosedPage({ event, reason }) {
  return shell({
    event,
    body: html`<section class="public-card">
      <h2 class="public-h2">${reason === 'full' ? '名額已滿' : reason === 'notstarted' ? '簽到未開始' : '聚會已結束'}</h2>
      <p class="muted">${reason === 'full'
        ? '自助報名已滿，請找工作人員協助。'
        : reason === 'notstarted'
          ? '主辦單位還沒開放簽到，請稍後再試。'
          : '這個聚會的簽到已經結束，如需補簽請聯絡主辦單位。'}</p>
    </section>`,
  });
}

export function publicErrorPage({ event, message }) {
  return shell({
    event,
    body: html`<section class="public-card">
      <h2 class="public-h2">未能完成</h2>
      <p class="muted">${message}</p>
      <p class="public-back"><a href="/s/${event.public_token}">← 返回簽到頁</a></p>
    </section>`,
  });
}
