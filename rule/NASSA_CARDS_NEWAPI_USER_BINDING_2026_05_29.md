# nassa-cards:卡密绑定 NewAPI 用户 ID 实施记录

> 日期:2026-05-29  
> 目标:在 `https://card.nassaapi.xyz/admin` 生成卡密时可填写客户 NewAPI 用户 ID,客户用卡密得到的 token 在 NewAPI 使用日志中归属到该客户账号。

## 结论

已上线。后台生成卡密新增 `NewAPI 用户ID(可选)` 字段;列表新增 `NewAPI用户` 列和单卡“用户”编辑按钮。

真实可行链路不是改 `New-Api-User` header 直接冒充客户,而是:

1. 用默认 `NEWAPI_USER_ID` + `NEWAPI_ACCESS_TOKEN` 创建 token。
2. 拿到 token id/key 后,通过 NewAPI MySQL 把 `tokens.user_id` 更新为目标客户 ID。
3. 客户实际请求时 NewAPI 按 token DB 里的 `user_id` 记录 logs,所以客户能在自己的 NewAPI 使用日志里看到调用次数、模型、消耗。

## 为什么不能只改 header

生产端到端测试已经验证:NewAPI 管理 API 会校验登录用户和 `New-Api-User` 一致。

错误:

```text
NewAPI HTTP 401: Unauthorized, New-Api-User does not match logged in user
```

因此,如果用管理员 access token 但把 `New-Api-User` 改成 444,创建 token 会失败。

## 改动点

- `nassa-cards/lib/db.ts`
  - `cards` 表新增 `newapi_user_id INTEGER` 和索引。
  - `insertCard` 写入目标用户 ID。
  - 支持按 NewAPI 用户 ID 搜索卡密。
- `nassa-cards/lib/newapi.ts`
  - 创建 token 后调用 DB 迁移归属。
  - 已迁移 token 的查询额度、续费、禁用走 DB 路径,避免 NewAPI 管理 API header 限制。
- `nassa-cards/lib/newapi-db.ts`
  - 新增 NewAPI MySQL 访问层。
  - 支持校验用户存在、迁移 token 归属、查询 token、改状态、改过期时间、改额度。
- `nassa-cards/app/admin/page.tsx`
  - 生成表单新增 NewAPI 用户 ID。
  - 列表展示和编辑绑定用户。
- `nassa-cards/app/api/redeem/route.ts`
  - 激活时把 `card.newapi_user_id` 传入 token 创建流程。

## 生产配置

`/opt/nassa-cards/.env.local` 需要:

```env
NEWAPI_SQL_DSN=<NewAPI MySQL DSN, host 改成 mysql container IP>
```

本次部署时从 `newapi-prod-new-api-1` 的 `SQL_DSN` 自动读取,把 host 替换为 `newapi-prod-mysql-1` 的 Docker bridge IP。

## 端到端验证

生产 207 已完成真实闭环:

```text
生成测试卡:DE-25GA-5Y25-8FXS, newapi_user_id=444
激活成功:返回 sk-...
模型调用:deepseek-v4-flash, HTTP 200
cards.db: token_id=754, newapi_user_id=444, local_request_logs=1
NewAPI tokens: id=754, user_id=444, name=DE-25GA-5Y25-8FXS, status=1
NewAPI logs: user_id=444, token_id=754, model_name=deepseek-v4-flash, count=1
```

测试完成后已清理:

```text
deleted NewAPI logs where token_id=754
deleted NewAPI token id=754
deleted cards/request_logs for DE-25GA-5Y25-8FXS
```

## 重要限制

- 给“已激活旧卡”补填 `newapi_user_id` 只会更新 card 后台标注,不会自动迁移旧 token 和历史 logs。
- 真正让客户看到 NewAPI 使用日志的关键是 `tokens.user_id`。历史 logs 已经写成旧用户 ID 的,不建议批量改,除非客户明确要求迁移历史账单。
- 以后不要再尝试用管理员 token + `New-Api-User=<客户ID>` 创建客户 token;这条路生产已证伪。
