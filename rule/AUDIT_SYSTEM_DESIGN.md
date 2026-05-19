# 客户对话审计系统 设计文档

> 写于 2026-05-09 18:10。在 cli-proxy-api OAuth 账号被滥用客户搞封号后的应对方案。
> 目标:**全量收集客户的请求 prompt + 模型 response**,用于事后审计、滥用客户识别、提前 ban。

---

## 一、背景与目标

### 1.1 问题背景

老板的 cli-proxy-api(ch8 cpa / ch9 cpa2)上游是用 OAuth 拿真 GPT 的"白嫖"池。最近发生:

- 部分客户做"逆向"(prompt injection / jailbreak / DAN mode 等)
- 客户的恶意 prompt 把上游 OAuth 账号触发 OpenAI 风控 → **账号被封**
- 一旦封号,池子缩水,影响所有客户

### 1.2 设计目标

| 目标 | 优先级 |
|---|---|
| 完整记录每次客户请求的 prompt(messages) + response | 🔴 P0 |
| 完整记录响应内容(包括流式累积、reasoning_content) | 🔴 P0 |
| 简单关键词预检测(标记可疑请求) | 🟡 P1 |
| Web UI 查看 / 过滤 / 标记 / 导出 | 🟡 P1 |
| 客户行为统计(top-N、重复 prompt、按时间分布) | 🟢 P2 |
| 可疑客户自动告警 / 自动 ban | 🟢 P2 |

### 1.3 范围说明

**Phase 1**(MVP,优先实施)— 仅覆盖**卡密客户**(走 `card.nassaapi.xyz`):

- 这类客户大多是陌生人买卡测试,**滥用风险最高**
- 改 `nassa-cards` 应用代码,**不动 NewAPI**,无 18s 中断
- 部署只需 nassa-cards rebuild + pm2 restart

**Phase 3**(后期补)— 覆盖**所有客户**(包括走 `api.nassaapi.xyz` 直连的 admin 直发 token 客户):

- 改 NewAPI 源码加 conversation logging 中间件
- rebuild docker image + 18s 中断风险

---

## 二、数据采集层架构

### 2.1 现状客户路径

```
[Phase 1 覆盖]
卡密客户 → CF → nassa-cards (154:3100) /v1/[...path] → NewAPI (107:3000) → 上游
                       ↑ 这里加 logging hook

[Phase 3 覆盖]
直发客户 → CF → NewAPI (107:3000) → 上游
                       ↑ 这里加 logging middleware
```

### 2.2 Phase 1 拦截点

文件:`@/Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts`

现有逻辑(简化):

```text
1. 解析 Bearer sk-key
2. 查 cards 表认证 + RPH 限速
3. 构造 upstream URL
4. fetch upstream + 透传 stream/response
```

改造后:

```text
1. 解析 Bearer sk-key
2. 查 cards 表认证 + RPH 限速
3. 【新增】解析 request body,提取 model/messages/endpoint,预先 INSERT log(response 字段空)
4. 构造 upstream URL
5. fetch upstream
6. 【新增】根据 stream/非 stream:
    - 非流式:解析 response body,UPDATE log 写 response_text
    - 流式:用 TransformStream 边转发边累积 chunks,流结束后 UPDATE log
7. 【新增】关键词检测(请求和响应都查),flagged + flag_reason 写入
```

---

## 三、数据库设计

### 3.1 表 `conversation_logs`（SQLite，**独立 db 文件** `nassa-cards/data/audit.db`）

> **为什么独立 db**：`cards.db` 是核心业务数据（~5MB，每日备份），audit 数据 1年 ~3.6GB。放在一起会拖慢 cards 查询、每日备份变巨、归档不便。拆独立 db 后：cards 备份仍是秒级；audit 可独立归档/删除；查询互不干扰。)

```sql
CREATE TABLE IF NOT EXISTS conversation_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,             -- 创建时间戳(秒)
  card_id         INTEGER,                       -- 关联 cards.id(可空,容错)
  sk_prefix       TEXT NOT NULL,                 -- sk-key 前 12 + 后 4 脱敏(给 admin 看)
  sk_full_hash    TEXT NOT NULL,                 -- sk-key 全文 sha256(给 admin 关联同一客户)
  ip              TEXT,                          -- 客户真实 IP(从 X-Forwarded-For)
  ua              TEXT,                          -- User-Agent(识别 IDE 类型)
  endpoint        TEXT NOT NULL,                 -- /v1/chat/completions / /v1/responses / /v1/messages
  model           TEXT NOT NULL,                 -- 客户请求的 model 名
  request_messages TEXT NOT NULL,                -- messages JSON 数组(完整,用 json_extract 查询)
  request_size    INTEGER,                       -- request body 字节数(便于排序找大请求)
  response_text   TEXT,                          -- 响应主内容(content 字段)
  reasoning_text  TEXT,                          -- 响应 reasoning_content(thinking 模式)
  response_finish_reason TEXT,                   -- stop / length / tool_calls / content_filter
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  status_code     INTEGER NOT NULL,              -- HTTP 响应 code
  is_streaming    INTEGER DEFAULT 0,             -- 0/1
  duration_ms     INTEGER,                       -- 总耗时
  flagged         INTEGER DEFAULT 0,             -- 0=正常 1=可疑(关键词命中)
  flag_reason     TEXT,                          -- 触发的关键词逗号分隔
  review_status   INTEGER DEFAULT 0,             -- 0=未审 1=审过无问题 2=确认滥用 3=已 ban
  review_note     TEXT,                          -- admin 手写备注
  reviewed_at     INTEGER,
  reviewed_by     TEXT
);

CREATE INDEX idx_conv_ts ON conversation_logs(ts);
CREATE INDEX idx_conv_card ON conversation_logs(card_id);
CREATE INDEX idx_conv_sk_full ON conversation_logs(sk_full_hash);
CREATE INDEX idx_conv_flagged ON conversation_logs(flagged) WHERE flagged = 1;
CREATE INDEX idx_conv_review ON conversation_logs(review_status);
CREATE INDEX idx_conv_endpoint ON conversation_logs(endpoint);
CREATE INDEX idx_conv_status_code ON conversation_logs(status_code);
```

### 3.2 字段说明

| 字段 | 用途 |
|---|---|
| `sk_prefix` | 给 admin UI 显示的脱敏 key,如 `sk-abc...xyz9` |
| `sk_full_hash` | 把同一客户多次请求关联起来(不暴露完整 key) |
| `request_messages` | 整个 messages 数组 JSON,审计核心数据 |
| `response_text` + `reasoning_text` 分开 | 客户在 thinking 上玩花活就 reasoning_text 长 |
| `flagged` + `flag_reason` | 写入时关键词检测,后期可加 ML 模型 |
| `review_status` | admin 手动标记;0/1/2/3 状态机 |

### 3.3 数据增长预估

| 量级 | 单条平均 | 月增长 |
|---|---|---|
| 100 客户 × 50 请求/天 = 5000 条/天 | 5KB(messages) + 2KB(response) = 7KB | ~1GB/月 |

→ SQLite 完全可承受。**保留策略建议**:30 天后归档,90 天后删除(配 cron 脚本)。

---

## 四、代理层代码改动(Phase 1)

### 4.1 lib/audit.ts（新建）

**使用独立 db connection**，避免与 cards 主业务表争抢 WAL lock：

```ts
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';

let auditDb: Database.Database | null = null;
let auditDbHealthy = false;

export function audit(): Database.Database | null {
  if (auditDb) return auditDbHealthy ? auditDb : null;
  try {
    const dbPath = path.join(process.env.DATA_DIR ?? './data', 'audit.db');
    auditDb = new Database(dbPath);
    auditDb.pragma('journal_mode = WAL');
    auditDb.pragma('synchronous = NORMAL');
    initAuditSchema(auditDb);
    auditDbHealthy = true;
    return auditDb;
  } catch (err) {
    // 关键：audit 初始化失败不能 crash nassa-cards 主服务
    console.error('[audit] init failed, audit disabled:', err);
    auditDbHealthy = false;
    return null;
  }
}

function initAuditSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_logs (...);`);  // 见 3.1 schema
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_ts ON conversation_logs(ts);`);
  // ...其他索引
}

export interface AuditEntry {
  card_id: number | null;
  sk_key: string;
  ip: string | null;
  ua: string | null;
  endpoint: string;
  model: string;
  request_messages: any;
  request_size: number;
  is_streaming: boolean;
  status_code: number;
}

export interface AuditUpdate {
  response_text?: string;
  reasoning_text?: string;
  response_finish_reason?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  duration_ms?: number;
  flagged?: number;
  flag_reason?: string;
}

function maskSkKey(sk: string): string {
  if (sk.length <= 16) return sk;
  return `${sk.slice(0, 12)}...${sk.slice(-4)}`;
}

function hashSkKey(sk: string): string {
  return crypto.createHash('sha256').update(sk).digest('hex').slice(0, 32);
}

export function insertAuditEntry(entry: AuditEntry): number {
  const stmt = db().prepare(`
    INSERT INTO conversation_logs
    (ts, card_id, sk_prefix, sk_full_hash, ip, ua, endpoint, model,
     request_messages, request_size, is_streaming, status_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    Math.floor(Date.now() / 1000),
    entry.card_id,
    maskSkKey(entry.sk_key),
    hashSkKey(entry.sk_key),
    entry.ip,
    entry.ua,
    entry.endpoint,
    entry.model,
    JSON.stringify(entry.request_messages),
    entry.request_size,
    entry.is_streaming ? 1 : 0,
    entry.status_code,
  );
  return info.lastInsertRowid as number;
}

export function updateAuditEntry(id: number, update: AuditUpdate): void {
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(update)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return;
  values.push(id);
  db().prepare(`UPDATE conversation_logs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// =========================================================================
// 多 endpoint 请求格式 提取 prompt 文本
// OpenAI /v1/chat/completions: messages: [{role, content: string}]
// Anthropic /v1/messages:        messages: [{role, content: string | ContentBlock[]}]
// codex /v1/responses:           input: string | InputItem[]
// =========================================================================
export function extractPromptText(
  endpoint: string,
  body: any,
): { text: string; structured: any } {
  // codex /v1/responses
  if (endpoint.includes('/responses')) {
    const input = body.input;
    if (typeof input === 'string') return { text: input, structured: input };
    if (Array.isArray(input)) {
      const text = input.map((item: any) => {
        if (typeof item === 'string') return item;
        if (item?.content) return JSON.stringify(item.content);
        return JSON.stringify(item);
      }).join('\n');
      return { text, structured: input };
    }
    return { text: '', structured: input ?? null };
  }

  // OpenAI / Anthropic messages
  const messages = body.messages;
  if (!Array.isArray(messages)) return { text: '', structured: null };

  const text = messages.map((m: any) => {
    if (typeof m.content === 'string') return `[${m.role}] ${m.content}`;
    if (Array.isArray(m.content)) {
      // Anthropic content blocks: [{type:'text', text:...}, {type:'image', source:...}]
      const parts = m.content.map((c: any) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'image') return '[image]';
        if (c.type === 'tool_use') return `[tool_use:${c.name}]`;
        if (c.type === 'tool_result') return `[tool_result]`;
        return JSON.stringify(c);
      }).join(' ');
      return `[${m.role}] ${parts}`;
    }
    return `[${m.role}] ${JSON.stringify(m.content)}`;
  }).join('\n');

  return { text, structured: messages };
}

export function normalizePromptHash(structured: any): string {
  // 处理同样 prompt 不同顺序 / 空格不同 的 hash
  const norm = JSON.stringify(structured)
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

// 简单关键词检测,触发返回 reason 列表
const SUSPICIOUS_KEYWORDS = [
  'ignore previous instructions',
  'ignore the above',
  'forget your instructions',
  'forget the above',
  'system prompt',
  'developer mode',
  'DAN mode',
  'jailbreak',
  'jail break',
  'do anything now',
  '越狱',
  '逆向',
  '绕过限制',
  '忽略上述指令',
  '忽略以上指令',
  '忽略之前',
  '把自己当成',
  '扮演 root',
  'sudo mode',
];

export function detectSuspicious(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const kw of SUSPICIOUS_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits;
}
```

### 4.2 不动 cards.db schema

原设计是加到 `lib/db.ts` initSchema，现在拆独立 db 后，**`audit.ts` 里的 `audit()` 函数自己负责 schema 初始化**，不要动 `cards.db`。

这样仍然有价值。原因：

- `cards.db` schema 不变 → 不需加载时 migration 风险
- audit 表结构被隔离 → 后期改 schema 不影响主业务

### 4.3 v1/[...path]/route.ts 改造伪代码

```ts
// 原有 1-7 步:解析 sk + 鉴权 + RPH 检查 + 构造 url ...

// 【新增 8】解析 request body 用于 audit
const reqBodyText = await req.text();         // 原来用 req.body 透传,改成先读出来
const reqBodyJson = JSON.parse(reqBodyText);
const auditId = insertAuditEntry({
  card_id: card.id,
  sk_key: sk,
  ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  ua: req.headers.get('user-agent'),
  endpoint: `/${pathParts.join('/')}`,
  model: reqBodyJson.model ?? 'unknown',
  request_messages: extractPromptText(`/${pathParts.join('/')}`, reqBodyJson).structured,
  request_size: reqBodyText.length,
  is_streaming: !!reqBodyJson.stream,
  status_code: 0,  // 占位,后面 update
});

// 关键词检测(请求阶段)
const requestText = JSON.stringify(reqBodyJson.messages ?? reqBodyJson.input ?? '');
const reqHits = detectSuspicious(requestText);

const startTime = Date.now();

// 【原有】fetch upstream
const upstreamRes = await fetch(url, { method, headers: fwHeaders, body: reqBodyText, ... });

// 【新增 9】响应处理分流
if (reqBodyJson.stream) {
  // 流式:用 TransformStream 边转发边累积
  let accContent = '';
  let accReasoning = '';
  const ts = new TransformStream({
    transform(chunk, ctrl) {
      ctrl.enqueue(chunk);
      const text = new TextDecoder().decode(chunk);
      // 解析 SSE data: { ... } 行,累积 delta.content / delta.reasoning_content
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const obj = JSON.parse(line.slice(6));
          const delta = obj.choices?.[0]?.delta;
          if (delta?.content) accContent += delta.content;
          if (delta?.reasoning_content) accReasoning += delta.reasoning_content;
        } catch {}
      }
    },
    flush() {
      // 流结束,update audit
      const respHits = detectSuspicious(accContent + accReasoning);
      const allHits = [...new Set([...reqHits, ...respHits])];
      updateAuditEntry(auditId, {
        response_text: accContent,
        reasoning_text: accReasoning,
        duration_ms: Date.now() - startTime,
        status_code: upstreamRes.status,
        flagged: allHits.length > 0 ? 1 : 0,
        flag_reason: allHits.join(','),
      });
    },
  });
  return new Response(upstreamRes.body!.pipeThrough(ts), {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
}

// 非流式:body 整个读完
const respText = await upstreamRes.text();
let respJson: any = null;
try { respJson = JSON.parse(respText); } catch {}
const content = respJson?.choices?.[0]?.message?.content ?? '';
const reasoning = respJson?.choices?.[0]?.message?.reasoning_content ?? '';
const respHits = detectSuspicious(content + reasoning);
const allHits = [...new Set([...reqHits, ...respHits])];
updateAuditEntry(auditId, {
  response_text: content,
  reasoning_text: reasoning,
  response_finish_reason: respJson?.choices?.[0]?.finish_reason ?? null,
  prompt_tokens: respJson?.usage?.prompt_tokens ?? null,
  completion_tokens: respJson?.usage?.completion_tokens ?? null,
  duration_ms: Date.now() - startTime,
  status_code: upstreamRes.status,
  flagged: allHits.length > 0 ? 1 : 0,
  flag_reason: allHits.join(','),
});
return new Response(respText, { status: upstreamRes.status, headers: upstreamRes.headers });
```

### 4.4 关键陷阱

1. **req.body 只能读一次**:必须先 `await req.text()` 转 string,再 `JSON.parse` + 拿原 string 给 fetch body
2. **流式必须用 TransformStream**,不能 `await body.text()` 否则破坏 SSE 实时性
3. **audit 失败不影响主流程**:全部 try/catch 包住,DB 写入异常不抛。`audit()` 返回 `null` 时跳过记录
4. **schema migration 失败不 crash 主服务**:`audit()` 构造出错只记 `console.error`,返 null 让主代理继续跑(不记录胜过服务挂掉)
5. **多 endpoint 格式**:一定调 `extractPromptText(endpoint, body)` 抽取 prompt,不能直接拿 `body.messages` — Claude `/v1/messages` content 是 blocks 数组,codex `/v1/responses` 用 `input` 字段
6. **大请求体限制**:Next.js 默认 body 4MB,超过 reject。同时 sqlite TEXT 字段虽然能存 1GB,但建议 `request_messages` 截断到 200KB
7. **异步写入**:不阻塞 response,可以 setImmediate 后写
8. **内存压力**:流式累积 accContent + accReasoning 在内存。高并发 + 长输出可能 OOM(154 内存须预检查,见 8.0)。建议单请求累积超 200KB 就装不下新 chunk(仅 forward 不累积)

---

## 五、Web 审计 UI(Phase 2)

### 5.1 路径

`@/Users/w/Desktop/newapi/nassa-cards/app/admin/audit/page.tsx`(新建)

### 5.2 功能列表

| 功能 | 优先级 |
|---|---|
| 列表分页(默认按时间倒序,每页 50) | P0 |
| 过滤:时间范围、flagged=1、status_code、endpoint、model、sk_full_hash(同一客户) | P0 |
| 详情弹窗:展开看完整 messages + response | P0 |
| 关键词高亮(命中的关键词标红) | P1 |
| 标记 review_status(下拉切换 0→3) | P1 |
| 同一 sk_full_hash 一键查所有历史 | P1 |
| 导出 CSV / JSON(限当前过滤结果) | P2 |
| 客户排行:top 10 高 token / top 10 flagged 数 | P2 |

### 5.3 后端 API

```
GET /api/admin/audit?page=1&size=50&flagged=1&from=...&to=...&sk_hash=...
GET /api/admin/audit/:id  (详情,含完整 messages/response)
POST /api/admin/audit/:id/review  body: { status, note }
GET /api/admin/audit/stats?range=24h  (聚合统计)
```

---

## 六、Phase 3:NewAPI 源码改造

### 6.1 改造点

`@/Users/w/Desktop/newapi/build-workspace/new-api/middleware/distributor.go` 后,
或在 `@/Users/w/Desktop/newapi/build-workspace/new-api/relay/` 写一个 `audit_middleware.go`,
拦截 request + response,写入新表。

### 6.2 数据库

NewAPI 用 MySQL,可直接加表 `conversation_logs`(同 schema)。
**或者**:让 NewAPI 通过 HTTP POST 把 audit 数据推到 nassa-cards 的 `/api/admin/audit/ingest`,
统一写到 sqlite — 避免维护两套数据源。**推荐后者**。

### 6.3 部署

- mac 本地 build → save → scp → 107 load → up -d(参考 PROJECT_GUIDE 部署铁律)
- 18s 中断窗口,提前公告

---

## 七、隐私 / 合规

### 7.1 ToS 增加条款

需要在 `card.nassaapi.xyz` 主页 + 卡密激活页加一行说明:

> 为保障服务质量与防滥用,所有 API 调用的请求与响应内容会被服务方记录并保留 90 天,期间仅用于审计和反滥用,不会用于训练或对外披露。

### 7.2 数据保护

- sqlite db 文件:`/opt/nassa-cards/data/cards.db`,**只允许 root 访问**
- 备份策略:每日 `sqlite3 .backup` 到 `/var/backups/nassa-cards/`,保留 7 天
- admin web UI 必须有登录(已有 cookie session 机制)

### 7.3 数据保留

- 30 天后自动归档(导出到 `/var/archives/nassa-cards/audit_YYYYMM.jsonl.gz`)
- 90 天后从 sqlite 删除
- cron:`0 3 * * * /opt/nassa-cards/scripts/audit-archive.sh`

---

## 八、实现步骤(明天/后天逐步)

### Step 0:先决检查(~5 min,动手前必跑)

```bash
# 1. 154 内存余量 — 决定流式累积上限
ssh root@154.64.231.223 'free -h'
# 如果 total = 1G,可用 < 300M → 流式累积上限调为 100KB(默认 200KB 太大)
# 如果可用 > 1G → 默认 200KB OK

# 2. 磁盘余量 — audit.db 预估 1年 3.6GB
ssh root@154.64.231.223 'df -h /opt'
# 可用 < 10G 严重 — 考虑调 30 天归档期为 7 天

# 3. better-sqlite3 已安装(应该已装)
ssh root@154.64.231.223 'cd /opt/nassa-cards && cat package.json | grep better-sqlite3'
```

### Step 1:Phase 1 数据采集(~30 min)

1. 写 `lib/audit.ts`(`audit()` 自己初始化 audit.db schema + insertAuditEntry / updateAuditEntry / detectSuspicious / maskSkKey / hashSkKey / extractPromptText / normalizePromptHash)
2. 改 `app/v1/[...path]/route.ts` 加 logging hook(请求时 insert,响应时 update)— 流式用 TransformStream,非流式直接 update
3. 本地 build → npm run dev 用 fake key + curl 流式/非流式都跑通
4. 部署到 154 → 验证一次卡密客户调用后 audit.db 有记录

**验证**:

```bash
ssh root@154.64.231.223 "sqlite3 /opt/nassa-cards/data/audit.db 'SELECT COUNT(*), MAX(ts), SUM(flagged) FROM conversation_logs;'"
```

### Step 2:Phase 2 Web UI(~60 min)

1. 写 `app/api/admin/audit/route.ts`(分页 + 过滤)
2. 写 `app/api/admin/audit/[id]/route.ts`(详情 + review)
3. 写 `app/admin/audit/page.tsx`(列表 + 过滤 + 详情弹窗)
4. 在 admin layout 加 nav 入口
5. 部署 + 浏览器测试

### Step 3:cron 归档脚本(~15 min)

1. 写 `scripts/audit-archive.sh`(导出 30+ 天 + 删 90+ 天)
2. crontab 注册

### Step 4:Phase 3 NewAPI 改造(~2 小时 + 18s 中断)

1. 写 NewAPI middleware audit_middleware.go,POST 到 nassa-cards ingest
2. 写 nassa-cards `app/api/admin/audit/ingest/route.ts`(接收 NewAPI 推送)
3. mac build → save → scp → 107 load → up -d
4. 验证全量覆盖

---

## 九、风险与注意事项

| 风险 | 影响 | 缓解 |
|---|---|---|
| audit DB 写入失败导致客户请求失败 | 🔴 阻塞客户 | 全部 try/catch,失败只 console.error 不抛 |
| 大流式响应内存累积 | 🟡 OOM 风险 | TransformStream 边收边写,累积变量限制 200KB |
| sqlite WAL 增长占盘 | 🟡 占盘 | 定期 `PRAGMA wal_checkpoint` |
| 关键词命中误杀(正当 prompt 含 "system prompt") | 🟢 误标 | 标记仅供 review,不自动 ban;后期换 ML |
| 老客户 ToS 没同意就被记录 | 🟡 合规 | 部署前主页加公告;一键告知 |
| nassa-cards 进程崩溃丢失内存中流式累积 | 🟢 偶发 | 每条 record 流结束才 update,崩溃只丢这一条 |

---

## 十、相关文档

- `@/Users/w/Desktop/newapi/rule/PROJECT_GUIDE.md` — 项目运维总指南
- `@/Users/w/Desktop/newapi/rule/CODEX_RESPONSES_ENDPOINT.md` — codex endpoint 与 channel 路由专题
- `@/Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts` — Phase 1 改造目标
- `@/Users/w/Desktop/newapi/nassa-cards/lib/db.ts` — Phase 1 schema 注册位置

---

**给明天的我**:

> 这个文档给的是**蓝图**,不是 final code。开始写代码前再读一遍 schema 和代码改造伪代码,有疑问停下来确认,**不要凭"觉得对"就硬上**。
> Phase 1 的核心是 v1/[...path]/route.ts 的 TransformStream 流式累积 + audit 异步写入,这块**最容易写 bug** — 必须本地先用 fake key + curl stream 跑通再部署。
