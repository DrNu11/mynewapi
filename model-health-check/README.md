# 🩺 模型健康检查 Model Health Check

一个轻量级 Next.js 仪表盘，用于**实时监测 Nassa API 上每个模型的可用性**。

## ✨ 功能

- ✅ 一键并发检测所有配置的模型（限制并发 4 避免自己打爆自己）
- ✅ 每个模型显示**状态 / 响应时间 / HTTP 状态 / 实际模型 / 返回内容 / 错误原因**
- ✅ 按**状态 (健康/故障)** 和 **类别 (GPT/Codex/Claude/Gemini/MiniMax)** 筛选
- ✅ 支持**自动定时刷新**（10-600 秒可调）
- ✅ API Key 支持两种方式：环境变量（推荐）或 UI 里填入（浏览器 localStorage）
- ✅ 深色模式，响应式，无需额外 UI 库

## 🚀 快速开始

```bash
cd /Users/w/Desktop/newapi/model-health-check

# 1. 安装依赖（约 30 秒）
npm install

# 2. (可选) 配环境变量
cp .env.local.example .env.local
# 编辑 .env.local 填入你的 API key

# 3. 启动
npm run dev
```

浏览器打开 **<http://localhost:3030>** 即可。

首次打开点右上角 **⚙️ 设置** 填入 API Key（如果没通过 env 配的话），然后点 **🚀 全部检测**。

## 📋 环境变量（可选）

| 变量 | 说明 | 默认 |
|---|---|---|
| `NASSA_BASE_URL` | Nassa API 基地址 | `https://api.nassaapi.xyz/v1` |
| `NASSA_API_KEY` | 你的 API Token | 无，必须填（或 UI 里填） |

通过环境变量配的话 API Key 不会落到浏览器。

## 🎛️ 自定义模型列表

编辑 `lib/models.ts`，追加或删除即可：

```ts
export const MODELS: ModelDef[] = [
  { id: 'gpt-5.2', category: 'GPT', via: 'CPA' },
  { id: 'claude-opus-4', category: 'Claude', via: 'Relay' },
  // ...
];
```

保存后热更新，UI 自动刷新。

## 🧩 架构

```text
┌────────────────────────────┐
│  浏览器 (app/page.tsx)      │
│  - 读设置 / 渲染 UI / 发请求 │
└─────────────┬──────────────┘
              │  POST /api/check
              ▼
┌────────────────────────────┐
│  Next.js API Route (Node)   │
│  app/api/check/route.ts    │
│  - 加 Authorization header  │
│  - 30s 超时控制             │
│  - 解析错误提示             │
└─────────────┬──────────────┘
              │  POST /v1/chat/completions
              ▼
     Nassa API (https://api.nassaapi.xyz)
```

**为什么要后端代理？**

- 避免 API Key 暴露在前端（用户填 UI 的情况除外）
- 规避 CORS
- 方便加 30 秒超时等统一控制

## 🎯 典型使用场景

### 场景 1：扩容前 / 限速改了后自检

```text
点"全部检测" → 看卡片状态 → 立刻知道哪些模型有坑
```

### 场景 2：客户报障时快速定位

```text
客户说 "gpt-5.3-codex 不能用" → 立即单独点该模型的"立即检测"
→ 看响应时间 / HTTP / 错误信息 → 秒级判断是上游问题还是客户端问题
```

### 场景 3：全天候监控

```text
打开自动刷新 30 秒一次 → 挂一个浏览器标签 →
任何模型变红立刻发现（未来可以对接 Webhook 告警）
```

## 📝 端口 & 路由

- **开发端口**：`3030`（避免跟 nassaapi-frontend 的 3000 冲突）
- **主界面**：`/`
- **API**：`POST /api/check` — body: `{ modelId, baseUrl?, apiKey?, prompt?, maxTokens? }`

## 🔮 后续可扩展

- [ ] 历史曲线：SQLite 存每次 check，画 24h latency 折线
- [ ] Webhook 告警：某模型连续 3 次失败 → 发钉钉/企微
- [ ] 批量模式：支持大 prompt、长 token 压测
- [ ] 按分组 / 渠道 / 账号维度聚合测试
- [ ] 导出 CSV / JSON 报告

## 📄 License

Private · Internal use only for Nassa API
