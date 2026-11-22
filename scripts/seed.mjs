import { openDb, resolveDbPath } from '../src/lib/db.mjs';
import { hashPassword } from '../src/lib/auth.mjs';
import { randomToken } from '../src/lib/tokens.mjs';
import { zonedToUtc } from '../src/lib/time.mjs';
import { createEvent, createAttendee, addAttendeeToEvent, checkIn, checkOut, getEvent, setEventStatus } from '../src/lib/store.mjs';

const dbFile = resolveDbPath();
const db = openDb(dbFile);

const hasTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();
if (!hasTable) {
  console.error('資料表還未建立，請先執行 npm run migrate');
  process.exit(1);
}

const demo = process.argv.includes('--demo');

// ---- 管理員
const adminName = (process.env.ADMIN_NAME || '管理員').trim();
const existingAdmin = db.prepare('SELECT * FROM users WHERE name = ?').get(adminName);
if (!existingAdmin) {
  const password = process.env.ADMIN_PASSWORD || randomToken(9);
  db.prepare(
    'INSERT INTO users (id, name, role, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(`usr_${randomToken(9)}`, adminName, 'admin', hashPassword(password), new Date().toISOString());
  console.log('✓ 已建立管理員帳號');
  console.log(`  名稱：${adminName}`);
  if (process.env.ADMIN_PASSWORD) {
    console.log('  密碼：使用 ADMIN_PASSWORD 環境變數（或 .env）的值');
  } else {
    console.log(`  密碼：${password}`);
    console.log('  ⚠ 只會顯示一次，請立即記下（之後可用 npm run user -- reset ' + adminName + ' 重設）');
  }
} else {
  console.log(`· 管理員「${adminName}」已存在，略過`);
}

// ---- 示範資料
if (demo) {
  const eventCount = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  if (eventCount > 0) {
    console.log('· 已有聚會資料，略過示範資料');
  } else {
    const people = [
      ['陳大文', '91234567', 'A 組'],
      ['李小明', '62345678', 'A 組'],
      ['王美玲', '53456789', 'B 組'],
      ['張家輝', '94567890', 'B 組'],
      ['黃志強', '65678901', 'C 組'],
      ['何靜怡', '96789012', 'C 組'],
      ['林偉', '67890123', 'A 組'],
      ['吳嘉欣', '98901234', 'B 組'],
    ];
    const attendees = people.map(([name, phone, group]) => createAttendee(db, { name, phone, groupName: group }));

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
    const dinner = createEvent(db, {
      name: '年終聚餐',
      event_date: today,
      start_time: '19:00',
      end_time: '22:00',
      location: '銅鑼灣 ABC 酒家 2 樓',
      notes: '19:00 入席，20:00 開始抽獎，請提早 15 分鐘到場。',
      internal_notes: '記得帶抽獎箱同投影機轉接線。',
      status: 'open',
      timezone: 'Asia/Hong_Kong',
      capacity: 40,
      fee_amount: 38000,
      fee_note: '現場繳費，可 PayMe',
      contact_name: '陳大文',
      contact_phone: '91234567',
      meal_options: ['葷', '素'],
      registration_deadline: null,
      late_after_minutes: 15,
      allow_self_checkin: 1,
      allow_self_checkout: 0,
    });

    const talk = createEvent(db, {
      name: '義工分享會',
      event_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      start_time: '14:30',
      end_time: '17:00',
      location: '社區中心 3 樓',
      notes: '歡迎帶朋友參加。',
      internal_notes: null,
      status: 'draft',
      timezone: 'Asia/Hong_Kong',
      capacity: 60,
      fee_amount: 0,
      fee_note: '免費',
      contact_name: '王美玲',
      contact_phone: '53456789',
      meal_options: [],
      registration_deadline: null,
      late_after_minutes: 10,
      allow_self_checkin: 1,
      allow_self_checkout: 0,
    });

    for (const [index, attendee] of attendees.entries()) {
      addAttendeeToEvent(db, {
        eventId: dinner.id,
        attendeeId: attendee.id,
        source: 'manual',
        seatNo: `${Math.floor(index / 4) + 1} 號桌`,
        mealChoice: index % 3 === 0 ? '素' : '葷',
      });
    }
    db.prepare('UPDATE event_attendees SET fee_paid = 1, fee_paid_at = ? WHERE event_id = ? AND attendee_id IN (?, ?)').run(
      new Date().toISOString(),
      dinner.id,
      attendees[0].id,
      attendees[1].id,
    );

    // 幾筆已簽到資料，方便預覽總結畫面（時間固定在聚會當晚）
    const fresh = getEvent(db, dinner.id);
    const at = (time) => zonedToUtc(fresh.event_date, time, fresh.timezone).toISOString();
    checkIn(db, { event: fresh, attendeeId: attendees[0].id, method: 'qr_scan', at: at('18:52') });
    checkIn(db, { event: fresh, attendeeId: attendees[2].id, method: 'manual', at: at('19:04') });
    checkIn(db, { event: fresh, attendeeId: attendees[5].id, method: 'qr_self', at: at('19:38') });
    checkOut(db, { eventId: dinner.id, attendeeId: attendees[0].id, method: 'manual', at: at('21:30') });

    setEventStatus(db, talk.id, 'draft');
    console.log(`✓ 已建立示範聚會：「${dinner.name}」（8 人名單、3 人已簽到）與「${talk.name}」`);
  }
}

db.close();
console.log(`資料庫：${dbFile}`);
