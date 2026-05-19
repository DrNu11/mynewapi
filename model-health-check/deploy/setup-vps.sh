#!/usr/bin/env bash
# ==========================================================================
# setup-vps.sh — 在 VPS 上执行：装 Node + PM2，构建并启动
# 适用：Ubuntu 20/22/24，Debian 11/12
# ==========================================================================

set -euo pipefail

APP_NAME="${APP_NAME:-model-health-check}"
APP_PORT="${APP_PORT:-3030}"

# 进入项目根目录
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
PROJECT_DIR="$(pwd)"

echo "================================================================"
echo "  🩺 Model Health Check  →  VPS 安装 + 启动"
echo "================================================================"
echo "  目录:    $PROJECT_DIR"
echo "  端口:    $APP_PORT"
echo "  PM2 名:  $APP_NAME"
echo "================================================================"
echo ""

# ---------- 1. Node.js 20 ----------
NEED_NODE_INSTALL=1
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$CURRENT_MAJOR" -ge 18 ] 2>/dev/null; then
    NEED_NODE_INSTALL=0
    echo "==> Node 已存在: $(node -v)"
  else
    echo "==> Node 版本太老 ($(node -v))，将升级到 20.x"
  fi
fi

if [ "$NEED_NODE_INSTALL" = "1" ]; then
  echo "==> 安装 Node.js 20.x ..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "    node: $(node -v)"
echo "    npm:  $(npm -v)"
echo ""

# ---------- 2. PM2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> 安装 PM2 全局 ..."
  npm install -g pm2
fi
echo "    pm2:  $(pm2 -v)"
echo ""

# ---------- 3. 装项目依赖 ----------
echo "==> 安装项目依赖 (npm ci) ..."
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
echo ""

# ---------- 4. 检查 .env.local ----------
if [ ! -f .env.local ]; then
  echo "⚠️  没有 .env.local 文件！"
  echo "    继续构建，但 API Key 需要在浏览器 UI 里填。"
  echo "    建议创建:"
  echo ""
  echo "    cat > $PROJECT_DIR/.env.local <<'EOF'"
  echo "    NASSA_BASE_URL=https://api.nassaapi.xyz/v1"
  echo "    NASSA_API_KEY=sk-你的key"
  echo "    EOF"
  echo ""
fi

# ---------- 5. 构建 ----------
echo "==> 构建 Next.js (生产模式) ..."
npm run build
echo ""

# ---------- 6. 启动或重启 ----------
export PORT="$APP_PORT"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "==> $APP_NAME 已存在，重启..."
  pm2 restart "$APP_NAME" --update-env
else
  echo "==> 首次启动 $APP_NAME (端口 $APP_PORT) ..."
  pm2 start npm --name "$APP_NAME" \
    --max-memory-restart 300M \
    --time \
    -- start
fi

# 持久化进程列表
pm2 save >/dev/null

# 设开机自启（如果还没设过）
if [ ! -f /etc/systemd/system/pm2-root.service ]; then
  echo "==> 配置 PM2 开机自启 ..."
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
fi

echo ""
echo "================================================================"
echo "  ✅ 部署成功"
echo "================================================================"
echo ""
pm2 list
echo ""
echo "  访问:    http://$(hostname -I | awk '{print $1}'):$APP_PORT"
echo "  日志:    pm2 logs $APP_NAME"
echo "  状态:    pm2 status"
echo "  重启:    pm2 restart $APP_NAME"
echo "  停止:    pm2 stop $APP_NAME"
echo ""

# ---------- 7. 防火墙提示 ----------
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -q "Status: active"; then
    echo "==> 检测到 UFW 防火墙启用，开放 $APP_PORT 端口..."
    ufw allow "$APP_PORT/tcp" >/dev/null 2>&1 || true
  fi
fi
