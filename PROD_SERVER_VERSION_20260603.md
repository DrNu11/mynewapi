# 生产服务器版本说明 - 2026-06-03

本文档记录 207 服务器当前生产 NewAPI 版本，便于 GitHub 备份、排障和回滚。

## 当前生产状态

- 服务器：`207.244.243.12`
- 生产目录：`/www/dk_project/dk_app/newapi-prod`
- 生产容器：`newapi-prod-new-api-1`
- 对外端口：`3000 -> 3000/tcp`
- 当前镜像：`nassa11111/new-api-hide-model:hide-model-v59-specific-error2-20260603`
- 镜像 ID：`sha256:cd29946705edbfb3f47d2b0ec4187d1992c984b9e72904377e07f796aedc530d`
- 镜像创建时间：`2026-06-03T08:57:33+02:00`
- 运行状态：`healthy`

> 注意：服务器 `docker-compose.yml` 内含数据库密码、Session Secret 等敏感配置，本仓库只记录脱敏后的运行信息，不提交明文密钥。

## 本次线上版本对应重点

当前线上版本基于 v59 主题/缓存修复线，继续补了 DeepSeek 伪装错误展示：

- 保持用户侧模型展示为 DeepSeek，不暴露真实上游模型名。
- 上下文超限类错误统一展示为：`上下文过长,请新开窗口`。
- 非上下文超限的上游错误尽量保留原始含义，但需要过滤真实模型名和上游品牌名。
- `RetryTimes` 已恢复为 `5`，用于减少单个渠道瞬时 502/429 对用户的影响。
- `RetryTimes.backup-before-pro-502-20260603-1933` 保留原值 `2`，方便追溯。

## 生产 Compose 摘要

生产服务包含：

- `new-api`：使用当前 NewAPI 镜像，挂载 `./data` 和 `./logs`。
- `redis`：`redis:latest`。
- `mysql`：`mysql:8.2`，数据挂载在 `./mysql_data`。
- 网络：`newapi-prod-net`。

生产 `docker-compose.yml` 已在服务器上保留多份备份，其中和本次版本相关的备份点包括：

- `docker-compose.yml.backup-before-v59-specific-error2-20260603-085820`
- `docker-compose.yml.backup-before-v59-specific-error-20260603-084751`
- `docker-compose.yml.backup-before-rollback-v59-20260603-071127`
- `docker-compose.yml.backup-v59-default-theme-20260602-155927`

## 当前服务器相关镜像

- 当前线上：`hide-model-v59-specific-error2-20260603`，镜像 ID `cd29946705ed`
- 上一备份：`backup-v59-before-specific-error2-20260603-085820`，镜像 ID `d26b868478d7`
- 上一版本：`hide-model-v59-specific-error-20260603`，镜像 ID `d26b868478d7`
- v59 回退基线：`hide-model-v59-home-cachefix`，镜像 ID `f5896a636658`

## 最小影响回滚方式

如需回滚，优先只修改生产 compose 的镜像 tag，然后执行：

```bash
cd /www/dk_project/dk_app/newapi-prod
docker compose up -d new-api
docker compose ps
docker logs --since 2m newapi-prod-new-api-1
```

推荐回滚目标：

```text
nassa11111/new-api-hide-model:hide-model-v59-home-cachefix
```

## GitHub 备份说明

本地源码分支：

```text
codex/v57-consume-ip-log-backup-20260602
```

当前已推送到 GitHub 的最新提交：

```text
84b0da2 修复DeepSeek上游异常错误伪装
```

本说明文档单独提交在：

```text
codex/prod-v59-specific-error2-doc-20260603
```

用途：

- 给 GitHub 留下生产版本的镜像、端口、配置摘要。
- 避免以后只知道线上 tag，却不知道当时服务器实际运行状态。
- 避免把生产明文密钥、客户密钥、数据库密码提交到仓库。
