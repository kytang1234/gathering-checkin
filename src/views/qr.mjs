import { html, raw } from '../lib/html.mjs';
import { csrf } from './ui.mjs';
import { whenText } from './ui.mjs';

/** 投影用的獨立頁面：不需要導覽，字要大、對比要強。 */
export function qrPage({ user, event, selfUrl, csrfToken }) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${event.name} · 簽到 QR</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="qr-body">
  <main class="qr-screen">
    <div class="qr-head">
      <h1>${event.name}</h1>
      <p>${whenText(event)}${event.location ? ` · ${event.location}` : ''}</p>
    </div>
    <div class="qr-frame">
      <img src="/api/qr/event/${event.public_token}?size=620" alt="聚會簽到 QR code" width="620" height="620">
    </div>
    <p class="qr-instruction">用手機相機掃描，或開啟 <strong>${shortUrl(selfUrl)}</strong></p>
    <div class="qr-tools">
      <a class="btn" href="/api/qr/event/${event.public_token}?size=1024&download=1" download>下載 PNG</a>
      <a class="btn" href="${selfUrl}" target="_blank" rel="noreferrer">預覽簽到頁</a>
      <button class="btn" type="button" onclick="window.print()">列印</button>
      <a class="btn btn-ghost" href="/events/${event.id}">返回</a>
    </div>
    ${user
      ? html`<form method="post" action="/events/${event.id}/qr/regenerate" class="qr-regen"
               onsubmit="return confirm('重新產生後，舊 QR code 會即時失效，確定嗎？')">
          ${csrf(csrfToken)}
          <button class="link-button" type="submit">重新產生 QR（舊的會失效）</button>
        </form>`
      : ''}
  </main>
</body>
</html>`;
}

function shortUrl(url) {
  return String(url).replace(/^https?:\/\//, '');
}
