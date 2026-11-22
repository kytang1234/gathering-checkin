# syntax=docker/dockerfile:1
# 聚會簽到 — 單一 Node 程序 + SQLite
# 建置：docker build -t gathering-checkin .
# 執行：docker run -d -p 3000:3000 -v checkin-data:/data \
#         -e ADMIN_PASSWORD='換成你的密碼' gathering-checkin

# ---------- 依賴 ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 有預編譯檔；沒有對應平台時才需要現場編譯，所以保留編譯工具。
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# QR 掃描器（jsqr）不在 repo 內，建置時由 node_modules 複製到 public/vendor
COPY scripts ./scripts
RUN node scripts/vendor.mjs

# ---------- 執行 ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/public/vendor ./public/vendor

RUN chmod +x docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
