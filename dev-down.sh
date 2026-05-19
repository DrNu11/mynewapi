#!/usr/bin/env bash
# 关闭 upgrade-api + chatgpt2cpa 本地开发服务
set -e

for port in 7888 7889; do
  pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    kill "$pid" 2>&1 || true
    echo "killed :$port pid=$pid"
  else
    echo ":$port 没在跑"
  fi
done
