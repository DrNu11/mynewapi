#!/usr/bin/env bash
# 推 GitHub 前的最后一道安全扫描
# 用法: bash scripts/preflight-check.sh
# 期望: 5 项检查全部 ✓ , 才能 git push

set -e
cd "$(dirname "$0")/.."

FAIL=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n" "$*"; }

if [ ! -d .git ]; then
  red "✗ 当前目录不是 git repo, 先 git init"
  exit 1
fi

bold "=== 1. 不应出现的敏感后缀文件 (.env / .db / .key / .pem / .sqlite) ==="
LEAKS=$(git ls-files | grep -E '\.(env|db|db-(journal|wal|shm)|key|pem|sqlite[0-9]*|p12|pfx)$' || true)
LEAKS=$(echo "$LEAKS" | grep -vE '\.(example|sample)$' || true)
if [ -n "$LEAKS" ]; then
  red "✗ 发现敏感后缀文件被纳入 git:"
  echo "$LEAKS" | sed 's/^/   /'
  FAIL=1
else
  green "✓ 无敏感后缀文件"
fi
echo ""

bold "=== 2. 暂存区里的 sk-xxx token (排除模板/文档) ==="
SK=$(git ls-files | xargs grep -lE 'sk-[a-zA-Z0-9_-]{30,}' 2>/dev/null || true)
SK=$(echo "$SK" | grep -vE '\.(example|sample|md)$' || true)
if [ -n "$SK" ]; then
  red "✗ 发现疑似硬编码 sk-key (检查这些文件):"
  echo "$SK" | sed 's/^/   /'
  FAIL=1
else
  green "✓ 无硬编码 sk-key (.md/.example 除外)"
fi
echo ""

bold "=== 3. 暂存区里的明文密码 (password=xxx) ==="
PW=$(git ls-files | xargs grep -lE '(password|passwd|secret).{0,3}[:=].{0,3}["'"'"']?[A-Za-z0-9!@#$%^&*]{8,}' 2>/dev/null || true)
PW=$(echo "$PW" | grep -vE '\.(example|sample|md)$' || true)
if [ -n "$PW" ]; then
  yellow "⚠ 发现可能的明文密码 (人工检查这些文件, 文档/常量除外):"
  echo "$PW" | sed 's/^/   /'
  # 不直接 FAIL, 因为可能是变量名/字段定义
else
  green "✓ 无明显明文密码"
fi
echo ""

bold "=== 4. 仓库实际会推的大小 ==="
SIZE=$(git ls-files | tr '\n' '\0' | du -ch --files0-from=- 2>/dev/null | tail -1 | awk '{print $1}')
COUNT=$(git ls-files | wc -l | tr -d ' ')
echo "  $COUNT 个文件, 总大小 $SIZE"
if echo "$SIZE" | grep -qE '^[0-9]+G'; then
  red "✗ 仓库 > 1GB, GitHub 会拒绝或慢, 检查是否漏屏蔽 node_modules / build / db"
  FAIL=1
else
  green "✓ 大小合理"
fi
echo ""

bold "=== 5. 单文件 > 50MB (GitHub 100MB 硬限制) ==="
BIG=$(git ls-files | xargs -I{} du -k {} 2>/dev/null | awk '$1 > 51200 {print $2, $1"KB"}' || true)
if [ -n "$BIG" ]; then
  red "✗ 单文件超过 50MB (GitHub 推送会失败/警告):"
  echo "$BIG" | sed 's/^/   /'
  FAIL=1
else
  green "✓ 无超大单文件"
fi
echo ""

echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  green "✓✓✓ 全部检查通过, 可以 git commit + push"
  exit 0
else
  red "✗✗✗ 有检查项未通过, 修正后再跑"
  exit 1
fi
