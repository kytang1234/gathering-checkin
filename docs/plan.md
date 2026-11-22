# 聚會簽到系統 — 實作計畫與資料模型（v0.2）

> 依 2026-11-22 討論調整：換技術棧、加簽退／遲到、聚會欄位加多、部署環境改為區網自架
> 專案位置：`default-workspace/attendance/`

---

## 1. 與 v0.1 的差異

| 項目 | v0.1 | v0.2 |
|---|---|---|
| 技術棧 | Next.js 15 + React | **純 Node.js `node:http` + 伺服器端 HTML**，零建置 |
| 簽退 | 無 | 工作人員簽退＋（可選）自助簽退，計停留時間 |
| 遲到 | 無 | 依聚會開始時間＋寬限分鐘自動標記 |
| 聚會欄位 | 6 個 | 加名額、費用、聯絡人、餐飲選項、報名截止、自助開關 |
| 名單欄位 | 姓名／電話／組別 | 加桌號、餐飲選擇、已繳費 |
| 部署 | 未定 | 單一 Node 程序跑在區網主機，平板／手機連入；資料為本機 SQLite 檔 |

---

## 2. 技術選型（v0.2）

| 層 | 選擇 | 理由 |
|---|---|---|
| 執行環境 | Node.js 22（ESM，`.mjs`） | 已確認本機可用；無 TypeScript 編譯步驟，改完即生效 |
| HTTP | `node:http` ＋ 自寫小路由器（`/events/:id/checkin` 風格） | 需求只有 12 條路由，框架帶來的抽象大於好處 |
| 畫面 | 伺服器端字串模板 ＋ 自動轉義的 `html` tagged template | 無 hydration、無 bundler；手機載入極快 |
| 互動 | 少量原生 JS（掃描、搜尋、確認對話框），`fetch` JSON API | 只有掃描頁真的需要前端邏輯 |
| 資料庫 | `better-sqlite3`（WAL） | 單檔、同步 API、200 人規模綽綽有餘；已實測可安裝執行 |
| 樣式 | 自寫 CSS（變數＋語意 class） | 列印樣式、大按鈕、深色投影畫面都好控制 |
| QR 產生 | `qrcode`（伺服器端 PNG／SVG） | 純 JS，可離線 |
| QR 掃描 | `jsqr`（UMD 檔複製到 `public/vendor/`）＋ `getUserMedia` | 純 JS、不上 CDN，內網斷網也能用；另有手動輸入編號 |
| Excel | `exceljs` | 純 JS，可三個工作表、凍結首行、中文正常 |
| 密碼 | `node:crypto` scrypt | 無原生模組 |
| 測試 | `node:test` ＋ `node:assert`（內建） | 零測試相依，`node --test` 直接跑 |

**全部依賴只有 3 個**：`better-sqlite3`、`qrcode`、`exceljs`（`jsqr` 取 UMD 檔後可從 dependencies 移除）。沒有 build、沒有 transpile、沒有 dev server。

**啟動**：`npm install` → `npm run setup`（migrate＋seed）→ `npm start`。就這麼多。

---

## 3. 目錄結構

```
attendance/
├─ package.json              # type: module
├─ server.mjs                # http/https 伺服器、靜態檔、路由分派
├─ start.bat                 # Windows 一鍵啟動
├─ .env.example
├─ data/                     # attendance.db、backups/（gitignore）
├─ db/migrations/001_init.sql
├─ scripts/
│  ├─ migrate.mjs            # 依序執行未套用的 .sql，記錄 schema_migrations
│  ├─ seed.mjs               # 管理員帳號＋示範聚會
│  ├─ create-user.mjs        # CLI 新增 staff／重設密碼
│  └─ backup.mjs             # VACUUM INTO data/backups/YYYYMMDD-HHMM.db
├─ public/
│  ├─ app.css
│  ├─ scan.js                # 相機掃描頁邏輯
│  └─ vendor/jsqr.js
├─ src/
│  ├─ router.mjs             # 路徑比對、query/body 解析、錯誤處理
│  ├─ routes/{auth,events,roster,checkin,checkout,summary,publicCheckin,api,static}.mjs
│  ├─ lib/{db,auth,csrf,session,tokens,time,rules,csv,xlsx,html,http,ratelimit}.mjs
│  └─ views/{layout,login,dashboard,eventForm,event,qr,roster,checkin,summary,public}.mjs
└─ tests/*.test.mjs
```

---

## 4. 資料模型

### 4.1 關聯

```
users ──< sessions
users ──< checkins（operator；自助簽到為 NULL）
events ──< event_attendees >── attendees
events ──< checkins >── attendees        UNIQUE(event_id, attendee_id)
```

- `attendees`：全域人名庫，一個人建一次，可参加多場。
- `event_attendees`：這場聚會的名單＋場次專屬資料（桌號、餐飲、繳費）。
- `checkins`：一筆記錄同時管簽到與簽退（`checked_out_at`），成對出現才完整。

### 4.2 Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin','staff')),
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE events (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  event_date             TEXT NOT NULL,                 -- YYYY-MM-DD（當地）
  start_time             TEXT NOT NULL,                 -- HH:MM
  end_time               TEXT,                          -- 預計結束（當地）
  location               TEXT,
  notes                  TEXT,
  status                 TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','open','closed')),
  timezone               TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
  capacity               INTEGER,                       -- 名額上限，NULL＝不限
  fee_amount             INTEGER NOT NULL DEFAULT 0,    -- 每人費用，以「分」儲存
  fee_note               TEXT,                          -- 例：現場繳費、已包在月費
  contact_name           TEXT,                          -- 聚會聯絡人
  contact_phone          TEXT,
  meal_options           TEXT,                          -- JSON 陣列，例 ["葷","素"]
  registration_deadline  TEXT,                          -- 當地 YYYY-MM-DDTHH:MM
  late_after_minutes     INTEGER NOT NULL DEFAULT 15,   -- 開始後幾分鐘算遲到
  allow_self_checkin     INTEGER NOT NULL DEFAULT 1,
  allow_self_checkout    INTEGER NOT NULL DEFAULT 0,
  public_token           TEXT NOT NULL UNIQUE,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(event_date DESC);

CREATE TABLE attendees (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,                                  -- 正規化為純數字，可空
  group_name     TEXT,                                  -- 組別／部門／家庭
  notes          TEXT,
  personal_token TEXT NOT NULL UNIQUE,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_attendees_name  ON attendees(name);
CREATE INDEX idx_attendees_phone ON attendees(phone);

CREATE TABLE event_attendees (
  event_id    TEXT NOT NULL REFERENCES events(id)    ON DELETE CASCADE,
  attendee_id TEXT NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','import','walkin')),
  seat_no     TEXT,                                     -- 桌號／座位
  meal_choice TEXT,                                     -- 對應 events.meal_options
  fee_paid    INTEGER NOT NULL DEFAULT 0,
  fee_paid_at TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, attendee_id)
);
CREATE INDEX idx_ea_attendee ON event_attendees(attendee_id);

CREATE TABLE checkins (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id)    ON DELETE CASCADE,
  attendee_id      TEXT NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  checked_in_at    TEXT NOT NULL,                        -- UTC ISO，毫秒
  method           TEXT NOT NULL CHECK (method IN ('qr_self','qr_scan','manual')),
  is_late          INTEGER NOT NULL DEFAULT 0,
  late_minutes     INTEGER,                              -- 遲到幾分鐘，準時為 0
  checked_out_at   TEXT,
  checkout_method  TEXT CHECK (checkout_method IN ('qr_self','qr_scan','manual')),
  operator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (event_id, attendee_id)
);
CREATE INDEX idx_checkins_event_time ON checkins(event_id, checked_in_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- sha256(cookie token)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,             -- 每個 session 一把，表單必帶
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
```

### 4.3 幾個設計取捨

**費用存「分」而非浮點數**：`fee_amount INTEGER`，顯示時除 100。避免 `0.1+0.2` 這類誤差，也讓 Excel 匯出不會出現 128.99999。

**簽到／簽退同一列**：一個人一場聚會只有一列，查「出席」不必 join 兩張表；代價是不支援「中途離場再進場」多次。MVP 接受，工作人員可按「撤銷簽退」修正。

**名單資料分兩層**：`attendees` 放不隨聚會變的（姓名、電話），`event_attendees` 放本場專屬的（桌號、餐飲、繳費）。同一個人下場聚會重新收費、重新選餐，不會互相污染。

**`is_late` 寫入時算好**：不在查詢時算，因為「幾點算開始」依聚會時區與 `late_after_minutes` 而定；寫入時算一次，之後查詢與匯出都便宜，也避免規則改動讓歷史統計變臉。

---

## 5. 頁面

| 路由 | 權限 | 內容 |
|---|---|---|
| `/login` | 公開 | 名稱＋密碼 |
| `/` | 已登入 | 聚會卡列表：日期、名稱、狀態、出席／名單、收費進度 |
| `/events/new`、`/events/:id/edit` | admin | 聚會表單（含新欄位） |
| `/events/:id` | 已登入 | 總覽：統計卡＋大按鈕（顯示 QR／現場簽到／名單／總結） |
| `/events/:id/qr` | 已登入 | 全屏 QR（投影用）＋下載 PNG／SVG＋列印 |
| `/events/:id/roster` | 已登入 | 名單：搜尋、新增、CSV 匯入、桌號／餐飲／繳費、個人 QR |
| `/events/:id/checkin` | 已登入 | 搜尋簽到、相機掃描、臨時新增、最近簽到／簽退 |
| `/events/:id/summary` | 已登入 | 出席／未出席、遲到、停留時間、收費、匯出、列印 |
| `/s/:token` | 公開 | 自助簽到／簽退（只限本人） |

---

## 6. 核心規則

### 6.1 簽到
- 三種方式：`qr_self`（掃聚會 QR 自己按）、`qr_scan`（工作人員掃個人 QR）、`manual`（名單點擊）。
- 時間由伺服器產生，前端傳來的時間一律忽略。
- 同一人第二次簽到：不新增，回傳原記錄並顯示「已於 19:42 簽到（人手）」。

### 6.2 遲到
```
開始時刻 = events.event_date + start_time，以 events.timezone 解讀
is_late  = (checked_in_at − 開始時刻) > late_after_minutes × 60 秒
late_minutes = 上述差值換算分鐘（準時為 0）
```
`Asia/Hong_Kong` 無日光節約，但 `lib/time.mjs` 用通用演算法（來回兩次校正 offset），並用 `America/New_York` 測 DST，日後改時區不會踩雷。

### 6.3 簽退
- 工作人員在名單／掃描頁按「簽退」→ 寫 `checked_out_at`、`checkout_method`。
- 自助簽退：聚會 `allow_self_checkout = 1` 時，`/s/:token` 簽到成功頁會出現「我要離開」按鈕（需再驗一次身分：電話後 4 碼）。
- 停留時間 = `checked_out_at − checked_in_at`；未簽退者不計入平均，另列「未簽退 n 人」。
- 待太久警示：超過 `end_time + 2 小時` 未簽退，總結頁標記，方便追。

### 6.4 配對與去重
- 電話正規化：去空白、`-`、`(`、`)`、`+`；香港號碼比後 8 位；空號碼不參與。
- 順序：電話精確 → 姓名完全 → 都沒有就建立 `walkin`。
- 多筆候選：列出「姓名＋遮蔽電話」讓使用者揀（`9123****`），不顯示完整號碼。

### 6.5 名額與截止
- 名單人數 ≥ `capacity` 時，自助簽到拒絕新 walk-in，提示「名額已滿，請找工作人員」；工作人員可強制加入。
- 過了 `registration_deadline`，自助登記關閉（仍可自助簽到已報名者）。這兩個只影響公開頁。

### 6.6 收費
- 應收 = `fee_amount × 出席人數`；實收 = `SUM(fee_paid)`（只計出席者）。
- 名單頁可一鍵標記「已繳費」，記錄 `fee_paid_at`。
- 匯出含「已繳費」欄，方便對帳。

---

## 7. 匯出與列印

**CSV**（UTF-8 BOM、CRLF、RFC4180 轉義）欄位：
`姓名, 電話, 組別, 桌號, 餐飲, 簽到時間, 遲到分鐘, 簽退時間, 停留分鐘, 簽到方式, 已繳費, 備註`

**Excel**：`出席`／`未出席`／`統計` 三表；首行凍結、欄寬自適應、時間以文字寫入避免 Excel 自行轉時區。

**統計表**：名單數、出席、未出席、出席率、遲到、準時、已簽退、平均停留、應收、實收、餐飲分佈、各簽到方式人次。

**列印**：`@media print` 隱藏導覽，A4 直向，黑底白字轉為白底黑字。

---

## 8. 權限、安全與穩定

- Cookie `httpOnly; SameSite=Lax`;正式環境可加 `Secure`（走 HTTPS 時自動加）。
- 每個 session 一把 CSRF token，所有 POST 表單與 API 都驗；比對用 `timingSafeEqual`。
- `requireUser()` / `requireAdmin()` 包住所有非公開路由。
- 公開端點只可新增本人簽到／簽退，回應不含他人資料；以「IP＋token」記憶體限流（30 次/分），超限回 429。
- 自助頁不提供名單瀏覽，只做逐字搜尋並遮蔽電話。
- 錯誤頁不洩漏 SQL 或堆疊；`DEBUG=1` 時才在主控台印細節。
- SQLite 一律用 prepared statement 參數綁定（無字串拼接）。

---

## 9. 部署（區網自架）

- 啟動：`node server.mjs`，讀 `.env`；`HOST=0.0.0.0`、`PORT=3000`、`DATA_DIR=./data`、`APP_BASE_URL=http://192.168.x.x:3000`。
- Windows：`start.bat` 一鍵啟動；README 附「工作排程器開機自動執行」步驟。
- 相機限制：`http://<區網 IP>` 不是安全來源，瀏覽器會拒絕開相機。提供三條路：
  1. 用 `localhost` 在伺服器本機操作（最快驗收）；
  2. `TLS_CERT`／`TLS_KEY` 指向憑證，`server.mjs` 自動改用 `https`（配合 `mkcert` 或公司內部 CA）；
  3. 掃描頁永遠保留「手動輸入個人編號」，無相機也能完成簽到。
- 備份：`npm run backup` 產生 `data/backups/…db`；README 建議排程每日一次，並提到「複製 .db 檔前先跑 backup，避免 WAL 未合併」。
- 多部平板同時用：同一個程序、各自登入，SQLite WAL 足夠；不支援多台伺服器共用同一個 db 檔（網絡磁碟）。

---

## 10. 分階段實作

| 階段 | 內容 | 驗收 |
|---|---|---|
| P1 骨架 | server、router、靜態、migration、seed、登入／登出、CSRF | `npm start` 可登入，見空列表 |
| P2 聚會 | CRUD＋新欄位、狀態、`/qr`、`/s/:token` 外殼 | 建聚會即出 QR，手機掃到正確聚會資料 |
| P3 名單 | 新增、CSV 匯入（預覽重複）、桌號／餐飲／繳費、個人 QR | 匯入 20 行正確、可標繳費 |
| P4 簽到 | 三種方式、遲到計算、防重複、撤銷 | 三方式成功、重複顯示原時間、遲到分鐘正確 |
| P5 簽退 | 工作人員簽退、自助簽退（開關）、停留時間 | 簽退後總結見停留分鐘與平均 |
| P6 總結 | 統計、出席／未出席、CSV＋Excel、列印 | 數字與 DB 一致、Excel 中文正常 |
| P7 收尾 | 測試、README、備份、`start.bat`、375px 實測 | `npm test` 全綠、手機可操作 |

每階段做完會给你一條「點樣試」的清單，你試完我才繼續。

---

## 11. 測試（`node --test`）
- `time.mjs`：當地時間→UTC（含 DST 時區）、UTC→顯示、跨日。
- `rules.mjs`：遲到判定（邊界：剛好 15 分、15 分 1 秒）、出席率、停留時間。
- `csv.mjs`：引號內逗號／換行、BOM、CRLF。
- `attendees`：電話正規化、同名多筆、空電話、walk-in 建立。
- `checkins`：重複簽到回傳既有記錄、併發兩次只寫一筆、撤銷後可再簽。
- 手動：手機 Chrome／Safari 各走一次三種簽到＋簽退。

---

## 12. 風險
| 風險 | 對策 |
|---|---|
| 區網 http 開不到相機 | 手動輸入備援＋TLS 選項＋`localhost` 驗收 |
| 同桌多人共用電話 | 不設唯一鍵，配對時列候選 |
| 中途離場再入場 | 不支援多次進出，工作人員可撤銷簽退重簽 |
| 平板休眠／Wi-Fi 斷 | 表單送出失敗會保留輸入並提示重試；不做離線佇列（MVP） |
| SQLite 寫入鎖 | 單程序；WAL；長報表查詢加 `LIMIT` |
| 忘記密碼 | `npm run user -- reset <name>` CLI 重設 |

---

## 13. 開工前最後確認
1. 部署主機是 Windows 電腦放辦公室、平板連同一個 Wi-Fi，對嗎？（若是雲端主機或 Docker，講一聲我調整）
2. 聚會費用顯示用「港幣 HK$」，對嗎？
3. 自助簽到頁面需要顯示聚會地點與 Note 給參加者看嗎？（會公開，注意別寫內部備註）

---

## 14. 實作狀態（2026-11-22 完成）

P1–P7 全部完成。與原計畫的差異：

| 項目 | 調整 |
|---|---|
| 公開備註 | 加開 `events.internal_notes`：`notes` 顯示在自助頁，`internal_notes` 只給工作人員 |
| 個人 QR 備援 | 卡片印 8 碼短碼（token 前 8 碼），掃不到可手動輸入；短碼必須唯一才解析 |
| 自助簽退 | 需電話後 4 碼驗身，且聚會要開啟 `allow_self_checkout` |
| 簽到 API | 同時接受 JSON 與表單，並容許帶 `ATT:` 前綴 |
| 測試執行 | 用 `node:test`；因執行環境不能 spawn 子程序，改用 `--experimental-test-isolation=none` 單程序執行 |

驗證：31 項單元測試、煙霧測試（登入、CRUD、三種簽到、CSV／Excel、權限）、深入流程測試（匯入、短碼、掃描 API、簽退、名額、截止、QR 重設）全部通過。
