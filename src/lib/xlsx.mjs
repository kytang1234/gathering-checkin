import ExcelJS from 'exceljs';
import { formatDateTime } from './time.mjs';
import { methodLabel, formatMoney } from './rules.mjs';
import { stayMinutes } from './reports.mjs';

function styleHeader(sheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5D50' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

export async function buildSummaryWorkbook({ event, summary }) {
  const tz = event.timezone || 'Asia/Hong_Kong';
  const fmt = (iso) => (iso ? formatDateTime(iso, tz) : '');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '聚會簽到';
  workbook.created = new Date();

  // ---- 出席
  const present = workbook.addWorksheet('出席');
  present.addRow([
    '姓名',
    '電話',
    '組別',
    '桌號',
    '餐飲',
    '簽到時間',
    '遲到',
    '遲到分鐘',
    '簽退時間',
    '停留分鐘',
    '簽到方式',
    '已繳費',
    '備註',
  ]);
  for (const row of summary.present) {
    present.addRow([
      row.name,
      row.phone || '',
      row.group_name || '',
      row.seat_no || '',
      row.meal_choice || '',
      fmt(row.checked_in_at),
      Number(row.is_late) === 1 ? '是' : '否',
      Number(row.is_late) === 1 ? Number(row.late_minutes || 0) : 0,
      fmt(row.checked_out_at),
      stayMinutes(row) ?? '',
      methodLabel(row.method),
      Number(row.fee_paid) === 1 ? '是' : '否',
      row.roster_note || row.person_notes || '',
    ]);
  }
  styleHeader(present);
  setWidths(present, [12, 14, 12, 8, 8, 18, 6, 9, 18, 9, 10, 8, 26]);

  // ---- 未出席
  const absent = workbook.addWorksheet('未出席');
  absent.addRow(['姓名', '電話', '組別', '桌號', '餐飲', '備註']);
  for (const row of summary.absent) {
    absent.addRow([
      row.name,
      row.phone || '',
      row.group_name || '',
      row.seat_no || '',
      row.meal_choice || '',
      row.roster_note || row.person_notes || '',
    ]);
  }
  styleHeader(absent);
  setWidths(absent, [12, 14, 12, 8, 8, 30]);

  // ---- 統計
  const stats = workbook.addWorksheet('統計');
  stats.addRow(['聚會', event.name]);
  stats.addRow(['日期', event.event_date]);
  stats.addRow(['開始時間', event.start_time]);
  stats.addRow(['地點', event.location || '']);
  stats.addRow([]);
  stats.addRow(['項目', '數值']);
  const rows = [
    ['名單人數', summary.total],
    ['出席人數', summary.presentCount],
    ['未出席人數', summary.absentCount],
    ['出席率', `${summary.rate}%`],
    ['遲到人數', summary.lateCount],
    ['準時人數', summary.onTimeCount],
    ['已簽退人數', summary.leftCount],
    ['未簽退人數', summary.notLeftCount],
    ['平均停留', summary.avgStayText],
    ['每人費用', formatMoney(event.fee_amount)],
    ['應收', formatMoney(summary.expectedFee)],
    ['實收', formatMoney(summary.collectedFee)],
    ['未繳費人數', summary.unpaidCount],
  ];
  for (const row of rows) stats.addRow(row);
  stats.addRow([]);
  stats.addRow(['餐飲', '人數']);
  for (const [meal, count] of summary.meals) stats.addRow([meal, count]);
  stats.addRow([]);
  stats.addRow(['簽到方式', '人次']);
  for (const item of summary.methods) stats.addRow([item.label, item.count]);

  const headerRow = stats.getRow(6);
  headerRow.font = { bold: true };
  setWidths(stats, [18, 24]);

  return workbook.xlsx.writeBuffer();
}

export async function buildCsvWorkbook({ name, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name.slice(0, 28) || '名單');
  for (const row of rows) sheet.addRow(row);
  styleHeader(sheet);
  return workbook.xlsx.writeBuffer();
}
