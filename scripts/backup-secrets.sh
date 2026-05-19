#!/usr/bin/env bash
# Tier 1 敏感数据独立加密备份
# 用法: bash scripts/backup-secrets.sh
# 会提示输 zip 密码, 自己记好这个密码 (推荐用密码管理器存)
# 输出: ~/Documents/newapi-secrets-YYYYMMDD.zip

set -e
cd "$(dirname "$0")/.."

OUT=~/Documents/newapi-secrets-$(date +%Y%m%d-%H%M).zip

if [ -f "$OUT" ]; then
  echo "目标文件已存在: $OUT"
  read -p "覆盖? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 0
  rm "$OUT"
fi

# 列出所有要打包的 Tier 1 敏感文件
FILES=(
  # 顶层 env (admin2/deepseek2)
  ".env.local"
  # nassa-cards (NEWAPI_ACCESS_TOKEN + 客户卡密 db)
  "nassa-cards/.env.local"
  "nassa-cards/data"
  # nassaapi-frontend (5201314Zangqi 密码 + 兑换 db)
  "nassaapi-frontend/.env.local"
  "nassaapi-frontend/.env.local.bak"
  "nassaapi-frontend/data"
  # model-health-check (真 sk-key)
  "model-health-check/.env.local"
  # openclaw-admin (basic auth + sample.json 含真 sk-key)
  "openclaw-admin/.env.local"
  "openclaw-admin/data"
  # upgrade-api (鉴权串 + db)
  "upgrade-api/.env"
  "upgrade-api/data"
  # 顶层 data 目录
  "data"
  # backups 目录 (audit.db 等)
  "backups"
  # build-workspace newapi 本地 dev db
  "build-workspace/new-api/one-api.db"
  # 闲鱼 (加密 key + 业务 db)
  "xianyu-auto-reply-fix/data"
)

# 过滤掉不存在的, 避免 zip 报错
EXISTING=()
for f in "${FILES[@]}"; do
  if [ -e "$f" ]; then
    EXISTING+=("$f")
  fi
done

echo "=== 将打包以下 ${#EXISTING[@]} 项敏感数据 ==="
for f in "${EXISTING[@]}"; do
  size=$(du -sh "$f" 2>/dev/null | awk '{print $1}')
  echo "  [$size] $f"
done
echo ""
echo "目标: $OUT"
echo ""
echo "接下来 zip 会提示输密码 (输 2 次, 不会回显):"
echo "  - 用强密码, 至少 16 字符, 含字母+数字+符号"
echo "  - 把密码记在密码管理器里 (1Password / KeyPass), 不要存浏览器/备忘录"
echo ""

# -e: 加密; -r: 递归
zip -e -r "$OUT" "${EXISTING[@]}"

echo ""
echo "=== 完成 ==="
echo "  文件: $OUT"
echo "  大小: $(du -sh "$OUT" | awk '{print $1}')"
echo ""
echo "=== 推荐下一步 ==="
echo "  1. 验证密码能解开:  unzip -t $OUT  (会要求输入密码, 输错会报错)"
echo "  2. 上传到 iCloud Drive / Google Drive / 移动硬盘 (至少 2 处)"
echo "  3. 删掉旧的备份 zip (留最近 3 个版本就够)"
