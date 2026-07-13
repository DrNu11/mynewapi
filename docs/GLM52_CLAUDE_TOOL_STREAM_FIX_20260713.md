# GLM-5.2 Claude Code 工具流修复方案（2026-07-13）

## 1. 目标与边界

修复 `glm-5.2` 经 NewAPI 的 `/v1/messages` 流式协议进入 Claude Code 时，工具调用参数丢失为 `{}`，导致以下错误的问题：

```text
InputValidationError: The required parameter `command` is missing
```

本次修复只修改 NewAPI 应用源码中的 Claude SSE 工具流合成逻辑及其测试。

明确不做：

- 不修改数据库或执行数据库迁移；
- 不修改 channel、模型映射、密钥或额度；
- 不直接修改运行中的生产容器；
- 未完成 13000 测试前，不替换生产镜像；
- 不修改 nassa-cards。

## 2. 准确基线

当前生产容器：

```text
container: newapi-prod-new-api-1
image_ref: nassa11111/new-api-hide-model:hide-model-v76-wallet-link-20260710
image_id: sha256:f37be507dcc1f496f757be53e5e56cea5eb6517b0e32cc8247516ba964af2f7e
```

原始构建记录确认该镜像由以下干净工作树构建：

```text
source_commit: 90124a35ef566c912eeec193bbb144b3f7f40940
source_branch_at_build: fix/wallet-link-v72
```

本次修复分支：

```text
codex/fix-glm52-claude-tool-deltas
```

该分支直接从 `90124a35` 创建，不从镜像标签或 v71/v72 名称推断版本。

## 3. 已复现故障

真实 Claude Code：`2.1.177`

真实请求条件：

- Base URL：`https://api.nassaapi.xyz`
- Model：`glm-5.2`
- Endpoint：`POST /v1/messages`
- Stream：`true`
- 工具：Claude Code 的 Bash/Read/Write

真实结果：

```json
{
  "type": "tool_use",
  "name": "Bash",
  "input": {}
}
```

随后 Claude Code 报错：

```text
The required parameter `command` is missing
```

测试在第一步 `Bash: pwd` 失败，因此按要求停止，未执行后续 Write/Read。

## 4. 对照实验

同一把 key、同一模型、同一 Bash schema：

- 非流式 `/v1/messages` 连续 3 次均得到 `{"command":"pwd"}`；
- 原始 SSE 连续 3 次都把完整参数放在 `content_block_start.content_block.input`；
- 原始 SSE 没有发送 `content_block_delta` / `input_json_delta`；
- Claude Code 最终把工具参数组装为 `{}`。

这说明上游模型已经生成正确参数，丢失发生在 NewAPI 的 Claude SSE 合成层。

## 5. 根因

提交 `334f5c0f` 新增 `synthesizeClaudeToolStream()`，通过非流式上游响应获取并校验完整 JSON，再合成客户端需要的流式响应。

当前实现直接在 `content_block_start` 中写入完整参数：

```go
ContentBlock: &dto.ClaudeMediaMessage{
    Type:  "tool_use",
    Id:    call.id,
    Name:  call.name,
    Input: call.input,
}
```

并且现有测试明确断言响应中不包含 `input_json_delta`。Claude Code 的工具参数流累积依赖 `content_block_delta.delta.partial_json`，因此最终得到空对象。

## 6. 正确事件序列

每个工具调用必须按以下顺序输出：

1. `content_block_start`
   - `type: tool_use`
   - 保留 `id` 和 `name`
   - `input: {}`
2. `content_block_delta`
   - `delta.type: input_json_delta`
   - `delta.partial_json` 为已经校验过的完整 JSON 字符串
3. `content_block_stop`

示例：

```text
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"Bash","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"pwd\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}
```

## 7. 实现方案

修改范围：

- `new-api-fork/relay/channel/openai/mapped_tool_stream.go`
- `new-api-fork/relay/channel/openai/mapped_tool_stream_test.go`

实现要求：

- `content_block_start.input` 固定为空对象；
- 使用现有 `validatedToolCall.arguments` 作为 `partial_json`；
- 不重新拼接或转义 JSON，避免引号和反斜杠二次损坏；
- 多工具调用保持各自 index、id、name 与参数一一对应；
- OpenAI 格式的工具流行为保持不变；
- 非工具文本响应行为保持不变；
- 模型名隐藏、`<think>` 清理和必填字段校验保持不变。

## 8. 测试门槛

### 8.1 回归测试

先修改测试使其针对当前实现失败，再修改生产代码使其通过。至少覆盖：

- Bash 的 `command` 出现在 `input_json_delta.partial_json`；
- `content_block_start.input` 为 `{}`；
- JSON 中的双引号与反斜杠保持原样；
- Write 的 `file_path` 和 `content` 完整；
- 多工具调用 index 不串位；
- 不泄露上游模型名与 `<think>`。

### 8.2 13000 测试环境

构建独立测试镜像，只替换/启动 13000 测试容器，不修改生产容器。

### 8.3 真实 Claude Code 测试

按顺序真实执行，任一步失败立即停止：

1. Bash：`pwd`
2. Bash：`mkdir -p /tmp/glm_test`
3. Write：写入 `/tmp/glm_test/test.json`
4. Read：读取该文件
5. Bash：`python3 -m json.tool /tmp/glm_test/test.json`
6. `node_repl`：`const x=1+2; x`

其中 `node_repl` 是独立 MCP 工具；若 MCP 本身未连接，必须明确区分为客户端 MCP 故障，不能归因于 GLM/NewAPI 工具参数流。

通过标准：

- Bash/Read/Write 参数均不是空对象；
- 文件真实存在且内容一致；
- JSON 校验成功；
- 不出现 `Invalid tool parameters`、`command is missing`、`Error writing file`、JSON parse error 或空流。

## 9. 生产发布门槛与回滚

在 13000 全部通过之前禁止部署生产。

若后续获得生产部署授权：

- 记录当前生产 image reference 和 image ID；
- 只替换 NewAPI 应用镜像；
- 保留原 env、network、volumes、ports 和 restart policy；
- 不重启 MySQL；
- 不修改数据库、channel 或模型映射；
- 任一真实工具测试失败，立即恢复当前镜像
  `sha256:f37be507dcc1f496f757be53e5e56cea5eb6517b0e32cc8247516ba964af2f7e`。

