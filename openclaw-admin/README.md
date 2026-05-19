# OpenClaw Admin

OpenClaw provider & model 可视化管理面板。读写 `/root/.openclaw/openclaw.json`,OpenClaw 自动 hot reload。

## 功能

- 列出所有 provider(claude11 / nassaapi-deepseek-* / 你创建的别的)
- 改 provider 的 `apiKey` / `baseUrl`
- 重命名 provider(如 `claude11` → `nassa-aggregator`)
- 加 / 删模型
- 全文搜索模型 id / name
- OpenClaw gateway `/health` 实时探活

## 安全设计

- HTTP Basic Auth(浏览器弹框,默认 admin/nassa,可改 env)
- 写入用 atomic rename + fsync,失败不损坏原配置
- 每次写入前自动备份到 `.bak.<timestamp>`,保留最近 10 份
- 不删除 provider,不删除整个 models 数组,需要从 OpenClaw CLI / 直接编辑 JSON

## 本地开发

```bash
cp .env.local.example .env.local
npm install
PORT=1666 npm run dev
# 浏览器 http://localhost:1666/
# 弹框输 admin / nassa
```

本地 dev 用 `data/openclaw.sample.json`(从 207 拷贝的快照),改完不会影响线上。

## 部署到 207

```bash
# 本地打包
cd /Users/w/Desktop/newapi/openclaw-admin
rm -rf node_modules .next
tar -czf /tmp/openclaw-admin.tar.gz -C /Users/w/Desktop/newapi openclaw-admin

# 拷上 207
scp /tmp/openclaw-admin.tar.gz root@207.244.243.12:/tmp/
ssh root@207.244.243.12 'set -e
  rm -rf /opt/openclaw-admin
  mkdir -p /opt
  tar -xzf /tmp/openclaw-admin.tar.gz -C /opt/
  cd /opt/openclaw-admin
  cat > .env.local <<EOF
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=nassa
OPENCLAW_CONFIG_PATH=/root/.openclaw/openclaw.json
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
PORT=1666
EOF
  npm install --no-audit --no-fund
  npm run build
  pm2 delete openclaw-admin 2>/dev/null || true
  PORT=1666 pm2 start npm --name openclaw-admin --update-env -- run start
  pm2 save
'
```

访问 http://207.244.243.12:1666/

## 与 OpenClaw 的协作

每次保存触发 OpenClaw 的 hot reload(从 journalctl 可见 `config hot reload applied`)。
若误操作,所有改动有备份:`ls /root/.openclaw/openclaw.json.bak.*`。
