# VIP 一键开通 (vip-onekey)

模仿 nassa-cards 风格的精简卡密激活站,客户输入 NewAPI 邮箱 + 卡密一键升级 user.group=vip1,
30 天后由内置后台调度自动回退到 default 分组。

- **端口**: `1111`
- **技术栈**: Next.js 14 + React 18 + Tailwind + better-sqlite3
- **后端依赖**: NewAPI 管理员 access_token (调 `/api/user/search` + `PUT /api/user/`)

## 工作流

```
客户输入 邮箱 + VIP1-XXXX-XXXX-XXXX
   ↓ POST /api/activate
后端验证卡密 → 调 NewAPI search user → PUT user (group=vip1)
   ↓
SQLite 记录: cards.activated + revert_tasks.scheduled_at = now + 30d
   ↓ 后台 setInterval 每 60s tick
到期 → 调 NewAPI PUT user (group=default) → 写日志
```

## 启动

```bash
cd vip-onekey
cp .env.local.example .env.local
# 编辑 .env.local: 填 NEWAPI_ADMIN_TOKEN

bun install
bun run gen-cards 5 30          # 生成 5 张 30 天的测试卡密
bun run dev                     # http://localhost:1111
```

## 环境变量

| key | 说明 | 默认 |
|---|---|---|
| `NEWAPI_BASE` | NewAPI 后端地址 | `https://api.nassaapi.xyz` |
| `NEWAPI_ADMIN_TOKEN` | admin access_token (顶部 `Authorization` 头) | (必填) |
| `TARGET_GROUP` | 升级目标分组 | `vip1` |
| `DEFAULT_GROUP` | 回退默认分组 | `default` |
| `PLAN_DAYS` | 卡密时长(天) | `30` |
| `REVERT_TICK_SECONDS` | 后台调度 tick 间隔 | `60` |
| `IP_RATE_LIMIT` | 同 IP 每分钟最大激活次数 | `5` |

## 卡密管理

```bash
# 生成 N 张卡密
bun run gen-cards 20 30

# 查看现有卡密 + 状态
sqlite3 data/vip.db "SELECT code, status, plan_days,
  datetime(activated_at,'unixepoch','localtime') AS activated,
  datetime(expires_at,'unixepoch','localtime') AS expires,
  used_email FROM cards;"

# 查看待 revert 任务
sqlite3 data/vip.db "SELECT id, email, target_group, original_group,
  datetime(scheduled_at,'unixepoch','localtime') AS due, status
  FROM revert_tasks WHERE status='pending';"
```

## 安全注意

- `NEWAPI_ADMIN_TOKEN` 是管理员级令牌, 严禁暴露到前端 / git
- 生产建议在反向代理层加 IP 白名单或 Basic Auth
- `data/vip.db` 不可暴露公网
- IP 速率限制只是软防护, 生产建议接 Cloudflare Turnstile / hCaptcha

## 部署

### 选项 A: 本机 / 服务器 直接跑

```bash
bun run build
bun run start                   # 监听 1111
```

### 选项 B: 反向代理(推荐)

```nginx
server {
  listen 80;
  server_name vip.nassaapi.xyz;
  location / {
    proxy_pass http://127.0.0.1:1111;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## 风险与限制

| 现象 | 原因 / 排查 |
|---|---|
| 后台 revert 不触发 | 服务必须保持运行;若进程被 kill, sqlite 里的 pending 任务会在下次启动时被扫描重试 |
| 服务器迁移后 revert 丢失 | 需把 `data/vip.db` 一并迁移 |
| 客户邮箱无法找到 | NewAPI search 接口要求 admin 权限 + 邮箱完全匹配(忽略大小写) |
| 已经是 vip1 仍激活 | API 拒绝重复升级,卡密保持 unused |
| 用户分组被人为改成 vip2 之类 | revert 时检测到 group != 目标,跳过 revert,卡密标记 expired |
