# Toplenged AI × NewAPI 融合方案 — 项目计划

> 创建时间:2026-05-16
> 选定方案:**C — 双服务架构**(老板已拍板)
> 文档面向:接手的 AI agent / 老板自己回顾 / 后续维护人员

---

## 1. 项目目标

把以下两个独立项目融合成一个面向海外鬼佬客户的完整产品:

| 项目 | 角色 | 现状 |
|---|---|---|
| **toplenged-ai**(本仓库) | 现代用户面 SPA(Next.js 14 风格) | ✅ 9 页面骨架已部署 207:1555 |
| **NewAPI 海外实例**(GCP) | API 网关 + 用户系统 + 账单 + admin | ✅ 已部署 `https://api.toplenged.com` |

**最终形态**:鬼佬看到的是 toplenged-ai 的现代风格 UI,但所有功能(登录/余额/key/调用日志/充值)都由 NewAPI 在后端提供。

---

## 2. 架构总览

```
┌──────────────────────── 鬼佬浏览器 ────────────────────────┐
                              │
                              ▼
                   app.toplenged.com (caddy)
                              │
        ┌─────────────────────┴───────────────────────┐
        │ 路径分发(基于 path,不是基于域名)           │
        │                                              │
        │  / + /models + /pricing + /top-up           │ ──→  toplenged-ai (Next.js, 207:1555)
        │  + /dashboard + /api-keys + /docs           │      用户面页面
        │  + /login + /signup                         │
        │                                              │
        │  /api/*                                      │ ──→  NewAPI Go (GCP 34.135.9.30:3000)
        │  /v1/*                                       │      用户系统 + OpenAI 兼容
        │                                              │
        │  /admin (单独子域 admin.toplenged.com)       │ ──→  NewAPI 自带后台(老板内部用)
        └──────────────────────────────────────────────┘

┌──────────────────────── 后端服务 ────────────────────────┐

  207 VPS (207.244.243.12)              GCP us-central1 (34.135.9.30)
  ────────────────────────              ────────────────────────────
  pm2 toplenged-ai :1555               docker compose:
    ↓                                    - new-api  :3000
  next start                             - mysql    :3306 (内网)
                                         - redis    (内网)
                                       caddy → api.toplenged.com :443
```

---

## 3. 现状盘点

### 3.1 toplenged-ai(本仓库)— 已完成

```
✅ Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui 风格
✅ 9 个页面骨架(/ /models /pricing /top-up /dashboard /api-keys /docs /login /signup)
✅ 左菜单顶部独立 Top up 入口
✅ 双轨充值(美金 + 套餐)同页展示
✅ 8 个模型 mock 数据(3 收费 + 5 免费)
✅ pm2 部署到 207:1555,公网可达 http://207.244.243.12:1555/
✅ build 通过,所有页面静态化通过
❌ 所有数据是 mock,未接真后端
❌ Auth 是占位
❌ 充值按钮是占位(没接 PayPal)
```

### 3.2 NewAPI(GCP 海外实例)— 已部署但空配

```
✅ docker 三服务 healthy(new-api / mysql / redis)
✅ Caddy 反代 + LE TLS:https://api.toplenged.com
✅ 防火墙只开 :80 :443(裸 IP:3000 已锁)
✅ Root 账号已老板初始化
✅ CORS 默认 *,toplenged-ai 浏览器端可直接调
❌ 未导 channel(目前没有上游 AI 模型可用)
❌ 未导 options(SystemName / Logo / 公告等还是默认)
❌ 未配 PayPal 充值流程
```

### 3.3 关键现成接口(NewAPI 自带,可直接调)

| 接口 | 用途 | toplenged-ai 哪页用 |
|---|---|---|
| `POST /api/user/login` | 用户登录 | `/login` |
| `POST /api/user/register` | 用户注册 | `/signup` |
| `GET /api/user/self` | 获取当前用户(余额 / quota / 等级) | `/dashboard` |
| `GET /api/user/self/groups` | 用户可用 group | `/dashboard` |
| `GET /api/log/stat` | 用量统计(token / 请求数) | `/dashboard` |
| `GET /api/log/self` | 调用日志 | `/dashboard` |
| `GET /api/token/?p=0&size=20` | 列出 sk-xxx | `/api-keys` |
| `POST /api/token/` | 创建 sk-xxx | `/api-keys` |
| `DELETE /api/token/:id` | 撤销 sk-xxx | `/api-keys` |
| `GET /api/models` | 列出可用模型 | `/models` `/pricing` |
| `GET /api/status` | 站点配置(SystemName / 公告 / 客户端 deeplink) | 全局 |
| `POST /api/topup/*` | 充值入口 | `/top-up` |

---

## 4. 工作量拆解 — 3 天计划

### 🔴 Day 1 — 接通真后端(预计 6-8 小时)

**目标**:toplenged-ai 所有页面用真实数据,登录/注册/key 能 E2E 跑通。

| 任务 | 文件 | 验收 |
|---|---|---|
| 创建 API client 层(fetch wrapper + token 注入) | `lib/api.ts`(新建) | unit 调通 `/api/status` |
| 添加全局 store(localStorage 存 access_token) | `lib/auth.ts`(新建) | 能登录后保持状态 |
| 改造 `/login` 接 `POST /api/user/login` | `app/login/page.tsx` | E2E:邮箱密码登录 → 跳 dashboard |
| 改造 `/signup` 接 `POST /api/user/register` | `app/signup/page.tsx` | E2E:注册新账号 |
| 改造 `/dashboard` 接 `/api/user/self` + `/api/log/stat` | `app/dashboard/page.tsx` | 看到真实余额 + 用量 |
| 改造 `/api-keys` 接 `/api/token/*` | `app/api-keys/page.tsx` | 能建/删 sk-xxx |
| 改造 `/models` 改造数据源:fetch `/api/models` 替换 mock | `app/models/page.tsx` + `lib/models.ts` | 真实模型列表 |
| 加 `withAuth` HOC(未登录跳 /login) | `lib/auth.ts` | /dashboard 无 token 跳 login |

**Day 1 验收命令**:

```bash
# 在 207 上 npm 重 build + 重启
ssh root@207.244.243.12 'cd /opt/toplenged-ai && npm run build && pm2 restart toplenged-ai'

# 浏览器打开 http://207.244.243.12:1555/signup 注册账号
# → 自动跳 /dashboard 看到余额 $0.00
# → 进 /api-keys 创建 sk-tplgd-xxxx
# → 进 /models 看到真实模型清单
```

---

### 🟡 Day 2 — 域名 + Caddy 反代合并(预计 3-4 小时)

**目标**:鬼佬访问 `app.toplenged.com` 看到完整融合站,前后端域名透明。

| 任务 | 命令/文件 | 验收 |
|---|---|---|
| 老板向合伙人申请 vercel DNS 加 A 记录:`app.toplenged.com` → `207.244.243.12` | (合伙人代做) | `dig @8.8.8.8 +short app.toplenged.com` 返回 207 IP |
| `admin.toplenged.com` → `34.135.9.30`(GCP NewAPI) | 同上 | 同上 |
| 在 207 装 Caddy(207 上现在没 caddy,只有 pm2) | `apt install caddy` | `caddy version` |
| 写 Caddyfile 路径分发 | `/etc/caddy/Caddyfile` | 见 §6.1 |
| 开 207 防火墙 :80 :443 | `ufw allow 80,443` | `curl -I https://app.toplenged.com/` |
| LE 自动签证书 | (caddy 自动) | 浏览器看到锁 |
| 把 toplenged-ai 里硬编码的 `https://api.toplenged.com` 改成相对路径 `/api/*` | `lib/api.ts` | 同源调用,免 CORS |

**Day 2 验收命令**:

```bash
curl -sI https://app.toplenged.com/                    # → 200, toplenged-ai
curl -sI https://app.toplenged.com/api/status          # → 200, NewAPI JSON
curl -sI https://app.toplenged.com/v1/models           # → 401(没 token,符合预期)
curl -sI https://admin.toplenged.com/                  # → 200, NewAPI 自带后台
```

---

### 🟢 Day 3 — PayPal 充值闭环(预计 4-6 小时)

**目标**:鬼佬充 $40 → 余额 $40 → 调 GPT-5.5 扣费。

| 任务 | 文件 | 验收 |
|---|---|---|
| 注册 PayPal 沙箱 app(用合伙人提供的账号) | <https://developer.paypal.com> | 拿到 client_id + secret |
| 加 PayPal SDK | `lib/paypal.ts`(新建) | `@paypal/react-paypal-js` 集成 |
| 改造 `/top-up` 调 PayPal Order Create | `app/top-up/page.tsx` | 弹出 PayPal 沙箱付款窗 |
| Capture 成功后调 NewAPI `/api/topup/*` 给用户加 quota | `app/api/paypal/capture/route.ts`(新建) | `/dashboard` 余额变化 |
| 配 NewAPI 后台:启用 PayPal 充值通道 | `admin.toplenged.com` 配 | 后台能看到充值记录 |
| E2E 测试 | (浏览器手测) | 沙箱 $40 → quota +$40 → 调用扣费 |

**Day 3 验收命令**:

```bash
# 假设用户 sk-tplgd-xxxx
curl -X POST https://app.toplenged.com/v1/chat/completions \
  -H "Authorization: Bearer sk-tplgd-xxxx" \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}'
# 调用前 dashboard 显示 $40.00 → 调用后显示 $39.99x
```

---

## 5. 还要做的事(P2,Day 3 之后)

```
[ ] 改 toplenged-ai 的品牌名(如果合作方想叫别的)
[ ] 配 SystemName / Logo / HomePageContent / Footer(改 NewAPI options 表)
[ ] 接 PayPal 生产环境(沙箱跑通后)
[ ] 加 Stripe / Crypto 支付(海外用户更熟悉)
[ ] 邮件通知(充值成功 / 余额预警)
[ ] Privacy Policy + Terms of Service 页(GDPR 合规)
[ ] Cookie consent banner(GDPR)
[ ] 监控告警(沿用 model-health-check)
[ ] 改 GCP MySQL 密码 + 启动盘扩容(DEPLOYMENT_NOTES §3 待办)
[ ] 从 107 主站导 channel 配置(让海外站有真模型可用)
```

---

## 6. 关键命令速查

### 6.1 Day 2 用的 Caddyfile(预制版,等域名 ready 后填上跑)

```caddyfile
# /etc/caddy/Caddyfile (207 VPS)

app.toplenged.com {
    encode gzip zstd

    # NewAPI API + OpenAI 兼容路径 → GCP NewAPI(同 https,绕过 caddy 自签)
    handle_path /api/* {
        reverse_proxy https://api.toplenged.com {
            header_up Host api.toplenged.com
            header_up X-Forwarded-Host {host}
        }
        rewrite * /api{uri}
    }
    handle_path /v1/* {
        reverse_proxy https://api.toplenged.com {
            header_up Host api.toplenged.com
        }
        rewrite * /v1{uri}
    }

    # 其他全部走 toplenged-ai
    reverse_proxy localhost:1555
}

admin.toplenged.com {
    reverse_proxy https://api.toplenged.com {
        header_up Host api.toplenged.com
    }
}
```

⚠️ Caddy reverse_proxy 到 https 要注意 SNI / Host 头,实际部署时可能要调 `transport http` 子指令。Day 2 实操时验证。

### 6.2 toplenged-ai 重新部署到 207(每次改完代码用)

```bash
rm -rf /tmp/toplenged-ai
cp -R "/Users/w/Desktop/newapi/newapi的合作方" /tmp/toplenged-ai
rm -rf /tmp/toplenged-ai/{node_modules,.next,.git}
tar -czf /tmp/toplenged-ai.tar.gz -C /tmp toplenged-ai
scp /tmp/toplenged-ai.tar.gz root@207.244.243.12:/tmp/
ssh root@207.244.243.12 'rm -rf /opt/toplenged-ai && tar -xzf /tmp/toplenged-ai.tar.gz -C /opt/ && cd /opt/toplenged-ai && npm install --no-audit --no-fund && npm run build && pm2 restart toplenged-ai --update-env'
```

### 6.3 紧急回滚

```bash
# 如果新版本部署崩了,toplenged-ai 进程出错
ssh root@207.244.243.12 'pm2 logs toplenged-ai --lines 50'
ssh root@207.244.243.12 'pm2 restart toplenged-ai'

# 完全回退到骨架版本(初版 mock 数据可用)
ssh root@207.244.243.12 'cd /opt/toplenged-ai && git checkout v0.1-skeleton && npm run build && pm2 restart toplenged-ai'
# (前提:Day 1 开始前先 git tag v0.1-skeleton)
```

---

## 7. 风险点 + 应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| **Caddy 双向反代到 https 卡 SNI** | 中 | Day 2 阻塞 | 备选:caddy 反代到 GCP 的 :3000 直连(关掉 GCP 的 :443 caddy,改 firewall 让 207 IP 直连 :3000) |
| **NewAPI `/api/user/register` 默认要 turnstile** | 高 | 注册页跳验证码 | 后台关 turnstile,或前端集成 Cloudflare Turnstile |
| **NewAPI 的 token 不是 JWT,是 sessionId(cookie)** | 中 | 跨域 cookie 难处理 | Day 1 验证:NewAPI 是不是发 sessionId cookie。如果是,Day 2 同源后自然解决 |
| **PayPal 沙箱回调要 webhook 公网可达** | 高 | Day 3 需要域名先 ready | Day 2 域名先做完,Day 3 才能做 |
| **CORS 在生产环境收紧** | 低 | toplenged-ai 调 NewAPI 被拦 | NewAPI options 表配置 CORS_ALLOW_ORIGINS |
| **NewAPI 自带前端用 `/dashboard` 路径,Day 2 admin 子域分流后会变成 admin.toplenged.com/dashboard** | 中 | 老板 admin 入口变化 | 提前告诉老板新 URL,或者把 admin 放到 admin.toplenged.com/admin 子路径 |

---

## 8. 联系信息 / 凭证(沿用 DEPLOYMENT_NOTES.md)

```
GCP 账号:           z2921477318@gmail.com
GCP NewAPI 实例:    instance-20260515-093915 (us-central1-a)
NewAPI 公网:        https://api.toplenged.com (GCP 34.135.9.30)
NewAPI Root:        老板已初始化,自己记密码
MySQL root 密码:    NewApiR00tPass!(待改强)
PayPal 沙箱:        xpwan123@sohu.com / Duoduo11
207 VPS:            root@207.244.243.12(已配 ssh-key)
toplenged-ai 部署:  /opt/toplenged-ai/, pm2 进程 toplenged-ai, :1555
toplenged-ai 公网:  http://207.244.243.12:1555/(Day 2 后切 https://app.toplenged.com/)
```

---

## 9. 文档维护

- 每完成一个 Day 的任务,在本文档对应 §4 子章节打勾 ✅
- 关键决策(改名 / 改技术栈 / 增删页面)写到 §10 决策日志(本文档可追加)
- 重大 incident 写到 `/Users/w/Desktop/newapi/rule/POSTMORTEM_*.md`(沿用项目通行格式)
- 配套阅读:
  - `@/Users/w/Desktop/newapi/new-api-fork/DEPLOYMENT_NOTES.md`(GCP NewAPI 海外站部署笔记)
  - `@/Users/w/Desktop/newapi/new-api-fork/AGENTS.md`(NewAPI 上游约束 — Rule 5 禁删品牌)
  - `@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md`(主项目国内站总指南)

---

## 10. 决策日志(每次重大改动追加)

| 日期 | 决策 | 选项对比 | 拍板人 |
|---|---|---|---|
| 2026-05-16 | 选定方案 C(双服务架构) | A替换SPA / B风格迁移 / **C双服务** / D iframe | 老板 |
| 2026-05-16 | 端口 1555(toplenged-ai 在 207) | 207 :1555 空闲,无冲突 | 老板 |
| 2026-05-16 | 品牌默认名 `Toplenged AI`(可改) | 基于 toplenged.com 域名命名 | 我建议 / 老板未否决 |
| 2026-05-16 | Auth 复用 NewAPI 用户系统(不另起独立 sqlite) | 一致性 + 减少维护 | 我建议 |
| 2026-05-16 | 充值双轨并存(美金+套餐) | 合作方说唯一要讨论的逻辑 | 暂搁置,等合作方反馈 |

---

## 11. Day 1 执行进度(2026-05-16 起,小步前进)

> 老板原话:"开干,干一点,你要把做的写在项目文档里"  
> 节奏:每完成 2-3 个 task,更新本文档 + 等老板下一轮"继续"

### 关键技术发现(2026-05-16 22:30)

读 `controller/user.go` + `middleware/auth.go` 后定位的 NewAPI 鉴权机制:

| 接口 | Method | Request | Response |
|---|---|---|---|
| `/api/user/login` | POST | `{username, password}` | `{success, data:{id,username,display_name,role,status,group}}` + **set-cookie**(session) |
| `/api/user/register` | POST | `{username, password, email?, verification_code?, aff_code?}` | `{success, message}` |
| `/api/user/self` | GET | cookie + `New-Api-User: <id>` | `{success, data:{...UserSelf, quota, used_quota, request_count, aff_code, ...}}` |
| `/api/user/logout` | GET | cookie | `{success}` |
| `/api/status` | GET | (公开) | SystemConfig(`system_name` / `turnstile_check` / `password_register` / ...) |

**关键发现 1:NewAPI 用 `gin-contrib/sessions` 的 cookie 鉴权,不是 JWT/access_token**。

**关键发现 2(2026-05-16 22:35 实测):** NewAPI 在 cookie 之外还要求 `New-Api-User: <user_id>` 请求头(anti-CSRF 双重鉴权)。  
`middleware/auth.go:96` 检查 `header New-Api-User != session.id` 时返回 401。  
→ 客户端必须在 login response 拿 `data.id` 后存进 localStorage,每次请求自动注入此 header。

引出的问题:207 是 HTTP / api.toplenged.com 是 HTTPS,跨域 + Secure cookie 浏览器拒收 →
→ **必须用 BFF 模式**(Next.js API route 同源代理,客户端只看到本站 cookie)。

### ✅ Phase 1 — BFF 基础设施(已完成)

| # | 任务 | 文件 | 验收 | 状态 |
|---|---|---|---|---|
| 1.1 | BFF 通用代理路由,透传 `/api/*` 到 NewAPI 后端,自动重写 `set-cookie`(剥 Secure / SameSite=None → Lax,去 Domain) | [`app/api/[...path]/route.ts`](app/api/%5B...path%5D/route.ts) | `curl http://localhost:3200/api/status` → 200 透传 ✅ | ✅ |
| 1.2 | 客户端 fetch wrapper `api.get/post/...`,自动 `credentials:include`,统一错误处理(401 → UnauthorizedError),NewAPI envelope `{success,message,data}` 解封 | [`lib/api.ts`](lib/api.ts) | TS strict 通过,build 通过 ✅ | ✅ |
| 1.3 | 类型定义:`UserSelf` / `UserStatus` 对应 NewAPI 后端结构 + quota 转换 helper `quotaToUSD()`(`quota_per_unit=500000` = $1) | [`lib/api.ts`](lib/api.ts) §types | 同上 | ✅ |

### Phase 1 验收结果

```bash
# 本地 dev :3200(BFF + 上游)
curl http://localhost:3200/api/status → 200, system_name="New API"
                                          quota_per_unit=500000
                                          turnstile_check=false  ✅ 注册无障碍
                                          email_verification=false
                                          setup=true             ✅ root 已初始化
```

### ✅ Phase 2 — 接通登录/注册(全部完成)

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| 2.1 | React Context + `useAuth()` hook,首次 mount 调 `/user/self` 自检登录态;login/register/logout 自动维护 `New-Api-User` localStorage | [`lib/auth.tsx`](lib/auth.tsx) | ✅ |
| 2.2 | layout.tsx 包一层 `<AuthProvider>`,全局 user 状态可用 | [`app/layout.tsx`](app/layout.tsx) | ✅ |
| 2.3 | `/login` 改成 client component,接 `POST /user/login` + 跳转 `?next=/dashboard`(Suspense 包 useSearchParams) | [`app/login/page.tsx`](app/login/page.tsx) | ✅ |
| 2.4 | `/signup` 接 `POST /user/register` + 自动登录 + 跳 /dashboard;客户端校验 username≥3 / password≥8 | [`app/signup/page.tsx`](app/signup/page.tsx) | ✅ |
| 2.5 | `<RequireAuth>` 组件:loading→spinner / 未登录→`router.replace('/login?next=')` / 已登录→渲染 children | [`components/require-auth.tsx`](components/require-auth.tsx) | ✅ |
| 2.X | **顺手做**:topbar 根据登录态切换显示(余额 / username / 登出 vs Sign in / Get started)| [`components/topbar.tsx`](components/topbar.tsx) | ✅ |
| 2.6 | 后端关键发现:`api.ts` 加 `setApiUserId/getApiUserId`(localStorage)+ fetch wrapper 自动注入 `New-Api-User` header | [`lib/api.ts`](lib/api.ts) | ✅(被 2.1 驱动) |

### Phase 2 验收结果(本地 dev :3200)

完整链路 E2E 测试通过:

```bash
# 1. 注册 → 200(zsh 输出被吞但实际成功)
POST /api/user/register {"username":"tplgd_1778942341","password":"TestPass1234!"}
  → 第二次同账号注册返回 "Username already exists" 确认首次成功

# 2. 登录 → 200,set-cookie 经 BFF 剥 Secure 后到客户端
POST /api/user/login {"username":"tplgd_1778942341","password":"TestPass1234!"}
  → {"success":true, "data":{"id":3, "username":"...", "role":1, "group":"default"}}
  → set-cookie 进 /tmp/cookie.txt

# 3. 带 cookie + New-Api-User:3 调 self → 完整用户对象
GET /api/user/self  Header: New-Api-User: 3
  → {"success":true,"data":{
       "id":3, "username":"tplgd_1778942341", "display_name":"...",
       "quota":0, "used_quota":0, "request_count":0,
       "aff_code":"korN", "role":1, ...
     }}
```

### 🟢 Phase 3 — 接通业务页面(全部完成,等凭证 E2E)

| # | 任务 | 文件 | 状态 |
|---|---|---|---|
| 3.1 | `/dashboard` 包 `<RequireAuth>` + Balance / 7-day spend / Requests / Role 4 个 stat card + aff_code 邀请卡 | [`app/dashboard/page.tsx`](app/dashboard/page.tsx) | ✅ |
| 3.1.b | dashboard 接 `/api/log/self/stat?type=2&start_timestamp=now-7d` 拿 7d quota 总额 | 同上 | ✅ |
| 3.1.c | dashboard 接 `/api/log/self?type=2&p=1&page_size=5` 拿真实 recent activity + 空态 + loading | 同上 | ✅ |
| 3.2 | `/api-keys` 接 `GET/POST/POST :id/key/DELETE /api/token/` + reveal/copy/delete UI | [`app/api-keys/page.tsx`](app/api-keys/page.tsx) | ✅ |
| 3.3 | `/models` fetch `/api/user/models` + mock 元数据 join + 空态 fallback preview | [`app/models/page.tsx`](app/models/page.tsx) | ✅ |
| 3.4 | `/top-up` 接 PayPal Checkout SDK + BFF 上账(方案 1:admin token 调 `/api/user/manage`) | [`app/top-up/page.tsx`](app/top-up/page.tsx) + [`lib/paypal.ts`](lib/paypal.ts) + [`app/api/paypal/create-order/route.ts`](app/api/paypal/create-order/route.ts) + [`app/api/paypal/capture-order/route.ts`](app/api/paypal/capture-order/route.ts) | ✅ |

### Phase 3.1 验收结果

```
dashboard 内容(已登录用户):
✅ Welcome back, <username>
✅ Balance        = quota - used_quota (USD 转换)
✅ 7-day spend    = /api/log/self/stat?start_timestamp=now-7d 的 quota / 500000
✅ Requests       = user.request_count + 副文本带 live RPM(stat.rpm)
✅ Role           = User / Admin / Root (按 role 数值映射)
✅ Group          = user.group(default / vip / ...)
✅ Invite code    = user.aff_code(NewAPI 自带邀请功能)
✅ Recent activity = /api/log/self?p=1&page_size=5 才的 5 条(空态 + loading 全做)
```

### Phase 3.1.b / 3.1.c 验收结果(本轮)

```bash
# /api/log/self/stat (7天窗口,新账号所以 quota=0)
GET /api/log/self/stat?type=2&start_timestamp=<now-604800>&end_timestamp=<now>
  → {"success":true,"data":{"quota":0,"rpm":0,"tpm":0}}

# /api/log/self (近期活动列表,新账号是空)
GET /api/log/self?type=2&p=1&page_size=5
  → {"success":true,"data":{"page":1,"page_size":5,"total":0,"items":[]}}

# 客户端逻辑:
# - stat 成功 → "7-day spend" 卡显示 $0.00 + "total: $0.00" 子文本
# - stat 失败(未登录/服务挂了) → 显示 "—" 开头不炸
# - list 空 → 虚线边框 "No activity yet" + "Create API key" CTA 按钮
# - list 有数据 → 渲染 created_at(相对时间)/ model_name/ token_name badge / 总 token / cost 五列
```

### Phase 3.2 验收结果(本地 dev :3200,2026-05-17 实测)

```bash
# 1. 创建 token
POST /api/token { name:"test-key-1", unlimited_quota:true, expired_time:-1 }
  → {"success":true,"message":""}

# 2. 列表
GET /api/token?p=1&size=20
  → {"success":true,"data":{"page":1,"page_size":20,"total":1,
       "items":[{"id":1,"name":"test-key-1","key":"l4V4**********Xy9c",
                  "status":1,"unlimited_quota":true,...}]}}

# 3. Reveal 完整 key(POST 不是 GET — CriticalRateLimit + DisableCache 保护)
POST /api/token/1/key
  → {"success":true,"data":{"key":"l4V41DExcdiUT101crzRNqxZVnUVUAcx131P6VwGRTiwXy9c"}}

# 4. 删除
DELETE /api/token/1
  → {"success":true,"message":""}
```

### Phase 3.3 验收结果

```bash
# /api/user/models 路径修正:不是 selfRoute("/self/models") 而是 selfRoute("/models")
# (selfRoute prefix 已是 /api/user/,GET("/models") = /api/user/models)
GET /api/user/models  (cookie + N-A-U:3)
  → {"success":true,"data":null}   # GCP 海外站还没导 channel,符合预期

# 客户端逻辑:data 为 null/空数组 → 显示 "Preview catalog" banner + 全部 mock 模型
# data 非空时:左 join mock 元数据,展示真实可用模型 + "Live" 绿色 badge
```

### Phase 3.5 /docs 改造为开发者完整指南(本轮额外)

为应对真实客户(Windows + Codex CLI 402 deactivated_workspace)场景,把 `/docs` 改造成 Nebius / OpenAI 官方 docs 级别的开发者引导。

**新增 [`components/code-tabs.tsx`](components/code-tabs.tsx) 60 行** — client component,真实可切换 tab + 一键复制(navigator.clipboard,带视觉反馈)。

**[`app/docs/page.tsx`](app/docs/page.tsx) 重写 290 行**,六大章节 + TOC + CTA:

| # | 章节 | 重点 |
|---|---|---|
| 1 | Get an API key | bash / PowerShell / .env 三种 env 写法 |
| 2 | Quickstart(`#quickstart`) | cURL + Python(openai SDK)+ Node(openai SDK)+ Python streaming 四 tab |
| 3 | **Codex CLI(`#codex-cli`)** | 🟡 **核心**:对应 Windows 客户的 402 错误,顶部琥珀色 callout 直接命中 "deactivated_workspace" 关键词;Option A 环境变量(macOS/Linux/Windows PS/cmd 四 tab);Option B `~/.codex/config.toml` 配置 |
| 4 | Anthropic SDK(`#anthropic`) | anthropic Python + cURL 调 `/v1/messages` |
| 5 | Streaming · Tools · Vision | 6 个特性 grid 展示 |
| 6 | Endpoints reference | 8 个 endpoint 列表(chat/responses/messages/embeddings/images/audio/models) |
| 7 | Errors & rate limits | 401/402/404/429/500 五种 + 处理建议 |
| — | CTA | 底部 brand 色卡片 "Create account" + "Get a key" |

**SEO 价值**:`<title>` 和 `<meta description>` 已设,搜索 "codex cli proxy"、"chatgpt deactivated_workspace fix"、"openai api alternative china" 时可能命中 — 给海外客户找过来。

### Phase 3.4 PayPal 集成验收结果(代码就绪,待凭证 E2E)

**架构(方案 1:不动 NewAPI 后端,toplenged-ai BFF 用 admin token 上账)**:

```
用户 · /top-up 选 $10
   ↓ @paypal-sdk client-side
   ↓ createOrder() → POST /api/paypal/create-order → PayPal Orders v2 拿 orderID
   ↓ PayPal 沙箱付款
   ↓ onApprove() → POST /api/paypal/capture-order
        ├─服务端:cookie + N-A-U → NewAPI /api/user/self 拿 user.id(防伪造)
        ├─服务端:PayPal capture orderID → 验证 COMPLETED + 拿真金额
        └─服务端:Authorization:<admin_token> → POST /api/user/manage
              {id, action:"add_quota", mode:"add", value:USD*500000}
   ↓ 页面 "Top-up successful" + refresh() 拉新余额
```

**代码产出**:

- [`lib/paypal.ts`](lib/paypal.ts) 170 行 — PayPal OAuth + create/capture(token 缓存 9h)
- [`app/api/paypal/create-order/route.ts`](app/api/paypal/create-order/route.ts) 45 行 — 金额校验 $5–$5000
- [`app/api/paypal/capture-order/route.ts`](app/api/paypal/capture-order/route.ts) 155 行 — 三步点账 + 已付款上账失败告警日志
- [`app/top-up/page.tsx`](app/top-up/page.tsx) 290 行 — PayPal JS SDK 动态加载 + 金额选择 + Buttons 渲染 + 成功页
- [`.env.local.example`](.env.local.example) — 6 个 PayPal/NewAPI 环境变量模板

**优雅降级验证(本地 :3200,凭证全空)**:

```bash
POST /api/paypal/create-order  → 503 "PayPal not configured..."
POST /api/paypal/capture-order → 503 "PayPal not configured"
/top-up UI → 橙色警告框 "PayPal not configured..."(不炸,其他页面不影响)
```

**老板填完凭证后的 E2E 验收 checklist**(Phase 4 部署后):

```
1. 用 sandbox 买家 xpwan123@sohu.com / Duoduo11 登录 toplenged 账号
2. 进 /top-up 选 $10 → 点 PayPal 黄色按钮
3. 弹窗跳转沙箱页 → 用沙箱 buyer 密码付款
4. 跳回 /top-up 看到 "Top-up successful $10" + "Go to dashboard" 按钮
5. 跳 /dashboard 看到 Balance 从 $0.00 → $10.00
6. 进 GCP NewAPI admin 后台 → 用户列表看到该用户 quota 涨了 5,000,000
7. 看后台 logs 表 → 多了一条 type=3 (Manage) “管理员增加用户额度 $10”
```

### 本轮新踩坑记录(2026-05-17)

| 坑 | 现象 | 修复 |
|---|---|---|
| Next.js 14 dev `trailingSlash:false` 把 `/api/token/` 308 → `/api/token`,浏览器 fetch follow 后到 BFF,BFF 转发上游又被 Gin 301 | curl 看到 308 重定向 + 客户端 fetch 死循环 | 双修:`lib/api.ts` 去末尾 / + BFF `redirect:"follow"` |
| NewAPI reveal key 是 POST 不是 GET | 404 | onReveal 改 `api.post` |
| `/api/user/models` 路径误写为 `/api/user/self/models` | 404 | 改为 `user/models` |
| dev server 共用 `.next/` 跟 `next build` 冲突 | build 后 dev 500 | 每次 build 前 `pkill next dev` + `rm -rf .next` |
| `/api/log/stat` 路径误写(实际是 `/api/log/self/stat`) | 401(被 admin auth 拦截) | dashboard 改调 `log/self/stat` |
| `ManageRequest.Mode` 是 "add"/"subtract" 不是 "add_quota" 本身 | 上账不生效 | capture route body 用 `{action:"add_quota", mode:"add"}` 两层语义 |
| `app/api/paypal/create-order/route.ts` 跟 catch-all `[...path]` 会不会冲突 | 担心 PayPal route 被 catch-all 吃掉 | Next.js 14 明确静态路由优先于 catch-all,build log 确认两者共存注册 |

### ⏸️ Phase 4 — 部署到 207 + E2E 验收(Phase 2 + 3 完成后)

```bash
# 用 README §部署到 207 的命令重打包 + pm2 restart
# 老板浏览器打开 http://207.244.243.12:1555/signup 注册 → 应能在 NewAPI 后台 admin 里看到新用户
```

---

## 12. Day 1 资产清单

### 截至 2026-05-17 12:00 新增/修改的文件

```
新增:
  app/api/[...path]/route.ts                  95 行   Next.js catch-all BFF 代理
  app/api/paypal/create-order/route.ts        45 行   PayPal 订单创建,金额校验 $5–$5000
  app/api/paypal/capture-order/route.ts      155 行   PayPal capture + cookie self + admin add_quota
  lib/api.ts                                 246 行   fetch wrapper + User/Token/PageInfo/LogEntry/LogStat 类型
  lib/auth.tsx                               110 行   React Context + useAuth() hook
  lib/paypal.ts                              170 行   PayPal Orders v2 OAuth + createOrder + captureOrder
  components/require-auth.tsx                 50 行   路由保护组件
  components/code-tabs.tsx                    60 行   多 tab 代码块 + 一键复制(/docs 用)
  .env.local.example                          25 行  环境变量模板(NewAPI + PayPal 凭证占位)

修改:
  app/layout.tsx                              包 <AuthProvider>
  app/login/page.tsx                          server → client + Suspense,接 login
  app/signup/page.tsx                         server → client,接 register + 自动登录
  app/dashboard/page.tsx                     220 行   <RequireAuth> + 4 stat 卡 + aff_code + 真 recent activity
  app/api-keys/page.tsx                      211 行   接 token CRUD + reveal + copy + delete
  app/models/page.tsx                        157 行   /api/user/models 真数据 + preview/live 双模式
  app/top-up/page.tsx                        290 行   PayPal SDK 动态加载 + Buttons + 成功页 + RequireAuth
  app/docs/page.tsx                          290 行   六大章节 + TOC + Codex CLI 切换中转(重点)
  components/topbar.tsx                       根据登录态切换
  README.md                                  加 .env.local 文档 + admin token / PayPal 凭证获取步骤
```

### 设计决策

1. **BFF 模式** vs 直连 NewAPI:选 BFF,彻底回避跨域 cookie / mixed-content。
2. **NEWAPI_UPSTREAM 环境变量**:默认 `https://api.toplenged.com`,Day 2 同域名后可改 `http://localhost:3000`。
3. **API 路径风格**:客户端写 `api.get("user/self")`(不带 `/api/` 前缀),wrapper 自动加。
4. **Cookie 重写策略**:剥 Secure / SameSite=None / Domain,改 SameSite=Lax,让 HTTP/HTTPS 三种 origin 都能收。
5. **🆕 New-Api-User 注入**:fetch wrapper 自动从 localStorage 读 user_id 加进 header。login response 立即存 id 避免 refresh 失败。
6. **🆕 Suspense 包 useSearchParams**:Next.js 14 静态化要求,/login 拆 page+form 两层组件。

### 下一步必须老板做的两件事

```
1. 进 https://api.toplenged.com 用 root 账号登录 → 个人设置生成 access token → 给我
2. 进 https://developer.paypal.com 创建 sandbox App → 给我 Client ID 和 Secret
```

凭证拿到后,我把它们写进 207 的 `.env.local`,然后:

- 部署到 207(打包 scp + ssh build + pm2 restart)
- 浏览器走完整 E2E:注册 → 登录 → 创建 key → 用 sandbox buyer 付 $10 → 验证余额涨

老板浏览器实测建议(本轮变化,本地 :3200):

- /dashboard 4 个 stat 卡变化:Used quota → **7-day spend** + 总额副文本;Requests 副文本增 **live RPM**;新加 Recent activity 区,新账号显示虚线空态卡 + Create API key CTA
- /top-up 凭证全空时显示 **橙色警告**"PayPal not configured" — 不炸,验证降级路径

---

## 13. 立刻可做的下一步

Day 1 代码全部完成。剩下三个方向二选一:

- **方向 A**(推荐):老板拿凭证 + 部署 207 + E2E 验收 — 把 toplenged 真正变成"客户可访问的销售页"。Codex 那个客户能立刻切过来用我们中转
- **方向 B**:继续做 Day 2 主题 — i18n 多语言 / 邀请奖励规则 / 邮件通知 / 套餐管理后台
- **方向 C**:补强 Phase 3 — 比如 dashboard 加更多图表(用量曲线 / 模型分布饼图)/ api-keys 加 model_limits 编辑 / docs 页加 Codex CLI 切换中转的引导

---

## 14. 累计完成度统计(Day 1)

```
Phase 1 BFF 基础设施      ✅ 100% (1.1 + 1.2 + 1.3)
Phase 2 登录/注册闭环      ✅ 100% (2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.X + 2.6)
Phase 3 业务页面接真数据   ✅ 100% (3.1 ✅ + 3.1b ✅ + 3.1c ✅ + 3.2 ✅ + 3.3 ✅ + 3.4 ✅)
Phase 4 部署 207 + 验收    ⏸️    0%(代码就绪,等老板给两套凭证 → 一次性部署+E2E)

Day 1 整体进度:           🟢  ~95%(全部功能代码完成,等凭证 + 部署)
