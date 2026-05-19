#!/bin/bash
# 107 紧急回滚到旧镜像
# 用法: bash rollback-107.sh [backup_tag]

set -e

HOST="root@107.174.155.17"
COMPOSE_DIR="/www/dk_project/dk_app/newapi/newapi_SAz7"
LIVE_TAG="nassa11111/new-api-hide-model:hide-model"

# 找最近一次备份
if [ -z "$1" ]; then
  BACKUP_TAG=$(ssh "$HOST" "docker images --format '{{.Repository}}:{{.Tag}}' | grep 'hide-model-backup-' | sort -r | head -1")
  if [ -z "$BACKUP_TAG" ]; then
    echo "❌ 找不到备份标签"
    exit 1
  fi
else
  BACKUP_TAG="$1"
fi

echo "回滚 $LIVE_TAG → $BACKUP_TAG"
ssh "$HOST" "docker tag $BACKUP_TAG $LIVE_TAG && cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api"
sleep 5
ssh "$HOST" "curl -sm 3 -o /dev/null -w '本机 = %{http_code}\n' http://127.0.0.1:3000/api/status"
echo "✅ 回滚完成"
