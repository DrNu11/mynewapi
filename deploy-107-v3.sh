#!/bin/bash
# 107 部署 hide-model v3 (覆盖 OpenAI chat + /v1/responses + /v1/messages 全部路径)
# 与 v2 区别:
#   v2 → 只覆盖 /v1/chat/completions (42% 流量)
#   v3 → 覆盖 OpenAI chat + /v1/responses + /v1/messages (100% 流量)
#
# 用法: bash deploy-107-v3.sh

set -e

HOST="root@107.174.155.17"
COMPOSE_DIR="/www/dk_project/dk_app/newapi/newapi_SAz7"
NEW_IMAGE="nassa11111/new-api-hide-model:hide-model-v3"
LIVE_TAG="nassa11111/new-api-hide-model:hide-model"
BACKUP_TAG="nassa11111/new-api-hide-model:hide-model-backup-v2-$(date +%Y%m%d-%H%M)"
IMG_FILE="/tmp/newapi-img-v3.tar.gz"

echo "=========================================="
echo " 107 部署 hide-model v3 (全路径覆盖)"
echo "=========================================="
echo "新镜像:     $NEW_IMAGE"
echo "线上标签:   $LIVE_TAG"
echo "备份标签:   $BACKUP_TAG"
echo "覆盖增加:   /v1/responses + /v1/messages"
echo ""

[ -f "/Users/w/Desktop/newapi/deploy-107-newimage.sh" ] || { echo "FATAL: 找不到 base 部署脚本"; exit 1; }

echo "[1/7] 验证镜像文件 ..."
ssh "$HOST" "ls -lh $IMG_FILE"

echo ""
echo "[2/7] docker load ..."
ssh "$HOST" "gunzip < $IMG_FILE | docker load"

echo ""
echo "[3/7] 备份当前 :hide-model → $BACKUP_TAG"
ssh "$HOST" "docker tag $LIVE_TAG $BACKUP_TAG"

echo ""
echo "[4/7] 切换 :hide-model 指向 v3"
ssh "$HOST" "docker tag $NEW_IMAGE $LIVE_TAG"

echo ""
echo "[5/7] 验证标签"
ssh "$HOST" "docker images nassa11111/new-api-hide-model | head -5"

echo ""
echo "[6/7] 🚨 重启 NewAPI 容器 (~10s 中断)"
echo "      3 秒后开始..."
sleep 3
ssh "$HOST" "cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api"

echo ""
echo "[7/7] 健康探针 ..."
HEALTH_OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(ssh "$HOST" "curl -sm 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/status" 2>/dev/null || echo "000")
  echo "  探针 $i/10: HTTP $CODE"
  if [ "$CODE" = "200" ]; then
    HEALTH_OK=$((HEALTH_OK + 1))
    if [ $HEALTH_OK -ge 3 ]; then
      echo ""
      echo "  ✅ 连续 3 次 200 — 服务恢复"
      break
    fi
  else
    HEALTH_OK=0
  fi
  sleep 1.5
done

if [ $HEALTH_OK -lt 3 ]; then
  echo ""
  echo "  ❌ 健康探针失败 — 自动回滚"
  ssh "$HOST" "docker tag $BACKUP_TAG $LIVE_TAG && cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api"
  exit 1
fi

echo ""
echo "=========================================="
echo " 公网验证"
echo "=========================================="
curl -sm 8 -o /dev/null -w "https://api.nassaapi.xyz = %{http_code} | %{time_total}s\n" \
  https://api.nassaapi.xyz/api/status

echo ""
echo "✅ 部署完成 — 现在 hide-model 覆盖 100% 路径"
echo ""
echo "回滚到 v2:"
echo "  ssh $HOST 'docker tag $BACKUP_TAG $LIVE_TAG && cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api'"
