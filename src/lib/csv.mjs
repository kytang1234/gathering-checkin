// CSV：RFC4180 解析與匯出（匯出加 UTF-8 BOM，Excel 直接開不亂碼）。

const BOM = '\uFEFF';

export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows) {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  return BOM + body + '\r\n';
}

/** 解析「姓名,電話,組別,桌號,餐飲,備註」格式的名單；有標題列會自動偵測。 */
export function parseRosterCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { items: [], skipped: 0 };

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const known = ['姓名', '名字', 'name', '電話', '手机', '手機', 'phone', '組別', '组别', 'group', '桌號', '桌号', 'seat', '餐飲', '餐饮', 'meal', '備註', '备注', 'note'];
  const hasHeader = header.some((h) => known.includes(h));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const indexOf = (names) => header.findIndex((h) => names.includes(h));
  const map = hasHeader
    ? {
        name: Math.max(0, indexOf(['姓名', '名字', 'name'])),
        phone: indexOf(['電話', '手机', '手機', 'phone', 'mobile']),
        group: indexOf(['組別', '组别', 'group', '部門', '部门']),
        seat: indexOf(['桌號', '桌号', '座位', 'seat', 'table']),
        meal: indexOf(['餐飲', '餐饮', 'meal', '飲食', '饮食']),
        note: indexOf(['備註', '备注', 'note', 'notes', 'remark']),
      }
    : { name: 0, phone: 1, group: 2, seat: 3, meal: 4, note: 5 };

  const pick = (row, index) => (index >= 0 && index < row.length ? row[index].trim() : '');
  const items = [];
  let skipped = 0;

  for (const row of dataRows) {
    const name = pick(row, map.name);
    if (!name) {
      skipped += 1;
      continue;
    }
    items.push({
      name: name.slice(0, 80),
      phone: pick(row, map.phone),
      group_name: pick(row, map.group).slice(0, 60),
      seat_no: pick(row, map.seat).slice(0, 30),
      meal_choice: pick(row, map.meal).slice(0, 30),
      note: pick(row, map.note).slice(0, 500),
    });
  }

  return { items, skipped, hasHeader };
}
