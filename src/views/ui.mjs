// 共用版面與小元件。所有插值都經 html`` 自動轉義。

import { html, raw, esc, messageText } from '../lib/html.mjs';
import { formatMoney, statusLabel, methodLabel } from '../lib/rules.mjs';
import { weekdayLabel } from '../lib/time.mjs';

export function csrf(token) {
  return raw(`<input type="hidden" name="_csrf" value="${esc(token || '')}">`);
}

export function flashFrom(query) {
  const err = query.get('err');
  const msg = query.get('msg');
  const note = String(query.get('note') || '').slice(0, 120);
  if (err) return { type: 'err', text: note || messageText(err) || '操作失敗，請再試一次。' };
  if (msg) return { type: 'ok', text: note || messageText(msg) || '' };
  return null;
}

export function money(cents) {
  return formatMoney(cents);
}

export function statusBadge(status) {
  return html`<span class="badge badge-${raw(status)}">${statusLabel(status)}</span>`;
}

export function methodBadge(method) {
  if (!method) return html`<span class="muted">—</span>`;
  return html`<span class="badge badge-quiet">${methodLabel(method)}</span>`;
}

export function whenText(event) {
  const weekday = weekdayLabel(event.event_date);
  const timeRange = event.end_time ? `${event.start_time}–${event.end_time}` : event.start_time;
  return `${event.event_date}（${weekday}）${timeRange}`;
}

export function dateBlock(event) {
  const [, month, day] = String(event.event_date).split('-');
  return html`<div class="dateblock">
    <span class="dateblock-day">${Number(day)}</span>
    <span class="dateblock-month">${Number(month)} 月</span>
  </div>`;
}

export function stat(label, value, hint = '') {
  return html`<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    ${hint ? html`<div class="stat-hint">${hint}</div>` : ''}
  </div>`;
}

export function empty(text, action = null) {
  return html`<div class="empty">
    <p>${text}</p>
    ${action || ''}
  </div>`;
}

export function page({ title, user = null, active = '', flash = null, body, wide = false, csrfToken = '', scripts = [] }) {
  const nav = [
    { href: '/', label: '聚會' },
    { href: '/events/new', label: '新增聚會', adminOnly: true },
    { href: '/users', label: '職員', adminOnly: true },
  ];
  const visibleNav = nav.filter((item) => !item.adminOnly || user?.role === 'admin');

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#2f5d50">
  <title>${title} · 聚會簽到</title>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">✓</span>
      <span class="brand-text">聚會簽到</span>
    </a>
    ${user
      ? html`<nav class="nav">
          ${visibleNav.map(
            (item) =>
              html`<a href="${item.href}" class="${active === item.href ? 'is-active' : ''}">${item.label}</a>`,
          )}
        </nav>
        <form method="post" action="/logout" class="topbar-user">
          ${csrf(csrfToken)}
          <span class="who">${user.name}</span>
          <button class="btn btn-ghost btn-sm" type="submit">登出</button>
        </form>`
      : ''}
  </header>
  <main class="wrap ${wide ? 'wrap-wide' : ''}">
    ${flash
      ? html`<div class="flash flash-${flash.type}" role="status">${flash.text}</div>`
      : ''}
    ${body}
  </main>
  <footer class="foot">聚會簽到 · 本機資料庫，資料不出這台電腦</footer>
  <script src="/app.js" defer></script>
  ${scripts.map((src) => raw(`<script src="${esc(src)}" defer></script>`))}
</body>
</html>`;
}

export function errorPage({ status, message, user = null }) {
  return page({
    title: `${status}`,
    user,
    body: html`<section class="card narrow">
      <h1 class="h1">${status}</h1>
      <p class="muted">${message}</p>
      <p><a class="btn btn-primary" href="/">回到聚會列表</a></p>
    </section>`,
  });
}
