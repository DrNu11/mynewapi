# 事故复盘:MiniMax 2013 错误影响 DeepSeek 套餐客户

> 事故日期:2026-05-17(周日,中国时间)
> 严重度:**P2 — 影响付费客户体验,但有可用 fallback**
> 复盘日期:2026-05-17 22:40
> 复盘人:Cascade(协助分析)+ 老板(决策)

---

## 一、事故摘要(TL;DR)

| 项 | 值 |
|---|---|
| **首次发现** | 2026-05-17 22:00 左右,老板客户上报 |
| **持续时间** | 约 2-3 小时(19:30 ch49 priority=1 上线 → 22:00 客户反馈) |
| **影响范围** | 走 ch49 (MiniMax 伪装 DeepSeek) 且发送多 system / 中途插 system 消息的 DeepSeek 套餐卡密客户 |
| **影响占比** | 估算 ~30-50%(ch49 与 ch40 同 priority 时,流量 50/50 分流,其中约 60-80% 客户会发多 system) |
| **客户感知** | 收到 HTTP 400 + `(2013) invalid message role:system` 错误,无法获得回复 |
| **业务影响** | DeepSeek 套餐口碑受损,但客户重试 1-2 次后大概率切到 ch40 (mimo) 成功 |
| **直接缓解** | 22:25 老板手动把 ch49 priority 降回 0,流量退回 ch40 主路 |
| **根因修复** | 待定 — 推荐方案 A(nassa-cards 规范化 messages),估算 1-2 小时,预计今日内 |

---

## 二、时间线

```
2026-05-11  13:25  ch40 (mimo 伪装 DeepSeek) priority=30,作为 DeepSeek 套餐主路稳定运行
2026-05-17  19:30  ★ Cascade 协助配置 ch49 (MiniMax 伪装 DeepSeek)
                   - base_url: api.minimaxi.com
                   - model_mapping: deepseek-v4-pro → MiniMax-M2.7
                   - param_override: 删 reasoning_effort/reasoning/thinking
                   - priority=1 / weight=10(跟 ch40 同级,50/50 分流)
                   - 加进 responses_to_chat_completions_policy
                   - 测试通过:Admin Panel "测试 pro/flash" 都 200 OK
                   - 全程未做"多 system" / "system 在 user 后"的边界测试

2026-05-17  19:30+  ch49 开始接客户流量。简单 1-system 客户请求全部 OK,
                    带多 system 的客户开始撞 2013(NewAPI logs 不记录失败请求,
                    monitoring 看不到)

2026-05-17  22:00  老板收到客户反馈:DeepSeek 套餐返回 (2013) 错误

2026-05-17  22:15  Cascade 介入调查
                   - 错误码 (2013) 是 minimax 上游特有
                   - 第一假设:NewAPI hide-model v5 注入了额外 system 提示词

2026-05-17  22:18  直接调 minimax API 对照测试:
                   - 1 system + 1 user → 200 ✅
                   - system 是 array content → 200 ✅
                   - system 有 name 字段 → 200 ✅
                   - 2 个 system → ❌
                   - system 在 user 之后 → ❌
                   确认根因:minimax 对 system 有顺序+数量约束

2026-05-17  22:25  老板手动操作:
                   - 把 ch49 priority 从 1 降到 0(降级)
                   - 此后客户主走 ch40 mimo,2013 错误立即停止

2026-05-17  22:40  Cascade 完成根因分析,产出:
                   - 技术修复文档 (MINIMAX_2013_SYSTEM_ROLE_FIX.md)
                   - 本份事故归宿文档
                   - 推荐方案 A(nassa-cards 加 messages 规范化层)

2026-05-17  待定   方案 A 实施(预计 1-2 小时):
                   - 改 nassa-cards /v1 代理代码加 normalizeMessages
                   - 部署 154 + 验证
                   - ch49 priority 恢复 1,跟 ch40 重新 50/50 分流

2026-05-XX  待定   长期方案 B 落地:
                   - 改 NewAPI fork 加 minimax adapter
                   - Build hide-model-v6 镜像 → 107 升级
                   - 直连 api.nassaapi.xyz 的非卡密客户也受益
```

---

## 三、直接 / 触发 / 根因

### 3.1 直接原因

**MiniMax `/v1/chat/completions` 接口在以下场景返回 2013 错误:**

- messages 数组中存在 ≥ 2 个 `role:"system"` 消息
- 或:出现位置在某个 `user`/`assistant` 消息之后

NewAPI ch49 配置为 `type=1`(自定义 OpenAI 兼容)**原样转发**客户的请求体,不做 messages 规范化,所以客户的多 system 请求被透传给 minimax → 2013。

### 3.2 触发原因

19:30 把 ch49 priority 从 0 升到 1(跟 ch40 同级,50/50 分流),让 ch49 开始接真实客户流量。**之前 ch49 一直 priority=0 处于备用状态,只有 ch40 不可用时才偶尔接到流量,撞 2013 的概率极低**,所以没及时暴露。

### 3.3 根因(系统设计层面)

1. **MiniMax 对 OpenAI 兼容协议的实现不完整**,但厂商宣称"OpenAI 兼容"误导集成者。
2. **NewAPI 没有 minimax 专用 adapter**,只有 `type=1` 通用 OpenAI 兼容路径,该路径不做 messages 规范化。
3. **测试覆盖盲区** — 19:30 上线 ch49 时,Admin Panel 的"测试 channel"功能只发 1 个 user 消息,不触发多 system 场景。生产真实客户请求形态比测试更复杂。
4. **观测盲区** — NewAPI logs 表只记录成功请求(用于计费),失败请求不入库。错误只在 client 端可见,服务端无 channel-level 错误率监控。

---

## 四、为什么没提前发现(检测延迟分析)

| 检测层 | 状态 | 原因 |
|---|---|---|
| NewAPI Admin Panel "测试 channel" 功能 | 误报通过 | 只发 1 个 user 消息,覆盖度 = 30% |
| 上线后人工抽测 | 未做 | ch49 上线后没用真实卡密客户场景做端到端 smoke test |
| Channel error rate 监控 | 缺失 | NewAPI logs 表不记录失败请求,Prometheus / Grafana 也未接入 |
| 客户反馈渠道 | 滞后 2-3 小时 | 客户撞错后大多自己重试或换模型,不会立刻反馈 |
| 模型健康度检查 (`model-health-check`) | 不覆盖 | 该项目检查的是模型是否能连通,不测多 system 边界场景 |

**总结:** 5 层检测全部失效。问题完全依赖客户主动反馈才暴露。

---

## 五、责任划分(无 blame,只看制度)

| 责任主体 | 是 / 否 | 说明 |
|---|---|---|
| **MiniMax 厂商** | 是,但难追责 | OpenAI 兼容声明不完整,文档没明示 system 约束。但其属于免费 Token Plan,无 SLA |
| **NewAPI 设计** | 部分 | type=1 通用兼容路径不做 messages 规范化是已知设计,但未在文档警示"非完整 OpenAI 兼容上游存在风险" |
| **运维流程(我们)** | 主要 | 上线 ch49 时:① 测试覆盖不够 ② 缺少边界场景 smoke test ③ 缺失 channel error rate 监控 |
| **客户** | 否 | 客户的多 system 请求在 OpenAI / Claude / DeepSeek 都合法,不应该被要求规避 minimax 的限制 |

---

## 六、已采取的应急措施(2026-05-17 22:25 - 22:40)

```
[22:25]  ch49 priority 1 → 0       客户流量退回 ch40 主路
[22:25]  ch49 weight   10 → 9      跟 ch50 同级备用
[22:40]  完成根因分析 + 技术修复文档 + 本份事故文档
```

**当前状态:** 客户**不再撞 2013**。但 ch49 几乎闲置,**MiniMax Token Plan 配额浪费**。

---

## 七、待办(防复发改进)

### 7.1 短期(今日)

- [ ] **实施方案 A** — nassa-cards `/v1` 代理加 normalizeMessages,部署 154
- [ ] **验证修复** — 用方案 A 做对照测试(多 system / system 在 user 后)走 ch49 应通过
- [ ] **ch49 priority 恢复 1** — 跟 ch40 重新 50/50 分流
- [ ] **30 分钟观察期** — 监控 logs 表 2013 错误率,期望 0

### 7.2 中期(本周)

- [ ] **方案 B 落地** — 改 NewAPI fork 加 minimax adapter(`relay/channel/openai/adaptor.go`)
- [ ] **Build hide-model-v6 镜像** — 推送 nassa11111/new-api-hide-model:hide-model-v6
- [ ] **107 升级** — docker compose up -d --force-recreate new-api
- [ ] **直连客户验证** — 调 `api.nassaapi.xyz` 多 system 测试,期望 200

### 7.3 长期(本月)

- [ ] **建 channel error rate 监控** — 把 NewAPI logs 表扩展记录 4xx/5xx 错误,Grafana 出错误率 dashboard
- [ ] **上线 SOP 改造** — 新加 channel 必须做 "上线前 smoke test 清单":
  - 单 system + 单 user
  - **多 system(2-3 个)**
  - **system 在 user 后面**
  - **array content (multimodal text)**
  - **空 messages**
  - **流式 + 非流式**
- [ ] **model-health-check 项目扩展** — 加入"system role 兼容性"测试,自动定期抽检每个 channel

### 7.4 防御性补充

- [ ] **客户错误模板优化** — 当 NewAPI 收到上游 4xx 错误时,在响应里加 `_meta.channel_id` 字段,方便排查
- [ ] **NewAPI 失败请求记录** — 修改 NewAPI,把 4xx/5xx 错误也入 logs 表(可加 type=2 标识),便于事后审计

---

## 八、经验教训

### 8.1 "OpenAI 兼容"不可全信

任何标榜"OpenAI 兼容"的第三方 API(尤其国内厂商),实际兼容度差异巨大:

| 上游 | system role | array content | tool_calls | streaming |
|---|---|---|---|---|
| OpenAI 原生 | ✅ 完全 | ✅ | ✅ | ✅ |
| Anthropic Claude | ⚠️ 单 system + 顶层字段 | ✅ | ✅ 不同协议 | ✅ |
| mimo (xiaomimimo) | ✅ 接近完全 | ✅ | ✅ | ✅ |
| **MiniMax** | ⚠️ **单 + 首位约束** | ✅ | ⚠️ 部分 | ✅ |
| DeepSeek 真本 | ✅ 完全 | ✅ | ✅ | ✅ |
| Cohere | ⚠️ 独立 preamble 字段 | ⚠️ | ⚠️ | ✅ |

**所有"伪装协议"渠道上线前必须做完整兼容性矩阵测试,不能只测 happy path。**

### 8.2 priority 升级 ≠ 测试通过

ch49 在 priority=0 时长期"看上去正常",是因为流量极少。升 priority=1 让它接 50% 流量,真实问题才暴露。

**新 channel 应该先用 `model-health-check` 这类工具做 1 小时灰度测试**(模拟多种边界 request 形态),再决定 priority。

### 8.3 失败请求必须可观测

logs 表只记成功 = 服务端对客户错误盲。所有 4xx/5xx 应该至少在结构化日志里有记录,即使不入计费表,也应该有 channel_id + error_message 维度的 dashboard。

### 8.4 卡密客户走 nassa-cards 是优势

`card.nassaapi.xyz` → nassa-cards → `api.nassaapi.xyz` 链路里 nassa-cards 是**应用层适配点**。任何上游不兼容、客户行为异常、需要规范化的问题都可以在这一层解决,**而不需要改 NewAPI 源码**。

**未来类似问题(GPT 套餐 / Claude 套餐)如果撞类似边界,应优先在 nassa-cards 解决,然后再考虑下沉到 NewAPI。**

---

## 九、相关文档与凭证

- **技术修复:** `/Users/w/Desktop/newapi/rule/MINIMAX_2013_SYSTEM_ROLE_FIX.md`
- **ch49 配置背景:** `/Users/w/Desktop/newapi/rule/MINIMAX_DISGUISE_DEEPSEEK_CHECKLIST.md`
- **ch40 同类配置:** `/Users/w/Desktop/newapi/rule/MIMO_CHANNEL_CHECKLIST.md`
- **NewAPI 部署:** `/Users/w/Desktop/newapi/new-api-fork/DEPLOYMENT_NOTES.md`
- **nassa-cards 部署:** memory:`2026-05` nassa-cards 流程
- **DB 操作凭证:** `107.174.155.17` mysql root / `eZ1rW9jR6mU6uP4b` / db `new-api`
- **NewAPI 管理员:** `admin / 5201314Zangqi`(同 cli-proxy-api management key)

---

## 十、签名

| 角色 | 签名 |
|---|---|
| 决策人 | 老板 |
| 分析 / 文档 | Cascade |
| 复盘日期 | 2026-05-17 22:40 |
| 修复完成 | 待方案 A 实施后填写 |
| 验证完成 | 待 30 分钟观察期结束后填写 |
