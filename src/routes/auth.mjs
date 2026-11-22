import { appendCookie, clearCookie, isHttps, Redirect, safeNext } from '../lib/http.mjs';
import {
  authenticate,
  createSession,
  destroySession,
  SESSION_COOKIE,
  requireUser,
} from '../lib/auth.mjs';
import { rateLimit } from '../lib/ratelimit.mjs';
import { loginPage } from '../views/login.mjs';
import { flashFrom } from '../views/ui.mjs';

export function registerAuthRoutes(router) {
  router.get('/login', (ctx) => {
    if (ctx.user) throw new Redirect('/');
    const next = safeNext(ctx.query.get('next'), '/');
    return loginPage({ query: ctx.query, next });
  }, { public: true });

  router.post('/login', (ctx) => {
    const ip = ctx.ip;
    const limit = rateLimit(`login:${ip}`, 10, 60_000);
    const name = String(ctx.fields.name || '').trim();
    const password = String(ctx.fields.password || '');
    const next = safeNext(ctx.fields.next, '/');

    if (!limit.allowed) {
      return {
        html: loginPage({
          query: ctx.query,
          next,
          name,
          error: `嘗試次數太多，請 ${limit.retryAfter} 秒後再試。`,
        }),
        status: 429,
      };
    }

    const user = authenticate(ctx.db, name, password);
    if (!user) {
      return {
        html: loginPage({ query: ctx.query, next, name, error: '名稱或密碼不正確。' }),
        status: 401,
      };
    }

    const session = createSession(ctx.db, user.id);
    appendCookie(ctx.res, SESSION_COOKIE, session.token, {
      maxAge: 12 * 60 * 60,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(ctx.req),
    });
    throw new Redirect(next);
  }, { public: true });

  router.post('/logout', (ctx) => {
    requireUser(ctx);
    const token = ctx.cookies.get(SESSION_COOKIE);
    destroySession(ctx.db, token);
    clearCookie(ctx.res, SESSION_COOKIE);
    throw new Redirect('/login');
  });

  // 讓錯誤頁可以取得 flash 文字（公開頁用不到，保留給登入頁）
  void flashFrom;
}
