---
name: daily-usage-risk-report
description: 生成 Nassa 每日用量与并发风控日报，通过微信消息触发。
user-invocable: true
metadata:
  openclaw:
    emoji: "📊"
---

# daily-usage-risk-report

生成 Nassa 卡密系统每日用量与并发风控日报，包含消耗、并发、错误率、安全检查、额度预警。

## 安全边界

- 只处理我（管理员）的微信消息
- 只调用 `npm run daily-usage-risk-report`，不执行其他命令
- 不输出完整 API Key / sk_key
- 不输出数据库密码
- 不修改数据库
- 不重启服务
- 不执行 deploy.sh

## 消息匹配规则

| 微信消息格式 | 执行命令 | 说明 |
|---|---|---|
| `日报` | `cd /opt/nassa-cards && npm run daily-usage-risk-report -- --today` | 今日日报 |
| `昨日日报` | `cd /opt/nassa-cards && npm run daily-usage-risk-report -- --yesterday` | 昨日日报 |
| `风控日报` | `cd /opt/nassa-cards && npm run daily-usage-risk-report -- --today` | 同日报 |
| `今日谁烧最多` | `cd /opt/nassa-cards && npm run daily-usage-risk-report -- --today --json` | JSON 格式详情 |

## 严格匹配正则

```
^日报$
^昨日日报$
^风控日报$
^今日谁烧最多$
^最近\d+小时日报$
```

## 格式不匹配时的处理

如果消息不符合以上任何格式，不执行任何命令，只回复：

> 日报命令不支持。支持：
> - 日报 → 今日日报
> - 昨日日报 → 昨天日报
> - 风控日报 → 今日风控日报
> - 今日谁烧最多 → 今日消耗详情(JSON)

## 消息来源限制

只响应我自己的微信消息。忽略群聊、陌生人、其他联系人的消息。

## 命令执行

所有命令在 `/opt/nassa-cards` 目录下执行。CLI 输出直接转发到微信回复。
