package openaicompat

import "github.com/QuantumNous/new-api/setting/model_setting"

func ShouldChatCompletionsUseResponsesPolicy(policy model_setting.ChatCompletionsToResponsesPolicy, channelID int, channelType int, model string) bool {
	if !policy.IsChannelEnabled(channelID, channelType) {
		return false
	}
	return matchAnyRegex(policy.ModelPatterns, model)
}

func ShouldChatCompletionsUseResponsesGlobal(channelID int, channelType int, model string) bool {
	return ShouldChatCompletionsUseResponsesPolicy(
		model_setting.GetGlobalSettings().ChatCompletionsToResponsesPolicy,
		channelID,
		channelType,
		model,
	)
}

// ShouldResponsesUseChatCompletionsPolicy 是 ShouldChatCompletionsUseResponsesPolicy 的反向。
// 用于判断:codex 客户的 /v1/responses 请求是否要被翻译成 chat completions 发给上游(蹭 mimo 等只支持 chat 的 channel)。
//
// 注意:跟 ChatCompletionsToResponses 不同,这里 ModelPatterns 为空时**视为全部模型匹配**。
// 因为反向场景的典型用法是"所有 codex 流量蹭 mimo",几乎不会限定特定模型。
// 反过来如果要限制,显式列模型 regex 即可。
func ShouldResponsesUseChatCompletionsPolicy(policy model_setting.ResponsesToChatCompletionsPolicy, channelID int, channelType int, model string) bool {
	if !policy.IsChannelEnabled(channelID, channelType) {
		return false
	}
	if len(policy.ModelPatterns) == 0 {
		return true // 默认全模型适用,不需要显式配 .*
	}
	return matchAnyRegex(policy.ModelPatterns, model)
}

func ShouldResponsesUseChatCompletionsGlobal(channelID int, channelType int, model string) bool {
	return ShouldResponsesUseChatCompletionsPolicy(
		model_setting.GetGlobalSettings().ResponsesToChatCompletionsPolicy,
		channelID,
		channelType,
		model,
	)
}
