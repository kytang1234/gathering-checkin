#!/bin/sh
# Google Compute Engine 開機腳本（Ubuntu 22.04／24.04）
#
# 用法：建立 VM 時把這個檔案指定為 startup-script，並加一個 metadata：
#   repo-url = https://github.com/<你>/gathering-checkin.git
#
# 它只負責把環境準備好（Docker + 程式碼），不會自動啟動服務；
# 首次請照 docs/deploy-gcp.md 建立 .env 後再 docker compose up -d。
set -e

REPO_URL="$(curl -sf -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/attributes/repo-url' || true)"

echo "[startup] 更新套件索引"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git

if ! command -v docker >/dev/null 2>&1; then
  echo "[startup] 安裝 Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# 讓預設使用者（Ubuntu 映像的 ubuntu）不用 sudo 就能用 docker
if id ubuntu >/dev/null 2>&1; then
  usermod -aG docker ubuntu || true
fi

if [ -n "$REPO_URL" ] && [ ! -d /opt/attendance/.git ]; then
  echo "[startup] 取得程式碼"
  git clone "$REPO_URL" /opt/attendance
fi

if [ -d /opt/attendance ]; then
  mkdir -p /opt/attendance/data
  # 讓 ubuntu 使用者可以改 .env、跑 docker compose
  if id ubuntu >/dev/null 2>&1; then
    chown -R ubuntu:ubuntu /opt/attendance
  fi
  # 容器以 uid 1000 執行，資料目錄要讓它寫得進去
  chown -R 1000:1000 /opt/attendance/data || true
fi

echo "[startup] 完成。下一步："
echo "  cd /opt/attendance && cp .env.example .env && nano .env && docker compose up -d --build"
