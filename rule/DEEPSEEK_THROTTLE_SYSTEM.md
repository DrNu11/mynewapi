# DeepSeek 防倒卖限流系统 — 操作手册

> **目的**:防止 DeepSeek 卡密客户倒卖账号(多 IP 共享 / 高频脚本暴打)。
> **机制**:把所有 DE-* 卡密 token 归入 `de-throttled` 用户组,对该组应用更严格的请求速率限制。
> **创建**:2026-05-25
> **作者**:Cascade

---

## 一、系统组件

```
┌──────────────────────────────────────────────────────────────────┐
│ NewAPI: ModelRequestRateLimit middleware                         │
│   - per-user-id 速率限制(Redis token bucket + sliding window)   │
│   - 按 token.group 应用不同阈值                                  │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 控制
┌─────────────────────────────┴────────────────────────────────────┐
│ status-page (https://status.nassaapi.xyz/) 顶部 toggle 按钮      │
│   - GET /api/admin/throttle  → 查看当前状态                      │
│   - POST /api/admin/throttle → 一键开关(需密码)                 │
│   - 通过 NewAPI admin API 同步内存 + mysql,无需重启 NewAPI      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、当前生产参数

### 2.1 限流总配置

```
ModelRequestRateLimitEnabled         = true           ← 总开关
ModelRequestRateLimitDurationMinutes = 10             ← 时间窗口(滑动)
```

### 2.2 各 user_group 阈值 `[总请求, 成功请求]` / 10 分钟

| Group | 总请求上限 | 成功请求上限 | 折算 RPM(成功) | 典型用户 |
|-------|------------|--------------|------------------|----------|
| default      | 800   | 500   | 50 req/min  | 普通自助客户 |
| vip1         | 1000  | 700   | 70 req/min  | VIP1 客户 |
| vip          | 1000  | 700   | 70 req/min  | VIP 客户 |
| svip         | 2000  | 1500  | 150 req/min | 高净值客户(几乎不限) |
| **de-throttled** | **300** | **150** | **15 req/min** | **DE-* 卡密客户(防倒卖核心)** |
| group        | 400   | 200   | 20 req/min  | 默认 fallback(占位) |

> **说明**:de-throttled 是 15 req/min,等价于约 4-5 个真正并发(假设单请求平均 12 秒)。这比正常 Cursor/Codex 客户的 5-15 req/min 略高,让老实客户感受不到。倒卖商通常 50+ req/min 暴打,会卡死在这条阈值上。

### 2.3 错误信息(v11 之后)

被限流时客户收到:

```json
{
  "error": {
    "message": "太多次并发请求,等一下再试试",
    "type": "openai_error"
  }
}
```

HTTP 状态码:`429 Too Many Requests`。

---

## 三、token group 归属规则

```
DE-* 卡密 token  →  group=de-throttled   (受限)
GP-* 卡密 token  →  group=default        (普通)
CL-* 卡密 token  →  group=default        (普通)
管理员手动建的   →  group 取决于建时配置
高级客户 VIP     →  group=vip / svip
```

### 3.1 自动迁移规则(已执行)

2026-05-25 一次性把所有 `DE-*` 卡密 token(`model_limits_enabled=1 AND model_limits LIKE '%deepseek-v4%'`)从 `default` / `""` group 迁移到 `de-throttled`:

```sql
UPDATE tokens SET `group`='de-throttled'
WHERE model_limits_enabled=1
  AND model_limits LIKE '%deepseek-v4%'
  AND `group` IN ('default','');
-- 一次迁移 151 个 token,共 263 个 token 在 de-throttled
```

### 3.2 未来新卡密的处理(待办,**重要**)

如果你用脚本/UI 创建新的 DE-* 卡密,**默认 group 是 `default`,需要手动改成 `de-throttled`**!

推荐改造方案:
- 在卡密创建脚本里加一行 `group="de-throttled"`(如果 model_name 含 deepseek)
- 或者写一个定时任务:`UPDATE tokens SET group='de-throttled' WHERE name LIKE 'DE-%' AND group='default'`,每天跑一次

---

## 四、操作手册

### 4.1 通过 status-page 网页一键开关

1. 打开 https://status.nassaapi.xyz/
2. 顶部右上角看到:
   ```
   🛡️ DeepSeek 限流: 开启  150/10min · 263 卡  [关闭]
   ```
3. 点 "关闭" / "开启" 按钮
4. 弹出密码框,输入 admin 密码(默认 `changeme-admin`,生产应改 env var)
5. 等待 ~2 秒确认 ✅

### 4.2 通过 SQL 查看当前状态

```sql
-- 看总开关 + 时间窗口
SELECT `key`, value FROM options
WHERE `key` IN (
  'ModelRequestRateLimitEnabled',
  'ModelRequestRateLimitDurationMinutes',
  'ModelRequestRateLimitGroup'
);

-- 看 de-throttled 组里有多少 token(反映限流影响范围)
SELECT COUNT(*) FROM tokens WHERE `group`='de-throttled';

-- 看哪些用户 user_id 在 de-throttled(可能误伤的客户)
SELECT u.id, u.username, u.email, COUNT(t.id) AS tokens
FROM users u JOIN tokens t ON t.user_id=u.id
WHERE t.`group`='de-throttled' AND t.status=1
GROUP BY u.id ORDER BY tokens DESC LIMIT 20;
```

### 4.3 通过 NewAPI admin API 调阈值(无需重启)

```bash
ssh root@207.244.243.12
PASS=$(docker exec newapi-prod-mysql-1 printenv MYSQL_ROOT_PASSWORD)
TOKEN=$(docker exec newapi-prod-mysql-1 mysql -uroot -p$PASS -D new-api -Nse \
  "SELECT access_token FROM users WHERE id=1")

# 例如:把 de-throttled 调到 [500, 250](25 req/min,放宽)
curl -X PUT http://127.0.0.1:3000/api/option/ \
  -H "Authorization: Bearer $TOKEN" -H "New-Api-User: 1" \
  -H "Content-Type: application/json" \
  -d '{"key":"ModelRequestRateLimitGroup","value":"{\"default\":[800,500],\"vip1\":[1000,700],\"vip\":[1000,700],\"svip\":[2000,1500],\"de-throttled\":[500,250],\"group\":[400,200]}"}'

docker exec newapi-prod-redis-1 redis-cli FLUSHDB
```

### 4.4 单个客户特殊处理(临时白名单)

如果某个 DE-* 客户被误伤(老客户长期没倒卖记录),可以临时提级:

```sql
-- 把客户的所有 token 从 de-throttled 提到 default(临时解绑)
UPDATE tokens SET `group`='default'
WHERE user_id=<客户ID> AND `group`='de-throttled';

-- 或更精准:某张 token 单独解绑
UPDATE tokens SET `group`='default' WHERE id=<token ID>;
```

### 4.5 紧急关停限流(整个组放开)

如果发现限流误伤面大,**5 秒紧急救火**:

```bash
# 走 status-page UI:点关闭按钮(需密码)
# 或 SQL:
ssh root@207.244.243.12 "
docker exec newapi-prod-mysql-1 mysql -uroot -p\$(docker exec newapi-prod-mysql-1 printenv MYSQL_ROOT_PASSWORD) -D new-api -e '
UPDATE options SET value=\"false\" WHERE \`key\`=\"ModelRequestRateLimitEnabled\";
'
# 再用 admin API PUT 让内存同步:
TOKEN=\$(docker exec newapi-prod-mysql-1 mysql ... )
curl -X PUT http://127.0.0.1:3000/api/option/ -H 'Authorization: Bearer \$TOKEN' \
  -H 'Content-Type: application/json' -H 'New-Api-User: 1' \
  -d '{\"key\":\"ModelRequestRateLimitEnabled\",\"value\":\"false\"}'
"
```

---

## 五、status-page Toggle 按钮 — 技术细节

### 5.1 后端代码

| 文件 | 作用 |
|------|------|
| `status-page/throttle_admin.py` | 读 mysql + 调 NewAPI admin API 的核心逻辑 |
| `status-page/main.py` | 2 个 FastAPI endpoint: `GET / POST /api/admin/throttle` |
| `status-page/static/index.html` | `ThrottleToggle` Preact 组件 |
| `status-page/docker-compose.yml` | env vars: `STATUS_ADMIN_SECRET` + `NEWAPI_INTERNAL_URL` |

### 5.2 安全设计

- **GET endpoint 公开**(返回当前状态),任何访问 status page 的人都能看
- **POST endpoint 要密码**:`body.secret == STATUS_ADMIN_SECRET`
- 密码错误返 401,不暴露限流配置
- 密码存 env var(`docker-compose.yml`),代码里默认值 `changeme-admin`,**生产应改**

### 5.3 生产密码设置方法

```bash
ssh root@207.244.243.12
cd /opt/nassa-status-page

# 方式 A: 写 .env 文件
cat >> .env <<EOF
STATUS_ADMIN_SECRET=<你的强密码>
EOF

# 方式 B: 直接改 docker-compose.yml,把 ${STATUS_ADMIN_SECRET:-changeme-admin} 替换为强密码

# 重启生效
docker compose up -d --force-recreate status-page
```

### 5.4 工作流程

```
浏览器  ──GET /api/admin/throttle──> status-page
                                        ├─ 查 mysql options 表
                                        └─ 返回 JSON
                                                ↓
                                        前端显示 toggle 按钮

浏览器  点击按钮 → prompt(密码)
浏览器  ──POST /api/admin/throttle──> status-page
                                        ├─ 验证密码
                                        ├─ 调用 NewAPI: PUT /api/option/
                                        │    (NewAPI 同时改 mysql + 内存 state)
                                        └─ 返回新状态
                                                ↓
                                        前端 alert 成功
```

---

## 六、监控与告警

### 6.1 看哪些客户最近被限流(429 命中)

```bash
ssh root@207.244.243.12
docker logs newapi-prod-new-api-1 --since 1h 2>&1 | grep "太多次并发请求" | wc -l
```

### 6.2 看 status-page 已有的"⚠️ 异常告警"section

在 https://status.nassaapi.xyz/ 的 NewAPI 卡片里,会列出:
- 单 IP 高频(> 100 req/5min)的可疑 token
- 多 IP 共享(同 token 出现在 ≥3 个 IP)的可疑 token

这些是**事前发现**机制,可以在限流触发**之前**人工 disable 倒卖 token。

### 6.3 推荐巡检节奏

| 频率 | 检查项 |
|------|--------|
| 实时 | status-page "⚠️ 异常告警" section |
| 每天 | DE-* 新建 token 的 group 是否正确 |
| 每周 | de-throttled 组里被频繁限流的 user_id,确认是否真倒卖 |

---

## 七、回滚 & 调整建议

| 触发 | 操作 |
|------|------|
| 老实客户大量投诉被限流 | status-page 关掉总开关(秒级生效) |
| 想放宽 de-throttled | NewAPI admin API PUT,无需重启(秒级生效) |
| 想加新 group(如 deepseek_premium) | SQL 改 ModelRequestRateLimitGroup JSON + admin API PUT |
| 想完全删除限流功能 | NewAPI 代码层移除 `ModelRequestRateLimit` middleware 调用(需 build) |

---

## 八、改造历史

| 日期 | 改动 | 作者 |
|------|------|------|
| 2026-05-25 13:00 | 启用 ModelRequestRateLimitEnabled,首次设 de-throttled=[60,30] | Cascade |
| 2026-05-25 13:05 | 迁移 151 个 DE-* token 到 de-throttled | Cascade |
| 2026-05-25 13:20 | status-page 加 toggle 按钮(throttle_admin.py + ThrottleToggle 组件) | Cascade |
| 2026-05-25 13:25 | de-throttled 放宽到 [300,150]=15 req/min(客户反馈太严) | Cascade |
| 2026-05-25 13:32 | v11 build:错误信息改为"太多次并发请求,等一下再试试" | Cascade |

---

## 九、相关文档

- `V11_THINK_TAG_STRIPPING_PLAN.md` — v11 build 报告(包含错误信息中文化)
- `INCIDENT_2026_05_25_MIMO_OUTAGE_AND_MINIMAX_FALLBACK.md` — 同期完成的 v9/v10 改造
- `UPSTREAM_DISGUISE_MASTER_DOC.md` — 上游伪装总则

---

**生效状态:** ✅ 生产运行中
**最后更新:** 2026-05-25 13:33 UTC+8
