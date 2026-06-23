#!/bin/bash
# 修复配额耗尽的渠道 - 禁用或更新
# 用法: bash fix-exhausted-channels.sh

set -e

HOST="root@207.244.243.12"
DB_PASS="$(ssh $HOST 'grep MYSQL_ROOT_PASSWORD /www/dk_project/dk_app/newapi-prod/docker-compose.yml | head -1 | cut -d: -f2 | tr -d " "')"

echo "=========================================="
echo " 修复配额耗尽的渠道"
echo "=========================================="
echo ""

# 方案 1: 禁用耗尽的渠道
echo "[方案 1] 禁用配额耗尽的渠道 #81 和 #86"
echo "这会让系统只使用其他有配额的渠道"
echo ""
read -p "是否执行？(y/N) " confirm1

if [ "$confirm1" = "y" ] || [ "$confirm1" = "Y" ]; then
  echo "禁用渠道 #81 和 #86..."
  ssh $HOST "docker exec newapi-prod-mysql-1 mysql -uroot -p'$DB_PASS' new-api -e \"UPDATE channels SET status = 2 WHERE id IN (81, 86);\""
  echo "✅ 已禁用"
fi

echo ""
echo "=========================================="

# 方案 2: 查看当前活跃的 DeepSeek 渠道
echo "[方案 2] 查看当前活跃的 DeepSeek 渠道"
ssh $HOST "docker exec newapi-prod-mysql-1 mysql -uroot -p'$DB_PASS' new-api -e \"SELECT id, name, type, status, balance, used_quota FROM channels WHERE status = 1 AND models LIKE '%deepseek%' ORDER BY priority DESC, weight DESC;\" 2>&1 | grep -v Warning"

echo ""
echo "=========================================="

# 方案 3: 检查错误日志中最近使用的渠道
echo "[方案 3] 最近 1 小时内使用的 DeepSeek 渠道统计"
ssh $HOST "grep 'model_name.*deepseek' /www/dk_project/dk_app/newapi-prod/logs/oneapi-20260603150602.log | grep -oP 'channel_id\":\K[0-9]+' | sort | uniq -c | sort -rn | head -10"

echo ""
echo "=========================================="
echo "修复建议："
echo ""
echo "1. 如果禁用了 #81 和 #86，系统会自动使用其他渠道"
echo "2. 检查活跃渠道的配额是否充足"
echo "3. 如果所有渠道都配额不足，需要："
echo "   a) 给上游API充值"
echo "   b) 添加新的渠道"
echo "   c) 联系上游提供商增加配额"
echo ""
echo "4. 临时方案：降低用户请求的 retry 次数（目前是 5）"
echo "   这样可以减少对耗尽渠道的重试"
echo ""
