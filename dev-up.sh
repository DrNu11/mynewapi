#!/usr/bin/env bash
# 一键启动 upgrade-api + chatgpt2cpa 本地开发环境
# 数据/日志持久化到 /Users/w/Desktop/newapi/data/upgrade-api/
set -e

REPO_ROOT="/Users/w/Desktop/newapi"
DATA_BASE="$REPO_ROOT/data/upgrade-api"

UPGRADE_PORT=7889
CHATGPT_PORT=7888

echo "==> 准备数据目录 $DATA_BASE"
mkdir -p "$DATA_BASE"/{data/sessions,logs,backups,uploads,target-repo}

# 端口占用检查
check_port() {
  local port=$1
  local name=$2
  local pid
  pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    echo "==> $name (端口 $port) 已在跑 pid=$pid,跳过"
    return 1
  fi
  return 0
}

# 启 upgrade-api
if check_port $UPGRADE_PORT "upgrade-api"; then
  echo "==> 启动 upgrade-api :$UPGRADE_PORT"
  UPGRADE_API_DATA_DIR="$DATA_BASE/data" \
  UPGRADE_API_STATIC_DIR="$REPO_ROOT/upgrade-api/static" \
  UPGRADE_BACKUP_DIR="$DATA_BASE/backups" \
  UPGRADE_UPLOAD_DIR="$DATA_BASE/uploads" \
  UPGRADE_TARGET_REPO="$DATA_BASE/target-repo" \
  UPGRADE_API_ADMIN_TOKEN=devtoken123 \
  PYTHONPATH="$REPO_ROOT/upgrade-api/src" \
  nohup python3 -m uvicorn upgrade_api.main:app \
    --host 127.0.0.1 --port $UPGRADE_PORT \
    > "$DATA_BASE/logs/upgrade-api.log" 2>&1 &
  echo "    pid=$!"
fi

# 启 chatgpt2cpa
if check_port $CHATGPT_PORT "chatgpt2cpa"; then
  echo "==> 启动 chatgpt2cpa :$CHATGPT_PORT"
  PYTHONPATH="$REPO_ROOT/chatgpt2cpa/src" \
  nohup python3 -m uvicorn chatgpt2cpa.app:app \
    --host 127.0.0.1 --port $CHATGPT_PORT \
    > "$DATA_BASE/logs/chatgpt2cpa.log" 2>&1 &
  echo "    pid=$!"
fi

# 等待服务就绪
echo "==> 等待服务起来..."
sleep 3

echo "==> 健康检查"
curl -s -o /dev/null -w "    chatgpt2cpa :$CHATGPT_PORT  HTTP %{http_code}\n" \
  --max-time 3 "http://127.0.0.1:$CHATGPT_PORT/" || echo "    chatgpt2cpa 检查失败"
curl -s -o /dev/null -w "    upgrade-api :$UPGRADE_PORT  HTTP %{http_code}\n" \
  --max-time 3 "http://127.0.0.1:$UPGRADE_PORT/api/health" || echo "    upgrade-api 检查失败"

echo
echo "==================================================="
echo "  用户端  http://127.0.0.1:$CHATGPT_PORT/"
echo "  管理端  http://127.0.0.1:$UPGRADE_PORT/admin"
echo "  Admin Token  devtoken123"
echo
echo "  数据目录   $DATA_BASE/data/  (重启不丢)"
echo "  日志目录   $DATA_BASE/logs/"
echo
echo "  停止服务   $REPO_ROOT/dev-down.sh"
echo "  实时日志   tail -f $DATA_BASE/logs/{upgrade-api,chatgpt2cpa}.log"
echo "==================================================="
