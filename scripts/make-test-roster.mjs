#!/usr/bin/env node
// 產生測試用名單 CSV：姓名,電話,組別,桌號,餐飲,備註
// 用法：node scripts/make-test-roster.mjs [人數] [輸出路徑]
// 預設 200 人 → samples/roster-200.csv
//
// 電話由 91230001 起順序編號，屬於明顯的測試號碼，不會誤撞真人。

import fs from 'node:fs';
import path from 'node:path';

const total = Number(process.argv[2] || 200);
const output = process.argv[3] || path.join(import.meta.dirname, '..', 'samples', `roster-${total}.csv`);
const phoneBase = Number(process.argv[4] || 91230001);

const SURNAMES = [
  '陳', '李', '黃', '梁', '張', '劉', '何', '吳', '羅', '鄭',
  '蔡', '林', '楊', '趙', '周', '徐', '馬', '朱', '胡', '郭',
  '曾', '鄧', '馮', '彭', '葉', '鍾', '盧', '譚', '蘇', '廖',
  '沈', '洪', '孫', '袁', '方', '蕭', '潘', '杜', '唐', '謝',
  '簡', '程', '曹', '王', '余', '魏', '侯', '姚', '溫', '甘',
];

const GIVEN = [
  '大文', '小明', '美玲', '家輝', '志強', '靜怡', '嘉欣', '俊傑', '淑儀', '浩然',
  '雅雯', '子豪', '詠詩', '文俊', '美儀', '國強', '麗華', '德明', '秀英', '健邦',
  '慧敏', '志明', '玉蘭', '家俊', '美琪', '世豪', '靜文', '俊賢', '彩玲', '偉倫',
  '嘉敏', '永康', '思敏', '俊豪', '美珍', '志豪', '詠琪', '文輝', '秀珍', '嘉豪',
  '海倫', '天佑', '月娥', '振強', '小燕', '浩然', '雪兒', '博文', '美華', '子晴',
];

const GROUPS = ['A 組', 'B 組', 'C 組', 'D 組'];

// 簡單 LCG，確保每次產生的結果一致
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const random = makeRandom(20261125);

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 由姓氏 × 名字的全部組合中取出不重複的姓名（保證自然、無數字後綴） */
function makeNames(count) {
  const combos = [];
  for (const surname of new Set(SURNAMES)) {
    for (const given of new Set(GIVEN)) combos.push(surname + given);
  }
  if (count > combos.length) {
    throw new Error(`最多可產生 ${combos.length} 個不重複姓名， requested ${count}`);
  }
  return shuffle(combos).slice(0, count);
}

const names = makeNames(total);
const rows = [['姓名', '電話', '組別', '桌號', '餐飲', '備註']];

for (let i = 0; i < total; i += 1) {
  const phone = String(phoneBase + i);
  const group = GROUPS[Math.floor(i / Math.ceil(total / GROUPS.length)) % GROUPS.length];
  const table = Math.floor(i / 10) + 1;
  const meal = i % 7 === 3 ? '素' : '葷';

  let note = '';
  if (i % 37 === 12) note = '不吃牛';
  else if (i % 53 === 20) note = '輪椅位';
  else if (i % 61 === 30) note = '新朋友';

  rows.push([names[i], phone, group, `${table} 號桌`, meal, note]);
}

function escapeCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csv = '\uFEFF' + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, csv, 'utf8');

const vegetarian = rows.slice(1).filter((row) => row[4] === '素').length;
const withNote = rows.slice(1).filter((row) => row[5]).length;

console.log(`✓ 已產生 ${output}`);
console.log(`  人數：${total}`);
console.log(`  組別：${GROUPS.join('、')}（各約 ${Math.ceil(total / GROUPS.length)} 人）`);
console.log(`  桌號：1–${Math.ceil(total / 10)} 號桌，每桌 10 人`);
console.log(`  餐飲：葷 ${total - vegetarian}、素 ${vegetarian}`);
console.log(`  備註：${withNote} 人有備註（不吃牛／輪椅位／新朋友）`);
console.log(`  電話：${phoneBase}–${phoneBase + total - 1}（測試號碼）`);
