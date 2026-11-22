# 部署到 Hosting

這份文件講三種上線方式，由最推薦到最快：

| 方案 | 月費（約） | 難度 | HTTPS | 適合 |
|---|---|---|---|---|
| A. VPS + Docker + Caddy | HK$40–80 | 中 | 自動 | 長期使用、有自己域名 |
| B. PaaS（Zeabur／Railway／Fly.io） | HK$0–80 | 低 | 平台提供 | 不想管伺服器 |
| C. 辦公室電腦 + Cloudflare Tunnel | HK$0 | 低 | 自動 | 想即刻用、不想租機器 |
| D. Google Cloud（Compute Engine） | HK$70–120 | 中 | 自動 | 想放在 GCP；另有專文 **[deploy-gcp.md](deploy-gcp.md)** |

> 用 Google Cloud 的話請直接看 [deploy-gcp.md](deploy-gcp.md)：Cloud Run 不支援持久磁碟，不適合這個系統；要用 Compute Engine VM。

---

## 0. 先搞清楚：它不是靜態網站

這個系統是「一個一直執行的 Node 程序 ＋ 一個 SQLite 資料庫檔案」。所以：

**可以用**
- VPS（DigitalOcean、Hetzner、Vultr、阿里雲／騰訊雲輕量、Linode…）
- 支援 Dockerfile ＋ 持久磁碟（Volume）的 PaaS
- 自己的電腦 ＋ 隧道（Tunnel）

**不可以用**
- Vercel／Netlify／Cloudflare Pages：serverless，檔案系統每次重置，SQLite 會消失
- cPanel／Plesk 那種共享主機：只跑 PHP，不能長駐 Node 程序
- 任何「只能上傳 HTML 檔案」的空間

**三個硬性條件**
1. Node.js **22 或以上**
2. 有一個**可寫入而且不會被清空**的目錄（掛到 `/data`）
3. **只跑一個實例**（SQLite 不適合多副本同時寫入）

---

## 1. 共通設定：`.env`

不管用哪個方案，正式環境的 `.env` 大概長這樣：

```env
PORT=3000
HOST=0.0.0.0
DATA_DIR=/data
APP_BASE_URL=https://checkin.example.com
ADMIN_NAME=管理員
ADMIN_PASSWORD=換一個長密碼
TLS_CERT=
TLS_KEY=
```

- `APP_BASE_URL` 一定要填正式網址，否則 QR code 會印成 `http://localhost:3000`，手機會掃不到。
- `TLS_CERT`／`TLS_KEY` 留空：HTTPS 交給 Caddy 或平台處理。
- 首次啟動會用 `ADMIN_PASSWORD` 建立管理員；之後改這個變數**不會**改密碼，要用 `npm run user -- reset 管理員`。

---

## 2. 方案 A：VPS + Docker（推薦）

### 2.1 租機器
1 vCPU / 1 GB RAM / 20 GB SSD 已足夠（200 人規模）。系統選 Ubuntu 24.04 LTS。

### 2.2 安裝 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 重新登入後生效
```

### 2.3 放上程式

用 Git：
```bash
git clone <你的 repo> /opt/attendance
cd /opt/attendance
```
沒有 Git 就用 SFTP（FileZilla／WinSCP）把整個資料夾上傳，**不要上傳** `node_modules`、`data`、`.env`。

### 2.4 建立 `.env`

```bash
cp .env.example .env
nano .env
```
填入 `APP_BASE_URL` 與 `ADMIN_PASSWORD`。

### 2.5 啟動

```bash
mkdir -p data
sudo chown 1000:1000 data        # 容器以 uid 1000 執行
docker compose up -d --build
docker compose logs -f      # 看到「聚會簽到已啟動」就成功
```

此時只有本機 `127.0.0.1:3000` 可連，還未對外。

### 2.6 反向代理 + 自動 HTTPS（Caddy）

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

把 `deploy/Caddyfile` 的域名改成你的，然後：

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

DNS 的 A 記錄要先指向這台機器，Caddy 會自動申請憑證（80／443 要通）。

### 2.7 防火牆

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```
**不要**對外開 3000；它只給 Caddy 用。

### 2.8 更新版本

```bash
cd /opt/attendance
git pull
docker compose up -d --build
```

---

## 3. 方案 B：PaaS（Zeabur／Railway／Fly.io）

PaaS 的好處是不用管主機、憑證、更新；代價是三個設定做錯就會出事。

### 3.0 三個共通前提

| 前提 | 做錯的後果 |
|---|---|
| 程式放在 GitHub | PaaS 由 repo 建置，不能用 FTP |
| Volume 掛到 `/data` | 每次重新部署，名單與簽到全部消失 |
| 實例數固定 1 | SQLite 同時被兩個容器寫入會鎖死 |

環境變數（三個平台都一樣）：

```env
DATA_DIR=/data
HOST=0.0.0.0
PORT=3000
ADMIN_PASSWORD=換一個長密碼
APP_BASE_URL=          # 先留空，拿到網域後再填
```

### 3.1 先把程式放上 GitHub

在專案資料夾執行（第一次需要設定 Git 身分）：

```bash
cd attendance
git init
git config user.name "你的名字"
git config user.email "you@example.com"
git add .
git commit -m "聚會簽到系統"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

`.gitignore` 已排除 `node_modules`、`data`、`.env`，所以密碼與個資不會被推上去。
不想用命令列就用 GitHub Desktop：Add local repository → Publish repository（可設 Private）。

### 3.2 Zeabur（中文介面，推薦）

1. 到 [zeabur.com](https://zeabur.com) 用 GitHub 登入 → **New Project**，地區選香港／東京／新加坡。
2. **Add Service → Git**，授權並選擇你的 repo。它會偵測到 `Dockerfile` 自動建置。
3. **先加 Volume 才部署**：Service → **Volumes** → Add Volume → mount path 填 `/data`（1 GB 夠用）。
4. **Variables** 貼上上面五個變數（`APP_BASE_URL` 先留空）。
5. **Networking → Generate Domain**，得到類似 `https://checkin.zeabur.app`。
6. 回到 Variables，把 `APP_BASE_URL` 設成該網址 → **Redeploy**。
7. 開網址，用 `ADMIN_PASSWORD` 登入；到「聚會」頁建一個聚會，確認 QR 內的網址是 `https://` 開頭。

> 若部署時看到 `unable to open database file`，就是第 3 步的 Volume 沒掛好。

### 3.3 Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**。
2. 選 repo，Railway 會用 `Dockerfile` 建置（專案已附 `railway.json`，健康檢查打 `/login`）。
3. 服務頁 → **Variables → New Volume**，mount path 填 `/data`。
4. 同頁 **Variables** 加入上面五個環境變數。
5. **Settings → Networking → Generate Domain**，取得 `https://xxx.up.railway.app`。
6. 把 `APP_BASE_URL` 設成該網址 → 重新部署。
7. Deployments → View Logs，見到「聚會簽到已啟動」即成功。

### 3.4 Fly.io

```bash
fly launch --no-deploy                 # 沿用 Dockerfile
fly volumes create checkin_data --size 1 --region hkg
fly secrets set ADMIN_PASSWORD='你的密碼'
fly deploy
fly open
```

`fly.toml` 加入：

```toml
[env]
  PORT = "3000"
  HOST = "0.0.0.0"
  DATA_DIR = "/data"

[[mounts]]
  source = "checkin_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1
```

拿到網址後補上 `fly secrets set APP_BASE_URL='https://xxx.fly.dev'`。`min_machines_running = 1` 很重要：機器一睡，現場掃描要等十幾秒。

### 3.5 PaaS 專屬注意事項

- **不要在活動進行中部署**：重新部署會重啟容器，簽到會中斷十幾秒。
- **活動前先喚醒**：免費方案會休眠，活動開始前 30 分鐘先開一次首頁。
- **備份**：PaaS 沒有 shell，但網站本身有出口 —— 登入後到「帳號」頁按 **下載備份 .db**（用 `VACUUM INTO` 做一致性快照，可直接還原）。
- **換網域要重印 QR**：`APP_BASE_URL` 改了之後，舊 QR 仍指向舊域名；到聚會頁重新產生 QR。
- **上傳限制**：CSV 名單一次 5 MB 以內（約一萬行）。
- **費用**：活動月份建議用付費方案，避免半夜被休眠或超額被停。

---

## 4. 方案 C：辦公室電腦 + Cloudflare Tunnel（最快）

好處：**零月費、自動 HTTPS（平板可以開相機）、不用在路由器開端口、可以綁自己的域名**。
代價：電腦要長開，網絡斷了就不能簽到（區網內仍可用內網 IP 連）。

### 4.1 先讓網站在本機跑起來
```powershell
cd C:\path\to\attendance
start.bat
```
確認 `http://localhost:3000` 打得開。

### 4.2 安裝 cloudflared
```powershell
winget install --id Cloudflare.cloudflared
```

### 4.3 快速測試（隨機網址，重開會變）
```powershell
cloudflared tunnel --url http://localhost:3000
```
畫面會給你一條 `https://xxxx.trycloudflare.com`，手機直接開得到，相機也可用。適合先試。

### 4.4 長期使用（固定域名）
```powershell
cloudflared tunnel login
cloudflared tunnel create checkin
cloudflared tunnel route dns checkin checkin.example.com
cloudflared tunnel run --url http://localhost:3000 checkin
```

安裝成 Windows 服務，開機自動跑：
```powershell
cloudflared service install
```

最後把 `.env` 的 `APP_BASE_URL` 改成 `https://checkin.example.com`，重啟網站，QR code 才會正確。

> 別忘了關掉電腦的睡眠：設定 → 系統 → 電源 → 螢幕與睡眠 → 插電時「永不」。

---

## 5. 上線前檢查清單

- [ ] `ADMIN_PASSWORD` 已改成強密碼，並成功登入一次
- [ ] `APP_BASE_URL` 是正式網址，QR 用手機掃一次確認開到正確頁面
- [ ] 只開放 80／443（Docker 的 3000 不對外）
- [ ] 平板開「現場簽到」，鏡頭權限正常
- [ ] 匯入一次真實名單、匯出一次 Excel，中文正常
- [ ] 主機時間準確（`timedatectl` 或 Windows 自動校時）
- [ ] 設定每日備份（見下）

### 備份排程

Docker：
```bash
# 每天 02:30
30 2 * * * cd /opt/attendance && docker compose exec -T attendance node scripts/backup.mjs
```
備份會寫進 Volume 的 `/data/backups/`，用 `docker compose cp attendance:/data/backups ./backups` 取回本機。

非 Docker（systemd）：
```bash
30 2 * * * cd /opt/attendance && sudo -u attendance /usr/bin/node --env-file-if-exists=.env scripts/backup.mjs
```

還原：停服務 → 把備份檔改名為 `attendance.db` 覆蓋 `data/` 內檔案 → 刪除 `attendance.db-wal`、`attendance.db-shm` → 啟動。

---

## 6. 常見問題

| 症狀 | 原因 |
|---|---|
| `docker compose up` 後即退出 | `docker compose logs attendance` 看錯誤；多數是 `.env` 格式或權限 |
| 500，日誌說 `unable to open database file` | `/data` 沒掛載或不可寫；用 named volume 或 `chown 1000:1000 ./data` |
| QR code 指向 `localhost` | `.env` 的 `APP_BASE_URL` 沒填或未重啟 |
| 登入後即刻被登出 | 用 http 訪問但 cookie 帶了 Secure；確認反向代理有傳 `X-Forwarded-Proto`（Caddy 預設會） |
| 上傳 CSV 失敗 | 檔案超過 5 MB；分批匯入 |
| 相機打不開 | 不是 HTTPS，也不是 localhost；或平板未授權相機 |
| PaaS 部署後資料不見 | Volume 沒掛到 `/data`，或開了多個副本 |

---

## 7. 安全建議

- 只給工作人員帳號，不要共用管理員。
- 活動結束後把聚會設為「已結束」，QR 即無法再簽到。
- 懷疑 QR 外流：聚會頁 → 重新產生 QR，舊連結即時失效。
- 定期 `npm update` 與備份；資料庫檔案含個資，備份也要保管好。
