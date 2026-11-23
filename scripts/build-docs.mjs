#!/usr/bin/env node
// 把 docs/*.md 轉成可直接打開的單檔 HTML（無外部依賴、可列印）。
// 用法：node scripts/build-docs.mjs
// 會產生 docs/prompt.html 與 docs/plan.html
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const docsDir = path.join(root, 'docs');

const TITLES = {
  'promptv2.md': '聚會簽到系統 — 提示詞',
  'prompt.md': '聚會簽到系統 — 提示詞',
  'plan.md': '聚會簽到系統 — 設計與資料模型',
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行內格式：先轉義，再處理 code / 粗體 / 連結。 */
function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = String(href).replace(/\.md(#|$)/, '.html$1');
    const absolute = /^https?:/.test(target) ? ' target="_blank" rel="noreferrer"' : '';
    return `<a href="${target}"${absolute}>${label}</a>`;
  });
  return out;
}

function stripMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function slug(index) {
  return `s${index}`;
}

function convert(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  let guard = 0;
  let headingCount = 0;
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    const items = listItems.map((item) => `<li>${inline(item)}</li>`).join('\n');
    out.push(`<${listType}>\n${items}\n</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    out.push(`<blockquote><p>${inline(quoteLines.join(' '))}</p></blockquote>`);
    quoteLines = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  while (i < lines.length) {
    guard += 1;
    if (guard > 200000) {
      throw new Error(`解析卡住，在第 ${i + 1} 行：${String(lines[i]).slice(0, 80)}`);
    }
    const line = lines[i];

    // 程式碼區塊
    if (/^```/.test(line)) {
      flushAll();
      const lang = line.slice(3).trim();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳過結尾 fence
      const body = escapeHtml(code.join('\n'));
      const rawClass = lang === 'text' && body.length > 1500 ? ' class="raw"' : '';
      const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      out.push(`<div class="code-wrap">${label}<pre${rawClass}><code>${body}</code></pre></div>`);
      continue;
    }

    // 標題
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      headingCount += 1;
      const id = slug(headingCount);
      if (level === 1) {
        out.push(`<h1 id="${id}">${inline(text)}</h1>`);
      } else if (level === 2) {
        toc.push({ id, text: stripMarkdown(text), level: 2 });
        out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      } else {
        toc.push({ id, text: stripMarkdown(text), level: 3 });
        out.push(`<h3 id="${id}">${inline(text)}</h3>`);
      }
      i += 1;
      continue;
    }

    // 分隔線
    if (/^---+\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 表格
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushAll();
      const parseRow = (row) =>
        row
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i += 1;
      }
      const thead = head.map((cell) => `<th>${inline(cell)}</th>`).join('');
      const tbody = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('\n');
      out.push(`<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      quoteLines.push(line.replace(/^>\s?/, ''));
      i += 1;
      continue;
    }

    // 無序清單
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(bullet[1]);
      i += 1;
      continue;
    }

    // 有序清單
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(numbered[1]);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushAll();
  return { html: out.join('\n'), toc };
}

const CSS = `
:root {
  --bg: #f4f2ec; --surface: #fff; --ink: #1b211d; --ink-soft: #37403a;
  --muted: #6c756e; --line: #e2ded2; --brand: #2f5d50; --brand-soft: #e7efe9;
  --code-bg: #1d2622; --code-ink: #dcece4;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Segoe UI", system-ui, sans-serif;
  line-height: 1.75; font-size: 16px;
}
.top {
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 16px;
  padding: 10px 20px; background: rgba(244,242,236,.92); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.brand { font-weight: 700; letter-spacing: .02em; }
.brand span { color: var(--brand); }
.actions { margin-left: auto; display: flex; gap: 8px; }
button {
  font: inherit; font-size: 14px; padding: 7px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink);
}
button:hover { border-color: var(--brand); }
button.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto; padding: 28px 20px 90px; }
.toc { position: sticky; top: 74px; align-self: start; font-size: 14px; max-height: calc(100vh - 100px); overflow: auto; }
.toc h2 { font-size: 12px; letter-spacing: .12em; color: var(--muted); text-transform: uppercase; margin: 0 0 10px; }
.toc a { display: block; padding: 4px 0 4px 10px; color: var(--ink-soft); text-decoration: none; border-left: 2px solid transparent; }
.toc a:hover { color: var(--brand); }
.toc a.level-3 { padding-left: 22px; font-size: 13px; color: var(--muted); }
.toc a.active { border-left-color: var(--brand); color: var(--brand); font-weight: 600; }
.doc { max-width: 800px; min-width: 0; }
.doc h1 { font-size: 1.9rem; line-height: 1.3; margin: 8px 0 18px; letter-spacing: -.01em; }
.doc h2 { font-size: 1.28rem; margin: 38px 0 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.doc h3 { font-size: 1.05rem; margin: 24px 0 8px; color: var(--brand); }
.doc p { margin: 0 0 14px; }
.doc ul, .doc ol { margin: 0 0 16px; padding-left: 22px; }
.doc li { margin: 4px 0; }
.doc li::marker { color: var(--brand); }
.doc strong { font-weight: 700; }
.doc code {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: .9em;
  background: #eae6db; padding: .12em .38em; border-radius: 5px;
}
.doc a { color: var(--brand); text-underline-offset: 3px; }
.doc hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
.doc blockquote {
  margin: 0 0 16px; padding: 10px 16px; border-left: 3px solid var(--brand);
  background: var(--brand-soft); color: var(--ink-soft); border-radius: 0 8px 8px 0;
}
.doc blockquote p { margin: 0; }
.table-wrap { overflow-x: auto; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; background: var(--surface); }
th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #eceade; font-weight: 600; }
.code-wrap { position: relative; margin: 0 0 18px; }
.code-lang {
  position: absolute; top: 8px; right: 42px; font-size: 11px; letter-spacing: .08em;
  color: #9db3a8; text-transform: uppercase;
}
pre {
  margin: 0; background: var(--code-bg); color: var(--code-ink); padding: 16px;
  border-radius: 12px; overflow-x: auto; font-size: 13px; line-height: 1.65;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
}
pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
.copy-code {
  position: absolute; top: 8px; right: 8px; font-size: 12px; padding: 4px 9px;
  background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.28); color: #eaf3ee;
}
.copy-code:hover { background: rgba(255,255,255,.22); }
.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px);
  background: var(--brand); color: #fff; padding: 9px 18px; border-radius: 999px;
  font-size: 14px; opacity: 0; pointer-events: none; transition: all .25s;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; gap: 20px; padding-top: 18px; }
  .toc { position: static; max-height: none; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--surface); }
  .toc a { display: inline-block; margin-right: 12px; padding: 2px 0; border: 0; }
  .toc a.level-3 { display: none; }
  .doc h1 { font-size: 1.5rem; }
}
@media print {
  .top, .toc, .copy-code, .toast { display: none !important; }
  .layout { display: block; max-width: none; padding: 0; }
  body { background: #fff; font-size: 11pt; }
  .doc { max-width: none; }
  pre { background: #f4f4f4; color: #111; border: 1px solid #ccc; white-space: pre-wrap; word-break: break-word; }
  .doc h2 { break-after: avoid; }
  table { font-size: 9.5pt; }
  a { color: #000; text-decoration: none; }
  @page { margin: 14mm; }
}
`;

const SCRIPT = `
(function () {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = '已複製';
  document.body.appendChild(toast);
  let timer;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      area.remove();
      return ok;
    }
  }

  document.querySelectorAll('.code-wrap').forEach((wrap) => {
    const pre = wrap.querySelector('pre');
    if (!pre) return;
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.textContent = '複製';
    button.addEventListener('click', async () => {
      const ok = await copy(pre.innerText);
      showToast(ok ? '已複製' : '請手動選取複製');
    });
    wrap.appendChild(button);
  });

  const raw = document.querySelector('pre.raw');
  const copyAll = document.querySelector('[data-copy-all]');
  if (copyAll && raw) {
    copyAll.addEventListener('click', async () => {
      const ok = await copy(raw.innerText);
      showToast(ok ? '已複製整份提示詞' : '請手動選取複製');
    });
  } else if (copyAll) {
    copyAll.hidden = true;
  }

  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());

  const links = [...document.querySelectorAll('.toc a')];
  const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
        }
      },
      { rootMargin: '-15% 0px -75% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
  }
})();
`;

function renderPage({ title, html, toc, file }) {
  const tocHtml = toc
    .map(
      (item) =>
        `<a href="#${item.id}" class="level-${item.level}">${escapeHtml(item.text)}</a>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand">聚會簽到 <span>· 文件</span></div>
  <div class="actions">
    <button type="button" class="primary" data-copy-all>複製全文</button>
    <button type="button" data-print>列印 / 存 PDF</button>
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="目錄">
    <h2>目錄</h2>
    ${tocHtml}
  </nav>
  <main class="doc">
${html}
  </main>
</div>
<div class="hint" style="display:none">source: ${escapeHtml(file)}</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const files = process.argv.slice(2);
const targets = files.length ? files : ['promptv2.md', 'plan.md'];
const generated = [];

for (const name of targets) {
  const sourcePath = path.join(docsDir, name);
  if (!fs.existsSync(sourcePath)) {
    console.error(`找不到 ${sourcePath}`);
    process.exitCode = 1;
    continue;
  }
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const { html, toc } = convert(markdown);
  const title = TITLES[name] || name.replace(/\.md$/, '');
  const outputName = name.replace(/\.md$/, '.html');
  const outputPath = path.join(docsDir, outputName);
  const page = renderPage({ title, html, toc, file: name });
  fs.writeFileSync(outputPath, page, 'utf8');
  const size = (Buffer.byteLength(page, 'utf8') / 1024).toFixed(0);
  generated.push({ file: outputName, title, size, sections: toc.length });
  console.log(`✓ docs/${outputName}  ${size} KB  ${toc.length} 個目錄項目`);
}

if (generated.length > 0) {
  const cards = generated
    .map(
      (item) => `<a class="card" href="${item.file}">
        <h2>${escapeHtml(item.title)}</h2>
        <p>${item.sections} 個章節 · ${item.size} KB</p>
        <span class="open">開啟 →</span>
      </a>`,
    )
    .join('\n');

  const index = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>聚會簽到 · 文件</title>
<style>
  body { margin: 0; background: #f4f2ec; color: #1b211d;
         font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 64px 20px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .lead { color: #6c756e; margin: 0 0 32px; }
  .card { display: block; background: #fff; border: 1px solid #e2ded2; border-radius: 14px;
          padding: 20px 22px; margin-bottom: 12px; text-decoration: none; color: inherit;
          transition: border-color .15s, transform .1s; }
  .card:hover { border-color: #2f5d50; transform: translateY(-1px); }
  .card h2 { font-size: 1.05rem; margin: 0 0 4px; }
  .card p { margin: 0; font-size: 13px; color: #6c756e; }
  .card .open { display: inline-block; margin-top: 10px; color: #2f5d50; font-weight: 600; font-size: 14px; }
  footer { margin-top: 28px; font-size: 12px; color: #6c756e; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>聚會簽到 · 文件</h1>
    <p class="lead">可直接開啟、列印或存成 PDF。這幾頁是從 Markdown 產生的，改完 Markdown 執行 <code>npm run docs</code> 會重新產生。</p>
    ${cards}
    <footer>聚會簽到系統 · 本機文件，不含任何個人資料</footer>
  </div>
</body>
</html>
`;
  fs.writeFileSync(path.join(docsDir, 'index.html'), index, 'utf8');
  console.log(`✓ docs/index.html  ${(Buffer.byteLength(index, 'utf8') / 1024).toFixed(0)} KB`);
}
