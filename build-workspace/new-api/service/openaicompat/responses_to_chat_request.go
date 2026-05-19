package openaicompat

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/samber/lo"
)

// ResponsesRequestToChatCompletionsRequest 把 Responses API 请求镜像翻译成 Chat Completions 请求。
//
// 用途场景:codex CLI 客户必发 /v1/responses,但下游 channel(例如 mimo)只支持
// /v1/chat/completions。NewAPI 在 distributor 决策后,如果命中"chat-only 上游",
// 就用本函数把客户的 ResponsesRequest 翻译成 chat 格式发上去,响应再用
// ChatCompletionsResponseToResponsesResponse / OaiChatToResponsesStreamHandler 翻译回来。
//
// 这是 chat_to_responses.go 中 ChatCompletionsRequestToResponsesRequest 的反向。
//
// 翻译规则(对照 chat_to_responses.go):
//
//	Responses                          → Chat Completions
//	─────────────────────────────────────────────────────────────────────
//	instructions(string)               → 第一条 system message
//	input(string)                      → 单条 user message(content 为 string)
//	input(array of items)              → []Message,逐项映射:
//	  type=message + role + content[]    → {role, content}
//	    content[].type=input_text         → text
//	    content[].type=output_text        → text(role=assistant)
//	    content[].type=input_image        → image_url
//	    content[].type=input_audio        → input_audio
//	    content[].type=input_file         → file
//	  type=function_call (assistant)     → 合并到上一条 assistant message 的 tool_calls
//	  type=function_call_output          → {role:tool, content:output, tool_call_id:call_id}
//	  type=reasoning                     → 跳过(chat 协议无对应字段,reasoning 是上游产生
//	                                       的中间产物,作为输入再发回去意义不大)
//	tools(responses 平铺) → tools(chat 嵌套 function:{name,description,parameters})
//	tool_choice                        → tool_choice(string 透传 / function 转嵌套)
//	max_output_tokens                  → max_tokens + max_completion_tokens
//	reasoning.effort                   → reasoning_effort
//	text.format(json_schema 等)        → response_format
//	stream/temperature/top_p/user/store/metadata → 同名字段
//	parallel_tool_calls                → parallel_tool_calls
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if req.Model == "" {
		return nil, errors.New("model is required")
	}

	messages := make([]dto.Message, 0, 16)

	// 1. instructions → 第一条 system message
	if instr := parseInstructions(req.Instructions); instr != "" {
		messages = append(messages, dto.Message{
			Role:    "system",
			Content: instr,
		})
	}

	// 2. input → messages
	inputItems, err := parseResponsesInputItems(req.Input)
	if err != nil {
		return nil, fmt.Errorf("parse input: %w", err)
	}
	for _, item := range inputItems {
		appendChatMessageFromInputItem(&messages, item)
	}

	// 3. tools 反向(平铺 → 嵌套)
	tools := convertResponsesToolsToChatTools(req.Tools)

	// 4. tool_choice 反向
	toolChoice := convertResponsesToolChoiceToChat(req.ToolChoice)

	// 5. text.format → response_format
	responseFormat := convertResponsesTextToChatResponseFormat(req.Text)

	// 6. parallel_tool_calls 反向(json.RawMessage → *bool)
	var parallelToolCalls *bool
	if len(req.ParallelToolCalls) > 0 {
		var b bool
		if err := common.Unmarshal(req.ParallelToolCalls, &b); err == nil {
			parallelToolCalls = lo.ToPtr(b)
		}
	}

	out := &dto.GeneralOpenAIRequest{
		Model:            req.Model,
		Messages:         messages,
		Stream:           req.Stream,
		StreamOptions:    req.StreamOptions,
		Temperature:      req.Temperature,
		TopP:             req.TopP,
		Tools:            tools,
		ToolChoice:       toolChoice,
		ResponseFormat:   responseFormat,
		User:             req.User,
		Metadata:         req.Metadata,
		Store:            req.Store,
		ParallelTooCalls: parallelToolCalls,
	}

	// 7. max_output_tokens → max_tokens + max_completion_tokens
	if req.MaxOutputTokens != nil {
		out.MaxTokens = req.MaxOutputTokens
		out.MaxCompletionTokens = req.MaxOutputTokens
	}

	// 8. reasoning.effort → reasoning_effort
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		out.ReasoningEffort = req.Reasoning.Effort
	}

	// 9. top_logprobs → top_logprobs(类型一致,直接拷贝)
	if req.TopLogProbs != nil {
		out.TopLogProbs = req.TopLogProbs
	}

	return out, nil
}

// parseInstructions 把 instructions 字段(可能是 string 或 array of strings)解析成单一字符串
func parseInstructions(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}

	// 尝试 string
	var s string
	if err := common.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}

	// 尝试 []string
	var arr []string
	if err := common.Unmarshal(raw, &arr); err == nil {
		var parts []string
		for _, p := range arr {
			if p = strings.TrimSpace(p); p != "" {
				parts = append(parts, p)
			}
		}
		return strings.Join(parts, "\n\n")
	}

	// 尝试 []object{type,text}
	var arrObj []map[string]any
	if err := common.Unmarshal(raw, &arrObj); err == nil {
		var parts []string
		for _, o := range arrObj {
			if t, ok := o["text"].(string); ok && strings.TrimSpace(t) != "" {
				parts = append(parts, strings.TrimSpace(t))
			}
		}
		return strings.Join(parts, "\n\n")
	}

	return ""
}

// parseResponsesInputItems 解析 input 字段:
//   - string  → 转成单一 user message item
//   - array   → 直接返回
func parseResponsesInputItems(raw []byte) ([]map[string]any, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	// 尝试 string:直接当 user message 的 string content,
	// 让下游 appendChatMessageFromContent 命中 case string 简化路径
	var s string
	if err := common.Unmarshal(raw, &s); err == nil {
		if strings.TrimSpace(s) == "" {
			return nil, nil
		}
		return []map[string]any{
			{
				"type":    "message",
				"role":    "user",
				"content": s,
			},
		}, nil
	}

	// 尝试 array
	var arr []map[string]any
	if err := common.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}

	return nil, errors.New("input is neither string nor array")
}

// appendChatMessageFromInputItem 处理一条 input item,把 messages 追加扩展。
//
// 注意:assistant 的 function_call 会**合并到上一条 assistant message** 的 tool_calls,
// 因为 chat completions 协议要求 tool_calls 在 assistant message 上而不是单独 message。
func appendChatMessageFromInputItem(messages *[]dto.Message, item map[string]any) {
	itemType := common.Interface2String(item["type"])

	switch itemType {
	case "", "message":
		role := common.Interface2String(item["role"])
		if role == "" {
			role = "user"
		}
		// developer 在 chat 里通常映射成 system
		if role == "developer" {
			role = "system"
		}
		appendChatMessageFromContent(messages, role, item["content"])

	case "function_call":
		callId := strings.TrimSpace(common.Interface2String(item["call_id"]))
		name := strings.TrimSpace(common.Interface2String(item["name"]))
		if name == "" {
			return // 没 name 的 function_call 无效,跳过
		}
		args := common.Interface2String(item["arguments"])

		tc := dto.ToolCallRequest{
			ID:   callId,
			Type: "function",
			Function: dto.FunctionRequest{
				Name:      name,
				Arguments: args,
			},
		}

		// 尝试合并到上一条 assistant message
		if n := len(*messages); n > 0 && (*messages)[n-1].Role == "assistant" {
			last := &(*messages)[n-1]
			existing := last.ParseToolCalls()
			existing = append(existing, tc)
			last.SetToolCalls(existing)
			return
		}

		// 否则新建一条空 content 的 assistant message
		newMsg := dto.Message{Role: "assistant", Content: ""}
		newMsg.SetToolCalls([]dto.ToolCallRequest{tc})
		*messages = append(*messages, newMsg)

	case "function_call_output":
		callId := strings.TrimSpace(common.Interface2String(item["call_id"]))
		output := common.Interface2String(item["output"])
		*messages = append(*messages, dto.Message{
			Role:       "tool",
			Content:    output,
			ToolCallId: callId,
		})

	case "reasoning":
		// chat completions 协议没有标准 reasoning input 字段,丢弃

	default:
		// 未知 type:尝试 best-effort,把整个 item JSON 化作为 user content
		if b, err := common.Marshal(item); err == nil {
			*messages = append(*messages, dto.Message{
				Role:    "user",
				Content: fmt.Sprintf("[unknown_input_item type=%s] %s", itemType, string(b)),
			})
		}
	}
}

// appendChatMessageFromContent 处理 message item 的 content,转成 dto.Message
//
//	content == nil       → empty string content
//	content is string    → string content
//	content is []object  → 逐项转 MediaContent;若只有单个 text,简化为 string
func appendChatMessageFromContent(messages *[]dto.Message, role string, content any) {
	msg := dto.Message{Role: role}

	switch c := content.(type) {
	case nil:
		msg.Content = ""

	case string:
		msg.Content = c

	case []any:
		mediaContents := make([]dto.MediaContent, 0, len(c))
		for _, part := range c {
			partMap, ok := part.(map[string]any)
			if !ok {
				continue
			}
			mc := convertResponsesContentPartToMedia(partMap)
			if mc != nil {
				mediaContents = append(mediaContents, *mc)
			}
		}

		// 如果只有一个 text 部分,简化为 string content
		if len(mediaContents) == 1 && mediaContents[0].Type == dto.ContentTypeText {
			msg.Content = mediaContents[0].Text
		} else if len(mediaContents) > 0 {
			// 多个或非纯文本 → 设置 parsed media content
			// 因为 dto.Message.Content 是 any,直接 marshal 后再赋值给 Content
			if b, err := common.Marshal(mediaContents); err == nil {
				var arr []any
				_ = common.Unmarshal(b, &arr)
				msg.Content = arr
			}
		} else {
			msg.Content = ""
		}

	default:
		// 兜底:直接 JSON 化
		if b, err := common.Marshal(c); err == nil {
			msg.Content = string(b)
		}
	}

	*messages = append(*messages, msg)
}

// convertResponsesContentPartToMedia 把 responses content part 翻译成 MediaContent
func convertResponsesContentPartToMedia(part map[string]any) *dto.MediaContent {
	t := common.Interface2String(part["type"])
	switch t {
	case "input_text", "output_text", "text":
		return &dto.MediaContent{
			Type: dto.ContentTypeText,
			Text: common.Interface2String(part["text"]),
		}
	case "input_image":
		// responses: {type:input_image, image_url:"..."}  也可能是 {image_url: {url:"..."}}
		imageUrl := part["image_url"]
		var urlStr string
		switch v := imageUrl.(type) {
		case string:
			urlStr = v
		case map[string]any:
			urlStr = common.Interface2String(v["url"])
		}
		return &dto.MediaContent{
			Type:     dto.ContentTypeImageURL,
			ImageUrl: dto.MessageImageUrl{Url: urlStr},
		}
	case "input_audio":
		return &dto.MediaContent{
			Type:       dto.ContentTypeInputAudio,
			InputAudio: part["input_audio"],
		}
	case "input_file":
		return &dto.MediaContent{
			Type: dto.ContentTypeFile,
			File: part["file"],
		}
	case "input_video":
		return &dto.MediaContent{
			Type:     dto.ContentTypeVideoUrl,
			VideoUrl: part["video_url"],
		}
	default:
		// 未知 type:丢弃(chat 协议没对应)
		return nil
	}
}

// convertResponsesToolsToChatTools 把平铺的 responses tools 转成嵌套的 chat tools
//
//	responses: [{type:"function", name, description, parameters}]
//	chat:      [{type:"function", function:{name, description, parameters}}]
func convertResponsesToolsToChatTools(raw []byte) []dto.ToolCallRequest {
	if len(raw) == 0 {
		return nil
	}
	var arr []map[string]any
	if err := common.Unmarshal(raw, &arr); err != nil {
		return nil
	}

	tools := make([]dto.ToolCallRequest, 0, len(arr))
	for _, t := range arr {
		toolType := common.Interface2String(t["type"])
		if toolType != "function" {
			// 非 function tools(MCP / web_search 等)chat 不支持,跳过
			continue
		}
		tool := dto.ToolCallRequest{Type: "function"}
		tool.Function.Name = common.Interface2String(t["name"])
		tool.Function.Description = common.Interface2String(t["description"])
		tool.Function.Parameters = t["parameters"]
		tools = append(tools, tool)
	}
	return tools
}

// convertResponsesToolChoiceToChat 把 responses tool_choice 转成 chat tool_choice
//
//	string 透传:"auto" / "none" / "required"
//	object {type:"function", name:"x"}  → {type:"function", function:{name:"x"}}
func convertResponsesToolChoiceToChat(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}

	// 尝试 string
	var s string
	if err := common.Unmarshal(raw, &s); err == nil {
		return s
	}

	// 尝试 object
	var m map[string]any
	if err := common.Unmarshal(raw, &m); err == nil {
		if t, _ := m["type"].(string); t == "function" {
			if name, ok := m["name"].(string); ok && name != "" {
				return map[string]any{
					"type": "function",
					"function": map[string]any{
						"name": name,
					},
				}
			}
		}
		// 其他 type 透传
		return m
	}

	return nil
}

// convertResponsesTextToChatResponseFormat 把 responses text.format → chat response_format
//
//	responses: text: {format: {type: "json_schema", schema: {...}, strict: true, ...}}
//	chat:      response_format: {type: "json_schema", json_schema: {schema, strict, ...}}
//
//	或简单: text: {format: {type: "json_object"}}
//	→ response_format: {type: "json_object"}
func convertResponsesTextToChatResponseFormat(raw []byte) *dto.ResponseFormat {
	if len(raw) == 0 {
		return nil
	}
	var textObj map[string]any
	if err := common.Unmarshal(raw, &textObj); err != nil {
		return nil
	}
	formatRaw, ok := textObj["format"]
	if !ok {
		return nil
	}
	formatObj, ok := formatRaw.(map[string]any)
	if !ok {
		return nil
	}

	formatType := common.Interface2String(formatObj["type"])
	if formatType == "" {
		return nil
	}

	rf := &dto.ResponseFormat{Type: formatType}

	// 如果是 json_schema,把其他字段(schema/strict/name/description)塞到 JsonSchema
	if formatType == "json_schema" {
		// chat 期待 JsonSchema 是一个 RawMessage,内容是 {schema, strict, name, description}
		jsonSchemaPayload := make(map[string]any)
		for key, value := range formatObj {
			if key == "type" {
				continue
			}
			jsonSchemaPayload[key] = value
		}
		if len(jsonSchemaPayload) > 0 {
			if b, err := common.Marshal(jsonSchemaPayload); err == nil {
				rf.JsonSchema = b
			}
		}
	}

	return rf
}
