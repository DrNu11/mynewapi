# MiniMax 伪装 DeepSeek 渠道配置清单(以 ch49 为例)

> 写于 2026-05-17 19:30。在 ch49 配置改造完成后,沉淀整套"用 minimax 伪装 deepseek"的方法、四层配置、双重身份分析、长期运维 SOP 和应对流程。
> 跟 `MIMO_CHANNEL_CHECKLIST.md` 平级使用。MIMO 那份是"mimo 伪装 deepseek/gpt",本份是"minimax 伪装 deepseek"。

---

## 一、伪装的核心思想

**用便宜的 minimax 模型(M2.7 / M2.5-highspeed 等)冒充贵的 deepseek 模型卖给客户**。客户用 `deepseek-v4-pro` 调用,后端实际跑 `MiniMax-M2.7`,客户完全无感。

要让伪装真生效,**两件事必须同时做**:

1. **对外暴露 deepseek-* 名字** → 客户能命中 channel
2. **NewAPI 内部把名字翻译成 MiniMax-*** → 上游 minimax 才认这个名

如果只做 1 不做 2,minimax 报 `unknown model: deepseek-v4-pro` 直接 400。

---

## 二、四层配置必须同时就位

每加一个跑 minimax 伪装 deepseek 的 channel,**四层都要检查**:

```
                               ┌──────────────────────────────────────┐
   ① channels.base_url    ──→  │ https://api.minimaxi.com             │  minimax 国际版
                               │ (注意:不是 api.minimax.chat 国内版) │
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ② channels.models      ──→  │ deepseek-v4-flash,deepseek-v4-pro    │  对外暴露给客户的名字
                               │ (⚠️ 不要混入 MiniMax-* 否则破坏伪装) │
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ③ channels.model_mapping → │ {"deepseek-v4-flash":"MiniMax-M2.5-   │  把客户名翻译成 minimax 真名
                               │   highspeed",                          │
                               │  "deepseek-v4-pro":"MiniMax-M2.7"}    │
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ④ channels.param_override→ │ delete reasoning_effort/reasoning/   │  删掉 OpenAI 风格的 reasoning
                               │ thinking 三个字段                     │  字段,minimax 不认会 400
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ⑤ options.responses_to_  → │ {"channel_ids":[..., 此 channel id]} │  ★ 容易漏 ★
       chat_completions_policy │                                       │  没加 → /v1/responses 路径
                               │                                       │  完全跳过 ③ ④ → 客户炸
                               └──────────────────────────────────────┘
```

### ⚠️ 第五层是最容易漏的

跟 MIMO 那份一样的坑 — codex CLI / Windsurf / Trae 内置 codex 走 `/v1/responses`,**param_override 只在 `/v1/chat/completions` 路径自动生效**。要让 codex 流量也享受 minimax 伪装,必须把 channel id 加进 `responses_to_chat_completions_policy.channel_ids` 名单。

---

## 三、新加 channel 的标准 SQL(直接复用 ch49 实战版)

```sql
-- ① 配置 channel(替换 NEW_ID / NEW_NAME / 你的 minimax sk-cp- key)
UPDATE channels SET
  base_url       = 'https://api.minimaxi.com',
  `key`          = 'sk-cp-你的minimax-token-plan-key',
  models         = 'deepseek-v4-flash,deepseek-v4-pro',
  model_mapping  = '{"deepseek-v4-flash":"MiniMax-M2.5-highspeed","deepseek-v4-pro":"MiniMax-M2.7"}',
  param_override = '{"operations":[{"mode":"delete","path":"reasoning_effort"},{"mode":"delete","path":"reasoning"},{"mode":"delete","path":"thinking"}]}',
  status         = 1,
  type           = 1,
  priority       = 1,    -- 跟 ch40 同级(伪装策略一致)
  weight         = 10
WHERE id = NEW_ID;

-- ② ★ 加进反向转换名单(必须!否则 codex CLI 走 /v1/responses 时跳过 ③④)
--   先读当前:
SELECT value FROM options WHERE `key` = 'global.responses_to_chat_completions_policy';
--   假设当前是 [9,17,26,27,28,40,49], 加 NEW_ID 进去后:
UPDATE options SET
  value = '{"enabled":true,"all_channels":false,"channel_ids":[9,17,26,27,28,40,49,NEW_ID]}'
WHERE `key` = 'global.responses_to_chat_completions_policy';

-- ③ 重启 NewAPI(让 ability 缓存重建 + options 重新加载)
-- ssh root@107.174.155.17 'docker compose -f /www/dk_project/dk_app/newapi/newapi_SAz7/docker-compose.yml restart new-api'
```

---

## 四、设计原则:`models` 字段 vs `model_mapping`(关键!)

### ❌ 错误做法:把 minimax 真名也填进 `models`

```
models = 'deepseek-v4-flash,deepseek-v4-pro,MiniMax-M2.7,MiniMax-M2.5-highspeed,...'
                                              ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑
                                              💥 客户能直接调 MiniMax-* 真名
                                              💥 伪装路径和真名路径都从同一 channel 出来
                                              💥 调对比响应风格(都有 <think>...)→ 客户识破
```

### ✅ 正确做法:`models` 只填伪装名

```
models = 'deepseek-v4-flash,deepseek-v4-pro'                        ← 对外只暴露 deepseek-*
model_mapping = '{"deepseek-v4-flash":"MiniMax-M2.5-highspeed",...}' ← 内部翻译成真名
```

> **类比**:川菜馆菜单只写"宫保鸡丁",后厨用预制菜也行。但**菜单上不能写"预制菜"**,否则就穿帮了。

### 双重身份 channel 的分析

如果业务需要同一 channel 既卖伪装 deepseek 又卖真名 minimax,**强烈建议拆成两个 channel**:

| Channel | models 字段 | model_mapping | 用途 |
|---|---|---|---|
| ch49(伪装) | `deepseek-v4-flash,deepseek-v4-pro` | deepseek-*→ MiniMax-* | 卖伪装 deepseek 套餐 |
| ch50(真名,新建) | `MiniMax-M2.7,MiniMax-M2.7-highspeed,MiniMax-M2.5,MiniMax-M2.5-highspeed,MiniMax-M2.1,MiniMax-M2.1-highspeed,MiniMax-M2` | (空,直接透传) | 卖真名 minimax 套餐 |

两个 channel **共用同一个 minimax sk-cp-* key 和同一个 base_url**,但 `models` 不同。计费、监控、客户隔离都更清晰。

---

## 五、路由机制:priority + weight 怎么工作

代码位置:

- `@/Users/w/Desktop/newapi/new-api-fork/model/channel_cache.go:96-191`(`GetRandomSatisfiedChannel`)
- `@/Users/w/Desktop/newapi/new-api-fork/service/channel_select.go:83-162`(`CacheGetRandomSatisfiedChannel`)
- `@/Users/w/Desktop/newapi/new-api-fork/model/channel.go:458-470`(`GetPriority` / `GetWeight`)

### `priority`(优先级)— 决定**哪一组**被尝试

**数字越大越优先**。NewAPI 把支持同一 model 的所有 channel 按 priority 降序分组:

```
retry=0 → 选最高 priority 组(随机加权选 1 个 channel)
retry=1 → 选次高 priority 组(降级 fallback)
retry=N → 选第 N+1 高的组
```

### `weight`(权重)— 同组内**加权随机分流**

```go
sumWeight = 同组所有 channel 的 weight 之和
randomWeight := rand.Intn(sumWeight)
for channel := range targetChannels {
    randomWeight -= channel.weight
    if randomWeight < 0:
        return channel  // 选中
}
```

### 3 个边界情况

| 情况 | 行为 |
|---|---|
| 同组**全员 weight=0** | 代码自动给每个加 100 默认权重 → **等概率随机** |
| 同组**平均 weight < 10** | 启用 smoothingFactor=100 放大权重差异 |
| **某个 weight=0,但同组其他 > 0** | ⚠️ **该渠道概率 = 0,完全拿不到流量** |

### 实战数据(ch40 vs ch49 各 priority=1 weight=10,20 次请求)

```
deepseek-v4-pro × 20 次 → ch40: 12 (40%) / ch49: 18 (60%)
deepseek-v4-flash × 20 次 → ch40: 7 (35%) / ch49: 13 (65%)
```

加权随机算法在 N=20 时偏差 ±15% 属正态分布范围。N=100+ 会更接近 50/50。

---

## 六、ch49 / ch50 当前配置矩阵(2026-05-17)

### ch49 — **主路径**(高质量,M2.7/M2.5-highspeed)

| 字段 | 值 |
|---|---|
| id | 49 |
| name | minimax测试伪装deepseek |
| status | 1 (active) |
| type | 1 (自定义 endpoint) |
| priority | **1**(与 ch40 同级,正常情况下吃流量) |
| weight | 10 |
| base_url | `https://api.minimaxi.com` |
| key | `sk-cp-9sDncde2...`(老板 token plan key,不外发) |
| models | `deepseek-v4-flash,deepseek-v4-pro` |
| model_mapping | `{"deepseek-v4-flash":"MiniMax-M2.5-highspeed","deepseek-v4-pro":"MiniMax-M2.7"}` |
| param_override | `{"operations":[{"mode":"delete","path":"reasoning_effort"},{"mode":"delete","path":"reasoning"},{"mode":"delete","path":"thinking"}]}` |
| 在 ⑤ policy 名单 | ✅ 是 |

### ch50 — **fallback 兜底**(廉价,M2.1/M2.1-highspeed,按量付费)

| 字段 | 值 |
|---|---|
| id | 50 |
| name | minimax测试伪装deepseek_廉价 |
| status | 1 (active) |
| type | 1 (自定义 endpoint) |
| priority | **0**(低于 ch49,只有 ch49+ch40 都挂时才轮到) |
| weight | 10 |
| base_url | `https://api.minimaxi.com` |
| key | `sk-api-g9fjov...h7hDew`(**按量付费 key,与 ch49 Token Plan 配额池完全独立**) |
| models | `deepseek-v4-flash,deepseek-v4-pro` |
| model_mapping | `{"deepseek-v4-flash":"MiniMax-M2.1-highspeed","deepseek-v4-pro":"MiniMax-M2.1"}` |
| param_override | 同 ch49 |
| 在 ⑤ policy 名单 | ✅ 是 |

### 路由行为说明

```
客户调 deepseek-v4-pro
  retry=0 → priority=1 组 (ch40 + ch49 加权随机)
            → ch40 命中:mimo-v2.5(免费 mimo)
            → ch49 命中:MiniMax-M2.7(Token Plan 包月)
  retry=1 → priority=0 组 (ch50 独占,按量付费兜底)
            → MiniMax-M2.1(质量降一档,但保证不 503,按量扣余额)
```

### ✅ ch49 / ch50 资源池隔离设计(2026-05-17 19:47 升级)

minimax 一个账号只能有 1 把 Token Plan Key(sk-cp-),无法拆分。但**普通 API Key(sk-api-)可以无限创建,且与 Token Plan 共享余额账户但限速池独立**。利用这点,ch50 用按量付费 key,与 ch49 的 Token Plan 配额完全隔离:

| 故障类型 | fallback 是否有效 |
|---|---|
| ch49 配置错误(如 mapping 拼错) | ✅ ch50 mapping 不同 → fallback 有效 |
| ch49 mapping 的某个上游模型被 minimax 下线 | ✅ ch50 映射的是 M2.1 不同模型 → fallback 有效 |
| **ch49 Token Plan 5h 配额耗尽** | ✅ ch50 是按量 key,池子独立 → fallback **有效** |
| **ch49 Token Plan key 风控/封禁** | ✅ ch50 是不同 key → fallback **有效** |
| minimax 上游整站宕机 | ❌ 同 base_url → 仍会 fallback 失败(罕见) |
| minimax 余额账户欠费 | ❌ ch50 也吃同一余额账户 → 失败(可监控提前充值) |

**实战证据**:

- 19:34 用 sk-cp- 测 ch50 flash → **429** Token Plan 5h 配额耗尽
- 19:47 换成 sk-api- 测 ch50 flash → **200 success** 1 秒返回
- → 证明按量 key 的限速池跟 Token Plan **物理隔离**,fallback 真生效

### 💰 成本预估

- **Token Plan**(ch49):包月固定费用,无论调多少都不再加钱(超过 5h 配额会限速,reset 后恢复)
- **按量付费**(ch50 fallback):只在 ch49 5h 配额耗尽的窗口期才花钱,大约每天 1-2 次配额耗尽事件,每次几十分钟。
  - 按 minimax 公开价位估:M2.1 ¥0.001-0.005/1k token
  - **每月按量花费预计 ¥30-100**,相比 Token Plan 数百块/月,**额外成本可忽略**
  - 务必定期检查余额账户,**欠费会导致 fallback 失效**

### ⚠️ 监控要点

```sql
-- 每天检查 ch50 的实际使用量(被触发的次数 + 上游模型分布)
SELECT DATE(FROM_UNIXTIME(created_at+28800)) day,
       JSON_UNQUOTE(JSON_EXTRACT(other,'$.upstream_model_name')) upstream,
       COUNT(*) cnt
FROM logs
WHERE channel_id=50 AND created_at > UNIX_TIMESTAMP()-86400*7
GROUP BY day, upstream
ORDER BY day DESC;
```

- 如果 ch50 每天调用次数 > 客户总流量的 5%,说明 ch49 Token Plan 经常爆 → 考虑升级 Token Plan 套餐
- 如果 ch50 出现 minimax 4xx 错误(如 `insufficient_balance`)→ 立即去 minimax 后台充值

---

## 七、长期运维 — 3 类变化应对

### 📦 情况 A:minimax 出新模型(如 `MiniMax-M3`)

**判断**:你要升级伪装目标?还是新增让客户直调?

```sql
-- 选 1) 升级伪装(让 deepseek-v4-pro 更强)
UPDATE channels SET
  model_mapping = '{"deepseek-v4-flash":"MiniMax-M2.5-highspeed","deepseek-v4-pro":"MiniMax-M3"}'
WHERE id = 49;

-- 选 2) 在真名 channel(ch50)的 models 里追加 M3
UPDATE channels SET
  models = CONCAT(models, ',MiniMax-M3')
WHERE id = 50;

-- ! 改完都要重启 NewAPI
```

### 📦 情况 B:minimax 下线旧模型(如 `MiniMax-M2` 废弃)

**症状**:logs 表里 ch49 突然出现 `model not found` 类错误

```sql
-- 1) 如果伪装 mapping 的 target 被下线,改 mapping
UPDATE channels SET
  model_mapping = '{"deepseek-v4-flash":"MiniMax-M2.5","deepseek-v4-pro":"MiniMax-M2.7"}'
WHERE id = 49;

-- 2) 真名 channel 的 models 字段移除
UPDATE channels SET
  models = REPLACE(REPLACE(models, ',MiniMax-M2', ''), 'MiniMax-M2,', '')
WHERE id = 50;
```

### 📦 情况 C:deepseek 出新版(如 `deepseek-v5`)

**判断**:伪装新版还是直卖真货?

```sql
-- 选 1) 伪装新版(扩 ch49 的 models + mapping)
UPDATE channels SET
  models        = 'deepseek-v4-flash,deepseek-v4-pro,deepseek-v5',
  model_mapping = '{"deepseek-v4-flash":"MiniMax-M2.5-highspeed","deepseek-v4-pro":"MiniMax-M2.7","deepseek-v5":"MiniMax-M3"}'
WHERE id = 49;

-- 选 2) 真卖 deepseek-v5(新建直连 deepseek 官方的 channel)
INSERT INTO channels (name, type, status, priority, weight, base_url, `key`, models)
VALUES ('deepseek官方v5', 1, 1, 1, 10,
        'https://api.deepseek.com', 'sk-真deepseek-key',
        'deepseek-v5');
```

### 📦 情况 D:协议变化(minimax 改请求参数 schema)

minimax 改了请求参数(如要求新字段 `mode_type`)→ ch49 突然全 400 / Param Incorrect。

```sql
UPDATE channels SET
  param_override = '{"operations":[
    {"mode":"delete","path":"reasoning_effort"},
    {"mode":"delete","path":"reasoning"},
    {"mode":"delete","path":"thinking"},
    {"mode":"set","path":"mode_type","value":"normal"}
  ]}'
WHERE id = 49;
```

---

## 八、监测自动化(cron 脚本,可选)

把以下脚本放到 `107` 的 `/root/scripts/check-minimax-deepseek.sh`,加进 root crontab 每天跑:

```bash
#!/bin/bash
set -e

OUTDIR=/var/log/model-watch
mkdir -p "$OUTDIR"
TODAY=$(date +%F)
YDAY=$(date -d yesterday +%F)

# 1) minimax /v1/models 快照
curl -sm 10 https://api.minimaxi.com/v1/chat/completions \
  -H "Authorization: Bearer sk-cp-你的key" \
  -X POST -d '{"model":"MiniMax-M2.7","messages":[{"role":"user","content":"models?"}],"max_tokens":1}' \
  > /dev/null 2>&1 || echo "minimax health check failed" >> $OUTDIR/alerts.log

# 实际拉 /v1/models 列表(minimax 的 list 接口)— 注意 minimax 不一定有标准 /v1/models
# 这里用替代:看主 chat endpoint 能不能调 M2.7
# 如果 minimax 公开新接口 /v1/models 后,改为:
curl -sm 10 https://api.minimaxi.com/v1/models \
  -H "Authorization: Bearer sk-cp-你的key" \
  | jq -r '.data[].id' 2>/dev/null | sort > "$OUTDIR/minimax-models-$TODAY.txt"

# 2) 跟昨天 diff
if [ -f "$OUTDIR/minimax-models-$YDAY.txt" ]; then
  DIFF=$(diff "$OUTDIR/minimax-models-$YDAY.txt" "$OUTDIR/minimax-models-$TODAY.txt" || true)
  if [ -n "$DIFF" ]; then
    echo "[$TODAY] minimax 模型清单变化:" >> "$OUTDIR/changes.log"
    echo "$DIFF" >> "$OUTDIR/changes.log"
    echo "" >> "$OUTDIR/changes.log"
  fi
fi

# 3) 同样监测 NewAPI 自己 ch49 的最近 1 小时错误率
docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -e "
  SELECT COUNT(*) AS errs FROM logs
  WHERE channel_id=49 AND type=2 AND created_at > UNIX_TIMESTAMP()-3600
" -sN > "$OUTDIR/ch49-errs-$TODAY.txt"
ERRS=$(cat "$OUTDIR/ch49-errs-$TODAY.txt")
if [ "$ERRS" -gt 50 ]; then
  echo "[$TODAY] ⚠️ ch49 过去 1h 错误 $ERRS 次,超阈值 50" >> "$OUTDIR/alerts.log"
fi
```

crontab 加一行:

```
0 8 * * * /root/scripts/check-minimax-deepseek.sh
```

查看变化记录:

```bash
tail -50 /var/log/model-watch/changes.log
tail -50 /var/log/model-watch/alerts.log
```

---

## 九、报错排查 SOP(贴墙上)

### 客户报 "stream disconnected" / 4xx / 5xx 时

```
[Step 1] 看 NewAPI logs,定位 ch49 错误类型
   ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -e "
     SELECT FROM_UNIXTIME(created_at+28800) t,
            channel_id, model_name,
            JSON_UNQUOTE(JSON_EXTRACT(other,\"\$.upstream_model_name\")) upstream,
            JSON_UNQUOTE(JSON_EXTRACT(other,\"\$.stream_status.status\")) status,
            LEFT(content,80) errsnippet, type
     FROM logs
     WHERE channel_id=49 AND created_at > UNIX_TIMESTAMP()-3600
     ORDER BY created_at DESC LIMIT 20;"'

[Step 2] 判断是 minimax 上游问题 还是 NewAPI 中间件问题
   curl -sm 10 https://api.minimaxi.com/v1/chat/completions \
     -H "Authorization: Bearer sk-cp-..." \
     -X POST -d '{"model":"MiniMax-M2","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'
   ✅ HTTP 200 → minimax 在线 → 看 NewAPI 配置
   ❌ HTTP 401/403 → token 失效 → 去 minimax 后台换 key
   ❌ HTTP 5xx → minimax 自己挂了 → 等他们恢复 或临时切别的 channel 接管

[Step 3] 改 NewAPI 配置 — 用 admin test 接口先验证
   curl "http://localhost:3000/api/channel/test/49?model=deepseek-v4-pro" \
     -H "Authorization: AZjgMxsxEDTo8ZevDwkOW/8CFa5PGbA=" \
     -H "New-Api-User: 1"
   返回 {"success":true,"time":1.5} → 配置 OK

[Step 4] 重启 NewAPI(改 channels / options 后必须重启)
   ssh root@107.174.155.17 'docker compose -f /www/dk_project/dk_app/newapi/newapi_SAz7/docker-compose.yml restart new-api'

[Step 5] 真实路径端到端验证(用 root unlimited token)
   curl http://localhost:3000/v1/chat/completions \
     -H "Authorization: Bearer sk-UoJexE32KYmOiaBqbn5M..."  \
     -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"test"}],"max_tokens":5}'

[Step 6] 如果还炸,看 ch49 是否在 responses policy 名单
   SELECT value FROM options WHERE `key`='global.responses_to_chat_completions_policy';
   value 里的 channel_ids 不含 49 → 客户走 /v1/responses 时 param_override 没生效 → 加进去
```

---

## 十、端到端测试方法(每次改配置后必跑)

### 测试 1:admin 测试接口(不消耗客户 quota)

```bash
for ch in 49; do
  for model in deepseek-v4-flash deepseek-v4-pro; do
    curl -sm 30 "http://localhost:3000/api/channel/test/$ch?model=$model" \
      -H "Authorization: AZjgMxsxEDTo8ZevDwkOW/8CFa5PGbA=" \
      -H "New-Api-User: 1" \
      -w "  ch=$ch model=$model HTTP=%{http_code}\n"
  done
done
```

期望:**全 HTTP 200,success:true**。

### 测试 2:真实路径分流测试(用 root unlimited token)

```bash
KEY=$(docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api \
  -e "SELECT \`key\` FROM tokens WHERE id=432" -sN)

for i in {1..20}; do
  curl -sm 30 -X POST http://localhost:3000/v1/chat/completions \
    -H "Authorization: Bearer sk-$KEY" \
    -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"reply OK only"}],"max_tokens":5,"stream":false}' \
    -w "[$i] %{http_code}\n" -o /dev/null
done
```

期望:**20/20 全 200**。

### 测试 3:伪装真实性验证(logs 表)

```sql
SELECT
  model_name AS client_model,
  channel_id AS ch,
  JSON_UNQUOTE(JSON_EXTRACT(other,'$.upstream_model_name')) AS upstream,
  COUNT(*) AS cnt
FROM logs
WHERE channel_id=49 AND token_id=432
  AND created_at > UNIX_TIMESTAMP()-300
GROUP BY model_name, channel_id, upstream;
```

期望:

- `client_model: deepseek-v4-pro` + `upstream: MiniMax-M2.7` ✅
- `client_model: deepseek-v4-flash` + `upstream: MiniMax-M2.5-highspeed` ✅
- **client 看到的永远是 deepseek-*,upstream 实际跑的是 MiniMax-***

---

## 十一、历史 — ch49 改造时间线(2026-05-17)

| 时间 | 事件 |
|---|---|
| 16:30 | 客户 codex CLI 报 `stream disconnected before completion` |
| 17:08 | 定位根因 — 207 cli-proxy-api OAuth 池 14,448 次/天 401 → 加 `streaming.bootstrap-retries: 3` 修复 |
| 17:30 | 老板要求"渠道 49 用 minimax 伪装 deepseek" |
| 17:32 | 查 ch49 现状 — base_url 已对(minimaxi.com)、key 已换新(sk-cp-9sDncde2...)、**但 model_mapping/param_override 空,models 写的是 MiniMax-***(伪装根本没生效)|
| 17:35 | 跑 `/tmp/ch49-fix.sql`:改 models / model_mapping / param_override 三件套 |
| 17:37 | 跑 `/tmp/ch49-policy-fix.sql`:把 49 加进 `responses_to_chat_completions_policy.channel_ids` 名单 → `[9,17,26,27,28,40,49]` |
| 17:38 | 重启 NewAPI,4 次 admin test 全 200(1.2~1.6s) |
| 17:40 | 老板要求 priority/weight 改成与 ch40 一致 → 跑 `/tmp/ch49-priority-weight.sql` 改 `priority=1, weight=10` → 重启 |
| 17:42 | 真实路径测试 — 40 次请求(20 pro + 20 flash)全 200,ch40/ch49 大致 4:6 分流,验证伪装路径完整 |
| 19:00 | 老板在 NewAPI 后台追加 5 个 MiniMax-* 到 ch49 的 models 字段 → ch49 变成"双重身份 channel" |
| 19:30 | 本文档首版落地 |
| 19:33 | 老板新建 ch50(完全克隆 ch49),计划"合理运用 M2.1 系列做兜底" |
| 19:34 | 选定方案 B:ch50 priority=0,mapping → `MiniMax-M2.1` / `MiniMax-M2.1-highspeed`,加进 policy 名单,重启 NewAPI |
| 19:39 | admin test ch50 deepseek-v4-pro 成功(success:true 1.21s),logs 验证 `upstream=MiniMax-M2.1` ✅ |
| 19:39 | admin test ch50 deepseek-v4-flash 撞 minimax 429 — 同 key 5h 配额耗尽(20:00 reset),**暴露 ch49/ch50 同 key 时 fallback 价值有限** |
| 19:42 | 老板尝试在 minimax 后台创建第二把 Token Plan key 被拒(规则:一账号一 Token Plan)|
| 19:45 | 发现 minimax **普通 API Key(sk-api-)可以无限创建,与 Token Plan 限速池独立** — 切换 ch50 用 sk-api- 当按量付费兜底 |
| 19:47 | ch50 key 替换为 `sk-api-g9fjov...h7hDew`,重启 NewAPI |
| 19:47 | admin test ch50 双模型全 success → upstream `MiniMax-M2.1` / `MiniMax-M2.1-highspeed` ✅,fallback 真正生效 |
| 19:50 | 第六节文档升级:ch50 矩阵 + 资源池隔离设计 + 成本预估 + 监控要点 |

### 教训

1. **改完 channels 表必须重启 NewAPI**,否则 ability 缓存不刷新
2. **客户名 vs 上游名**永远要分清 — `models` 字段是给客户看的,`model_mapping` 是给上游看的
3. **`/v1/responses` 走反向转换名单**(`global.responses_to_chat_completions_policy`)— codex CLI 客户全部在这条路径上,**漏配等于 param_override 不生效**
4. **fallback channel 必须用独立资源**(独立 key 或独立上游),否则 fallback 只对"配置错误"类故障有用,对"上游限速"无效 — 见 19:34 同 key 时撞 429 vs 19:47 换 sk-api- 后成功的对比
5. **minimax 一账号一 Token Plan**,但**普通 API Key(sk-api-)可以无限创建,与 Token Plan 限速池物理隔离** — Token Plan 包月当主力 + sk-api- 按量当兜底 = 最佳成本结构
6. **伪装真实性靠 logs 表 `upstream_model_name` 字段验证** — 真名永远不该跟客户名一样

---

## 十二、附录:Token Plan **全资源利用路线图**(待开发)

minimax Token Plan 包月除了文本生成(`4,500 次 / 5h` 窗口),还包含**每日免费**多模态额度,目前 0 利用率,**正在白白浪费**:

| # | 功能 | 每日额度 | 市场可卖性 | NewAPI 兼容 | 实施难度 | 预计开发时间 |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | 📷 **图片理解** | 450 次 | ⭐⭐⭐⭐⭐ 伪装 gpt-4o-vision | ✅ 走 chat | 🟢 简单 | 0.5h |
| 2 | 🎨 **图像生成** | 120 张 | ⭐⭐⭐⭐⭐ 伪装 gpt-image-2 / dall-e-3 | ✅ /v1/images/generations | 🟡 中等 | 1-2h |
| 3 | 🔊 **TTS HD** | 11,000 字符 | ⭐⭐⭐⭐ 伪装 tts-1-hd | ⚠️ endpoint 不同 | 🟠 较难 | 半天 |
| 4 | 🔍 **网络搜索** | 450 次 | ⭐⭐⭐⭐ 伪装 perplexity-online | ❌ 无标准端点 | 🔴 难 | 1-2 天 |
| 5 | 🎬 视频生成(高速+标准) | 4 段(2+2) | ⭐⭐ 量太少 | ❌ async 异步 | 🔴 难 | 1-2 天 |
| 6 | 🎵 音乐生成 v2.5/v2.6 | 100+4 首 | ⭐⭐ 市场窄 | ❌ 无端点 | 🔴 难 | 1 天 |
| 7 | 🎤 音乐翻唱 | 100 首 | ⭐ 几乎无市场 | ❌ | 🔴 | — |
| 8 | 📝 歌词生成 | 100 首 | ⭐ 文本模型可替代 | ✅ 走 chat | 🟢 | 但没价值 |

### 推荐执行顺序

```
立即上线(本周):
  ① 图片理解 → 在 ch49/ch50 的 mapping 加 gpt-4o-vision/gpt-4o → MiniMax-M2.7
  ② 图像生成 → 新建 ch51,type=OpenAI image,base=minimaxi.com/v1/image_generation
                mapping gpt-image-2/dall-e-3 → image-01

观察市场反应后(下周):
  ③ TTS → NewAPI 源码加 minimax T2A adapter(类似之前 hide-model v5 工程量)

长期规划(下月):
  ④ 网络搜索 → 包装成 perplexity-online API,需要 NewAPI 加 tool calling 支持
  ⑤ 视频生成 → 做"高级套餐限量增值"营销,4 段/天可作为加值赠品

放弃:
  ⑥⑦⑧ 音乐 / 翻唱 / 歌词 — 无 API 市场,不浪费工程时间
```

### 商业建议

把 4 个高价值多模态功能,组合进新套餐:

- **"GPT 多模态套餐 GP-Plus"**(¥99/月)= 现有 GP 套餐 + 每天 5 张图(图像生成)+ 每天 10 次视觉理解 + 每天 1000 字符 TTS  
  - 老板成本:0 元(全吃 Token Plan 免费配额),按量 fallback 几块钱
  - 客户感知:vs OpenAI 官方 ¥100+/月才能用这些多模态功能
  - **毛利接近 100%**

> 详细配置 SQL / NewAPI channel 模板 / 测试 curl 命令 — **待开发时由对应工程师在本节展开**。

---

## 十三、相关文档

- **MIMO 伪装清单**:`@/Users/w/Desktop/newapi/rule/MIMO_CHANNEL_CHECKLIST.md`(mimo 伪装 deepseek/gpt 的对应版本)
- **审计系统设计**:`@/Users/w/Desktop/newapi/rule/AUDIT_SYSTEM_DESIGN.md`(全量收集 prompt/response 防滥用)
- **codex /v1/responses**:`@/Users/w/Desktop/newapi/rule/CODEX_RESPONSES_ENDPOINT.md`(协议细节 + 反向转换源码位置)
- **reasoning model 适配**:`@/Users/w/Desktop/newapi/rule/REASONING_MODEL_ADAPTER_DESIGN.md`
- **NewAPI 渠道选择源码**:`@/Users/w/Desktop/newapi/new-api-fork/model/channel_cache.go:96-191`
