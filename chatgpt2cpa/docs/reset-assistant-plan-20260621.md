# Session 重置额度助手计划书

## 目标

做一个类似 20Pro 助手的网页，让客户粘贴 ChatGPT/Codex session JSON 后，可以完成三件事：

1. 临时解析 session，复用当前 `chatgpt2cpa` 的 `session -> CPA auth.json` 能力。
2. 生成可下载的 CPA 文件，并展示邮箱、套餐、账号 ID、过期时间等摘要。
3. 在明确授权的情况下，把 CPA 文件导入服务器上的 CLIProxyAPI，并调用 Management API 清除该凭证的 CPA 运行时限额/冷却状态。

这里的“重置额度”不是改 OpenAI 官方 5 小时/周限额，而是调用 CLIProxyAPI 的 `/v0/management/reset-quota`，清掉 CLIProxyAPI 对某个 `auth_index` 的路由限额/冷却状态，让它重新参与路由。这个接口要求凭证已经在 CPA auth 池里，并且必须使用 Management Key。

## 现有基础

- `chatgpt2cpa/src/chatgpt2cpa/converter.py` 已能抽取 `access_token`、`refresh_token`、`id_token`、`account_id`、`plan_type`。
- `build_codex_auth_json()` 已能输出 CPA 兼容 auth JSON。
- `build_sub2api_json()` 已能输出 sub2api-data。
- NewAPI 中已有 Codex 用量查询实现，可参考 `GET /backend-api/wham/usage` 的请求头格式，但这不是 CPA reset 的必要前置。
- CLIProxyAPI Management API 提供：
  - `POST /auth-files?name=<file.json>` 上传 CPA auth JSON。
  - `GET /auth-files` 获取运行时 `auth_index`。
  - `POST /reset-quota` 按 `auth_index` 清 runtime quota/cooldown。

## 安全边界

客户 session/token 是最高敏感数据。公网版本必须遵守：

- 默认不把 token 写入日志。
- 默认不在服务器落盘保存用户输入原文。
- API 错误信息必须经过脱敏，不回显 `access_token`、`refresh_token`、`id_token`、`session_token`。
- 只有客户勾选授权后，才允许“导入 CPA 池并重置”。
- Management Key 只放在服务器环境变量里，不发给浏览器。
- 前端只在当前页面内存里保留 CPA 下载数据；刷新后消失。
- 线上服务仅暴露业务 API，不暴露 Management API。
- 部署时用独立进程和端口，便于回滚。

## MVP 范围

第一版上线下面 4 个接口和一个页面：

- `GET /`：额度助手页面。
- `GET /api/reset-assistant/status`：告诉前端是否启用了 CPA 导入/重置。
- `POST /api/reset-assistant/parse`：解析 session，返回摘要、告警、CPA 文件名和可下载 JSON。
- `POST /api/reset-assistant/import-reset`：在 `CPA_ENABLE_IMPORT_RESET=1` 时，导入 CPA auth JSON 到 CLIProxyAPI，然后查 `auth_index` 并调用 `/reset-quota`。

页面工作流：

1. 客户粘贴 session JSON。
2. 点击“解析”后显示账号摘要，并启用“下载 CPA”。
3. 如果服务器启用了管理集成，客户勾选授权后可以点击“导入并重置”。
4. 页面展示导入状态、匹配到的 `auth_index`、reset 返回的模型列表。

## 非 MVP

- 不做第三方卡密/邀请码消耗。
- 不把客户 token 转发给不受控第三方站点。
- 不承诺修改 OpenAI 官方额度。
- 不做批量账号池管理、无效账号清理、付费队列。

## 测试计划

- 单元测试：
  - parse 接口能把测试 session 转成 CPA 文件。
  - parse 接口遇到坏 JSON 返回 400，错误中不含 token。
  - import-reset 未启用时返回清晰错误。
  - import-reset 启用时用 mock Management API 完成上传、查 auth_index、reset。
- 本地冒烟：
  - 启动 uvicorn。
  - `curl /api/reset-assistant/status`。
  - 用测试 session `POST /api/reset-assistant/parse`。
  - 打开页面确认按钮状态和下载数据。
- 线上冒烟：
  - `curl http://127.0.0.1:<port>/api/reset-assistant/status`。
  - 远程本机请求 parse，不使用真实 token。
  - 如果配置了 Management Key，只用测试凭证或用户授权的真实凭证验证一次 import-reset。

## 部署计划

部署到 207 服务器：

1. 本地测试通过。
2. 同步 `chatgpt2cpa` 到服务器独立目录，例如 `/opt/chatgpt2cpa-reset-assistant`。
3. 创建 venv 并安装 `.[dev]` 或运行时依赖。
4. 用 systemd 管理服务，监听本机端口，例如 `127.0.0.1:8320`。
5. 环境变量：
   - `CPA_MANAGEMENT_BASE_URL=http://127.0.0.1:8317/v0/management`
   - `CPA_MANAGEMENT_KEY=<server-only secret>`
   - `CPA_ENABLE_IMPORT_RESET=1`
6. 先只做本机冒烟。如果需要公网域名，再由 nginx/Cloudflare 单独反代。

## 回滚

- systemd 服务独立，不影响 8316/8317。
- 回滚只需停止新服务或切回上一份部署目录。
- 已导入 CPA 的 auth 文件属于业务数据，不随服务回滚自动删除，必须按文件名或管理 API 单独处理。
