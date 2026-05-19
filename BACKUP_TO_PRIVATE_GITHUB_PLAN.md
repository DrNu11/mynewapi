# 推送 /Users/w/Desktop/newapi 到 GitHub 私库 - 备份计划书

> 编写时间: 2026-05-19
> 目标: 整个目录推到 GitHub 私库做异地备份, 仅本人可见。
> 现状: 4 GB / 28 个顶层条目 / 还不是 git repo / 含大量敏感数据。

---

## 0. 风险底线 (一句话)

**私库 ≠ 安全箱**。GitHub 员工有访问权, 账号被盗一次性全部曝光, 历史上多次出现 "private 误改 public" 事故。
所以**最高敏感数据 (能立刻造成损失的) 仍然不进 git**, 改用本地加密 zip + 云盘冷备。

---

## 1. 现状盘点 (诊断结果)

### 1.1 目录规模
| 项 | 大小 |
|---|---|
| 总计 | ~4 GB |
| `build-workspace/` (newapi fork 含构建产物) | **1.6 GB** |
| `nassa-cards/node_modules/` | 371 MB |
| `nassaapi-frontend/node_modules/` | 373 MB |
| `newapi的合作方/node_modules/` | 363 MB |
| `openclaw-admin/node_modules/` | 298 MB |
| `model-health-check/node_modules/` | 266 MB |
| `backups/` | 112 MB |
| 真正的源码 (不含 node_modules / build) | **~50 MB** |

**所以: 把 node_modules / 构建产物排除掉, repo 会从 4GB 缩到 ~200 MB, 完全在 GitHub 推荐范围 (单 repo < 5GB, 单文件 < 100MB) 内。**

### 1.2 敏感数据分布 (按风险等级)

#### 🔴 Tier 1 — 必须独立加密备份, 绝不进 git
| 文件 | 含什么 | 一旦泄露 |
|---|---|---|
| `nassa-cards/.env.local` | `NEWAPI_ACCESS_TOKEN=AZjgMxsxEDTo8ZevDwkOW/8CFa5PGbA=` | 攻击者可以以你 admin 身份调 NewAPI 所有管理接口 |
| `model-health-check/.env.local` | `NASSA_API_KEY=sk-m7bBGCpCVHH6etzl1xDaGMjTc083Cmk2CXIh4mJrn3laAkxz` | 真实的 sk-key, 能直接消费配额 |
| `nassaapi-frontend/.env.local` | `ADMIN_PASSWORD=5201314Zangqi` | NewAPI 后台管理员密码 |
| `.env.local` (顶层) | `admin2/deepseek2` 备用管理员密码 | NewAPI 后台 |
| `upgrade-api/.env` | 鉴权随机串 | upgrade-api 服务被冒充 |
| `nassa-cards/data/cards.db` | 全部客户卡密 (sk-xxx) + 订单 | **业务核心数据**, 客户配额全暴露 |
| `nassaapi-frontend/data/redemptions.db` | 兑换记录 | 客户隐私 |
| `backups/audit.db` | 对话审计日志 | 客户对话内容 |
| `build-workspace/new-api/one-api.db` | newapi 本地 dev 数据库 | 含 dev 期间的 key/user |
| `xianyu-auto-reply-fix/data/.secret_encryption.key` | 闲鱼加密密钥 | 闲鱼数据解密 |
| `xianyu-auto-reply-fix/data/xianyu_data.db` | 闲鱼业务数据 | 闲鱼订单泄露 |
| `upgrade-api/data/upgrade.db` | 升级记录 | 业务数据 |

#### 🟡 Tier 2 — 推私库 OK, 但要知道里面有什么
| 类别 | 例子 | 风险 |
|---|---|---|
| 服务器 IP 硬编码 | `107.174.155.17`, `154.64.231.223`, `207.244.243.12` 出现在 **29 个文件 127 处** | 知道你 VPS 位置, 可被针对性扫端口攻击 |
| 部署脚本 | `deploy-107-v5.sh` 等 | 暴露架构, 但没密码 |
| incident postmortem | `rule/INCIDENT_*.md` 等 | 业务细节, 商业敏感 |
| 客户 token 名 | 文档里写过 `GP-ZDT9-G2FU-DNMZ` 等卡密前缀 | 卡密前缀本身没用 (需要完整 + 服务端校验) |

#### 🟢 Tier 3 — 完全可以推
- 源码 (你自己写的 + 修改的 newapi fork)
- 文档 (rule/)
- 配置模板 (`.env.local.example`)
- skill 收藏 (mattpocock-skills/)

#### ⚫ Tier 4 — 不推, 推了纯浪费空间
- `node_modules/` (能 npm install 重装)
- `.next/`, `dist/`, `build/` (构建产物)
- `*.tsbuildinfo`, `.DS_Store`, `Thumbs.db` (系统/工具垃圾)
- `build-workspace/new-api/web/default/dist/`, `build-workspace/new-api/data/` (constr 产物 + 测试 db)

---

## 2. 实施方案

### 2.1 总策略 - 三道闸门

```
所有文件
  ├── [闸门 1: .gitignore]  → Tier 1 + Tier 4 直接屏蔽, 不进 git
  ├── [闸门 2: 推送前扫描]  → gitleaks/grep 扫一遍, 防漏网
  └── [闸门 3: 独立加密备份] → Tier 1 单独打加密 zip 放到云盘
                              (不依赖 GitHub, 不依赖私库设置)
```

### 2.2 .gitignore (闸门 1)

放到 `/Users/w/Desktop/newapi/.gitignore`:

```gitignore
# === 系统垃圾 ===
.DS_Store
Thumbs.db
*.swp
*~

# === 依赖 (能重装) ===
node_modules/
**/node_modules/

# === 构建产物 ===
.next/
**/.next/
dist/
**/dist/
build/
**/build/
out/
**/out/
*.tsbuildinfo

# === Go 构建产物 ===
build-workspace/new-api/one-api
build-workspace/new-api/new-api
build-workspace/new-api/*.exe
build-workspace/new-api/data/

# === 环境变量 (Tier 1, 绝对屏蔽) ===
.env
.env.local
.env.production
.env.*.local
!.env.example
!.env.local.example
!.env.*.example

# === 数据库 (Tier 1, 客户/业务数据) ===
*.db
*.db-journal
*.db-wal
*.db-shm
*.sqlite
*.sqlite3
*.sqlite-journal
data/*.db
data/*.sqlite*
**/data/*.db
**/data/*.sqlite*

# === 私钥/证书 ===
*.pem
*.key
*.p12
*.pfx
id_rsa*
id_ed25519*
.secret_encryption.key
**/.secret*

# === 日志 (含敏感请求) ===
*.log
logs/
**/logs/

# === 临时脚本备份 ===
*.bak
.bak-*/
**/.bak-*/

# === IDE 配置 ===
.idea/
.vscode/
.windsurf/

# === 备份目录 (太大, 单独保管) ===
backups/

# === Python 缓存 ===
__pycache__/
*.pyc
*.pyo
.pytest_cache/
```

### 2.3 推送前扫描脚本 (闸门 2)

放到 `/Users/w/Desktop/newapi/scripts/preflight-check.sh`:

```bash
#!/usr/bin/env bash
# 推 GitHub 前的最后一道安全扫描
set -e
cd "$(dirname "$0")/.."

echo "=== 1. 列出 git 实际会推的文件中含 .env / .db / .key 的 (应为空) ==="
git ls-files | grep -E '\.(env|db|key|pem|sqlite[0-9]*)$' || echo "✓ 无敏感文件"

echo ""
echo "=== 2. 扫描 git 暂存区里的 sk-xxx token (除模板/文档) ==="
git ls-files | xargs grep -lE 'sk-[a-zA-Z0-9_-]{30,}' 2>/dev/null | grep -v -E '\.(md|example)$' || echo "✓ 无硬编码 sk-key"

echo ""
echo "=== 3. 扫描 git 暂存区里的密码字符串 ==="
git ls-files | xargs grep -lE '(password|passwd).*=.*[A-Za-z0-9]{8,}' 2>/dev/null | grep -v -E '\.(md|example)$' || echo "✓ 无明文密码"

echo ""
echo "=== 4. 仓库总大小 ==="
git ls-files | xargs du -ch 2>/dev/null | tail -1
```

### 2.4 Tier 1 独立加密备份 (闸门 3)

```bash
# 在本地打加密 zip, 不放 git
cd /Users/w/Desktop/newapi
zip -r --encrypt /Users/w/Documents/newapi-secrets-$(date +%Y%m%d).zip \
  .env.local \
  nassa-cards/.env.local \
  nassa-cards/data/cards.db \
  nassaapi-frontend/.env.local \
  nassaapi-frontend/data/redemptions.db \
  model-health-check/.env.local \
  openclaw-admin/.env.local \
  upgrade-api/.env \
  upgrade-api/data/upgrade.db \
  backups/audit.db \
  build-workspace/new-api/one-api.db \
  xianyu-auto-reply-fix/data/
# 会提示输密码, 用强密码, 自己记好
# 把这个 zip 传到 iCloud / Google Drive / 移动硬盘
```

---

## 3. 实施步骤 (按顺序)

### Step 1: 备份现状 (5 分钟)
```bash
# 整个目录复制一份到外部硬盘, 万一中间步骤出错能回滚
cp -a /Users/w/Desktop/newapi /Volumes/外部硬盘/newapi-pristine-$(date +%Y%m%d)
```

### Step 2: 创建 Tier 1 加密备份 (5 分钟)
执行上面 2.4 的 zip 命令。**确认 zip 能用密码打开**, 然后才能进 Step 3。

### Step 3: 创建 .gitignore (1 分钟)
把 2.2 的内容写入 `/Users/w/Desktop/newapi/.gitignore`。

### Step 4: 初始化 git + 第一次 add (5 分钟)
```bash
cd /Users/w/Desktop/newapi
git init
git branch -m main

# 先 add 但不 commit, 看看 git 会推什么
git add .
git status --short | wc -l   # 看会推多少个文件
git ls-files | head -50       # 抽查文件列表
```

### Step 5: 跑 preflight check (2 分钟)
```bash
bash scripts/preflight-check.sh
```
**必须四项全部通过才能 Step 6**。如果有漏网, 补 .gitignore 重新 add。

### Step 6: 首次 commit (1 分钟)
```bash
git config user.name "你的名字"
git config user.email "你的邮箱"
git commit -m "Initial backup of newapi workspace"
```

### Step 7: 创建 GitHub 私库 + 推送 (5 分钟)
```bash
# 在 GitHub 网页上创建 private repo: newapi-backup (不要勾 README/license)
# 然后:
git remote add origin git@github.com:你的用户名/newapi-backup.git
git push -u origin main
```

### Step 8: 验证 (3 分钟)
- 打开 GitHub repo 网页, 翻 5-10 个文件, **确认没有 .env / .db / 真 sk-key**
- 确认 repo 标记为 🔒 Private
- 检查 Settings → Manage access, 只有你自己

### Step 9: 设定增量备份节奏 (持续)
```bash
# 之后每周 / 每次大改后:
cd /Users/w/Desktop/newapi
git add -A
git commit -m "$(date +%Y-%m-%d) snapshot"
git push
```

Tier 1 数据每月重新打 zip 备份一次 (因为业务 db 在变)。

---

## 4. 推送后再加保险 (可选但强烈推荐)

### 4.1 GitHub 账号安全
- [ ] 开启 **2FA** (Settings → Password and authentication → 2FA), 推荐用硬件 key 或 TOTP
- [ ] 把 SSH key 替换成 **passphrase 加密的 ed25519 key**
- [ ] 检查 Authorized OAuth Apps / Personal access tokens, 删掉不用的
- [ ] 开启 **登录通知** (Email me about: any login from a new device)

### 4.2 仓库设置
- [ ] Settings → General → Default branch 设为 main
- [ ] Settings → Branches → 给 main 加 protection rule (防误 force push)
- [ ] Settings → Code security → 开启 **Secret scanning** (GitHub 自动扫泄露的 key, 如果不小心提交了能告警)

### 4.3 本地最后一道保险
```bash
# 在仓库装 gitleaks pre-commit hook, 提交前自动扫
brew install gitleaks
cd /Users/w/Desktop/newapi
gitleaks protect --staged --verbose  # 每次 commit 前手动跑
```

---

## 5. 如果以后真不小心 commit 了密钥, 怎么办

### 5.1 紧急止血 (优先级 1)
**第一时间撤销 / 轮换被泄露的 key**, 不是先去删 git 历史。
- NewAPI access token → 后台 → 重新生成
- sk-key → NewAPI 删除该 token
- 服务器 SSH key → 服务器 `~/.ssh/authorized_keys` 删除对应行
- 密码 → 改密码

### 5.2 清理 git 历史 (优先级 2)
```bash
# 用 git-filter-repo (比 BFG 更现代)
brew install git-filter-repo
git filter-repo --path nassa-cards/.env.local --invert-paths
git push --force origin main
```

但**记住**: 即使 force push, GitHub 旧 commit 在 cache 里可能还能访问几小时到几天, 所以**轮换 key 永远比清历史更重要**。

---

## 6. 决策表 (可以现在就回答的)

| 问题 | 默认建议 | 你的决定 |
|---|---|---|
| 仓库名 | `newapi-backup` | ? |
| 用现有 GitHub 账号还是新建专用账号 | 现有账号 + 2FA | ? |
| 备份频率 | 大改后手动 push, 每周至少一次 | ? |
| Tier 1 加密 zip 放哪 | iCloud Drive (跟着 Apple ID 走) | ? |
| 是否 enable GitHub Secret scanning | 是 | ? |
| 是否装 gitleaks pre-commit hook | 是 (推荐) | ? |

---

## 7. 总结 (TL;DR)

1. **不能进 git**: `.env*` / `*.db` / `*.key` / `*.pem` / `node_modules` / 构建产物 → .gitignore 屏蔽
2. **必须独立加密备份**: Tier 1 那批 (.env.local + .db + .secret_encryption.key) → 打加密 zip 放云盘
3. **能进私库**: 源码 + 文档 + 部署脚本 (虽然里面有 IP, 但私库可以接受)
4. **推之前**: 跑 preflight-check.sh, 4 项全过才 push
5. **推之后**: 开 2FA + Secret scanning, 别把 private 改成 public

**预计耗时**: 25 分钟全部走完。
**最大风险**: 你 GitHub 账号被盗 (所以 2FA 必开)。
