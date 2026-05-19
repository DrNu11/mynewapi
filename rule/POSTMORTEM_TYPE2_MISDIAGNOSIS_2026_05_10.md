# 事故复盘 — `logs.type=2` 误读导致误判为 100% 故障

> 2026-05-10 11:30-11:45(UTC+8)
> 现场:客户报 `system_cpu_overloaded 503`,我误判为 "cpa OAuth 池 100% 失败"
> 实际:偶发单点错误(近 1 小时错误率 0.2%),服务完全正常
> 代价:NewAPI 10s 无必要中断 + 5 分钟 mimo 路由错误(客户可能感觉模型变弱)

---

## 一、事件时间线

| 时间 | 我做的事 | 我当时的理解 | 实际真相 |
|---|---|---|---|
| 11:30 | 客户报 503 `system_cpu_overloaded` | "上游 CPU 100% 过载了" | 偶发错误,不代表持续故障 |
| 11:31 | SQL 查 `type=2 channel_id IN (8,30)` | "近 5 分钟 47 次错误,严重!" | type=2 是 consume log(正常消费),**不是 error** |
| 11:32 | 深入查 "近 30 分钟 ch8: 203 failed / 0 success" | "cpa OAuth 池 100% 挂了" | 所有 203 条都是**成功的 consume 日志**,不是失败 |
| 11:33 | 决定止血:提升 ch26/27 priority 30 → 36 | "让 chat/completions 客户绕开挂掉的 cpa" | 没挂,绕开反而让客户用上更弱的 mimo |
| 11:34 | 重启 NewAPI 容器让 priority 生效(10s 中断) | "必要的紧急止血" | **完全不必要的中断** |
| 11:37 | 验证发现 ch26/27 `stream_status: "ok"` | "mimo 也在成功,在吸收 cpa 流量" | 这是正常情况,不是 "mimo 救火" 的证据 |
| 11:40 | 用 `content 非空` 重新查真实错误 | "...等等,443 请求只有 1 个真错误?" | **真相**:整体错误率 0.2%,偶发 |
| 11:42 | 回退 ch26/27 priority → 30 | 承认误判 | 服务恢复原有拓扑 |

**关键时间点**:11:31 就下了错误结论,直到 11:40 才自我修正。**9 分钟的错误判断窗口里已经做了 2 个破坏性操作**(priority 改动 + 容器重启)。

---

## 二、根因分析(3 层)

### 2.1 技术层:对 NewAPI `logs.type` 字段含义的错误假设

**正确语义**(NewAPI 源码 `constant/log_type.go`):

| type 值 | 含义 |
|---|---|
| 1 | 充值日志(topup) |
| 2 | **消费日志(consume),正常调用都是 type=2** |
| 3 | 管理日志(manage) |
| 4 | 系统日志(system) |

我的错误假设:`type=2 = error`。在几乎每家日志系统里 "type" 都有语义,但 NewAPI 这里 type 是**日志分类**,不是**成功/失败**。

**判断请求是否成功的正确字段**:

```
1. content 非空 = 错误消息存在 = 真失败
2. completion_tokens = 0 = 上游没返回内容 = 失败
3. stream_status.status = "ok" (对流式) 或 completion_tokens > 0(非流) = 成功
```

### 2.2 认知层:确认偏误 + 紧急情况下跳过验证

客户报了 503 → 我**预先相信**"有故障" → SQL 查询只为了**证实**预期,不是**验证**预期。

看到 type=2 计数高 → 立刻代入 "这就是错误数" 没再深想。

**深层问题**:在客户焦虑时,我感到**必须立刻做点什么**的压力,这压力让我跳过验证阶段直接进入止血阶段。

### 2.3 流程层:没有 "验证假设 → 再行动" 的硬性 gate

我的决策链:

```
客户报错 → 看到数字 → 假设这就是原因 → 动手改
```

**应该是**:

```
客户报错 → 先问 "我的数据解读假设是什么?" →
→ 用另一组字段交叉验证同一结论 →
→ 假设 confirm 后再动手
```

**具体这次**:如果我在 11:31 的 SQL 之后就再跑一条 `SELECT 完整字段 LIMIT 3 看看行的样子`,30 秒内就会发现 "这些 type=2 都带 completion_tokens > 500,根本不是错误"。

---

## 三、错误决策模式识别

这次错误不是孤立的。复盘过去几周的操作,**类似模式**已经出现过:

### 模式 1:客户报急 → 立刻止血,不验证

- **2026-05-09 16:56**:ch29 thinking 错误,我 disable 整个 channel(后来发现只影响特定客户)
- **2026-05-09 22:57**:ch31 502 `unknown provider for gpt-5.1-codex-mini`,我 disable(这次 disable 正确,但决策过程没验证是否其他 model 也受影响)
- **2026-05-10 11:32**:本次 cpa "100% 挂" 误判

**共同特征**:
- 客户报错 → 5 分钟内我已经跑了 SQL
- 我的 SQL 是 "count 错误数" 而不是 "验证客户报错的具体请求"
- 我倾向于改 channel 设置(priority / status),而不是先问 "是偶发还是持续"

### 模式 2:过度信任 SQL 数字

SQL 返回数字时,我把**数字本身**当 ground truth,不问 "这个数字的字段定义是什么"。尤其在紧急状态下,**没时间去查 schema / source code 的假设**。

### 模式 3:缺乏 "可接受错误率" 基线

我没有 "错误率多少算正常" 的基线。**没有基线 = 任何错误看起来都像紧急**。

---

## 四、预防机制(从现在开始必须遵守)

### 4.1 标准错误率查询 SQL(以后第一步就用这个)

```sql
-- 判断 NewAPI 某个模型的真实错误率
SELECT
  COUNT(*) AS total_reqs,
  SUM(CASE
    WHEN LENGTH(content) > 0 THEN 1
    WHEN completion_tokens = 0 AND type = 2 THEN 1
    ELSE 0 END) AS real_errs,
  ROUND(
    SUM(CASE
      WHEN LENGTH(content) > 0 THEN 1
      WHEN completion_tokens = 0 AND type = 2 THEN 1
      ELSE 0 END) * 100.0 / COUNT(*), 2) AS err_rate_pct
FROM logs
WHERE created_at > UNIX_TIMESTAMP() - 3600  -- 或按具体时间窗口调
  AND model_name = 'gpt-5.5';
```

**基线(可接受错误率)**:

| 错误率 | 含义 | 行动 |
|---|---|---|
| < 1% | 正常波动 | 不操作,告诉客户重试 |
| 1-5% | 轻度异常 | 观察 5 分钟,看是上涨还是回落 |
| 5-20% | 中度异常 | 查具体 channel,考虑 weight 微调 |
| > 20% | 严重故障 | 可以止血(disable 或 priority 调整)|

### 4.2 紧急情况操作 checklist(任何止血动作前必须跑完)

```
[ ] 1. 客户报错样本:具体是哪个 token?哪个 endpoint?哪个 model?
[ ] 2. 错误率查询:用 §4.1 SQL 查真实错误率
[ ] 3. 错误率 > 5% 才考虑止血;< 5% 告诉客户重试
[ ] 4. 如果决定止血:先 SELECT 当前 channel 配置(备份状态)
[ ] 5. 改动后,立即 SELECT 验证"现在的路由是否符合预期"
[ ] 6. 等 60 秒,再次跑错误率 SQL,确认改善方向正确
[ ] 7. 如果没改善或恶化,立即回退
```

### 4.3 永远不要:在没验证的情况下做以下操作

- ❌ `UPDATE channels SET priority = ...`(影响全局路由)
- ❌ `UPDATE channels SET status = 2`(disable channel)
- ❌ `docker compose up -d --force-recreate`(无必要的中断)
- ❌ 改 `weight` 同 priority 组内(影响流量分配)

这些操作**必须**先过 §4.2 checklist。

### 4.4 "type" 字段对照表(防类似误读)

NewAPI 的 `logs.type`:**1 topup / 2 consume / 3 manage / 4 system**
nassa-cards 的 `cards.status`:**unused / activating / activated / expired**
channels 的 `status`:**1 启用 / 2 禁用**
channels 的 `type`:**1 OpenAI / 14 Anthropic / ...(渠道类型,不是状态)**

**不确定字段含义时,先 `grep` 源码或 `DESCRIBE` 表,再解读**。

---

## 五、给未来 LLM agent 的操作准则

### 5.1 Karpathy 原则(重申)

> **Don't assume. Don't hide confusion. Surface tradeoffs.**

这次我 **assume** 了 type=2 的含义,**hide** 了我对 NewAPI 日志 schema 的不熟,**跳过了** tradeoffs(priority 改动会让真 GPT 客户用上弱模型)。

### 5.2 紧急情况反制式反应

**看到客户报错时的本能反应**是 "我要立刻做点什么"。这个本能在生产环境是**危险的**。

正确的反制反应:

1. **先问"有多急"**:错误率 < 5% = 不急,给自己 5 分钟验证时间
2. **先验证再改**:SQL 验证假设,而不是 SQL 证实恐慌
3. **改动要可回退**:任何改动先备份当前状态,5 分钟内无改善立刻回退

### 5.3 "验证假设" vs "证实恐慌" 的 SQL 写法差异

**证实恐慌(错误)**:

```sql
-- 我预期有很多错误,就查错误数
SELECT COUNT(*) FROM logs WHERE type = 2 ...
```

**验证假设(正确)**:

```sql
-- 我想知道到底什么样子
SELECT FROM_UNIXTIME(created_at), channel_id, type,
  LENGTH(content) AS err_msg_len,
  completion_tokens,
  JSON_EXTRACT(other, '$.stream_status')
FROM logs WHERE ... LIMIT 10;
```

**差异**:后者让我**看到数据长什么样**,不是让我**把预期当数据**。

### 5.4 NewAPI 领域知识积累(以后接手的 LLM 必读)

已经记录的 "我以为是 X 其实是 Y" 清单:

| 字段 | 我以为 | 实际 |
|---|---|---|
| `logs.type=2` | 错误 | 消费日志(正常) |
| `channels.status=2` | 不确定 | 禁用(和 status=0 等价禁用) |
| `channels.priority` | 越低越优先 | **越高越优先** |
| `channels.weight` | 不同 priority 间有效 | **只在同 priority 内分流** |
| `model_mapping` | 列出的模型必须真实存在 | 只要 **源模型** 在 channel.models 列表即可,目标模型不需要列出 |

---

## 六、本次事故的客户影响评估

| 维度 | 影响 |
|---|---|
| 服务中断 | 10s(NewAPI 容器重启) |
| 误路由时间 | ~5 分钟(11:32-11:37,chat/completions 客户被错误地路由到 mimo) |
| 受影响客户数 | 近 5 分钟 gpt-5.5 chat 客户 ≈ 2 个(admin 自测 + user_id=204) |
| 客户投诉 | 暂未收到 |
| 损失 | 客户可能感觉"模型变笨"但无法证明 |

**相对代价**:低。但**模式代价**高 — 如果不记录这次教训,下次更大规模故障时会重复。

---

## 七、后续改进 action items

### 已完成

- [x] 2026-05-10 11:42:ch26/27 priority 回退 30(原状)
- [x] 2026-05-10 11:42:PROJECT_GUIDE.md 加事故 7 章节
- [x] 2026-05-10 11:44:本独立复盘文档创建

### 待做

- [ ] **以后每次客户报生产错误,第一件事是用 §4.1 SQL 查真实错误率**
- [ ] **止血操作前必须跑完 §4.2 checklist**
- [ ] **考虑给 NewAPI 加一个 `/api/admin/error-rate` endpoint**(或 dashboard 卡片),让以后查错误率不用写 SQL
- [ ] **考虑把 §4.1 SQL 包进一个可复用 shell 脚本**`scripts/check-error-rate.sh`

---

## 八、写给自己的话

每次生产事故的关键瞬间,我都有**两个选择**:

1. **"先做点什么"**:改配置、重启服务、显得我在控制局面
2. **"先看清楚"**:查数据、验证假设、说"我可能误判了"

本能会把我推向 1,但 1 经常是错误的。

**2 才是对客户负责**。2 看起来慢,但避免了 1 的破坏。2 让客户的 10s 中断没有发生。

下次遇到客户说"服务器挂了",我的第一句话应该是:
> "我查一下真实错误率,这可能是偶发。稍等 30 秒。"

而不是:
> "🚨 立刻止血!"

---

**最后:为这次客户的 10s 中断负责。记录这次失误是为了下一次不再犯**。
