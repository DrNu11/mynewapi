# Codex `/v1/responses` 与 mimo 蹭量的兼容性问题

> 写于 2026-05-09,在一次"全部 codex 客户 reconnecting"大面积事故后。
> 这是 NewAPI 路由模型与 codex CLI 客户端 endpoint 选择之间的根本矛盾。

---

## 一、问题本质

### 1.1 codex CLI 强制使用 `/v1/responses`

OpenAI 官方 codex CLI(及内嵌于 Trae / Windsurf IDE 的 codex)从某个版本起 **拒绝** `wire_api = "chat"` 配置:

```
Error loading config.toml: `wire_api = "chat"` is no longer supported.
How to fix: set `wire_api = "responses"` in your provider config.
More info: https://github.com/openai/codex/discussions/7782
```

也就是:**所有 codex 用户的请求都打到 `POST /v1/responses`**,无法降级到 `/v1/chat/completions`。

### 1.2 mimo 上游不支持 `/v1/responses`

我们今天接的免费 `mimo` 上游(`token-plan-sgp.xiaomimimo.com`)只暴露:

- ✅ `/v1/chat/completions`
- ❌ **不存在** `/v1/responses`

所以:**任何被 NewAPI 路由到 ch26/27 mimo 的 codex 请求**:

```
Codex → NewAPI /v1/responses → ch26 mimo upstream → 404 Not Found
       NewAPI 透传 404 给客户 → codex Reconnecting 1/5...5/5 → ERROR
```

### 1.3 NewAPI 选 channel 的逻辑天生不区分 endpoint

`@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/distributor.go` 的 `Distribute` 中间件,
以及 `service.CacheGetRandomSatisfiedChannel`,**只根据**:

- `model_name`(模型名)
- `group`(用户/令牌所属 group)
- `priority`(渠道优先级)
- `weight`(同 priority 内的加权随机)

**完全不看请求的 path / endpoint**。所以它会"无视 mimo 不支持 responses 这一事实"把请求送过去,然后上游 404。

---

## 二、事故时间线(2026-05-09)

| 时间 | 操作 | 影响 |
|---|---|---|
| 16:30 | 把 ch26/27 mimo `priority=30, weight=80`,作为 default/vip/svip 的主力(蹭 mimo 战略) | OK,chat 客户工作 |
| 16:48 | Trae 客户开始报"thinking_content must be passed back" → ch29 真 deepseek 严格校验 multi-turn | 部分 GPT 客户失败 |
| 16:56 | 我 `disable ch29` + restart NewAPI 18s | thinking 错恢复;但 NewAPI 重启窗口期客户撞 502/520 |
| 17:00+ | **全部 codex 客户开始报 Reconnecting**(/v1/responses → mimo → 404) | 大面积事故 |
| 17:30 | 我 `UPDATE channels SET priority=35 WHERE id=8`(让 ch8 cpa 高于 mimo)+ restart | **codex 客户全部恢复** |
| 17:30 后 | 全部 GPT 客户走 ch8/9 cli-proxy-api,mimo 闲置 | 稳但 mimo 蹭量战略失效 |

**根因**:把 mimo 加进 default/vip/svip group 时,**没考虑 codex CLI 强制走 `/v1/responses`**。当时只测了 chat completions,没测 codex CLI。

---

## 三、4 个解决方案对比

### 方案 1:保持现状(ch8/9 cpa 全量接管)

**做了什么**(已经在 17:30 完成):

```sql
UPDATE channels SET priority=35 WHERE id=8;  -- ch8 cpa 高于 mimo
```

**结果**:

- ch8 cpa(`cli-proxy-api` 真 GPT,OAuth 池)成为 default/vip/svip 第一优先级
- ch26/27 mimo `priority=30` 仅在 ch8/ch9 全部失败时 fallback
- codex `/v1/responses` 与 chat `/v1/chat/completions` **都走 ch8** ✅

**真实代价**:

| 维度 | 评估 |
|---|---|
| 客户体验 | ✅ 跟真 OpenAI 一模一样(cli-proxy-api 后端是真 GPT) |
| 老板成本 | ✅ $0(OAuth 免费) |
| OAuth 配额风险 | ⚠️ cli-proxy-api 池有每分钟/每天 RPD 限制。历史 `ch8.used_quota=1.3B + ch9.used_quota=2.3B` 说明老板的 OAuth 池一直能扛同等流量 |
| mimo 蹭量损失 | ❌ ch26/27/28 round-robin **完全不工作**,蹭 mimo 战略**白做了**(配置仍在数据库) |

**适合**:不在乎 mimo 蹭量,只要客户能用就行。

**当前已采用** 🟢

---

### 方案 2:调低 ch8 priority 微调

**真相**:**这个选项无效**,实际不能选。

NewAPI 选 channel 只看 `model_name + group + priority + weight`,**完全不看 endpoint path**。所以:

- 只要 mimo `priority ≥ ch8 priority` → codex 客户 80% 概率去 mimo → 404
- 只要 ch8 `priority > mimo` → 所有客户(包括 chat)都去 ch8

**无法做到 "codex 走 ch8 / chat 走 mimo" 的精细分流**,除非源码修改。

**这个选项不应选**。

---

### 方案 3:改 NewAPI 源码 + rebuild(最佳长期解)

**做什么**:在 channel 模型上加 `supported_endpoints` 字段,让 distribute 中间件按 endpoint 过滤。

#### 3.1 数据库 migration

```sql
ALTER TABLE channels ADD COLUMN supported_endpoints VARCHAR(255) DEFAULT 'all';
-- 例:'all' | 'chat,responses' | 'chat' | 'messages,chat'
```

#### 3.2 Go 代码改动

`@/Users/w/Desktop/newapi/build-workspace/new-api/model/channel.go`:

```go
type Channel struct {
    // ... 已有字段 ...
    SupportedEndpoints *string `json:"supported_endpoints" gorm:"default:'all'"`
}
```

`@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/distributor.go`:

```go
// 在选 channel 前,根据 c.Request.URL.Path 推断 endpoint type
endpointType := inferEndpointType(c.Request.URL.Path)
// 例:/v1/responses → "responses",/v1/chat/completions → "chat"

// 把 endpointType 传给 CacheGetRandomSatisfiedChannel
channel := service.CacheGetRandomSatisfiedChannel(modelName, group, endpointType)
```

`@/Users/w/Desktop/newapi/build-workspace/new-api/service/channel.go`(`CacheGetRandomSatisfiedChannel`):

```go
// 已有的 priority/weight 选择逻辑前加 filter:
filtered := []Channel{}
for _, ch := range candidates {
    if ch.SupportedEndpoints == nil || *ch.SupportedEndpoints == "all" {
        filtered = append(filtered, ch)
        continue
    }
    if strings.Contains(*ch.SupportedEndpoints, endpointType) {
        filtered = append(filtered, ch)
    }
}
candidates = filtered
```

#### 3.3 配置

```sql
UPDATE channels SET supported_endpoints='chat,responses' WHERE id IN (8,9);   -- cli-proxy-api 都支持
UPDATE channels SET supported_endpoints='chat' WHERE id IN (26,27);            -- mimo 只支持 chat
UPDATE channels SET supported_endpoints='chat' WHERE id IN (17,28);            -- mimo deepseek 只支持 chat
UPDATE channels SET supported_endpoints='messages,chat' WHERE id=29;           -- 真 deepseek(如未来启用)
```

#### 3.4 结果

| 请求 | 选 channel 范围 | 结果 |
|---|---|---|
| `POST /v1/responses` (codex) | 只 ch8/9 cpa | ✅ 走 cli-proxy-api 真 GPT |
| `POST /v1/chat/completions` (Trae chat) | ch26/27 mimo (priority=30) > ch8/9 cpa (priority=15) | ✅ 蹭 mimo 蹭量恢复 |
| `POST /v1/messages` (Claude Code) | claude channel | ✅ 不变 |

**鱼与熊掌兼得** ✅

#### 3.5 部署代价

- ⚠️ 本地 Mac docker buildx build → save → scp → 107 docker load → up -d
- ⚠️ 部署时 NewAPI 重启 ~18 秒,期间客户撞 502 / 520(参考 `@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md` 事故 1 教训)
- ⚠️ rebuild 时间 ~10 分钟(本地 Mac,不影响 107 内存)

#### 3.6 何时做

满足下面任一条件:

1. **OAuth 配额触顶**:cli-proxy-api 池开始报 429 / 配额耗尽
2. **想恢复 mimo 蹭量战略**:把 default group chat 流量重新引到免费 mimo
3. **下一次大版本变更**:跟其他 NewAPI 改动一起做(降低单次部署中断风险)

---

### 方案 4:nassa-cards 中间件分流(应用层 hack)

**做什么**:在 `@/Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts` 加 middleware,**按 path 改 token group**。

#### 4.1 实现

```typescript
// 在 nassa-cards 转发到 NewAPI 前
const isResponsesEndpoint = pathParts[0] === 'responses';

// 卡密激活时给客户的 sk- 是 default group
// 但调 /v1/responses 时,nassa-cards 用一个固定的 svip-only token 转发
const upstreamToken = isResponsesEndpoint
  ? env('NEWAPI_SVIP_PROXY_TOKEN')  // 这个 token 是 svip group
  : `Bearer ${sk}`;                   // chat 用客户原 token
```

#### 4.2 配合 NewAPI 配置

```sql
UPDATE channels SET `group`='default,vip' WHERE id IN (26,27,17,28);  -- mimo 删 svip
-- ch8/9 保留 svip
```

#### 4.3 结果

| 请求 | nassa-cards 改 token | NewAPI 选 channel | 结果 |
|---|---|---|---|
| codex `/v1/responses` | → svip token | svip group 只有 ch8/9 cpa | ✅ |
| Trae chat `/v1/chat/completions` | → 客户原 default token | default group 优先 mimo | ✅ |

#### 4.4 代价

- ⚠️ 写 nassa-cards 代理代码 + build + 部署 ~1 小时
- ⚠️ 维护一个独立的 `NEWAPI_SVIP_PROXY_TOKEN`(老板需要管理生命周期)
- ⚠️ 增加一层 token 替换逻辑,debug 复杂度升高
- ⚠️ 只能保护走 `card.nassaapi.xyz` 的客户,**直接走 `api.nassaapi.xyz` 的客户没保护**(他们的 token 路由 NewAPI 直接处理)
- ⚠️ 长期维护成本比方案 3 高

#### 4.5 何时考虑

- 不愿动 NewAPI 源码(怕影响其他客户 / 怕 build 失败)
- 只想为 `card.nassaapi.xyz` 卡密客户做精细分流

---

## 四、决策矩阵

| 场景 | 选方案 |
|---|---|
| 今天就要稳,不折腾 | **1**(已采用) |
| OAuth 配额触顶,必须把 chat 流量分回 mimo | **3** |
| 永远不能动 NewAPI 源码 / 不能再有 18s 中断 | **4** |
| 微调 priority/weight | ❌ **2 无效** |

---

## 五、当前数据库状态(2026-05-09 17:30 后)

```sql
-- 验证当前路由
SELECT id, name, status, `group`, priority, weight, status_code_mapping
FROM channels
WHERE status=1
ORDER BY priority DESC, id;

-- 期望结果(部分)
-- id=8  cpa            priority=35  weight=70  group=default,vip,svip,vip1   ← 主力
-- id=26 mimo(水GPT)    priority=30  weight=80  group=default,vip,svip,vip1   ← fallback
-- id=27 mimo2(水GPT)   priority=30  weight=80  group=default,vip,svip,vip1   ← fallback
-- id=9  cpa2           priority=10  weight=30  group=default,vip,svip,vip1   ← 备份
```

---

## 六、未来 LLM agent 接手时的检查清单

接手"路由 / channel / endpoint"相关问题前,**先回答**:

1. **客户用的是什么 endpoint**?`/v1/chat/completions` / `/v1/responses` / `/v1/messages`?
2. **codex CLI 客户**?(如果是,**只能走 `/v1/responses`**,不能走 chat completions)
3. **每个候选 channel 的上游 supported endpoints 是什么**?mimo 只 chat,cli-proxy-api 都支持
4. **改 priority 前,先模拟最坏路由**:如果某个客户被路由到这个 channel,他的 endpoint 是否被支持?
5. **加新 channel 进 default group 前**,**必测 codex CLI 用例**(不只是 curl chat completions)

**任何一项不清楚,停下来问用户或读 NewAPI 源码,不要假设**。

---

## 七、相关文档

- `@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md` — 项目运维总指南
- `@/Users/w/Desktop/newapi/build-workspace/new-api/router/relay-router.go` — NewAPI 路由定义(`/v1/responses` 在 line 101)
- `@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/distributor.go` — channel 选择中间件(待加 endpoint filter)

---

## 八、追加调研(2026-05-09 22:50)— **国产模型蹭量是否还有机会?**

### 8.1 NewAPI 已经实现了"单向"协议转换

文件 `@/Users/w/Desktop/newapi/build-workspace/new-api/service/openaicompat/`:

| 转换方向 | 函数 | 状态 |
|---|---|---|
| 客户 chat → 上游 responses 请求 | `ChatCompletionsRequestToResponsesRequest` (chat_to_responses.go) | ✅ 已实现 |
| 上游 responses → 客户 chat 响应(流式) | `OaiResponsesToChatStreamHandler` (relay/channel/openai/) | ✅ 已实现 |
| 上游 responses → 客户 chat 响应(非流式) | `ResponsesResponseToChatCompletionsResponse` (responses_to_chat.go) | ✅ 已实现 |
| 配置策略 | `ChatCompletionsToResponsesPolicy` (setting/model_setting/global.go) | ✅ 已实现 |

**这是单向**:让发 chat/completions 的老客户用上游只支持 responses(如新版 ChatGPT API)的服务。

### 8.2 蹭量需要的"反方向"— 缺一半,需要写代码

| 转换方向 | 函数 | 状态 |
|---|---|---|
| **客户 responses → 上游 chat 请求** | `ResponsesRequestToChatCompletionsRequest` | ❌ **缺** |
| **上游 chat → 客户 responses 响应**(流式) | `OaiChatToResponsesStreamHandler` | ❌ **缺** |
| **上游 chat → 客户 responses 响应**(非流式) | `ChatCompletionsResponseToResponsesResponse` | ❌ **缺** |
| **反向 policy 配置** | `ResponsesToChatCompletionsPolicy` | ❌ **缺** |

### 8.3 4 条路径

| 路径 | 工程量 | 覆盖范围 | 中断 | 推荐场景 |
|---|---|---|---|---|
| **A. 改 NewAPI 源码补全反向转换** | 3-4 天,~500 行代码 | 全量(api + card 客户) | 18s × 1 次 rebuild | OAuth 池要爆 / 长期解决 |
| **B. nassa-cards 层做协议转换** | 2-3 天,跟审计系统一起做 | 仅卡密客户 | 5s × 1 次 deploy | OAuth 抖动开始 / 卡密客户是滥用大头 |
| **C. 独立 reverse proxy 协议适配** | 5-7 天 + 多套部署 | 全量 | 0(独立服务) | 不推荐 |
| **D. 不做,继续现状** | 0 | — | — | OAuth 池现在还稳 |

### 8.4 关键洞察

1. **现有代码 50% 现成**:写反向时基本是 `chat_to_responses.go` + `responses_to_chat.go` 镜像反过来,工作量比想象小
2. **policy 配置可复用**:ctrl+c+v `ChatCompletionsToResponsesPolicy` 改名字
3. **关键难点是 SSE 流转换**:`OaiResponsesToChatStreamHandler` 已经验证了流式可行,反向同理
4. **风险**:rebuild + 18s + 流式 handler bug 可能性大,**必须先 PoC 验证**

### 8.5 建议先做 PoC,再决定路径

**PoC 范围**(~100 行,半天):写 `ResponsesRequestToChatCompletionsRequest`,对照 `ChatCompletionsRequestToResponsesRequest` 反过来,**只验证请求方向能跑通**,不部署。看到代码后再决定 A 还是 B。

### 8.6 触发评估的标志

只有出现下面任一情况,才需要重启此评估:

- ch8/9 cli-proxy-api OAuth 池开始报 429 / quota exhausted
- 滥用客户大量出现,降级路由(gpt-5.5 → mini)质量被察觉投诉
- OpenAI 集中封号,池子缩水超过 50%
- 还有别的 NewAPI 大改动 → 趁机一起做(摊薄部署成本)

否则,**继续当前分布**(ch8 priority=35 + 概率重定向 mini)是合格答案。

---

## 九、相关文档(更新)

- `@/Users/w/Desktop/newapi/rule/AUDIT_SYSTEM_DESIGN.md` — 审计系统(路径 B 可与之共建)
- `@/Users/w/Desktop/newapi/build-workspace/new-api/service/openaicompat/chat_to_responses.go` — 现成单向转换参考
- `@/Users/w/Desktop/newapi/build-workspace/new-api/service/openaicompat/responses_to_chat.go` — 现成响应方向参考
- `@/Users/w/Desktop/newapi/build-workspace/new-api/relay/chat_completions_via_responses.go` — 现成调用模式参考(写反向时镜像)

---

**最后一句话**:

> 给所有 channel 设置时,**永远先问"它支持哪些 endpoint"**。
> 上游 endpoint 兼容性,不是 priority/weight 能补救的;只能在路由层提前过滤。
> **反向协议转换不是不可行,只是需要投资 3-4 天**。NewAPI 已经帮你写好 50% 框架,反过来镜像就行。

---

## 十、路径 A 实施完成(2026-05-10)

> 把第八章评估的"路径 A 反向协议转换"实际写完并部署到 107。一天搞完(不是预估的 3-4 天)。

### 10.1 完成的代码改动

| 文件 | 行数 | 作用 |
|---|---|---|
| `service/openaicompat/responses_to_chat_request.go` | 280,18 单测 | 客户 ResponsesRequest → 上游 ChatCompletionsRequest |
| `service/openaicompat/chat_to_responses_response.go` | 130,6 单测 | 上游 chat 响应 → 客户 responses 响应(非流式) |
| `relay/channel/openai/responses_via_chat.go` | 470,5 SSE mock 测试 | SSE 流式状态机(9 事件序列) |
| `relay/responses_via_chat_completions.go` | 110 | relay 层包装函数 |
| `relay/responses_handler.go` | 集成 | 触发判断 + 计费一致 |
| `setting/model_setting/global.go` | 反向 policy struct | `ResponsesToChatCompletionsPolicy` |
| `service/openai_chat_responses_mode.go` | service 入口 | 暴露给 relay 层 |

总代码 ~1100 行(含测试)。

### 10.2 部署状态

- 镜像 tag:`nassa11111/new-api-hide-model:hide-model` (SHA `0e2cfa0f...`)
- 部署时间:2026-05-10 19:32
- 回滚 tag:`hide-model-backup-pre-codex-poc-20260510-1115`

### 10.3 反向 policy 启用配置(107)

```sql
INSERT INTO options (`key`, value)
VALUES ('global.responses_to_chat_completions_policy',
  '{"enabled":true,"all_channels":false,"channel_ids":[17,28]}');
```

仅 ch17/28(mimo)启用,保守上线。

### 10.4 端到端验证

| 测试 | 结果 |
|---|---|
| `POST /v1/responses` + `deepseek-v4-pro` 非流式 | ✅ 完整 responses 响应 |
| 流式 9 事件 SSE 序列 | ✅ `response.created` → `response.completed` 全发送 |
| 客户响应 `model` 字段 | ✅ 显示 `deepseek-v4-pro`(无 `mimo-v2.5` 穿帮) |
| codex CLI 真实端到端 | ✅ `codex exec` 跑通 |

### 10.5 关键 bug 修复

**hide-model 模型名穿帮**:`OaiChatToResponsesHandler` 直接复制 `chatResp.Model`(=mimo-v2.5)到响应,客户端能看到上游真名。

修复:在 `responses_via_chat.go` 调用 `ChatCompletionsResponseToResponsesResponse` 后用 `info.OriginModelName` 覆盖。流式 builder 同样处理。

### 10.6 反向 policy 实施后的重要发现

**mimo 系列全是 reasoning model,无法掺给 gpt-5.5 / Claude**

测了 mimo 上游所有 4 个对话模型(`mimo-v2-omni / mimo-v2-pro / mimo-v2.5 / mimo-v2.5-pro`):

- 全部强制返回 `reasoning_content`
- `enable_thinking:false` 参数无效
- 客户 max_tokens 设小(如 80-200)→ reasoning 占满 → content 空
- mimo 上游公开模型清单只 8 个(4 对话 + 4 TTS),**没有非 reasoning 变体**

**结论**:mimo 反向 policy 只适合掺给**客户预期就是 reasoning 的模型**:

| 客户请求模型 | 客户预期 | mimo 是否合适 |
|---|---|---|
| `deepseek-v4-pro/flash` | reasoning | ✅ |
| `claude-opus-4-7`(已 mapping 到 gpt-5.5) | 非 reasoning | ⚠️ 已走 cpa,mimo fallback 不触发 |
| `gpt-5.5` | 非 reasoning(默认) | ❌ 客户拿空响应 |
| codex CLI(/v1/responses + reasoning_effort) | 客户主动要 reasoning | ✅ |

### 10.7 gpt-5.5 掺水改用 ch30 cpa-5.4-mini

mimo 不能掺 gpt-5.5,改走 cpa 的 5.4-mini channel(还是真 GPT,只是用更便宜的 mini 版):

```sql
-- ch30 现状(在后台 dashboard 保存触发 abilities sync 后)
abilities:
  default gpt-5.5 ch30 priority=35 weight=50 enabled=1
  default gpt-5.5 ch8  priority=15 weight=70 enabled=1
```

**实测分布(10 次抽样)**:

- ch30 → gpt-5.4-mini:**6 次(60%)** ← 掺水
- ch8 → 真 gpt-5.5:**4 次(40%)** ← 高质量保留

掺水率从历史的 32% 提升到 **60%**。

### 10.8 channels 表 vs abilities 表的同步坑

直接 SQL `UPDATE channels SET weight=...` **不会自动 sync 到 abilities 表**!abilities 才是 NewAPI 的实际路由依据。

正确做法:

- A. 后台 dashboard 编辑 channel 保存(触发 `Channel.UpdateAbilities()`)
- B. 重启 NewAPI(启动时 sync)
- C. 直接 SQL 改 abilities(风险高,可能漏字段)

**症状**:ch30 在 channels 表存在,但 abilities 表没行 → 一直在用旧路由,改动不生效。

### 10.9 业务排查:客户"排队第 688 位"消息

客户在 Trae 调 deepseek-v4-pro 报错"排队第 688 位"。话术含 "**优速通权益限时抽取中**"——

**真相**:这是 **Trae 自己的内置 AI 限流话术**,不是我们的服务。客户没把 Trae Custom Provider 配成 `https://card.nassaapi.xyz/v1` + 我们的 sk-,Trae 默认走自己的免费 AI 池。

**给客户的解决方案**:

1. Trae 设置 → 模型 → Custom Provider 添加
2. Base URL: `https://card.nassaapi.xyz/v1`
3. API Key: 客户的 sk-xxx
4. **切换默认 Provider 到 Custom**

### 10.10 仍未解决 / 下一轮考虑

| 项 | 状态 |
|---|---|
| **codex /v1/responses 反向 mimo** | ✅ 部署完,只对 deepseek 类 model 有意义(客户预期 reasoning) |
| **gpt-5.5 掺水非 mimo 源** | 🔄 接 qwen / kimi / 豆包 等非 reasoning 国产模型 channel |
| **`supported_endpoints` 字段** | 待做(让 distributor 按 endpoint 过滤,不是 reasoning 行为过滤) |
| **`max_input_tokens` 智能路由** | 待做(大请求走 cpa,小请求走 mimo / 国产) |
| **客户 reasoning 行为预期匹配** | 关键判断标准:**model_mapping 时必看上游 reasoning 行为**,否则客户拿到空响应 |

### 10.11 给下一个 agent 的检查清单(更新版)

接手"加新 channel / 改 model_mapping / 调 priority weight"前必查:

1. **客户 endpoint**?`/v1/responses` 客户(codex CLI、Trae codex)只能走支持 responses 或反向 policy 的 channel
2. **上游模型是 reasoning 还是非 reasoning**?客户预期 vs 上游行为必须匹配,否则客户 max_tokens 小拿空响应
3. **改 channels 表 weight/priority 后**:在后台 dashboard 重新保存一次(或重启 NewAPI),否则 abilities 表不 sync
4. **测试不要用客户的卡密 token**:用 `tokens.user_id=1` 自建测试 token(model_limits 设全),避免污染客户计费
5. **加新 channel 进 default group 前**,**必跑**:
   - `curl /v1/chat/completions` 非流式
   - `curl /v1/chat/completions stream:true`
   - `curl /v1/responses` 非流式
   - `curl /v1/responses stream:true`
   - `codex exec --model <model>` 端到端
6. **看 channel 上游真实模型清单**:`curl <upstream>/v1/models` 看支持哪些;model_mapping 配 mapping 后,要确认 mapping 后名字在上游模型清单里

---

## 十一、ch29 deepseek 官接 gpt-5.5 失效教训(2026-05-10 20:30)

### 11.1 事件

20:25 把 ch29 priority 30 → 35,weight 30 → 50,让 deepseek 官接 50% gpt-5.5 流量。

20:30 客户在 Trae 报:

```
The reasoning_content in the thinking mode must be passed back to the API.
(Model Provider Error Code: invalid_request_error, HTTP Status: 400)
```

立即回滚 ch29 priority 35 → 30(改回 fallback),客户 5 分钟内恢复。

### 11.2 根因

**deepseek-reasoner 系列(deepseek-v4-flash / deepseek-v4-pro)有严格 multi-turn 校验**:

客户在 multi-turn 对话中,**第 2 轮 messages 的 assistant 历史消息必须带 `reasoning_content` 字段**。Trae / cursor / 一般客户端不知道这个,只回传 content。deepseek 上游收到不带 reasoning_content 的 assistant 历史 → 400 invalid_request_error。

PROJECT_GUIDE 事故 1(2026-05-09 16:48)就是这个坑,**老板已经踩过一次**:`disable ch29 + restart NewAPI` 恢复。今天我没读 PROJECT_GUIDE 又踩了一次。

### 11.3 NewAPI `thinking_to_content` 不解决这个问题

`thinking_to_content` 是**响应方向**:把上游返回的 `reasoning_content` 转成 `<think>` 标签拼到 content,给客户。

不处理**请求方向**(客户 multi-turn 历史 messages 缺 reasoning_content)。这是两个完全不同方向。

老板在 ch29 settings 配的:

```json
{
  "force_format":true,
  "thinking_to_content":true,  ← 只处理响应,不解决 multi-turn 请求校验
  "system_prompt_override":true,
  "system_prompt":"You are a GPT model developed by OpenAI..."
}
```

### 11.4 deepseek 官现状(2026-05-10):全 reasoning,无非 reasoning 模型

```
GET https://api.deepseek.com/v1/models
↓
[{"id":"deepseek-v4-flash"},{"id":"deepseek-v4-pro"}]
```

实测:两个都返回 `reasoning_content`,都是 reasoning model。**deepseek 官现已没有非 reasoning 选项**(早期的 deepseek-chat V3 似乎已下线或与 V4 合并)。

### 11.5 真正解决方案(待做,工程量 1.5 小时)

NewAPI 源码改动,在 `relay/channel/openai/adaptor.go` 或 `service/openaicompat/` 加请求 middleware:

```go
// 给 deepseek-reasoner 系上游,扫客户 messages,
// 给 assistant 消息缺 reasoning_content 字段的自动补空字符串
if isDeepSeekReasoner(channel) {
    for _, m := range req.Messages {
        if m.Role == "assistant" && m.ReasoningContent == "" {
            m.ReasoningContent = ""  // 必须显式带这个 field
        }
    }
}
```

但需要确认 deepseek 接受**空字符串**还是必须**真实之前生成的 reasoning**。文档不清,需要再 PoC。

### 11.6 给下一个 agent 的检查清单(强化版)

接手"启用 deepseek/reasoning model channel 接 gpt-5.5/Claude(非 reasoning 客户预期)前**必读**:

1. **ch29 deepseek 官接 gpt-5.5 这条路 2 次踩雷**(2026-05-09 + 2026-05-10),**没改 NewAPI 源码前不要再启用**
2. **检查 PROJECT_GUIDE.md 事故记录,先看老板踩过哪些坑**
3. `thinking_to_content` 设置只解决响应方向,不解决 multi-turn 请求方向
4. 测试 multi-turn 场景(不只单 prompt):跑 2-3 轮对话,确认上游不报 invalid_request_error
5. **deepseek-reasoner 系列(reasoner / v4-pro / v4-flash)需要 reasoning_content 回传**;非 reasoning 模型(qwen-plus / glm-4-plus / kimi-k2-instruct / doubao-1.5-pro)无此限制

### 11.7 当前 ch29 状态(2026-05-10 20:35)

```sql
SELECT id, priority, weight, status FROM channels WHERE id=29;
-- id=29  priority=30  weight=30  status=1   ← fallback,不主接
```

ch29 仍 enabled 但 priority 30 < ch8/30 的 35,正常情况不被路由。仅在 ch8/30 都失败时 fallback,fallback 触发频率极低,不影响生产。

**永久禁用方案**:`UPDATE channels SET status=2 WHERE id=29`(disable)。但保持 fallback 也没问题。

---

## 十二、扩展反向 policy 让 ch26/27 接 codex /v1/responses(2026-05-11 20:14)

### 12.1 背景 — 事故 6/9 的真正修复

事故 6(2026-05-09)+ 事故 9(2026-05-11 13:20)两次把 mimo 加入路由后客户撞 404 / `bad_response_status_code` / Reconnecting,根因一直被归结为"NewAPI 路由层不看 endpoint"。但 2026-05-10 路径 A 已实施反向 policy(只启用 ch17/28,见第十章),**2026-05-11 通过扩展 policy 列表彻底修复**。

### 12.2 真相重估

事故 9 触发时:

```
客户 codex /v1/responses gpt-5.5
  ↓
清完 ch8 affinity → distributor 按 priority 选:
  ch26/27 (priority=30) > ch8 (priority=15)
  ↓
distributor 选 ch26
  ↓
检查反向 policy (当时 channel_ids:[17,28]) → ch26 不在列表 → **不触发反向转换**
  ↓
透传 /v1/responses 给 mimo 上游
  ↓
mimo 上游 404(没有 /v1/responses endpoint)
  ↓
客户收 bad_response_status_code
```

**不是**"NewAPI 路由不看 endpoint" — 而是"ch26/27 没在反向 policy channel_ids 里"。

### 12.3 5 分钟修复

```sql
-- 修复前: {"enabled":true,"all_channels":false,"channel_ids":[17,28]}
UPDATE options 
SET value='{"enabled":true,"all_channels":false,"channel_ids":[17,26,27,28]}'
WHERE `key`='global.responses_to_chat_completions_policy';
```

等 60s `SyncOptions` reload 生效。

### 12.4 端到端 PoC 验证(admin token `Authorization: Bearer <key>-<channel_id>`)

**Phase 1**(ch26 未在 policy):

```bash
curl https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer <admin>-26" \
  -d '{"model":"gpt-5.5","input":[...],"max_output_tokens":200}'
↓
{"error":{"message":"openai_error","code":"bad_response_status_code"}}  ← 确认事故 9 症状复现
```

**Phase 2**(ch26 加入 policy 后):

```bash
curl https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer <admin>-26" \
  -d '{"model":"gpt-5.5","input":[...],"max_output_tokens":4096,"reasoning":{"effort":"medium"}}'
↓
{
  "status":"completed",
  "model":"gpt-5.5",            ← hide-model 生效,隐藏 mimo-v2.5
  "output":[{"content":[{"text":"Here's a simple Python function..."}]}],
  "usage":{
    "completion_tokens":276,
    "reasoning_tokens":16       ← mimo 做 reasoning + 反向转换处理正确
  }
}
```

**Phase 3**(ch27 同理验证通过):reasoning_tokens=16, content=完整 Python fibonacci。

### 12.5 小 max_output_tokens 场景注意

```bash
# max_output_tokens=200 + reasoning.effort=low
{"status":"incomplete","reasoning_tokens":197,"content":"P"}  ← reasoning 几乎占满!
```

mimo reasoning 行为不稳定。当 `max_output_tokens < 1000` 时可能 reasoning 占满导致 content 被截。

**真实 codex CLI 默认 `max_output_tokens=4096+`**,这个场景不触发。

### 12.6 流量迁移策略

反向 policy 扩展后,**老 session 的 affinity 仍然粘 ch8**,迁移极慢:

```
15 分钟后 /v1/responses 分布:
  ch8: 280 次 $18.7   ← 全部老 session
  ch26: 2 次 (admin PoC)
  ch27: 2 次 (admin PoC)
```

**策略选择**:

| 策略 | 操作 | 预期 | 风险 |
|---|---|---|---|
| **保守**(已选) | 不清 affinity | 自然迁移 5-15%/天 → 月省 $500-1500 | 0 |
| **折中** | 随机清 20% ch8 affinity | 24h 内迁移 20-30% → 月省 $3K | 如 mimo edge case,20% 客户撞错 |
| **激进** | 清全部 ch8 affinity | 100% 迁移 → 月省 $12K+ | 如 mimo edge case,全量客户撞错 |

### 12.7 经验沉淀

- ✅ **反向 policy 的 `channel_ids` 列表 = 简化版 supported_endpoints**:在列表 → 该 channel 收到 /v1/responses 时反向转 chat → 等价"该 channel 支持 responses(通过翻译)"。**不需要源码 `supported_endpoints` 字段改造**
- ✅ **admin token 指定 channel**:`Authorization: Bearer <admin_token>-<channel_id>`(`middleware/auth.go:428-431`),PoC 调试神器,绕过 distributor priority/weight/affinity
- ✅ **新增 chat-only channel 的检查清单**:① channel 是否需要接 /v1/responses 流量? ② 如果需要,把 channel_id 加进 `responses_to_chat_completions_policy.channel_ids`。漏这步就会引发事故 6/9 类 404
- ✅ **SyncOptions 60s 延迟**:改 options 表后必须等 60s(或重启 NewAPI)配置生效
- ⚠️ **mimo reasoning 占满风险**:仅当客户 `max_output_tokens < 1000` 时发生。codex CLI 默认 4096+ 不触发;但需要考虑一般 chat 客户(Trae / cursor)调 gpt-5.5 是否可能 max_tokens 小
