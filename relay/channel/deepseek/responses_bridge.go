package deepseek

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

const (
	responsesStatusCompleted  = `"completed"`
	responsesStatusInProgress = `"in_progress"`
)

func deepSeekResponsesRequestToChatRequest(info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	model := request.Model
	if info != nil && info.UpstreamModelName != "" {
		model = info.UpstreamModelName
	}
	if strings.TrimSpace(model) == "" {
		return nil, errors.New("model is required")
	}

	messages, err := responsesInputToChatMessages(request)
	if err != nil {
		return nil, err
	}
	if len(messages) == 0 {
		return nil, errors.New("input is required")
	}

	chatReq := &dto.GeneralOpenAIRequest{
		Model:               model,
		Messages:            messages,
		Stream:              request.Stream,
		MaxCompletionTokens: request.MaxOutputTokens,
		Temperature:         request.Temperature,
		TopP:                request.TopP,
		TopLogProbs:         request.TopLogProbs,
		User:                request.User,
	}

	if len(request.Tools) > 0 {
		tools, err := responsesToolsToChatTools(request.Tools)
		if err != nil {
			return nil, err
		}
		chatReq.Tools = tools
	}
	if len(chatReq.Tools) > 0 && len(request.ToolChoice) > 0 {
		chatReq.ToolChoice = request.ToolChoice
	}
	if len(request.Text) > 0 {
		if responseFormat := responsesTextToChatResponseFormat(request.Text); responseFormat != nil {
			chatReq.ResponseFormat = responseFormat
		}
	}
	if request.Reasoning != nil && info != nil && request.Reasoning.Effort != "" {
		info.ReasoningEffort = request.Reasoning.Effort
	}

	return chatReq, nil
}

func responsesInputToChatMessages(request dto.OpenAIResponsesRequest) ([]dto.Message, error) {
	messages := make([]dto.Message, 0)
	if len(request.Instructions) > 0 && string(request.Instructions) != "null" {
		if instructionText := rawJSONStringOrCompact(request.Instructions); strings.TrimSpace(instructionText) != "" {
			messages = append(messages, dto.Message{
				Role:    "system",
				Content: instructionText,
			})
		}
	}

	if len(request.Input) == 0 || string(request.Input) == "null" {
		return messages, nil
	}

	switch common.GetJsonType(request.Input) {
	case "string":
		var text string
		if err := common.Unmarshal(request.Input, &text); err != nil {
			return nil, fmt.Errorf("invalid responses input string: %w", err)
		}
		messages = append(messages, dto.Message{Role: "user", Content: text})
	case "array":
		items, err := responsesInputArrayToChatMessages(request.Input)
		if err != nil {
			return nil, err
		}
		messages = append(messages, items...)
	case "object":
		item, ok, err := responsesInputObjectToChatMessage(request.Input)
		if err != nil {
			return nil, err
		}
		if ok {
			messages = append(messages, item)
		}
	default:
		messages = append(messages, dto.Message{Role: "user", Content: string(request.Input)})
	}

	return messages, nil
}

func responsesInputArrayToChatMessages(raw json.RawMessage) ([]dto.Message, error) {
	var items []map[string]any
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("invalid responses input array: %w", err)
	}
	messages := make([]dto.Message, 0, len(items))
	pendingUserParts := make([]dto.MediaContent, 0)
	flushPendingUser := func() {
		if len(pendingUserParts) == 0 {
			return
		}
		msg := dto.Message{Role: "user"}
		if len(pendingUserParts) == 1 && pendingUserParts[0].Type == dto.ContentTypeText {
			msg.Content = pendingUserParts[0].Text
		} else {
			msg.Content = pendingUserParts
		}
		messages = append(messages, msg)
		pendingUserParts = nil
	}

	for _, item := range items {
		itemType := common.Interface2String(item["type"])
		switch itemType {
		case "input_text", "input_image", "input_file":
			if part, ok := responsesContentPartToChatPart(item); ok {
				pendingUserParts = append(pendingUserParts, part)
			}
			continue
		case "function_call_output":
			flushPendingUser()
			output := item["output"]
			messages = append(messages, dto.Message{
				Role:       "tool",
				ToolCallId: common.Interface2String(item["call_id"]),
				Content:    stringifyResponsesContent(output),
			})
			continue
		}

		flushPendingUser()
		rawItem, err := common.Marshal(item)
		if err != nil {
			return nil, err
		}
		msg, ok, err := responsesInputObjectToChatMessage(rawItem)
		if err != nil {
			return nil, err
		}
		if ok {
			messages = append(messages, msg)
		}
	}
	flushPendingUser()
	return messages, nil
}

func responsesInputObjectToChatMessage(raw json.RawMessage) (dto.Message, bool, error) {
	var item map[string]any
	if err := common.Unmarshal(raw, &item); err != nil {
		return dto.Message{}, false, fmt.Errorf("invalid responses input object: %w", err)
	}
	if common.Interface2String(item["type"]) == "function_call_output" {
		return dto.Message{
			Role:       "tool",
			ToolCallId: common.Interface2String(item["call_id"]),
			Content:    stringifyResponsesContent(item["output"]),
		}, true, nil
	}

	role := common.Interface2String(item["role"])
	if role == "" {
		role = "user"
	}
	content, err := responsesContentToChatContent(item["content"])
	if err != nil {
		return dto.Message{}, false, err
	}
	if content == nil {
		return dto.Message{}, false, nil
	}
	return dto.Message{Role: role, Content: content}, true, nil
}

func responsesContentToChatContent(content any) (any, error) {
	if content == nil {
		return "", nil
	}
	switch v := content.(type) {
	case string:
		return v, nil
	case []any:
		parts := make([]dto.MediaContent, 0, len(v))
		for _, partAny := range v {
			partMap, ok := partAny.(map[string]any)
			if !ok {
				continue
			}
			if part, ok := responsesContentPartToChatPart(partMap); ok {
				parts = append(parts, part)
			}
		}
		if len(parts) == 0 {
			return "", nil
		}
		if len(parts) == 1 && parts[0].Type == dto.ContentTypeText {
			return parts[0].Text, nil
		}
		return parts, nil
	case map[string]any:
		if part, ok := responsesContentPartToChatPart(v); ok {
			if part.Type == dto.ContentTypeText {
				return part.Text, nil
			}
			return []dto.MediaContent{part}, nil
		}
	}
	return stringifyResponsesContent(content), nil
}

func responsesContentPartToChatPart(part map[string]any) (dto.MediaContent, bool) {
	switch common.Interface2String(part["type"]) {
	case "input_text", "output_text", "text":
		return dto.MediaContent{
			Type: dto.ContentTypeText,
			Text: common.Interface2String(part["text"]),
		}, true
	case "input_image":
		imageURL := part["image_url"]
		if imageURL == nil {
			imageURL = part["file_id"]
		}
		return dto.MediaContent{
			Type: dto.ContentTypeImageURL,
			ImageUrl: map[string]any{
				"url":    normalizeURLLike(imageURL),
				"detail": common.Interface2String(part["detail"]),
			},
		}, true
	case "input_file":
		fileURL := part["file_url"]
		if fileURL == nil {
			fileURL = part["file_id"]
		}
		return dto.MediaContent{
			Type: dto.ContentTypeFile,
			File: map[string]any{
				"file_data": normalizeURLLike(fileURL),
			},
		}, true
	}
	return dto.MediaContent{}, false
}

func normalizeURLLike(v any) string {
	switch vv := v.(type) {
	case string:
		return vv
	case map[string]any:
		if url := common.Interface2String(vv["url"]); url != "" {
			return url
		}
	}
	return common.Interface2String(v)
}

func stringifyResponsesContent(v any) string {
	switch vv := v.(type) {
	case nil:
		return ""
	case string:
		return vv
	default:
		b, err := common.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

func rawJSONStringOrCompact(raw json.RawMessage) string {
	var s string
	if err := common.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

func responsesToolsToChatTools(raw json.RawMessage) ([]dto.ToolCallRequest, error) {
	var items []map[string]any
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("invalid responses tools: %w", err)
	}
	tools := make([]dto.ToolCallRequest, 0, len(items))
	for _, item := range items {
		if common.Interface2String(item["type"]) != "function" {
			continue
		}
		function := item
		if nested, ok := item["function"].(map[string]any); ok {
			function = nested
		}
		name := common.Interface2String(function["name"])
		if name == "" {
			continue
		}
		tools = append(tools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: common.Interface2String(function["description"]),
				Parameters:  sanitizeResponsesToolParameters(function["parameters"]),
			},
		})
	}
	return tools, nil
}

func sanitizeResponsesToolParameters(parameters any) any {
	paramMap, ok := parameters.(map[string]any)
	if !ok {
		return map[string]any{
			"type":       "object",
			"properties": map[string]any{},
			"required":   []any{},
		}
	}
	if common.Interface2String(paramMap["type"]) == "" {
		paramMap["type"] = "object"
	}
	if _, ok := paramMap["properties"].(map[string]any); !ok {
		paramMap["properties"] = map[string]any{}
	}
	if _, ok := paramMap["required"]; !ok {
		paramMap["required"] = []any{}
	}
	return paramMap
}

func responsesTextToChatResponseFormat(raw json.RawMessage) *dto.ResponseFormat {
	var textCfg map[string]any
	if err := common.Unmarshal(raw, &textCfg); err != nil {
		return nil
	}
	format, ok := textCfg["format"].(map[string]any)
	if !ok {
		return nil
	}
	formatType := common.Interface2String(format["type"])
	if formatType == "" {
		return nil
	}
	out := &dto.ResponseFormat{Type: formatType}
	if formatType == "json_schema" {
		if b, err := common.Marshal(format); err == nil {
			out.JsonSchema = b
		}
	}
	return out
}

func deepSeekChatToClientHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(errors.New("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := chatResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	model := clientFacingModel(info, chatResp.Model)
	if model != "" {
		chatResp.Model = model
	}
	usage := &chatResp.Usage
	if usage.TotalTokens == 0 {
		var text strings.Builder
		for _, choice := range chatResp.Choices {
			text.WriteString(choice.Message.StringContent())
			text.WriteString(choice.Message.GetReasoningContent())
		}
		usage = service.ResponseText2Usage(c, text.String(), model, info.GetEstimatePromptTokens())
		chatResp.Usage = *usage
	}

	responseBody, err := common.Marshal(chatResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)
	return usage, nil
}

func deepSeekChatStreamToClientHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(errors.New("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	model := clientFacingModel(info, "")
	responseID := helper.GetResponseID(c)
	created := time.Now().Unix()
	var systemFingerprint *string
	usage := &dto.Usage{}
	containUsage := false
	var responseText strings.Builder
	var streamErr *types.NewAPIError

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if strings.TrimSpace(data) == "" {
			return
		}
		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			sr.Stop(err)
			return
		}
		if chunk.Id != "" {
			responseID = chunk.Id
		}
		if chunk.Created > 0 {
			created = chunk.Created
		}
		if model == "" {
			model = clientFacingModel(info, chunk.Model)
		}
		if model != "" {
			chunk.Model = model
		}
		systemFingerprint = chunk.SystemFingerprint
		if service.ValidUsage(chunk.Usage) {
			usage = chunk.Usage
			containUsage = true
		}
		for _, choice := range chunk.Choices {
			responseText.WriteString(choice.Delta.GetContentString())
			responseText.WriteString(choice.Delta.GetReasoningContent())
			for _, tool := range choice.Delta.ToolCalls {
				responseText.WriteString(tool.Function.Name)
				responseText.WriteString(tool.Function.Arguments)
			}
		}
		chunkData, err := common.Marshal(chunk)
		if err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
			sr.Stop(err)
			return
		}
		if err := openaichannel.HandleStreamFormat(c, info, string(chunkData), info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			sr.Stop(err)
		}
	})
	if streamErr != nil {
		return nil, streamErr
	}

	if !containUsage {
		usage = service.ResponseText2Usage(c, responseText.String(), model, info.GetEstimatePromptTokens())
	}
	if info.ShouldIncludeUsage && !containUsage {
		finalUsage := helper.GenerateFinalUsageResponse(responseID, created, model, *usage)
		if systemFingerprint != nil {
			finalUsage.SetSystemFingerprint(*systemFingerprint)
		}
		helper.ObjectData(c, finalUsage)
	}
	helper.Done(c)
	return usage, nil
}

func deepSeekChatToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(errors.New("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := chatResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	responsesResp := chatResponseToResponsesResponse(c, info, &chatResp)
	responseBody, err := common.Marshal(responsesResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)

	usage := responsesUsageToChatUsage(responsesResp.Usage)
	return usage, nil
}

func chatResponseToResponsesResponse(c *gin.Context, info *relaycommon.RelayInfo, chatResp *dto.OpenAITextResponse) *dto.OpenAIResponsesResponse {
	responseID := responsesIDFromChat(c, chatResp.Id)
	model := clientFacingModel(info, chatResp.Model)
	created := int(chatCreatedUnix(chatResp.Created))
	text := ""
	var toolCalls []dto.ToolCallResponse
	if chatResp != nil && len(chatResp.Choices) > 0 {
		msg := chatResp.Choices[0].Message
		text = msg.StringContent()
		toolCalls = chatMessageToolCalls(msg)
	}

	output := chatMessageOutput(responseID, text, toolCalls)
	usage := chatUsageToResponsesUsage(&chatResp.Usage)
	if usage.TotalTokens == 0 {
		usage = chatUsageToResponsesUsage(service.ResponseText2Usage(c, text, model, 0))
	}
	return &dto.OpenAIResponsesResponse{
		ID:                responseID,
		Object:            "response",
		CreatedAt:         created,
		Status:            json.RawMessage(responsesStatusCompleted),
		Model:             model,
		Output:            output,
		ParallelToolCalls: true,
		Store:             false,
		Usage:             usage,
	}
}

func chatMessageOutput(responseID string, text string, toolCalls []dto.ToolCallResponse) []dto.ResponsesOutput {
	if len(toolCalls) > 0 {
		output := make([]dto.ResponsesOutput, 0, len(toolCalls))
		for i, call := range toolCalls {
			callID := strings.TrimSpace(call.ID)
			if callID == "" {
				callID = fmt.Sprintf("call_%s_%d", responseID, i)
			}
			itemID := fmt.Sprintf("fc_%s_%d", responseID, i)
			output = append(output, dto.ResponsesOutput{
				Type:      "function_call",
				ID:        itemID,
				Status:    "completed",
				CallId:    callID,
				Name:      call.Function.Name,
				Arguments: functionArgumentsRaw(call.Function.Arguments),
			})
		}
		return output
	}
	return []dto.ResponsesOutput{
		{
			Type:   "message",
			ID:     "msg_" + responseID,
			Status: "completed",
			Role:   "assistant",
			Content: []dto.ResponsesOutputContent{
				{
					Type:        "output_text",
					Text:        text,
					Annotations: []interface{}{},
				},
			},
		},
	}
}

func chatMessageToolCalls(msg dto.Message) []dto.ToolCallResponse {
	if len(msg.ToolCalls) == 0 {
		return nil
	}
	var toolCalls []dto.ToolCallResponse
	if err := common.Unmarshal(msg.ToolCalls, &toolCalls); err != nil {
		return nil
	}
	return toolCalls
}

func functionArgumentsRaw(arguments string) json.RawMessage {
	arguments = strings.TrimSpace(arguments)
	if arguments == "" {
		return json.RawMessage(`{}`)
	}
	if json.Valid([]byte(arguments)) {
		return json.RawMessage(arguments)
	}
	b, err := common.Marshal(arguments)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}

func deepSeekChatStreamToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(errors.New("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	state := newDeepSeekResponsesStreamState(c, info)
	var streamErr *types.NewAPIError
	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if strings.TrimSpace(data) == "" {
			return
		}
		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			sr.Stop(err)
			return
		}
		if err := state.handleChatChunk(c, &chunk); err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			sr.Stop(err)
		}
	})
	if streamErr != nil {
		return nil, streamErr
	}
	usage := state.finalize(c)
	return usage, nil
}

type deepSeekResponsesStreamState struct {
	info            *relaycommon.RelayInfo
	responseID      string
	textItemID      string
	model           string
	created         int
	seq             int
	responseStarted bool
	textStarted     bool
	textOutputIndex int
	nextOutputIndex int
	text            strings.Builder
	toolCalls       map[int]*deepSeekResponsesToolCallState
	toolOrder       []int
	usage           *dto.Usage
	finishReason    string
	responseError   *types.NewAPIError
}

type deepSeekResponsesToolCallState struct {
	index          int
	outputIndex    int
	itemID         string
	callID         string
	name           string
	arguments      strings.Builder
	emitted        bool
	emittedArgsLen int
}

func newDeepSeekResponsesStreamState(c *gin.Context, info *relaycommon.RelayInfo) *deepSeekResponsesStreamState {
	responseID := "resp_" + helper.GetResponseID(c)
	model := clientFacingModel(info, "")
	return &deepSeekResponsesStreamState{
		info:            info,
		responseID:      responseID,
		textItemID:      "msg_" + responseID,
		model:           model,
		created:         int(time.Now().Unix()),
		textOutputIndex: -1,
		toolCalls:       make(map[int]*deepSeekResponsesToolCallState),
	}
}

func (s *deepSeekResponsesStreamState) handleChatChunk(c *gin.Context, chunk *dto.ChatCompletionsStreamResponse) error {
	if chunk == nil {
		return nil
	}
	if chunk.Id != "" {
		s.responseID = responsesIDFromChat(c, chunk.Id)
		if s.textItemID == "" || strings.HasPrefix(s.textItemID, "msg_resp_chatcmpl-") {
			s.textItemID = "msg_" + s.responseID
		}
	}
	if chunk.Model != "" {
		s.model = clientFacingModel(s.info, chunk.Model)
	}
	if chunk.Created > 0 {
		s.created = int(chunk.Created)
	}
	if chunk.Usage != nil {
		s.usage = chunk.Usage
	}
	if !s.responseStarted {
		s.emitResponseCreated(c)
	}
	for _, choice := range chunk.Choices {
		delta := choice.Delta.GetContentString()
		if delta == "" && choice.Delta.GetReasoningContent() != "" {
			// Keep Codex-facing output text clean. Reasoning deltas can be added
			// later as reasoning summary events if needed.
			delta = ""
		}
		if delta != "" {
			s.ensureTextItem(c)
			s.text.WriteString(delta)
			s.emitMap(c, "response.output_text.delta", map[string]any{
				"item_id":       s.textItemID,
				"output_index":  s.textOutputIndex,
				"content_index": 0,
				"delta":         delta,
			})
		}
		for _, toolCall := range choice.Delta.ToolCalls {
			s.handleToolCallDelta(c, toolCall)
		}
		if choice.FinishReason != nil && *choice.FinishReason != "" {
			s.finishReason = *choice.FinishReason
		}
	}
	return nil
}

func (s *deepSeekResponsesStreamState) emitResponseCreated(c *gin.Context) {
	s.responseStarted = true
	s.emitMap(c, "response.created", map[string]any{
		"response": s.responsesSnapshot("in_progress", "", nil),
	})
}

func (s *deepSeekResponsesStreamState) ensureTextItem(c *gin.Context) {
	if s.textStarted {
		return
	}
	s.textStarted = true
	if s.textOutputIndex < 0 {
		s.textOutputIndex = s.nextOutputIndex
		s.nextOutputIndex++
	}
	s.emitMap(c, "response.output_item.added", map[string]any{
		"output_index": s.textOutputIndex,
		"item": map[string]any{
			"id":      s.textItemID,
			"type":    "message",
			"status":  "in_progress",
			"role":    "assistant",
			"content": []any{},
		},
	})
	s.emitMap(c, "response.content_part.added", map[string]any{
		"item_id":       s.textItemID,
		"output_index":  s.textOutputIndex,
		"content_index": 0,
		"part": map[string]any{
			"type":        "output_text",
			"text":        "",
			"annotations": []any{},
		},
	})
}

func (s *deepSeekResponsesStreamState) handleToolCallDelta(c *gin.Context, toolCall dto.ToolCallResponse) {
	index := 0
	if toolCall.Index != nil {
		index = *toolCall.Index
	}
	st, ok := s.toolCalls[index]
	if !ok {
		st = &deepSeekResponsesToolCallState{
			index:       index,
			outputIndex: -1,
			callID:      fmt.Sprintf("call_%s_%d", s.responseID, index),
			itemID:      fmt.Sprintf("fc_%s_%d", s.responseID, index),
		}
		s.toolCalls[index] = st
		s.toolOrder = append(s.toolOrder, index)
	}
	if toolCall.ID != "" {
		st.callID = toolCall.ID
		st.itemID = "fc_" + toolCall.ID
	}
	if toolCall.Function.Name != "" {
		st.name = toolCall.Function.Name
	}
	if toolCall.Function.Arguments != "" {
		st.arguments.WriteString(toolCall.Function.Arguments)
	}
	if st.name != "" {
		s.emitToolCallAdded(c, st)
	}
	if st.emitted {
		s.emitPendingToolArguments(c, st)
	}
}

func (s *deepSeekResponsesStreamState) emitToolCallAdded(c *gin.Context, st *deepSeekResponsesToolCallState) {
	if st == nil || st.emitted {
		return
	}
	if st.outputIndex < 0 {
		st.outputIndex = s.nextOutputIndex
		s.nextOutputIndex++
	}
	st.emitted = true
	s.emitMap(c, "response.output_item.added", map[string]any{
		"output_index": st.outputIndex,
		"item": map[string]any{
			"id":        st.itemID,
			"type":      "function_call",
			"status":    "in_progress",
			"arguments": "",
			"call_id":   st.callID,
			"name":      st.name,
		},
	})
}

func (s *deepSeekResponsesStreamState) emitPendingToolArguments(c *gin.Context, st *deepSeekResponsesToolCallState) {
	if st == nil || !st.emitted {
		return
	}
	args := st.arguments.String()
	if len(args) <= st.emittedArgsLen {
		return
	}
	delta := args[st.emittedArgsLen:]
	st.emittedArgsLen = len(args)
	s.emitMap(c, "response.function_call_arguments.delta", map[string]any{
		"item_id":      st.itemID,
		"output_index": st.outputIndex,
		"delta":        delta,
	})
}

func (s *deepSeekResponsesStreamState) finalize(c *gin.Context) *dto.Usage {
	if !s.responseStarted {
		s.emitResponseCreated(c)
	}
	text := s.text.String()
	usage := s.usage
	if usage == nil || usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, text, s.model, 0)
	}
	responsesUsage := chatUsageToResponsesUsage(usage)

	if s.textStarted || len(s.toolOrder) == 0 {
		s.finishTextItem(c, text)
	}
	for _, index := range s.toolOrder {
		s.finishToolCall(c, s.toolCalls[index])
	}
	s.emitMap(c, "response.completed", map[string]any{
		"response": s.responsesSnapshot("completed", text, responsesUsage),
	})
	helper.Done(c)
	return responsesUsageToChatUsage(responsesUsage)
}

func (s *deepSeekResponsesStreamState) finishTextItem(c *gin.Context, text string) {
	s.ensureTextItem(c)
	s.emitMap(c, "response.output_text.done", map[string]any{
		"item_id":       s.textItemID,
		"output_index":  s.textOutputIndex,
		"content_index": 0,
		"text":          text,
	})
	part := map[string]any{
		"type":        "output_text",
		"text":        text,
		"annotations": []any{},
	}
	s.emitMap(c, "response.content_part.done", map[string]any{
		"item_id":       s.textItemID,
		"output_index":  s.textOutputIndex,
		"content_index": 0,
		"part":          part,
	})
	item := map[string]any{
		"id":     s.textItemID,
		"type":   "message",
		"status": "completed",
		"role":   "assistant",
		"content": []any{
			part,
		},
	}
	s.emitMap(c, "response.output_item.done", map[string]any{
		"output_index": s.textOutputIndex,
		"item":         item,
	})
}

func (s *deepSeekResponsesStreamState) finishToolCall(c *gin.Context, st *deepSeekResponsesToolCallState) {
	if st == nil {
		return
	}
	if st.name == "" {
		st.name = "tool"
	}
	s.emitToolCallAdded(c, st)
	s.emitPendingToolArguments(c, st)
	args := st.arguments.String()
	s.emitMap(c, "response.function_call_arguments.done", map[string]any{
		"item_id":      st.itemID,
		"output_index": st.outputIndex,
		"arguments":    args,
	})
	item := map[string]any{
		"id":        st.itemID,
		"type":      "function_call",
		"status":    "completed",
		"arguments": args,
		"call_id":   st.callID,
		"name":      st.name,
	}
	s.emitMap(c, "response.output_item.done", map[string]any{
		"output_index": st.outputIndex,
		"item":         item,
	})
}

func (s *deepSeekResponsesStreamState) emitMap(c *gin.Context, eventType string, m map[string]any) {
	m["type"] = eventType
	m["sequence_number"] = s.seq
	s.seq++
	b, err := common.Marshal(m)
	if err != nil {
		return
	}
	helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventType}, string(b))
}

func (s *deepSeekResponsesStreamState) responsesSnapshot(status string, text string, usage *dto.Usage) map[string]any {
	if status == "" {
		status = "completed"
	}
	itemStatus := "completed"
	if status != "completed" {
		itemStatus = "in_progress"
	}
	output := s.outputSnapshot(status, itemStatus, text)
	return map[string]any{
		"id":                  s.responseID,
		"object":              "response",
		"created_at":          s.created,
		"status":              status,
		"model":               s.model,
		"output":              output,
		"parallel_tool_calls": true,
		"store":               false,
		"usage":               usage,
	}
}

func (s *deepSeekResponsesStreamState) outputSnapshot(status string, itemStatus string, text string) []any {
	output := []any{}
	if s.textStarted || (status == "completed" && len(s.toolOrder) == 0) {
		output = append(output, map[string]any{
			"id":     s.textItemID,
			"type":   "message",
			"status": itemStatus,
			"role":   "assistant",
			"content": []any{
				map[string]any{
					"type":        "output_text",
					"text":        text,
					"annotations": []any{},
				},
			},
		})
	}
	for _, index := range s.toolOrder {
		st := s.toolCalls[index]
		if st == nil {
			continue
		}
		name := st.name
		if name == "" {
			name = "tool"
		}
		output = append(output, map[string]any{
			"id":        st.itemID,
			"type":      "function_call",
			"status":    itemStatus,
			"arguments": st.arguments.String(),
			"call_id":   st.callID,
			"name":      name,
		})
	}
	return output
}

func chatUsageToResponsesUsage(usage *dto.Usage) *dto.Usage {
	if usage == nil {
		return &dto.Usage{}
	}
	out := *usage
	if out.InputTokens == 0 {
		out.InputTokens = out.PromptTokens
	}
	if out.OutputTokens == 0 {
		out.OutputTokens = out.CompletionTokens
	}
	if out.TotalTokens == 0 {
		out.TotalTokens = out.InputTokens + out.OutputTokens
	}
	if out.PromptTokens == 0 {
		out.PromptTokens = out.InputTokens
	}
	if out.CompletionTokens == 0 {
		out.CompletionTokens = out.OutputTokens
	}
	if out.InputTokensDetails == nil {
		details := out.PromptTokensDetails
		out.InputTokensDetails = &details
	}
	return &out
}

func responsesUsageToChatUsage(usage *dto.Usage) *dto.Usage {
	if usage == nil {
		return &dto.Usage{}
	}
	out := *usage
	if out.PromptTokens == 0 {
		out.PromptTokens = out.InputTokens
	}
	if out.CompletionTokens == 0 {
		out.CompletionTokens = out.OutputTokens
	}
	if out.TotalTokens == 0 {
		out.TotalTokens = out.PromptTokens + out.CompletionTokens
	}
	return &out
}

func clientFacingModel(info *relaycommon.RelayInfo, fallback string) string {
	if info != nil && info.OriginModelName != "" {
		return info.OriginModelName
	}
	if fallback != "" {
		return fallback
	}
	if info != nil && info.UpstreamModelName != "" {
		return info.UpstreamModelName
	}
	return ""
}

func responsesIDFromChat(c *gin.Context, chatID string) string {
	if strings.HasPrefix(chatID, "resp_") {
		return chatID
	}
	if chatID != "" {
		return "resp_" + chatID
	}
	return "resp_" + helper.GetResponseID(c)
}

func chatCreatedUnix(created any) int64 {
	switch v := created.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case int32:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	default:
		return time.Now().Unix()
	}
}
