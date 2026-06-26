package openai

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
)

// 辅助函数
func HandleStreamFormat(c *gin.Context, info *relaycommon.RelayInfo, data string, forceFormat bool, thinkToContent bool) error {
	info.SendResponseCount++

	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		return sendStreamData(c, info, data, forceFormat, thinkToContent)
	case types.RelayFormatClaude:
		return handleClaudeFormat(c, data, info)
	case types.RelayFormatGemini:
		return handleGeminiFormat(c, data, info)
	}
	return nil
}

// maskUpstreamModelInData 当请求经过 model_mapping 时，将响应数据中的下游真实模型名
// 替换为客户端原始请求模型名，实现"严格伪装"——客户端响应里只看见自己请求的模型。
// 仅当 IsModelMapped 且 origin/upstream 模型名不同的时候才替换。
func maskUpstreamModelInData(data string, info *relaycommon.RelayInfo) string {
	if info == nil {
		return data
	}
	if info.IsModelMapped &&
		info.OriginModelName != "" &&
		info.UpstreamModelName != "" &&
		info.UpstreamModelName != info.OriginModelName {
		data = strings.ReplaceAll(data, info.UpstreamModelName, info.OriginModelName)
	}
	data = sanitizeMappedProviderData(data, info)
	return maskGPTIdentityInData(data, info)
}

func sanitizeMappedProviderChatStreamData(data string, info *relaycommon.RelayInfo) string {
	data = maskUpstreamModelInData(data, info)
	if !isMappedMiniMaxUpstream(info) {
		return data
	}
	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
		return data
	}
	changed := false
	for i := range streamResponse.Choices {
		content := streamResponse.Choices[i].Delta.GetContentString()
		if content != "" {
			streamResponse.Choices[i].Delta.SetContentString(stripProviderThinkingFromStream(content, info))
			changed = true
		}
		if streamResponse.Choices[i].Delta.ReasoningContent != nil {
			streamResponse.Choices[i].Delta.ReasoningContent = nil
			changed = true
		}
		if streamResponse.Choices[i].Delta.Reasoning != nil {
			streamResponse.Choices[i].Delta.Reasoning = nil
			changed = true
		}
		// Strip <think> from tool_calls function arguments (streaming)
		for j, tc := range streamResponse.Choices[i].Delta.ToolCalls {
			if tc.Function.Arguments != "" {
				cleaned := stripProviderThinkingBlocks(tc.Function.Arguments)
				if cleaned != tc.Function.Arguments {
					streamResponse.Choices[i].Delta.ToolCalls[j].Function.Arguments = cleaned
					streamResponse.Choices[i].Delta.ToolCalls[j].Function.Name = stripProviderThinkingBlocks(tc.Function.Name)
					changed = true
				}
			}
		}
	}
	if !changed {
		return data
	}
	if out, err := common.Marshal(streamResponse); err == nil {
		return maskUpstreamModelInData(string(out), info)
	}
	return data
}

func sanitizeMappedProviderResponsesStreamData(data string, info *relaycommon.RelayInfo) string {
	data = maskUpstreamModelInData(data, info)
	if !isMappedMiniMaxUpstream(info) {
		return data
	}
	var streamResponse dto.ResponsesStreamResponse
	if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
		return data
	}
	changed := false
	if streamResponse.Delta != "" {
		streamResponse.Delta = stripProviderThinkingFromStream(streamResponse.Delta, info)
		changed = true
	}
	if !changed {
		return data
	}
	if out, err := common.Marshal(streamResponse); err == nil {
		return maskUpstreamModelInData(string(out), info)
	}
	return data
}

func sanitizeMappedProviderTextResponse(response *dto.OpenAITextResponse, info *relaycommon.RelayInfo) {
	if response == nil || !isMappedMiniMaxUpstream(info) {
		return
	}
	response.Model = info.OriginModelName
	for i := range response.Choices {
		content := response.Choices[i].Message.StringContent()
		if content != "" {
			response.Choices[i].Message.SetStringContent(stripProviderThinkingBlocks(content))
		}
		response.Choices[i].Message.ReasoningContent = nil
		response.Choices[i].Message.Reasoning = nil
		response.Choices[i].Message.Name = nil
		// Strip <think> from tool_calls function arguments (non-streaming)
		for _, tc := range response.Choices[i].Message.ParseToolCalls() {
			if tc.Function.Arguments != "" {
				tc.Function.Arguments = stripProviderThinkingBlocks(tc.Function.Arguments)
				tc.Function.Name = stripProviderThinkingBlocks(tc.Function.Name)
			}
		}
	}
}

func sanitizeMappedProviderData(data string, info *relaycommon.RelayInfo) string {
	if !isMappedMiniMaxUpstream(info) {
		return data
	}
	alias := providerAliasForOrigin(info.OriginModelName)
	replacer := strings.NewReplacer(
		`,"name":"MiniMax AI"`, "",
		`"name":"MiniMax AI",`, "",
		`,"audio_content":""`, "",
		`"audio_content":"",`, "",
		`,"input_sensitive":false`, "",
		`,"output_sensitive":false`, "",
		`,"input_sensitive_type":0`, "",
		`,"output_sensitive_type":0`, "",
		`,"output_sensitive_int":0`, "",
		`,"base_resp":{"status_code":0,"status_msg":"success"}`, "",
		`,"base_resp":{"status_code":0,"status_msg":""}`, "",
		"<minimax:", "<",
		"</minimax:", "</",
		`\u003cminimax:`, `\u003c`,
		`\u003c/minimax:`, `\u003c/`,
		"MiniMax-M3", alias,
		"MiniMax M3", alias,
		"MiniMax-M2.7-highspeed", alias,
		"MiniMax-M2.7", alias,
		"MiniMax-M2.5-highspeed", alias,
		"MiniMax-M2.5", alias,
		"MiniMax-M2.1-highspeed", alias,
		"MiniMax-M2.1", alias,
		"MiniMax-M2", alias,
		"MiniMax AI", alias,
		"MiniMax", alias,
		"Minimax", alias,
		"MINIMAX", strings.ToUpper(alias),
		"minimax", strings.ToLower(alias),
		"海螺AI", alias,
		"海螺", alias,
		"稀宇科技", alias,
		"Hailuo", alias,
		"hailuo", strings.ToLower(alias),
		"Abab", alias,
		"abab", strings.ToLower(alias),
	)
	data = replacer.Replace(data)
	return stripProviderThinkingBlocks(data)
}

func isMappedMiniMaxUpstream(info *relaycommon.RelayInfo) bool {
	if info == nil || !info.IsModelMapped {
		return false
	}
	return strings.Contains(strings.ToLower(info.UpstreamModelName), "minimax")
}

func providerAliasForOrigin(origin string) string {
	lower := strings.ToLower(origin)
	switch {
	case strings.HasPrefix(lower, "glm"):
		return "GLM"
	case strings.HasPrefix(lower, "deepseek"):
		return "DeepSeek"
	case strings.HasPrefix(lower, "gpt"):
		return "OpenAI"
	case strings.HasPrefix(lower, "claude"):
		return "Claude"
	default:
		if strings.TrimSpace(origin) != "" {
			return origin
		}
		return "model"
	}
}

func stripProviderThinkingBlocks(text string) string {
	text = stripDelimitedCI(text, "<think>", "</think>")
	text = stripDelimitedCI(text, "\x3cthink\x3e", "\x3c/think\x3e")
	return text
}

// partialSuffixLen returns the longest suffix of text that matches the beginning of token.
func partialSuffixLen(text, token string) int {
	for n := len(token) - 1; n > 0; n-- {
		if len(text) >= n && indexFold(text[len(text)-n:], token[:n]) == 0 {
			return n
		}
	}
	return 0
}

func stripProviderThinkingFromStream(text string, info *relaycommon.RelayInfo) string {
	if info == nil {
		return stripProviderThinkingBlocks(text)
	}

	tc := &info.ThinkingContentInfo

	// Restore buffered partial tag fragments from previous chunk.
	if tc.PartialOpenTagBuf != "" {
		text = tc.PartialOpenTagBuf + text
		tc.PartialOpenTagBuf = ""
	}
	if tc.PartialCloseTagBuf != "" {
		text = tc.PartialCloseTagBuf + text
		tc.PartialCloseTagBuf = ""
	}

	var out strings.Builder
	rest := text
	for rest != "" {
		if tc.DropProviderThinking {
			end := indexFold(rest, "</think>")
			if end < 0 {
				// close tag may be split across chunks — save tail as buffer
				if pl := partialSuffixLen(rest, "</think>"); pl > 0 {
					tc.PartialCloseTagBuf = rest[len(rest)-pl:]
					rest = ""
				}
				return out.String()
			}
			rest = rest[end+len("</think>"):]
			tc.DropProviderThinking = false
			continue
		}
		start := indexFold(rest, "<think>")
		if start < 0 {
			// open tag may be split across chunks — save tail as buffer
			if pl := partialSuffixLen(rest, "<think>"); pl > 0 {
				out.WriteString(rest[:len(rest)-pl])
				tc.PartialOpenTagBuf = rest[len(rest)-pl:]
			} else {
				out.WriteString(rest)
			}
			break
		}
		out.WriteString(rest[:start])
		rest = rest[start+len("<think>"):]
		end := indexFold(rest, "</think>")
		if end < 0 {
			tc.DropProviderThinking = true
			if pl := partialSuffixLen(rest, "</think>"); pl > 0 {
				tc.PartialCloseTagBuf = rest[len(rest)-pl:]
			}
			break
		}
		rest = rest[end+len("</think>"):]
	}
	return out.String()
}

func stripDelimitedCI(text, startToken, endToken string) string {
	for {
		start := indexFold(text, startToken)
		if start < 0 {
			return text
		}
		afterStart := start + len(startToken)
		end := indexFold(text[afterStart:], endToken)
		if end < 0 {
			return text
		}
		text = text[:start] + text[afterStart+end+len(endToken):]
	}
}

func indexFold(s, substr string) int {
	return strings.Index(strings.ToLower(s), strings.ToLower(substr))
}

func shouldMaskGPTIdentity(info *relaycommon.RelayInfo) bool {
	if info == nil || !info.IsModelMapped {
		return false
	}
	origin := strings.ToLower(info.OriginModelName)
	upstream := strings.ToLower(info.UpstreamModelName)
	if !strings.HasPrefix(origin, "gpt") {
		return false
	}
	return strings.HasPrefix(upstream, "deepseek")
}

func maskGPTIdentityInData(data string, info *relaycommon.RelayInfo) string {
	if !shouldMaskGPTIdentity(info) {
		return data
	}
	replacer := strings.NewReplacer(
		"DeepSeek-V4", "GPT-5",
		"DeepSeek V4", "GPT-5",
		"DeepSeek-R1", "GPT-5",
		"DeepSeek R1", "GPT-5",
		"DeepSeek-V3", "GPT-5",
		"DeepSeek V3", "GPT-5",
		"DeepSeek", "OpenAI",
		"deepseek", "gpt",
		"DEEPSEEK", "OPENAI",
		"深度求索公司", "OpenAI",
		"深度求索", "OpenAI",
		"幻方量化", "OpenAI",
		"杭州深度求索", "OpenAI",
	)
	return replacer.Replace(data)
}

func handleClaudeFormat(c *gin.Context, data string, info *relaycommon.RelayInfo) error {
	// 在 Open→Claude 转换前先 strip provider thinking，与 OpenAI Chat Completions 流式路径保持一致。
	// 使用 stateful stripProviderThinkingFromStream，支持跨 SSE chunk 的 <think>…</think>。
	if isMappedMiniMaxUpstream(info) {
		var streamResponse dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err == nil {
			changed := false
			for i := range streamResponse.Choices {
				content := streamResponse.Choices[i].Delta.GetContentString()
				if content != "" {
					streamResponse.Choices[i].Delta.SetContentString(stripProviderThinkingFromStream(content, info))
					changed = true
				}
				if streamResponse.Choices[i].Delta.ReasoningContent != nil {
					streamResponse.Choices[i].Delta.ReasoningContent = nil
					changed = true
				}
				if streamResponse.Choices[i].Delta.Reasoning != nil {
					streamResponse.Choices[i].Delta.Reasoning = nil
					changed = true
				}
			}
			if changed {
				if out, err := common.Marshal(streamResponse); err == nil {
					data = string(out)
				}
			}
		}
	}

	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(data), &streamResponse); err != nil {
		return err
	}

	if streamResponse.Usage != nil {
		info.ClaudeConvertInfo.Usage = streamResponse.Usage
	}
	claudeResponses := service.StreamResponseOpenAI2Claude(&streamResponse, info)
	for _, resp := range claudeResponses {
		helper.ClaudeData(c, *resp)
	}
	return nil
}

func handleGeminiFormat(c *gin.Context, data string, info *relaycommon.RelayInfo) error {
	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(data), &streamResponse); err != nil {
		logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
		return err
	}

	geminiResponse := service.StreamResponseOpenAI2Gemini(&streamResponse, info)

	// 如果返回 nil，表示没有实际内容，跳过发送
	if geminiResponse == nil {
		return nil
	}

	geminiResponseStr, err := common.Marshal(geminiResponse)
	if err != nil {
		logger.LogError(c, "failed to marshal gemini response: "+err.Error())
		return err
	}

	// send gemini format response
	c.Render(-1, common.CustomEvent{Data: "data: " + string(geminiResponseStr)})
	_ = helper.FlushWriter(c)
	return nil
}

func ProcessStreamResponse(streamResponse dto.ChatCompletionsStreamResponse, responseTextBuilder *strings.Builder, toolCount *int) error {
	for _, choice := range streamResponse.Choices {
		responseTextBuilder.WriteString(choice.Delta.GetContentString())
		responseTextBuilder.WriteString(choice.Delta.GetReasoningContent())
		if choice.Delta.ToolCalls != nil {
			if len(choice.Delta.ToolCalls) > *toolCount {
				*toolCount = len(choice.Delta.ToolCalls)
			}
			for _, tool := range choice.Delta.ToolCalls {
				responseTextBuilder.WriteString(tool.Function.Name)
				responseTextBuilder.WriteString(tool.Function.Arguments)
			}
		}
	}
	return nil
}

func processTokens(relayMode int, streamItems []string, responseTextBuilder *strings.Builder, toolCount *int) error {
	streamResp := "[" + strings.Join(streamItems, ",") + "]"

	switch relayMode {
	case relayconstant.RelayModeChatCompletions:
		return processChatCompletions(streamResp, streamItems, responseTextBuilder, toolCount)
	case relayconstant.RelayModeCompletions:
		return processCompletions(streamResp, streamItems, responseTextBuilder)
	}
	return nil
}

func processChatCompletions(streamResp string, streamItems []string, responseTextBuilder *strings.Builder, toolCount *int) error {
	var streamResponses []dto.ChatCompletionsStreamResponse
	if err := json.Unmarshal(common.StringToByteSlice(streamResp), &streamResponses); err != nil {
		// 一次性解析失败，逐个解析
		common.SysLog("error unmarshalling stream response: " + err.Error())
		for _, item := range streamItems {
			var streamResponse dto.ChatCompletionsStreamResponse
			if err := json.Unmarshal(common.StringToByteSlice(item), &streamResponse); err != nil {
				return err
			}
			if err := ProcessStreamResponse(streamResponse, responseTextBuilder, toolCount); err != nil {
				common.SysLog("error processing stream response: " + err.Error())
			}
		}
		return nil
	}

	// 批量处理所有响应
	for _, streamResponse := range streamResponses {
		for _, choice := range streamResponse.Choices {
			responseTextBuilder.WriteString(choice.Delta.GetContentString())
			responseTextBuilder.WriteString(choice.Delta.GetReasoningContent())
			if choice.Delta.ToolCalls != nil {
				if len(choice.Delta.ToolCalls) > *toolCount {
					*toolCount = len(choice.Delta.ToolCalls)
				}
				for _, tool := range choice.Delta.ToolCalls {
					responseTextBuilder.WriteString(tool.Function.Name)
					responseTextBuilder.WriteString(tool.Function.Arguments)
				}
			}
		}
	}
	return nil
}

func processCompletions(streamResp string, streamItems []string, responseTextBuilder *strings.Builder) error {
	var streamResponses []dto.CompletionsStreamResponse
	if err := json.Unmarshal(common.StringToByteSlice(streamResp), &streamResponses); err != nil {
		// 一次性解析失败，逐个解析
		common.SysLog("error unmarshalling stream response: " + err.Error())
		for _, item := range streamItems {
			var streamResponse dto.CompletionsStreamResponse
			if err := json.Unmarshal(common.StringToByteSlice(item), &streamResponse); err != nil {
				continue
			}
			for _, choice := range streamResponse.Choices {
				responseTextBuilder.WriteString(choice.Text)
			}
		}
		return nil
	}

	// 批量处理所有响应
	for _, streamResponse := range streamResponses {
		for _, choice := range streamResponse.Choices {
			responseTextBuilder.WriteString(choice.Text)
		}
	}
	return nil
}

func handleLastResponse(lastStreamData string, responseId *string, createAt *int64,
	systemFingerprint *string, model *string, usage **dto.Usage,
	containStreamUsage *bool, info *relaycommon.RelayInfo,
	shouldSendLastResp *bool) error {

	var lastStreamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &lastStreamResponse); err != nil {
		return err
	}

	*responseId = lastStreamResponse.Id
	*createAt = lastStreamResponse.Created
	*systemFingerprint = lastStreamResponse.GetSystemFingerprint()
	*model = lastStreamResponse.Model

	if service.ValidUsage(lastStreamResponse.Usage) {
		*containStreamUsage = true
		*usage = lastStreamResponse.Usage
		if !info.ShouldIncludeUsage {
			*shouldSendLastResp = lo.SomeBy(lastStreamResponse.Choices, func(choice dto.ChatCompletionsStreamResponseChoice) bool {
				return choice.Delta.GetContentString() != "" || choice.Delta.GetReasoningContent() != ""
			})
		}
	}

	return nil
}

func HandleFinalResponse(c *gin.Context, info *relaycommon.RelayInfo, lastStreamData string,
	responseId string, createAt int64, model string, systemFingerprint string,
	usage *dto.Usage, containStreamUsage bool) {

	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		if info.ShouldIncludeUsage && !containStreamUsage {
			finalModel := model
			// 严格伪装：流式末尾 usage 帧也要用客户端原始模型名
			if info != nil && info.IsModelMapped && info.OriginModelName != "" && info.UpstreamModelName != "" && info.UpstreamModelName != info.OriginModelName {
				finalModel = info.OriginModelName
			}
			response := helper.GenerateFinalUsageResponse(responseId, createAt, finalModel, *usage)
			response.SetSystemFingerprint(systemFingerprint)
			helper.ObjectData(c, response)
		}
		helper.Done(c)

	case types.RelayFormatClaude:
		// Strip provider thinking for the last chunk too (same as handleClaudeFormat).
		if isMappedMiniMaxUpstream(info) {
			lastStreamData = sanitizeMappedProviderChatStreamData(lastStreamData, info)
		}
		var streamResponse dto.ChatCompletionsStreamResponse
		if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &streamResponse); err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			return
		}

		info.ClaudeConvertInfo.Usage = usage

		claudeResponses := service.StreamResponseOpenAI2Claude(&streamResponse, info)
		for _, resp := range claudeResponses {
			_ = helper.ClaudeData(c, *resp)
		}
		info.ClaudeConvertInfo.Done = true

	case types.RelayFormatGemini:
		var streamResponse dto.ChatCompletionsStreamResponse
		if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &streamResponse); err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			return
		}

		// 这里处理的是 openai 最后一个流响应，其 delta 为空，有 finish_reason 字段
		// 因此相比较于 google 官方的流响应，由 openai 转换而来会多一个 parts 为空，finishReason 为 STOP 的响应
		// 而包含最后一段文本输出的响应（倒数第二个）的 finishReason 为 null
		// 暂不知是否有程序会不兼容。

		geminiResponse := service.StreamResponseOpenAI2Gemini(&streamResponse, info)

		// openai 流响应开头的空数据
		if geminiResponse == nil {
			return
		}

		geminiResponseStr, err := common.Marshal(geminiResponse)
		if err != nil {
			common.SysLog("error marshalling gemini response: " + err.Error())
			return
		}

		// 发送最终的 Gemini 响应
		c.Render(-1, common.CustomEvent{Data: "data: " + string(geminiResponseStr)})
		_ = helper.FlushWriter(c)
	}
}

func sendResponsesStreamData(c *gin.Context, streamResponse dto.ResponsesStreamResponse, data string) {
	if data == "" {
		return
	}
	helper.ResponseChunkData(c, streamResponse, data)
}
