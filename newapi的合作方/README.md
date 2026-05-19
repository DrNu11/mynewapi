# Toplenged AI — Token Factory 风格的海外 AI API 站

> 仿 [Nebius Token Factory](https://tokenfactory.nebius.com) 风格,
> 仅卖 token,不卖 GPU,简化为 5-8 个核心页面。
> 后端接 GCP 上的 NewAPI(`https://api.toplenged.com`)。

## 在线访问

- **生产骨架(207 VPS)**: <http://207.244.243.12:1555/>
- **本地开发**: `npm run dev` → <http://localhost:3200/>

## 快速启动(本地开发)

```bash
npm install
cp .env.local.example .env.local  # 按里面注释填写凭证(可先全空,UI 会优雅降级)
npm run dev                       # 默认 :3200
PORT=4000 npm run dev             # 改端口

# 浏览器打开
open http://localhost:3200
```

## 环境变量(`.env.local`)

| 变量 | 必填? | 说明 |
|---|---|---|
| `NEWAPI_UPSTREAM` | ✅ | NewAPI 后端,默认 `https://api.toplenged.com` |
| `NEWAPI_ADMIN_ACCESS_TOKEN` | ⚠️ 仅 PayPal 上账 | NewAPI root 账号生成的"系统访问令牌",用于 add_quota |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | ⚠️ 仅 PayPal | developer.paypal.com 沙箱 App 凭证 |
| `PAYPAL_ENV` | ⚠️ 仅 PayPal | `sandbox`(测试)或 `live`(正式) |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | ⚠️ 仅 PayPal | 同 `PAYPAL_CLIENT_ID`,前端 SDK 加载用 |
| `NEXT_PUBLIC_PAYPAL_ENV` | ⚠️ 仅 PayPal | 同 `PAYPAL_ENV` |
| `PORT` | — | 本地开发默认 3200;207 pm2 启动时强制 1555 |

凭证为空时:登录注册/dashboard/api-keys/models 全部正常,**只有 PayPal 充值按钮显示 "PayPal not configured" 提示**,其它功能不受影响。

### 获取 NewAPI Admin Access Token(PayPal 上账依赖)

1. 浏览器以 root 账号登录 `https://api.toplenged.com`
2. 右上角头像 → 个人设置 → 找到 **"系统访问令牌 / Access Token"**
3. 点 **"生成"** → 复制返回的 64 字符令牌
4. 填入 `.env.local` 的 `NEWAPI_ADMIN_ACCESS_TOKEN=`

⚠️ **极敏感** — 等同 root 权限。**绝对不能** commit 进 git,**绝对不能** 放进 `NEXT_PUBLIC_*`。

### 获取 PayPal Sandbox 凭证

1. 登录 <https://developer.paypal.com> → Dashboard → **Apps & Credentials**
2. **Sandbox** 标签 → **Create App**(给个名字如 `Toplenged-AI-Sandbox`)
3. 创建后页面会显示 **Client ID** 和 **Secret**(Secret 点 "Show" 才显示)
4. 同时填:
   - `PAYPAL_CLIENT_ID=<Client ID>`
   - `PAYPAL_CLIENT_SECRET=<Secret>`
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID=<Client ID>`(同一个值)
5. 切到生产:换成 **Live** 标签的 App 凭证,把 `PAYPAL_ENV=live` 即可

测试用买家账号(已配,在 PayPal 沙箱里):`xpwan123@sohu.com / Duoduo11`

## 部署到 207 VPS(端口 1555,pm2 托管)

```bash
# 1. 本地打包(排除 node_modules / .next / .git)
rm -rf /tmp/toplenged-ai
cp -R "/Users/w/Desktop/newapi/newapi的合作方" /tmp/toplenged-ai
rm -rf /tmp/toplenged-ai/node_modules /tmp/toplenged-ai/.next /tmp/toplenged-ai/.git
tar -czf /tmp/toplenged-ai.tar.gz -C /tmp toplenged-ai

# 2. 上传代码包(.env.local 单独 scp,避免覆盖 207 上已配好的真凭证)
scp /tmp/toplenged-ai.tar.gz root@207.244.243.12:/tmp/

# 2.1 首次部署 / 凭证变更时,从本地传 .env.local 上去
#     ⚠️ 仅当 207 上不存在 .env.local 时才传 — 否则你会覆盖生产凭证!
# scp .env.local root@207.244.243.12:/opt/toplenged-ai/.env.local
# ssh root@207.244.243.12 'chmod 600 /opt/toplenged-ai/.env.local'

# 3. 解压 + 重 build + 重启(保留 .env.local 不动)
ssh root@207.244.243.12 'set -e
  # 备份现有 .env.local
  cp /opt/toplenged-ai/.env.local /tmp/toplenged-env.bak 2>/dev/null || true
  rm -rf /opt/toplenged-ai
  tar -xzf /tmp/toplenged-ai.tar.gz -C /opt/
  # 还原 .env.local
  cp /tmp/toplenged-env.bak /opt/toplenged-ai/.env.local 2>/dev/null || true
  cd /opt/toplenged-ai && npm install --no-audit --no-fund && npm run build
  pm2 delete toplenged-ai 2>/dev/null
  PORT=1555 pm2 start npm --name toplenged-ai --update-env -- run start
  pm2 save
'

# 4. 验证
curl -sIm 10 http://207.244.243.12:1555/ | head -3
```

**首次部署 207 时,先 SSH 上去手动写 `.env.local`**(避免凭证传输痕迹):

```bash
ssh root@207.244.243.12
nano /opt/toplenged-ai/.env.local      # 粘贴并填好所有变量
chmod 600 /opt/toplenged-ai/.env.local # 仅 root 可读
exit
```

## 207 上的进程清单(共存,互不冲突)

| pm2 名 | 端口 | 角色 |
|---|---|---|
| `nassa-cards` | 3100 | 国内卡密激活站(`card.nassaapi.xyz`) |
| `model-health-check` | — | 监控 NewAPI 上游模型健康 |
| **`toplenged-ai`** | **1555** | **本项目(海外 token 销售骨架)** |

## 目录结构

```
app/
├── layout.tsx           主布局(Sidebar + Topbar)
├── page.tsx             Landing(Hero + 模型预览 + CTA)
├── models/page.tsx      模型列表(8-9 个,3 收费 + 4-5 免费)
├── pricing/page.tsx     套餐(包日/包周/包月)+ 余额充值统一展示
├── top-up/page.tsx      独立充值页(左菜单顶部入口,合作方明确要求)
├── dashboard/page.tsx   登录后:余额 / 用量 / 最近调用
├── api-keys/page.tsx    sk-xxx 生成/撤销
├── docs/page.tsx        Quickstart + curl 示例
├── login/page.tsx       登录
└── signup/page.tsx      注册

components/
├── sidebar.tsx          左菜单(Top-up 在顶部)
├── topbar.tsx           顶导航(品牌 + 用户菜单)
├── model-card.tsx       模型卡片(name + provider logo + tier + price)
├── plan-card.tsx        套餐卡片(D/W/M)
└── ui/                  shadcn/ui 基础组件(button / card / badge)

lib/
├── utils.ts             cn() helper
├── models.ts            mock 模型数据(可换成真接口)
└── plans.ts             mock 套餐数据
```

## 与现有项目的关系

| 项目 | 位置 | 角色 |
|---|---|---|
| **NewAPI(海外)** | `34.135.9.30:3000` 反代到 `https://api.toplenged.com` | 后端 API 网关 |
| **Toplenged AI(本项目)** | `localhost:3200` | 前台门店(本仓库) |
| **NewAPI(国内)** | `https://api.nassaapi.xyz` | 国内主站(老板自营) |
| **nassa-cards** | `https://card.nassaapi.xyz` | 国内卡密站(参考实现) |

## 关键决策(老板拍板的)

| 项目 | 默认值 | 备注 |
|---|---|---|
| 品牌名 | `Toplenged AI` | 改 `app/layout.tsx` 的 `brand` 字符串即可 |
| Auth | mock 登录(localStorage) | 后期接 NewAPI 用户系统(`/api/user/login`) |
| 充值 | 双轨(美金 + 套餐) | 合作方说唯一要讨论的点,先并存等他们看完决定 |
| 支付 | PayPal 占位按钮 | 沙箱账号:`xpwan123@sohu.com / Duoduo11`(用沙箱跑通后接生产) |

## 后续待办

### 🔴 必做(从骨架 → MVP)

- [ ] 接 NewAPI:登录 / 注册(`POST /api/user/login`)
- [ ] 接 NewAPI:获取余额 / 用量
- [ ] 接 NewAPI:生成 / 撤销 API key(`POST /api/token/`)
- [ ] PayPal 沙箱支付:`/top-up` 页 → 充值成功 → 给 NewAPI 加 quota
- [ ] 真实模型清单(从 NewAPI `/api/models` 拉)
- [ ] i18n:即使只英文,也用 `next-intl` 起结构,后期加多语言

### 🟡 后续优化

- [ ] Auth provider:Google / GitHub OAuth
- [ ] 邮件通知:充值 / 用量预警
- [ ] 套餐管理后台
- [ ] Crypto 支付(USDT)

### 🔵 海外合规

- [ ] Privacy Policy + Terms of Service 页(鬼佬必看)
- [ ] Cookie consent banner
- [ ] GDPR data export

## 设计参考

参考但不抄:

- 配色 / 圆角 / 间距 抄 shadcn/ui 默认(简洁现代,鬼佬熟悉)
- 模型卡片布局参考 <https://tokenfactory.nebius.com/models>
- 计费页布局参考 OpenAI / Anthropic 官方定价页
- Sidebar 布局参考 Vercel Dashboard(左菜单 + 顶导航)
