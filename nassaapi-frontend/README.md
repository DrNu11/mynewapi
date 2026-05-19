# nassaapi 中转站独立前端

基于 **Next.js 14 + TypeScript + Tailwind CSS** 构建的现代化营销/落地页，作为 nassaapi.xyz 的对外门面，把客户从落地页引到 `api.nassaapi.xyz`（New API 后台）登录注册。

## 这是什么

一个**独立的前端项目**，不依赖 New API 源码，只通过链接把用户引导到现有的 New API 后台。优势：

- ✅ 视觉品牌完全可控（不动 New API 一行代码）
- ✅ 可以单独部署到 Cloudflare Pages / Vercel / Netlify
- ✅ 独立迭代，不影响 New API 升级
- ✅ AGPL 合规：保留 "Powered by New API" + 修改源码链接

## 快速开始

```bash
# 1. 进入目录
cd /Users/w/Desktop/newapi/nassaapi-frontend

# 2. 安装依赖（首次运行需要）
npm install
# 或：bun install / pnpm install / yarn

# 3. 本地开发
npm run dev
# 打开 http://localhost:3000

# 4. 生产构建
npm run build
npm run start
```

## 部署方式（3 选 1）

### A. Cloudflare Pages（推荐，免费、和你 nassaapi.xyz 同生态）

1. 把这个目录推到 GitHub
2. Cloudflare Dashboard → Pages → Create project → Connect to Git
3. Build command: `npm run build`，Output: `.next`
4. 自定义域名: `nassaapi.xyz`（把 nassaapi.xyz 的解析改到 CF Pages，把现在指 New API 的解析改到 `api.nassaapi.xyz` 子域）
5. 环境变量：无需

### B. Vercel

```bash
npm install -g vercel
vercel
```

绑定域名 `nassaapi.xyz`。

### C. 自托管到你美国 VPS

```bash
npm run build
# 用 PM2 守护
pm2 start npm --name nassaapi-front -- run start
```

然后 nginx 反代 `nassaapi.xyz` 80/443 → `localhost:3000`，把现在指 New API 的解析改到 `api.nassaapi.xyz` 子域上 reverse-proxy 到 `localhost:3000`（New API 容器）。

## 域名拆分建议

```
nassaapi.xyz       → 这个落地页（营销门面）
api.nassaapi.xyz   → 现在的 New API 后台（保持不动）
```

把这个域名分流配在 Cloudflare DNS 里就行。

## 自定义内容

**绝大多数文字、品牌、定价、模型列表都集中在一个文件**：

```
lib/constants.ts
```

改这一个文件就能改：

- 品牌名、域名、邮箱
- 套餐定价（4 档：Trial / Standard / Pro / Team）
- 主页特性卡片
- 模型展示
- FAQ 列表
- AGPL 合规链接（**`modifiedSourceCode.href` 必须改成你 fork 后的 GitHub repo**）

需要改 UI 风格的话改：

- `tailwind.config.ts` — 主色、字体
- `app/globals.css` — 全局样式
- `components/*.tsx` — 各个区块组件

## 项目结构

```
nassaapi-frontend/
├── app/
│   ├── layout.tsx          # 根布局 + SEO meta
│   ├── page.tsx            # 主页（Hero + Features + Models + Pricing + FAQ + CTA）
│   ├── pricing/page.tsx    # 独立定价页
│   └── globals.css         # 全局样式 + Tailwind 入口
├── components/
│   ├── header.tsx          # 顶栏导航 + 注册/登录入口
│   ├── hero.tsx            # 主视觉 + 代码示例卡
│   ├── features.tsx        # 6 个特性卡片
│   ├── models-grid.tsx     # 模型展示网格
│   ├── pricing-cards.tsx   # 4 档套餐卡片
│   ├── faq.tsx             # 折叠式 FAQ
│   ├── cta.tsx             # 底部行动召唤
│   └── footer.tsx          # 页脚 + AGPL 合规链接
├── lib/
│   ├── constants.ts        # ⭐ 所有可改文案/数据集中在这里
│   └── utils.ts            # cn 工具
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.mjs
```

## ⚠️ AGPL 合规重要事项

你后端跑的 New API 是 **AGPL-3.0** 协议。这意味着：

1. **必须保留对原项目的署名**
   `components/footer.tsx` 里的 "Powered by New API" 链接 **不能删**

2. **必须公开你修改后的源码**
   你已经改了后端（`model/log.go` 删除了 `is_model_mapped` / `upstream_model_name` 字段）。AGPL §13 要求：

   - 把你 fork 后的 New API 完整源码 push 到一个**公开**的 GitHub repo
   - 把这个 repo 链接填到 `lib/constants.ts` 的 `SITE.modifiedSourceCode.href`
   - footer 的链接生效后，客户访问站点就能拿到源码 → 合规

   现在 `constants.ts` 里这条是 `https://github.com/your-username/new-api-fork`，**你必须把它改成你真实的 fork 地址**。

3. **不要删 footer 里的 "Licensed under AGPL-3.0" 字样**

只要这三条做到，你这套独立前端 + 修改过的后端组合就是 AGPL 合规的。

## ⭐ 已包含功能：兑换码快速生成 + 一键短链

后台地址：`/admin/redeem`（HTTP Basic Auth 保护）

### 解决的痛点

```text
旧流程：登 New API 后台 → 输金额 → 创建 → 复制 → 粘贴给客户  （5 步搬砖）
新流程：登 /admin/redeem → 输金额 → 点生成 → 复制短链发客户   （3 步，且短链好发）
```

### 工作流

1. **你**：访问 `/admin/redeem`，填金额（USD）+ 数量 + 备注，点击生成
2. **系统**：自动调 New API 创建对应金额的兑换码 → 生成 8 位随机短 ID → 写入本地 SQLite
3. **你**：复制短链（格式 `https://nassaapi.xyz/r/abc12345`）发给客户
4. **客户**：点链接，看到大字兑换码 + 复制按钮 + 详细兑换教程
5. **后台**：自动记录访问次数、首次查看时间、客户标识等

### 配置步骤

1. **复制环境变量模板**

   ```bash
   cp .env.example .env.local
   ```

2. **在 New API 后台拿管理员 token**
   - 登录 `api.nassaapi.xyz`，用管理员账号（Nassa11111）
   - 进入「个人设置」→ 找到「系统访问令牌 / Access Token」
   - 点生成，复制
   - 粘到 `.env.local` 的 `NEWAPI_ADMIN_TOKEN=`

3. **填管理员用户 ID**
   - 在 New API 后台「用户管理」找到自己 → 看 ID 列（通常 admin 是 1）
   - 填到 `.env.local` 的 `NEWAPI_ADMIN_USER_ID=`

4. **设管理后台密码**
   - `.env.local` 里 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 改成你自己的
   - 这个是**保护 `/admin/*` 路径**用的，不是 New API 的密码

5. **重启 dev server**

   ```bash
   npm run dev
   ```

6. **访问** `http://localhost:3000/admin/redeem`，浏览器会弹密码框，填上面设的用户名密码

### 数据存储

- SQLite 本地数据库：`./data/redemptions.db`
- 每条短链记录：兑换码、金额、备注、客户标识、访问次数、首次查看时间、状态
- 已加入 `.gitignore`，不会被 commit

### 部署注意事项

| 部署平台 | 是否能用 |
|---|---|
| 自己 VPS（PM2 / Docker） | ✅ 完美适配，记得给 `data/` 目录持久化 |
| Vercel | ⚠️ Serverless 文件系统不持久 — 需改 D1 / Postgres |
| Cloudflare Pages | ⚠️ 同上 — 需改 Cloudflare D1 |
| Netlify | ⚠️ 同上 |

**强烈建议先在你自己美国 VPS 上跑**，简单可靠，数据归你。后期再考虑迁移。

---

## 下一步可加的功能

按价值排序：

1. **完整自助商城** — 加 Stripe / Creem / 支付宝 webhook，客户自助下单 → 自动发码 → 24/7 不用你管
2. **`/tools` 子站** — 工作场景工具（简历优化、面试题分析等），单次/月卡收费
3. **状态页** `/status` — 实时显示模型可用性
4. **客户独立账单页** — 不让客户进 New API 后台，写个只显示用量+余额的小页面
5. **批量发码 + 邮件群发** — 给一批邮箱地址，一键各发一张码

告诉我哪个最先要。
