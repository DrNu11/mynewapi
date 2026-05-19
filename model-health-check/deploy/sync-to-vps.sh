#!/usr/bin/env bash
# ==========================================================================
# sync-to-vps.sh — 把本地源码 rsync 推到 VPS
# 在 Mac 上运行
# ==========================================================================

set -euo pipefail

# ---- 默认配置（可通过环境变量覆盖）----
VPS_HOST="${VPS_HOST:-root@154.64.231.223}"
VPS_PATH="${VPS_PATH:-/opt/model-health-check}"
SSH_PORT="${SSH_PORT:-22}"

# 进入项目根目录（这个脚本所在目录的上一级）
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."

echo "================================================================"
echo "  🩺 Model Health Check  →  推送到 VPS"
echo "================================================================"
echo "  目标:  $VPS_HOST:$VPS_PATH"
echo "  端口:  $SSH_PORT"
echo "  本地:  $(pwd)"
echo "================================================================"
echo ""

# 测试 SSH 连通性
echo "==> 测试 SSH 连接..."
if ! ssh -p "$SSH_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$VPS_HOST" 'echo OK' 2>/dev/null; then
  echo "⚠️  无法用密钥免密登录,可能需要密码或密钥未配置。"
  echo "    你可以:"
  echo "    1. 先跑   ssh-copy-id -p $SSH_PORT $VPS_HOST    把密钥拷过去"
  echo "    2. 或者直接继续,rsync 会问你密码"
  echo ""
fi

# 创建远程目录
echo "==> 确保远程目录存在..."
ssh -p "$SSH_PORT" "$VPS_HOST" "mkdir -p '$VPS_PATH'"

# rsync 推送
echo "==> rsync 推送源码（不含 node_modules / .next / .env.local）..."
rsync -avz --delete \
  -e "ssh -p $SSH_PORT" \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='.git/' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  ./ "$VPS_HOST:$VPS_PATH/"

echo ""
echo "================================================================"
echo "  ✅ 推送完成"
echo "================================================================"
echo ""
echo "下一步在 VPS 上执行（首次部署 or 拉取新代码后）:"
echo ""
echo "  ssh $VPS_HOST"
echo "  cd $VPS_PATH"
echo "  bash deploy/setup-vps.sh"
echo ""
echo "或者一行命令直接远程跑:"
echo ""
echo "  ssh $VPS_HOST 'cd $VPS_PATH && bash deploy/setup-vps.sh'"
echo ""
