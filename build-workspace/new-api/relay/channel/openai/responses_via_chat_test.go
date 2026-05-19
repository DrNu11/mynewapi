package openai

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

// TestStreamBuilder_SimpleText 端到端测试简单文本流的事件序列。
// 模拟 mimo 返回的 chat completion SSE 流,验证我们生成的 responses SSE 流
// 包含 codex CLI 必需的所有事件,且顺序正确。
func TestStreamBuilder_SimpleText(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "mimo-v2.5-pro",
		},
	}

	builder := newChatToResponsesStreamBuilder(c, info)

	// 模拟 chat 流的 4 个 chunk(类似 mimo 真实输出)
	roleStr := "assistant"
	hello := "Hello"
	world := " World"
	stopReason := "stop"

	// Chunk 1: role=assistant(builder 不应在 role chunk 上做事)
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			Role: roleStr,
		},
	})

	// Chunk 2: content="Hello"(应触发 created/in_progress/item.added/part.added/text.delta)
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			Content: &hello,
		},
	})

	// Chunk 3: content=" World"(应只触发 text.delta)
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			Content: &world,
		},
	})

	// Chunk 4: finish_reason="stop"(builder 不在这里 finalize)
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		FinishReason: &stopReason,
	})

	// 模拟 usage chunk
	builder.usage = &dto.Usage{
		PromptTokens:     10,
		CompletionTokens: 2,
		TotalTokens:      12,
	}

	// 流结束
	builder.finalize()

	output := w.Body.String()

	// 期望的事件序列(按顺序)
	expectedEvents := []string{
		"event: response.created",
		"event: response.in_progress",
		"event: response.output_item.added",
		"event: response.content_part.added",
		"event: response.output_text.delta",
		"event: response.output_text.done",
		"event: response.content_part.done",
		"event: response.output_item.done",
		"event: response.completed",
	}

	checkEventOrder(t, output, expectedEvents)

	// 文本应包含 "Hello World"
	if !strings.Contains(output, `"delta":"Hello"`) {
		t.Errorf("missing first text delta")
	}
	if !strings.Contains(output, `"delta":" World"`) {
		t.Errorf("missing second text delta")
	}
	if !strings.Contains(output, `"text":"Hello World"`) {
		t.Errorf("done event should contain accumulated text")
	}

	// usage 字段
	if !strings.Contains(output, `"input_tokens":10`) {
		t.Errorf("usage input_tokens missing")
	}
	if !strings.Contains(output, `"output_tokens":2`) {
		t.Errorf("usage output_tokens missing")
	}
}

// TestStreamBuilder_ToolCall 验证带 tool_call 的流转换
func TestStreamBuilder_ToolCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mimo-v2.5-pro"}}
	builder := newChatToResponsesStreamBuilder(c, info)

	// chat completion 的 tool_call 流式格式:
	//   chunk 1: tool_calls[0]={index:0, id, function:{name:"shell"}}
	//   chunk 2: tool_calls[0]={index:0, function:{arguments:"{\"cmd\""}}
	//   chunk 3: tool_calls[0]={index:0, function:{arguments:":\"ls\"}"}}
	idx0 := 0

	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx0,
					ID:    "call_abc",
					Type:  "function",
					Function: dto.FunctionResponse{
						Name: "shell",
					},
				},
			},
		},
	})

	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx0,
					Function: dto.FunctionResponse{
						Arguments: `{"cmd"`,
					},
				},
			},
		},
	})

	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx0,
					Function: dto.FunctionResponse{
						Arguments: `:"ls"}`,
					},
				},
			},
		},
	})

	tcReason := "tool_calls"
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		FinishReason: &tcReason,
	})

	builder.usage = &dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8}
	builder.finalize()

	output := w.Body.String()

	// 期望的事件序列
	expectedEvents := []string{
		"event: response.created",
		"event: response.in_progress",
		"event: response.output_item.added", // function_call item
		"event: response.function_call_arguments.delta",
		"event: response.function_call_arguments.done",
		"event: response.output_item.done", // function_call done
		"event: response.completed",
	}
	checkEventOrder(t, output, expectedEvents)

	// arguments 累积
	if !strings.Contains(output, `"name":"shell"`) {
		t.Errorf("tool name missing")
	}
	if !strings.Contains(output, `"call_id":"call_abc"`) {
		t.Errorf("call_id missing")
	}
	// 完整 arguments 应该是 {"cmd":"ls"}
	if !strings.Contains(output, `{\"cmd\":\"ls\"}`) {
		t.Errorf("complete arguments missing in done event, output:\n%s", output)
	}
}

// TestStreamBuilder_TextAndToolCall 验证文本 + tool_call 同时存在
func TestStreamBuilder_TextAndToolCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mimo-v2.5-pro"}}
	builder := newChatToResponsesStreamBuilder(c, info)

	prefix := "Let me check"
	idx0 := 0

	// 先发文本
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			Content: &prefix,
		},
	})

	// 再发 tool_call
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx0,
					ID:    "call_xyz",
					Type:  "function",
					Function: dto.FunctionResponse{
						Name:      "search",
						Arguments: `{"q":"x"}`,
					},
				},
			},
		},
	})

	builder.usage = &dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8}
	builder.finalize()

	output := w.Body.String()

	// 实际事件顺序(流式):
	//   created/in_progress → output_item.added(message) → content_part.added → output_text.delta
	//   → output_item.added(function_call) → function_call_arguments.delta
	//   → finalize:output_text.done → content_part.done → output_item.done(message)
	//                → function_call_arguments.done → output_item.done(function_call) → completed
	expectedEvents := []string{
		"event: response.created",
		"event: response.in_progress",
		"event: response.output_item.added", // message
		"event: response.content_part.added",
		"event: response.output_text.delta",
		"event: response.output_item.added", // function_call(在 message done 之前)
		"event: response.function_call_arguments.delta",
		"event: response.output_text.done",
		"event: response.content_part.done",
		"event: response.output_item.done", // message done
		"event: response.function_call_arguments.done",
		"event: response.output_item.done", // function_call done
		"event: response.completed",
	}
	checkEventOrder(t, output, expectedEvents)
}

// TestStreamBuilder_NoContent 验证无任何 delta 时的边界情况
func TestStreamBuilder_NoContent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mimo-v2.5-pro"}}
	builder := newChatToResponsesStreamBuilder(c, info)

	// 直接 finalize(没任何 chunk)
	builder.finalize()

	output := w.Body.String()
	// 应该只有 response.completed(没 message,没 tool_calls)
	if !strings.Contains(output, "event: response.completed") {
		t.Errorf("expected response.completed even on empty stream")
	}
	// 不应该有 output_item.added
	if strings.Contains(output, "event: response.output_item.added") {
		t.Errorf("should not emit output_item.added on empty stream")
	}
}

// TestStreamBuilder_MultiToolCalls 验证 parallel tool_calls(多个 index)
func TestStreamBuilder_MultiToolCalls(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mimo-v2.5-pro"}}
	builder := newChatToResponsesStreamBuilder(c, info)

	idx0, idx1 := 0, 1

	// 先发 tool_call 0
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx0,
					ID:    "call_0",
					Function: dto.FunctionResponse{
						Name:      "shell",
						Arguments: `{"cmd":"ls"}`,
					},
				},
			},
		},
	})

	// 再发 tool_call 1
	builder.handleChoice(&dto.ChatCompletionsStreamResponseChoice{
		Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{
				{
					Index: &idx1,
					ID:    "call_1",
					Function: dto.FunctionResponse{
						Name:      "fs_read",
						Arguments: `{"path":"/etc"}`,
					},
				},
			},
		},
	})

	builder.usage = &dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8}
	builder.finalize()

	output := w.Body.String()

	if !strings.Contains(output, `"call_id":"call_0"`) {
		t.Errorf("call_0 missing")
	}
	if !strings.Contains(output, `"call_id":"call_1"`) {
		t.Errorf("call_1 missing")
	}
	if !strings.Contains(output, `"name":"shell"`) || !strings.Contains(output, `"name":"fs_read"`) {
		t.Errorf("tool names missing")
	}

	// 应该有 2 个 output_item.done(每个 tool_call 一个)
	doneCount := strings.Count(output, "event: response.output_item.done")
	if doneCount != 2 {
		t.Errorf("expected 2 output_item.done events, got %d", doneCount)
	}
}

// checkEventOrder 验证事件按指定顺序出现(不要求连续,但要求顺序)
func checkEventOrder(t *testing.T, output string, expectedEvents []string) {
	t.Helper()
	lastIdx := 0
	for _, evt := range expectedEvents {
		idx := strings.Index(output[lastIdx:], evt)
		if idx < 0 {
			t.Errorf("event missing or out of order: %s\nfull output:\n%s", evt, output)
			return
		}
		lastIdx += idx + len(evt)
	}
}
