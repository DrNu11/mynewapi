# MIMO Channel 配置清单

> **本文档解决什么问题** — 新加跑 mimo 的 channel 时,**四层配置**必须全部就位,少一层就会把客户炸炸炸。
> 写于 2026-05-15,因为 ch9 漏配了第四层,客户 Codex 报 `Param Incorrect` 整整 4 小时。

---

## 一、四层配置必须同时就位

每加一个跑 mimo 的 channel,**四层都要检查**:

```
                               ┌──────────────────────────────────────┐
   ① channels.base_url    ──→  │ http://207.244.243.12:8317           │  cli-proxy-api
                               │  (或 https://*.xiaomimimo.com 直连)  │
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ② channels.model_mapping → │ {"gpt-5.5":"mimo-v2.5-pro", ...}     │  把客户请求名重写成 mimo 模型
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ③ channels.param_override → │ delete reasoning_effort/thinking      │  关 thinking 模式,避免
                               │ set chat_template_kwargs.enable_     │  mimo 要求 reasoning_content
                               │     thinking = false                  │  必传报 Param Incorrect
                               └──────────────────────────────────────┘

                               ┌──────────────────────────────────────┐
   ④ options.responses_to_   → │ {"channel_ids":[..., 此 channel id]} │  ★ 容易漏 ★
       chat_completions_policy │                                       │  没加 → /v1/responses 路径
                               │                                       │  完全跳过 ② ③ → 客户炸
                               └──────────────────────────────────────┘
```

### ⚠️ 第四层是最容易漏的

`param_override` 的操作 DSL **只在 `/v1/chat/completions` 路径生效**。当 codex CLI 走 `/v1/responses` 时:

- 如果 channel 在 `responses_to_chat_completions_policy.channel_ids` 名单内 → NewAPI 反向转换为 `/v1/chat/completions` → 应用 `param_override` ✅
- 如果不在名单 → 原样转发 `/v1/responses`,**`param_override` 完全不生效** ❌

---

## 二、新加 channel 的标准 SQL(直接复用)

```sql
-- ① 配置 channel(替换 NEW_ID / NEW_NAME / TARGET_BASE_URL)
UPDATE channels SET
  base_url      = 'http://207.244.243.12:8317',
  model_mapping = '{"gpt-5.5":"mimo-v2.5-pro","gpt-5.4":"mimo-v2.5-pro","gpt-5.3-codex":"mimo-v2.5-pro","gpt-5.4-mini":"mimo-v2.5","gpt-5.2":"mimo-v2.5","gpt-5.3-codex-spark":"mimo-v2.5","gpt-5.1":"mimo-v2.5-pro","gpt-5":"mimo-v2.5-pro","gpt-5-codex":"mimo-v2.5-pro"}',
  param_override = '{"operations":[{"mode":"delete","path":"reasoning_effort"},{"mode":"delete","path":"reasoning"},{"mode":"delete","path":"thinking"},{"mode":"set","path":"chat_template_kwargs.enable_thinking","value":false}]}'
WHERE id = NEW_ID;

-- ② ★ 加进反向转换名单(读取当前名单 → 加新 ID → 写回)
SELECT value FROM options WHERE `key` = 'global.responses_to_chat_completions_policy';
-- 假设当前是 [9,17,26,27,28,40], 加 NEW_ID 进去后 ↓
UPDATE options SET 
  value = '{"enabled":true,"all_channels":false,"channel_ids":[9,17,26,27,28,40,NEW_ID]}'
WHERE `key` = 'global.responses_to_chat_completions_policy';

-- ③ 重启 NewAPI 让 options 生效
-- ssh root@107.174.155.17 'cd /www/dk_project/dk_app/newapi/newapi_SAz7 && docker compose restart new-api'
```

---

## 三、诊断流程

### 3.1 客户报 `Param Incorrect: The reasoning_content in the thinking mode must be passed back to the API`

**根因 99%** = mimo 进入 thinking 模式,但客户端没把上一轮 reasoning_content 传回。

**排查顺序**:

1. 看是哪个 channel 在炸:
   ```sql
   SELECT FROM_UNIXTIME(created_at + 28800) t, channel_id, model_name, JSON_EXTRACT(other,'$.request_path') path, JSON_EXTRACT(other,'$.reasoning_effort') effort
   FROM logs WHERE type=2 AND created_at > UNIX_TIMESTAMP()-3600 AND JSON_EXTRACT(other,'$.upstream_model_name') LIKE '%mimo%'
   ORDER BY created_at DESC LIMIT 10;
   ```

2. **如果 `effort` 字段非空(xhigh / high / medium)** → `param_override` 没删掉。
   - 是 `/v1/chat/completions` 路径吗 → 检查 channel.param_override 字段是否正确设置(第三层)
   - 是 `/v1/responses` 路径吗 → 检查 channel 是否在 `responses_to_chat_completions_policy.channel_ids` 名单内(第四层)

3. **如果 `effort` 字段已经是 NULL 但还报错** → 看 cli-proxy-api 是否额外注入了 `thinking` 字段:
   ```bash
   ssh root@207.244.243.12 'journalctl -u cliproxyapi --since "5 min ago" | grep -E "thinking|reasoning"'
   ```

### 3.2 客户报 `429 Too Many Requests, exceeded retry limit`

**根因** = OAuth 池子限速,流量没成功走到 mimo。

通常伴随 Param Incorrect 出现 — NewAPI 拿到 mimo 的 400 错误后会重试,撞到 OAuth 池限速变 429。**先解决第一层 Param Incorrect,429 自然消失**。

---

## 四、当前在线 channel 配置矩阵(2026-05-15)

| ID | name | status | base_url | model_mapping | param_override | 在 ④ 名单 |
|---|---|---|---|---|---|---|
| 9 | cpa2 | ✅1 | 207:8317 | gpt-5.x → mimo | ✅ enable_thinking=false | ✅ |
| 17 | mimo 本体 | ⛔2 | xiaomimimo | deepseek → mimo | ✅ | ✅ |
| 26 | mimo(?GPT) | ⛔2 | xiaomimimo | gpt-5.x → mimo | ✅ | ✅ |
| 27 | mimo2(?GPT) | ✅1 | 207:8317 | gpt-5.x → mimo | ✅ | ✅ |
| 28 | mimo2(?DS) | ⛔2 | xiaomimimo | deepseek → mimo | ✅ | ✅ |
| 35 | mimo3(?DS) | ⛔2 | xiaomimimo | deepseek → mimo | ❌ 缺 | ❌ |
| 40 | mimo4(?DS) | ✅1 | 207:8317 | deepseek → mimo | ✅ | ✅ |

> ch35 status=2 已禁用所以暂时不用管,但**如果未来要启用必须先补 param_override + 加进名单**。

---

## 五、历史事故 — 2026-05-15

### 时间线

| 时间(UTC+8) | 事件 |
|---|---|
| 14:00 左右 | 完成 cli-proxy-api 从 154 → 207 迁移,部分 OAuth 账号 token 失效,客户开始报 429 |
| 17:00 左右 | 老板要求"最经济跑 GPT 的方法",我配置 ch9 加 model_mapping(gpt → mimo)+ param_override(enable_thinking=false) |
| 19:36 | NewAPI 重启,新请求 status=ok,首字 1.6s,以为修好了 |
| 20:23 | 合作伙伴 codex CLI 客户再次报 `Param Incorrect: reasoning_content must be passed back` |
| 21:13 | 我精确定位 — `/v1/responses` 请求里 `reasoning_effort: "xhigh"` 字段还在,param_override 没删掉 |
| 21:14 | 查 `options.responses_to_chat_completions_policy.channel_ids = [17,26,27,28,40]`,**ch9 不在名单** |
| 21:16 | UPDATE options 把 ch9 加进名单,重启 NewAPI |
| 21:19 | 验证 8 个新 `/v1/responses` 请求,reasoning_effort 全部 NULL,status 全部 ok |

### 根因

`param_override` 的操作 DSL 只在 NewAPI 的 `/v1/chat/completions` 处理路径上调用。`/v1/responses` 路径走的是另一套协议转换逻辑(`OpenAI Responses` → upstream Responses),**不会自动应用 `param_override`**。

只有当 channel 出现在 `options.responses_to_chat_completions_policy.channel_ids` 名单时,NewAPI 才会先把 `/v1/responses` 反向转换回 `/v1/chat/completions`,再应用 `param_override`,然后重新打包成 Responses 协议返回客户。

### 教训

1. **改 channel 时必须同时检查四层**,不能只盯着 channels 表
2. **`/v1/responses` 路径的请求**(codex CLI / Trae / Windsurf 内置 codex)必须显式加进反向转换名单
3. **客户报错时**,先看 `logs.other` 里的 `request_path` 和 `reasoning_effort` 字段,定位是哪一层失效

### 相关代码位置

- `@/Users/w/Desktop/newapi/build-workspace/new-api/relay/responses_handler.go:80-185` — `/v1/responses` handler
- `@/Users/w/Desktop/newapi/build-workspace/new-api/relay/responses_via_chat_completions.go:1-116` — 反向转换逻辑
- `@/Users/w/Desktop/newapi/build-workspace/new-api/relay/common/override.go:131-218` — `ApplyParamOverrideWithRelayInfo`
- `@/Users/w/Desktop/newapi/build-workspace/new-api/setting/config/config.go` — `responses_to_chat_completions_policy` GlobalConfig

---

## 六、快速诊断 SQL(运维用)

```sql
-- 看 NewAPI logs 表里所有 mimo channel 的最近请求
SELECT 
  FROM_UNIXTIME(created_at + 28800) t,
  channel_id ch, model_name client,
  JSON_EXTRACT(other,'$.request_path') path,
  JSON_EXTRACT(other,'$.upstream_model_name') upstream,
  JSON_EXTRACT(other,'$.reasoning_effort') reasoning,
  JSON_EXTRACT(other,'$.stream_status.status') status,
  ROUND(JSON_EXTRACT(other,'$.frt')/1000,1) frt_s
FROM logs 
WHERE channel_id IN (9,17,26,27,28,40) 
  AND created_at > UNIX_TIMESTAMP()-3600
ORDER BY created_at DESC LIMIT 20;

-- 看 policy 名单
SELECT value FROM options WHERE `key` = 'global.responses_to_chat_completions_policy';

-- 看所有跑 mimo 的 channel 状态
SELECT id, name, status, priority, base_url, 
       LEFT(param_override, 60) AS po_first60
FROM channels 
WHERE base_url LIKE '%mimo%' OR base_url LIKE '%xiaomimi%' 
   OR name LIKE '%mimo%' OR model_mapping LIKE '%mimo%'
ORDER BY id;
```
