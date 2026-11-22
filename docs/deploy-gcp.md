# 部署到 Google Cloud（Compute Engine）

## 0. 為什麼不是 Cloud Run

Google Cloud 上最直覺的選擇是 Cloud Run，但這個系統不適合：

| 服務 | 能不能用 | 原因 |
|---|---|---|
| **Compute Engine（VM）** | ✅ 建議 | 有真實磁碟、可長時間執行、資料就是一個檔案 |
| Cloud Run | ⚠️ 不建議 | 沒有持久磁碟。掛 GCS FUSE 跑 SQLite，檔案鎖與延遲會導致寫入失敗甚至損毀；而且會 scale to zero、多個 revision 同時存在 |
| Cloud Run + Cloud SQL | 🔧 可以，但要改程式 | 需把 `better-sqlite3` 換成 Postgres（Cloud SQL），資料層要重寫 |
| GKE Autopilot | ❌ 過度 | 為一個容器開叢集，成本與複雜度都不合理 |
| App Engine | ❌ | 本機檔案系統不可靠，同樣要配 Cloud SQL |

**結論**：開一台 VM，用 Docker 跑，跟 VPS 一樣，但資料搬移可以直接 `gcloud compute scp`。

---

## 1. 架構

```
手機／平板 ──HTTPS──> Caddy（VM 上的反向代理，自動憑證）
                          │
                          └──> Docker 容器 :3000（Node + SQLite）
                                    │
                                    └──> /opt/attendance/data/attendance.db
```

---

## 2. 建立 VM

### 2.1 保留靜態 IP（先做，避免重開機換 IP）

```bash
gcloud compute addresses create checkin-ip --region=asia-east1
gcloud compute addresses describe checkin-ip --region=asia-east1 --format='get(address)'
```

Console：VPC network → IP addresses → Reserve external static address。

> 這一步很重要：IP 一換，域名與已印出的 QR 都會失效。

### 2.2 開機器（gcloud）

```bash
gcloud compute instances create checkin-vm \
  --zone=asia-east1-b \
  --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --address=checkin-ip \
  --tags=http-server,https-server \
  --metadata=repo-url=https://github.com/<你的帳號>/gathering-checkin.git \
  --metadata-from-file=startup-script=deploy/gcp-startup.sh \
  --scopes=cloud-platform
```

`--scopes=cloud-platform` 是為了讓 VM 之後能直接 `gcloud storage cp` 備份到 Cloud Storage。

### 2.3 開機器（Console）

1. Compute Engine → **Create instance**
2. 名稱 `checkin-vm`，地區 **asia-east1（台灣）** 或 **asia-east2（香港）**
3. 機器類型 **e2-small**（2 vCPU / 2 GB）
4. 開機磁碟 **Ubuntu 24.04 LTS**，20 GB 平衡型
5. **Networking → External IP** 選剛剛保留的 `checkin-ip`
6. **Management → Metadata** 加一組：key `repo-url`，value 你的 GitHub repo
7. **Automation → Startup script** 貼上 `deploy/gcp-startup.sh` 的內容
8. 建立

### 2.4 開放 80／443

```bash
gcloud compute firewall-rules create allow-checkin-web \
  --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server,https-server
```

22 端口用 Google 預設的 `default-allow-ssh`，或者改用 IAP：

```bash
gcloud compute ssh checkin-vm --zone=asia-east1-b --tunnel-through-iap
```

---

## 3. 首次部署

開機腳本會裝好 Docker 並把程式放到 `/opt/attendance`（約 1–2 分鐘）。

```bash
gcloud compute ssh checkin-vm --zone=asia-east1-b
cd /opt/attendance

cp .env.example .env
nano .env
```

`.env` 至少改這兩個：

```env
ADMIN_PASSWORD=一個長密碼
APP_BASE_URL=https://checkin.你的域名    # 未有域名可先留空，第 4 節會補
```

啟動：

```bash
sudo mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose logs -f        # 見到「聚會簽到已啟動」就成功
```

此刻只有 VM 本機連得到 `127.0.0.1:3000`，對外仍是空的。

---

## 4. HTTPS（相機要用，一定要做）

### 4.1 有域名

1. 在你的域名商把 `checkin.example.com` 的 A 記錄指向靜態 IP。
2. 安裝 Caddy：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

3. 把 `deploy/Caddyfile` 的域名改成你的，複製到 `/etc/caddy/Caddyfile`，然後 `sudo systemctl reload caddy`。
4. 回 `.env` 填 `APP_BASE_URL=https://checkin.example.com`，`docker compose up -d` 重啟。

### 4.2 沒有域名（用 sslip.io 取得免費 HTTPS）

`sslip.io` 會把 IP 解析成域名，Caddy 可以為它申請憑證：

```bash
# 假設靜態 IP 是 34.80.12.34
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
34.80.12.34.sslip.io {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

然後 `.env`：

```env
APP_BASE_URL=https://34.80.12.34.sslip.io
```

重啟容器，手機掃 QR 就會走 HTTPS，相機可用。之後買了域名再換即可（換完要重新產生聚會 QR）。

---

## 5. 把本機資料搬上去

```bash
# 在本機的 attendance 資料夾
gcloud compute scp data/attendance.db \
  checkin-vm:/opt/attendance/data/attendance.db --zone=asia-east1-b

# 在 VM 上
cd /opt/attendance
docker compose up -d          # 啟動時會自動跑 migration，資料直接沿用
```

若 VM 已經有資料，先在網站「帳號 → 下載備份」，或 `docker compose exec attendance node scripts/backup.mjs`，再覆蓋。

> 建議搬移前先停容器，避免 WAL 檔案沒合併：`docker compose stop`。

---

## 6. 備份

### 6.1 每日快照到 Cloud Storage

```bash
gcloud storage buckets create gs://checkin-backups-<你的專案ID> \
  --location=asia-east1 --uniform-bucket-level-access
```

VM 上的 crontab（`crontab -e`）：

```cron
30 2 * * * cd /opt/attendance && docker compose exec -T attendance node scripts/backup.mjs && gcloud storage cp data/backups/*.db gs://checkin-backups-<專案ID>/ --quiet
```

備份檔在 `data/backups/`，最多保留 14 份；同時上傳到 bucket。

設定 bucket 自動清理舊檔（保留 90 天）：

```bash
cat > /tmp/lifecycle.json <<'EOF'
{
  "rule": [
    {"action": {"type": "Delete"}, "condition": {"age": 90}}
  ]
}
EOF
gcloud storage buckets update gs://checkin-backups-<專案ID> --lifecycle-file=/tmp/lifecycle.json
```

### 6.2 磁碟快照（整台機器）

Console：Compute Engine → Storage → Snapshots → **Snapshot schedules** → 每日 02:00、保留 14 天，然後套用到這台 VM 的開機磁碟。這是最後一道保險，連同 `.env` 一起備份。

---

## 7. 更新與開機行為

```bash
cd /opt/attendance
git pull
docker compose up -d --build
```

- 容器設定了 `restart: unless-stopped`，VM 重開機會自動起回來。
- 更新時會中斷簽到十幾秒，**不要在活動進行中部署**。
- 資料庫 migration 只會新增欄位，不會刪資料；但仍建議更新前先備份。

---

## 8. 監控（選用，免費額度內）

```bash
gcloud monitoring uptime create checkin-uptime \
  --resource-type=uptime-url \
  --host=checkin.example.com \
  --path=/login \
  --port=443 \
  --protocol=https
```

再在 Cloud Monitoring 設一個「網站不通就 email 我」的 alerting policy。

---

## 9. 成本（asia-east1，約數）

| 項目 | 月費（US$） |
|---|---|
| e2-small（2 vCPU / 2 GB） | 約 13–14 |
| e2-micro（0.25–2 vCPU / 1 GB） | 約 6–7（記憶體較緊，建置時建議先加 swap） |
| 20 GB 平衡型磁碟 | 約 2 |
| 靜態 IP（已掛在 VM 上） | 0 |
| 對外流量 | 簽到用量很小，通常 < US$1 |
| Cloud Storage 備份（幾百 MB） | < US$0.1 |

合計約 **US$15/月（HK$120）**，用 e2-micro 可壓到 **US$9**。實際請用 Google Cloud Pricing Calculator 按你的地區確認。

---

## 10. 疑難排解

| 症狀 | 處理 |
|---|---|
| 開機腳本沒跑完 | `sudo journalctl -u google-startup-scripts -b` 看日誌 |
| `docker compose` 說 permission denied | 重新登入，或 `sudo docker compose ...` |
| 容器一直重啟 | `docker compose logs attendance`；多數是 `.env` 或 `data/` 權限 |
| Caddy 拿不到憑證 | DNS 未生效、80 端口被擋、或域名已用過憑證（換域名或等冷卻） |
| 網站很慢 | 確認 VM 地區在 asia-east1／asia-east2，不是 us |
| 重開機後 QR 失效 | 忘了保留靜態 IP，IP 變了；重新綁定並更新 DNS |

---

## 11. 之後想改成 Cloud Run？

可以，但要把資料層從 SQLite 換成 Cloud SQL（PostgreSQL）：

- 新增 `src/lib/db.pg.mjs` 與 migration
- 改寫 `store.mjs` 的 SQL（`?` → `$1`、時間型別、`ON CONFLICT`）
- 加 Cloud SQL connector 或 private IP
- 費用會由「一台 VM」變成「Cloud Run + Cloud SQL」，大約 US$20–30/月起

好處是 scale to zero、自動 HTTPS、免管主機。以 200 人規模的聚會，通常不值得，除非你要同時給多個組織用。
