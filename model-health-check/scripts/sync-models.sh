#!/usr/bin/env bash
# ==========================================================================
# sync-models.sh — 从 /v1/models 拉真实清单,生成可粘贴的 lib/models.ts
# ==========================================================================
# 用法:
#   bash scripts/sync-models.sh                     # 用 .env.local 里的 key
#   API_KEY=sk-xxx bash scripts/sync-models.sh      # 临时指定 key
#
# 输出: 屏幕打印分类后的模型清单 + 可直接粘到 lib/models.ts 的 TS 代码
# ==========================================================================

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."

# 读取 API key
if [ -z "${API_KEY:-}" ]; then
  if [ -f .env.local ]; then
    API_KEY=$(grep -E '^NASSA_API_KEY=' .env.local | cut -d= -f2)
  fi
fi

if [ -z "${API_KEY:-}" ]; then
  echo "❌ 没找到 API_KEY"
  echo "   请: API_KEY=sk-xxx bash scripts/sync-models.sh"
  echo "   或: 在 .env.local 里设 NASSA_API_KEY"
  exit 1
fi

BASE_URL="${BASE_URL:-https://api.nassaapi.xyz/v1}"

echo "==> 从 $BASE_URL/models 拉取..."
echo ""

curl -sS "$BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY" \
  --max-time 15 |
  python3 -c "
import json, sys, re
data = json.load(sys.stdin)
ids = sorted(m['id'] for m in data.get('data', []))

# 分类规则
def cat(mid):
    if 'image' in mid:                          return 'Image'
    if 'tts' in mid or 'voice' in mid:          return 'TTS'
    if 'codex' in mid:                          return 'Codex'
    if mid.startswith('gpt-'):                  return 'GPT'
    if mid.startswith('claude'):                return 'Claude'
    if mid.startswith('gemini'):                return 'Gemini'
    if mid.startswith('deepseek'):              return 'DeepSeek'
    if mid.startswith('glm'):                   return 'GLM'
    if mid.startswith('grok'):                  return 'Grok'
    if mid.startswith('mimo'):                  return 'MiMo'
    if mid.lower().startswith('minimax'):       return 'MiniMax'
    return 'Other'

groups = {}
for m in ids:
    groups.setdefault(cat(m), []).append(m)

ORDER = ['GPT', 'Codex', 'Claude', 'Gemini', 'DeepSeek', 'GLM', 'Grok', 'MiMo', 'MiniMax', 'Image', 'TTS', 'Other']
print(f'共 {len(ids)} 个模型:')
print()
for c in ORDER:
    if c not in groups: continue
    print(f'  {c} ({len(groups[c])}):')
    for m in groups[c]:
        flag = ''
        if c in ('Image', 'TTS'): flag = '  # 排除: 端点不同'
        if c == 'MiniMax':        flag = '  # 当前已禁用'
        print(f'    {m}{flag}')
    print()

print('-' * 70)
print('可粘贴到 lib/models.ts 的 TS 代码:')
print('-' * 70)
print()
for c in ORDER:
    if c not in groups: continue
    if c in ('Image', 'TTS', 'MiniMax'):
        print(f'  // ====== {c} (已排除) ======')
        for m in groups[c]:
            print(f'  // {{ id: \"{m}\", category: \"{c}\" }},')
        print()
        continue
    print(f'  // ============ {c} ============')
    for m in groups[c]:
        print(f'  {{ id: \"{m}\", category: \"{c}\" }},')
    print()
"
