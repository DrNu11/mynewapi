package openai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayhelper "github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const invalidToolArgumentsMessage = "GLM-5.2 工具调用参数生成失败，请简化工具调用请求后重试。"

type validatedToolCall struct {
	id        string
	name      string
	arguments string
	input     map[string]any
}

// NonStreamToolsToStreamHandler validates complete non-streaming upstream tool
// arguments before synthesizing the streaming protocol requested by the client.
func NonStreamToolsToStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var upstream dto.OpenAITextResponse
	if err := common.Unmarshal(responseBody, &upstream); err != nil {
		return nil, invalidToolArgumentsError()
	}
	if oaiError := upstream.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, invalidToolArgumentsError()
	}

	toolCalls, err := validateCompleteToolCalls(&upstream, info)
	if err != nil {
		return nil, invalidToolArgumentsError()
	}

	upstream.Model = info.OriginModelName
	if upstream.Usage.PromptTokens == 0 {
		upstream.Usage.PromptTokens = info.GetEstimatePromptTokens()
		upstream.Usage.TotalTokens = upstream.Usage.PromptTokens + upstream.Usage.CompletionTokens
	}
	applyUsagePostProcessing(info, &upstream.Usage, responseBody)
	relayhelper.SetEventStreamHeaders(c)

	switch info.RelayFormat {
	case types.RelayFormatClaude:
		synthesizeClaudeToolStream(c, info, &upstream, toolCalls)
	case types.RelayFormatOpenAI:
		synthesizeOpenAIToolStream(c, info, &upstream, toolCalls)
	default:
		return nil, types.NewOpenAIError(fmt.Errorf("unsupported synthesized tool stream format"), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	return &upstream.Usage, nil
}

func validateCompleteToolCalls(response *dto.OpenAITextResponse, info *relaycommon.RelayInfo) ([]validatedToolCall, error) {
	validated := make([]validatedToolCall, 0)
	hasText := false
	for _, choice := range response.Choices {
		if choice.Message.StringContent() != "" {
			hasText = true
		}
		for _, call := range choice.Message.ParseToolCalls() {
			if call.ID == "" || call.Function.Name == "" {
				return nil, fmt.Errorf("incomplete tool call")
			}
			required, knownTool := info.ToolStreamRequiredFields[call.Function.Name]
			if len(info.ToolStreamRequiredFields) > 0 && !knownTool {
				return nil, fmt.Errorf("unknown tool call")
			}
			var input map[string]any
			if err := common.UnmarshalJsonStr(call.Function.Arguments, &input); err != nil || input == nil {
				return nil, fmt.Errorf("invalid tool arguments")
			}
			for _, field := range required {
				if _, ok := input[field]; !ok {
					return nil, fmt.Errorf("missing required tool argument")
				}
			}
			validated = append(validated, validatedToolCall{
				id:        call.ID,
				name:      stripProviderThinkingBlocks(call.Function.Name),
				arguments: call.Function.Arguments,
				input:     input,
			})
		}
	}
	if len(validated) == 0 && !hasText {
		return nil, fmt.Errorf("empty upstream response")
	}
	return validated, nil
}

func invalidToolArgumentsError() *types.NewAPIError {
	return types.WithOpenAIError(types.OpenAIError{
		Message: invalidToolArgumentsMessage,
		Type:    "invalid_tool_arguments",
		Code:    "tool_arguments_invalid",
	}, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
}

func synthesizeClaudeToolStream(c *gin.Context, info *relaycommon.RelayInfo, response *dto.OpenAITextResponse, toolCalls []validatedToolCall) {
	message := &dto.ClaudeMediaMessage{
		Id:    response.Id,
		Type:  "message",
		Role:  "assistant",
		Model: info.OriginModelName,
		Usage: &dto.ClaudeUsage{
			InputTokens:  response.Usage.PromptTokens,
			OutputTokens: 0,
		},
	}
	message.SetContent(make([]any, 0))
	_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{Type: "message_start", Message: message})

	if len(toolCalls) > 0 {
		for index, call := range toolCalls {
			idx := index
			_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{
				Type:  "content_block_start",
				Index: &idx,
				ContentBlock: &dto.ClaudeMediaMessage{
					Type:  "tool_use",
					Id:    call.id,
					Name:  call.name,
					Input: map[string]any{},
				},
			})
			_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{
				Type:  "content_block_delta",
				Index: &idx,
				Delta: &dto.ClaudeMediaMessage{
					Type:        "input_json_delta",
					PartialJson: &call.arguments,
				},
			})
			_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{Type: "content_block_stop", Index: &idx})
		}
	} else {
		content := ""
		if len(response.Choices) > 0 {
			content = stripProviderThinkingBlocks(response.Choices[0].Message.StringContent())
		}
		idx := 0
		empty := ""
		_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{
			Type: "content_block_start", Index: &idx,
			ContentBlock: &dto.ClaudeMediaMessage{Type: "text", Text: &empty},
		})
		if content != "" {
			_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{
				Type: "content_block_delta", Index: &idx,
				Delta: &dto.ClaudeMediaMessage{Type: "text_delta", Text: &content},
			})
		}
		_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{Type: "content_block_stop", Index: &idx})
	}

	stopReason := "end_turn"
	if len(toolCalls) > 0 {
		stopReason = "tool_use"
	}
	_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{
		Type:  "message_delta",
		Delta: &dto.ClaudeMediaMessage{StopReason: &stopReason},
		Usage: &dto.ClaudeUsage{OutputTokens: response.Usage.CompletionTokens},
	})
	_ = relayhelper.ClaudeData(c, dto.ClaudeResponse{Type: "message_stop"})
}

func synthesizeOpenAIToolStream(c *gin.Context, info *relaycommon.RelayInfo, response *dto.OpenAITextResponse, toolCalls []validatedToolCall) {
	created := createdAt(response.Created)
	_ = relayhelper.ObjectData(c, relayhelper.GenerateStartEmptyResponse(response.Id, created, info.OriginModelName, nil))

	if len(toolCalls) > 0 {
		streamCalls := make([]dto.ToolCallResponse, 0, len(toolCalls))
		for index, call := range toolCalls {
			idx := index
			streamCalls = append(streamCalls, dto.ToolCallResponse{
				Index: &idx,
				ID:    call.id,
				Type:  "function",
				Function: dto.FunctionResponse{
					Name:      call.name,
					Arguments: call.arguments,
				},
			})
		}
		_ = relayhelper.ObjectData(c, &dto.ChatCompletionsStreamResponse{
			Id:      response.Id,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   info.OriginModelName,
			Choices: []dto.ChatCompletionsStreamResponseChoice{{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: streamCalls},
			}},
		})
	} else if len(response.Choices) > 0 {
		content := stripProviderThinkingBlocks(response.Choices[0].Message.StringContent())
		_ = relayhelper.ObjectData(c, &dto.ChatCompletionsStreamResponse{
			Id: response.Id, Object: "chat.completion.chunk", Created: created, Model: info.OriginModelName,
			Choices: []dto.ChatCompletionsStreamResponseChoice{{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: &content},
			}},
		})
	}

	finishReason := "stop"
	if len(toolCalls) > 0 {
		finishReason = "tool_calls"
	}
	_ = relayhelper.ObjectData(c, relayhelper.GenerateStopResponse(response.Id, created, info.OriginModelName, finishReason))
	if info.ShouldIncludeUsage {
		_ = relayhelper.ObjectData(c, relayhelper.GenerateFinalUsageResponse(response.Id, created, info.OriginModelName, response.Usage))
	}
	relayhelper.Done(c)
}

func createdAt(value any) int64 {
	switch created := value.(type) {
	case float64:
		return int64(created)
	case int64:
		return created
	case int:
		return int64(created)
	case json.Number:
		if parsed, err := created.Int64(); err == nil {
			return parsed
		}
	}
	return time.Now().Unix()
}
