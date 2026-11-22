import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from './src/router.mjs';
import { registerRoutes } from './src/routes/index.mjs';
import { getDb } from './src/lib/db.mjs';
import { readSession, requireCsrf, SESSION_COOKIE } from './src/lib/auth.mjs';
import {
  HttpError,
  Redirect,
  clientIp,
  parseCookies,
  readPayload,
  requestBaseUrl,
  sendJson,
  sendHtml,
} from './src/lib/http.mjs';
import { errorPage } from './src/views/ui.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const router = registerRoutes(new Router());

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!rel || rel.includes('..') || rel.startsWith('.')) return false;
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir)) return false;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!MIME[`.${ext}`]) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[`.${ext}`],
    'Content-Length': stat.size,
    'Cache-Control': ext === 'css' || ext === 'js' ? 'public, max-age=60' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

function wantsJson(req, pathname) {
  if (pathname.startsWith('/api/')) return true;
  return String(req.headers.accept || '').includes('application/json');
}

function sendResult(res, result) {
  if (!result) return;
  if (typeof result === 'string' || typeof result?.value === 'string') {
    sendHtml(res, result, 200);
    return;
  }
  if (result.json !== undefined) {
    sendJson(res, result.json, result.status || 200);
    return;
  }
  if (result.html !== undefined) {
    sendHtml(res, result.html, result.status || 200);
    return;
  }
  if (result.redirect) {
    res.writeHead(result.status || 303, { Location: result.redirect });
    res.end();
  }
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://internal');
  const pathname = url.pathname;

  if (req.method === 'GET' && serveStatic(res, pathname)) return;
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  const db = getDb();
  const cookies = parseCookies(req.headers.cookie);
  const session = readSession(db, cookies.get(SESSION_COOKIE));

  const matched = router.match(req.method, pathname);
  if (!matched) {
    const body = errorPage({ status: 404, message: '找不到這個頁面。', user: session?.user || null });
    sendHtml(res, body, 404);
    return;
  }

  const { route, params } = matched;
  const { fields, json } = await readPayload(req);

  const ctx = {
    req,
    res,
    db,
    url,
    pathname,
    query: url.searchParams,
    params,
    fields,
    json,
    cookies,
    user: session?.user || null,
    session,
    ip: clientIp(req),
    baseUrl: requestBaseUrl(req),
  };

  if (req.method === 'POST' && !route.options.public) {
    requireCsrf(ctx);
  }

  const result = await route.handler(ctx);
  sendResult(res, result);
}

const secure = Boolean(process.env.TLS_CERT && process.env.TLS_KEY);
const tlsOptions = secure
  ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }
  : null;

async function onRequest(req, res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const pathname = (req.url || '/').split('?')[0];
  try {
    await handle(req, res);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof Redirect) {
      res.writeHead(error.status, { Location: error.location });
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      if (wantsJson(req, pathname)) {
        sendJson(res, { ok: false, error: error.message }, error.status);
      } else {
        sendHtml(res, errorPage({ status: error.status, message: error.message }), error.status);
      }
      return;
    }
    if (process.env.DEBUG === '1') console.error(error);
    else console.error(`[${new Date().toISOString()}] ${req.method} ${pathname} — ${error.message}`);
    if (wantsJson(req, pathname)) {
      sendJson(res, { ok: false, error: '系統錯誤，請再試一次' }, 500);
    } else {
      sendHtml(res, errorPage({ status: 500, message: '系統發生錯誤，請稍後再試。' }), 500);
    }
  }
}

const server = secure ? https.createServer(tlsOptions, onRequest) : http.createServer(onRequest);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  const localHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log('');
  console.log('  聚會簽到已啟動');
  console.log(`  本機：   ${secure ? 'https' : 'http'}://${localHost}:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item.family === 'IPv4' && !item.internal) {
          console.log(`  區網：   ${secure ? 'https' : 'http'}://${item.address}:${PORT}`);
        }
      }
    }
    if (!secure) console.log('  提示：    用區網 IP 開掃描鏡頭需要 HTTPS，或用 localhost 在本機操作。');
  }
  console.log(`  資料庫： ${process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'attendance.db')}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
