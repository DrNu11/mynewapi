#!/bin/bash
# 107 重启后一键恢复 + 诊断脚本
# 用法: 等 SSH 回来后,执行: bash recover-107.sh

set -e
HOST="root@107.174.155.17"

echo "=========================================="
echo " 步骤 1/6  容器状态"
echo "=========================================="
ssh "$HOST" 'docker ps --format "{{.Names}} | {{.Status}} | {{.Image}}" | head -10'

echo ""
echo "=========================================="
echo " 步骤 2/6  NewAPI 是否能响应"
echo "=========================================="
ssh "$HOST" 'curl -sm 5 -o /dev/null -w "本机 NewAPI :3000 = %{http_code}\n" http://127.0.0.1:3000/api/status; \
             curl -sm 5 -o /dev/null -w "本机 NewAPI /v1/models = %{http_code}\n" http://127.0.0.1:3000/v1/models -H "Authorization: Bearer sk-fake"'

echo ""
echo "=========================================="
echo " 步骤 3/6  系统资源"
echo "=========================================="
ssh "$HOST" 'echo "--- uptime ---"; uptime; echo ""; echo "--- 内存 ---"; free -h; echo ""; echo "--- 磁盘 ---"; df -h / | tail -1; echo ""; echo "--- swap ---"; swapon --show'

echo ""
echo "=========================================="
echo " 步骤 4/6  找崩溃原因 (dmesg + journal)"
echo "=========================================="
ssh "$HOST" 'echo "--- dmesg OOM ---"; dmesg -T 2>/dev/null | grep -iE "oom|kill|out of memory" | tail -10; \
             echo ""; \
             echo "--- 上次启动前的最后日志 ---"; \
             journalctl --boot=-1 --no-pager 2>/dev/null | tail -20'

echo ""
echo "=========================================="
echo " 步骤 5/6  NewAPI 容器最近 50 行日志"
echo "=========================================="
ssh "$HOST" 'docker logs --tail 50 newapi_saz7-new-api-1 2>&1 | tail -50'

echo ""
echo "=========================================="
echo " 步骤 6/6  网关验证 (公网)"
echo "=========================================="
curl -sm 8 -o /dev/null -w "https://api.nassaapi.xyz/v1/models = %{http_code} | %{time_total}s\n" \
  https://api.nassaapi.xyz/v1/models -H "Authorization: Bearer sk-test"

echo ""
echo "=========================================="
echo " ✅ 诊断完毕"
echo "=========================================="
echo ""
echo "下一步建议:"
echo "  1. 如果 NewAPI 容器没 Up,手动启动:"
echo "     ssh $HOST 'cd /www/dk_project/dk_app/newapi/newapi_SAz7 && docker compose up -d'"
echo ""
echo "  2. 如果是 OOM 导致,立即加 swap:"
echo "     bash add-swap-107.sh"
