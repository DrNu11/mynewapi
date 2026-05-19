#!/bin/bash
# 107 加 swap 防止再次 OOM
# 在服务器回来后执行: bash add-swap-107.sh

HOST="root@107.174.155.17"

echo "=========================================="
echo " 给 107 加 2GB swap"
echo "=========================================="

ssh "$HOST" 'bash -s' <<'REMOTE'
set -e

if swapon --show | grep -q '/swapfile'; then
  echo "已有 swap 文件,跳过"
  swapon --show
  exit 0
fi

echo "[1/5] 创建 2GB swap 文件 ..."
fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048

echo "[2/5] 设置权限 ..."
chmod 600 /swapfile

echo "[3/5] 格式化 ..."
mkswap /swapfile

echo "[4/5] 启用 ..."
swapon /swapfile

echo "[5/5] 写入 fstab 让重启后自动启用 ..."
if ! grep -q '/swapfile' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo ""
echo "✅ 完成"
free -h
echo ""
swapon --show
REMOTE

echo ""
echo "✅ Swap 已配置,以后内存不够时会用磁盘临时扛住,不会再 OOM 杀进程"
