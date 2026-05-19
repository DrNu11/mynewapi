# upgrade-api

为 `gopay.nassa.space` 提供两件事：

1. **业务升级表单的后端**（`/api/upgrade/*`）：接收邮箱/订单号/邀请码，写入 SQLite。
2. **chatgpt2cpa 的 OTA 运维面板**（`/api/ota/*` + `/admin`）：从 git 或 zip 升级 `/opt/chatgpt2cpa`，备份、回滚、健康检查一条龙。

## 一句话部署

服务器上：

```bash
# 1. 同步代码
mkdir -p /opt/upgrade-api && rsync -av --delete /path/to/repo/server/ /opt/upgrade-api/
# 静态前端
mkdir -p /opt/upgrade-api/static
rsync -av /path/to/repo/{index.html,script.js,styles.css,admin.html,admin.js,admin.css} /opt/upgrade-api/static/

# 2. 安装依赖
cd /opt/upgrade-api
python3 -m venv .venv
.venv/bin/pip install -e .

# 3. 写配置（务必改 ADMIN_TOKEN！）
cp .env.example .env
sed -i "s/CHANGE_ME_TO_A_LONG_RANDOM_STRING/$(openssl rand -hex 32)/" .env
chmod 600 .env

# 4. 装 systemd
cp deploy/upgrade-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now upgrade-api.service
systemctl status upgrade-api.service --no-pager

# 5. nginx：把 deploy/nginx-snippet.conf 里的 location 块
#    插入 gopay.nassa.space 的 server { } 中（80 和 443 都要），
#    放在 `location / { ... }` 之前。然后：
nginx -t && systemctl reload nginx

# 6. 备份目录权限
mkdir -p /opt/chatgpt2cpa-backups
chmod 700 /opt/chatgpt2cpa-backups
```

完成后访问：

- 升级页：`https://gopay.nassa.space/upgrade/`
- 运维面板：`https://gopay.nassa.space/admin`（首次进入需粘贴 .env 里的 `UPGRADE_API_ADMIN_TOKEN`）
- 内部健康：`curl http://127.0.0.1:7889/api/health`

## 数据 & 备份在哪

| 内容 | 路径 |
|---|---|
| 业务数据库 | `/opt/upgrade-api/data/upgrade.db` |
| 上传的 zip | `/opt/upgrade-api/data/uploads/` |
| chatgpt2cpa 备份 | `/opt/chatgpt2cpa-backups/<id>.tar.gz` |
| 运行日志 | `journalctl -u upgrade-api -f` |

## 数据库表

- `upgrade_orders`：每次提交一条
- `invite_uses`：邀请被使用的记录
- `ota_jobs`：OTA 任务历史
- `ota_backups`：备份索引

## OTA 设计要点

- **备份**：tar.gz，**排除** `.venv` / `data` / `result` / `__pycache__`（venv 可重建，data/result 是业务数据绝不动）
- **恢复**：先清空 target（保留 .venv / data / result），再解 tar
- **健康检查**：默认 20 次重试 × 1.5 秒，覆盖 chatgpt2cpa 启动+加载耗时
- **失败回滚**：部署任一步骤失败，自动调用 `_restore_from_backup` 回滚到刚才的备份

## 安全模型

- OTA / admin 接口要 `X-Admin-Token`（用 `hmac.compare_digest` 比对，抗时序攻击）
- token 在 `.env` 里，文件权限 600
- 默认 systemd 以 root 跑，简单粗暴。如需降权，看 `deploy/sudoers-upgrade-api` 文件注释。

## 开发模式

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export UPGRADE_API_ADMIN_TOKEN=dev-token
export UPGRADE_TARGET_REPO=/tmp/fake-chatgpt2cpa
export UPGRADE_TARGET_HEALTH_URL=http://127.0.0.1:9999/
upgrade-api --reload
```
