# Channel 29 DeepSeek-as-GPT Codex Verification Plan

Date: 2026-06-18

## Goal

Make Codex CLI use GPT-looking model names through NewAPI while the final upstream is channel 29 DeepSeek:

- `gpt-5.5 -> deepseek-v4-pro`
- `gpt-5.4 -> deepseek-v4-pro`

The verification target is not merely "request succeeds"; it must prove all of the following:

- Codex-visible model name exists.
- The request routes to channel 29, not 72/118/135/94.
- NewAPI applies the expected model mapping to DeepSeek.
- Non-streaming chat works.
- Streaming chat emits real SSE tokens, not only `: PING`.
- If Codex calls `/v1/responses`, Responses API compatibility works in both non-streaming and streaming modes.
- Codex-like extra fields do not break the DeepSeek upstream path.

## Safety Rules

- Do not print full API keys.
- Do not print `.env`.
- Do not print channel upstream keys.
- Do not dump database tables containing secrets.
- Do not restart services during verification.
- Do not deploy during verification.
- Use only:

```bash
export TEST_API_KEY='sk-xxxx'
```

All logs and command output must show keys only as first 6 and last 4 characters.

## Backup Baseline

Before verification, the server source repo `/root/new-api-temp` was pushed to GitHub as a backup branch:

```text
repository: https://github.com/DrNu11/mynewapi
branch: codex/server-backup-new-api-temp-20260618-202843
head: 9dfbb5fc
source branch on server: feat/minimax-disguise-responses
```

This backup is source-only. It does not include `.env`, channel keys, token keys, or database dumps.

## Known Baseline From Investigation

Current facts:

- `/v1/models` returns `gpt-5.5` and `gpt-5.4`.
- `/v1/models` does not return `gpt-5.5-high`; do not use `gpt-5.5-high`.
- Channel 29 is enabled.
- Channel 29 base URL is `https://api.deepseek.com`.
- Channel 29 currently has the required model mappings:

```json
{
  "gpt-5.5": "deepseek-v4-pro",
  "gpt-5.4": "deepseek-v4-pro"
}
```

- The previously tested key resolved to token_id `699`.
- That token had `model_limits_enabled=1` and `model_limits=gpt-5.5`.
- That token's routing group was `vip`; the user group was `vip1`.
- Channel 29 abilities were only enabled for group `测试`.
- Therefore that key did not route to channel 29.
- Recent `gpt-5.5` requests routed to 72/118/135.
- Those routes produced the Codex-visible symptom: HTTP 200 streaming with only `: PING`, no `data:`, no `[DONE]`.
- Direct `127.0.0.1:3000` reproduced the same PING-only behavior, so Nginx buffering is not the primary cause.

## Required Target State

For the target Codex key and chosen model, NewAPI must satisfy:

```text
model: gpt-5.5 or gpt-5.4
target channel: 29
final upstream model: deepseek-v4-pro
```

Routing requirements:

- Channel 29 must have enabled ability rows for the target key's effective group.
- The target key must be allowed to call the chosen model.
- Channel 29 must outrank or exclusively own the chosen model for that group.
- No request should fall through to 72/118/135/94 during the validation run.

Recommended clean path:

- Use `gpt-5.5` if the existing Codex key only allows `gpt-5.5`.
- Use `gpt-5.4` only after confirming the token's model limit permits `gpt-5.4`, or after using a key that permits it.

## Phase 0: Key Mask Helper

Run this on the server shell before any curl tests:

```bash
python3 - <<'PY'
import os
k = os.environ.get("TEST_API_KEY", "")
print("TEST_API_KEY_MASKED=%s...%s" % (k[:6], k[-4:] if len(k) >= 4 else ""))
PY
```

Acceptance:

- Output shows a masked key only.
- No full key appears in terminal, shell history, or logs.

## Phase 1: Confirm Public Model Surface

```bash
curl -sS -o /tmp/models.body -w "HTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/models \
  -H "Authorization: Bearer $TEST_API_KEY"

python3 - <<'PY'
import json
data=json.load(open("/tmp/models.body"))
ids=[x.get("id") for x in data.get("data", [])]
for m in ["gpt-5.5", "gpt-5.4", "gpt-5.5-high"]:
    print(f"{m}={m in ids}")
print("model_count=%d" % len(ids))
PY
```

Acceptance:

- HTTP 200.
- `gpt-5.5=True`.
- `gpt-5.4=True`.
- `gpt-5.5-high=False`.

Failure handling:

- If `gpt-5.5` is absent, do not continue Codex testing.
- If only `gpt-5.4` is absent, continue with `gpt-5.5`.

## Phase 2: Confirm Token Eligibility

Do not query by full key in visible command text. Identify the latest token_id from recent logs or admin UI, then run:

```sql
SELECT
  id,
  status,
  name,
  expired_time,
  remain_quota,
  unlimited_quota,
  model_limits_enabled,
  model_limits,
  allow_ips,
  used_quota,
  `group`,
  cross_group_retry,
  user_id,
  deleted_at
FROM tokens
WHERE id = <TOKEN_ID>;
```

Also check the user group:

```sql
SELECT id, username, quota, used_quota, request_count, `group`, status
FROM users
WHERE id = <USER_ID>;
```

Acceptance:

- token `status=1`.
- user `status=1`.
- token not deleted.
- key is allowed to call the test model:
  - If testing `gpt-5.5`, `model_limits` must include `gpt-5.5` or limits must be disabled.
  - If testing `gpt-5.4`, `model_limits` must include `gpt-5.4` or limits must be disabled.
- Effective routing group is known before changing ability rows.

Failure handling:

- If token only allows `gpt-5.5`, do not use `gpt-5.4` for Codex until model limits are intentionally updated or another key is chosen.

## Phase 3: Confirm Channel 29 Configuration

Read-only channel check:

```sql
SELECT
  id,
  name,
  type,
  status,
  base_url,
  models,
  model_mapping,
  param_override,
  status_code_mapping,
  priority,
  weight,
  auto_ban,
  tag,
  test_model,
  response_time,
  balance,
  FROM_UNIXTIME(created_time) AS created_at,
  FROM_UNIXTIME(test_time) AS test_at
FROM channels
WHERE id = 29;
```

Read-only ability check:

```sql
SELECT
  `group`,
  HEX(`group`) AS group_hex,
  channel_id,
  model,
  enabled,
  priority,
  weight,
  tag
FROM abilities
WHERE channel_id = 29
ORDER BY `group`, model;
```

Acceptance:

- `status=1`.
- `base_url=https://api.deepseek.com`.
- `models` includes `gpt-5.5` and `gpt-5.4`.
- `model_mapping` contains:
  - `gpt-5.5: deepseek-v4-pro`
  - `gpt-5.4: deepseek-v4-pro`
- Ability exists and is enabled for the target key's effective group.

Failure handling:

- If channel 29 is enabled only for `测试`, requests from `vip`/`vip1` will not hit channel 29.
- Fix routing eligibility first; do not debug SSE until logs prove `channel_id=29`.

## Phase 4: Confirm Route Competition

For the target model and group, list all competing channels:

```sql
SELECT
  `group`,
  HEX(`group`) AS group_hex,
  channel_id,
  model,
  enabled,
  priority,
  weight,
  tag
FROM abilities
WHERE model IN ('gpt-5.5', 'gpt-5.4')
  AND `group` IN ('vip', 'vip1', 'default', '测试')
ORDER BY model, `group`, enabled DESC, priority DESC, weight DESC, channel_id;
```

Acceptance:

- For the chosen model and target group, channel 29 is enabled.
- Channel 29 wins route selection, or the chosen model is isolated to channel 29 for the target group.
- Channels 72/118/135/94 should not win for the chosen validation key.

Failure handling:

- If 72/118/135 outrank 29, either raise channel 29 priority for the chosen group/model or use a clean model entry that only channel 29 owns.

## Phase 5: Chat Completions Non-streaming

Use the selected model:

```bash
MODEL=gpt-5.5

curl -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Say OK only.\"}
    ],
    \"stream\": false
  }" | head -c 4000
echo
```

Immediately verify routing:

```sql
SELECT
  id,
  FROM_UNIXTIME(created_at) AS time,
  token_id,
  model_name,
  is_stream,
  channel_id,
  prompt_tokens,
  completion_tokens,
  use_time,
  request_id,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_path')) AS path,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.admin_info.use_channel')) AS use_channel,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_conversion')) AS conversion
FROM logs
WHERE model_name IN ('gpt-5.5', 'gpt-5.4')
ORDER BY id DESC
LIMIT 10;
```

Acceptance:

- HTTP 200.
- Body contains assistant content, ideally `OK`.
- Latest log has `channel_id=29`.
- `path=/v1/chat/completions`.
- `is_stream=0`.
- `completion_tokens > 0`.

Failure handling:

- `channel_id != 29`: stop and fix routing.
- HTTP 404: model mapping or upstream model unsupported.
- HTTP 401/403: token/channel key/auth issue.
- 0-byte timeout: upstream or relay hang; check Docker logs for request_id.

## Phase 6: Chat Completions Streaming

```bash
MODEL=gpt-5.5

timeout 45 curl -N -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Say OK only.\"}
    ],
    \"stream\": true
  }" | tee /tmp/chat_stream.out | head -c 5000
echo

python3 - <<'PY'
t=open("/tmp/chat_stream.out", "r", encoding="utf-8", errors="replace").read()
print("has_data=%s" % ("data:" in t))
print("has_done=%s" % ("[DONE]" in t))
print("only_ping=%s" % ((": PING" in t) and ("data:" not in t)))
PY
```

Routing verification:

```sql
SELECT
  id,
  FROM_UNIXTIME(created_at) AS time,
  token_id,
  model_name,
  is_stream,
  channel_id,
  prompt_tokens,
  completion_tokens,
  use_time,
  request_id,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_path')) AS path,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.stream_status.status')) AS stream_status,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.stream_status.end_reason')) AS end_reason,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.admin_info.use_channel')) AS use_channel,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_conversion')) AS conversion
FROM logs
WHERE model_name IN ('gpt-5.5', 'gpt-5.4')
ORDER BY id DESC
LIMIT 10;
```

Acceptance:

- HTTP 200.
- First real `data:` event appears quickly.
- Final `[DONE]` appears.
- It is not PING-only.
- Latest log has `channel_id=29`.
- `stream_status=ok`.
- `end_reason=done` or another documented successful ending.

Failure handling:

- PING-only with `channel_id=29`: channel 29 upstream or stream conversion is hanging.
- PING-only with `channel_id!=29`: route fix is incomplete.
- HTTP 200 but no `[DONE]`: SSE termination is incompatible with Codex.

## Phase 7: Responses API Non-streaming

Codex may call `/v1/responses`. Verify explicitly:

```bash
MODEL=gpt-5.5

curl -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"input\": \"Say OK only.\"
  }" | tee /tmp/responses_nonstream.out | head -c 5000
echo
```

Acceptance:

- HTTP 200.
- Response shape is OpenAI Responses-compatible.
- It includes usable output text.
- Latest log has `channel_id=29`.
- `path=/v1/responses`.

Failure handling:

- If NewAPI internally converts to chat but returns chat format, Codex may fail.
- If this hangs with channel 29, Responses compatibility must be fixed before Codex can reliably use the model.

## Phase 8: Responses API Streaming

```bash
MODEL=gpt-5.5

timeout 45 curl -N -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"input\": \"Say OK only.\",
    \"stream\": true
  }" | tee /tmp/responses_stream.out | head -c 7000
echo

python3 - <<'PY'
t=open("/tmp/responses_stream.out", "r", encoding="utf-8", errors="replace").read()
events=[
    "response.created",
    "response.output_text.delta",
    "response.completed",
]
for e in events:
    print(f"has_{e}={e in t}")
print("has_data=%s" % ("data:" in t))
print("only_ping=%s" % ((": PING" in t) and ("response.output_text.delta" not in t)))
PY
```

Acceptance:

- HTTP 200.
- Stream contains valid Responses SSE events.
- Must include text delta events.
- Must include a completion event.
- Must not be PING-only.
- Latest log has `channel_id=29`, `path=/v1/responses`, `stream_status=ok`.

Failure handling:

- If chat streaming works but Responses streaming fails, implement or fix the `/v1/responses` compatibility layer for channel 29.
- Codex is not considered fixed until Responses streaming passes or Codex is proven to use only chat completions.

## Phase 9: Codex-like Parameter Compatibility

Test the fields Codex may send. This is the key DeepSeek compatibility check.

```bash
MODEL=gpt-5.5

curl -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/chat/completions \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Say OK only.\"}
    ],
    \"stream\": false,
    \"reasoning\": {\"effort\": \"minimal\"},
    \"tools\": [],
    \"tool_choice\": \"auto\",
    \"parallel_tool_calls\": true,
    \"store\": false
  }" | head -c 5000
echo
```

If `/v1/responses` is used by Codex, also test:

```bash
MODEL=gpt-5.5

curl -sS -w "\nHTTP_CODE=%{http_code}\nTIME_TOTAL=%{time_total}\n" \
  https://api.nassaapi.xyz/v1/responses \
  -H "Authorization: Bearer $TEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"input\": \"Say OK only.\",
    \"reasoning\": {\"effort\": \"minimal\"},
    \"tools\": [],
    \"parallel_tool_calls\": true,
    \"store\": false
  }" | head -c 5000
echo
```

Acceptance:

- HTTP 200.
- Latest log still has `channel_id=29`.
- No upstream error about unsupported `reasoning`, `tools`, `tool_choice`, `parallel_tool_calls`, or `store`.

Failure handling:

- If these fields cause 400/500/hang, configure channel 29 parameter override or conversion logic to strip unsupported OpenAI-only fields before sending to DeepSeek.

## Phase 10: Codex Real Request Log Summary

After a real Codex CLI attempt, inspect only non-sensitive fields:

```sql
SELECT
  id,
  FROM_UNIXTIME(created_at) AS time,
  token_id,
  token_name,
  model_name,
  is_stream,
  channel_id,
  prompt_tokens,
  completion_tokens,
  use_time,
  request_id,
  upstream_request_id,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_path')) AS path,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.stream_status.status')) AS stream_status,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.stream_status.end_reason')) AS end_reason,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.admin_info.use_channel')) AS use_channel,
  JSON_UNQUOTE(JSON_EXTRACT(other, '$.request_conversion')) AS conversion
FROM logs
WHERE model_name IN ('gpt-5.5', 'gpt-5.4')
ORDER BY id DESC
LIMIT 20;
```

Do not print:

- full prompt
- full response
- Authorization header
- token key
- channel key
- `.env`

Acceptance:

- Real Codex request uses `model_name=gpt-5.5` or `gpt-5.4`.
- `channel_id=29`.
- `path` is known.
- If stream, `stream_status=ok`.
- `completion_tokens > 0`.
- `use_channel` does not show fallback away from 29.

## Phase 11: Proxy Layer Confirmation

Only run this if direct NewAPI tests pass but public domain tests fail.

Check local NewAPI directly:

```bash
curl -sS -o /dev/null -w "local3000_http_code=%{http_code}\ntime=%{time_total}\n" \
  http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $TEST_API_KEY"
```

Check API gate:

```bash
curl -sS -o /dev/null -w "gate3007_http_code=%{http_code}\ntime=%{time_total}\n" \
  http://127.0.0.1:3007/v1/models \
  -H "Host: api.nassaapi.xyz" \
  -H "Authorization: Bearer $TEST_API_KEY"
```

Nginx API gate should include:

```nginx
proxy_buffering off;
proxy_read_timeout 720s;
proxy_send_timeout 720s;
```

Acceptance:

- Direct local and public domain behave the same.
- If public fails but local succeeds, inspect Cloudflare/xray/API-gate path.

## Phase 12: Success Criteria

The channel 29 DeepSeek-as-GPT setup is considered ready for Codex only when all required checks pass:

- `gpt-5.5` or `gpt-5.4` appears in `/v1/models`.
- Target key is allowed to use the chosen model.
- Latest test requests log `channel_id=29`.
- Latest test requests show final model mapping to `deepseek-v4-pro` by channel 29 configuration.
- `/v1/chat/completions` non-streaming returns content.
- `/v1/chat/completions` streaming emits `data:` and terminates correctly.
- `/v1/responses` non-streaming returns Responses-compatible output if Codex uses Responses.
- `/v1/responses` streaming emits Responses SSE delta/completed events if Codex uses Responses.
- Codex-like extra fields do not break the request.
- No test relies on fallback channels.

## Stop Conditions

Stop verification and do not proceed to Codex real test if any of these occur:

- `channel_id` is not 29.
- Stream is PING-only.
- `/v1/responses` returns chat format when Codex expects Responses format.
- Unsupported parameter errors appear for `reasoning`, `tools`, `tool_choice`, `parallel_tool_calls`, or `store`.
- NewAPI retries away from 29.
- Any command would require printing a real key or `.env`.

## Rollback Plan

If a later approved configuration change breaks traffic:

- Disable only the newly added channel 29 ability rows for the target group/model.
- Restore previous priority/weight for `gpt-5.5` or `gpt-5.4`.
- Restore the target token's previous `model_limits` if changed.
- Leave channels 72/118/135 unchanged unless they were explicitly modified.
- Re-test `/v1/models` and one known-good non-Codex request after rollback.

## Recommended First Approved Change

Do not change code first.

First approved config change should be routing-only:

- Enable channel 29 ability for the target key's effective group and `gpt-5.5`.
- Make channel 29 win for `gpt-5.5` in that group.
- Keep `gpt-5.4` as a secondary option only if the Codex key is allowed to use it.

Only after logs prove `channel_id=29` should SSE or Responses compatibility be debugged.
