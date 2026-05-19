package openaicompat

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

// TestChatToResponses_SimpleText 验证简单文本响应转换
func TestChatToResponses_SimpleText(t *testing.T) {
	resp := &dto.OpenAITextResponse{
		Id:      "chatcmpl-abc",
		Object:  "chat.completion",
		Created: 1699999999,
		Model:   "gpt-5.5",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index: 0,
				Message: dto.Message{
					Role:    "assistant",
					Content: "Hello!",
				},
				FinishReason: "stop",
			},
		},
		Usage: dto.Usage{
			PromptTokens:     10,
			CompletionTokens: 5,
			TotalTokens:      15,
		},
	}

	out, err := ChatCompletionsResponseToResponsesResponse(resp, "test-001")
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}

	if out.ID != "resp_test-001" {
		t.Errorf("ID mismatch: %s", out.ID)
	}
	if out.Object != "response" {
		t.Errorf("Object: %s", out.Object)
	}
	if out.Model != "gpt-5.5" {
		t.Errorf("Model: %s", out.Model)
	}

	// status 是 RawMessage,内容是 "completed"
	var statusStr string
	if err := json.Unmarshal(out.Status, &statusStr); err != nil {
		t.Fatalf("status parse: %v", err)
	}
	if statusStr != "completed" {
		t.Errorf("status: %s", statusStr)
	}

	if len(out.Output) != 1 {
		t.Fatalf("expected 1 output, got %d", len(out.Output))
	}
	if out.Output[0].Type != "message" {
		t.Errorf("output[0].type: %s", out.Output[0].Type)
	}
	if out.Output[0].Role != "assistant" {
		t.Errorf("output[0].role: %s", out.Output[0].Role)
	}
	if len(out.Output[0].Content) != 1 || out.Output[0].Content[0].Type != "output_text" {
		t.Errorf("content mismatch: %+v", out.Output[0].Content)
	}
	if out.Output[0].Content[0].Text != "Hello!" {
		t.Errorf("text: %s", out.Output[0].Content[0].Text)
	}

	// usage 字段名映射
	if out.Usage == nil {
		t.Fatal("usage nil")
	}
	if out.Usage.InputTokens != 10 {
		t.Errorf("input_tokens: %d", out.Usage.InputTokens)
	}
	if out.Usage.OutputTokens != 5 {
		t.Errorf("output_tokens: %d", out.Usage.OutputTokens)
	}
	if out.Usage.TotalTokens != 15 {
		t.Errorf("total_tokens: %d", out.Usage.TotalTokens)
	}

	// created_at
	if out.CreatedAt != 1699999999 {
		t.Errorf("created_at: %d", out.CreatedAt)
	}
}

// TestChatToResponses_WithToolCalls 验证 tool_calls 转换成 function_call output items
func TestChatToResponses_WithToolCalls(t *testing.T) {
	msg := dto.Message{
		Role:    "assistant",
		Content: "",
	}
	msg.SetToolCalls([]dto.ToolCallRequest{
		{
			ID:   "call_abc",
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      "shell",
				Parameters: nil,
			},
		},
	})
	// SetToolCalls 不设 Arguments 字符串字段(那是 Request 的形式),
	// 实际生产环境 ToolCallResponse 才有 Arguments
	// 这里我们直接赋值
	msg.ToolCalls = json.RawMessage(`[{"id":"call_abc","type":"function","function":{"name":"shell","arguments":"{\"command\":[\"ls\"]}"}}]`)

	resp := &dto.OpenAITextResponse{
		Id:      "chatcmpl-tc",
		Object:  "chat.completion",
		Created: 1700000000,
		Model:   "gpt-5.5",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index:        0,
				Message:      msg,
				FinishReason: "tool_calls",
			},
		},
	}

	out, err := ChatCompletionsResponseToResponsesResponse(resp, "test-tc")
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}

	// 没文本 content,只有 1 条 function_call
	if len(out.Output) != 1 {
		t.Fatalf("expected 1 output (tool_call only), got %d: %+v", len(out.Output), out.Output)
	}

	fc := out.Output[0]
	if fc.Type != "function_call" {
		t.Errorf("type: %s", fc.Type)
	}
	if fc.CallId != "call_abc" {
		t.Errorf("call_id: %s", fc.CallId)
	}
	if fc.Name != "shell" {
		t.Errorf("name: %s", fc.Name)
	}

	// arguments 应该是 JSON RawMessage
	var argsObj map[string]any
	if err := json.Unmarshal(fc.Arguments, &argsObj); err != nil {
		t.Fatalf("arguments not parseable JSON: %v, raw=%s", err, string(fc.Arguments))
	}
	cmd, ok := argsObj["command"].([]any)
	if !ok || len(cmd) != 1 || cmd[0] != "ls" {
		t.Errorf("arguments command mismatch: %+v", argsObj)
	}
}

// TestChatToResponses_TextAndToolCalls 验证文本 + tool_calls 同时存在
func TestChatToResponses_TextAndToolCalls(t *testing.T) {
	msg := dto.Message{
		Role:    "assistant",
		Content: "Let me check the files first.",
	}
	msg.ToolCalls = json.RawMessage(`[{"id":"call_x","type":"function","function":{"name":"shell","arguments":"{}"}}]`)

	resp := &dto.OpenAITextResponse{
		Id:      "chatcmpl-mix",
		Created: 1700000001,
		Model:   "gpt-5.5",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Message:      msg,
				FinishReason: "tool_calls",
			},
		},
	}

	out, err := ChatCompletionsResponseToResponsesResponse(resp, "test-mix")
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}

	// 应该有 2 条 output:1 个 message + 1 个 function_call
	if len(out.Output) != 2 {
		t.Fatalf("expected 2 outputs, got %d", len(out.Output))
	}
	if out.Output[0].Type != "message" {
		t.Errorf("output[0].type: %s", out.Output[0].Type)
	}
	if out.Output[1].Type != "function_call" {
		t.Errorf("output[1].type: %s", out.Output[1].Type)
	}
}

// TestChatToResponses_FinishReasonLength 验证 finish_reason=length → status=incomplete
func TestChatToResponses_FinishReasonLength(t *testing.T) {
	resp := &dto.OpenAITextResponse{
		Created: 1700000002,
		Model:   "gpt-5.5",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Message: dto.Message{
					Role:    "assistant",
					Content: "partial answer...",
				},
				FinishReason: "length",
			},
		},
	}

	out, err := ChatCompletionsResponseToResponsesResponse(resp, "test-len")
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}

	var statusStr string
	if err := json.Unmarshal(out.Status, &statusStr); err != nil {
		t.Fatalf("status parse: %v", err)
	}
	if statusStr != "incomplete" {
		t.Errorf("status should be incomplete on length, got %s", statusStr)
	}
}

// TestChatToResponses_NilResponse 错误处理
func TestChatToResponses_NilResponse(t *testing.T) {
	_, err := ChatCompletionsResponseToResponsesResponse(nil, "x")
	if err == nil {
		t.Error("expected error on nil response")
	}
}

// TestChatToResponses_NoChoices 错误处理
func TestChatToResponses_NoChoices(t *testing.T) {
	_, err := ChatCompletionsResponseToResponsesResponse(&dto.OpenAITextResponse{Model: "gpt-5.5"}, "x")
	if err == nil {
		t.Error("expected error on no choices")
	}
}
