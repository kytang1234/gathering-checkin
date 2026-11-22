import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRosterCsv, toCsv, escapeCell } from '../src/lib/csv.mjs';

test('解析：引號內的逗號與換行', () => {
  const rows = parseCsv('姓名,備註\r\n"陳大文","喜歡, 素食"\r\n"李小明","第一行\n第二行"\r\n');
  assert.deepEqual(rows, [
    ['姓名', '備註'],
    ['陳大文', '喜歡, 素食'],
    ['李小明', '第一行\n第二行'],
  ]);
});

test('解析：雙引號轉義與結尾空行', () => {
  const rows = parseCsv('a,"說 ""你好"""\r\n\r\n');
  assert.deepEqual(rows, [['a', '說 "你好"']]);
});

test('匯出：BOM、CRLF、必要時加引號', () => {
  const csv = toCsv([['姓名', '備註'], ['陳大文', 'a,b'], ['李小明', '說 "好"']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('"說 ""好"""'));
  assert.equal(escapeCell('普通'), '普通');
});

test('名單 CSV：辨識標題列並對應欄位', () => {
  const { items, skipped } = parseRosterCsv(
    '姓名,電話,組別,桌號,餐飲,備註\n陳大文,91234567,A 組,1 號桌,素,\n李小明,,B 組,,,不吃牛\n,123,,,,\n',
  );
  assert.equal(items.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(items[0], {
    name: '陳大文',
    phone: '91234567',
    group_name: 'A 組',
    seat_no: '1 號桌',
    meal_choice: '素',
    note: '',
  });
  assert.equal(items[1].name, '李小明');
});

test('名單 CSV：沒有標題列時按位置讀', () => {
  const { items } = parseRosterCsv('陳大文,91234567,A 組');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '陳大文');
  assert.equal(items[0].phone, '91234567');
  assert.equal(items[0].group_name, 'A 組');
});
