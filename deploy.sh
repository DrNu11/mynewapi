#!/usr/bin/env bash
# 一键部署 nassa-cards 到 207 VPS
# 用法: ./deploy.sh
# 关键安全保证:保留 data/ 目录(SQLite 数据库)和 .env.local
set -euo pipefail

REMOTE_USER="root"
REMOTE_HOST="207.244.243.12"
REMOTE_DIR="/opt/nassa-cards"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
TS="$(date +%Y%m%d_%H%M%S)"

echo "==> [1/6] 本地 build"
cd "$LOCAL_DIR"
npm run build

echo "==> [2/6] 打包(排除 node_modules / data / .git)"
PARENT_DIR="$(dirname "$LOCAL_DIR")"
PROJECT_NAME="$(basename "$LOCAL_DIR")"
TARBALL="/tmp/${PROJECT_NAME}_${TS}.tar.gz"
tar --exclude="${PROJECT_NAME}/node_modules" \
    --exclude="${PROJECT_NAME}/data" \
    --exclude="${PROJECT_NAME}/.git" \
    -czf "$TARBALL" -C "$PARENT_DIR" "$PROJECT_NAME"
ls -lh "$TARBALL"

echo "==> [3/6] scp 到 ${REMOTE_HOST}"
scp "$TARBALL" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/nassa-cards-deploy.tar.gz"

echo "==> [4/6] 远端解压(保留 data/ + .env.local)"
ssh "${REMOTE_USER}@${REMOTE_HOST}" bash <<EOF
set -euo pipefail
TS="${TS}"
cd /opt

# 备份当前 data/ + .env.local 到 /var/backups
mkdir -p /var/backups/nassa-cards
if [ -d "${REMOTE_DIR}/data" ]; then
  tar -czf /var/backups/nassa-cards/data_\${TS}.tar.gz -C "${REMOTE_DIR}" data
  echo "  data/ 备份到 /var/backups/nassa-cards/data_\${TS}.tar.gz"
fi
if [ -f "${REMOTE_DIR}/.env.local" ]; then
  cp "${REMOTE_DIR}/.env.local" "/var/backups/nassa-cards/env_\${TS}.local"
fi

# 把 data/ 和 .env.local 移到临时位置,删除目录后恢复
TMPSAVE="/tmp/nassa-cards-keep_\${TS}"
mkdir -p "\$TMPSAVE"
[ -d "${REMOTE_DIR}/data" ] && mv "${REMOTE_DIR}/data" "\$TMPSAVE/data"
[ -f "${REMOTE_DIR}/.env.local" ] && mv "${REMOTE_DIR}/.env.local" "\$TMPSAVE/.env.local"

rm -rf "${REMOTE_DIR}"
tar -xzf /tmp/nassa-cards-deploy.tar.gz 2>/dev/null

# 恢复 data/ 和 .env.local
[ -d "\$TMPSAVE/data" ] && mv "\$TMPSAVE/data" "${REMOTE_DIR}/data"
[ -f "\$TMPSAVE/.env.local" ] && mv "\$TMPSAVE/.env.local" "${REMOTE_DIR}/.env.local"
rmdir "\$TMPSAVE" 2>/dev/null || true
EOF

echo "==> [5/6] 远端 npm install --omit=dev"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "cd ${REMOTE_DIR} && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3"

echo "==> [6/6] pm2 重启 + 健康探针"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "pm2 restart nassa-cards --update-env && sleep 4 && curl -sm 5 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3100/"

# 清理本地 tarball
rm -f "$TARBALL"
echo ""
echo "✅ 部署完成"
echo "   - 公网: http://${REMOTE_HOST}:3100"
echo "   - 备份: /var/backups/nassa-cards/data_${TS}.tar.gz"
