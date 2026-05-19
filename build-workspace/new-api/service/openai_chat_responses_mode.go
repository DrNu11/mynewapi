package service

import (
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service/openaicompat"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func ShouldChatCompletionsUseResponsesPolicy(policy model_setting.ChatCompletionsToResponsesPolicy, channelID int, channelType int, model string) bool {
	return openaicompat.ShouldChatCompletionsUseResponsesPolicy(policy, channelID, channelType, model)
}

func ShouldChatCompletionsUseResponsesGlobal(channelID int, channelType int, model string) bool {
	return openaicompat.ShouldChatCompletionsUseResponsesGlobal(channelID, channelType, model)
}

// 反向 policy(/v1/responses → 上游 chat completions)
func ShouldResponsesUseChatCompletionsPolicy(policy model_setting.ResponsesToChatCompletionsPolicy, channelID int, channelType int, model string) bool {
	return openaicompat.ShouldResponsesUseChatCompletionsPolicy(policy, channelID, channelType, model)
}

func ShouldResponsesUseChatCompletionsGlobal(channelID int, channelType int, model string) bool {
	return openaicompat.ShouldResponsesUseChatCompletionsGlobal(channelID, channelType, model)
}

// ResponsesRequestToChatCompletionsRequest 暴露 openaicompat 同名函数给 relay 包使用
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequest(req)
}

// ChatCompletionsResponseToResponsesResponse 暴露 openaicompat 同名函数给 relay 包使用
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, requestId string) (*dto.OpenAIResponsesResponse, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponse(resp, requestId)
}
