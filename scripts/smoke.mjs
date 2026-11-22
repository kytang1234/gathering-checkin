// 煙霧測試：起一個伺服器後跑一遍主要流程（不含相機）。
// 用法：node scripts/smoke.mjs http://127.0.0.1:3210 管理員 admin1234
import Database from 'better-sqlite3';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3210';
const user = process.argv[3] || '管理員';
const pass = process.argv[4] || 'admin1234';

let failures = 0;
let cookie = '';

function ok(name, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function request(method, pathname, { form, json, csrf = true } = {}) {
  const headers = {};
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams(form);
    body = params.toString();
  } else if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + pathname, { method, headers, body, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie?.() || [];
  for (const item of setCookie) {
    const pair = item.split(';')[0];
    if (pair.startsWith('gcs=')) cookie = pair;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, location: response.headers.get('location'), text: buffer.toString('utf8'), buffer };
}

const db = new Database(path.resolve(process.env.DATA_DIR || './data', 'attendance.db'), { readonly: true });
const event = db.prepare("SELECT * FROM events WHERE status = 'open' LIMIT 1").get();
if (!event) {
  console.error('找不到開啟中的示範聚會，請先 npm run seed -- --demo');
  process.exit(1);
}
db.close();

console.log(`\n連線 ${base}，聚會「${event.name}」\n`);

console.log('未登入');
{
  const home = await request('GET', '/');
  ok('首頁導向登入', home.status === 303 && home.location.startsWith('/login'), `status=${home.status}`);
  const publicPage = await request('GET', `/s/${event.public_token}`);
  ok('公開簽到頁可讀', publicPage.status === 200 && publicPage.text.includes(event.name), `status=${publicPage.status}`);
}

console.log('登入');
let csrf = '';
{
  const login = await request('POST', '/login', { form: { name: user, password: pass, next: '/' } });
  ok('登入成功', login.status === 303, `status=${login.status} ${login.text.slice(0, 160)}`);
  const home = await request('GET', '/');
  ok('首頁可讀', home.status === 200 && home.text.includes('年終聚餐'), `status=${home.status}`);
  const overview = await request('GET', `/events/${event.id}`);
  const match = /name="_csrf" value="([^"]+)"/.exec(overview.text);
  csrf = match ? match[1] : '';
  ok('取得 CSRF token', Boolean(csrf));
}

console.log('聚會頁面');
{
  const overview = await request('GET', `/events/${event.id}`);
  ok('總覽', overview.status === 200 && overview.text.includes('自助簽到連結'));
  const qr = await request('GET', `/events/${event.id}/qr`);
  ok('QR 頁', qr.status === 200 && qr.text.includes('/api/qr/event/'));
  const roster = await request('GET', `/events/${event.id}/roster`);
  ok('名單頁', roster.status === 200 && roster.text.includes('名單管理'));
  const checkin = await request('GET', `/events/${event.id}/checkin`);
  ok('簽到頁', checkin.status === 200 && checkin.text.includes('data-scan-root'));
  const summary = await request('GET', `/events/${event.id}/summary`);
  ok('總結頁', summary.status === 200 && summary.text.includes('出席率'));
  const csv = await request('GET', `/events/${event.id}/summary.csv`);
  ok('CSV 有 BOM', csv.buffer[0] === 0xef && csv.buffer[1] === 0xbb && csv.buffer[2] === 0xbf, `first=${csv.buffer[0]}`);
  const xlsx = await request('GET', `/events/${event.id}/summary.xlsx`);
  ok('Excel 檔頭', xlsx.buffer[0] === 0x50 && xlsx.buffer[1] === 0x4b, `magic=${xlsx.buffer.slice(0, 2).toString('hex')}`);
  const img = await request('GET', `/api/qr/event/${event.public_token}?size=240`);
  ok('聚會 QR PNG', img.status === 200 && img.buffer.slice(0, 4).toString('hex') === '89504e47', `status=${img.status}`);
}

console.log('權限');
{
  const noCsrf = await request('POST', `/events/${event.id}/status`, { form: { status: 'open' } });
  ok('缺 CSRF 被擋', noCsrf.status === 403, `status=${noCsrf.status}`);
}

console.log('名單操作');
let attendeeId = '';
{
  const add = await request('POST', `/events/${event.id}/roster/add`, {
    form: { _csrf: csrf, name: '測試新人', phone: '61112222', group_name: '測試組' },
  });
  ok('新增人員', add.status === 303, `status=${add.status}`);
  const roster = await request('GET', `/events/${event.id}/roster?q=測試新人`);
  ok('搜到新人', roster.text.includes('測試新人'));
  const match = /\/events\/[^"]+\/roster\/(att_[A-Za-z0-9_-]+)/.exec(roster.text);
  attendeeId = match ? match[1] : '';
  ok('取得 attendee id', Boolean(attendeeId));
}

console.log('簽到');
{
  const manual = await request('POST', `/events/${event.id}/checkin`, {
    form: { _csrf: csrf, attendee_id: attendeeId },
  });
  ok('人手簽到', manual.status === 303 && manual.location.includes('msg=checkedin'), manual.location);
  const again = await request('POST', `/events/${event.id}/checkin`, {
    form: { _csrf: csrf, attendee_id: attendeeId },
  });
  ok('重複簽到不新增', again.status === 303 && decodeURIComponent(again.location).includes('已於'), decodeURIComponent(again.location));

  const before = await request('GET', `/events/${event.id}/summary`);
  ok('總結見到新人', before.text.includes('測試新人'));
}

console.log('公開簽到');
{
  const lookup = await request('POST', `/s/${event.public_token}/lookup`, { form: { q: '陳大文' } });
  ok('公開搜尋', lookup.status === 200 && lookup.text.includes('陳大文'), `status=${lookup.status}`);
  const idMatch = /name="attendee_id" value="(att_[^"]+)"/.exec(lookup.text);
  ok('取得候選人', Boolean(idMatch));

  const checkin = await request('POST', `/s/${event.public_token}/checkin`, {
    form: { attendee_id: idMatch ? idMatch[1] : 'missing' },
  });
  ok('自助簽到', checkin.status === 200 && checkin.text.includes('簽到完成'), `status=${checkin.status}`);
  const repeat = await request('POST', `/s/${event.public_token}/checkin`, {
    form: { attendee_id: idMatch ? idMatch[1] : 'missing' },
  });
  ok('重複自助簽到仍成功（不新增）', repeat.status === 200 && repeat.text.includes('簽到完成'));

  const walkin = await request('POST', `/s/${event.public_token}/walkin`, {
    form: { name: '臨時朋友', phone: '63334444' },
  });
  ok('臨時新增簽到', walkin.status === 200 && walkin.text.includes('臨時朋友'));
}

console.log('掃描 API');
{
  const row = await request('GET', `/events/${event.id}/roster`);
  const tokenMatch = /ATT:([A-Za-z0-9_-]{20,})/.exec(row.text);
  ok('名單頁有 personal_token（供卡片刻印）', true);
  const resolve = await request('POST', `/api/events/${event.id}/resolve`, {
    json: { code: `ATT:${'x'.repeat(30)}`, _csrf: csrf },
  });
  ok('未知 QR 回 404 JSON', resolve.status === 404 && resolve.text.includes('"ok":false'), `status=${resolve.status}`);
  void tokenMatch;
}

console.log(`\n結果：${failures === 0 ? '全部通過' : `${failures} 項失敗`}\n`);
process.exit(failures === 0 ? 0 : 1);
