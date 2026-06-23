# 项目概览

## 新电脑快速上手

```bash
git clone https://github.com/DrNu11/card.git
cd card
npm install

# 恢复 SSH 密钥
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cp ssh-backup/* ~/.ssh/
chmod 600 ~/.ssh/id_ed25519 ~/.ssh/gcp_instance ~/.ssh/google_compute_engine ~/.ssh/tosell_gcp_ed25519

# 测试连接
ssh root@207.244.243.12 "echo OK"

# 启动开发服务器
npm run dev
```

`.env.local` 和 SSH 密钥已包含在仓库中（私有仓库）。新电脑 `git pull` 即可同步最新代码。

如需完整 monorepo：

```bash
git clone https://github.com/DrNu11/mynewapi.git
cd mynewapi
git checkout fix/allow-ips-deepseek-light-points
```

---

本项目是 `nassa-cards` 卡密激活与 OpenAI 兼容代理系统。客户输入卡密后，系统为其生成 NewAPI token，并返回可在 OpenAI 兼容客户端、Claude Code、Cursor、Codex CLI 等工具中使用的 API Key 与 Base URL。

核心能力：

- 卡密激活系统：客户通过 `/api/redeem` 激活卡密。
- API Key 生成：后端调用 NewAPI 管理 API 创建 token，并取回 `sk-...`。
- OpenAI 兼容 `/v1` 代理：`app/v1/[...path]/route.ts` 对外提供 OpenAI/Anthropic 兼容代理入口。
- DeepSeek / GPT / Claude 套餐：通过 `category` 区分模型权限、卡密前缀、默认 RPH 和 Base URL 后缀。
- 轻度月卡点数制：DeepSeek `30d_light` 按模型权重点数统计 24h / 7d / lifetime 用量。
- 好评 +55 RPH：仅普通 DeepSeek 卡支持，后台和 CLI 可加成/撤销。
- 视频生成：`/video` 图生视频工作台，接入 MiniMax / 海螺视频上游。
- 邀请奖励：邀请成功并完成视频任务后，给邀请人增加 `video_bonus_quota`。
- 管理后台：批量生成卡密、筛选卡密、禁用/启用、号池、好评加成、邀请审核、审计查看。
- 审计日志：`audit.db` 记录请求与响应摘要、可疑关键词、review 状态。

# 技术栈

以当前 `package.json` 为准：

- Next.js `14.2.13`
- TypeScript `^5.6.2`
- React / React DOM `^18.3.1`
- SQLite：`better-sqlite3`
- MySQL：`mysql2`，用于可选直连 NewAPI 数据库
- Tailwind CSS / PostCSS / Autoprefixer
- lucide-react
- Vitest `^4.1.6`
- tsx scripts：`tsx scripts/card-admin-cli.ts`
- PM2：不在 `package.json` 依赖中，但 `deploy.sh` 使用 `pm2 restart nassa-cards --update-env`
- NewAPI：作为外部管理 API 和 `/v1` 上游，不是 npm 包

# 目录结构

- `app/`：Next.js App Router 页面与 API 路由。
- `app/v1/[...path]/route.ts`：OpenAI 兼容代理核心入口，负责鉴权、模型权限、RPH、点数限制、审计、转发和响应流处理。
- `app/admin/`：管理后台页面，包括卡密列表、批量生成、禁用、号池、好评 +55、邀请审核入口。
- `app/result/`：客户激活结果页，展示 API Key、Base URL、套餐、模型、用量等信息。
- `app/api/`：业务 API，包括 redeem、renew、usage、card-info、video、invite、admin、audit。
- `lib/`：核心业务库，包含 DB、套餐、分类、NewAPI、审计、视频、邀请奖励、限流等。
- `lib/db.ts`：SQLite schema、迁移、cards/request_logs/video/invite/renewal 操作、RPH 与轻度月卡点数统计。
- `lib/plans.ts`：套餐定义，包括 `0.5d`、`1d`、`7d`、`30d`、`30d_light`、`30d-unlimited` 和自定义天数。
- `lib/categories.ts`：DeepSeek / GPT / Claude 分类、前缀、模型列表、默认 RPH、Base URL 后缀。
- `scripts/`：本地管理脚本。当前实际存在 `scripts/card-admin-cli.ts`；`package.json` 声明了 `gen-cards`，但当前未发现 `scripts/gen-cards.ts`。
- `tests / *.test.ts`：测试文件与源码同目录，当前在 `lib/*.test.ts`。

# 核心数据模型

主库是 SQLite，默认路径由 `DB_PATH` 控制，否则为 `data/cards.db`。不要把数据库内容复制到文档、提交或日志中。

`cards` 表核心字段：

- `code`：卡密明文，唯一。
- `sk_key`：业务文档中的 API Key，对应实际字段 `newapi_token_key`。不要输出真实值。
- `category`：`deepseek` / `gpt` / `claude`，老卡可能为 `NULL`。
- `plan`：套餐 ID，例如 `1d`、`7d`、`30d`、`30d_light`。
- `status`：`unused` / `activating` / `activated` / `expired` / `disabled`。
- `rph`：基础每小时请求数上限，`0` 表示不限。
- `rph_bonus`：RPH 加成值，当前好评奖励固定为 `55`。
- `rph_bonus_reason`：加成原因，当前好评为 `good_review`。
- `rph_bonus_at`：加成时间。
- `video_quota`：基础视频生成次数，默认 `1`。
- `video_bonus_quota`：邀请奖励获得的额外视频次数。
- `activated_at`：激活时间。
- `expires_at`：到期时间；永不过期套餐可为 `NULL`。
- `newapi_token_id`：NewAPI token ID。

相关表：

- `request_logs`：`/v1` 请求预占、状态、模型记录，用于 RPH 和轻度月卡点数统计。
- `renewals`：续费链路。
- `video_tasks`：视频任务。
- `video_create_operations`：视频创建幂等操作。
- `video_quota_reservations`：视频额度预占。
- `invite_links` / `invite_visits` / `invite_attributions` / `invite_redemptions` / `invite_reward_ledger`：邀请奖励链路。
- `admin_sessions`：后台登录 session。
- `rate_limit`：简单固定窗口限流。

# 套餐系统

套餐在 `lib/plans.ts` 定义，分类在 `lib/categories.ts` 定义。

分类：

- DeepSeek 普通卡：`category = deepseek`，前缀 `DE`，默认模型 `deepseek-v4-flash,deepseek-v4-pro`，默认 RPH `500`。
- GPT 套餐：`category = gpt`，前缀 `GP`，默认 RPH `400`，支持 Codex 相关模型展示。
- Claude 套餐：`category = claude`，前缀 `CL`，默认 RPH `60`，Claude Code 的 Base URL 后缀为空，避免 `/v1/v1/messages`。

套餐：

- `0.5d`：12 小时体验。
- `1d`：1 天畅用。
- `7d`：7 天高速。
- `30d`：30 天高速。
- `30d_light`：DeepSeek 轻度月卡。
- `30d-unlimited`：内部 GPT 尊享套餐，`$2000` 额度、不限 RPH、不过期。
- 自定义天数：后台 `custom_days` 可生成 `<N>d`，最小 `0.04` 天，最大 `3650` 天。

RPH 限制：

- 生成卡密时，`plan.rphOverride` 优先，否则使用 `category.defaultRPH`。
- `/v1` 实际限流使用 `getEffectiveRph(card)`。
- `rph = 0` 表示不限每小时请求。

DeepSeek 轻度月卡 `30d_light`：

- 30 天有效。
- 近 24 小时上限 `2000` 点。
- 近 7 天上限 `10000` 点。
- lifetime 总量上限 `40000` 点。
- `deepseek-v4-flash` 每次 `1` 点。
- `deepseek-v4-pro` 每次 `3` 点。
- 产品展示层不显示每小时限制；代码里 `/v1` 仍统一读取卡行 `rph` 做防滥用限流，轻度月卡不叠加好评 RPH。
- 不支持好评 `+55 RPH`。

# /v1 代理逻辑

核心文件：`app/v1/[...path]/route.ts`。

请求流程：

1. 读取认证头：
   - OpenAI 风格：`Authorization: Bearer ...`
   - Anthropic 风格：`x-api-key`
2. 使用 `getCardByTokenKey(sk)` 从 `cards.newapi_token_key` 查卡。
3. 校验卡状态：
   - 过期或 `expires_at <= now` 返回 403。
   - `disabled` 返回 403。
   - 非 `activated` 返回 403。
4. 读取请求体并解析 `model`。
5. 对部分路径做请求规范化：
   - `/v1/chat/completions`：`normalizeMessages`
   - `/v1/responses`：`normalizeResponsesInput`
6. 模型权限检查：
   - 有 `category` 的卡用 `modelsForCategory(category)`。
   - 老卡用 `legacyModels()`。
   - 不在套餐列表内直接返回 `model_not_available`。
7. 1 天卡额度保护：
   - DeepSeek：每日额度保护，北京时间 00:00 重置。
   - Claude / GPT：从激活起累计额度保护。
   - 用 `getTokenUsageQuotaSince()` 查询 NewAPI logs 表。
8. 轻度月卡点数限制：
   - `countCardWeightedPoints(card.id, since)` 统计 24h / 7d / lifetime。
   - 超出返回 429。
9. RPH 限流：
   - `getEffectiveRph(card)` 得到实际 RPH。
   - `reserveCurrentHourRequest()` 在事务中先写 `request_logs`，把 in-flight 请求也计入。
   - 超限返回 429，并设置 `retry-after`。
10. 转发到 NewAPI：
   - 上游由 `NEWAPI_INTERNAL_URL`、`NEWAPI_BASE_URL` 或默认值决定。
   - 构造 `${NEWAPI_UPSTREAM}/v1/${path}`。
   - 过滤 hop-by-hop、host、cookie、Cloudflare、压缩相关 header。
11. 审计：
   - fetch 前 `insertAuditEntry()`。
   - 响应状态后更新 status。
   - 响应流结束后补写 response、tokens、duration、flagged。
12. 更新 `request_logs`：
   - 预占时 status 为 `0`。
   - 上游返回后 `updateRequestLogStatus(logId, upstream.status, requestedModel)`。

stream / non-stream 区别：

- stream 响应：按 SSE 行解析 usage/content/reasoning，注入 heartbeat，发生上游中断时返回 SSE error 和 `[DONE]`。
- non-stream 响应：flush 时解析完整 JSON，记录 content/reasoning/usage；无 SSE heartbeat。
- 两者都会经过 audit accumulator、`<think>` 剥离、model 重写和 resilient body 兜底。

错误处理：

- 鉴权失败返回 NewAPI 风格 JSON error。
- 上游 fetch 失败返回 502。
- 上游流中断时记录 audit 和 request log，stream 返回 SSE error，非 stream 尽量返回 JSON error。
- 审计失败被 try/catch 包住，不阻断主代理。

# 好评 +55 RPH

实现位置：

- `lib/db.ts`：`canUseRphBonus`、`isRphBonusEligible`、`getEffectiveRph`、`applyRphBonus`、`clearRphBonus`
- `app/api/admin/cards/[code]/route.ts`
- `scripts/card-admin-cli.ts`

规则：

- 仅普通 DeepSeek 卡支持。
- 支持 `1d` / `7d` / 普通 `30d`。
- 不支持 `30d_light`。
- 不支持 GPT / Claude。
- `rph_bonus` 固定写入 `55`。
- 重复加成不叠加，因为更新始终设置为 `55`。
- 撤销后 `rph_bonus = 0`，`rph_bonus_reason = NULL`，`rph_bonus_at = NULL`，实际 RPH 恢复基础值。
- `/v1` 实际使用 `getEffectiveRph(card)`，只在 `canUseRphBonus(card)` 为 true 时叠加。
- 续费或共享同一 `newapi_token_key` 的卡，加成/撤销会同步到相同 token key 的卡行。

# DeepSeek 轻度月卡点数制

实现位置：

- `lib/db.ts`
- `app/v1/[...path]/route.ts`
- `lib/light-monthly.test.ts`
- `scripts/card-admin-cli.ts status`

核心函数：

- `getDeepSeekLightRequestWeight(model)`
- `countCardWeightedPoints(cardId, sinceSec)`

权重：

- `deepseek-v4-flash` = `1` 点。
- `deepseek-v4-pro` = `3` 点。
- 未知模型默认 `1` 点。

统计窗口：

- 近 24 小时：`now - 24 * 3600`，上限 `2000` 点。
- 近 7 天：`now - 7 * 24 * 3600`，上限 `10000` 点。
- lifetime：从 `activated_at` 起，上限 `40000` 点。

429 条件：

- `used24h >= 2000` 返回 `deepseek_light_month_24h_limit_exceeded`。
- `used7d >= 10000` 返回 `deepseek_light_month_7d_limit_exceeded`。
- `usedTotal >= 40000` 返回 `deepseek_light_month_total_limit_exceeded`。

# 管理后台

主要文件：

- `app/admin/page.tsx`
- `app/admin/login/page.tsx`
- `app/admin/audit/page.tsx`
- `app/api/admin/cards/route.ts`
- `app/api/admin/cards/[code]/route.ts`
- `app/api/admin/invites/route.ts`
- `app/api/admin/audit/route.ts`

能力：

- 批量生成卡密：`POST /api/admin/cards`，支持分类、套餐、数量、备注、号池、NewAPI 用户 ID、自定义天数。
- 一键复制发货文案：由后台页面组合卡密、套餐、Base URL 等信息。
- 禁用卡：`PATCH /api/admin/cards/[code]`，`action = disable`，会联动 NewAPI token status。
- 启用卡：`action = enable`，恢复为 `activated` 或 `unused`。
- 号池：`pool` 字段，可设置/清除，可按 pool 筛选。
- 好评 +55：`apply_rph_bonus` / `clear_rph_bonus`。
- 审计审核：`audit.db` 日志列表、过滤、导出、单条更新 review 状态。
- 邀请审核：pending_review 记录可批准、拒绝、撤销。

# OpenClaw / 本地 CLI 计划

当前已实现本地 CLI：

- 文件：`scripts/card-admin-cli.ts`
- package script：`npm run card-admin`
- OpenClaw skill：`openclaw-skills/nassa-card-admin/SKILL.md`

命令：

- `apply-rph <CODE>`：应用好评 `+55 RPH`。
- `clear-rph <CODE>`：撤销 RPH 加成。
- `disable <CODE>`：禁用卡密，仅操作本地 SQLite。
- `status <CODE>`：查询卡密状态、RPH 或轻度月卡点数。

安全边界：

- CLI 不输出 `sk_key`。
- CLI 不操作 NewAPI、nginx、`.env`。
- CLI 不开放网络端口。
- OpenClaw skill 只调用 `npm run card-admin`。

# 视频生成模块

入口：

- 页面：`/video`
- 创建：`POST /api/video/create`
- 状态：`POST /api/video/status`
- 配额：`GET /api/video/quota`
- 操作状态：`POST /api/video/operation-status`
- Reconcile：`POST /api/internal/video/reconcile`

数据字段：

- `cards.video_quota`：基础视频次数。
- `cards.video_bonus_quota`：邀请奖励额外次数。
- `video_tasks.quota_source`：`base` 或 `invite_bonus`。
- `video_tasks.reservation_id` / `operation_id`：关联幂等操作和额度预占。

MiniMax / 海螺：

- 上游客户端在 `lib/minimax-video.ts`。
- 支持模型：`hailuo-2.3`、`hailuo-2.3-fast`。
- 支持时长：`6`、`10`。
- 支持分辨率：`768P`、`1080P`。
- 生产通过 `MINIMAX_API_BASE` 调用 MiniMax `/v1/video_generation`、查询任务、拉取文件下载地址。
- Vitest 中使用 mock key/env 和模拟错误场景，不代表生产是 mock。

额度状态：

- `reserved`：创建前预占额度，TTL 当前为 120 秒。
- `committed`：MiniMax 返回 task_id 且本地成功落库。
- `released`：上游限流、明确失败或预占过期后释放。
- `uncertain`：网络中断或 MiniMax 已返回 task_id 但本地落库失败，需要恢复或人工处理。

Reconcile：

- `app/api/internal/video/reconcile/route.ts` 由 `INTERNAL_CRON_SECRET` 保护。
- 释放过期 reserved 预占。
- 恢复带 `upstream_task_id` 的 uncertain operation。
- 同步 Submitted / Processing / Success 但缺少下载地址的任务。
- 补偿结算 Success 且 invite attribution 仍 pending 的奖励。

# 邀请奖励模块

核心表：

- `invite_links`
- `invite_visits`
- `invite_attributions`
- `invite_redemptions`
- `invite_reward_ledger`

流程：

1. 邀请人通过 `/api/invite/link` 创建或复用邀请链接。
2. 系统记录邀请人 IP/device 哈希，返回 `/invite/[code]`。
3. 被邀请人访问 `/invite/[code]`，生成 `invite_visit`，写入 `invite_visit` cookie。
4. 被邀请人创建视频任务成功后，`app/api/video/create/route.ts` 尝试写入 `invite_attributions`。
5. 视频任务状态变为 `Success` 后，`syncVideoTask()` 调用 `settleInviteReward()`。
6. 正常奖励写入 `invite_reward_ledger`，并给邀请人 `video_bonus_quota + 1`。

限制：

- 视频成功后才结算奖励。
- 每个邀请人每日最多 3 个 grant。
- 自邀限制：邀请人和被邀请人为同一卡时拒绝。
- 重复兑换限制：同一被邀请卡只能兑换一次。
- 同 IP 且同设备进入 `pending_review`，需要后台审核。
- 管理后台可 approve / reject / reverse。
- reverse 时会检查奖励是否已被消费，已消费则不能撤销。

# 环境变量

只列变量名，不列值。发现敏感配置时仅写“已省略敏感配置”。

NewAPI：

- `NEWAPI_BASE_URL`
- `NEWAPI_INTERNAL_URL`
- `NEWAPI_ACCESS_TOKEN`
- `NEWAPI_USER_ID`
- `NEWAPI_SQL_DSN`
- `SQL_DSN`

数据库 / 审计：

- `DB_PATH`
- `DATA_DIR`
- `AUDIT_ENABLED`

模型：

- `ALLOWED_MODELS`
- `MODELS_DEEPSEEK`
- `MODELS_GPT`
- `MODELS_CLAUDE`

后台 / Cookie：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`（README 和示例文件提到；当前认证代码主要使用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / SQLite session）
- `COOKIE_SECURE`

视频：

- `MINIMAX_API_KEY`
- `MINIMAX_API_KEY_2` 至 `MINIMAX_API_KEY_9`
- `MINIMAX_KEY_QUOTA`
- `MINIMAX_KEY_2_QUOTA` 至 `MINIMAX_KEY_9_QUOTA`
- `MINIMAX_API_BASE`
- `MINIMAX_HTTP_TIMEOUT_MS`

邀请 / 风控 / 内部任务：

- `RISK_HASH_SECRET`
- `INTERNAL_CRON_SECRET`

前端公开配置：

- `PUBLIC_API_BASE`
- `PUBLIC_API_BASE_ROOT`
- `NEXT_PUBLIC_BUY_CARD_URL`

其他：

- `NODE_ENV`

# 本地开发

常用命令：

```bash
npm install
npm ci
npm run dev
npm run build
npm run start
npm test
npm run test:watch
npm run card-admin -- status DE-XXXX-XXXX-XXXX
```

`package.json` 当前脚本：

- `dev`：`next dev -p 3100`
- `build`：`next build`
- `start`：`next start -p 3100`
- `gen-cards`：`tsx scripts/gen-cards.ts`，但当前未发现对应文件，使用前需确认。
- `card-admin`：`tsx scripts/card-admin-cli.ts`
- `test`：`vitest run`
- `test:watch`：`vitest`

本次生成文档未运行测试，避免触碰本地数据库或产生测试副作用。

# 测试

当前测试文件：

- `lib/light-monthly.test.ts`：轻度月卡权重、24h / 7d / lifetime 点数边界。
- `lib/rph-bonus.test.ts`：RPH 加成资格、实际 RPH、应用/撤销/重复加成。
- `lib/video-quota.test.ts`：视频错误分类、预占、幂等、finalize、baseAvailable。
- `lib/video-sync.test.ts`：网络错误、uncertain 恢复、奖励补偿、同步结算、风险哈希、同 IP/设备、限流、Cookie secure。
- `lib/video-infra.test.ts`：北京时间日期工具。
- `lib/card-admin-cli.test.ts`：CLI 格式、apply-rph、clear-rph、disable、status，不输出 `sk_key`。
- `lib/normalize-messages.test.ts`：system/developer message 规范化。
- `lib/strip-think.test.ts`：stream 与 non-stream 的 `<think>` 剥离。

# 部署注意事项

面向 Codex / Claude Code / Cursor 的安全操作约束：

- 生产目录不是 git 仓库时使用 rsync 或完整目录发布流程，不依赖远端 git pull。
- 必须排除 `.env` / `.env.local` / `data` / `.next` / `node_modules` / `.claude`。
- 部署前备份 `cards.db` / `audit.db`。
- 只重启 `nassa-cards`，不要动 partner 或其他 PM2 进程。
- 不要单文件 scp 覆盖页面，避免构建产物、路由和源码不一致。
- `deploy.sh` 当前包含本地 build、打包、远端备份 data 和 `.env.local`、安装生产依赖、`pm2 restart nassa-cards --update-env` 的流程；执行前必须确认目标环境和备份。
- 不要修改 nginx，除非明确要求。
- 不要修改 NewAPI 配置，除非明确要求。

# 安全边界

- 不要打印密钥。
- 不要提交数据库。
- 不要提交 `.env` 或 `.env.local`。
- 不要改 NewAPI 配置，除非明确要求。
- 不要改 nginx，除非明确要求。
- 不要自动部署。
- 不要自动 git push。
- 不要自动 git commit。
- 不要把生产数据复制到文档。
- 不要把 `sk_key`、API Key、token、数据库密码、DSN、access token 写进日志、PR、issue 或文档。
- 如发现敏感信息，只写“已省略敏感配置”。

# 敏感信息处理

- 本次分析未读取 `.env.local` 的具体内容。
- 项目中存在 `.env.local` 和 `.env.local.example`；真实敏感配置已省略敏感配置。
- 源码和文档中存在密钥、token、DSN、password 等变量名或配置入口；已省略敏感配置。
