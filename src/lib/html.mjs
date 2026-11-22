// 極簡 HTML 模板：html`` 會自動轉義插值，Raw 代表「已是安全 HTML」。

export class Raw {
  constructor(value) {
    this.value = String(value ?? '');
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new Raw(value);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value === true) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}

export function renderToString(value) {
  return renderValue(value);
}

/** 把表單送出後的提示轉成可放進 query string 的短代碼，避免在網址帶中文句子。 */
export const MESSAGES = {
  saved: '已儲存。',
  created: '已建立。',
  deleted: '已刪除。',
  added: '已加入名單。',
  removed: '已從名單移除。',
  imported: '匯入完成。',
  checkedin: '簽到成功。',
  checkedout: '簽退成功。',
  undone: '已撤銷。',
  token: '已重新產生 QR 連結，舊的 QR 即時失效。',
  paid: '已更新繳費狀態。',
  login: '請先登入。',
  denied: '你沒有權限做這個操作。',
  invalid: '資料有誤，請檢查後再試。',
  duplicate: '這個人已經在名單內。',
  full: '名額已滿。',
  closed: '聚會已結束，不能再簽到。',
  notstarted: '聚會未開放簽到。',
};

export function messageText(code) {
  return MESSAGES[code] || '';
}
