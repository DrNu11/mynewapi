package openai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	openaicompat "github.com/QuantumNous/new-api/service/openaicompat"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// OaiChatToResponsesHandler 处理 codex 客户发 /v1/responses,但下游 channel 只支持 chat
// 的非流式响应翻译。
//
// 配套:OaiResponsesToChatHandler(反向方向)。
func OaiChatToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	defer service.CloseResponseBodyGracefully(resp)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	if oaiError := chatResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	respId := helper.GetResponseID(c)
	responsesResp, err := openaicompat.ChatCompletionsResponseToResponsesResponse(&chatResp, respId)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	// hide-model:覆盖 model 为客户请求名,不暴露上游真名(如 mimo-v2.5)
	if info.OriginModelName != "" {
		responsesResp.Model = info.OriginModelName
	}

	respBody, err := common.Marshal(responsesResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}

	usage := &chatResp.Usage
	if usage.TotalTokens == 0 {
		// fallback usage 估算:从 chat response 第一个 choice 提取文本
		var fallbackText string
		if len(chatResp.Choices) > 0 {
			fallbackText = chatResp.Choices[0].StringContent()
		}
		usage = service.ResponseText2Usage(c, fallbackText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	}
	// 把 chat usage 字段映射成 responses usage 字段(两者结构一致,但 input/output_tokens 字段名不同)
	usage.InputTokens = usage.PromptTokens
	usage.OutputTokens = usage.CompletionTokens

	service.IOCopyBytesGracefully(c, resp, respBody)
	return usage, nil
}

// OaiChatToResponsesStreamHandler 把 chat completion SSE 流翻译成 responses SSE 流。
//
// 这是 OaiResponsesToChatStreamHandler 的反方向,逻辑核心:用一个 stateful builder
// 累积 chat chunk 状态,合成 responses 协议要求的 9+ 种事件。
//
// codex CLI 严格要求事件序列(简化版):
//
//	response.created
//	response.in_progress
//	response.output_item.added           ← 一条 message item
//	response.content_part.added          ← 一条 output_text content
//	response.output_text.delta {chunk1}  ← 逐字累积
//	response.output_text.delta {chunk2}
//	...
//	response.output_text.done
//	response.content_part.done
//	response.output_item.done
//	(若有 tool_calls:每个 tool_call 一组 output_item.added/function_call_arguments.delta/...done)
//	response.completed
//
// 缺一个事件 codex 客户端就会 hang。
func OaiChatToResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	defer service.CloseResponseBodyGracefully(resp)

	builder := newChatToResponsesStreamBuilder(c, info)

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if builder.streamErr != nil {
			sr.Stop(builder.streamErr)
			return
		}

		// 跳过 [DONE]
		if strings.TrimSpace(data) == "[DONE]" {
			return
		}

		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			logger.LogError(c, "failed to unmarshal chat stream chunk: "+err.Error())
			sr.Error(err)
			return
		}

		// 上游 model 信息(取第一次出现)
		if chunk.Model != "" && builder.model == "" {
			builder.model = chunk.Model
		}
		if chunk.Created != 0 && builder.createdAt == 0 {
			builder.createdAt = int(chunk.Created)
		}
		if chunk.Id != "" && builder.upstreamId == "" {
			builder.upstreamId = chunk.Id
		}

		// 处理 usage(非 choice chunk,仅在末尾 chunk 出现)
		if chunk.Usage != nil {
			builder.usage = chunk.Usage
		}

		// 处理 choices
		for _, choice := range chunk.Choices {
			builder.handleChoice(&choice)
			if builder.streamErr != nil {
				sr.Stop(builder.streamErr)
				return
			}
		}
	})

	if builder.streamErr != nil {
		return nil, builder.streamErr
	}

	// 流结束:发 done + completed 事件
	if !builder.sentResponseCompleted {
		builder.finalize()
	}

	usage := builder.usage
	if usage == nil {
		usage = &dto.Usage{}
	}
	if usage.TotalTokens == 0 {
		// fallback usage 估算
		fallback := service.ResponseText2Usage(c, builder.accumText.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
		usage = fallback
	}
	usage.InputTokens = usage.PromptTokens
	usage.OutputTokens = usage.CompletionTokens

	return usage, nil
}

// chatToResponsesStreamBuilder 是 stateful 流转换器
type chatToResponsesStreamBuilder struct {
	c    *gin.Context
	info *relaycommon.RelayInfo

	responseId string // "resp_xxx"
	createdAt  int
	model      string
	upstreamId string

	// 状态标志(每种事件至多发一次)
	sentResponseCreated   bool
	sentInProgress        bool
	sentMessageItemAdded  bool
	sentContentPartAdded  bool
	sentMessageItemDone   bool
	sentResponseCompleted bool

	// text 累积
	msgItemId string // "msg_xxx"
	accumText strings.Builder

	// tool_calls 状态(按 index 追踪)
	toolCallStates map[int]*toolCallStreamState
	toolCallOrder  []int // 保留 tool_call 出现顺序,用于 finalize 时按序发 done

	// 错误 / usage
	streamErr *types.NewAPIError
	usage     *dto.Usage
}

type toolCallStreamState struct {
	index         int
	itemId        string // "fc_xxx"
	callId        string
	name          string
	accumArgs     strings.Builder
	sentItemAdded bool
	sentItemDone  bool
}

func newChatToResponsesStreamBuilder(c *gin.Context, info *relaycommon.RelayInfo) *chatToResponsesStreamBuilder {
	respId := helper.GetResponseID(c)
	return &chatToResponsesStreamBuilder{
		c:              c,
		info:           info,
		responseId:     fmt.Sprintf("resp_%s", respId),
		msgItemId:      fmt.Sprintf("msg_%s", respId),
		createdAt:      int(time.Now().Unix()),
		model: func() string {
			if info.OriginModelName != "" {
				return info.OriginModelName
			}
			return info.UpstreamModelName
		}(),
		toolCallStates: make(map[int]*toolCallStreamState),
		toolCallOrder:  make([]int, 0, 4),
	}
}

// sendEvent 用 dto.ResponsesStreamResponse 包装 + helper.ResponseChunkData 发 SSE
// 注意:helper.ResponseChunkData 内部会写 `event: <type>\n` + `data: <json>\n\n`
func (b *chatToResponsesStreamBuilder) sendEvent(eventType string, payload map[string]any) bool {
	if payload == nil {
		payload = make(map[string]any)
	}
	payload["type"] = eventType

	jsonData, err := common.Marshal(payload)
	if err != nil {
		b.streamErr = types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
		return false
	}
	helper.ResponseChunkData(b.c, dto.ResponsesStreamResponse{Type: eventType}, string(jsonData))
	return true
}

// ensureResponseCreated 第一次发数据前先发 response.created + response.in_progress
func (b *chatToResponsesStreamBuilder) ensureResponseCreated() bool {
	if b.sentResponseCreated {
		return true
	}
	skeleton := map[string]any{
		"id":         b.responseId,
		"object":     "response",
		"created_at": b.createdAt,
		"status":     "in_progress",
		"model":      b.model,
		"output":     []any{},
	}
	if !b.sendEvent("response.created", map[string]any{"response": skeleton}) {
		return false
	}
	b.sentResponseCreated = true
	if !b.sendEvent("response.in_progress", map[string]any{"response": skeleton}) {
		return false
	}
	b.sentInProgress = true
	return true
}

// ensureMessageItemAdded 第一次发文本 delta 前要发 output_item.added(message)+ content_part.added(output_text)
func (b *chatToResponsesStreamBuilder) ensureMessageItemAdded() bool {
	if b.sentMessageItemAdded {
		return true
	}
	if !b.ensureResponseCreated() {
		return false
	}
	item := map[string]any{
		"id":      b.msgItemId,
		"type":    "message",
		"status":  "in_progress",
		"role":    "assistant",
		"content": []any{},
	}
	if !b.sendEvent("response.output_item.added", map[string]any{
		"output_index": 0,
		"item":         item,
	}) {
		return false
	}
	b.sentMessageItemAdded = true

	if !b.sendEvent("response.content_part.added", map[string]any{
		"item_id":       b.msgItemId,
		"output_index":  0,
		"content_index": 0,
		"part": map[string]any{
			"type": "output_text",
			"text": "",
		},
	}) {
		return false
	}
	b.sentContentPartAdded = true
	return true
}

// handleChoice 处理一个 chat completion choice(delta 增量 / finish_reason)
func (b *chatToResponsesStreamBuilder) handleChoice(choice *dto.ChatCompletionsStreamResponseChoice) {
	delta := choice.Delta

	// 1. 文本 content delta
	if delta.Content != nil && *delta.Content != "" {
		text := *delta.Content
		if !b.ensureMessageItemAdded() {
			return
		}
		b.accumText.WriteString(text)

		if !b.sendEvent("response.output_text.delta", map[string]any{
			"item_id":       b.msgItemId,
			"output_index":  0,
			"content_index": 0,
			"delta":         text,
		}) {
			return
		}
	}

	// 2. tool_calls delta(可能多次出现,逐字累积)
	for _, tc := range delta.ToolCalls {
		b.handleToolCallDelta(&tc)
		if b.streamErr != nil {
			return
		}
	}

	// 3. finish_reason 处理(下一个 chunk 不会再来,触发 done 事件)
	if choice.FinishReason != nil && *choice.FinishReason != "" {
		// 不在这里直接 finalize,因为 usage 可能在下一个 chunk(stream_options.include_usage)
		// finalize 在 OaiChatToResponsesStreamHandler 流结束时统一调用
	}
}

// handleToolCallDelta 处理一个 tool_call delta 增量
func (b *chatToResponsesStreamBuilder) handleToolCallDelta(tc *dto.ToolCallResponse) {
	// Index 字段在 chat completion chunk 里是 *int,nil 时按 0 处理
	idx := 0
	if tc.Index != nil {
		idx = *tc.Index
	}

	state, ok := b.toolCallStates[idx]
	if !ok {
		state = &toolCallStreamState{
			index:  idx,
			itemId: fmt.Sprintf("fc_%s_%d", b.responseId, idx),
		}
		b.toolCallStates[idx] = state
		b.toolCallOrder = append(b.toolCallOrder, idx)
	}

	if tc.ID != "" {
		state.callId = tc.ID
	}
	if tc.Function.Name != "" {
		state.name = tc.Function.Name
	}

	// 第一次见到此 tool_call → 发 output_item.added
	if !state.sentItemAdded {
		if !b.ensureResponseCreated() {
			return
		}
		// output_index:跟 message item 不冲突,从 1 开始
		outputIndex := b.toolCallOutputIndex(idx)
		item := map[string]any{
			"id":        state.itemId,
			"type":      "function_call",
			"status":    "in_progress",
			"call_id":   state.callId,
			"name":      state.name,
			"arguments": "",
		}
		if !b.sendEvent("response.output_item.added", map[string]any{
			"output_index": outputIndex,
			"item":         item,
		}) {
			return
		}
		state.sentItemAdded = true
	}

	// arguments delta
	if tc.Function.Arguments != "" {
		state.accumArgs.WriteString(tc.Function.Arguments)
		if !b.sendEvent("response.function_call_arguments.delta", map[string]any{
			"item_id":      state.itemId,
			"output_index": b.toolCallOutputIndex(idx),
			"delta":        tc.Function.Arguments,
		}) {
			return
		}
	}
}

// toolCallOutputIndex 计算 tool_call 的 output_index。
// message item 永远 index=0(不管是否真的发出了 message 内容),tool_call 从 1 开始。
func (b *chatToResponsesStreamBuilder) toolCallOutputIndex(idx int) int {
	for i, n := range b.toolCallOrder {
		if n == idx {
			return i + 1
		}
	}
	return idx + 1
}

// finalize 流结束时,补发所有 done 事件 + response.completed
func (b *chatToResponsesStreamBuilder) finalize() {
	// 1. 如果有 message item,补发 done 事件(message text → content_part → output_item)
	if b.sentMessageItemAdded && !b.sentMessageItemDone {
		text := b.accumText.String()

		_ = b.sendEvent("response.output_text.done", map[string]any{
			"item_id":       b.msgItemId,
			"output_index":  0,
			"content_index": 0,
			"text":          text,
		})
		_ = b.sendEvent("response.content_part.done", map[string]any{
			"item_id":       b.msgItemId,
			"output_index":  0,
			"content_index": 0,
			"part": map[string]any{
				"type": "output_text",
				"text": text,
			},
		})
		_ = b.sendEvent("response.output_item.done", map[string]any{
			"output_index": 0,
			"item": map[string]any{
				"id":     b.msgItemId,
				"type":   "message",
				"status": "completed",
				"role":   "assistant",
				"content": []map[string]any{
					{
						"type": "output_text",
						"text": text,
					},
				},
			},
		})
		b.sentMessageItemDone = true
	}

	// 2. 每个 tool_call 补 arguments.done + output_item.done
	for _, idx := range b.toolCallOrder {
		state := b.toolCallStates[idx]
		if state == nil || state.sentItemDone {
			continue
		}
		args := state.accumArgs.String()
		_ = b.sendEvent("response.function_call_arguments.done", map[string]any{
			"item_id":      state.itemId,
			"output_index": b.toolCallOutputIndex(idx),
			"arguments":    args,
		})
		_ = b.sendEvent("response.output_item.done", map[string]any{
			"output_index": b.toolCallOutputIndex(idx),
			"item": map[string]any{
				"id":        state.itemId,
				"type":      "function_call",
				"status":    "completed",
				"call_id":   state.callId,
				"name":      state.name,
				"arguments": args,
			},
		})
		state.sentItemDone = true
	}

	// 3. 最后:response.completed(必须带 usage)
	usage := b.usage
	if usage == nil {
		usage = &dto.Usage{}
	}

	// 构造完整 output 数组(用于 response.completed 事件)
	output := make([]map[string]any, 0, 1+len(b.toolCallStates))
	if b.sentMessageItemDone {
		output = append(output, map[string]any{
			"id":     b.msgItemId,
			"type":   "message",
			"status": "completed",
			"role":   "assistant",
			"content": []map[string]any{
				{"type": "output_text", "text": b.accumText.String()},
			},
		})
	}
	for _, idx := range b.toolCallOrder {
		state := b.toolCallStates[idx]
		if state == nil {
			continue
		}
		output = append(output, map[string]any{
			"id":        state.itemId,
			"type":      "function_call",
			"status":    "completed",
			"call_id":   state.callId,
			"name":      state.name,
			"arguments": state.accumArgs.String(),
		})
	}

	usagePayload := map[string]any{
		"input_tokens":  usage.PromptTokens,
		"output_tokens": usage.CompletionTokens,
		"total_tokens":  usage.TotalTokens,
	}

	completed := map[string]any{
		"id":         b.responseId,
		"object":     "response",
		"created_at": b.createdAt,
		"status":     "completed",
		"model":      b.model,
		"output":     output,
		"usage":      usagePayload,
	}
	_ = b.sendEvent("response.completed", map[string]any{"response": completed})
	b.sentResponseCompleted = true
}

// 兜底:让 builder 实现 io.Closer 风格,即使 streamErr 也能让外面知道
var _ = errors.New // 占位防止 errors 包未使用警告
