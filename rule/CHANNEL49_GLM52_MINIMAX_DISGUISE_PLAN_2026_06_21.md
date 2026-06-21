# 渠道 49 复制为 glm-5.2 -> MiniMax 兼容映射计划

> 创建时间: 2026-06-21
> 状态: 已上线
> 目标: 以渠道 49 为模板新增一个独立渠道,对外暴露 `glm-5.2`,上游实际请求 MiniMax,并保持现有渠道 49 与其他生产定制不受影响。

## 0. 安全边界

- 不直接修改渠道 49。
- 不打印、不导出、不写入文档任何渠道 API Key。
- 不覆盖生产镜像、不部署、不重启服务。
- 新渠道必须先备份、再创建,创建后先做最小流量或禁用验证。
- 任何 SQL 执行前必须确认目标是"新增复制渠道",不是"原地改 49"。
- 如果后续要上线,必须先得到用户明确确认。

## 1. 线上渠道 49 当前基线

只读检查时间: 2026-06-21。

| 字段 | 当前值 |
|---|---|
| id | `49` |
| status | `1` |
| type | `1` OpenAI 兼容 |
| name | `djds1` |
| base_url | `https://api.minimaxi.com` |
| models | `deepseek-v4-flash,deepseek-v4-pro` |
| model_mapping | `deepseek-v4-pro -> MiniMax-M2.7`, `deepseek-v4-flash -> MiniMax-M2.5-highspeed` |
| group | 复制时必须按 49 原值原样复制 |
| priority / weight | `99 / 12` |
| test_model | 空 |
| abilities | `deepseek-v4-flash` 6 条,`deepseek-v4-pro` 6 条,priority/weight 均为 `99/12` |
| responses policy | `global.responses_to_chat_completions_policy.channel_ids` 已包含 `49` |
| param_override | 设置 `reasoning_effort=high`,删除 `reasoning`/`thinking`/`instructions`,并把 token 范围限制在 `128..196608` |
| setting | 开启 `system_prompt_override=true`,当前 prompt 是 DeepSeek 身份 |
| settings | 禁止自动同步上游模型,关闭若干 OpenAI 扩展字段透传 |

额外事实:

- 生产中未发现活跃 `glm-5.2` 渠道。
- 活跃 GLM 渠道主要是 48/91,但它们不暴露 `glm-5.2`。
- 因为 49 已在 Responses 转 Chat policy 中,新渠道若要兼容 Codex 或 Responses API,也必须加入同一个 policy。

## 2. 新渠道目标配置

建议新渠道只暴露一个模型名,避免真实上游或其他别名混入。

| 字段 | 建议值 |
|---|---|
| 操作方式 | `INSERT ... SELECT` 从渠道 49 复制一份 |
| status | 首次创建建议 `2` 禁用,验证前不接生产流量 |
| type | `1` |
| name | `glm-5.2-minimax-from-ch49` |
| base_url | 复制 49: `https://api.minimaxi.com` |
| key | 复制 49 的 key,但全程不输出 |
| models | `glm-5.2` |
| model_mapping | `{"glm-5.2":"MiniMax-M2.7"}` |
| test_model | `glm-5.2` |
| group | 复制 49,或只保留测试分组后再放量 |
| priority / weight | 验证期建议 `0 / 0` 或禁用;上线期再决定是否复制 `99 / 12` |
| param_override | 复制 49 |
| setting.system_prompt | 替换为 GLM 身份 prompt |
| setting.system_prompt_override | `true` |
| settings | 复制 49,保持上游模型自动同步关闭 |
| channel_info | 复制 49,不改变 key 模式 |

上游模型默认选 `MiniMax-M2.7`。如果目标是低延迟版本,可把映射改为:

```json
{"glm-5.2":"MiniMax-M2.5-highspeed"}
```

但默认建议先用 `MiniMax-M2.7`,因为它对应 49 的 pro 质量档。

## 3. GLM 身份 prompt 要点

新渠道不能沿用 49 的 DeepSeek 身份 prompt,否则用户问身份会得到 DeepSeek,与 `glm-5.2` 对外名冲突。

建议 prompt 目标:

- 自称 `GLM-5.2` 或 `glm-5.2`。
- 不提 MiniMax、MiniMax-M2、M2、M3、abab、Hailuo、海螺、稀宇科技。
- 不主动提真实上游供应商、内部路由、渠道映射。
- 对模型身份问题保持短答,例如"我是 GLM-5.2。"
- 对工具调用、代码、长上下文请求不插入身份解释。

## 4. 需要同步的 NewAPI 路由副本

NewAPI 不是只看 `channels.models`。新增渠道后至少要处理三处:

1. `channels`
   - 保存渠道主体配置、模型映射、param_override、setting。
2. `abilities`
   - 路由缓存表必须生成 `glm-5.2` 对应记录。
   - 建议从 49 的 abilities 分组复制,但 model 改为 `glm-5.2`。
3. `options.global.responses_to_chat_completions_policy`
   - 新 channel id 必须加入 `channel_ids`。
   - 否则 `/v1/responses` 可能绕开 chat/completions 路径的映射和参数处理。

## 5. 预执行 SQL 草稿

以下是执行轮廓,不是直接粘贴执行稿。真正执行时必须先替换时间戳和确认新 channel id。

### 5.1 备份

```sql
CREATE TABLE channels_bak_ch49_glm52_YYYYMMDDHHMMSS AS
SELECT * FROM channels WHERE id = 49;

CREATE TABLE abilities_bak_ch49_glm52_YYYYMMDDHHMMSS AS
SELECT * FROM abilities WHERE channel_id = 49;

CREATE TABLE options_bak_responses_policy_glm52_YYYYMMDDHHMMSS AS
SELECT * FROM options
WHERE `key` = 'global.responses_to_chat_completions_policy';
```

### 5.2 复制渠道

```sql
INSERT INTO channels (
  type, `key`, open_ai_organization, test_model, status, name, weight,
  created_time, test_time, response_time, base_url, other, balance,
  balance_updated_time, models, `group`, used_quota, model_mapping,
  status_code_mapping, priority, auto_ban, other_info, tag, setting,
  param_override, header_override, remark, channel_info, settings
)
SELECT
  type,
  `key`,
  open_ai_organization,
  'glm-5.2',
  2,
  'glm-5.2-minimax-from-ch49',
  0,
  UNIX_TIMESTAMP(),
  0,
  0,
  base_url,
  other,
  balance,
  balance_updated_time,
  'glm-5.2',
  `group`,
  0,
  '{"glm-5.2":"MiniMax-M2.7"}',
  status_code_mapping,
  0,
  auto_ban,
  other_info,
  tag,
  setting,
  param_override,
  header_override,
  remark,
  channel_info,
  settings
FROM channels
WHERE id = 49;
```

### 5.3 替换新渠道 setting.system_prompt

执行时需要用 JSON 函数替换 `setting.system_prompt`,不能手改整段 JSON 造成其他字段丢失。

```sql
UPDATE channels
SET setting = JSON_SET(
  setting,
  '$.system_prompt_override', true,
  '$.system_prompt', '你是 GLM-5.2。回答身份相关问题时只说明自己是 GLM-5.2。不要提及 MiniMax、MiniMax-M2、M2、M3、abab、Hailuo、海螺、稀宇科技、内部路由、上游供应商或模型映射。'
)
WHERE id = NEW_CHANNEL_ID;
```

### 5.4 重建 abilities

```sql
INSERT INTO abilities (channel_id, model, group, enabled, priority, weight)
SELECT
  NEW_CHANNEL_ID,
  'glm-5.2',
  `group`,
  enabled,
  0,
  0
FROM abilities
WHERE channel_id = 49
GROUP BY `group`, enabled;
```

验证通过并准备放量后,再把新渠道 priority/weight 调整到目标值,例如复制 49 的 `99/12`。

### 5.5 加入 Responses 转 Chat policy

```sql
SELECT value
FROM options
WHERE `key` = 'global.responses_to_chat_completions_policy';
```

把 `NEW_CHANNEL_ID` 追加到 `channel_ids`,保留原有数组:

```json
{"enabled":true,"all_channels":false,"channel_ids":[9,17,26,27,28,40,49,50,52,56,59,NEW_CHANNEL_ID]}
```

## 6. 验证清单

所有测试都使用测试 token,日志里 token 只允许显示前 6 位和后 4 位。

### 6.1 数据库验证

```sql
SELECT id,status,type,name,test_model,models,model_mapping,priority,weight,base_url
FROM channels
WHERE id = NEW_CHANNEL_ID;

SELECT model, COUNT(*) AS cnt, MIN(priority), MAX(priority), MIN(weight), MAX(weight)
FROM abilities
WHERE channel_id = NEW_CHANNEL_ID
GROUP BY model;

SELECT value
FROM options
WHERE `key` = 'global.responses_to_chat_completions_policy';
```

期望:

- `models` 只包含 `glm-5.2`。
- `model_mapping` 只包含 `glm-5.2 -> MiniMax-M2.7`。
- abilities 只包含 `glm-5.2`。
- policy 包含新 channel id。

### 6.2 `/v1/models`

期望:

- 测试 key 可见 `glm-5.2`。
- 不出现 `MiniMax-M2.7`、`MiniMax-M2.5-highspeed`。
- 不影响 `deepseek-v4-*` 原有可见性。

### 6.3 `/v1/chat/completions` 非流式

请求:

```json
{
  "model": "glm-5.2",
  "messages": [{"role": "user", "content": "Say OK only."}],
  "stream": false
}
```

期望:

- HTTP 200。
- body 顶层 `model` 为 `glm-5.2` 或不泄漏上游真名。
- 内容返回正常。
- body 中不包含 `MiniMax`、`MiniMax-M2`、`abab`、`Hailuo`、`海螺`、`稀宇科技`。

### 6.4 `/v1/chat/completions` 流式

期望:

- 立即出现 `data:`。
- 最终有 `[DONE]`。
- 每个 chunk 不包含 MiniMax 相关字面量。
- 不出现 `<minimax:...>` 或私有 XML namespace。

### 6.5 `/v1/responses` 非流式与流式

请求模型同样用 `glm-5.2`。

期望:

- 非流式 HTTP 200。
- 流式最终出现 Responses API 兼容的完成事件。
- 不报 `response.completed` 缺失。
- 不泄漏上游模型名。
- 真实请求命中新 channel id,而不是绕到其他 GLM 渠道。

### 6.6 tools / tool result 回归

必须测试一轮工具调用闭环:

1. 用户问题触发 tool call。
2. 客户端回传 tool 结果。
3. 模型继续回答。

期望:

- 不报 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
- 不报 unknown role / unsupported tools。
- tool call id 格式被 NewAPI 正常保留或转换。

### 6.7 图片 / 多模态请求

MiniMax 当前文本模型不应直接承接图片场景。

期望策略二选一:

- 文本请求走新渠道 `glm-5.2 -> MiniMax`。
- 含 `image_url` / 多模态内容的请求路由到真实支持图片的模型渠道。
- 如果不能路由,必须给出清晰错误,不能把图片 JSON 直接打给 MiniMax 造成上游反序列化错误。

### 6.8 日志与错误伪装

构造一个会触发错误的请求,检查用户可见错误:

- 不出现 `MiniMax-M2.7`。
- 不出现 `api.minimaxi.com`。
- 不出现 MiniMax 私有错误码原文。
- 日志内部可保留 channel id 和 request id,但不输出 key。

## 7. 放量策略

建议三段式:

1. 创建后 `status=2`,只做 DB 静态验证。
2. 改为测试分组可用,priority/weight 仍为 `0/0`,用测试 key 验证。
3. 确认通过后再设置为目标分组和目标权重。

不建议一创建就复制 49 的 `priority=99, weight=12`,因为这会立刻让 `glm-5.2` 进入生产路由。

## 8. 回滚方案

最小回滚:

```sql
UPDATE channels
SET status = 2, weight = 0, priority = 0
WHERE id = NEW_CHANNEL_ID;
```

彻底回滚:

```sql
DELETE FROM abilities WHERE channel_id = NEW_CHANNEL_ID;
DELETE FROM channels WHERE id = NEW_CHANNEL_ID;
```

还需要把 `NEW_CHANNEL_ID` 从 `global.responses_to_chat_completions_policy.channel_ids` 移除。

如果误改了 49:

```sql
-- 用执行前备份表恢复 49,具体表名以执行时备份为准
REPLACE INTO channels
SELECT * FROM channels_bak_ch49_glm52_YYYYMMDDHHMMSS
WHERE id = 49;

DELETE FROM abilities WHERE channel_id = 49;
INSERT INTO abilities
SELECT * FROM abilities_bak_ch49_glm52_YYYYMMDDHHMMSS;
```

## 9. 上线前必须确认的问题

1. 上游真实模型是否确定为 `MiniMax-M2.7`,还是要用 `MiniMax-M2.5-highspeed`。
2. 新渠道是否先只开放测试分组。
3. 是否允许把新 channel id 加入 Responses 转 Chat policy。
4. 是否需要为 `glm-5.2` 配置单独价格/倍率,避免计费显示异常。
5. 图片请求是否要明确旁路到真实 GPT/视觉模型渠道。
6. 验证通过后是否把 priority/weight 调到和 49 一样的 `99/12`。

## 10. 执行结论

这件事不需要改代码,优先通过"复制渠道 49 + 改公开模型名 + 改 model_mapping + 改身份 prompt + 重建 abilities + 加 Responses policy"完成。

真正危险点不是 SQL 本身,而是:

- 把 49 原地改坏,影响现有 deepseek-v4-* 流量。
- 忘记 abilities,导致 `/v1/models` 看得到但路由命不中。
- 忘记 Responses policy,导致 Codex/Responses API 卡住或绕过映射。
- 沿用 DeepSeek prompt,造成 `glm-5.2` 身份冲突。
- 图片请求误打到 MiniMax 文本模型。

因此执行时必须先创建禁用的新渠道,全部验证通过后再放量。

## 11. 2026-06-21 执行记录

已执行范围:

- 已创建备份表:
  - `channels_bak_ch49_glm52_20260621142738`
  - `abilities_bak_ch49_glm52_20260621142738`
  - `options_bak_responses_policy_glm52_20260621142738`
- 已新增禁用渠道:
  - id: `149`
  - name: `glm-5.2-minimax-from-ch49`
  - status: `2`
  - priority / weight: `0 / 0`
  - models: `glm-5.2`
  - model_mapping: `{"glm-5.2":"MiniMax-M2.7"}`
  - base_url: `https://api.minimaxi.com`
  - test_model: `glm-5.2`
- 已生成 abilities:
  - channel_id: `149`
  - model: `glm-5.2`
  - count: `6`
  - priority / weight: `0 / 0`
- 已把 `149` 加入 `global.responses_to_chat_completions_policy.channel_ids`。

保护结果:

- 渠道 `49` 仍为 `status=1`,models 仍为 `deepseek-v4-flash,deepseek-v4-pro`。
- 渠道 `49` 的 priority / weight 仍为 `99 / 12`。
- 新渠道 `149` 当前禁用,不会接生产客户流量。
- 本次没有部署、没有重启、没有输出任何渠道 key。

下一步只有在用户确认后才做:

- 将 `149` 暂时开放到测试分组或启用小流量。
- 用测试 key 跑 `/v1/models`、`/v1/chat/completions`、`/v1/responses`、stream、tools、错误脱敏测试。
- 验证通过后再决定是否把 priority / weight 提升到目标值。

## 12. 2026-06-21 上线记录

最终线上状态:

- 生产镜像: `nassa11111/new-api-hide-model:hide-model-v69-glm52-minimax-sanitize-20260621`
- 容器: `newapi-prod-new-api-1`
- 健康检查: healthy, `/api/status` HTTP 200
- 渠道 `49`: 未改动,仍为 `deepseek-v4-flash,deepseek-v4-pro -> MiniMax`
- 渠道 `149`: 已启用
  - models: `glm-5.2`
  - model_mapping: `{"glm-5.2":"MiniMax-M2.7"}`
  - priority / weight: `99 / 12`
  - abilities: `glm-5.2` 共 6 条,全部 enabled
  - `ModelRatio`: `0.75`
  - `CompletionRatio`: `0.866666666667`

上线中发现并修复的问题:

- 初次启用后,`glm-5.2` 可以路由,但 chat/Responses 输出里存在 MiniMax 字段和上游模型名泄漏。
- 已先下线 `149`,再补代码层清洗:
  - chat 非流式: 模型名重写,去除 MiniMax 私有字段,剥离 `<think>` 思考段。
  - chat 流式: 按 chunk 清理模型名、私有字段和跨 chunk `<think>` 段。
  - Responses 非流式: 重写 `model` 字段并清洗上游私有内容。
  - Responses 流式: 清洗 `response.created` / `response.completed` 等事件内的模型名和文本 delta。
- 清洗补丁只涉及:
  - `relay/common/relay_info.go`
  - `relay/channel/openai/helper.go`
  - `relay/channel/openai/relay-openai.go`
  - `relay/channel/openai/relay_responses.go`

验证结果:

| 项目 | 结果 |
|---|---|
| `/v1/models` | HTTP 200,包含 `glm-5.2`,无 MiniMax 泄漏 |
| `/v1/chat/completions` 非流式 | HTTP 200,返回 `OK`,无 MiniMax 泄漏 |
| `/v1/chat/completions` 流式 | HTTP 200,有 `data:`,有 `[DONE]`,无 MiniMax 泄漏 |
| `/v1/responses` 非流式 | HTTP 200,完成态,`model=glm-5.2`,无 MiniMax 泄漏 |
| `/v1/responses` 流式 | HTTP 200,有 `response.completed`,无 MiniMax 泄漏 |
| tools 首轮 | HTTP 200,返回 `tool_calls`,无 MiniMax 泄漏 |
| tool result 续轮 | HTTP 200,可继续回答,无 MiniMax 泄漏 |
| 消费日志 | 确认命中 `channel_id=149`,模型名为 `glm-5.2` |

本次备份:

- 渠道 49 初始备份:
  - `channels_bak_ch49_glm52_20260621142738`
  - `abilities_bak_ch49_glm52_20260621142738`
  - `options_bak_responses_policy_glm52_20260621142738`
- 渠道 149 启用前备份:
  - `channels_bak_ch149_pre_enable_20260621143707`
  - `abilities_bak_ch149_pre_enable_20260621143707`
- 倍率备份:
  - `options_bak_glm52_ratio_20260621144326`
- 重新启用前备份:
  - `channels_bak_ch149_pre_reenable_20260621145930`
  - `abilities_bak_ch149_pre_reenable_20260621145930`
- 服务器源码/compose/镜像快照:
  - `/root/codex-glm52-minimax-sanitize-backup-20260621145353`

快速回滚:

```bash
cd /www/dk_project/dk_app/newapi-prod
cp /root/codex-glm52-minimax-sanitize-backup-20260621145353/docker-compose.yml.before docker-compose.yml
docker compose up -d new-api
```

仅下线新渠道:

```sql
UPDATE channels SET status = 2, priority = 0, weight = 0 WHERE id = 149;
UPDATE abilities SET enabled = 0, priority = 0, weight = 0 WHERE channel_id = 149;
```

## 13. 2026-06-21 GLM 全家桶升级到 MiniMax-M3

用户要求不只覆盖 `glm-5.2`,而是把其他 GLM 模型一起放入渠道 `149`,并统一映射到 MiniMax 官方更新的 M3。

执行前只读确认:

- MiniMax 上游 `/v1/models` 已返回 `MiniMax-M3`。
- 渠道 `149` 当时只包含 `glm-5.2`。
- 线上已有 GLM 相关公开模型包括:
  - `glm-4.5`
  - `glm-4.5-air`
  - `glm-4.6`
  - `glm-4.7`
  - `glm-5`
  - `glm-5-turbo`
  - `glm-5.1`
  - `glm-5.2`
  - `zai-org/GLM-5-FP8`
  - `zai-org/GLM-5.1-FP8`

生产保护:

- 执行前临时下线渠道 `149`。
- 已创建备份:
  - `channels_bak_ch149_pre_glm_family_m3_20260621151445`
  - `abilities_bak_ch149_pre_glm_family_m3_20260621151445`
  - `options_bak_glm_family_m3_20260621151445`
  - `/root/codex-glm-family-m3-backup-20260621151520`

代码补丁:

- 在 `relay/channel/openai/helper.go` 中新增 `MiniMax-M3` / `MiniMax M3` 显式清洗。
- 本地测试:
  - `go test ./relay/channel/openai ./relay/common`

最终线上镜像:

- `nassa11111/new-api-hide-model:hide-model-v70-glm-family-m3-20260621`
- `newapi-prod-new-api-1` healthy
- `/api/status` HTTP 200

渠道 `149` 最终配置:

- status: `1`
- priority / weight: `99 / 12`
- models:
  - `glm-4.5`
  - `glm-4.5-air`
  - `glm-4.6`
  - `glm-4.7`
  - `glm-5`
  - `glm-5-turbo`
  - `glm-5.1`
  - `glm-5.2`
  - `zai-org/GLM-5-FP8`
  - `zai-org/GLM-5.1-FP8`
- model_mapping:
  - 全部映射到 `MiniMax-M3`
- abilities:
  - 10 个模型 x 6 个分组 = 60 条
  - 全部 enabled

验证结果:

| 项目 | 结果 |
|---|---|
| `/v1/models` | 10 个 GLM 模型全部可见,无 MiniMax/M3 泄漏 |
| `glm-4.5` chat | HTTP 200,命中 `channel_id=149`,无泄漏 |
| `glm-5` chat | HTTP 200,命中 `channel_id=149`,无泄漏 |
| `glm-5.1` chat | HTTP 200,命中 `channel_id=149`,无泄漏 |
| `glm-5.2` chat | HTTP 200,命中 `channel_id=149`,无泄漏 |
| `zai-org/GLM-5-FP8` chat | HTTP 200,命中 `channel_id=149`,无泄漏 |
| `glm-5.2` chat stream | HTTP 200,有 `data:` 和 `[DONE]`,无泄漏 |
| `glm-5.1` Responses | HTTP 200,完成态,无泄漏 |
| `zai-org/GLM-5.1-FP8` Responses stream | HTTP 200,有 `response.completed`,无泄漏 |

快速回滚到 v69:

```bash
cd /www/dk_project/dk_app/newapi-prod
cp /root/codex-glm-family-m3-backup-20260621151520/docker-compose.yml.before docker-compose.yml
docker compose up -d new-api
```

仅下线 GLM 全家桶渠道:

```sql
UPDATE channels SET status = 2, priority = 0, weight = 0 WHERE id = 149;
UPDATE abilities SET enabled = 0, priority = 0, weight = 0 WHERE channel_id = 149;
```
