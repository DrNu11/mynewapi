# 生产服务器版本说明 - 2026-06-09 实测

本文档记录 207 服务器生产 NewAPI 的实际运行状态，便于 GitHub 备份、排障和回滚。

## 当前生产状态

- 服务器：`207.244.243.12`
- 服务器主机名：`vmi3301411`
- 生产目录：`/www/dk_project/dk_app/newapi-prod`
- 生产容器：`newapi-prod-new-api-1`
- 对外端口：`0.0.0.0:3000 -> 3000/tcp`
- 当前 compose 镜像：`nassa11111/new-api-hide-model:hide-model-v65-responses-disguise`
- 生产容器启动时间：`2026-06-05T15:15:21Z`
- 运行状态：`Up 3 days (healthy)`
- 容器重启次数：`0`
- 本机健康检查：`http://127.0.0.1:3000/api/status` 返回 `HTTP 200`，耗时约 `0.003s`

> 注意：服务器 `docker-compose.yml` 内含数据库密码、Session Secret 等敏感配置，本仓库只记录脱敏后的运行信息，不提交明文密钥。

## 服务器资源快照

采样时间：`2026-06-09 12:04:35 CEST`

- uptime：`25 days, 7:32`
- load average：`3.27, 4.37, 4.59`
- 内存：`11Gi total / 4.5Gi used / 7.2Gi available`
- swap：`4.0Gi total / 3.6Gi used / 398Mi free`
- 根分区：`193G total / 118G used / 76G available / 61%`

## 生产 Compose 摘要

生产服务包含：

- `new-api`
  - 镜像：`nassa11111/new-api-hide-model:hide-model-v65-responses-disguise`
  - 容器名：`newapi-prod-new-api-1`
  - 命令：`--log-dir /app/logs`
  - 端口：`${HOST_IP:-0.0.0.0}:${WEB_HTTP_PORT:-3002}:3000`
  - 当前实际映射：`0.0.0.0:3000->3000/tcp`
  - 挂载：`./data:/data`、`./logs:/app/logs`
  - 依赖：`redis`、`mysql`
  - 健康检查：容器内请求 `http://localhost:3000/api/status`
- `redis`
  - 镜像：`redis:latest`
  - 容器名：`newapi-prod-redis-1`
- `mysql`
  - 镜像：`mysql:8.2`
  - 容器名：`newapi-prod-mysql-1`
  - 数据库：`new-api`
  - 挂载：`./mysql_data:/var/lib/mysql`
- 网络：`newapi-prod-net`

## 当前服务器相关镜像

服务器上和生产相关的镜像 tag：

- 当前线上：`hide-model-v65-responses-disguise`，镜像 ID `b849d591da17`
- 服务器上的 `hide-model` tag：镜像 ID `b09ecd4e5c9e`
- `hide-model-v59-filter-minimax-20260604`：镜像 ID `b09ecd4e5c9e`
- `hide-model-v62-responses-disguise`：镜像 ID `26886ca5692a`
- `hide-model-v61-think-reasoning-salvage`：镜像 ID `3c2422253c4b`
- `hide-model-v60-minimax-tag-filter`：镜像 ID `3d25df277dc9`
- `hide-model-v59-specific-error2-20260603`：镜像 ID `cd29946705ed`
- `hide-model-v59-specific-error-20260603`：镜像 ID `d26b868478d7`
- `hide-model-v59-home-cachefix`：镜像 ID `f5896a636658`

注意：生产 compose 当前明确引用 `hide-model-v65-responses-disguise`，不是浮动的 `hide-model` tag。

## 生产备份点

生产目录内保留了多份 `docker-compose.yml` 备份，近期和 v59-v65 相关的备份点包括：

- `docker-compose.yml.bak-20260605-171506`
- `docker-compose.yml.bak-before-v65-20260604-161539`
- `docker-compose.yml.backup-before-v62-20260604-135754`
- `docker-compose.yml.backup-before-v60-minimax-tag-filter-20260604-173314`
- `docker-compose.yml.backup-before-v59-specific-error2-20260603-085820`
- `docker-compose.yml.backup-before-v59-specific-error-20260603-084751`
- `docker-compose.yml.backup-before-rollback-v59-20260603-071127`
- `docker-compose.yml.backup-v59-default-theme-20260602-155927`

## 2026-06-09 524 排查备注

用户侧看到的 Cloudflare `524 origin_response_timeout` 不等于生产 NewAPI 整站挂死。本次只读排查观察到：

- 本机 `127.0.0.1:3000/api/status` 约 `3-4ms` 返回 `200`。
- 首页 `/` 本机访问也约 `4ms` 返回 `200`。
- `newapi-prod-new-api-1` 状态为 `healthy`，生产容器没有重启。
- NewAPI relay 日志中存在上游错误：
  - `channel #99` 返回 `524`
  - 大量 `channel #99/#97/#104/#105/#28` 返回 `429`
  - `channel #106` 返回 Cloudflare `502`
  - `channel #103` 返回 `system cpu overloaded`
- 典型日志：
  - `2026-06-09 18:01:02`：`channel #99` 返回 `524`，`POST /v1/messages` 以 `524` 结束，耗时约 `15.16s`
  - `2026-06-09 18:02:27`：`channel #99` 返回 `524`，`POST /v1/messages` 以 `524` 结束，耗时约 `15.06s`

初步结论：这次 524 更像是 NewAPI relay 调用的上游渠道超时或上游 Cloudflare 超时，由 NewAPI 透传/包装给客户端；不是 207 源站 NewAPI 管理页面或 `/api/status` 自身超过 120 秒未响应。

## 最小影响回滚方式

如需回滚，优先只修改生产 compose 的镜像 tag，然后执行：

```bash
cd /www/dk_project/dk_app/newapi-prod
docker compose up -d new-api
docker compose ps
docker logs --since 2m newapi-prod-new-api-1
```

当前推荐保守回滚目标需要按问题类型选择：

```text
nassa11111/new-api-hide-model:hide-model-v65-responses-disguise
nassa11111/new-api-hide-model:hide-model-v62-responses-disguise
nassa11111/new-api-hide-model:hide-model-v59-home-cachefix
```

## GitHub 备份说明

用途：

- 给 GitHub 留下生产版本的镜像、端口、配置摘要。
- 避免以后只知道线上 tag，却不知道当时服务器实际运行状态。
- 避免把生产明文密钥、客户密钥、数据库密码提交到仓库。
