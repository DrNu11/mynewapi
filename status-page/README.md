# Nassa Status Page

仿 `status.iqach.top` 的 NewAPI 网关状态监控页。

- **前端**:Preact + htm + TailwindCSS(单文件 SPA,无构建步骤)
- **后端**:FastAPI + APScheduler + PyMySQL
- **数据源**:
  - VPS 系统指标 → `psutil`
  - 网关实时统计 → NewAPI MySQL `logs` 表实时聚合
  - 48h 历史 → SQLite 桶持久化(每 30s 刷新当前桶)
  - MiniMax Token Plan → 服务端定时读取 MiniMax 额度接口(不向前端暴露 Cookie)

## 目录结构

```
status-page/
├── main.py                # FastAPI 入口
├── config.py              # 配置(从环境变量读)
├── system_metrics.py      # VPS 系统指标采集(psutil)
├── gateway_metrics.py     # NewAPI logs 实时聚合
├── minimax_monitor.py     # MiniMax Token Plan 额度采集
├── history_store.py       # SQLite 48h 历史桶
├── mock_data.py           # MOCK_MODE=1 时的假数据
├── static/index.html      # 前端 SPA(克隆自 status.iqach.top)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml     # 部署到 207 用
└── data/history.db        # SQLite(运行后自动生成)
```

## 本地开发(mac/linux)

```bash
cd status-page
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 选项 A:mock 模式(无需 DB,适合先验外观)
MOCK_MODE=1 python main.py

# 选项 B:真实数据(本地必须能连到 NewAPI MySQL)
MYSQL_HOST=127.0.0.1 \
MYSQL_PASSWORD=xxxxx \
python main.py
```

打开 `http://localhost:8000/`。

## 生产部署(207)

### 1. 拷贝项目到 207

```bash
scp -r status-page/ root@207.244.243.12:/opt/nassa-status-page
```

### 2. 在 207 上准备 `.env`

```bash
ssh root@207.244.243.12
cd /opt/nassa-status-page

# 从 NewAPI 容器取 MySQL 密码
MYSQL_PASSWORD=$(docker exec newapi-prod-mysql-1 printenv MYSQL_ROOT_PASSWORD)
echo "MYSQL_PASSWORD=${MYSQL_PASSWORD}" > .env

# MiniMax Token Plan 账号 Cookie,按需填 3 个
cat >> .env <<'EOF'
MINIMAX_TOKEN_PLANS_JSON=[{"tag":"mm-a","name":"MiniMax A","cookie":"COOKIE_A","group_id":"GROUP_A"},{"tag":"mm-b","name":"MiniMax B","cookie":"COOKIE_B","group_id":"GROUP_B"},{"tag":"mm-c","name":"MiniMax C","cookie":"COOKIE_C","group_id":"GROUP_C"}]
MINIMAX_REFRESH_SECONDS=30
EOF
```

### 3. 启动

```bash
docker compose up -d --build
docker logs -f nassa-status-page
```

容器 `nassa-status-page` 监听 `:8200`,与 NewAPI 同一 docker 网络可直连
`newapi-prod-mysql-1:3306`。

### 4. Nginx 反代 + Cloudflare

```nginx
server {
    listen 443 ssl http2;
    server_name status.nassaapi.xyz;
    # ... 证书略

    location / {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Cloudflare DNS:`status.nassaapi.xyz` → 207 IP,Proxied。

## 配置环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_TAG` | `nassa` | 网关唯一标识(前端 React key) |
| `GATEWAY_NAME` | `Nassa API Gateway` | 网关显示名 |
| `MYSQL_HOST` | `127.0.0.1` | NewAPI MySQL 主机 |
| `MYSQL_PORT` | `3306` | NewAPI MySQL 端口 |
| `MYSQL_USER` | `root` | NewAPI MySQL 用户 |
| `MYSQL_PASSWORD` | **必填** | NewAPI MySQL 密码 |
| `MYSQL_DATABASE` | `new-api` | NewAPI MySQL 库名 |
| `REALTIME_WINDOW` | `300` | 实时统计窗口(秒) |
| `HISTORY_HOURS` | `48` | 历史展示小时数 |
| `BUCKET_SECONDS` | `3600` | 每个历史桶宽度(秒) |
| `REFRESH_SECONDS` | `30` | 后台采集间隔(秒) |
| `MOCK_MODE` | `0` | 为 1 时不连 DB,返回假数据 |
| `MINIMAX_TOKEN_PLANS_JSON` | 空 | MiniMax Token Plan 账号列表,每项含 `tag/name/cookie/group_id` |
| `MINIMAX_REFRESH_SECONDS` | `30` | MiniMax 额度刷新间隔(秒),前端 5s 轮询但后端按此缓存 |
| `MINIMAX_TIMEOUT_SECONDS` | `10` | MiniMax 请求超时 |

MiniMax 登录 Cookie 没有公开固定有效期,不要假设能永久使用。监控会把
`401/403/base_resp=1004/登录页 HTML` 标为 `auth_expired`,页面会提示
“登录态失效”,此时重新复制该账号 Cookie 并重启 status-page 即可。
采集接口使用 `https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains`,
并带上 `origin/referer=https://platform.minimaxi.com` 与 `x-group-id`。
复制 Cookie 时必须包含 `HERTZ-SESSION`、`_token`、`minimax_group_id_v2`;
只复制浏览器右侧 Cookie 面板里的部分字段会导致 MiniMax 返回
`cookie is missing, log in again`。

MiniMax 错误分类:

| 类型 | 页面含义 | 处理 |
|------|----------|------|
| `auth_expired` | 登录态失效 | 重新复制 Cookie 到 207 `.env` |
| `rate_limited` | MiniMax 限流 | 保持 30s 以上刷新间隔,稍后观察 |
| `upstream_error` | MiniMax 上游异常 | 连续失败再人工检查 |
| `network_error` | 207 网络异常 | 检查到 `platform.minimaxi.com` 的连通性 |
| `schema_error` | MiniMax 返回结构变化 | 更新 `minimax_monitor.py` 解析逻辑 |
| `http_error` | 其他 HTTP 异常 | 查看状态码与响应摘要 |

## API 接口

| 路径 | 说明 |
|------|------|
| `GET /` | 前端 SPA |
| `GET /api/stats` | 主数据接口(前端每 5s 拉一次) |
| `GET /api/minimax` | MiniMax Token Plan 额度接口 |
| `GET /api/health` | 健康检查 |

`/api/stats` schema(数组,每个网关一项):

```json
[
  {
    "tag": "nassa",
    "name": "Nassa API Gateway",
    "error": null,
    "system": { "cpu_percent": ..., "memory": {...}, "disk": {...}, "network": {...}, "load": [...], "uptime_seconds": ... },
    "history": { "hours": 48, "bucket_seconds": 3600, "components": [{ "component_type": "gateway", "display_name": "Gateway", "points": [...] }] },
    "data": { "uptime_seconds": ..., "nodes": [...], "requests": {...}, "latency": {...}, "tokens": {...}, "routes": {...}, "status_codes": {...} }
  }
]
```

## 已知限制

1. **NewAPI `logs` 表只存"消费日志"**,不存 HTTP status code,因此前端
   "状态码分布" 暂只显示 `200` + 失败合并的 `5xx`。
2. **节点 = NewAPI channel**(用 `channel_id` 当 node id,`channel_name` 当 IP)。
3. **success_rate** 按 `quota > 0 OR tokens > 0` 判定,非 4xx/5xx 维度。

如果需要真实 HTTP 状态码 + access log,后续可改读 Nginx access log
或在 NewAPI 中间件埋点。
