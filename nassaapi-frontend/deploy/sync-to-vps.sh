#!/usr/bin/env bash
# ============================================================
# 在 Mac 本地跑 — 把代码同步到 VPS
#
# 用法：
#   bash deploy/sync-to-vps.sh             # 同步代码 + 安装依赖 + 重建 + 平滑重启
#   bash deploy/sync-to-vps.sh --no-build  # 只同步代码，不重新 build（紧急修小 bug 用）
#
# 第一次部署前需手动跑 deploy/first-time-setup.sh
# ============================================================

set -euo pipefail

VPS_HOST="${VPS_HOST:-root@107.174.155.17}"
REMOTE_PATH="${REMOTE_PATH:-/opt/nassaapi-frontend}"
NO_BUILD="${1:-}"

echo "🚀 同步 nassaapi-frontend → $VPS_HOST:$REMOTE_PATH"
echo ""

# 排除掉本地特有的 / 大体积的文件
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local' \
  --exclude='.env*.local' \
  --exclude='data/' \
  --exclude='.git/' \
  --exclude='.DS_Store' \
  --exclude='deploy/sync-to-vps.sh' \
  ./ "$VPS_HOST:$REMOTE_PATH/"

echo ""
echo "📦 远程 npm install + build + reload..."

if [ "$NO_BUILD" = "--no-build" ]; then
  ssh "$VPS_HOST" "cd $REMOTE_PATH && pm2 reload nassaapi-frontend && echo '✅ 已重载（未重 build）'"
else
  ssh "$VPS_HOST" "cd $REMOTE_PATH && \
    npm install --omit=dev=false && \
    npm run build && \
    pm2 reload nassaapi-frontend && \
    echo '✅ 部署完成'"
fi

echo ""
echo "🔍 状态："
ssh "$VPS_HOST" "pm2 status nassaapi-frontend"
