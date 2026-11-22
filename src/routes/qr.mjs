import QRCode from 'qrcode';
import { requireUser } from '../lib/auth.mjs';
import { HttpError, sendBytes } from '../lib/http.mjs';
import { getAttendee, getEventByPublicToken } from '../lib/store.mjs';

function clampSize(raw, fallback = 480) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1200, Math.max(120, Math.round(n)));
}

function qrOptions(size) {
  return {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#14201b', light: '#ffffff' },
  };
}

export function registerQrRoutes(router) {
  // 聚會 QR：內容就是自助簽到網址。token 本身就是秘密，所以不需要登入。
  router.get('/api/qr/event/:token', async (ctx) => {
    const event = getEventByPublicToken(ctx.db, ctx.params.token);
    if (!event) throw new HttpError(404, '找不到這個 QR');
    const size = clampSize(ctx.query.get('size'));
    const url = `${ctx.baseUrl}/s/${event.public_token}`;
    const buffer = await QRCode.toBuffer(url, qrOptions(size));
    const headers = { 'Cache-Control': 'private, max-age=300' };
    if (ctx.query.get('download')) {
      headers['Content-Disposition'] = `attachment; filename="event-qr.png"`;
    }
    sendBytes(ctx.res, buffer, 'image/png', 200, headers);
  }, { public: true });

  // 個人 QR：內容是 ATT:<token>，普通相機掃到只會顯示一行字。
  router.get('/api/qr/attendee/:attendeeId', async (ctx) => {
    requireUser(ctx);
    const attendee = getAttendee(ctx.db, ctx.params.attendeeId);
    if (!attendee) throw new HttpError(404, '找不到這個人');
    const size = clampSize(ctx.query.get('size'), 400);
    const buffer = await QRCode.toBuffer(`ATT:${attendee.personal_token}`, qrOptions(size));
    const headers = { 'Cache-Control': 'private, max-age=60' };
    if (ctx.query.get('download')) {
      const name = String(attendee.name).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40);
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(name)}-qr.png"`;
    }
    sendBytes(ctx.res, buffer, 'image/png', 200, headers);
  });
}
