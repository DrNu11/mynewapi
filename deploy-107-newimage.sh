#!/bin/bash
# 107 部署新镜像脚本 — 22:00 低峰时一键执行
# 包含: 备份当前镜像 → 加载新镜像 → 重启容器 → 健康探针 → 失败自动回滚
#
# 用法: bash deploy-107-newimage.sh

set -e

HOST="root@107.174.155.17"
COMPOSE_DIR="/www/dk_project/dk_app/newapi/newapi_SAz7"
NEW_IMAGE="nassa11111/new-api-hide-model:hide-model-v2"
LIVE_TAG="nassa11111/new-api-hide-model:hide-model"
BACKUP_TAG="nassa11111/new-api-hide-model:hide-model-backup-$(date +%Y%m%d-%H%M)"
IMG_FILE="/tmp/newapi-img.tar.gz"

echo "=========================================="
echo " 107 部署新镜像 (零中断目标 ≤10s)"
echo "=========================================="
echo "新镜像:   $NEW_IMAGE"
echo "线上标签: $LIVE_TAG"
echo "备份标签: $BACKUP_TAG"
echo ""

# 1. 验证镜像文件存在
echo "[1/7] 验证镜像文件 ..."
ssh "$HOST" "ls -lh $IMG_FILE"

# 2. 加载新镜像
echo ""
echo "[2/7] docker load (耗时 ~30s) ..."
ssh "$HOST" "gunzip < $IMG_FILE | docker load"

# 3. 备份当前 :hide-model 标签
echo ""
echo "[3/7] 备份当前 :hide-model → $BACKUP_TAG"
ssh "$HOST" "docker tag $LIVE_TAG $BACKUP_TAG"

# 4. 把新镜像挂到 :hide-model 标签上 (这样 docker-compose.yml 不用改)
echo ""
echo "[4/7] 切换 :hide-model 指向新镜像"
ssh "$HOST" "docker tag $NEW_IMAGE $LIVE_TAG"

# 5. 验证现在 :hide-model 指向的是新的 image ID
echo ""
echo "[5/7] 验证标签"
ssh "$HOST" "docker images nassa11111/new-api-hide-model | head -5"

# 6. 重启 NewAPI 容器 (强制重建以拉新镜像)
echo ""
echo "[6/7] 🚨 重启 NewAPI 容器 (~10s 中断)"
echo "      Ctrl+C 现在退出还来得及"
echo "      3 秒后开始..."
sleep 3
ssh "$HOST" "cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api"

# 7. 健康探针 (10 次,每次 1.5 秒)
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
  echo "     执行: bash rollback-107.sh"
  exit 1
fi

# 公网验证
echo ""
echo "=========================================="
echo " 公网验证"
echo "=========================================="
curl -sm 8 -o /dev/null -w "https://api.nassaapi.xyz = %{http_code} | %{time_total}s\n" \
  https://api.nassaapi.xyz/api/status

echo ""
echo "✅ 部署完成"
echo ""
echo "回滚方法 (如需):"
echo "  ssh $HOST 'docker tag $BACKUP_TAG $LIVE_TAG && cd $COMPOSE_DIR && docker compose up -d --force-recreate new-api'"
