# Channel 61 改造草稿:MiniMax → GPT 伪装

> **状态**:草稿,**未执行**。等待用户确认。
> **创建**: 2026-05-25 11:40 UTC+8
> **目标**:把 ch61 从「→DeepSeek 伪装」改成「→GPT 伪装」

---

## 现状(改造前快照)

```
id:           61
name:         minimax→gpt_??_??(名字写 gpt 但配置是 deepseek,误命名)
base_url:     https://api.minimaxi.com
balance:      0          ⚠️ 上游账号没钱
status:       1
models:       deepseek-v4-flash, deepseek-v4-pro
model_mapping:
  deepseek-v4-flash → MiniMax-M2.5-highspeed
  deepseek-v4-pro   → MiniMax-M2.7
system_prompt: DeepSeek-V4 自称(force override)
```

---

## 改造目标

| 项 | 改前 | 改后 |
|----|------|------|
| models | deepseek-v4-* | gpt-5.5/5.4/5.4-mini/5.3-codex/5.3-codex-spark/5.2/5.1/5/5-codex (9 个) |
| model_mapping | 2 条 deepseek-* | 9 条 gpt-5.x → MiniMax-M2.7 / M2.5-highspeed |
| system_prompt | DeepSeek-V4 自称 | GPT V5 OVERRIDE 规则(复用 ch27) |
| force_format | false | **true**(MiniMax 不支持 reasoning_content) |
| thinking_to_content | false | **true** |
| abilities 表 | 10 条 deepseek-* dup | 9 条 gpt-5.x |

---

## 完整改造 SQL(逐步执行)

### Step 1: 备份(关键,执行前必做)

```sql
CREATE TABLE channels_bak_ch61_20260525 AS SELECT * FROM channels WHERE id=61;
CREATE TABLE abilities_bak_ch61_20260525 AS SELECT * FROM abilities WHERE channel_id=61;
```

### Step 2: 更新 channels.models + model_mapping + setting

```sql
UPDATE channels SET
  name = 'minimax→gpt',
  models = 'gpt-5.5,gpt-5.4,gpt-5.4-mini,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.2,gpt-5.1,gpt-5,gpt-5-codex',
  model_mapping = JSON_OBJECT(
    'gpt-5.5',             'MiniMax-M2.7',
    'gpt-5.4',             'MiniMax-M2.7',
    'gpt-5.3-codex',       'MiniMax-M2.7',
    'gpt-5.1',             'MiniMax-M2.7',
    'gpt-5',               'MiniMax-M2.7',
    'gpt-5-codex',         'MiniMax-M2.7',
    'gpt-5.4-mini',        'MiniMax-M2.5-highspeed',
    'gpt-5.3-codex-spark', 'MiniMax-M2.5-highspeed',
    'gpt-5.2',             'MiniMax-M2.5-highspeed'
  ),
  -- setting 直接复用 ch27 的内容(它是「→GPT 伪装」生产模板)
  setting = (SELECT setting FROM channels WHERE id=27)
WHERE id=61;
```

> ⚠️ 上面用 `(SELECT setting FROM channels WHERE id=27)` 会复制 ch27 的整段 setting JSON
> (含 GPT V5 OVERRIDE system_prompt + force_format=true + thinking_to_content=true)。

### Step 3: 重建 abilities 表(model 映射的副本表)

```sql
-- 删旧的 deepseek-* abilities
DELETE FROM abilities WHERE channel_id=61;

-- 加新的 gpt-5.x abilities(每个模型 1 条)
INSERT INTO abilities (channel_id, model, enabled, priority, weight, `group`)
SELECT 61, m.model, 1, 1, 12, g.grp
FROM (
  SELECT 'gpt-5.5' AS model UNION ALL
  SELECT 'gpt-5.4' UNION ALL
  SELECT 'gpt-5.4-mini' UNION ALL
  SELECT 'gpt-5.3-codex' UNION ALL
  SELECT 'gpt-5.3-codex-spark' UNION ALL
  SELECT 'gpt-5.2' UNION ALL
  SELECT 'gpt-5.1' UNION ALL
  SELECT 'gpt-5' UNION ALL
  SELECT 'gpt-5-codex'
) m
CROSS JOIN (
  SELECT 'default' AS grp UNION ALL
  SELECT 'vip1' UNION ALL
  SELECT 'vip' UNION ALL
  SELECT 'svip' UNION ALL
  SELECT 'de-throttled'
) g;
```

### Step 4(可选)— 安全模式:先禁用

```sql
-- 改完先不要让流量打过来,等你确认 MiniMax 账号有钱再启用
UPDATE channels SET status=2 WHERE id=61;
-- 充完钱后启用:
-- UPDATE channels SET status=1 WHERE id=61;
```

### Step 5: 刷新 NewAPI 缓存

NewAPI 会有 channel/abilities 内存缓存,改完后需要 ~60s 自动失效,或:

- 重启容器:`docker compose restart newapi-prod-new-api-1`(立即生效,~5s 中断)
- 或去 admin → 操作设置 → 点「刷新缓存」

---

## 验证 SQL(执行后)

```sql
-- 1. 看 channels 改对了没
SELECT id, name, models, model_mapping, status FROM channels WHERE id=61\G

-- 2. 看 abilities 改对了没
SELECT COUNT(*) AS total, COUNT(DISTINCT model) AS distinct_models, COUNT(DISTINCT `group`) AS groups
FROM abilities WHERE channel_id=61;
-- 期望: total=45 (9 model × 5 group), distinct_models=9, groups=5

-- 3. 看 setting 里 system_prompt 含 OVERRIDE_RULE_V5
SELECT setting LIKE '%OVERRIDE_RULE_V5%' AS has_override
FROM channels WHERE id=61;
-- 期望: 1
```

---

## ⚠️ 风险提示

1. **MiniMax 账号 balance=0** — 改完伪装,调用还是会因为余额不足被上游返 429。你要么充钱,要么换一个有钱的 MiniMax key。
2. **流量影响** — channel 61 改造期间不再服务 deepseek-v4-* 流量。但同模型还有 channel 56 等接,影响小。
3. **代码层伪装链路完整** — `nassa11111/new-api-hide-model:hide-model-v8` 已在生产,`stripProviderBranding` 会剥离 MiniMax 品牌字面量,**不会有泄漏**。

---

## 如果只想用 NewAPI Web UI 做(不动 SQL)

也可以(更安全):

1. 后台 → 渠道 → 找 ID=61
2. **类型**:OpenAI(保持)
3. **模型** 填:`gpt-5.5,gpt-5.4,gpt-5.4-mini,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.2,gpt-5.1,gpt-5,gpt-5-codex`
4. **模型映射** 粘 step 2 那段 JSON
5. **设置** → 复制粘贴 ch27 的整段 setting JSON
6. 保存
