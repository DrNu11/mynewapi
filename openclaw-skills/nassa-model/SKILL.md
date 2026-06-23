---
name: nassa-model
description: 通过消息切换 OpenClaw agent 模型（MiniMax-M3, gpt-5.5 等）
user-invocable: true
metadata:
  openclaw:
    emoji: "🧠"
---

# nassa-model

通过微信消息切换 OpenClaw 当前使用的 AI 模型。

## 安全边界

- 只处理管理员微信消息
- 只调用 `/opt/nassa-cards/scripts/switch-model.sh`
- 不暴露 API Key
- 不修改除模型选择外的任何配置

## 消息匹配规则

| 微信消息 | 执行命令 | 说明 |
|---|---|---|
| `切换 MiniMax-M3` | `/opt/nassa-cards/scripts/switch-model.sh MiniMax-M3` | 切换到 MiniMax-M3 |
| `切换 gpt-5.5` | `/opt/nassa-cards/scripts/switch-model.sh gpt-5.5` | 切换到 gpt-5.5 |
| `切换 gpt-5.4` | `/opt/nassa-cards/scripts/switch-model.sh gpt-5.4` | 切换到 gpt-5.4 |
| `模型` | `/opt/nassa-cards/scripts/switch-model.sh` | 查看当前模型 |
| `模型列表` | `/opt/nassa-cards/scripts/switch-model.sh --list` | 列出可用模型 |

## 正则匹配

```
^切换\s+(MiniMax-M3|gpt-5\.5|gpt-5\.4|gpt-5\.3-codex)$
^模型$
^模型列表$
```

## 可用模型

- **MiniMax-M3** — MiniMax 旗舰模型
- **gpt-5.5** — 本地 myself 模型
- **gpt-5.4** — 本地 claude11 模型
- **gpt-5.3-codex** — Codex 模型

## 命令执行

所有命令不需要 `cd`，直接使用绝对路径。CLI 输出直接转发到微信回复。
