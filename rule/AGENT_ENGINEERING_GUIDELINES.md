# NewAPI Agent 工程行为准则

> 来源参考: Matt Pocock `mattpocock/skills` 的工程技能思想。  
> 本文不是照搬 skill，而是按 NewAPI 的生产风险改写后的本项目准则。

---

## 0. 核心原则

NewAPI 是生产 API 中转系统，不是玩具项目。Agent 的第一职责不是“快点改完”，而是：

1. 先建立反馈环
2. 再最小化复现
3. 再假设和验证
4. 最后修复、回归测试、记录

没有反馈环的修复，就是猜。

---

## 1. Debug 必须先有反馈环

排查 bug 前，必须先构造一个可重复的 pass/fail 信号。优先级如下：

1. 单测 / 集成测试
2. 207/本地真实 `curl` 脚本
3. 客户真实请求 payload 的 replay
4. 临时 harness，只跑出问题的函数或协议转换路径
5. 浏览器 / CLI 端到端复现
6. 必要时加临时生产 instrumentation

NewAPI 事故里最常见的错，是只看代码就“觉得应该好了”。以后禁止这么收尾。

对于客户报障，必须确认反馈环复现的是客户描述的同一个症状：

- 客户说“Claude 不回复”，要测 `/v1/messages` stream 是否真的没有 `content_block_delta`
- 客户说“中断”，要查 `stop_reason=max_tokens` / `finish_reason=length`
- 客户说“模型露馅”，要测身份问答、诱导问法、流式和非流式

---

## 2. 修复前先列 3 个假设

复杂故障不要一上来改代码。先写 3-5 个可证伪假设，并给每个假设配一个验证方式。

格式：

```text
假设 A: 如果 X 是根因，那么运行 Y 请求会出现 Z。
假设 B: 如果不是 X，而是 M，那么改 N 不会影响结果。
```

NewAPI 生产故障常见假设池：

- channel 配置缓存未刷新
- model_mapping 只改了 `model` 字段，没改正文
- 流式与非流式走不同转换路径
- Claude/Gemini/OpenAI 三种 relay format 路径不一致
- affinity 让老 session 仍命中旧 channel
- upstream 行为变了，但本地只测了 happy path

---

## 3. Instrumentation 要精准，可清理

如果需要加日志：

- 每条临时日志必须有唯一前缀，例如 `[DEBUG-ch39-v41]`
- 只打在能区分假设的边界上
- 禁止“log everything 然后 grep”
- 结束前必须 `rg "[DEBUG-ch39-v41]"` 确认清理干净

生产 instrumentation 要优先记录结构化事实：

- channel id
- origin model
- upstream model
- relay format
- finish reason / stop reason
- 是否 stream
- 是否 IsModelMapped

不要记录完整客户 prompt / key。

---

## 4. 测试优先测公共接口，不测内部幻想

测试要穿过真实接口，尽量不要只测内部函数形状。

NewAPI 优先测试顺序：

1. 真实 HTTP 端到端：`/v1/chat/completions`、`/v1/responses`、`/v1/messages`
2. 协议转换集成测试：OpenAI -> Claude / Claude -> OpenAI
3. 关键 helper 单测：只在行为能稳定定义时写，例如品牌 scrub

坏测试示例：

- 只断言某个 regex 函数被调用
- 只测结构体字段，没有测实际 SSE 输出
- 只测非流式，然后宣称 Claude Code 修好了

好测试示例：

- 输入 `claude-opus-4-7` + stream，断言出现 `content_block_delta`
- 输入诱导问题 `Are you GPT-5.5 by OpenAI?`，断言无 `GPT/OpenAI` 泄漏
- 输入 `claude-sonnet-4-6`，断言自报 Sonnet 而不是 Opus

---

## 5. TDD 只做垂直切片

不要一次性写一堆想象中的测试，再批量实现。

正确方式：

```text
RED: 写一个失败测试/失败 curl
GREEN: 做最小修复
VERIFY: 跑原始端到端场景
REPEAT
```

NewAPI 特别适合“tracer bullet”：

- 一个模型
- 一个 endpoint
- 一个请求 payload
- 一个明确输出断言

例如 ch39 修复顺序应该是：

1. `claude-opus-4-7` + 非流式 `你好`
2. `claude-opus-4-7` + 流式 `你好`
3. `claude-opus-4-7` + 身份诱导
4. `claude-sonnet-4-6` + 身份诱导
5. grep 泄漏词

每一步都能单独验证。

---

## 6. 不熟的代码先 zoom out

碰到不熟的模块，不要直接钻进一行代码。先画调用地图：

- 入口 endpoint 是哪个
- RelayFormat 是 OpenAI / Claude / Gemini 哪个
- 请求转换在哪里
- 响应转换在哪里
- 流式和非流式是否同路
- 哪些配置参与：channel setting、model_mapping、param_override、affinity

NewAPI 常见误判都来自没 zoom out：

- 以为 chat completions 修了，Claude `/v1/messages` 也修了
- 以为非流式修了，stream 也修了
- 以为改了 DB，容器 cache 立刻生效
- 以为 priority 能切流量，忘了 affinity

---

## 7. 文档语言要形成项目词汇表

每次发现一个反复出现的概念，必须用同一个词，不要每次换说法。

NewAPI 当前固定词汇：

- **真实上游**: 客户看不见的 provider/model
- **客户侧模型**: 客户请求和 UI 里看到的 model
- **伪装渠道**: `model_mapping` 生效、需要隐藏真实上游的 channel
- **身份自报**: 模型回答“我是谁/谁开发我”
- **泄漏向量**: 可能暴露真实上游的字段/正文/错误/header
- **反馈环**: 能稳定证明 bug 存在或消失的测试/脚本
- **端到端验证**: 从 207 主机打生产公网或等价完整链路

如果未来引入新词，优先写进 `PROJECT_GUIDE.md` 或专题文档，不要只留在聊天记录里。

---

## 8. ADR 只记录重决策

不是所有事情都需要 ADR。满足三条才写：

1. 以后改回来成本高
2. 没上下文会觉得奇怪
3. 当时有真实 trade-off

NewAPI 适合写 ADR 的例子：

- 为什么 ch39 真实走 GPT 但客户侧伪装 Claude
- 为什么 MiniMax 才走 narrative buffer，非 MiniMax 直接输出 chunk
- 为什么 207 可以 build，但 107 永远不能 build

不适合 ADR 的例子：

- 某次临时 prompt 文案
- 某个一次性测试 key
- 某个偶发 429

---

## 9. Issue/计划要按垂直切片拆

如果要把计划拆成待办，不要按“改后端/改前端/写测试/写文档”这种横切拆。

按可验证能力拆：

```text
错误拆法:
1. 改 helper.go
2. 改 relay-openai.go
3. 写测试
4. 写文档

正确拆法:
1. Claude Opus 流式短回复有 content_block_delta
2. Claude Opus 身份诱导不泄漏 GPT/OpenAI
3. Claude Sonnet 身份自报按 Sonnet 显示
4. 错误响应不泄漏真实上游
```

每个切片都必须能独立演示或验证。

---

## 10. Done 的定义

NewAPI 任务完成前，至少满足：

- [ ] 原始客户场景已端到端复现过
- [ ] 修复后同场景端到端通过
- [ ] 覆盖流式和非流式，除非明确无关
- [ ] 覆盖客户侧模型和真实上游不一致的场景
- [ ] 没有泄漏词残留，必要时 grep
- [ ] 生产健康检查通过
- [ ] 回滚 tag / 回滚命令清楚
- [ ] `rule/` 里记录事故或更新项目指南

如果做不到其中某项，最终回复必须明确说“没做到”和原因。
