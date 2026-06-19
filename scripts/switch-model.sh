#!/bin/bash
# 切换 OpenClaw agent 模型, 网关自动热加载
# Usage: switch-model.sh [model_id|--list]
CONFIG="/root/.openclaw/openclaw.json"

if [ "${1:-}" = "--list" ] || [ "${1:-}" = "列表" ]; then
  echo "可用模型:"
  echo "  MiniMax-M3    — minimax/MiniMax-M3 (MiniMax 旗舰)"
  echo "  gpt-5.5       — myself/gpt-5.5 (本地)"
  echo "  gpt-5.4       — claude11/gpt-5.4 (本地)"
  echo "  gpt-5.3-codex — claude11/gpt-5.3-codex (Codex)"
  echo ""
  echo "发送「切换 <模型名>」来切换"
  exit 0
fi

if [ -z "${1:-}" ]; then
  CURRENT=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c['agents']['defaults']['model']['primary'])")
  echo "当前模型: $CURRENT"
  echo ""
  echo "发送「切换 <模型名>」来切换"
  echo "发送「模型列表」查看可用模型"
  exit 0
fi

MODEL="$1"

# Map short name → provider/model
case "$MODEL" in
  "MiniMax-M3") FULL="minimax/MiniMax-M3" ;;
  "gpt-5.5")    FULL="myself/gpt-5.5" ;;
  "gpt-5.4")    FULL="claude11/gpt-5.4" ;;
  "gpt-5.3-codex") FULL="claude11/gpt-5.3-codex" ;;
  *)            FULL="$MODEL" ;;  # 允许直接传 provider/model
esac

python3 -c "
import json
with open('$CONFIG') as f:
    c = json.load(f)
old = c['agents']['defaults']['model']['primary']
c['agents']['defaults']['model']['primary'] = '$FULL'
with open('$CONFIG', 'w') as f:
    json.dump(c, f, indent=2, ensure_ascii=False)
print(f'✅ 模型已切换')
print(f'   {old}')
print(f'→ $FULL')
print(f'')
print(f'网关自动热加载，立即生效。')
"
