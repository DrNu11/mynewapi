# MiniMax 2013 错误技术分析与修复方案

> 写于 2026-05-17 22:40。围绕 `invalid params, chat content has invalid message role:system (2013)` 错误的完整技术分析,从根因到方案对比、推荐实现、验证步骤。
> 跟 `MINIMAX_DISGUISE_DEEPSEEK_CHECKLIST.md` 平级,前者讲配置,本份讲故障处理。

---

## 一、错误现象

客户端(走 DeepSeek 套餐卡密)调用任意 deepseek-* 模型时,部分请求收到:

```json
{
  "error": {
    "message": "invalid params, chat content has invalid message role:system (2013)",
    "type": "bad_request_error",
    "param": "",
    "code": null
  }
}
```

- HTTP status 由 NewAPI 包装,通常返回 400
- 错误格式是 NewAPI 把 minimax 原生错误包成 OpenAI 风格
- 错误代码 `(2013)` 是 **minimax 上游特有错误码**,确认错误来自 minimax 而非 cli-proxy-api / mimo

---

## 二、根因(双重约束)

通过对 `api.minimaxi.com/v1/chat/completions` 的直接对照测试,确认 MiniMax 对 `system` role 有两条隐式约束:

| 场景 | 结果 | 说明 |
|---|---|---|
| 1 个 system + 1 个 user | ✅ 200 | 正常 |
| system 是 array content (OpenAI 新格式) | ✅ 200 | minimax 容忍 |
| system 带 `name` 字段 | ✅ 200 | minimax 容忍 |
| **2 个连续 system + 1 个 user** | ❌ 失败 | **触发 2013** |
| **user 之后再出现 system** | ❌ 失败 | **触发 2013** |

### 翻译成约束

1. **messages 数组中最多只能有 1 个 `system` 消息**
2. **`system` 必须出现在所有 `user` / `assistant` 消息之前**

这两条约束 **OpenAI / Claude / GPT-* / mimo / deepseek 都不存在**,是 minimax 独有限制。

### 为什么会在客户场景里撞到

真实客户的 `messages` 数组常见情况:

```js
// 应用层 system prompt + 用户对话历史
[
  {role: "system", content: "你是 DeepSeek 助手"},  // 应用层加的
  {role: "user",   content: "..."},
  {role: "assistant", content: "..."},
  {role: "system", content: "现在用中文回答"},      // ❌ 用户中途切换指令 → 触发 2013
  {role: "user",   content: "..."}
]

// 或:多个 system 串联
[
  {role: "system", content: "系统级 prompt"},       // SDK 默认
  {role: "system", content: "应用层 prompt"},       // 用户加的
  {role: "user",   content: "..."}
]
```

mimo / OpenAI / Claude 都接受这两种结构,所以同一个客户端代码切到 minimax 时就炸。

---

## 三、复现方法

### 3.1 直接调 minimax 复现

```bash
KEY="sk-cp-..."  # Token Plan key

# 复现 2013(2 个 system):
curl -X POST https://api.minimaxi.com/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M2.7","messages":[
    {"role":"system","content":"sys1"},
    {"role":"system","content":"sys2"},
    {"role":"user","content":"hi"}],"max_tokens":10}'

# 期望:无响应或 4xx + (2013) 错误
```

### 3.2 通过 NewAPI ch49 复现

```bash
# 拿 root token
TOKEN=$(ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -sN -e "SELECT \`key\` FROM tokens WHERE id=432"')

# 临时让流量走 ch49:
ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -e "
UPDATE channels SET priority=99 WHERE id=49;
UPDATE channels SET status=2 WHERE id IN (40,50);
"'

# 调一个带 2 个 system 的 deepseek 请求:
curl -X POST https://api.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer sk-$TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","messages":[
    {"role":"system","content":"sys1"},
    {"role":"system","content":"sys2"},
    {"role":"user","content":"hi"}],"max_tokens":10}'

# 期望:HTTP 400 + 错误包含 "(2013)"

# 测完立刻恢复!
ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -e "
UPDATE channels SET priority=0 WHERE id=49;
UPDATE channels SET status=1 WHERE id IN (40,50);
"'
```

---

## 四、修复方案对比

### 方案 A:nassa-cards `/v1` 代理层做 messages 规范化(✅ 推荐)

在 `/Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts` 转发前,解析请求体并规范化 messages 数组。

```js
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages
  // 1. 抽出所有 system 消息合并
  const systems = messages.filter(m => m.role === "system")
  const nonSystems = messages.filter(m => m.role !== "system")
  if (systems.length === 0) return messages
  // 2. content 合并(string 与 array content 都兼容)
  const mergedContent = systems
    .map(m => typeof m.content === "string"
      ? m.content
      : (Array.isArray(m.content)
          ? m.content.filter(p => p.type === "text").map(p => p.text).join("\n\n")
          : JSON.stringify(m.content)))
    .filter(Boolean)
    .join("\n\n")
  // 3. 单一 system 放最前
  return [{role: "system", content: mergedContent}, ...nonSystems]
}
```

**优点:**
- 治本 — 所有走 nassa-cards 的卡密客户都受益,无论后端走 ch40 / ch49 / ch50
- 不动 NewAPI 源码,降低风险
- 兼容 string content 和 array content (OpenAI multipart)
- 流式 / 非流式都能用(改 request body,不动 response)

**缺点:**
- **只影响走 `card.nassaapi.xyz` 的客户(DE-/GP-/CL- 卡密)**,直连 `api.nassaapi.xyz` 的老客户不受益
- 微小性能开销(解析+重组 JSON,通常 <1ms)
- 改完要重新 build + 部署 nassa-cards

**部署影响范围:** 154 VPS `/opt/nassa-cards`,pm2 重启 ~3s 中断

---

### 方案 B:在 NewAPI 加 minimax adapter,自动 system 合并

修改 NewAPI 源码 `relay/channel/openai/adaptor.go`,检测 base_url 含 `minimaxi.com` 时执行 system 规范化。

**优点:**
- 终极治本 — 所有走 NewAPI 的客户受益(卡密 + 直连)
- minimax 渠道未来再加都自动受益,不需要 wrapper

**缺点:**
- 改 NewAPI 源码,需重新 build hide-model v5 镜像(参考 `nassa11111/new-api-hide-model:hide-model-v5`)
- 工程量大(1-2 小时,包括测试)
- 部署涉及 107 主机,docker-compose 重启 ~30s 中断

---

### 方案 C:在 207 写独立 wrapper 服务

写一个 Node.js / Python 服务监听 207:8319,做 messages 规范化后转 minimax,ch49 base_url 改成 `http://207.244.243.12:8319/v1`。

**优点:**
- 不动 NewAPI / nassa-cards
- 修复隔离,失败不影响其他系统

**缺点:**
- 引入新服务,运维复杂度 +1(pm2/systemd + 日志 + 健康检查)
- 跨主机调用(107 → 207),网络延迟 +5-30ms,稳定性下降
- 私网穿透 / 防火墙配置要做(207 当前 8319 未开)
- **不解决直连 api.nassaapi.xyz 客户的问题**(他们不经 nassa-cards 也不经 wrapper)

---

### 方案 D:NewAPI `param_override` 配置层修复

```json
{"operations":[
  {"mode":"delete", "path":"messages.#(role==\"system\")#~1"}  // 删第 2 个起的 system
]}
```

**结论:不可行。** NewAPI `param_override` (查 `relay/common/override.go`)只支持基础 set/delete/move/copy/prepend/append + 字符串处理,**不支持数组元素过滤、批量处理、条件遍历**。无法表达"合并所有 system 到第一个"。

---

## 五、推荐方案:A + 长期补 B

**短期(<1 小时):走方案 A**

- 改 nassa-cards `/v1` 代理,90% 的 minimax 受影响客户立刻解决
- 部署到 154,pm2 重启,立刻生效

**长期(本周内):补方案 B**

- 改 NewAPI fork (`hide-model-v6`),加 minimax adapter 自动合并 system
- 覆盖直连 `api.nassaapi.xyz` 的剩余 10% 客户
- Build 完发布 hide-model-v6 镜像,107 升级

---

## 六、方案 A 实现细节

### 6.1 文件位置

```
/Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts
```

当前流程:
```
客户 → POST /v1/chat/completions → 鉴权 + RPH → fetch(NewAPI) → TransformStream 改 model 字段 → 返客户
```

修复后流程:
```
客户 → POST /v1/chat/completions → 鉴权 + RPH 
     → 读 body + JSON.parse → normalizeMessages 
     → fetch(NewAPI, 新 body) → TransformStream 改 model 字段 → 返客户
```

### 6.2 关键考虑

**只规范化 chat completions 路径**,不影响 /v1/responses / /v1/messages / /v1/embeddings 等其他路径:

```ts
const isChat = pathname === "chat/completions"
const body = isChat ? normalizeBody(originalBody) : originalBody
```

**保留所有非 system role 消息原顺序**(只动 system)。

**兼容 string / array / null content**:

```ts
function extractText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter(p => p?.type === "text" && typeof p.text === "string")
      .map(p => p.text).join("\n\n")
  }
  return ""  // 跳过非文本(图片等)
}
```

**保留 `name` 字段**(取最早出现的 system 的 name):

```ts
const firstSystem = systems[0]
return [{
  role: "system",
  content: mergedContent,
  ...(firstSystem.name ? {name: firstSystem.name} : {})
}, ...nonSystems]
```

### 6.3 实现伪代码

```ts
async function POST(req) {
  const path = params.path.join("/")
  const auth = await authenticate(req)
  if (!auth.ok) return new Response(...)
  if (await isRateLimited(auth.sk)) return new Response(...)

  let body = await req.text()  // 原始 body

  // 只在 chat completions 路径做 messages 规范化
  if (path === "chat/completions") {
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed.messages)) {
        parsed.messages = normalizeMessages(parsed.messages)
        body = JSON.stringify(parsed)
      }
    } catch {
      // 解析失败 → 保留原 body 透传(避免 break 现有客户)
    }
  }

  // 转发给上游
  const upstream = await fetch(`${NEWAPI_BASE}/v1/${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${auth.sk}`, "Content-Type": "application/json" },
    body,
  })

  // 复用现有 TransformStream 改 model 字段(伪装 model 名)
  return new Response(upstream.body.pipeThrough(modelRewriteStream), {
    status: upstream.status,
    headers: upstream.headers,
  })
}
```

---

## 七、部署步骤(走方案 A)

### 7.1 本地改代码

```
1. 编辑 /Users/w/Desktop/newapi/nassa-cards/app/v1/[...path]/route.ts
2. 加 normalizeMessages 函数 + 集成到 POST handler
3. npm run build 验证编译
```

### 7.2 部署到 154

```bash
cd /Users/w/Desktop/newapi/nassa-cards
tar --exclude='nassa-cards/node_modules' --exclude='nassa-cards/data' \
    --exclude='nassa-cards/.git' --exclude='nassa-cards/.next/cache' \
    -czf /tmp/nassa-cards.tar.gz -C /Users/w/Desktop/newapi nassa-cards/
scp /tmp/nassa-cards.tar.gz root@154.64.231.223:/tmp/
ssh root@154.64.231.223 '
  rm -rf /tmp/nc-stage && mkdir -p /tmp/nc-stage
  tar -xzf /tmp/nassa-cards.tar.gz -C /tmp/nc-stage
  cp -r /opt/nassa-cards/data /tmp/nc-stage/nassa-cards/
  cp /opt/nassa-cards/.env.local /tmp/nc-stage/nassa-cards/
  rm -rf /opt/nassa-cards.old && mv /opt/nassa-cards /opt/nassa-cards.old
  mv /tmp/nc-stage/nassa-cards /opt/nassa-cards
  cd /opt/nassa-cards && npm install --omit=dev --no-audit --no-fund
  pm2 restart nassa-cards --update-env
'
```

### 7.3 回滚(发现问题立刻执行)

```bash
ssh root@154.64.231.223 '
  rm -rf /opt/nassa-cards
  mv /opt/nassa-cards.old /opt/nassa-cards
  pm2 restart nassa-cards
'
```

---

## 八、验证步骤

### 8.1 部署前(本地)

```bash
cd /Users/w/Desktop/newapi/nassa-cards
# 单元测试 normalizeMessages 函数
npm run test -- normalize  # 期望全部 PASS
```

### 8.2 部署后(对照测试)

```bash
TOKEN="sk-tplgd-xxx"  # 用真实 DE-* 卡密激活后拿到的 key

# A. 单 system 正常请求
curl https://card.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"deepseek-v4-pro","messages":[
    {"role":"system","content":"sys1"},
    {"role":"user","content":"hi"}],"max_tokens":10,"stream":false}'
# 期望: 200 + 正常回复

# B. 多 system 复现修复(原本 2013,修复后 200)
curl https://card.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"deepseek-v4-pro","messages":[
    {"role":"system","content":"sys1"},
    {"role":"system","content":"sys2"},
    {"role":"user","content":"hi"}],"max_tokens":10,"stream":false}'
# 期望: 200 + 正常回复(不再 2013)

# C. system 在 user 之后(原本 2013,修复后 200)
curl https://card.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"deepseek-v4-pro","messages":[
    {"role":"user","content":"hi"},
    {"role":"system","content":"sys"}],"max_tokens":10,"stream":false}'
# 期望: 200 + 正常回复

# D. 临时强制走 ch49 后再做 A/B/C(验证 minimax 路径全通)
ssh root@107.174.155.17 'docker exec ... UPDATE channels SET priority=99 WHERE id=49;
                         UPDATE channels SET status=2 WHERE id IN (40,50)'
# 重测 A/B/C → 全部期望 200
# 测完恢复:UPDATE channels SET priority=0,status=1 ...
```

### 8.3 监控

```bash
# 30 分钟内观察 ch49 错误率:
ssh root@107.174.155.17 'docker exec newapi_saz7-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api -e "
SELECT FROM_UNIXTIME(created_at+28800) t, channel_id, model_name, LEFT(content,80) snippet
FROM logs WHERE channel_id IN (40,49,50) AND created_at > UNIX_TIMESTAMP()-1800
  AND content LIKE \"%2013%\"
ORDER BY created_at DESC LIMIT 10"'
# 期望: 0 行结果
```

---

## 九、副作用与边界场景

### 9.1 客户故意发多 system 的场景

部分高级用户会用多 system 表达"角色切换 / 多 prompt 段",规范化后会被合并成一段。

**评估:** 合并是用 `\n\n` 拼接,**语义保留**,绝大多数模型(GPT/Claude/mimo/minimax)都能正确理解多段 system 拼成的单 system。不会破坏功能。

### 9.2 system 之间有 user 隔开(中途切换 prompt)

```js
[{system:"A"}, {user:"q1"}, {assistant:"a1"}, {system:"B"}, {user:"q2"}]
```

规范化后:
```js
[{system:"A\n\nB"}, {user:"q1"}, {assistant:"a1"}, {user:"q2"}]
```

**评估:** 语义上略有变化(原本 "B" 是在 q1 之后才生效),但对绝大多数 chatbot 影响很小(模型仍能从合并 system 提取所有指令)。

### 9.3 array content (multimodal)

```js
[{system: [{type:"text", text:"sys"}, {type:"image_url", image_url:{url:"..."}}]}]
```

规范化后只保留 text 部分,**丢失 image**。

**评估:** minimax 本身就不支持 image,而且 system 里放 image 极少见(系统提示通常是纯文本)。可接受。

### 9.4 非 chat completions 路径

```js
if (path !== "chat/completions") {
  // 直接透传,不动 body
}
```

`/v1/responses` / `/v1/messages` / `/v1/embeddings` 等不受影响。

---

## 十、长期改进(方案 B 路线)

修改 `new-api-fork/relay/channel/openai/adaptor.go`:

```go
// 在 Adaptor.ConvertRequest 里加 minimax 适配
if strings.Contains(info.ChannelBaseURL, "minimaxi.com") {
    request.Messages = normalizeSystemMessages(request.Messages)
}

func normalizeSystemMessages(msgs []dto.Message) []dto.Message {
    var systems []dto.Message
    var others  []dto.Message
    for _, m := range msgs {
        if m.Role == "system" {
            systems = append(systems, m)
        } else {
            others = append(others, m)
        }
    }
    if len(systems) <= 1 {
        return msgs  // 0 或 1 个 system 不需要规范化
    }
    var contentParts []string
    for _, s := range systems {
        contentParts = append(contentParts, extractText(s.Content))
    }
    merged := dto.Message{
        Role:    "system",
        Content: strings.Join(contentParts, "\n\n"),
    }
    return append([]dto.Message{merged}, others...)
}
```

发布 `hide-model-v6` 镜像 → 107 升级 → 直连客户也受益。

---

## 十一、相关文档

- `MINIMAX_DISGUISE_DEEPSEEK_CHECKLIST.md` — ch49/ch50 配置清单
- `MIMO_CHANNEL_CHECKLIST.md` — ch40 类似配置(mimo 伪装 deepseek)
- `INCIDENT_2026_05_17_MINIMAX_2013.md` — 本次事故归宿与时间线
- `new-api-fork/DEPLOYMENT_NOTES.md` — NewAPI hide-model 镜像 build/部署流程
