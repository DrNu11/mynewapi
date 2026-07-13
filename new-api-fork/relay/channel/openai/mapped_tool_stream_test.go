package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestUsesNonStreamUpstreamForMappedGLMTools(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	stream := true
	request := &dto.GeneralOpenAIRequest{
		Model:  "glm-5.2",
		Stream: &stream,
		Tools: []dto.ToolCallRequest{{
			Type: "function",
			Function: dto.FunctionRequest{
				Name: "Write",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"file_path", "content"},
				},
			},
		}},
	}
	info := &relaycommon.RelayInfo{
		IsStream:        true,
		OriginModelName: "glm-5.2",
		ChannelMeta: &relaycommon.ChannelMeta{
			IsModelMapped:     true,
			UpstreamModelName: "MiniMax-M3",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
	require.NoError(t, err)
	upstreamRequest := converted.(*dto.GeneralOpenAIRequest)
	require.NotNil(t, upstreamRequest.Stream)
	require.False(t, *upstreamRequest.Stream)
	require.True(t, info.SynthesizeToolStream)
	require.Equal(t, []string{"file_path", "content"}, info.ToolStreamRequiredFields["Write"])
	require.Equal(t, mappedToolJSONConstraint, upstreamRequest.Messages[0].StringContent())
}

func TestConvertClaudeRequestKeepsClientStreamButUsesNonStreamUpstreamForMappedGLMTools(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	stream := true
	request := &dto.ClaudeRequest{
		Model:  "glm-5.2",
		Stream: &stream,
		Tools: []dto.Tool{{
			Name: "Bash",
			InputSchema: map[string]any{
				"type":     "object",
				"required": []string{"command"},
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
				},
			},
		}},
	}
	info := &relaycommon.RelayInfo{
		IsStream:        true,
		OriginModelName: "glm-5.2",
		ChannelMeta: &relaycommon.ChannelMeta{
			IsModelMapped:     true,
			UpstreamModelName: "MiniMax-M3",
		},
	}

	converted, err := (&Adaptor{}).ConvertClaudeRequest(c, info, request)
	require.NoError(t, err)
	upstreamRequest := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, *request.Stream)
	require.False(t, *upstreamRequest.Stream)
	require.True(t, info.SynthesizeToolStream)
	require.Equal(t, []string{"command"}, info.ToolStreamRequiredFields["Bash"])
}

func TestConvertOpenAIRequestLeavesUnrelatedStreamsUnchanged(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	tests := []struct {
		name     string
		origin   string
		upstream string
		mapped   bool
		tools    bool
		stream   bool
	}{
		{name: "glm chat without tools", origin: "glm-5.2", upstream: "MiniMax-M3", mapped: true, stream: true},
		{name: "gpt mapped upstream", origin: "gpt-5", upstream: "MiniMax-M3", mapped: true, tools: true, stream: true},
		{name: "claude model", origin: "claude-opus-4-6", upstream: "MiniMax-M3", mapped: true, tools: true, stream: true},
		{name: "deepseek model", origin: "deepseek-v4", upstream: "MiniMax-M3", mapped: true, tools: true, stream: true},
		{name: "glm non minimax upstream", origin: "glm-5.2", upstream: "glm-5.2", mapped: true, tools: true, stream: true},
		{name: "glm not mapped", origin: "glm-5.2", upstream: "MiniMax-M3", tools: true, stream: true},
		{name: "glm non stream", origin: "glm-5.2", upstream: "MiniMax-M3", mapped: true, tools: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stream := tt.stream
			request := &dto.GeneralOpenAIRequest{Model: tt.origin, Stream: &stream}
			if tt.tools {
				request.Tools = []dto.ToolCallRequest{{Type: "function", Function: dto.FunctionRequest{Name: "Read"}}}
			}
			info := &relaycommon.RelayInfo{
				IsStream: tt.stream, OriginModelName: tt.origin,
				ChannelMeta: &relaycommon.ChannelMeta{IsModelMapped: tt.mapped, UpstreamModelName: tt.upstream},
			}

			converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, request)
			require.NoError(t, err)
			upstreamRequest := converted.(*dto.GeneralOpenAIRequest)
			require.Equal(t, tt.stream, *upstreamRequest.Stream)
			require.False(t, info.SynthesizeToolStream)
		})
	}
}

func TestNonStreamMappedToolResponsePreservesJSONContentInClaudeInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	info := mappedToolStreamInfo(types.RelayFormatClaude)
	upstream := `{
		"id":"chatcmpl-json",
		"model":"MiniMax-M3",
		"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"call_json","type":"function","function":{"name":"Write","arguments":"{\"file_path\":\"/tmp/a.json\",\"content\":\"{\\\"ok\\\":true,\\\"model\\\":\\\"glm-5.2\\\"}\",\"provider\":\"aws\"}"}}]}}],
		"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}
	}`
	resp := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(upstream))}

	_, apiErr := NonStreamToolsToStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	body := recorder.Body.String()
	require.Contains(t, body, `"input":{}`)
	require.Contains(t, body, `"type":"input_json_delta"`)
	require.Contains(t, body, `"partial_json":"{\"file_path\":\"/tmp/a.json\",\"content\":\"{\\\"ok\\\":true,\\\"model\\\":\\\"glm-5.2\\\"}\",\"provider\":\"aws\"}"`)
}

func TestNonStreamMappedToolResponseRejectsInvalidArguments(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	info := mappedToolStreamInfo(types.RelayFormatClaude)
	upstream := `{
		"id":"chatcmpl-invalid",
		"model":"MiniMax-M3",
		"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"call_bad","type":"function","function":{"name":"Bash","arguments":"{\"command\":\"echo hello\""}}]}}],
		"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}
	}`
	resp := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(upstream))}

	usage, apiErr := NonStreamToolsToStreamHandler(c, info, resp)
	require.Nil(t, usage)
	require.NotNil(t, apiErr)
	oaiErr := apiErr.ToOpenAIError()
	require.Equal(t, invalidToolArgumentsMessage, oaiErr.Message)
	require.Equal(t, "invalid_tool_arguments", oaiErr.Type)
	require.Equal(t, "tool_arguments_invalid", oaiErr.Code)
	require.Empty(t, recorder.Body.String())
	require.NotContains(t, oaiErr.Message, "MiniMax")
	require.NotContains(t, oaiErr.Message, "upstream")
}

func TestNonStreamMappedToolResponseRejectsMissingRequiredArguments(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	info := mappedToolStreamInfo(types.RelayFormatClaude)
	info.ToolStreamRequiredFields = map[string][]string{"Bash": {"command"}}
	upstream := `{
		"id":"chatcmpl-missing",
		"model":"MiniMax-M3",
		"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"call_missing","type":"function","function":{"name":"Bash","arguments":"{}"}}]}}],
		"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}
	}`
	resp := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(upstream))}

	usage, apiErr := NonStreamToolsToStreamHandler(c, info, resp)
	require.Nil(t, usage)
	require.NotNil(t, apiErr)
	require.Equal(t, "tool_arguments_invalid", apiErr.ToOpenAIError().Code)
	require.Empty(t, recorder.Body.String())
}

func TestNonStreamMappedToolResponseSynthesizesOpenAISSE(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := mappedToolStreamInfo(types.RelayFormatOpenAI)
	upstream := `{
		"id":"chatcmpl-openai",
		"created":123,
		"model":"MiniMax-M3",
		"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"call_openai","type":"function","function":{"name":"Write","arguments":"{\"file_path\":\"/tmp/a.json\",\"content\":\"{\\\"ok\\\":true}\"}"}}]}}],
		"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}
	}`
	resp := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(upstream))}

	_, apiErr := NonStreamToolsToStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	body := recorder.Body.String()
	require.Contains(t, body, `"model":"glm-5.2"`)
	require.Contains(t, body, `"arguments":"{\"file_path\":\"/tmp/a.json\",\"content\":\"{\\\"ok\\\":true}\"}"`)
	require.Contains(t, body, `"finish_reason":"tool_calls"`)
	require.Contains(t, body, "data: [DONE]")
	require.NotContains(t, body, "MiniMax")
	require.NotContains(t, body, "<think>")
}

func mappedToolStreamInfo(format types.RelayFormat) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		IsStream:             true,
		SynthesizeToolStream: true,
		RelayFormat:          format,
		OriginModelName:      "glm-5.2",
		ChannelMeta: &relaycommon.ChannelMeta{
			IsModelMapped:     true,
			UpstreamModelName: "MiniMax-M3",
		},
	}
}

func TestNonStreamMappedToolResponseSynthesizesClaudeSSE(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	info := &relaycommon.RelayInfo{
		IsStream:             true,
		SynthesizeToolStream: true,
		RelayFormat:          types.RelayFormatClaude,
		OriginModelName:      "glm-5.2",
		ChannelMeta: &relaycommon.ChannelMeta{
			IsModelMapped:     true,
			UpstreamModelName: "MiniMax-M3",
		},
	}
	upstream := `{
		"id":"chatcmpl-test",
		"object":"chat.completion",
		"created":123,
		"model":"MiniMax-M3",
		"choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"Bash","arguments":"{\"command\":\"echo hello\",\"description\":\"test\"}"}}]}}],
		"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}
	}`
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(upstream)),
	}

	usage, apiErr := NonStreamToolsToStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.Equal(t, 15, usage.TotalTokens)
	body := recorder.Body.String()
	require.Contains(t, body, "event: message_start")
	require.Contains(t, body, `"model":"glm-5.2"`)
	require.Contains(t, body, `"type":"tool_use"`)
	require.Contains(t, body, `"name":"Bash"`)
	require.Contains(t, body, `"input":{}`)
	require.Contains(t, body, `"type":"input_json_delta"`)
	require.Contains(t, body, `"partial_json":"{\"command\":\"echo hello\",\"description\":\"test\"}"`)
	require.Contains(t, body, "event: content_block_stop")
	require.Contains(t, body, "event: message_stop")
	require.NotContains(t, body, "MiniMax")
	require.NotContains(t, body, "<think>")
}
