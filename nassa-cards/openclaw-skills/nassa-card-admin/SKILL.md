---
name: nassa-card-admin
description: 通过微信消息管理 DeepSeek 卡密的好评 +55 RPH 加成、禁用和查询。
user-invocable: true
metadata:
  openclaw:
    emoji: "🎫"
---

# nassa-card-admin

通过微信消息管理 DeepSeek 卡密的好评 +55 RPH 加成、禁用和查询。

## 安全边界

- 只处理我（管理员）的微信消息
- 只调用 `npm run card-admin`，不执行其他命令
- 不输出 API Key / sk_key
- 不操作 NewAPI / nginx / .env
- 不删除文件

## 消息匹配规则（严格匹配）

| 微信消息格式 | 执行命令 | 说明 |
|---|---|---|
| `DE-XXXX-XXXX-XXXX` | `cd /opt/nassa-cards && npm run card-admin -- apply-rph DE-XXXX-XXXX-XXXX` | 直接发卡密 → 添加好评 +55 |
| `撤回 DE-XXXX-XXXX-XXXX` | `cd /opt/nassa-cards && npm run card-admin -- clear-rph DE-XXXX-XXXX-XXXX` | 撤回 → 撤销 RPH 加成 |
| `禁止 DE-XXXX-XXXX-XXXX` | `cd /opt/nassa-cards && npm run card-admin -- disable DE-XXXX-XXXX-XXXX` | 禁止 → 禁用该卡 |
| `查询 DE-XXXX-XXXX-XXXX` | `cd /opt/nassa-cards && npm run card-admin -- status DE-XXXX-XXXX-XXXX` | 查询 → 查看卡密状态 |

## 严格匹配正则

```
^DE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$
^撤回\s+DE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$
^禁止\s+DE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$
^查询\s+DE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$
```

## 格式不匹配时的处理

如果消息不符合以上任何格式，不执行任何命令，只回复：

> 格式不匹配。支持：
> - 直接发送 DE 卡密 → 添加好评 +55
> - 撤回 DE-XXXX-XXXX-XXXX
> - 禁止 DE-XXXX-XXXX-XXXX
> - 查询 DE-XXXX-XXXX-XXXX

## 消息来源限制

只响应我自己的微信消息。忽略群聊、陌生人、其他联系人的消息。

## 命令执行

所有命令在 `/opt/nassa-cards` 目录下执行。CLI 输出直接转发到微信回复。
