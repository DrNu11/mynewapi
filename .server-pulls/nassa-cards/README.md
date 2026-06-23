# NassaAPI 卡密激活中心

客户输入卡密 → 后端调 NewAPI 创建临时 token → 返回 sk-xxx + base URL 给客户。

## 功能

- 三档套餐:**1 天 / 7 天 / 30 天** 不限量调用 DeepSeek
- 客户激活后获得真实 NewAPI sk-xxx,可在 Cherry Studio / Claude Code / Cursor 等任意工具中使用
- 管理员后台:批量生成卡密、查看使用记录、按状态/套餐筛选
- 卡密可重复输入查看(到期前)
- IP 速率限制防爆破
- SQLite 本地存储,无需外部数据库

## 架构

```
卡密(NASSA-XXXX-XXXX-XXXX)
    ↓ POST /api/redeem
后端验证卡密 → 调 NewAPI 创建 token (model_limits=deepseek-v4-flash,deepseek-v4-pro)
    ↓
返回 { api_key: "sk-xxx", base_url: "https://api.nassaapi.xyz/v1", expires_at }
    ↓
客户复制粘贴到自己工具里
```

NewAPI token 设置 `expired_time = now + plan天数 * 86400`,到期自动失效,无需主动清理。

## 快速开始

### 1. 在 NewAPI 后台准备凭据

1. 登录 NewAPI 管理员账号(https://api.nassaapi.xyz)
2. 进入 **个人设置**,顶部记下用户 ID
3. 滚动到 **系统访问令牌**,点击 **生成 access_token**,复制保存

### 2. 配置环境变量

```bash
cp .env.local.example .env.local
# 编辑 .env.local,填入以下:
#   NEWAPI_ACCESS_TOKEN=...        (上一步生成的)
#   NEWAPI_USER_ID=1               (你的用户 ID)
#   ADMIN_USERNAME=admin
#   ADMIN_PASSWORD=自定义强密码
#   SESSION_SECRET=随机32位字符串
```

### 3. 安装依赖并启动

```bash
# 推荐使用 bun (与项目其他模块保持一致)
bun install
bun run dev

# 或用 npm
npm install
npm run dev
```

访问:
- 客户端: http://localhost:3100
- 管理后台: http://localhost:3100/admin/login

### 4. 生成首批卡密

1. 浏览器打开 http://localhost:3100/admin/login,输入管理员凭据登录
2. 选择套餐和数量,点击 **生成**
3. 复制生成的卡密发给客户

## 使用流程(客户视角)

1. 客户访问首页,输入卡密
2. 系统返回 API Key 和 Base URL
3. 客户在 Cherry Studio / Cursor / curl 等工具里使用:
   ```bash
   curl https://api.nassaapi.xyz/v1/chat/completions \
     -H "Authorization: Bearer sk-xxx..." \
     -H "Content-Type: application/json" \
     -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"你好"}]}'
   ```
4. 到期后 NewAPI 自动拒绝该 token

## 部署

### 选项 A:同机器部署在 154 VPS(健康检查项目同一台)

```bash
scp -r nassa-cards/ root@154.64.231.223:/opt/
ssh root@154.64.231.223
cd /opt/nassa-cards
bun install
bun run build
# 用 pm2 守护,监听 3100 端口
pm2 start "bun run start" --name nassa-cards
```

### 选项 B:Docker

```bash
docker build -t nassa-cards .
docker run -d -p 3100:3100 \
  -v $(pwd)/data:/app/data \
  --env-file .env.local \
  --name nassa-cards \
  nassa-cards
```

### Nginx 反代示例

```nginx
server {
  listen 80;
  server_name kami.nassaapi.xyz;
  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## 数据库管理

SQLite 数据库存放在 `./data/cards.db`。

```bash
# 备份
cp data/cards.db data/cards.db.$(date +%F).bak

# 命令行查询
sqlite3 data/cards.db "SELECT code, plan, status, datetime(activated_at,'unixepoch','localtime') FROM cards"
```

## 安全注意事项

- 务必修改 `ADMIN_PASSWORD` 为强密码
- 生产环境 `SESSION_SECRET` 设为随机 32 位字符串
- 反向代理建议加 HTTPS(Caddy / Cloudflare)
- 管理后台路径 `/admin` 建议加 basic auth 或 IP 白名单(双重保险)
- `data/cards.db` 不可暴露到公网,记得加到 `.gitignore`(已默认排除)

## 故障排查

| 现象 | 排查 |
|---|---|
| 激活时返回"后端开通失败" | 检查 `NEWAPI_ACCESS_TOKEN` 是否过期、`NEWAPI_USER_ID` 是否正确 |
| 客户用 sk-xxx 调用失败 | 在 NewAPI 后台 - 令牌列表搜索卡密名,确认 token 状态 |
| 管理后台无法登录 | 检查 `ADMIN_USERNAME` / `ADMIN_PASSWORD` |
| `model_limits` 报错 | 确认 NewAPI 后端的 token 表已支持 `model_limits_enabled` 字段 |
