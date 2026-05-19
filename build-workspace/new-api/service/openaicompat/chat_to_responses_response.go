package openaicompat

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ChatCompletionsResponseToResponsesResponse 把 chat completions 非流式响应翻译成 responses 响应。
//
// 用途:codex 客户发 /v1/responses → NewAPI 翻译成 chat → 上游(mimo)返回 chat 响应
//      → 本函数把 chat 响应翻译回 responses 格式给客户。
//
// 这是 responses_to_chat.go 中 ResponsesResponseToChatCompletionsResponse 的反向。
//
// 翻译规则:
//
//	Chat Completions Response          → Responses Response
//	────────────────────────────────────────────────────────────
//	id                                 → id (建议加 resp_ 前缀,但保留原 id 也可)
//	created (int64)                    → created_at (int)
//	model                              → model
//	choices[0].message.content (str)   → output[0]{type:message, role:assistant,
//	                                       content:[{type:output_text, text}]}
//	choices[0].message.tool_calls      → output[].{type:function_call, call_id, name, arguments}
//	choices[0].finish_reason           → status (completed / incomplete)
//	usage.prompt_tokens                → usage.input_tokens
//	usage.completion_tokens            → usage.output_tokens
//	usage.total_tokens                 → usage.total_tokens
//	usage.completion_token_details.reasoning_tokens → 同名,放到 output_tokens_details
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, requestId string) (*dto.OpenAIResponsesResponse, error) {
	if resp == nil {
		return nil, errors.New("response is nil")
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("response has no choices")
	}

	choice := resp.Choices[0]
	msg := choice.Message

	output := make([]dto.ResponsesOutput, 0, 4)

	// 1. 文本 content → 一条 message output
	if text := msg.StringContent(); text != "" {
		output = append(output, dto.ResponsesOutput{
			Type:   "message",
			ID:     fmt.Sprintf("msg_%s", requestId),
			Status: "completed",
			Role:   "assistant",
			Content: []dto.ResponsesOutputContent{
				{
					Type: "output_text",
					Text: text,
				},
			},
		})
	}

	// 2. tool_calls → 多条 function_call output items
	for _, tc := range msg.ParseToolCalls() {
		if tc.Function.Name == "" {
			continue
		}
		callId := tc.ID
		if callId == "" {
			callId = fmt.Sprintf("fc_%s_%d", requestId, len(output))
		}
		// arguments 是 string,需要包成 RawMessage
		var argsRaw []byte
		if tc.Function.Arguments != "" {
			// 如果是合法 JSON,直接用;否则当字符串包起来
			if isValidJson(tc.Function.Arguments) {
				argsRaw = []byte(tc.Function.Arguments)
			} else {
				argsRaw, _ = common.Marshal(tc.Function.Arguments)
			}
		}
		output = append(output, dto.ResponsesOutput{
			Type:      "function_call",
			ID:        fmt.Sprintf("fc_%s_%d", requestId, len(output)),
			Status:    "completed",
			CallId:    callId,
			Name:      tc.Function.Name,
			Arguments: argsRaw,
		})
	}

	// 3. 状态推断:有 finish_reason=stop/tool_calls/length → 对应状态
	status := "completed"
	switch choice.FinishReason {
	case "length", "content_filter":
		status = "incomplete"
	case "stop", "tool_calls", "function_call", "":
		status = "completed"
	default:
		status = "completed"
	}
	statusRaw, _ := common.Marshal(status)

	// 4. created (any) → created_at (int)
	createdAt := 0
	switch v := resp.Created.(type) {
	case int:
		createdAt = v
	case int64:
		createdAt = int(v)
	case float64:
		createdAt = int(v)
	}

	// 5. usage 转换(字段名映射)
	var usage *dto.Usage
	if resp.Usage.PromptTokens != 0 || resp.Usage.CompletionTokens != 0 || resp.Usage.TotalTokens != 0 {
		u := resp.Usage // copy
		// chat 的 prompt_tokens 是 responses 的 input_tokens
		u.InputTokens = u.PromptTokens
		u.OutputTokens = u.CompletionTokens
		usage = &u
	}

	out := &dto.OpenAIResponsesResponse{
		ID:        fmt.Sprintf("resp_%s", requestId),
		Object:    "response",
		CreatedAt: createdAt,
		Status:    statusRaw,
		Model:     resp.Model,
		Output:    output,
		Usage:     usage,
	}

	return out, nil
}

// isValidJson 检查字符串是否是合法 JSON(用于 function_call.arguments)
func isValidJson(s string) bool {
	if s == "" {
		return false
	}
	var v any
	return common.UnmarshalJsonStr(s, &v) == nil
}
