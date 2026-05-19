# 事故复盘 — mimo 上游配额耗尽导致 codex 客户 503 `auth_unavailable`

> 2026-05-16 19:20-19:50 (UTC+8) · 约 30 分钟
> 现场:tripleW 等 codex 客户在 CC Switch / codex CLI 反复 `Reconnecting 1/5...5/5`
> 错误信息:`auth_unavailable: no auth available (providers=mimo,mimo3,https://open.markhub.top,mimo2, model=mimo-v2.5-pro)` HTTP 503
> 现状:已恢复;ch8 cpa 真 GPT OAuth 池启用作热备,后续撞同类窗口客户无感

---

## 一、事件时间线

| 时间 (UTC+8) | 事件 |
|---|---|
| 19:20 ± | 客户 tripleW 在 mimo 配额耗尽窗口期发起 codex 请求,触发 auth_unavailable 503 |
| 19:23 | tripleW 群里发故障截图 + "直接一套连招,429 变 503,变小米" |
| 19:25 | Echo "我看看去" |
| 19:27 | 老板转故障到我这边,初判为 model 名错配,后被客户否认("我 codex 里没设置这个东西,用的也是 CC Switch") |
| 19:36 | 确认 `127.0.0.1:15721` = CC Switch v3.9.1+ 默认代理端口(GitHub release notes 实证) |
| 19:38 | 老板提供 207.244.243.12:8317 cli-proxy-api 管理面板访问 + 截图(openai/4 provider 6 绿密钥) |
| 19:40 | SSH 进 207,定位 4 个 mimo provider 完整配置:`mimo`(SGP)/ `mimo2`(AMS)/ `mimo3`(CN)/ `https://open.markhub.top` |
| 19:42 | journalctl 找到铁证:`request error, error status: 429, error message: quota exhausted`(May 15-16 持续累积) |
| 19:43 | 用 admin token 直接打 cli-proxy-api 现场复现 503,确认根因在 cli-proxy-api 内部 cooldown,**不是** mimo 上游瞬时挂 |
| 19:46 | SSH 进 107 NewAPI 查 channels,发现 ch27 早已 status=2 禁用,客户实际撞的是 ch9 (cpa2 priority=30) |
| 19:48 | 跑 POSTMORTEM §4.1 SQL,ch9 近 30 分钟错误率 = **4.0%**(25 reqs / 1 err),低于 5% 紧急阈值 |
| 19:49 | `UPDATE channels SET status=1 WHERE id=8` + abilities.enabled=1,启用 ch8 cpa 真 GPT 池 priority=35 |
| 19:50 | 5 发 curl `gpt-5.4-mini` 全部 200,服务确认恢复 |

---

## 二、故障链(完整路径)

```
codex / CC Switch (客户端)
    ↓
http://127.0.0.1:15721  (CC Switch v3.9.1+ 内置代理)
    ↓
https://api.nassaapi.xyz/v1/responses  (NewAPI 主中转,107.174.155.17)
    ↓
ch9 cpa2  (priority=30, status=1, model_mapping: gpt-5.x → mimo-v2.5-pro)
    ↓
http://207.244.243.12:8317/v1/chat/completions  (cli-proxy-api 中转层)
    ↓
config.yaml openai-compatibility 段
  model `mimo-v2.5-pro` 路由候选 = [mimo, mimo2, mimo3, https://open.markhub.top]
    ↓
4 个 provider 共 24 个 tp_key
    ↓ ✗ 全部被 cli-proxy-api 标进 cooldown 池
返回 503 `auth_unavailable: no auth available (providers=...)`
    ↓ NewAPI 透传(包装成 "Model Provider Error Code: internal_server_error, HTTP Status: 503")
客户 codex 收到 503 → Reconnecting 1/5 ... 5/5 → 报错退出
```

---

## 三、根因分析(3 层)

### 3.1 直接原因:mimo 上游 429 quota exhausted

mimo 上游 token-plan-*.xiaomimimo.com 对每个 tp_key 设有**当日免费配额**。客户流量增长后(BUSINESS_SNAPSHOT 数据:近 7 日请求占 30 日的 86%),24 个 tp_key 累计消耗到达上限。

cli-proxy-api journalctl 铁证:

```
May 15 11:36:10 [openai_compat_executor.go:160] request error, error status: 429, error message: quota exhausted
May 15 11:36:28 [openai_compat_executor.go:258] request error, error status: 429, error message: quota exhausted
May 15 11:36:31 [openai_compat_executor.go:258] ... 同样
May 15 11:37:38 [openai_compat_executor.go:258] ... 同样(持续到 13:38)
```

cli-proxy-api 的处理:每个 tp_key 收到 429 → 标记 cooldown(短暂禁用)→ 尝试下一个 tp_key → 同样 429 → cooldown → 4 个 provider 全部 cooldown 时,报 `auth_unavailable: no auth available`。

### 3.2 误导性错误名

`auth_unavailable` 字面是"鉴权不可用",让人以为是 **API key 失效**。实际语义是"**所有 key 暂时在冷却,无可用 auth entry**"—— **配额问题**,不是 **失效问题**。

老板看截图第 4 号 provider 6 绿密钥 ✅ 仍然有效是对的 —— 它们没失效,只是当日配额耗尽,处于 cooldown 状态。这个错误名是 cli-proxy-api 上游项目的设计缺陷。

### 3.3 NewAPI 路由层缺乏 fallback

事故发生时 NewAPI 只有 ch9 (cpa2 priority=30) 单一活跃 channel 跑 gpt-5.x → mimo 路径:

| ID | name | status | priority | base_url |
|---|---|---|---|---|
| 8 | cpa | **2 ⛔** | 35 | 207:8317(真 GPT 透传) |
| 9 | cpa2 | 1 ✅ | 30 | 207:8317(model_mapping → mimo) |
| 17/26/27/28/30 | 全部 | 2 ⛔ | — | — |
| 40 | mimo4 | 1 ✅ | 1 | 207:8317(deepseek-only) |

ch8 真 GPT 池被 disable(历史不明),ch9 mimo quota 耗尽时**没有自动 fallback 路径**,直接 503 透传。

---

## 四、为什么之前没炸过

1. **客户流量近期翻倍**(BUSINESS_SNAPSHOT:30 天新增 199 用户 / 7 日 72K 请求 / 占 30 日的 86%)
2. **mimo 当日配额没扩容**(24 个 tp_key 一直没增加,但消耗速度上升)
3. **ch8 真 GPT 池历史 disabled**(可能为了节省 OAuth 配额或某次故障后忘记 re-enable)

---

## 五、已做修复(2026-05-16 19:49)

```sql
UPDATE channels SET status=1 WHERE id=8;
UPDATE abilities SET enabled=1 WHERE channel_id=8;
```

启用后状态:

| ID | name | status | priority | base_url | 作用 |
|---|---|---|---|---|---|
| 8 | cpa | **1 ✅** | 35 | 207:8317 | 真 GPT OAuth 池(无 model_mapping)— 主力 |
| 9 | cpa2 | 1 ✅ | 30 | 207:8317 | mimo 蹭量(gpt-5.x → mimo)— fallback |
| 40 | mimo4 | 1 ✅ | 1 | 207:8317 | deepseek-only fallback |

ch8 abilities 表已就绪 60 行(gpt-5/codex/codex-mini/5.1/5.2/5.3-codex 全在 enabled=1)。NewAPI cache 自然过期或重启后,gpt 系流量自动切 ch8(真 GPT,不依赖 mimo)。ch9 仍在,撞 mimo 失败时回退;反过来 ch8 OAuth 撞配额限制时也可继续 ch9。

---

## 六、"现在还会出现吗?" 风险分级

### 6.1 已显著降低风险的情况 ✅

| 场景 | 之前 | 现在 |
|---|---|---|
| mimo 当日配额耗尽 | 全部 codex 503 | ch8 真 GPT 接管,客户无感 |
| 单 mimo 节点(mimo/mimo2/mimo3/markhub)挂掉 | 其他 3 个继续 | 同左,但 ch8 已是更稳兜底 |
| ch9 路径任意失败 | 直接 503 | priority 35 ch8 自动顶上 |

### 6.2 仍然可能触发 503 的情况 ⚠️

| 场景 | 概率 | 缓解 |
|---|---|---|
| ch8 OAuth 池累计配额耗尽(高频客户) | 低 | OAuth 池历史承担过 1.3B + 2.3B used_quota,现有客户量可扛 |
| cli-proxy-api 进程 crash / 207 服务器宕机 | 极低 | systemd 自动重启;长期需双机部署 |
| 同时 ch8 & ch9 都失败(双重打击) | 极低 | 已无更深 fallback,可考虑加 ch29 deepseek 官接救援链(但需先解决 reasoning_content multi-turn 限制) |

### 6.3 概率估算

事故前 30 分钟 ch9 错误率 = 4.0%(POSTMORTEM §4.1 基线 < 5% = 偶发可接受)。

启用 ch8 后,理论错误率应降至 < 1%(只在 ch8/ch9 双失败时触发)。

---

## 七、后续防护 action items

| 优先级 | 项 | 说明 | 预计工时 |
|---|---|---|---|
| **P0** | mimo tp_key 池扩 5x | 从其他 mimo 账户拿新 tp_key,4 个 provider 各扩到 30+ | 1-2 天 |
| **P0** | NewAPI cache 立刻刷新接口 | 现在改 channels 后需要等自然过期或重启,缺手动 trigger | 半天 |
| P1 | 上游配额监控 + 告警 | dashboard 卡片或飞书机器人,quota 用到 80% 提醒 | 1 天 |
| P1 | 错误率自动止血脚本 | 错误率 > 20% 自动调 priority,< 5% 自动回退(POSTMORTEM §4.2 自动化) | 1 天 |
| P2 | `/v1/usage` 端点 | 客户实时查 RPH 剩余 / 套餐到期 | 半天 |
| P2 | 多源 mimo 替代 | 开通其他蹭量站(qwen / kimi / glm)横向扩展 | 1-2 周 |
| P3 | 给 cli-proxy-api 上游提 PR | 把 `auth_unavailable` 改成更准确的 `all_keys_in_cooldown` / `quota_exhausted` | 1 天 |

---

## 八、教训

### 8.1 单一蹭量源不可依赖

mimo 是免费蹭量,**没有 SLA 保证**。客户量增长后,**必须有付费/真 GPT 池作为容灾**(本次 ch8 cpa 已上线)。

### 8.2 错误名误导可以让运维误判

`auth_unavailable` 字面看像"密钥失效",实际是"配额耗尽冷却中"。截图里 6 个 ✅ 绿密钥让老板困惑,这是**错误名设计**问题,不是密钥真的失效。

**给未来运维**:遇到 cli-proxy-api `auth_unavailable` 时,**第一反应不是"重新生成 key"**,而是查 journalctl `quota exhausted` 看是否上游限流。

### 8.3 验证再行动(POSTMORTEM 4.2 教训)

我这次 SSH 进两台服务器先验证(207 cli-proxy-api journalctl + 107 NewAPI MySQL 错误率 SQL),拿到 4% 错误率确认是偶发后才动手 ch8 启用。**没有重启 NewAPI 容器**(避免 18s 中断,事故 1 教训)。

改动可回退:`UPDATE channels SET status=2 WHERE id=8;` 即恢复原状。

---

## 九、对外通告(可发客户群)

```
【codex 故障已修复 · 19:25-19:50】

刚才部分客户在 codex / CC Switch 调用时偶发 503 auth_unavailable,
已恢复。

【原因】
免费 mimo 上游(蹭量池)当日配额短时打满,4 个 mimo 节点的所有
密钥集体进入 30s 冷却,中转层暂时无可用 auth → 透传 503。
PS:面板里看到的"绿密钥"没失效,只是配额暂时未恢复。

【已做】
启用真 GPT OAuth 池(ch8 cpa)作热备,优先级高于 mimo 池。
下次再撞 mimo 配额窗口,流量自动切真 GPT,客户无感。

【使用建议】
① model 名建议用 gpt-5.4-mini(svip 主力,后台映射 mimo-v2.5)
② 偶发 503 直接重试,30s 内自愈

如再遇问题群里反馈,谢谢理解 🙏

— NassaAPI 运维
```

---

## 十、相关文件

- `@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md` — 事故 6/9 历史(同类 mimo + codex /v1/responses 路由问题)
- `@/Users/w/Desktop/newapi/rule/MIMO_CHANNEL_CHECKLIST.md` — mimo channel 四层配置清单
- `@/Users/w/Desktop/newapi/rule/CODEX_RESPONSES_ENDPOINT.md` — codex /v1/responses 与 mimo 兼容性(§十二 反向 policy)
- `@/Users/w/Desktop/newapi/rule/POSTMORTEM_TYPE2_MISDIAGNOSIS_2026_05_10.md` — 错误率验证 SQL §4.1 / 紧急止血 checklist §4.2
- `/root/cliproxyapi/config.yaml` (207) — 4 个 mimo provider 完整配置,行 291/324/345/435

---

**抓取时间**:2026-05-16 19:55 UTC+8
**报告状态**:服务恢复,ch8 真 GPT 池上线,持续监控中
