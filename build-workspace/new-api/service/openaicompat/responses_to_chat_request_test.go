package openaicompat

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/samber/lo"
)

// rawJSON 测试辅助:把 v 序列化成 json.RawMessage
func rawJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal helper failed: %v", err)
	}
	return b
}

// TestResponsesToChat_SimpleUserText 验证最简单的 user 文本
func TestResponsesToChat_SimpleUserText(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "hello"},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if out.Model != "gpt-5.5" {
		t.Errorf("model mismatch: %s", out.Model)
	}
	if len(out.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(out.Messages))
	}
	m := out.Messages[0]
	if m.Role != "user" {
		t.Errorf("role mismatch: %s", m.Role)
	}
	if got, _ := m.Content.(string); got != "hello" {
		t.Errorf("content mismatch: %v", m.Content)
	}
}

// TestResponsesToChat_StringInput 验证 input 是单一 string 的情况
func TestResponsesToChat_StringInput(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, "hi there"),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(out.Messages))
	}
	if got, _ := out.Messages[0].Content.(string); got != "hi there" {
		t.Errorf("content mismatch: %v", out.Messages[0].Content)
	}
}

// TestResponsesToChat_InstructionsAsSystem 验证 instructions 转成第一条 system
func TestResponsesToChat_InstructionsAsSystem(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "gpt-5.5",
		Instructions: rawJSON(t, "You are a helpful assistant."),
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "hi"},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(out.Messages))
	}
	if out.Messages[0].Role != "system" {
		t.Errorf("first role expect system, got %s", out.Messages[0].Role)
	}
	if got, _ := out.Messages[0].Content.(string); got != "You are a helpful assistant." {
		t.Errorf("system content mismatch: %v", out.Messages[0].Content)
	}
	if out.Messages[1].Role != "user" {
		t.Errorf("second role expect user, got %s", out.Messages[1].Role)
	}
}

// TestResponsesToChat_DeveloperToSystem 验证 developer role 转成 system
func TestResponsesToChat_DeveloperToSystem(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "developer",
				"content": []map[string]any{
					{"type": "input_text", "text": "<permissions instructions>..."},
				},
			},
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "list files"},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(out.Messages))
	}
	if out.Messages[0].Role != "system" {
		t.Errorf("developer should map to system, got %s", out.Messages[0].Role)
	}
}

// TestResponsesToChat_FunctionCallMergedToAssistant 验证 function_call 合并到上一条 assistant
func TestResponsesToChat_FunctionCallMergedToAssistant(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "list files"},
				},
			},
			{
				"type": "message",
				"role": "assistant",
				"content": []map[string]any{
					{"type": "output_text", "text": "I'll list the files."},
				},
			},
			{
				"type":      "function_call",
				"call_id":   "fc_123",
				"name":      "shell",
				"arguments": `{"command": ["ls"]}`,
			},
			{
				"type":    "function_call_output",
				"call_id": "fc_123",
				"output":  "file1.txt\nfile2.txt",
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 3 {
		t.Fatalf("expected 3 messages (user + assistant_with_tool_calls + tool_result), got %d", len(out.Messages))
	}

	// 检查 assistant 的 tool_calls
	asst := out.Messages[1]
	if asst.Role != "assistant" {
		t.Errorf("expected assistant, got %s", asst.Role)
	}
	tcs := asst.ParseToolCalls()
	if len(tcs) != 1 {
		t.Fatalf("expected 1 tool call merged into assistant, got %d", len(tcs))
	}
	if tcs[0].ID != "fc_123" {
		t.Errorf("call_id mismatch: %s", tcs[0].ID)
	}
	if tcs[0].Function.Name != "shell" {
		t.Errorf("function name mismatch: %s", tcs[0].Function.Name)
	}
	if tcs[0].Function.Arguments != `{"command": ["ls"]}` {
		t.Errorf("arguments mismatch: %s", tcs[0].Function.Arguments)
	}

	// 检查 tool result
	tool := out.Messages[2]
	if tool.Role != "tool" {
		t.Errorf("expected tool, got %s", tool.Role)
	}
	if tool.ToolCallId != "fc_123" {
		t.Errorf("tool_call_id mismatch: %s", tool.ToolCallId)
	}
	if got, _ := tool.Content.(string); got != "file1.txt\nfile2.txt" {
		t.Errorf("tool content mismatch: %v", tool.Content)
	}
}

// TestResponsesToChat_OrphanFunctionCallCreatesAssistant 验证孤立的 function_call(没有前面的 assistant)
// 会自己新建一条 assistant 消息
func TestResponsesToChat_OrphanFunctionCallCreatesAssistant(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "go"},
				},
			},
			{
				"type":      "function_call",
				"call_id":   "fc_999",
				"name":      "exec",
				"arguments": `{}`,
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 2 {
		t.Fatalf("expected 2 messages (user + new assistant), got %d", len(out.Messages))
	}
	if out.Messages[1].Role != "assistant" {
		t.Errorf("expected assistant, got %s", out.Messages[1].Role)
	}
	tcs := out.Messages[1].ParseToolCalls()
	if len(tcs) != 1 || tcs[0].ID != "fc_999" {
		t.Errorf("expected 1 tool_call fc_999, got %v", tcs)
	}
}

// TestResponsesToChat_ReasoningSkipped 验证 reasoning items 被跳过
func TestResponsesToChat_ReasoningSkipped(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "compute 2+2"},
				},
			},
			{
				"type":    "reasoning",
				"summary": "user wants math",
				"content": []map[string]any{
					{"type": "summary_text", "text": "thinking..."},
				},
			},
			{
				"type": "message",
				"role": "assistant",
				"content": []map[string]any{
					{"type": "output_text", "text": "4"},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 2 {
		t.Fatalf("expected 2 messages (user + assistant, reasoning skipped), got %d", len(out.Messages))
	}
}

// TestResponsesToChat_Tools 验证 tools 平铺 → 嵌套
func TestResponsesToChat_Tools(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, "hi"),
		Tools: rawJSON(t, []map[string]any{
			{
				"type":        "function",
				"name":        "shell",
				"description": "Run a shell command",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"command": map[string]any{"type": "array"},
					},
				},
			},
			// 应该被忽略(非 function 类型)
			{
				"type": "web_search_preview",
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Tools) != 1 {
		t.Fatalf("expected 1 tool (function only), got %d", len(out.Tools))
	}
	if out.Tools[0].Type != "function" {
		t.Errorf("type mismatch: %s", out.Tools[0].Type)
	}
	if out.Tools[0].Function.Name != "shell" {
		t.Errorf("name mismatch: %s", out.Tools[0].Function.Name)
	}
	if out.Tools[0].Function.Description != "Run a shell command" {
		t.Errorf("description mismatch: %s", out.Tools[0].Function.Description)
	}
	if out.Tools[0].Function.Parameters == nil {
		t.Error("parameters should not be nil")
	}
}

// TestResponsesToChat_ToolChoiceObject 验证 object 形式 tool_choice 转换
func TestResponsesToChat_ToolChoiceObject(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:      "gpt-5.5",
		Input:      rawJSON(t, "hi"),
		ToolChoice: rawJSON(t, map[string]any{"type": "function", "name": "shell"}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	tc, ok := out.ToolChoice.(map[string]any)
	if !ok {
		t.Fatalf("tool_choice should be map, got %T", out.ToolChoice)
	}
	if tc["type"] != "function" {
		t.Errorf("type mismatch: %v", tc["type"])
	}
	fn, ok := tc["function"].(map[string]any)
	if !ok {
		t.Fatalf("function field missing or wrong type: %T", tc["function"])
	}
	if fn["name"] != "shell" {
		t.Errorf("function name mismatch: %v", fn["name"])
	}
}

// TestResponsesToChat_ToolChoiceString 验证 string tool_choice 透传
func TestResponsesToChat_ToolChoiceString(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:      "gpt-5.5",
		Input:      rawJSON(t, "hi"),
		ToolChoice: rawJSON(t, "auto"),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if got, _ := out.ToolChoice.(string); got != "auto" {
		t.Errorf("tool_choice string not preserved: %v", out.ToolChoice)
	}
}

// TestResponsesToChat_TextJsonSchema 验证 text.format → response_format
func TestResponsesToChat_TextJsonSchema(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, "give me json"),
		Text: rawJSON(t, map[string]any{
			"format": map[string]any{
				"type":   "json_schema",
				"name":   "result",
				"strict": true,
				"schema": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"answer": map[string]any{"type": "string"},
					},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if out.ResponseFormat == nil {
		t.Fatal("response_format should not be nil")
	}
	if out.ResponseFormat.Type != "json_schema" {
		t.Errorf("type mismatch: %s", out.ResponseFormat.Type)
	}
	if len(out.ResponseFormat.JsonSchema) == 0 {
		t.Error("json_schema field empty")
	}

	// 验证 json_schema payload 包含 schema/name/strict 但不含 type
	var payload map[string]any
	if err := json.Unmarshal(out.ResponseFormat.JsonSchema, &payload); err != nil {
		t.Fatalf("json_schema parse failed: %v", err)
	}
	if _, ok := payload["schema"]; !ok {
		t.Error("json_schema payload missing schema field")
	}
	if _, ok := payload["type"]; ok {
		t.Error("json_schema payload should NOT contain type field (it's at outer level)")
	}
}

// TestResponsesToChat_MaxOutputTokens 验证 max_output_tokens → max_tokens + max_completion_tokens
func TestResponsesToChat_MaxOutputTokens(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:           "gpt-5.5",
		Input:           rawJSON(t, "hi"),
		MaxOutputTokens: lo.ToPtr(uint(1000)),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if lo.FromPtr(out.MaxTokens) != 1000 {
		t.Errorf("max_tokens mismatch: %v", out.MaxTokens)
	}
	if lo.FromPtr(out.MaxCompletionTokens) != 1000 {
		t.Errorf("max_completion_tokens mismatch: %v", out.MaxCompletionTokens)
	}
}

// TestResponsesToChat_ReasoningEffort 验证 reasoning.effort → reasoning_effort
func TestResponsesToChat_ReasoningEffort(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, "hi"),
		Reasoning: &dto.Reasoning{
			Effort:  "medium",
			Summary: "detailed",
		},
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if out.ReasoningEffort != "medium" {
		t.Errorf("reasoning_effort mismatch: %s", out.ReasoningEffort)
	}
}

// TestResponsesToChat_StreamFlag 验证 stream 标志透传
func TestResponsesToChat_StreamFlag(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:  "gpt-5.5",
		Input:  rawJSON(t, "hi"),
		Stream: lo.ToPtr(true),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if !lo.FromPtr(out.Stream) {
		t.Error("stream flag should be true")
	}
}

// TestResponsesToChat_NilRequest 验证错误处理
func TestResponsesToChat_NilRequest(t *testing.T) {
	_, err := ResponsesRequestToChatCompletionsRequest(nil)
	if err == nil {
		t.Error("expected error on nil request")
	}
}

// TestResponsesToChat_EmptyModel 验证缺 model 报错
func TestResponsesToChat_EmptyModel(t *testing.T) {
	_, err := ResponsesRequestToChatCompletionsRequest(&dto.OpenAIResponsesRequest{
		Input: rawJSON(t, "hi"),
	})
	if err == nil {
		t.Error("expected error on empty model")
	}
}

// TestResponsesToChat_RealCodexInputSchema 用真实 codex CLI 抓的 input schema 做端到端测试
func TestResponsesToChat_RealCodexInputSchema(t *testing.T) {
	// 这是一个简化的真实 codex /v1/responses 输入(developer + user + assistant + function_call + output)
	rawInput := `[
		{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions instructions>\nFilesystem sandboxing..."}]},
		{"type":"message","role":"user","content":[{"type":"input_text","text":"list files in current dir"}]},
		{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I'll list them."}]},
		{"type":"function_call","call_id":"fc_abc","name":"shell","arguments":"{\"command\":[\"ls\",\"-la\"]}"},
		{"type":"function_call_output","call_id":"fc_abc","output":"total 16\ndrwxr-xr-x ..."},
		{"type":"reasoning","summary":"user wants directory listing"}
	]`

	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: json.RawMessage(rawInput),
		Tools: rawJSON(t, []map[string]any{
			{
				"type":        "function",
				"name":        "shell",
				"description": "Run shell",
				"parameters":  map[string]any{"type": "object"},
			},
		}),
		Stream: lo.ToPtr(true),
		Reasoning: &dto.Reasoning{
			Effort: "high",
		},
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}

	// 应该有 4 条消息:
	//   1. system (developer 转换的)
	//   2. user
	//   3. assistant (含 tool_calls)
	//   4. tool (function_call_output)
	// reasoning 被跳过
	if len(out.Messages) != 4 {
		for i, m := range out.Messages {
			t.Logf("msg[%d] role=%s content=%v tool_calls_count=%d tool_call_id=%s",
				i, m.Role, m.Content, len(m.ParseToolCalls()), m.ToolCallId)
		}
		t.Fatalf("expected 4 messages, got %d", len(out.Messages))
	}

	if out.Messages[0].Role != "system" {
		t.Errorf("[0] expected system, got %s", out.Messages[0].Role)
	}
	if out.Messages[1].Role != "user" {
		t.Errorf("[1] expected user, got %s", out.Messages[1].Role)
	}
	if out.Messages[2].Role != "assistant" {
		t.Errorf("[2] expected assistant, got %s", out.Messages[2].Role)
	}
	if len(out.Messages[2].ParseToolCalls()) != 1 {
		t.Errorf("[2] expected 1 tool_call, got %d", len(out.Messages[2].ParseToolCalls()))
	}
	if out.Messages[3].Role != "tool" {
		t.Errorf("[3] expected tool, got %s", out.Messages[3].Role)
	}
	if out.Messages[3].ToolCallId != "fc_abc" {
		t.Errorf("[3] tool_call_id mismatch: %s", out.Messages[3].ToolCallId)
	}

	// tools 应该 1 个
	if len(out.Tools) != 1 || out.Tools[0].Function.Name != "shell" {
		t.Errorf("tools mismatch: %v", out.Tools)
	}

	// stream
	if !lo.FromPtr(out.Stream) {
		t.Error("stream should be true")
	}

	// reasoning_effort
	if out.ReasoningEffort != "high" {
		t.Errorf("reasoning_effort: %s", out.ReasoningEffort)
	}
}

// TestResponsesToChat_MultiPartContent 验证多模态 content(text + image)
func TestResponsesToChat_MultiPartContent(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: rawJSON(t, []map[string]any{
			{
				"type": "message",
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "what is this?"},
					{"type": "input_image", "image_url": "https://example.com/img.png"},
				},
			},
		}),
	}

	out, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert failed: %v", err)
	}
	if len(out.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(out.Messages))
	}

	// 多个 content part 应该保留为数组(不被简化为 string)
	contentArr, ok := out.Messages[0].Content.([]any)
	if !ok {
		t.Fatalf("content should be array, got %T", out.Messages[0].Content)
	}
	if len(contentArr) != 2 {
		t.Errorf("expected 2 content parts, got %d", len(contentArr))
	}
}
