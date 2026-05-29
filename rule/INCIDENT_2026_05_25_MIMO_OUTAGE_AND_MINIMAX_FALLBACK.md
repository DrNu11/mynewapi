# 2026-05-25 mimo 全挂 + MiniMax `/v1/responses` Fallback v9/v10 修复报告

**日期:** 2026-05-25
**严重程度:** 🔴 高(Codex 客户全部 503,持续约 30 分钟)
**操作者:** Cascade
**状态:** ✅ 已修复(v10 镜像在 207 生产运行,3 个 MiniMax channel 备胎就位)

---

## 一、事件时间线

| 时间(UTC+8) | 事件 |
|---|---|
| 11:30 ~ | 客户报错截图:`503 auth_unavailable: no auth available (providers=mimo3, mimo, https://***.top, mimo2, 公益mimo)` |
| 11:33 | 排查 cli-proxy-api,5 个 mimo provider 全 503 |
| 11:36 | 用户决策:跳过修 mimo,直接走 ch61(MiniMax)备胎 |
| 11:38 | 发现客户走 `/v1/responses`(Codex 端点),ch61 base=`api.minimaxi.com` 不支持该端点 |
| 11:42 | 在源码里发现 `responsesViaChatCompletions` 函数已定义(v7 加的)**但全代码无人调用** — 半成品 |
| 11:45 | v9 改造:加 `ChannelSetting.ResponsesViaChat` flag + 在 `ResponsesHelper` 加 fallback caller |
| 11:50 | v9 build + 部署到 207 + 改 ch61 setting 加 `responses_via_chat=true` |
| 11:52 | 真实流量测试:ch61 接到 /v1/responses,触发 fallback,但 MiniMax 返 `(2013) invalid message role: system` |
| 11:58 | 根因:转换出的 chat-completions 含 2 个 system message(NewAPI 注入 + 客户 instructions),MiniMax 只接受 1 个 |
| 12:00 | v10 改造:在 `openai/adaptor.go` 的 `ConvertOpenAIRequest` 末尾加 `normalizeSystemForMinimax`,合并多 system 为一个 |
| 12:05 | v10 build + retag `hide-model-v8` → v10 + force-recreate NewAPI 容器 |
| 12:10 | 验证:90 秒内 ch61 接 10 笔 /v1/responses,**全部 200,零 2013 错误** |
| 12:15 | 创建 ch62/ch63 用 ch49/ch56 的 minimax key,3 通道轮询备胎 |

---

## 二、根因分析

### 2.1 mimo OAuth 凭证 / apikey 状态(主线问题,**未在本次修复范围**)

错误信息显示 5 个 provider 全部返 `auth_unavailable`:

```
providers=mimo3, mimo, https://***.top, mimo2, 公益mimo
model=mimo-v2.5-pro
```

mimo 在 `/root/cliproxyapi/config.yaml` 的 `openai-compatibility:` 段配置了 5 个 provider,共 40+ 个 token-plan apikey。错误成因尚未确定,可能性:

- 小米批量风控(同时封号)
- apikey 集体失效
- cli-proxy-api 内部状态丢失
- xiaomimimo.com 上游限流

**解决路径(后续):** 重新申请 mimo 账号 → 拿新 apikey → 替换 config.yaml → 重启 cli-proxy-api

### 2.2 `responsesViaChatCompletions` 半成品(本次修复的 v9)

```
v7 镜像里:
  ✅ relay/responses_via_chat_completions.go 函数已定义
  ❌ 全代码搜索:零 caller!没人调用!
  → /v1/responses 仍然直发上游 → minimax 不支持 /v1/responses 返 404
```

**v9 修复:** 在 `relay/responses_handler.go:ResponsesHelper()` 起点(adaptor.Init 之后,常规处理之前)加分支:

```go
if info.ChannelSetting.ResponsesViaChat &&
   info.ApiType == appconstant.APITypeOpenAI &&
   info.RelayMode != relayconstant.RelayModeResponsesCompact {
    usage, newAPIErr := responsesViaChatCompletions(c, info, adaptor, request)
    // ... 错误处理 + 计费 ...
    return nil
}
```

加 `ChannelSetting.ResponsesViaChat` flag(在 `dto/channel_settings.go`)作为开关,channel.setting 设 `responses_via_chat=true` 时启用。

### 2.3 多 system message 触发 MiniMax (2013) 错误(本次修复的 v10)

`responsesViaChatCompletions` 转换出来的 chat-completions request 结构:

```
client: /v1/responses
  ├─ instructions: "客户原 prompt"           ← 转成 system message
  └─ input: "用户消息"                        ← 转成 user message

NewAPI 处理(经过 ConvertOpenAIRequest):
  messages[0] = system: "ch61 注入的 V5 OVERRIDE"  ← system_prompt_override=true
  messages[1] = system: "客户原 instructions"
  messages[2] = user:   "用户消息"

MiniMax-M2.7:
  ❌ 拒收 — 它最多接受 1 个 system,且必须在最前
  返 400: "invalid params, chat content has invalid message role: system (2013)"
```

**v10 修复:** 在 `relay/channel/openai/adaptor.go:ConvertOpenAIRequest()` 末尾加:

```go
if strings.Contains(info.ChannelBaseUrl, "minimaxi.com") {
    request.Messages = normalizeSystemForMinimax(request.Messages)
}
```

`normalizeSystemForMinimax`(在 `helper.go`)逻辑:

1. 把所有 `role=system` 消息抽出
2. 用 `\n\n` 拼接 content(支持 string / multipart / MediaContent 三种格式)
3. 合并后的 1 个 system 放在 messages[0]
4. 其他 user/assistant 顺序保持

---

## 三、修改文件清单

### 3.1 NewAPI fork 源码(已 sync 到 207 / docker build 进 v10 镜像)

| 文件 | 修改 | 行数 | 用途 |
|------|------|------|------|
| `dto/channel_settings.go` | +5 | 4-13 | 新增 `ResponsesViaChat bool` 字段 |
| `relay/responses_handler.go` | +20 | 68-94 | 在 `ResponsesHelper` 加 v9 fallback 分支 |
| `relay/channel/openai/helper.go` | +85 | 66-150 | 新增 `normalizeSystemForMinimax` + `extractTextFromContent` |
| `relay/channel/openai/adaptor.go` | +6 | 349-354 | 在 `ConvertOpenAIRequest` 末尾加 normalize 调用 |

### 3.2 数据库改动

| 渠道 ID | 改动 | 状态 |
|---|---|---|
| ch61 | setting 加 `responses_via_chat=true` + priority 80 + 修复 param_override(从 ch56 借) + 9 个 gpt-5.x model_mapping | ✅ 已生效 |
| ch62 (新) | 克隆 ch61,key 借自 ch49 (`sk-cp-9sDncde20T...`),priority 80 | ✅ 已创建 |
| ch63 (新) | 克隆 ch61,key 借自 ch56 (`sk-cp-qhY9TV8qK6...`),priority 80 | ✅ 已创建 |
| abilities | ch61/ch62/ch63 各 45 条(9 models × 5 groups) | ✅ 全部就绪 |

### 3.3 Docker 镜像

| Tag | ID | 状态 |
|---|---|---|
| `nassa11111/new-api-hide-model:hide-model-v10` | `e57aea668324` | 新建 |
| `nassa11111/new-api-hide-model:hide-model-v8` | `e57aea668324` | **生产 tag,指向 v10** |
| `nassa11111/new-api-hide-model:hide-model-v8-backup-pre-v9-20260525_0639` | `cb0cc195b4ca` | 旧 v8 备份 |
| `nassa11111/new-api-hide-model:hide-model-v8-backup-v9-1779684728` | `6622e1e2217d` | v9 中间态备份 |

---

## 四、最终拓扑(GPT-5 流量分发)

```
客户 /v1/responses or /v1/chat/completions
    ↓
NewAPI v10
    ├─ priority=100 (最高):  ch27 mimo2(GPT)         → cli-proxy-api 8317 → mimo OAuth ❌ 全挂中
    ├─ priority=98:           ch58 cpa-free            → cli-proxy-api 8317 → mimo OAuth ❌ 全挂中
    ├─ priority=80:           ch61 minimax→gpt        → api.minimaxi.com (deepseek2 key) ✅
    ├─ priority=80:           ch62 minimax→gpt2       → api.minimaxi.com (deepseek1 key) ✅
    └─ priority=80:           ch63 minimax→gpt3       → api.minimaxi.com (deepseek3 key) ✅
                                                          ↑ 3 个账号轮询
```

**当前实际行为:** ch27/58 (mimo) 全挂,流量全 fallback 到 ch61/62/63 (3 个 minimax 账号轮询)。

---

## 五、验证

### 5.1 自动 admin test(部分通过)

| Model | Endpoint | 结果 |
|------|----------|------|
| gpt-5 | /v1/chat/completions(隐式) | ✅ success time=1.91s |
| gpt-5.5 | /v1/chat/completions | ✅ success time=2.13s |
| gpt-5.4-mini | /v1/chat/completions | ✅ success time=0.95s |
| gpt-5-codex | /v1/responses | ❌ 404(**admin test 路径绕过 ResponsesHelper**,不代表真实路径不通) |

### 5.2 真实流量(决定性验证)

90 秒窗口:

```
✅ ch61 接到 10 笔 POST /v1/responses(model=gpt-5.5)
✅ 全部 200(转换 + normalize + 上游 MiniMax 返回成功)
✅ 0 个 2013 错误
✅ 0 个 channel #61 错误
```

---

## 六、待办 / 风险

### 6.1 mimo apikey 恢复(最高优先级)

mimo 是主战场(便宜 + 用户最多),长期靠 minimax 备胎不可持续:

- minimax 是订阅 codingplan,每月配额有限,3 个账号 ÷ 高峰流量很快耗尽
- 必须找出 mimo provider 全失效原因,恢复 apikey

### 6.2 admin test 路径不走 ResponsesHelper(技术债)

`controller/channel-test.go:testChannel()` 自建路径绕过 `ResponsesHelper`,导致 admin test 对 codex 类模型仍然 404。这只影响 admin 测试,**不影响真实客户流量**,但后续应补对齐路径。

### 6.3 minimax 配额监控

3 个 minimax 账号轮询时,任一账号配额耗尽会导致单 channel 失败 → 路由会自动跳到下一个。但建议加监控:

- 每天检查 3 个账号余额
- 接近耗尽时提前 disable + 申请新账号

---

## 七、回滚方法(若 v10 出问题)

```bash
ssh root@207.244.243.12
docker tag nassa11111/new-api-hide-model:hide-model-v8-backup-pre-v9-20260525_0639 \
           nassa11111/new-api-hide-model:hide-model-v8
cd /www/dk_project/dk_app/newapi-prod
docker compose up -d --force-recreate new-api
# 数据库回滚:删除 ch62/ch63
docker exec newapi-prod-mysql-1 mysql -uroot -p$PASS -D new-api -e "
DELETE FROM abilities WHERE channel_id IN (62, 63);
DELETE FROM channels WHERE id IN (62, 63);
"
```

---

## 八、相关文档

- `MINIMAX_2013_SYSTEM_ROLE_FIX.md` — 5/17 多 system 错误的根因分析(本次 v10 修复的依据)
- `INCIDENT_2026_05_23_MINIMAX_LEAK_FIX_REPORT.md` — 5/23 v7/v8 品牌剥离修复
- `UPSTREAM_DISGUISE_MASTER_DOC.md` — 上游伪装总则(需更新加入 ch62/63 + v9/v10 章节)
- `CH61_MINIMAX_TO_GPT_DRAFT.md` — ch61 改造 SQL 草稿(本次部署依据)

---

**报告生成时间:** 2026-05-25 12:20 UTC+8
**当前生产状态:** ✅ NewAPI v10 在 207 跑,3 个 minimax 通道接管 GPT-5 流量
