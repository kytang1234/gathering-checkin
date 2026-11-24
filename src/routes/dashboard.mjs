import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generatePassword, hashPassword, requireAdmin, requireUser } from '../lib/auth.mjs';
import { HttpError } from '../lib/http.mjs';
import { newId } from '../lib/tokens.mjs';
import { listEvents } from '../lib/store.mjs';
import { dashboardPage, passwordFormPage, passwordRevealPage, usersPage } from '../views/dashboard.mjs';
import { flashFrom } from '../views/ui.mjs';
import { backWith } from './helpers.mjs';

/** 產生一份一致性的 SQLite 快照（VACUUM INTO 會包含未 checkpoint 的 WAL）。 */
function snapshot(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(
    os.tmpdir(),
    `attendance-backup-${stamp}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function listUsers(db) {
  return db
    .prepare('SELECT id, name, role, is_active, created_at FROM users ORDER BY role, name')
    .all();
}

function userById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function activeAdminCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;
}

function renderUsers(ctx, flash = null, status = 200) {
  return {
    html: usersPage({
      user: ctx.user,
      users: listUsers(ctx.db),
      flash,
      csrfToken: ctx.session.csrf,
    }),
    status,
  };
}

function cleanPassword(fields) {
  const password = String(fields?.password || '');
  if (password && password.length < 8) throw new HttpError(400, '密碼最少 8 個字元');
  if (password.length > 128) throw new HttpError(400, '密碼太長（最多 128 個字元）');
  return password;
}

export function registerDashboardRoutes(router) {
  router.get('/', (ctx) => {
    requireUser(ctx);
    return dashboardPage({
      user: ctx.user,
      events: listEvents(ctx.db),
      flash: flashFrom(ctx.query),
      csrfToken: ctx.session.csrf,
    });
  });

  router.get('/users', (ctx) => {
    requireAdmin(ctx);
    return renderUsers(ctx, flashFrom(ctx.query));
  });

  // 新增職員
  router.post('/users/add', (ctx) => {
    requireAdmin(ctx);
    const name = String(ctx.fields.name || '').trim().slice(0, 40);
    if (!name) return renderUsers(ctx, { type: 'err', text: '請填名稱。' }, 400);

    const exists = ctx.db.prepare('SELECT 1 FROM users WHERE name = ?').get(name);
    if (exists) return renderUsers(ctx, { type: 'err', text: `「${name}」這個名稱已經有人用了。` }, 400);

    let typed;
    try {
      typed = cleanPassword(ctx.fields);
    } catch (error) {
      if (error instanceof HttpError) return renderUsers(ctx, { type: 'err', text: error.message }, 400);
      throw error;
    }

    const role = ctx.fields.role === 'admin' ? 'admin' : 'staff';
    const password = typed || generatePassword();
    ctx.db
      .prepare(
        'INSERT INTO users (id, name, role, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      )
      .run(newId('usr'), name, role, hashPassword(password), new Date().toISOString());

    if (typed) backWith(ctx.res, '/users', 'msg', 'created', `${name} 已建立`);

    return {
      html: passwordRevealPage({
        user: ctx.user,
        csrfToken: ctx.session.csrf,
        name,
        role,
        password,
        mode: 'created',
      }),
    };
  });

  // 重設密碼：可自訂，或留空由系統自動產生
  router.get('/users/:id/password', (ctx) => {
    requireAdmin(ctx);
    const target = userById(ctx.db, ctx.params.id);
    if (!target) throw new HttpError(404, '找不到這個帳號');
    return {
      html: passwordFormPage({
        user: ctx.user,
        target,
        csrfToken: ctx.session.csrf,
        error: '',
      }),
    };
  });

  router.post('/users/:id/password', (ctx) => {
    requireAdmin(ctx);
    const target = userById(ctx.db, ctx.params.id);
    if (!target) throw new HttpError(404, '找不到這個帳號');

    let typed;
    try {
      typed = cleanPassword(ctx.fields);
    } catch (error) {
      if (error instanceof HttpError) {
        return {
          html: passwordFormPage({
            user: ctx.user,
            target,
            csrfToken: ctx.session.csrf,
            error: error.message,
          }),
          status: 400,
        };
      }
      throw error;
    }

    const mode = String(ctx.fields.mode || (typed ? 'manual' : 'auto'));
    if (mode === 'manual' && !typed) {
      return {
        html: passwordFormPage({
          user: ctx.user,
          target,
          csrfToken: ctx.session.csrf,
          error: '請輸入新密碼，或改按「自動產生」。',
        }),
        status: 400,
      };
    }

    const password = typed || generatePassword();
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);

    // 讓舊登入失效；如果改的是自己，保留目前這個 session
    if (target.id === ctx.user.id) {
      ctx.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
        .run(target.id, ctx.session.sessionId);
    } else {
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }

    if (typed) backWith(ctx.res, '/users', 'msg', 'saved', `${target.name} 的密碼已更新`);

    return {
      html: passwordRevealPage({
        user: ctx.user,
        csrfToken: ctx.session.csrf,
        name: target.name,
        role: target.role,
        password,
        mode: 'reset',
      }),
    };
  });

  // 停用／啟用
  router.post('/users/:id/toggle', (ctx) => {
    requireAdmin(ctx);
    const target = userById(ctx.db, ctx.params.id);
    if (!target) throw new HttpError(404, '找不到這個帳號');

    if (target.id === ctx.user.id) {
      backWith(ctx.res, '/users', 'err', 'invalid', '不能停用自己的帳號');
    }
    const next = target.is_active ? 0 : 1;
    if (!next && target.role === 'admin' && activeAdminCount(ctx.db) <= 1) {
      backWith(ctx.res, '/users', 'err', 'invalid', '至少要保留一個啟用中的管理員');
    }

    ctx.db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(next, target.id);
    if (!next) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);

    backWith(
      ctx.res,
      '/users',
      'msg',
      'saved',
      `${target.name} 已${next ? '啟用' : '停用'}`,
    );
  });

  // 給沒有 shell 的環境（PaaS／托管主機）一個備份出口：管理員可即時下載 .db
  router.get('/admin/backup', (ctx) => {
    requireAdmin(ctx);
    const file = snapshot(ctx.db);
    const { size } = fs.statSync(file);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const name = `聚會簽到-備份-${stamp}.db`;

    ctx.res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename="attendance-backup.db"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    });

    const stream = fs.createReadStream(file);
    const cleanup = () => fs.unlink(file, () => {});
    ctx.res.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      ctx.res.destroy();
    });
    stream.pipe(ctx.res);
    return undefined;
  });
}
