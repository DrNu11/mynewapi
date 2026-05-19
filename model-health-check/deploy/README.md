# 🚀 部署到 VPS — Model Health Check

把 `model-health-check` 部署到 LA VPS `154.64.231.223`。

## 📋 总览

```
本地 Mac                                VPS 154.64.231.223
─────────                              ─────────────────────
1. bash deploy/sync-to-vps.sh   ──→    /opt/model-health-check/  (源码)

2. ssh root@154.64.231.223
   cd /opt/model-health-check
   bash deploy/setup-vps.sh     ──→    npm install + build + pm2 start
                                       端口 3030
                                       开机自启

3. http://154.64.231.223:3030   ←──    浏览器访问
```

---

## ⚡ 完整步骤（首次部署，约 5 分钟）

### Step 1：在 Mac 上配 SSH 免密（可选但强烈推荐）

```bash
# 如果你还没有 SSH key
ssh-keygen -t ed25519 -C "your-email@example.com"

# 把公钥拷到 VPS（会问一次密码，之后免密）
ssh-copy-id root@154.64.231.223
```

测试：
```bash
ssh root@154.64.231.223 'echo OK'
# 应该直接返回 OK，不再问密码
```

### Step 2：从 Mac 推代码

```bash
cd /Users/w/Desktop/newapi/model-health-check
chmod +x deploy/*.sh         # 首次给执行权限
bash deploy/sync-to-vps.sh
```

如果你想用别的 IP/路径：

```bash
VPS_HOST=root@xxx.xxx.xxx.xxx VPS_PATH=/opt/health-check bash deploy/sync-to-vps.sh
```

### Step 3：SSH 到 VPS 跑安装脚本

```bash
ssh root@154.64.231.223
cd /opt/model-health-check
bash deploy/setup-vps.sh
```

脚本会自动：
- 装 Node.js 20（如果还没装）
- 装 PM2 全局
- `npm ci` 装依赖
- `npm run build` 构建
- `pm2 start` 启动到端口 3030
- 配开机自启

完成后 `pm2 list` 应该看到：

```text
┌─────┬─────────────────────┬─────────────┬─────────┬─────┐
│ id  │ name                │ status      │ cpu     │ mem │
├─────┼─────────────────────┼─────────────┼─────────┼─────┤
│ 0   │ model-health-check  │ online      │ 0%      │ 80M │
└─────┴─────────────────────┴─────────────┴─────────┴─────┘
```

### Step 4：配 API Key（强烈推荐）

```bash
# 在 VPS 上
cat > /opt/model-health-check/.env.local <<'EOF'
NASSA_BASE_URL=https://api.nassaapi.xyz/v1
NASSA_API_KEY=sk-你的真实key
EOF

# 重启让 env 生效
pm2 restart model-health-check --update-env
```

不配也行，但每次进 UI 都要在"设置"里填 API Key（存在浏览器 localStorage）。

### Step 5：访问

```
http://154.64.231.223:3030
```

第一次打开，如果在 VPS 上配了 .env.local，进入就能直接点"全部检测"。

---

## 🔄 日常更新流程（后续每次改代码）

只要 3 行：

```bash
# Mac 上
bash /Users/w/Desktop/newapi/model-health-check/deploy/sync-to-vps.sh

# 远程一行重启
ssh root@154.64.231.223 'cd /opt/model-health-check && bash deploy/setup-vps.sh'
```

或者更省事的一条命令：

```bash
bash deploy/sync-to-vps.sh && \
ssh root@154.64.231.223 'cd /opt/model-health-check && bash deploy/setup-vps.sh'
```

---

## 🔐 加 HTTPS（可选，推荐）

如果你想用 `hc.nassaapi.xyz` 这种子域名 + HTTPS 访问：

### 1. Cloudflare 加 DNS

```text
类型:    A
名称:    hc
内容:    154.64.231.223
代理:    🟠 已代理（橙云）
```

### 2. VPS 上装 nginx

```bash
apt-get install -y nginx

cat > /etc/nginx/sites-available/health-check <<'NGINX_EOF'
server {
    listen 80;
    server_name hc.nassaapi.xyz;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/health-check /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 3. 访问

```
https://hc.nassaapi.xyz       ← 全自动 HTTPS（CF 代理负责）
```

---

## 🛠️ 常见操作

| 操作 | 命令 |
|---|---|
| 看实时日志 | `pm2 logs model-health-check` |
| 看进程状态 | `pm2 status` |
| 重启 | `pm2 restart model-health-check` |
| 停止 | `pm2 stop model-health-check` |
| 完全删除 | `pm2 delete model-health-check` |
| 内存占用 | `pm2 monit` |
| 修改 .env 后重启 | `pm2 restart model-health-check --update-env` |

---

## 🐛 排错

### `Permission denied (publickey)` SSH 不通
```bash
# 用密码方式：编辑 sync-to-vps.sh 删掉 BatchMode=yes
# 或者拷贝公钥
ssh-copy-id root@154.64.231.223
```

### `npm ci` 报错 lockfile 不存在
脚本已自动 fallback 到 `npm install`，不影响。

### 端口 3030 打不开（连接被拒绝）
```bash
# 在 VPS 上检查
pm2 list                                   # 进程在不在
ss -tnlp | grep 3030                       # 端口在不在监听
ufw status                                 # 防火墙
ufw allow 3030/tcp                         # 开放
iptables -L INPUT -n | grep 3030           # 看 iptables
```

### 浏览器 502 / 504
通常是 PM2 进程挂了：
```bash
pm2 logs model-health-check --err --lines 50
```

### 内存不够
你 VPS 1GB 的话，构建时可能 OOM。`setup-vps.sh` 已加 `--max-memory-restart 300M`。如果还不够：
```bash
# 关掉构建，用本地 Mac 构建后再上传
# 在 Mac 上：
npm run build
rsync -avz .next root@154.64.231.223:/opt/model-health-check/
ssh root@154.64.231.223 'pm2 restart model-health-check'
```

### Node.js 版本太老
`setup-vps.sh` 自动检测并升级。如果你想强制重装：
```bash
apt-get remove -y nodejs npm
bash deploy/setup-vps.sh
```

---

## 📊 配置清单

| 项 | 值 |
|---|---|
| 监听端口 | `3030` |
| 进程名 | `model-health-check` |
| 部署目录 | `/opt/model-health-check` |
| 日志 | `~/.pm2/logs/model-health-check-*` |
| 自启 | systemd (`pm2 startup`) |
| 环境变量 | `.env.local`（如有） |
| 内存上限 | 300 MB（超过自动重启） |

---

## 🔮 后续

- 加监控告警（Webhook → 钉钉/企微）
- 加历史数据存储（SQLite）
- 加多 endpoint 支持（监控其他中转服务）
