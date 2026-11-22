#!/usr/bin/env node
// 啟動器：給雙擊 start.bat 的人用。
// 批次檔本身只寫 ASCII（避免中文 Windows 的 CP950 把 UTF-8 鋸開），
// 中文提示、檢查、安裝、啟動全部在這裡做。
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);

const say = (text = '') => console.log(text);
const fail = (text) => {
  console.error(`\n  ✗ ${text}\n`);
  process.exit(1);
};

// ---------- Node 版本 ----------
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 9)) {
  fail(`需要 Node.js 22.9 或以上，目前是 ${process.versions.node}。請到 https://nodejs.org/ 更新。`);
}

// ---------- .env ----------
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  say('已建立 .env（之後可改 PORT 與管理員密碼）。');
}
const fileEnv = readEnvFile('.env');
for (const [key, value] of Object.entries(fileEnv)) {
  // 真正的環境變數優先，方便臨時改 PORT 測試
  if (value !== '' && process.env[key] === undefined) process.env[key] = value;
}

const port = Number(process.env.PORT || 3000);
const httpsMode = Boolean(process.env.TLS_CERT && process.env.TLS_KEY);
const protocol = httpsMode ? 'https' : 'http';
const url = `${protocol}://localhost:${port}`;

function openBrowser(target) {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true })
        : process.platform === 'darwin'
          ? spawn('open', [target], { stdio: 'ignore', detached: true })
          : spawn('xdg-open', [target], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 開不到瀏覽器不是錯誤
  }
}

// ---------- 已經在運行？ ----------
async function alreadyRunning() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${url}/login`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

if (await alreadyRunning()) {
  say('');
  say('  聚會簽到已經在運行。');
  say(`  ${url}`);
  say('');
  openBrowser(url);
  process.exit(0);
}

// ---------- 依賴 ----------
if (!existsSync(path.join('node_modules', 'better-sqlite3', 'package.json'))) {
  say('第一次啟動：安裝套件，大約 1–2 分鐘…');
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    fail('套件安裝失敗。請確認網絡連線，或在命令提示字元執行 npm install 看詳細錯誤。');
  }
}

// ---------- 資料庫 ----------
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const dbFile = path.join(dataDir, 'attendance.db');
if (!existsSync(dbFile)) {
  say('第一次啟動：建立資料庫與管理員帳號…');
  for (const script of ['scripts/migrate.mjs', 'scripts/seed.mjs']) {
    const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) fail(`${script} 執行失敗，請看上面的錯誤訊息。`);
  }
  say('');
  say('  ⚠ 上面顯示的管理員密碼只會出現一次，請立即記下。');
  say('    忘記的話可以執行：npm run user -- reset 管理員');
  say('');
}

// ---------- 啟動 ----------
say('');
say('  聚會簽到啟動中…');
say(`  網址：${url}`);
say('  按 Ctrl+C 可以停止');
say('');

const server = spawn(process.execPath, ['server.mjs'], {
  stdio: 'inherit',
  env: process.env,
});
server.on('error', (error) => fail(`無法啟動伺服器：${error.message}`));
server.on('exit', (code) => process.exit(code ?? 0));

setTimeout(() => openBrowser(url), 2500);
