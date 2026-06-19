#!/usr/bin/env bash
set -euo pipefail

MINUTES=60
TEST_REDACT=0

usage() {
  echo "用法: $0 [--minutes 60] [--test-redact]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --minutes)
      shift
      [[ $# -gt 0 ]] || { usage; exit 1; }
      MINUTES="$1"
      ;;
    --test-redact)
      TEST_REDACT=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

run_redactor() {
  local input_file="$1"
  python3 - "$input_file" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='replace')


def redact_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 10:
        return value[:6] + '****' + value[-4:]
    return '[REDACTED]'

# 去掉完整请求/响应/提示词/消息体
body_field_patterns = [
    re.compile(r'(?i)("?(prompt|messages|input|request_body|response_body|request|response|body|content|params)"?\s*[:=]\s*)(\{.*\}|\[.*\]|".*"|\S+)'),
]
for pat in body_field_patterns:
    text = pat.sub(lambda m: m.group(1) + '[REDACTED_BODY]', text)

# 脱敏常见卡密/令牌/密钥字段
text = re.sub(r'\bDE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b', '[REDACTED]', text)
text = re.sub(r'(sk-[A-Za-z0-9_-]{6})([A-Za-z0-9_-]*?)([A-Za-z0-9_-]{4})', lambda m: f"{m.group(1)}****{m.group(3)}", text)
text = re.sub(r'(?i)(authorization\s*[:=]\s*bearer\s+)([^\s"\'",;]+)', lambda m: m.group(1) + redact_value(m.group(2)), text)
text = re.sub(r'(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|secret|password|cookie|token_name)\b\s*[:=]\s*([^\s"\'",;]+)', lambda m: f"{m.group(1)}=[REDACTED]", text)
text = re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._-]{8,}', lambda m: m.group(1) + '[REDACTED]', text)
text = re.sub(r'(?i)(authorization\s*[:=]\s*)[^\n]+', lambda m: m.group(1) + '[REDACTED]', text)

sys.stdout.write(text)
PY
}

if [[ "$TEST_REDACT" == "1" ]]; then
  TMP_INPUT="$(mktemp)"
  trap 'rm -f "$TMP_INPUT"' EXIT
  cat > "$TMP_INPUT"
  run_redactor "$TMP_INPUT"
  exit 0
fi

if ! [[ "$MINUTES" =~ ^[0-9]+$ ]]; then
  echo "minutes 参数必须是数字" >&2
  exit 1
fi

CONTAINER="$(docker ps --format '{{.Names}}' | awk '
  BEGIN { IGNORECASE=1 }
  /newapi/ { print; exit }
  /new-api/ { print; exit }
  /one-api/ { print; exit }
  /openai/ { print; exit }
')"

if [[ -z "$CONTAINER" ]]; then
  echo "未找到 NewAPI 容器"
  exit 0
fi

STATUS="$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)"
TMP_LOGS="$(mktemp)"
TMP_SANITIZED="$(mktemp)"
TMP_USERS="$(mktemp)"
trap 'rm -f "$TMP_LOGS" "$TMP_SANITIZED" "$TMP_USERS"' EXIT

if ! docker logs --since "${MINUTES}m" "$CONTAINER" > "$TMP_LOGS" 2>&1; then
  echo "读取 NewAPI 日志失败"
  exit 0
fi

run_redactor "$TMP_LOGS" > "$TMP_SANITIZED"

: > "$TMP_USERS"
if docker inspect newapi-prod-mysql-1 >/dev/null 2>&1; then
  SQL_DSN="$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^SQL_DSN=' | sed 's/^SQL_DSN=//' || true)"
  if [[ -n "$SQL_DSN" ]]; then
    python3 - "$SQL_DSN" <<'PY' > "$TMP_USERS"
import re
import sys

dsn = sys.argv[1]
m = re.match(r'^([^:]+):([^@]+)@tcp\(([^):]+)(?::(\d+))?\)/([^?]+)', dsn)
if not m:
    sys.exit(0)
user, password, host, port, database = m.groups()
port = port or '3306'
print(user)
print(password)
print(host)
print(port)
print(database)
PY
    mapfile -t DBCFG < "$TMP_USERS"
    if [[ ${#DBCFG[@]} -ge 5 ]]; then
      docker exec newapi-prod-mysql-1 mysql -h"${DBCFG[2]}" -P"${DBCFG[3]}" -u"${DBCFG[0]}" -p"${DBCFG[1]}" "${DBCFG[4]}" -N -e "SELECT id, username FROM users" 2>/dev/null > "$TMP_USERS" || true
    fi
  fi
fi

python3 - "$MINUTES" "$CONTAINER" "$STATUS" "$TMP_LOGS" "$TMP_SANITIZED" "$TMP_USERS" <<'PY'
import collections
import re
import sys
from datetime import datetime
from pathlib import Path

minutes = sys.argv[1]
container = sys.argv[2]
status = sys.argv[3]
raw_unredacted = Path(sys.argv[4]).read_text(encoding='utf-8', errors='replace')
raw = Path(sys.argv[5]).read_text(encoding='utf-8', errors='replace')
users_raw = Path(sys.argv[6]).read_text(encoding='utf-8', errors='replace')

lines = raw.splitlines()
raw_lines = raw_unredacted.splitlines()
user_names = {}
for line in users_raw.splitlines():
    parts = line.rstrip('\n').split('\t', 1)
    if len(parts) == 2 and parts[0].isdigit():
        user_names[parts[0]] = parts[1].strip()

error_patterns = [
    r'\[ERR\]',
    r'channel error',
    r'relay error',
    r'upstream error',
    r'do request failed',
    r'fetch failed',
    r'timeout',
    r'context deadline',
    r'connection refused',
    r'connection reset',
    r'no available channel',
    r'quota',
    r'status code\s*[:=]?\s*(400|401|403|404|429|500|502|503|504)',
    r'\|\s*(400|401|403|404|429|500|502|503|504)\s*\|',
    r'上游',
]
error_re = re.compile('|'.join(error_patterns), re.IGNORECASE)
filtered = [line for line in lines if error_re.search(line)]

if not filtered:
    print(f"最近 {minutes} 分钟未发现明显 NewAPI 报错。")
    sys.exit(0)

channel_counter = collections.Counter()
status_counter = collections.Counter()
model_counter = collections.Counter()
source_path_counter = collections.Counter()
long_source_counter = collections.Counter()
max_duration_by_source = {}
source_ips = collections.defaultdict(collections.Counter)
request_meta = {}


def label_source(meta, fallback_ip: str):
    user_id = meta.get('user_id')
    token_name = meta.get('token_name')
    username = user_names.get(user_id) if user_id else None
    if token_name and username:
        return f"{token_name}（{username}）"
    if token_name:
        return token_name
    if user_id and username:
        return f"userId={user_id}（{username}）"
    if user_id:
        return f"userId={user_id}"
    return fallback_ip


def parse_duration_seconds(text: str):
    text = text.strip()
    if not text:
        return None
    total = 0.0
    matched = False
    for value, unit in re.findall(r'([0-9]+(?:\.[0-9]+)?)(µs|ms|s|m)', text):
        matched = True
        num = float(value)
        if unit == 'µs':
            total += num / 1_000_000
        elif unit == 'ms':
            total += num / 1000
        elif unit == 's':
            total += num
        elif unit == 'm':
            total += num * 60
    return total if matched else None

for line in filtered:
    for m in re.finditer(r'(?i)channel\s*#?\s*([0-9]+)', line):
        channel_counter[f'channel #{m.group(1)}'] += 1
    for m in re.finditer(r'(?i)(?:status\s*code\s*[:=]?\s*|\|\s*)(400|401|403|404|429|500|502|503|504)(?:\s*\||\b)', line):
        status_counter[m.group(1)] += 1
    for pat in [
        r'(?i)model(?:_name)?\s*[:=]\s*([A-Za-z0-9._:/-]+)',
        r'(?i)模型\s*[:：]\s*([A-Za-z0-9._:/-]+)',
        r'(?i)using model\s+([A-Za-z0-9._:/-]+)',
    ]:
        for m in re.finditer(pat, line):
            model_counter[m.group(1)] += 1

# 从原始消费日志提取 request id -> 用户/卡密映射
for line in raw_lines:
    if 'record consume log:' not in line:
        continue
    parts = [p.strip() for p in line.split('|')]
    if len(parts) < 3:
        continue
    request_id = parts[1]
    user_m = re.search(r'userId=(\d+)', line)
    token_m = re.search(r'"token_name":"([^"]+)"', line)
    path_m = re.search(r'"request_path":"([^"]+)"', line)
    request_meta[request_id] = {
        'user_id': user_m.group(1) if user_m else None,
        'token_name': token_m.group(1) if token_m else None,
        'request_path': path_m.group(1) if path_m else None,
    }

# 读取全部 GIN 日志，补充高频来源 / 接口 / 超长请求画像
for line in lines:
    if '[GIN]' not in line:
        continue
    parts = [p.strip() for p in line.split('|')]
    if len(parts) < 7:
        continue
    request_id = parts[2]
    duration = parts[4]
    ip = parts[5]
    path = parts[6]
    if not ip or ip in ('::1', '127.0.0.1') or ip.startswith('172.18.'):
        continue
    meta = request_meta.get(request_id, {})
    source = label_source(meta, ip)
    source_path_counter[(source, path)] += 1
    source_ips[source][ip] += 1
    sec = parse_duration_seconds(duration)
    if sec is not None and sec >= 30:
        long_source_counter[source] += 1
    if sec is not None:
        prev = max_duration_by_source.get(source)
        if prev is None or sec > prev[0]:
            max_duration_by_source[source] = (sec, path, ip)

recent = filtered[-30:]

def fmt_counter(counter, fallback):
    if not counter:
        return [fallback]
    return [f"- {k}: {v}" for k, v in counter.most_common(10)]

suggestions = []
if status_counter.get('429', 0) > 0 or any('quota' in line.lower() for line in filtered):
    suggestions.append('- 出现 429 / quota，优先检查额度、限流策略和渠道配额。')
if any(code in status_counter for code in ('500', '502', '503', '504')) or any('upstream' in line.lower() for line in filtered):
    suggestions.append('- 出现 5xx / upstream，优先检查上游服务可用性、网络连通性和重试策略。')
if any(code in status_counter for code in ('401', '403')):
    suggestions.append('- 出现 401 / 403，优先检查渠道鉴权、令牌状态和权限配置。')
if any('timeout' in line.lower() or 'context deadline' in line.lower() for line in filtered):
    suggestions.append('- 出现 timeout / context deadline，优先检查上游响应时延和网关超时设置。')
if any('no available channel' in line.lower() for line in filtered):
    suggestions.append('- 出现 no available channel，优先检查可用渠道池和分组映射。')
suspicious = []
for (source, path), count in source_path_counter.most_common(20):
    max_info = max_duration_by_source.get(source)
    max_sec = max_info[0] if max_info else None
    long_count = long_source_counter.get(source, 0)
    if count > 200 or long_count >= 3 or (max_sec is not None and max_sec >= 120):
        suspicious.append((source, path, count, long_count, max_sec))

if suspicious:
    suggestions.append('- 存在疑似高并发/刷请求来源，优先核查高频卡密/用户、长耗时请求和客户端重试行为。')
if not suggestions:
    suggestions.append('- 建议结合最近 30 条摘要，重点排查高频状态码、渠道编号和模型分布。')

now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
print(f"NewAPI 最近 {minutes} 分钟报错报告")
print()
print(f"- 报告时间：{now}")
print(f"- 检查范围：最近 {minutes} 分钟")
print(f"- 容器名：{container}")
print(f"- 容器状态：{status}")
print(f"- 错误总数：{len(filtered)}")
print()
print("错误渠道排行")
print('\n'.join(fmt_counter(channel_counter, '- 未识别到明确渠道编号')))
print()
print("HTTP 状态码排行")
print('\n'.join(fmt_counter(status_counter, '- 未识别到明确 HTTP 状态码')))
print()
print("模型分布")
print('\n'.join(fmt_counter(model_counter, '- 未识别到明确模型信息')))
print()
print("高频来源 / 接口")
if source_path_counter:
    for (source, path), count in source_path_counter.most_common(10):
        top_ip = source_ips[source].most_common(1)[0][0] if source_ips[source] else '未知'
        print(f"- {source} | {path} | {count} | 主IP {top_ip}")
else:
    print('- 未识别到明显高频来源 / 接口')
print()
print("超长请求摘要")
if max_duration_by_source:
    ranked = sorted(max_duration_by_source.items(), key=lambda kv: kv[1][0], reverse=True)[:10]
    for source, (sec, path, ip) in ranked:
        print(f"- {source} | 最长 {sec:.1f}s | {path} | 超长次数 {long_source_counter.get(source, 0)} | 主IP {ip}")
else:
    print('- 未识别到明显超长请求')
print()
print("疑似并发异常")
if suspicious:
    for source, path, count, long_count, max_sec in suspicious[:10]:
        max_sec_text = f"{max_sec:.1f}s" if max_sec is not None else '未知'
        top_ip = source_ips[source].most_common(1)[0][0] if source_ips[source] else '未知'
        print(f"- {source} | {path} | 请求 {count} | 超长 {long_count} | 最长 {max_sec_text} | 主IP {top_ip}")
else:
    print('- 未发现明显疑似并发异常')
print()
print("最近 30 条关键错误摘要")
for item in recent:
    compact = re.sub(r'\s+', ' ', item).strip()
    if len(compact) > 240:
        compact = compact[:240] + ' ...'
    print(f"- {compact}")
print()
print("初步建议")
print('\n'.join(suggestions))
PY
