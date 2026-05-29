# 海外中转站部署笔记 (overseas NewAPI deployment)

> 创建时间:2026-05-16
> 部署目的:用 GCP 赠金搭一个面向海外用户的 NewAPI 中转站,跟 `api.nassaapi.xyz` 同样架构但独立运营
> 本文档面向:下次会话接手的 AI agent / 老板自己回顾

---

## 1. 当前部署快照(2026-05-16)

| 项目 | 值 |
|---|---|
| GCP 项目 ID | `project-04f928b9-a2e2-4fdb-ae9` |
| GCP 项目编号 | 126191203635 |
| GCP 账号 | <z2921477318@gmail.com> (gcloud 已登录) |
| 实例名 | `instance-20260515-093915` |
| 实例 zone | `us-central1-a` |
| 实例规格 | 2 vCPU Xeon @ 2.2GHz / 3.8GB RAM / 9.7GB 启动盘 (剩 4G ⚠️) |
| OS | Debian GNU/Linux 12 (bookworm) |
| 静态外部 IP | **34.135.9.30** (newapi-static, 永久) |
| NewAPI 端口 | 3000 (公网开放) |
| NewAPI 公网 URL | <http://34.135.9.30:3000/> |
| NewAPI 版本 | v1.0.0-rc.6 |
| 镜像 | `calciumion/new-api:latest` (官方上游,**未** fork hide-model) |
| 部署目录 | `/opt/new-api/` (docker-compose.yml + data/ + logs/ + mysql_data/) |
| MySQL root 密码 | `NewApiR00tPass!` ⚠️ 暂未改强 |
| GCP 赠金 | 300 USD,他老板已绑支付卡 |

---

## 2. 已完成动作时间线

### 2.1 本地 mac 端

- `brew install --cask google-cloud-sdk`(老板自己装)
- `gcloud auth login` → 用 `z2921477318@gmail.com` 登录
- `gcloud projects list` → 11 个项目,通过遍历找出实例所在 = `project-04f928b9-...-ae9`
- `gcloud config set project project-04f928b9-a2e2-4fdb-ae9`
- 测试 IAP SSH 通过(`gcloud compute ssh ... --command='hostname'`)
- 生成密钥 `~/.ssh/gcp_instance` (.pub),目前**未在用**(IAP 用了 gcloud 自管的 `~/.ssh/google_compute_engine`)
- `git clone --depth 1 https://github.com/QuantumNous/new-api.git ./new-api-fork`(本目录)

### 2.2 GCP 实例端(全部走 `gcloud compute ssh ... --command='...'`)

1. **装 Docker**:`curl -fsSL https://get.docker.com | sudo sh` → Docker 29.5.0 + Compose v5.1.3
2. **写 docker-compose.yml**(在 `/opt/new-api/`,见 §6.1)
3. **`docker compose up -d`** → new-api / mysql:8.2 / redis:latest 三容器 healthy
4. 第一次 new-api 进入 restart loop(MySQL 没就绪),第二次自动恢复

### 2.3 GCP 项目端

- `gcloud compute firewall-rules create allow-newapi-3000`(tcp:3000 source 0.0.0.0/0)
- `gcloud compute addresses create newapi-static --region=us-central1` → 分到 **34.135.9.30**
- `gcloud compute instances delete-access-config` + `add-access-config --address=34.135.9.30`
  → 实例外部 IP 从临时换成静态(网络瞬断 5-10s)

### 2.4 验证

- 实例本地 `curl http://localhost:3000/` → HTTP 200
- 我本机 `curl http://34.135.9.30:3000/` → HTTP 200(280ms 跨洲延迟,正常)
- ICMP ping 34.135.9.30 → 0% packet loss

---

## 3. 待办(按优先级)

### 🟢 已完成(2026-05-16 20:30)

- [x] 老板他老板提供 **vercel 域名** + 期望的子域名前缀 → `api.toplenged.com`
- [x] vercel DNS 加 A 记录:`api.toplenged.com` → `34.135.9.30`,TTL 60(合伙人代做)
- [x] 装 Caddy 自动 TLS(Caddy 2.11.3,LE 证书已签)
- [x] GCP firewall 加 `:80` `:443`(`allow-https` rule)
- [x] 浏览器打开 <https://api.toplenged.com/> 初始化 root 账号
- [x] 关 `:3000` 防火墙(删除 `allow-newapi-3000` rule,只允许内网 caddy 反代)
- [x] 验证:`:3000` 公网 timeout / `:443` HTTPS 200 / `:80` 308 跳 HTTPS

### 🔴 仍待做(老板按需推进,不急)

- [ ] 改 MySQL root 密码(`NewApiR00tPass!` 太弱,虽然 `:3306` 不公网开放但仍是潜在风险)
- [ ] 启动盘扩容(现 9.7G 剩 4G,几个月撑爆)

### 🟡 海外化(参考 AGENTS.md Rule 5,**禁删 NewAPI/QuantumNous 品牌**)

- [ ] 改默认语言为 `en`(`web/default/src/i18n/`,locales 有 en/zh/fr/ru/ja/vi 现成)
- [ ] 在 admin UI 改:站点名(SystemName)、Logo、HomePageContent、Footer
- [ ] 颜色 / 主题(看老板偏好)
- [ ] 不能改:README, license header, HTML title, Go module 路径,docker 镜像名

### 🟡 支付集成

- [ ] PayPal 沙箱测试,账号:`xpwan123@sohu.com` 密码 `Duoduo11`
- [ ] PayPal + 支付宝接入卡密充值流程(类似 nassa-cards 模式)

### 🔵 长期 / 加固

- [ ] MySQL root 密码改强(现 `NewApiR00tPass!` 公网可达,有风险)
- [ ] 启动盘扩容(现 9.7G/4G 余,几个月会撑爆)
  - GCP Console → 磁盘 → 编辑 instance-20260515-093915 启动盘 → 加大(如 30GB),实例不需重启
- [ ] 从 `api.nassaapi.xyz`(107.174.155.17)导 channel/options 配置过来

  ```bash
  ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysqldump -uroot -peZ1rW9jR6mU6uP4b new-api channels options abilities > /tmp/snap.sql'
  scp root@107.174.155.17:/tmp/snap.sql /tmp/
  gcloud compute scp /tmp/snap.sql instance-20260515-093915:/tmp/ --zone=us-central1-a
  gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cat /tmp/snap.sql | sudo docker exec -i mysql mysql -uroot -p"NewApiR00tPass!" new-api'
  ```

- [ ] 监控告警(可借鉴 154/107 已有的 model-health-check 脚本)
- [ ] 是否换成 nassa11111/new-api-hide-model:hide-model 镜像(隐藏上游模型名,跟 107 同步)

---

## 4. 项目政策约束(MUST READ)

`@/Users/w/Desktop/newapi/new-api-fork/AGENTS.md` 关键条目:

- **Rule 1**: JSON 必须用 `common/json.go`,禁止直接 `encoding/json`
- **Rule 2**: 数据库代码必须 SQLite/MySQL/PostgreSQL 同时兼容
- **Rule 3**: 前端 package manager 用 **Bun**(不是 npm/yarn/pnpm)
- **Rule 5**: ⛔️ **禁删 NewAPI / QuantumNous 品牌**(README、license、HTML title、Go 模块路径)— 老板要"海外化"必须**绕开**这条
- **Rule 7**: 改计费表达式必须先读 `pkg/billingexpr/expr.md`

前端架构:

- `web/default/`:**主前端**(React 19, Rsbuild, Base UI, Tailwind),Dockerfile 默认 build 这个
- `web/classic/`:旧前端(React 18, Vite, Semi Design)
- i18n: `web/default/src/i18n/locales/{en,zh,fr,ru,ja,vi}.json`

---

## 5. 危险操作记录(rule 教训)

参考 `@/Users/w/Desktop/newapi/rule/POSTMORTEM_TYPE2_MISDIAGNOSIS_2026_05_10.md` 和 `@/Users/w/Desktop/newapi/rule/MIMO_CHANNEL_CHECKLIST.md`。

本次部署踩过的坑:

1. **首次 new-api 容器 restart loop**:MySQL 还没起好,new-api 直接连失败。原因 = `depends_on` 不等 healthcheck,只等 service start。**已自愈,不需修**。
2. **静态 IP 替换链断**:`delete-access-config` 成功但 `add-access-config` 没跑,实例临时无外部 IP(IAP SSH 还能用)。**修复 = 单步重跑 add-access-config**。
3. **外部 curl 8s 超时**:GCP 路由换 IP 后 propagation 1-2 分钟,**等等就好**,别误判防火墙问题。

---

## 6. 关键命令速查

### 6.1 当前 docker-compose.yml(实例 `/opt/new-api/`)

```yaml
services:
  new-api:
    image: calciumion/new-api:latest
    container_name: new-api
    restart: always
    command: --log-dir /app/logs
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./logs:/app/logs
    environment:
      - SQL_DSN=root:NewApiR00tPass!@tcp(mysql:3306)/new-api
      - REDIS_CONN_STRING=redis://redis
      - TZ=Asia/Shanghai
      - ERROR_LOG_ENABLED=true
    depends_on:
      - redis
      - mysql
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://localhost:3000/api/status | grep -o success"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:latest
    container_name: redis
    restart: always

  mysql:
    image: mysql:8.2
    restart: always
    container_name: mysql
    environment:
      MYSQL_ROOT_PASSWORD: NewApiR00tPass!
      MYSQL_DATABASE: new-api
    volumes:
      - ./mysql_data:/var/lib/mysql
```

### 6.2 装 Caddy + TLS(等域名信息齐再跑)

```bash
DOMAIN="api.老板域名.com"   # 替换成实际域名

gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command="
sudo apt-get update
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy localhost:3000
    encode gzip
}
EOF
sudo systemctl restart caddy
"

# 开 :80 :443 防火墙
gcloud compute firewall-rules create allow-https \
  --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0

# 等 30s Let's Encrypt 签证书,然后验证
sleep 30
curl -sm 10 -o /dev/null -w "HTTP %{http_code}\n" "https://${DOMAIN}/"
```

### 6.3 日常维护

```bash
# 进实例
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a

# 看 NewAPI 日志
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cd /opt/new-api && sudo docker logs --tail 50 new-api'

# 重启 NewAPI
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cd /opt/new-api && sudo docker compose restart new-api'

# 全部容器状态
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cd /opt/new-api && sudo docker compose ps'

# 升级 NewAPI 到最新
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cd /opt/new-api && sudo docker compose pull new-api && sudo docker compose up -d --force-recreate new-api'
```

### 6.4 紧急回滚

```bash
# 释放静态 IP(如果想退订单)
gcloud compute addresses delete newapi-static --region=us-central1

# 恢复成临时 IP
gcloud compute instances delete-access-config instance-20260515-093915 --zone=us-central1-a --access-config-name="External NAT"
gcloud compute instances add-access-config instance-20260515-093915 --zone=us-central1-a --access-config-name="External NAT"

# 完全删除部署
gcloud compute ssh instance-20260515-093915 --zone=us-central1-a --command='cd /opt/new-api && sudo docker compose down -v && sudo rm -rf /opt/new-api'
```

---

## 7. 前端改造工作流(海外化)

```bash
# 本地开发
cd /Users/w/Desktop/newapi/new-api-fork/web/default
bun install
bun run dev   # 起本地开发服务器,改 React 源码

# 改 i18n 默认语言为 en(这一步是真海外化的第一刀)
# 文件:web/default/src/i18n/index.ts (或类似),改 fallbackLng / lng

# 改完打包测试
bun run build  # 生成 dist/

# 把 dist 打回 docker 镜像 — 两条路:
# 路径 A: 改 Dockerfile 里 CMD/ENTRYPOINT,本地 docker build 自己的镜像
docker build -t myname/new-api-overseas:v1 .
docker push myname/new-api-overseas:v1
# 然后改 GCP 实例的 docker-compose.yml image 引用,docker compose pull + up

# 路径 B: 直接改完 commit 到自己的 fork repo(GitHub),用 GitHub Actions build 镜像
# (后续要做时再展开)
```

---

## 8. 联系信息 / 凭证(敏感)

- **GCP 账号**: <z2921477318@gmail.com>
- **PayPal 沙箱**: <xpwan123@sohu.com> / Duoduo11(他老板提供,先做沙箱测试)
- **MySQL 密码**(GCP 实例): `NewApiR00tPass!` ⚠️ 待改强

---

## 9. 文档维护

- 这份文档跟 `new-api-fork/` 一起,**不要 commit 到 NewAPI 上游**(老板自己 fork 的话另说)
- 后续有重大变更(改 Caddy 域名 / 升级 NewAPI 版本 / 添加 channel)请更新本文 §1 快照 + §2 时间线
- 配套阅读:`@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md`(主项目 api.nassaapi.xyz 的总指南)
