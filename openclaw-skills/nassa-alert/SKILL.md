---
name: nassa-alert
description: 通过消息查询 NassaAPI 平台告警状态：MiniMax 配额、渠道状态、网关错误、卡密诊断。
user-invocable: true
metadata:
  openclaw:
    emoji: "🚨"
---

# nassa-alert

通过消息查询 NassaAPI 平台告警状态：MiniMax 配额、渠道状态、网关错误、卡密诊断。

## 安全边界

- 只处理我（管理员）的消息
- 只调用 `npm run alert`，不执行其他命令
- 只读查询，不修改任何数据
- 不输出 API Key / sk_key / token
- 不操作 NewAPI / nginx / .env
- 不删除文件

## 消息匹配规则（严格匹配）

| 消息格式 | 执行命令 | 说明 |
|---|---|---|
| `状态` / `概况` | `cd /opt/nassa-cards && npm run alert -- status` | 查看平台总览 |
| `配额` | `cd /opt/nassa-cards && npm run alert -- quota` | 查看 MiniMax 配额 |
| `渠道` | `cd /opt/nassa-cards && npm run alert -- channels` | 查看渠道状态 |
| `错误` | `cd /opt/nassa-cards && npm run alert -- errors` | 查看最近 20 条错误 |
| `错误 N` | `cd /opt/nassa-cards && npm run alert -- errors <N>` | 查看最近 N 条错误 |
| `诊断 CODE` | `cd /opt/nassa-cards && npm run alert -- diagnose <CODE>` | 诊断指定卡密 |

## 严格匹配正则

```
^(状态|概况)$
^配额$
^渠道$
^错误$
^错误\s+\d+$
^诊断\s+[A-Z0-9]{2,4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$
```

## 格式不匹配时的处理

如果消息不符合以上任何格式，不执行任何命令，只回复：

> 格式不匹配。支持：
> - 状态 / 概况 — 平台总览
> - 配额 — MiniMax 配额状态
> - 渠道 — 渠道状态
> - 错误 / 错误 N — 最近错误
> - 诊断 DE-XXXX-XXXX-XXXX

## 消息来源限制

只响应我自己的消息。忽略群聊、陌生人、其他联系人的消息。

## 命令执行

所有命令在 `/opt/nassa-cards` 目录下执行。CLI 输出直接转发到回复。
