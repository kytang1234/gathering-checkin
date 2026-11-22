#!/bin/sh
set -e

echo "[啟動] 檢查資料庫結構…"
node scripts/migrate.mjs

echo "[啟動] 檢查管理員帳號…"
node scripts/seed.mjs

echo "[啟動] 開始服務"
exec node server.mjs
