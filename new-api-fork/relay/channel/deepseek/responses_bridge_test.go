package deepseek

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestDeepSeekResponsesRequestToChatRequest(t *testing.T) {
	stream := true
	maxOutputTokens := uint(123)
	temp := 0.2
	req := dto.OpenAIResponsesRequest{
		Model:           "gpt-5.5",
		Instructions:    mustJSONRaw(t, `"Be terse."`),
		Input:           mustJSONRaw(t, `[{"role":"user","content":[{"type":"input_text","text":"Say OK only."}]}]`),
		Stream:          &stream,
		MaxOutputTokens: &maxOutputTokens,
		Temperature:     &temp,
		Tools:           mustJSONRaw(t, `[{"type":"function","name":"lookup","description":"search","parameters":{"type":"object"}}]`),
		ToolChoice:      mustJSONRaw(t, `"auto"`),
		Store:           mustJSONRaw(t, `false`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	chatReq, err := deepSeekResponsesRequestToChatRequest(info, req)
	require.NoError(t, err)
	require.Equal(t, "deepseek-v4-pro", chatReq.Model)
	require.NotNil(t, chatReq.Stream)
	require.True(t, *chatReq.Stream)
	require.Equal(t, maxOutputTokens, *chatReq.MaxCompletionTokens)
	require.Equal(t, temp, *chatReq.Temperature)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "system", chatReq.Messages[0].Role)
	require.Equal(t, "Be terse.", chatReq.Messages[0].StringContent())
	require.Equal(t, "user", chatReq.Messages[1].Role)
	require.Equal(t, "Say OK only.", chatReq.Messages[1].StringContent())
	require.Len(t, chatReq.Tools, 1)
	require.Equal(t, "function", chatReq.Tools[0].Type)
	require.Equal(t, "lookup", chatReq.Tools[0].Function.Name)
	require.Equal(t, []any{}, chatReq.Tools[0].Function.Parameters.(map[string]any)["required"])
	require.NotNil(t, chatReq.ToolChoice)
	require.Empty(t, chatReq.Store)
}

func TestDeepSeekResponsesRequestDropsNonFunctionToolsAndToolChoice(t *testing.T) {
	stream := false
	req := dto.OpenAIResponsesRequest{
		Model:      "gpt-5.5",
		Input:      mustJSONRaw(t, `"Say OK only."`),
		Stream:     &stream,
		Tools:      mustJSONRaw(t, `[{"type":"web_search_preview"}]`),
		ToolChoice: mustJSONRaw(t, `"auto"`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	chatReq, err := deepSeekResponsesRequestToChatRequest(info, req)
	require.NoError(t, err)
	require.Empty(t, chatReq.Tools)
	require.Nil(t, chatReq.ToolChoice)
}

func TestDeepSeekResponsesRequestConvertsOrphanFunctionOutputToUserMessage(t *testing.T) {
	req := dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: mustJSONRaw(t, `[
			{"type":"function_call_output","call_id":"call_lookup","output":"{\"result\":\"OK\"}"}
		]`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	chatReq, err := deepSeekResponsesRequestToChatRequest(info, req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 1)
	require.Equal(t, "user", chatReq.Messages[0].Role)
	require.Contains(t, chatReq.Messages[0].StringContent(), "Tool result for call_lookup")
	require.Contains(t, chatReq.Messages[0].StringContent(), `{"result":"OK"}`)
	require.Empty(t, chatReq.Messages[0].ToolCallId)
}

func TestDeepSeekResponsesRequestConvertsFunctionCallHistoryToUserTranscript(t *testing.T) {
	req := dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: mustJSONRaw(t, `[
			{"type":"function_call","call_id":"call_lookup","name":"lookup","arguments":"{\"query\":\"OK\"}"},
			{"type":"function_call_output","call_id":"call_lookup","output":"{\"result\":\"OK\"}"}
		]`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	chatReq, err := deepSeekResponsesRequestToChatRequest(info, req)
	require.NoError(t, err)
	require.Len(t, chatReq.Messages, 2)
	require.Equal(t, "user", chatReq.Messages[0].Role)
	require.Contains(t, chatReq.Messages[0].StringContent(), "Assistant requested tool lookup (call_lookup)")
	require.Contains(t, chatReq.Messages[0].StringContent(), `{"query":"OK"}`)
	require.Empty(t, chatReq.Messages[0].ToolCalls)
	require.Equal(t, "user", chatReq.Messages[1].Role)
	require.Empty(t, chatReq.Messages[1].ToolCallId)
	require.Contains(t, chatReq.Messages[1].StringContent(), "Tool result for call_lookup")
	require.Contains(t, chatReq.Messages[1].StringContent(), `{"result":"OK"}`)
}

func TestDeepSeekOpenAIRequestSanitizesImageURLParts(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "gpt-5.5",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					map[string]any{"type": "text", "text": "What is in this image?"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}},
				},
			},
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, &relaycommon.RelayInfo{}, req)
	require.NoError(t, err)
	chatReq := converted.(*dto.GeneralOpenAIRequest)
	require.Len(t, chatReq.Messages, 1)
	require.Contains(t, chatReq.Messages[0].StringContent(), "What is in this image?")
	require.Contains(t, chatReq.Messages[0].StringContent(), "image omitted")

	body, err := common.Marshal(chatReq)
	require.NoError(t, err)
	require.NotContains(t, string(body), "image_url")
	require.NotContains(t, string(body), "data:image")
}

func TestDeepSeekResponsesRequestSanitizesInputImageParts(t *testing.T) {
	req := dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
		Input: mustJSONRaw(t, `[
			{"role":"user","content":[
				{"type":"input_text","text":"What is in this image?"},
				{"type":"input_image","image_url":"data:image/png;base64,AAAA","detail":"high"}
			]}
		]`),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, req)
	require.NoError(t, err)
	chatReq := converted.(*dto.GeneralOpenAIRequest)
	require.Equal(t, "deepseek-v4-pro", chatReq.Model)
	require.Len(t, chatReq.Messages, 1)
	require.Contains(t, chatReq.Messages[0].StringContent(), "What is in this image?")
	require.Contains(t, chatReq.Messages[0].StringContent(), "image omitted")

	body, err := common.Marshal(chatReq)
	require.NoError(t, err)
	require.NotContains(t, string(body), "image_url")
	require.NotContains(t, string(body), "data:image")
}

func TestChatResponseToResponsesResponseMasksUpstreamModel(t *testing.T) {
	chatResp := &dto.OpenAITextResponse{
		Id:      "chatcmpl-test",
		Object:  "chat.completion",
		Created: float64(1710000000),
		Model:   "deepseek-v4-pro",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index: 0,
				Message: dto.Message{
					Role:    "assistant",
					Content: "OK",
				},
				FinishReason: "stop",
			},
		},
		Usage: dto.Usage{
			PromptTokens:     3,
			CompletionTokens: 1,
			TotalTokens:      4,
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	resp := chatResponseToResponsesResponse(nil, info, chatResp)
	require.Equal(t, "resp_chatcmpl-test", resp.ID)
	require.Equal(t, "response", resp.Object)
	require.Equal(t, "gpt-5.5", resp.Model)
	require.JSONEq(t, `"completed"`, string(resp.Status))
	require.Len(t, resp.Output, 1)
	require.Equal(t, "message", resp.Output[0].Type)
	require.Equal(t, "assistant", resp.Output[0].Role)
	require.Equal(t, "OK", resp.Output[0].Content[0].Text)
	require.Equal(t, 3, resp.Usage.InputTokens)
	require.Equal(t, 1, resp.Usage.OutputTokens)
	require.Equal(t, 4, resp.Usage.TotalTokens)
}

func TestChatResponseToResponsesResponsePrefersClientModelContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("client_model", "gpt-5.5")
	chatResp := &dto.OpenAITextResponse{
		Id:      "chatcmpl-test",
		Created: float64(1710000000),
		Model:   "gpt-5.4-mini-2026-03-17",
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index: 0,
				Message: dto.Message{
					Role:    "assistant",
					Content: "OK",
				},
				FinishReason: "stop",
			},
		},
		Usage: dto.Usage{
			PromptTokens:     3,
			CompletionTokens: 1,
			TotalTokens:      4,
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.4-mini-2026-03-17",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}

	resp := chatResponseToResponsesResponse(c, info, chatResp)
	require.Equal(t, "gpt-5.5", resp.Model)
}

func TestDeepSeekResponsesStreamStateEmitsResponsesEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "req123")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}
	state := newDeepSeekResponsesStreamState(c, info)

	delta := "OK"
	stop := "stop"
	err := state.handleChatChunk(c, &dto.ChatCompletionsStreamResponse{
		Id:      "chatcmpl-stream",
		Object:  "chat.completion.chunk",
		Created: 1710000001,
		Model:   "deepseek-v4-pro",
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					Content: &delta,
				},
			},
			{
				Index:        0,
				FinishReason: &stop,
			},
		},
	})
	require.NoError(t, err)
	usage := state.finalize(c)
	require.NotNil(t, usage)

	body := recorder.Body.String()
	require.Contains(t, body, "event: response.created")
	require.Contains(t, body, "event: response.output_item.added")
	require.Contains(t, body, "event: response.output_text.delta")
	require.Contains(t, body, `"delta":"OK"`)
	require.Contains(t, body, "event: response.completed")
	require.Contains(t, body, `"model":"gpt-5.5"`)
	require.Contains(t, body, "data: [DONE]")
	require.False(t, strings.Contains(body, "deepseek-v4-pro"))
}

func TestDeepSeekResponsesStreamStateEmitsFunctionCallEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "req123")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.5",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "deepseek-v4-pro",
		},
	}
	state := newDeepSeekResponsesStreamState(c, info)

	index := 0
	stop := "tool_calls"
	err := state.handleChatChunk(c, &dto.ChatCompletionsStreamResponse{
		Id:      "chatcmpl-tool",
		Object:  "chat.completion.chunk",
		Created: 1710000001,
		Model:   "deepseek-v4-pro",
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					ToolCalls: []dto.ToolCallResponse{
						{
							Index: &index,
							ID:    "call_1",
							Type:  "function",
							Function: dto.FunctionResponse{
								Name:      "lookup",
								Arguments: `{"query":"`,
							},
						},
					},
				},
			},
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					ToolCalls: []dto.ToolCallResponse{
						{
							Index: &index,
							Type:  "function",
							Function: dto.FunctionResponse{
								Arguments: `OK"}`,
							},
						},
					},
				},
				FinishReason: &stop,
			},
		},
	})
	require.NoError(t, err)
	usage := state.finalize(c)
	require.NotNil(t, usage)

	body := recorder.Body.String()
	require.Contains(t, body, "event: response.output_item.added")
	require.Contains(t, body, `"type":"function_call"`)
	require.Contains(t, body, `"name":"lookup"`)
	require.Contains(t, body, "event: response.function_call_arguments.delta")
	require.Contains(t, body, "event: response.function_call_arguments.done")
	require.Contains(t, body, `"arguments":"{\"query\":\"OK\"}"`)
	require.Contains(t, body, "event: response.completed")
	require.NotContains(t, body, `"type":"message"`)
	require.False(t, strings.Contains(body, "deepseek-v4-pro"))
}

func mustJSONRaw(t *testing.T, s string) []byte {
	t.Helper()
	var v any
	require.NoError(t, common.Unmarshal([]byte(s), &v))
	return []byte(s)
}
