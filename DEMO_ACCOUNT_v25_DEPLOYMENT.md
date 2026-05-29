# 演示账号 v25 部署总结

> **部署日期**：2026-05-27  
> **生产域名**：https://api.nassaapi.xyz  
> **服务器**：207.244.243.12  
> **当前镜像 tag**：`hide-model-v8` （= `hide-model-v25` 别名）

---

## 1. 演示账号

| 项 | 值 |
|---|---|
| 登录地址 | `https://api.nassaapi.xyz/login` |
| 用户名 | `demo` |
| 密码 | `dxdcz` |
| NewAPI user_id | `441` |
| role | `10` (admin，但被 BlockDemoUser 拦截) |
| 昵称 | `合伙人演示` |
| 邀请码 | `a8hryYQnGkVo` |
| 初始余额 | $200 (虚拟) |

---

## 2. 合伙人能看到什么

### Sidebar 仅 3 项

| 组 | 模块 | 用途 |
|---|---|---|
| 聊天 | **操练场** | 真实调用模型测试质量（会扣 admin quota） |
| 控制台 | **使用日志** | 看真实业务流量（脱敏后） |
| 个人中心 | **钱包管理** | 查余额 + 跳转外部商店充值 |

### 使用日志显示效果

```
时间                | 用户         | 令牌                 | 模型           | 用时 | quota
2026-05-27 20:48:45 | 客户-PDBK    | DE-PPJN-XJLA-PDBK   | deepseek-v4-pro | 7s   | 49905
2026-05-27 20:48:41 | 客户-pleW    | tripleW             | gpt-5.5         | 42s  | 187977
2026-05-27 20:48:41 | 客户-5.15    | 新令牌5.15           | gpt-5.5         | 17s  | 225025
```

- ✅ 每个 token 看起来是独立客户（用 token_name 后 4 位生成「客户-XXXX」）
- ✅ 渠道列**完全删除**（连列头都没有）
- ✅ upstream_model_name / admin_info / channel_affinity 等敏感 key 已删
- ✅ upstream_request_id 已清空

---

## 3. 防御层架构（4 层）

| 层 | 实现 | 关键文件 |
|---|---|---|
| **1. 前端 sidebar 隐藏** | `user.setting.sidebar_modules` JSON 配置（仅 console.log/playground/topup 启用） | SQL `UPDATE users SET setting=...` |
| **2. 后端 API 拦截** | `BlockDemoUser` middleware 挂在 13 个敏感 route group | `@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/auth.go:196-212` |
| **3. log 数据脱敏** | `sanitizeLogsForDemo` 在 `GetAllLogs` 里改 username/channel + 删 other JSON 6 个 key | `@/Users/w/Desktop/newapi/build-workspace/new-api/controller/log.go:51-91` |
| **4. log 渠道列前端隐藏** | UsageLogsTable 用 UserContext 读 is_demo，filter 掉 CHANNEL 列 | `@/Users/w/Desktop/newapi/build-workspace/new-api/web/classic/src/components/table/usage-logs/UsageLogsTable.jsx:52-98` |

### 操练场没有拦截

合伙人按"发送"会真实调用 `/v1/chat/completions`，扣 admin 钱包，但响应受 system prompt 强制伪装为 GPT。已通过 v11-v21 多层 stripProviderBranding 兜底。

---

## 4. 后端代码改动（5 个文件）

| 文件 | 改动 |
|---|---|
| `@/Users/w/Desktop/newapi/build-workspace/new-api/dto/user_settings.go:19` | +1 行 `IsDemo bool` 字段 |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/auth.go:156-162` | +7 行 authHelper 末尾 `c.Set("is_demo", ...)` |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/auth.go:196-212` | +17 行 `BlockDemoUser()` middleware |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/router/api-router.go` | 13 处 `route.Use(...)` 加 `middleware.BlockDemoUser()` |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/controller/user.go:423` | +1 行 GetSelf 返 `is_demo` |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/controller/log.go:30-91` | +60 行 `sanitizeLogsForDemo` + GetAllLogs 集成 |

### sanitizeLogsForDemo 脱敏规则

```go
// 1. Username 改成 "客户-XXXX"（取 token_name 后 4 个 rune）
runes := []rune(log.TokenName)
if n := len(runes); n >= 4 {
    log.Username = "客户-" + string(runes[n-4:])
}

// 2. ChannelId / ChannelName 完全清空
log.ChannelId = 0
log.ChannelName = ""

// 3. UpstreamRequestId 清空
log.UpstreamRequestId = ""

// 4. Other JSON 删除 6 个敏感 key
demoSensitiveOtherKeys = []string{
    "upstream_model_name",
    "admin_info",
    "is_model_mapped",
    "is_system_prompt_overwritten",
    "request_conversion",
    "channel_affinity",
}
```

---

## 5. 前端代码改动（2 个文件）

| 文件 | 改动 |
|---|---|
| `@/Users/w/Desktop/newapi/build-workspace/new-api/web/classic/src/components/topup/RechargeCard.jsx` | 钱包页：tabs 顺序调整（额度充值在前）+ 「未开启在线充值」提示替换为跳转 `pay.qxvx.cn/shop/codex` 的链接卡片 |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/web/classic/src/components/table/usage-logs/UsageLogsTable.jsx` | 加 isDemoUser 判定（从 UserContext 读 setting JSON），过滤掉 CHANNEL 列 |
| `@/Users/w/Desktop/newapi/build-workspace/new-api/web/classic/src/components/table/usage-logs/UsageLogsColumnDefs.jsx` | 渠道列单元格 render 加 `Number(text) > 0` 守卫（避免显示「未知渠道」fallback） |

---

## 6. 镜像 / 回滚

### 当前生产

```
nassa11111/new-api-hide-model:hide-model-v8     ← 生产 tag
  = hide-model-v25 (别名)
  = sha256:ca9958b717c8...
```

### 回滚备份

| 备份 tag | 内容 |
|---|---|
| `hide-model-v8-backup-v22-1779861076` | v22（demo 系统初版，无操练场/钱包/渠道改动） |
| `hide-model-v8-backup-v23-*` | v23（含 demo 系统 + 部分前端改动） |
| `hide-model-v8-backup-v24-*` | v24（v25 上一版） |

### 一键回滚命令

```bash
ssh root@207.244.243.12 '
docker tag nassa11111/new-api-hide-model:hide-model-v8-backup-v22-1779861076 \
           nassa11111/new-api-hide-model:hide-model-v8
cd /www/dk_project/dk_app/newapi-prod && docker compose up -d --force-recreate new-api'
```

---

## 7. 验证清单

| 测试 | 期望 | 验证命令 |
|---|---|---|
| demo 登录成功 | 200, role=10 | `curl -d '{"username":"demo","password":"dxdcz"}' /api/user/login` |
| GetSelf 返 is_demo:true | ✅ | `curl -b cookie /api/user/self \| jq .data.is_demo` |
| 渠道管理 API 拦截 | 403 | `curl -b cookie /api/channel/` |
| 用户管理 API 拦截 | 403 | `curl -b cookie /api/user/` |
| log 接口能用 | 200 + 脱敏 | `curl -b cookie /api/log/` |
| log username 是「客户-XXXX」 | ✅ | grep response |
| log channel_id/channel_name 缺失 | ✅ omitempty | grep response |
| log other 不含 minimax/upstream_model_name | 0 hits | grep response |
| 操练场/v1/chat/completions 可调 | 200 | 浏览器手动测试 |
| 钱包页 tabs：额度充值在前 | ✅ | 浏览器目视 |
| 钱包页跳转 pay.qxvx.cn 链接 | ✅ | 浏览器点击 |
| log 渠道列头不显示 | ✅（需硬刷新） | 浏览器目视 |

---

## 8. 已知边界 / 注意事项

### 8.1 操练场不拦截 — 风险接受

合伙人能真实调用 API 体验产品质量。每次调用：
- 真扣 admin quota（每条几毛钱）
- 上游响应受 system prompt 强制伪装（mimo 反水概率极低但非 0）
- v11-v21 stripProviderBranding 兜底已能处理 99%+ 泄漏

### 8.2 操练场只能选当前 token 绑定的 group 模型

如果想让合伙人体验更多模型（GPT-5 / Claude Opus / Gemini 等），需要：
- 给 demo 用户的 token 配置 `group=ALL`
- 或开放 sidebar 「模型广场」让其浏览所有可用模型 + 价格

### 8.3 浏览器缓存

每次后端镜像更新后，浏览器需要硬刷新 (`Cmd+Shift+R` / `Ctrl+Shift+R`) 才能拿到新 JS bundle。否则会出现：
- 渠道列头还显示
- 钱包 tabs 顺序还是旧的

### 8.4 撤销 demo 状态的方法

```sql
UPDATE users SET setting='{}' WHERE username='demo';
-- 然后清 redis cache
docker exec newapi-prod-redis-1 redis-cli DEL "user:441"
```

### 8.5 新增其他演示账号

```sql
INSERT INTO users (username, password, role, status, ...) VALUES (...);
UPDATE users SET setting=JSON_OBJECT(
  'is_demo', true,
  'sidebar_modules', '{"chat":{"enabled":true,"playground":true,"chat":false},"console":{"enabled":true,"log":true,"detail":false,"token":false,"midjourney":false,"task":false},"personal":{"enabled":true,"topup":true,"personal":false},"admin":{"enabled":false}}'
) WHERE username='demo2';
```

---

## 9. 后续可做的转化优化（pending 你的决定）

按 ROI 排序的 8 个 hook（详见 v25 部署对话记录）：

| 优先级 | 项 | 工时 | 依赖你提供 |
|---|---|---|---|
| ⭐⭐⭐⭐⭐ | 「联系合作」CTA 按钮（弹微信/TG 二维码） | 30min | **微信/TG 二维码图片** |
| ⭐⭐⭐⭐⭐ | 模型广场对 demo 开放（sidebar JSON 加 pricing:true） | 5min | 无 |
| ⭐⭐⭐⭐ | 操练场放开模型选择（demo token group → ALL） | 5min | 无 |
| ⭐⭐⭐⭐ | 数据看板宏观指标（累计调用/客户数/延迟） | 1-2h | 数据脱敏规则 |
| ⭐⭐⭐⭐ | 邀请奖励虚拟数据（INSERT affiliate_history） | 10min | 你想展示的虚拟数字 |
| ⭐⭐⭐ | 「合伙人专区」新页面（合作模式 + 返佣） | 半天 | 业务文案 |
| ⭐⭐⭐ | 价格对比页（vs OpenAI/Anthropic） | 半天 | 价格数据表 |
| ⭐⭐ | SLA / 服务保障文案 | 半小时 | 文案 |

**最小推荐组合**：① 联系按钮 + ② 模型广场 + ③ 操练场放开 + ⑤ 邀请虚拟数据  
工时合计约 50 分钟，覆盖"能联系 + 看价格 + 体验广度 + 看分销收益样本"4 个核心转化要素。

---

## 10. 演示话术参考（给合伙人用）

> 给您开了一个演示账号 `demo / dxdcz`：https://api.nassaapi.xyz/login
> 
> - **使用日志**：看真实业务流量（每个客户独立显示，含 token、quota、tokens、耗时等指标）
> - **操练场**：可试发请求体验 API 响应质量（请节制，每条都计费）
> - **钱包管理**：查询余额（演示账号 0 余额）+ 充值入口
> 
> 我们提供 60+ 模型（Claude Opus 4-7、GPT-5、Gemini 2.5 Pro、DeepSeek V4 等），合伙人价比官方便宜 30%+，欢迎对接合作。

---

## 11. 文件改动差异汇总

```
build-workspace/new-api/
├── controller/
│   ├── log.go                                          # +60 lines (sanitizeLogsForDemo)
│   └── user.go                                         # +1 line  (GetSelf 返 is_demo)
├── dto/
│   └── user_settings.go                                # +1 line  (IsDemo field)
├── middleware/
│   └── auth.go                                         # +24 lines (is_demo + BlockDemoUser)
├── router/
│   └── api-router.go                                   # 13 处加 middleware
└── web/classic/src/components/
    ├── topup/RechargeCard.jsx                          # 钱包页 tabs + 跳转链接
    └── table/usage-logs/
        ├── UsageLogsTable.jsx                          # CHANNEL 列 filter
        └── UsageLogsColumnDefs.jsx                     # 单元格守卫

总计：6 个 .go + 3 个 .jsx 文件
```

---

**部署完成时间**：2026-05-27 20:50 UTC+08:00  
**最终镜像 sha**：`sha256:ca9958b717c8be91854be6c5af90a19b97191b282bb3cfc82bf4c593ed7e6479`  
**HTTP 健康**：✅ 200
