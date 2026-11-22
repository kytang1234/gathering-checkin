// HTTP 小工具：錯誤型別、回應、body 解析、cookie、網址。

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** 導向；由伺服器最外層捕捉後送出 303。 */
export class Redirect {
  constructor(location, status = 303) {
    this.location = location;
    this.status = status;
  }
}

export function sendHtml(res, body, status = 200, headers = {}) {
  const text = typeof body === 'string' ? body : String(body?.value ?? body ?? '');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(text);
}

export function sendJson(res, data, status = 200, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export function sendText(res, text, status = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(text);
}

export function sendBytes(res, buffer, contentType, status = 200, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...headers,
  });
  res.end(buffer);
}

export function redirect(res, location, status = 303) {
  res.writeHead(status, { Location: location });
  res.end();
}

const BODY_LIMIT = 5 * 1024 * 1024;

export function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '請求內容過大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 回傳 { fields, json }：表單用 fields，fetch 用 json。 */
export async function readPayload(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return { fields: {}, json: null };
  const rawBody = await readBody(req);
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      return { fields: {}, json: rawBody ? JSON.parse(rawBody) : {} };
    } catch {
      throw new HttpError(400, 'JSON 格式錯誤');
    }
  }
  const fields = {};
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (key in fields) {
      fields[key] = [].concat(fields[key], value);
    } else {
      fields[key] = value;
    }
  }
  return { fields, json: null };
}

export function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out.set(key, decodeURIComponent(part.slice(index + 1).trim()));
  }
  return out;
}

export function appendCookie(res, name, value, options = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${options.path || '/'}`);
  bits.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) bits.push('HttpOnly');
  if (options.secure) bits.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? [].concat(existing, bits.join('; ')) : [bits.join('; ')];
  res.setHeader('Set-Cookie', list);
}

export function clearCookie(res, name) {
  appendCookie(res, name, '', { maxAge: 0 });
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function requestBaseUrl(req) {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** 判斷對外是否 HTTPS：直連 TLS，或反向代理回報 x-forwarded-proto。 */
export function isHttps(req) {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** 只允許站內相對路徑，避免 open redirect。 */
export function safeNext(value, fallback = '/') {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
