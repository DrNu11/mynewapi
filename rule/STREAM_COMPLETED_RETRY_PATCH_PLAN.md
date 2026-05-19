# NewAPI Patch:`/v1/responses` Stream 完整性检测 + Retry

> 写于 2026-05-17 22:55。针对客户上报的 "stream disconnected before completion: stream closed before response.completed" 错误,设计 NewAPI 源码修改方案。
> 实施前需老板确认,不直接动代码。

---

## 一、问题回顾

### 1.1 客户错误现象

```
codex CLI(连 api.nassaapi.xyz)报错:
  stream disconnected before completion:
  stream closed before response.completed

供应商 /v1/responses?stream=true 不完整,关闭流前没有发 response.completed
```

### 1.2 链路根因

```
codex CLI ──/v1/responses?stream=true──> NewAPI
                                          │
                                          │ channel_affinity 锁 ch8 (rule="codex cli trace")
                                          ▼
                                       cli-proxy-api 207:8317
                                          │
                                          ▼
                                       ChatGPT 后端 (codex 账号,prompt 229K, reasoning_effort:high)
                                          │
                                          │ ❌ 流式中途关闭,没发 response.completed
                                          │    可能因:① prompt 接近 256K 限制
                                          │           ② reasoning 时间长被后端 timeout
                                          │           ③ 账号 quota 中途被刷新
                                          ▼
cli-proxy-api 透传:    HTTP 200 + EOF      ← 没检测到流不完整
NewAPI:                stream_status:eof, status:"ok"  ← 误判
                       completionTokens = CountTextToken(tempStr) ← 用文本估算
客户 codex CLI:         流关闭无 response.completed → 报错
```

### 1.3 实证数据(刚抓到)

```
22:52:11  ch8 gpt-5.5
  prompt_tokens:      229673   ← 接近 GPT-5 上限 256K
  completion_tokens:  49       ← 极小,流过早断开
  stream_status:      {"end_reason":"eof", "status":"ok"}
  reasoning_effort:   "high"
  channel_affinity:   rule="codex cli trace"
  request_path:       /v1/responses
```

---

## 二、NewAPI 现有代码

### 2.1 位置

```
relay/channel/openai/relay_responses.go     OaiResponsesStreamHandler  ← 主 patch 点
relay/channel/openai/chat_via_responses.go  反向转换 (ch26/27 mimo 等用)  ← 也要 patch
```

### 2.2 现有逻辑(`relay_responses.go:71-141`)

```go
func OaiResponsesStreamHandler(c *gin.Context, info, resp) (*dto.Usage, *types.NewAPIError) {
    var usage = &dto.Usage{}
    var responseTextBuilder strings.Builder

    helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
        var streamResponse dto.ResponsesStreamResponse
        if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
            sr.Error(err)
            return
        }
        sendResponsesStreamData(c, streamResponse, data)
        switch streamResponse.Type {
        case "response.completed":
            // 设置 usage(input/output/total/cached)
            ...
        case "response.output_text.delta":
            responseTextBuilder.WriteString(streamResponse.Delta)
        ...
        }
    })

    // 流结束后,如果 usage 没赋值,用文本估算
    if usage.CompletionTokens == 0 {
        tempStr := responseTextBuilder.String()
        if len(tempStr) > 0 {
            completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
            usage.CompletionTokens = completionTokens   // ← 这里是 "假成功" 的根源
        }
    }
    return usage, nil   // ← 永远不返回错误,即使流不完整
}
```

**问题:** 函数无论上游流是否正常完成都返回 `nil` 错误,NewAPI 上层(`controller`)无法判断流是否完整,自然不会触发 retry。

---

## 三、Patch 设计

### 3.1 改动点 #1:`relay_responses.go`

```go
func OaiResponsesStreamHandler(c *gin.Context, info, resp) (*dto.Usage, *types.NewAPIError) {
    var usage = &dto.Usage{}
    var responseTextBuilder strings.Builder
    var sawCompleted bool                                       // ★ 新增
    var sawTerminalError bool                                   // ★ 新增

    helper.StreamScannerHandler(c, resp, info, func(data, sr) {
        var streamResponse dto.ResponsesStreamResponse
        if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
            sr.Error(err)
            return
        }
        sendResponsesStreamData(c, streamResponse, data)
        switch streamResponse.Type {
        case "response.completed":
            sawCompleted = true                                 // ★ 新增
            // 设置 usage ...
        case "response.failed", "response.incomplete", "error": // ★ 新增
            sawTerminalError = true
            // 设置 usage 但标记错误
        ...
        }
    })

    // 流结束后判断完整性
    if !sawCompleted && !sawTerminalError {                     // ★ 新增
        // 没看到 completed/failed/error 任何终结事件 → 上游异常断流
        // 返回 retryable error,让 NewAPI 切下一个账号/channel
        logger.LogError(c, "stream ended without response.completed event")
        return usage, types.NewError(
            fmt.Errorf("stream ended before response.completed (upstream truncation)"),
            types.ErrorCodeStreamIncomplete,                    // ★ 新增 error code
        )
    }

    // 文本估算 fallback 仅在 sawCompleted=true 时进行
    if sawCompleted && usage.CompletionTokens == 0 {
        tempStr := responseTextBuilder.String()
        if len(tempStr) > 0 {
            usage.CompletionTokens = service.CountTextToken(tempStr, info.UpstreamModelName)
        }
    }
    return usage, nil
}
```

### 3.2 改动点 #2:`types/error.go`

新增错误 code:

```go
const (
    ...
    ErrorCodeStreamIncomplete ErrorCode = "stream_incomplete"  // 流未完成,可重试
)
```

### 3.3 改动点 #3:NewAPI retry 逻辑加 `ErrorCodeStreamIncomplete` 到可重试列表

查找 retry 触发条件,加入新 code:

```go
// 大概在 controller/relay-text.go 或 relay/relay-text-helper.go
func shouldRetry(err *types.NewAPIError) bool {
    if err == nil { return false }
    switch err.Code {
    case types.ErrorCodeBadResponse,
         types.ErrorCodeRateLimit,
         types.ErrorCodeServerError,
         types.ErrorCodeStreamIncomplete:                       // ★ 新增
        return true
    }
    return false
}
```

### 3.4 改动点 #4:`chat_via_responses.go` 反向转换路径

ch26/27 mimo (在 reverse_policy 里) 走 chat_completions → responses 转换,流结束逻辑也要加同样检测。

```go
// 反向转换里也加 sawCompleted 检测
// 文件:relay/channel/openai/chat_via_responses.go
```

---

## 四、风险评估

### 4.1 误伤正常请求

**风险:** 真正"上游正常但客户端早断"的场景被误判为 incomplete,触发不必要 retry。

**评估:** 低。`response.completed` 是 OpenAI Responses 协议的强制终结事件,正常流必然有。如果没有,确实是异常。

**缓解:** 加 `info.ResponseStartedAt` 检测,如果流刚开始就 EOF → 直接 retry;如果流跑了 >5 秒还没 completed → 也 retry,但加日志便于审计。

### 4.2 retry 触发循环

**风险:** 多个 channel 都返回 incomplete → 死循环 retry。

**评估:** 低。NewAPI 现有 `request-retry: 3` 限制,最多重试 3 次。

**缓解:** 不变更现有 retry 上限。

### 4.3 客户感知延迟

**风险:** retry 增加客户响应时间。

**评估:** 中。但客户原本就报错,即使 retry 增加 5-10s 延迟,也比直接失败好。

**缓解:** 可加 stream-aware retry (流刚开始未发 SSE 数据就断 → 静默 retry,客户无感)。

### 4.4 ch8 仍然是同一上游

**风险:** retry 还是落到 ch8(只有它在 codex cli trace affinity rule 里),换 codex 账号但 ChatGPT 后端可能继续因 prompt 大而断流。

**评估:** 中。但 cli-proxy-api 内有 240+ codex 账号轮询,换账号后**有概率**遇到 prompt size 限制不同的账号。

**缓解(长期):** 加跨 channel retry 选项,失败 N 次后切到 ch26/27 mimo(虽然 mimo 处理 codex /v1/responses 历史有问题,但作为兜底比直接 fail 好)。

---

## 五、实施步骤

### 5.1 代码改动

```
[1] 编辑 /Users/w/Desktop/newapi/new-api-fork/types/error.go
    新增 ErrorCodeStreamIncomplete

[2] 编辑 /Users/w/Desktop/newapi/new-api-fork/relay/channel/openai/relay_responses.go
    OaiResponsesStreamHandler:
      - 加 sawCompleted / sawTerminalError 标志
      - case "response.completed" 设 sawCompleted=true
      - case "response.failed/incomplete/error" 设 sawTerminalError=true
      - 流结束后:!sawCompleted && !sawTerminalError → 返 ErrorCodeStreamIncomplete

[3] 编辑 /Users/w/Desktop/newapi/new-api-fork/relay/channel/openai/chat_via_responses.go
    反向转换路径同样加 sawCompleted 检测

[4] 找 retry 判定函数(grep "shouldRetry"),加 ErrorCodeStreamIncomplete 到 retryable 列表
```

### 5.2 本地编译验证

```bash
cd /Users/w/Desktop/newapi/new-api-fork
go build -o /tmp/new-api ./
# 期望:编译成功
```

### 5.3 单元测试

```bash
go test ./relay/channel/openai/...
# 期望:所有现有测试通过
# 新增测试用例:
#   - 流式包含 response.completed → 返 nil error
#   - 流式 EOF 但无 response.completed → 返 ErrorCodeStreamIncomplete
#   - 流式包含 response.failed → 返 nil error(已经是终结事件)
```

### 5.4 Build hide-model-v6 镜像

```bash
# 参考 deploy-107-v5.sh
cd /Users/w/Desktop/newapi/new-api-fork
docker buildx build --platform linux/amd64 \
  -t nassa11111/new-api-hide-model:hide-model-v6 \
  -t nassa11111/new-api-hide-model:hide-model \
  --push .

# 备份当前 v5
docker tag nassa11111/new-api-hide-model:hide-model-v5 \
           nassa11111/new-api-hide-model:hide-model-backup-v5stable-20260517
```

### 5.5 部署到 107(灰度)

```bash
ssh root@107.174.155.17 '
  cd /www/dk_project/dk_app/newapi/newapi_SAz7
  docker pull nassa11111/new-api-hide-model:hide-model
  docker compose up -d --force-recreate new-api
'
sleep 20
ssh root@107.174.155.17 'docker logs newapi_saz7-new-api-1 --since 30s 2>&1 | tail -20'
# 期望:启动 OK,无 panic
```

### 5.6 验证

```bash
# 测试 1:正常流式 codex CLI 调用
curl https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer sk-..." \
  -d '{"model":"gpt-5.5","input":"hi","stream":true}'
# 期望:正常流式响应,有 response.completed

# 测试 2:复现 stream incomplete(模拟需要更精细)
# 用 mitmproxy 拦截 cli-proxy-api 响应,删除 response.completed 事件,发回 NewAPI
# 期望:NewAPI 检测到 incomplete → retry → 第二次成功

# 测试 3:监控
# 30 分钟内观察 ch8 logs,end_reason=eof 的请求应该减少
ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql ... -e "
  SELECT FROM_UNIXTIME(created_at+28800) t, channel_id, completion_tokens,
         JSON_EXTRACT(other,\"\$.stream_status\") status
  FROM logs WHERE channel_id=8 AND created_at > UNIX_TIMESTAMP()-1800
  ORDER BY created_at DESC LIMIT 20"'
```

### 5.7 回滚

```bash
# 立刻切回 v5stable
ssh root@107.174.155.17 '
  docker tag nassa11111/new-api-hide-model:hide-model-backup-v5stable-20260517 \
             nassa11111/new-api-hide-model:hide-model
  cd /www/dk_project/dk_app/newapi/newapi_SAz7
  docker compose up -d --force-recreate new-api
'
```

---

## 六、预期效果

```
[BEFORE]
  客户 codex CLI 长 session → ch8 上游断流 → NewAPI 标 status:ok
  → 客户报错 "stream closed before response.completed"
  → 客户必须 /new 才能继续

[AFTER]
  客户 codex CLI 长 session → ch8 上游断流 → NewAPI 检测 incomplete
  → 自动 retry 下一个 codex 账号(cli-proxy-api 池子里换一个)
  → 第二次成功:HTTP 200 + 完整 response.completed
  → 客户无感,继续聊
```

**预期受益客户数:** 所有用 codex CLI / Cherry Studio responses API / Windsurf codex 模式的客户,尤其是长 session(prompt > 100K)用户。

---

## 七、时间预算

```
代码改动 + 单元测试:     30 min
本地编译 + 自测:         15 min
Build hide-model-v6:     10 min(网络 push)
部署 107 + 启动验证:     10 min
30 min 生产观察期:       30 min
─────────────────────────
总计:                    ~95 min(1.5 小时)
```

---

## 八、相关 issue / 文档

- **GitHub Issue #3055** (cli-proxy-api):Codex executor returns retryable 408 when stream closes before response.completed — 上游侧的修复方向(等他们修)
- **本仓库:** `INCIDENT_2026_05_17_MINIMAX_2013.md` — 同日的另一个事故(minimax 2013)
- **本仓库:** `MIMO_CHANNEL_CHECKLIST.md` — ch8 channel_affinity rule 历史
- **memory:** NewAPI 路由机制 — channel_affinity / reverse_policy / priority

---

## 九、签批

| 项 | 值 |
|---|---|
| 设计人 | Cascade |
| 决策人 | 老板 |
| 计划日期 | 2026-05-17 22:55 |
| 实施时间 | 待确认 |
| 验证完成 | 待 30 min 观察期结束 |
