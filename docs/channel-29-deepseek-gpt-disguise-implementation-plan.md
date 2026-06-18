# Channel 29 DeepSeek GPT Disguise Implementation Plan

Date: 2026-06-18

## Objective

Make channel 29 behave as a Codex-compatible GPT facade while keeping the upstream provider as DeepSeek.

Target model mapping:

```text
gpt-5.5 -> deepseek-v4-pro
gpt-5.4 -> deepseek-v4-pro
```

The implementation must support both OpenAI-compatible chat completions and OpenAI Responses API because Codex may call `/v1/responses`.

## Scope

This branch changes source code only.

In scope:

- Add DeepSeek `/v1/responses` compatibility by converting Responses requests to chat completions before sending upstream.
- Convert DeepSeek chat completions responses back into OpenAI Responses objects.
- Convert DeepSeek streaming chat completions chunks into OpenAI Responses SSE events.
- Preserve the public model name (`gpt-5.5` or `gpt-5.4`) in client-facing responses.
- Strip or downgrade Codex/OpenAI-only request fields that DeepSeek cannot consume through the chat completions endpoint.
- Add focused tests for request conversion and response wrapping.

Out of scope for this source branch:

- No production database edits.
- No deployment.
- No service restart.
- No channel key changes.
- No `.env` changes.

## Existing Findings

- Channel 29 is enabled and already maps `gpt-5.5` and `gpt-5.4` to `deepseek-v4-pro`.
- The tested key did not route to channel 29 because channel 29 was enabled only for group `测试`; the key used group `vip`/user group `vip1`.
- Current non-29 routes can hang with PING-only streaming.
- DeepSeek adaptor currently returns `not implemented` for `ConvertOpenAIResponsesRequest`, so `/v1/responses` cannot be considered complete for channel 29.

## Reference Project Notes

Reference reviewed: `BenedictKing/ccx`, downloaded locally to `/tmp/ccx-protocol-reference`.

Useful lessons incorporated:

- Treat Codex `/v1/responses` as a first-class API, not only as an alias for chat completions.
- For Responses to Chat conversion, only forward tools that are compatible with Chat Completions function tools.
- If all Responses tools are filtered out, do not forward `tool_choice`.
- Do not forward Responses-only fields such as `store`, `metadata`, `previous_response_id`, `conversation`, and `context_management` to DeepSeek chat completions.
- Synthesize Responses SSE events from Chat SSE; do not pass OpenAI Chat chunks directly to Codex.
- Handle function-call streaming separately from text streaming so pure tool-call responses do not create empty assistant messages.
- Fill missing tool schema defaults (`type=object`, `properties={}`, `required=[]`) to avoid strict schema validation failures.

## Design

### 1. Request Path

When channel 29 receives `/v1/responses`:

1. NewAPI maps the public model name to upstream model name:
   - `gpt-5.5 -> deepseek-v4-pro`
   - `gpt-5.4 -> deepseek-v4-pro`
2. The DeepSeek adaptor converts the Responses request into `dto.GeneralOpenAIRequest`.
3. The upstream URL is changed from `/v1/responses` to `/v1/chat/completions`.
4. The outbound JSON is cleaned for DeepSeek chat completions compatibility.

Expected conversion chain:

```text
OpenAI Responses -> OpenAI Compatible
```

### 2. Non-streaming Response Path

When DeepSeek returns a chat completion:

1. Parse `dto.OpenAITextResponse`.
2. Extract assistant text and usage.
3. Return a synthetic `dto.OpenAIResponsesResponse`.
4. Use the public origin model name in the response model field.

### 3. Streaming Response Path

When DeepSeek returns chat completion SSE:

1. Parse each chat completion chunk.
2. Emit OpenAI Responses SSE events:
   - `response.created`
   - `response.output_item.added`
   - `response.content_part.added`
   - `response.output_text.delta`
   - `response.function_call_arguments.delta`
   - `response.function_call_arguments.done`
   - `response.content_part.done`
   - `response.output_item.done`
   - `response.completed`
3. End the stream with `[DONE]`.
4. Preserve usage if upstream emits a final usage chunk; otherwise estimate completion tokens from streamed text.
5. Keep text and function-call output items independent so tool-only streams do not contain an empty message item.

## Implementation Files

Primary files:

```text
relay/channel/deepseek/adaptor.go
relay/channel/deepseek/responses_bridge.go
relay/channel/deepseek/responses_bridge_test.go
```

Expected adaptor changes:

- `ConvertOpenAIResponsesRequest` no longer returns `not implemented`.
- `GetRequestURL` sends `RelayModeResponses` to `/v1/chat/completions`.
- `DoResponse` uses the DeepSeek Responses bridge when `RelayModeResponses`.

## Compatibility Rules

Request conversion should keep:

- `model`
- `messages`
- `stream`
- `temperature`
- `top_p`
- `max_output_tokens -> max_completion_tokens`
- `tools` only if parseable as standard function tools
- `tool_choice` only when at least one compatible function tool remains
- `user`

Request conversion should not forward Responses-only fields directly:

- `store`
- `metadata`
- `parallel_tool_calls`
- `previous_response_id`
- `conversation`
- `context_management`
- `truncation`
- `include`
- `prompt_cache_key`
- `prompt_cache_retention`
- `safety_identifier`

Reasoning handling:

- Keep model suffix handling already present for DeepSeek v4 models.
- Do not forward OpenAI Responses `reasoning` as-is unless the DeepSeek v4 suffix conversion produces a supported DeepSeek `thinking` payload.

## Acceptance Criteria

Source-level:

- Tests pass for request conversion.
- Tests pass for non-streaming chat-to-responses wrapping.
- Tests pass for streaming chat-to-responses event generation.
- Tests pass for streaming function-call event generation.
- Tests verify non-function Responses tools are filtered before sending to DeepSeek chat completions.
- `go test ./relay/channel/deepseek ./service/openaicompat` passes.
- `go test ./relay/channel/openai ./service/openaicompat` passes.

Runtime-level after an approved deploy:

- `/v1/chat/completions` with `gpt-5.5` routes to channel 29 and returns text.
- `/v1/chat/completions` stream emits `data:` chunks and `[DONE]`.
- `/v1/responses` with `gpt-5.5` routes to channel 29 and returns Responses-shaped JSON.
- `/v1/responses` stream emits Responses SSE events and `[DONE]`.
- Logs show `channel_id=29`.
- Logs show `request_path=/v1/responses` for Responses tests.
- Logs show no fallback away from channel 29.

## Production Prerequisite

Before production verification, routing must be fixed separately:

- Enable channel 29 ability for the target key's effective group.
- Ensure channel 29 wins for `gpt-5.5`/`gpt-5.4`.
- Ensure the token model limit permits the chosen public model.

Do not debug this source branch using a key that still routes to 72/118/135.

## Production Verification Plan

After you explicitly approve deployment/config changes:

1. Record immutable references:
   - source branch
   - commit SHA
   - current service binary/container image if applicable
   - sanitized channel 29 config snapshot
   - sanitized target token/group/model-limit snapshot
2. Verify routing before model quality:
   - `/v1/models` includes `gpt-5.5` and `gpt-5.4`
   - a `gpt-5.5` request logs `channel_id=29`
   - no fallback to channels 72/118/135 for the same test
3. Verify Chat Completions:
   - non-stream `/v1/chat/completions` returns content
   - stream `/v1/chat/completions` emits `data:` chunks and `[DONE]`
4. Verify Responses:
   - non-stream `/v1/responses` returns `object=response`, public model `gpt-5.5`, and output text
   - stream `/v1/responses` emits `response.created`, text or function-call deltas, `response.completed`, and `[DONE]`
5. Verify Codex-like payloads:
   - payload with `tools`
   - payload with `reasoning`
   - payload with `store=false`
   - payload with `parallel_tool_calls`
   - payload with `metadata`
6. Verify logs:
   - path
   - model
   - stream flag
   - channel id
   - upstream model
   - status code
   - no API keys or prompts printed

## Rollback

Rollback is source-safe:

- Revert this branch or redeploy the previous backup branch:
  `codex/server-backup-new-api-temp-20260618-202843`.
- Disable any separately approved channel 29 ability rows if they were added later.

Practical rollback commands for source-only work:

```bash
git checkout codex/server-backup-new-api-temp-20260618-202843
```

Or, after this implementation is merged:

```bash
git revert <implementation_commit_sha>
```

Production rollback, only after a separately approved deployment:

1. Stop new rollout traffic if there is a load balancer or canary switch.
2. Check out the backup branch or previous known-good commit.
3. Rebuild and restart only after explicit approval.
4. Restore channel 29/token/group/model-limit settings from the sanitized snapshot if production config was changed.
5. Run the same smoke tests against `gpt-5.5` and confirm requests no longer use the reverted behavior.
