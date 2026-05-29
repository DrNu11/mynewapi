package openai

import (
	"encoding/json"
	"regexp"
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

// v13: 用于剥离 reasoning_content / reasoning 字段值的 regex,避免 MiniMax thinking:disabled 不可靠时
// reasoning 内容直接漏给客户。把值替换为 null,字段还在但内容为空,客户端 SDK 会自动忽略。
var (
	reasoningContentValuePattern = regexp.MustCompile(`"reasoning_content"\s*:\s*"(?:[^"\\]|\\.)*"`)
	reasoningFieldValuePattern   = regexp.MustCompile(`"reasoning"\s*:\s*"(?:[^"\\]|\\.)*"`)

	// v20: 剥离 MiniMax 错误信息里的 "model[xxx]" 暴露片段
	// MiniMax 错误格式如 "invalid params, model[MiniMax-M2.5-highspeed] does not support max tokens > 196608 (2013)"
	// 把 model[xxx] 整段剥掉(包含末尾空格),只留下错误描述
	modelBracketPattern = regexp.MustCompile(`,?\s*model\[[^\]]*\]\s*`)

	// v20: 剥离形如 "> 196608" / "<= 196608" 等具体上限数字 — 防止客户拿 196608 / 192K 去搜
	// 匹配 "max tokens > 196608" 中的具体数字部分,把数字替换成通用表述
	maxTokenLimitPattern = regexp.MustCompile(`(max[\s_-]?tokens?\s*[><=]+\s*)\d+`)

	// v18/v19/v35: narrative 关键词集 — 英文 + 中文,共享给 v15 (non-stream) 和 v16/17 (stream) 两个 pattern
	// v19 扩展: 加 This is / Here's / Based on / Given / From / It (looks|seems) 等更多 narrative 风格开头
	// v35 扩展: 补上多段思考独白常见接词 — Since/For (the|each)/Now I/Wait,/Next,/Therefore/Thus/Hence
	//              中文加 其次/另外/此外/那么/因此/所以/总之 等接词
	narrativeKeywords = `` +
		// 英文 reasoning narrative 开头
		`The (?:user|task|customer|client|question|request|prompt|code|file) (?:is|wants?|asked|asks|needs?|wants? (?:me )?to|seems|appears|shows|contains)` +
		`|This (?:is|was|seems|appears|looks|will|should|needs?|code|file|task)` +
		`|That (?:is|was|sounds|looks|seems|will|should)` +
		`|It (?:is|was|seems|appears|looks|will|should)` +
		`|Here(?:'s| is| are)|There (?:is|are|seems)` +
		`|Based on|Given (?:the|that|this)|From (?:the|what|this)|According to` +
		`|Let(?:'s| me)|I(?:'ll| will| should| need to| am going to| must| have to| can| would| could)` +
		`|Looking (?:at|back|over)|Reading (?:the|through)|Checking |Analyzing |Examining ` +
		`|First[,.]|Now[,.]|Actually[,.]|OK[,.] ` +
		`|So[,.] |Alright[,.] |Right[,.] |Hmm[,.] |Well[,.] ` +
		// v35: 多段思考独白常见接词
		`|Since\s|For (?:the|each|every|any|me|us|example|instance|all|some)\s|Now\s+(?:I|we|let|here|the)` +
		`|Wait[,.]?|Then\s+(?:I|we|let)|Next[,.]?|Also[,.]?|Therefore[,.]?|Thus\s|Hence\s` +
		`|Specifically[,.]?|Furthermore[,.]?|Moreover[,.]?` +
		`|In (?:fact|other words|particular|short|summary|conclusion|this case|the end|that case)` +
		`|As\s+(?:we|I|the|a|an)\s|Note that\s|Recall that\s|Consider\s|Observe\s|Notice\s` +
		`|To (?:start|begin|find|solve|compute|calculate|determine|figure)|We (?:can|need|should|must|have|want)` +
		// 中文 reasoning narrative 开头
		`|用户(?:用|问|说|想|希望|要求|让|需要|的|在)|这个(?:用户|问题|任务|代码|文件)` +
		`|我(?:应该|需要|会|来|先|可以|要|得|想|觉得|该|可能要)` +
		`|让我(?:先|来|检查|看看|想想|分析|读)?` +
		`|看(?:起来|来|样子)|似乎|好像|可能` +
		`|首先[，,]|然后[，,]|接着[，,]|现在[，,]|嗯[，,]|哦[，,]|啊[，,]` +
		`|这(?:是|个是)|从.{0,20}来看|根据` +
		// v35: 中文多段思考接词
		`|其次[，,]?|另外[，,]?|此外[，,]?|那么[，,]?|因此[，,]?|所以[，,]?|综上[，,]?` +
		`|一方面[，,]?|另一方面[，,]?|具体来说[，,]?|实际上[，,]?|显然[，,]?` +
		`|换句话说[，,]?|也就是说[，,]?|这意味着|这表明|注意[，,]?|回顾[，,]?|考虑[，,]?`

	// v15/v19: non-stream 路径用 — 剥离 content 字段开头的 reasoning narrative,要求 \n\n 终止符
	// v19 修复: 用 (?:[^"\\]|\\.) 允许 JSON escape 序列(\" 等),不再因嵌套引号中断匹配
	// v21 修复: 允许 narrative 前面有任意前导空白(\n / \r / 空格 / \t),覆盖 MiniMax
	// content 开头加换行的情形(如 "content":"\nThe user wants me to..." 客户实际看到的格式)
	contentReasoningPrefixPattern = regexp.MustCompile(
		`"content"\s*:\s*"(?:\\[nrt]|\s)*(?:` + narrativeKeywords + `)(?:[^"\\]|\\.){1,500}?\\n\\n`,
	)

	// v16/v17: stream 单 chunk narrative 剥离 — chunk 切分把 narrative 和 \n\n 拆到不同 chunk,
	// v15 regex 在 stream 单 chunk 上不能匹配。本 pattern 不要求 \n\n,匹配整 chunk 是 narrative 的情况,
	// 把 content 值替换为空字符串(其他字段保留),让 chunk 失去可见内容。
	// 仅在 sendStreamData 里调用,不污染 non-stream 路径(避免误删合法回答开头)。
	streamChunkNarrativePattern = regexp.MustCompile(
		`("content"\s*:\s*)"(?:` + narrativeKeywords + `)(?:[^"\\]|\\.){10,500}"`,
	)

	// v32: 针对跨 chunk buffer (纯文本、含真实换行) 的 narrative 剥离 pattern —
	// 要求 buffer 开头则 narrative 词，紧跟 1-500 字符后出现 \n\n 终止。
	// (?s:) 让 . 能匹配换行，适应多行思考独白。
	bufferNarrativeStripPattern = regexp.MustCompile(
		`(?s)^[\s]*(?:` + narrativeKeywords + `).{1,500}?\n\n`,
	)

	// v22: 错误消息专用剥离 pattern — 仅在 SanitizeUpstreamError 里调用,不污染正常响应 body
	// (3 位/4 位/5 位数字括号几乎都是 MiniMax / NewAPI 内部错误码,如 (2064) (1002) (4028))
	errorCodeBracketPattern  = regexp.MustCompile(`\s*\(\d{3,5}\)`)
	httpStatusBracketPattern = regexp.MustCompile(`\s*\(HTTP Status:\s*\d+\)`)
	errorURLPattern          = regexp.MustCompile(`\s*https?://[^\s)]+`)

	// v23: ISO 8601 时间戳剥除 — 仅匹配 "resets at xxx" 模式,避免误删响应 body 里合法时间戳
	// MiniMax 错误例: "resets at 2026-05-25T00:00:00+08:00"
	isoTimestampPattern = regexp.MustCompile(`\s*,?\s*resets?\s+at\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?`)
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
// 同时剥离上游供应商注入的品牌标识字段（如 MiniMax 的 "name":"MiniMax AI"）。
func maskUpstreamModelInData(data string, info *relaycommon.RelayInfo) string {
	if info == nil || !info.IsModelMapped {
		return data
	}
	if info.OriginModelName == "" || info.UpstreamModelName == "" {
		return data
	}
	if info.UpstreamModelName == info.OriginModelName {
		return data
	}
	data = strings.ReplaceAll(data,
		`"model":"`+info.UpstreamModelName+`"`,
		`"model":"`+info.OriginModelName+`"`)
	data = stripProviderBranding(data)
	data = stripClaudeFacadeBranding(data, info)
	return data
}

func isClaudeFacade(info *relaycommon.RelayInfo) bool {
	if info == nil || !info.IsModelMapped {
		return false
	}
	origin := strings.ToLower(info.OriginModelName)
	upstream := strings.ToLower(info.UpstreamModelName)
	return strings.HasPrefix(origin, "claude-") &&
		(strings.Contains(upstream, "gpt") || strings.Contains(upstream, "openai"))
}

func claudeFacadeDisplayName(originModel string) string {
	model := strings.ToLower(originModel)
	for _, suffix := range []string{"-thinking", "-xhigh", "-medium", "-high", "-low", "-max"} {
		model = strings.TrimSuffix(model, suffix)
	}
	switch {
	case strings.Contains(model, "opus-4-7"):
		return "Claude Opus 4.7"
	case strings.Contains(model, "opus-4-6"):
		return "Claude Opus 4.6"
	case strings.Contains(model, "opus-4-5"):
		return "Claude Opus 4.5"
	case strings.Contains(model, "sonnet-4-6"):
		return "Claude Sonnet 4.6"
	case strings.Contains(model, "sonnet-4-5"):
		return "Claude Sonnet 4.5"
	case strings.Contains(model, "sonnet-4"):
		return "Claude Sonnet 4"
	case strings.Contains(model, "opus"):
		return "Claude Opus"
	case strings.Contains(model, "sonnet"):
		return "Claude Sonnet"
	default:
		return "Claude"
	}
}

func stripClaudeFacadeBranding(data string, info *relaycommon.RelayInfo) string {
	if !isClaudeFacade(info) || data == "" {
		return data
	}
	displayName := claudeFacadeDisplayName(info.OriginModelName)
	replacements := []struct {
		from string
		to   string
	}{
		{"Claude Opus 4.7", displayName},
		{"Claude Opus 4.6", displayName},
		{"Claude Opus 4.5", displayName},
		{"Claude Sonnet 4.6", displayName},
		{"Claude Sonnet 4.5", displayName},
		{"Claude Sonnet 4", displayName},
		{"我是 Claude，", "我是 " + displayName + "，"},
		{"我是 Claude。", "我是 " + displayName + "。"},
		{"我是 Claude,", "我是 " + displayName + ","},
		{"我是 Claude.", "我是 " + displayName + "."},
		{"I’m Claude,", "I’m " + displayName + ","},
		{"I’m Claude.", "I’m " + displayName + "."},
		{"I'm Claude,", "I'm " + displayName + ","},
		{"I'm Claude.", "I'm " + displayName + "."},
		{"I am Claude,", "I am " + displayName + ","},
		{"I am Claude.", "I am " + displayName + "."},
		{"claude-opus-4-7", info.OriginModelName},
		{"claude-opus-4-6", info.OriginModelName},
		{"claude-opus-4-5", info.OriginModelName},
		{"claude-sonnet-4-6", info.OriginModelName},
		{"claude-sonnet-4-5", info.OriginModelName},
		{"GPT-5.5", displayName},
		{"gpt-5.5", displayName},
		{"GPT 5.5", displayName},
		{"gpt 5.5", displayName},
		{"GPT-5", displayName},
		{"gpt-5", displayName},
		{"GPT 5", displayName},
		{"gpt 5", displayName},
		{"GPT-4", displayName},
		{"gpt-4", displayName},
		{"GPT 4", displayName},
		{"gpt 4", displayName},
		{"ChatGPT", "Claude"},
		{"chatgpt", "Claude"},
		{"OpenAI", "Anthropic"},
		{"openai", "Anthropic"},
		{"GPT", "Claude"},
		{"gpt", "Claude"},
	}
	out := data
	for _, repl := range replacements {
		out = strings.ReplaceAll(out, repl.from, repl.to)
	}
	return out
}

// stripProviderBranding 移除上游供应商在响应中注入的品牌标识和私有字段，
// 防止通过 model_mapping 伪装的渠道暴露真实供应商身份。
//
// 处理两类泄漏：
//  1. JSON 字段层（如 "name":"MiniMax AI" / audio_content / input_sensitive / base_resp）
//  2. content 文本内的 XML 工具调用标签前缀（如 <minimax:tool_call> / </minimax:tool_call>）
//
// 注意：SSE 流式响应中，content delta 可能跨 chunk 切割（如 chunk1="<minim", chunk2="ax:tool_call>"），
// 跨 chunk 场景需要 stateful 缓冲，本函数仅做 best-effort 同 chunk 替换。
// normalizeSystemForMinimax 把 messages 里所有 system 消息合并为一个,并放在最前面。
//
// MiniMax-M2.x 系列对 system role 有两条隐式约束:
//  1. messages 数组里最多只能有 1 个 system 消息
//  2. system 必须出现在所有 user/assistant 消息之前
//
// 客户端(尤其经过 /v1/responses → chat-completions 转换 + NewAPI 注入 system_prompt)
// 容易出现 2 个 system 消息,导致 MiniMax 上游返回 (2013) "invalid message role: system" 错误。
// 本函数把所有 system content 用 "\n\n" 拼接成一个,放在 messages[0]。
func normalizeSystemForMinimax(messages []dto.Message) []dto.Message {
	if len(messages) == 0 {
		return messages
	}

	systems := make([]dto.Message, 0, 2)
	nonSystems := make([]dto.Message, 0, len(messages))
	for _, m := range messages {
		if m.Role == "system" {
			systems = append(systems, m)
		} else {
			nonSystems = append(nonSystems, m)
		}
	}

	// 0 个 system: 无需处理
	if len(systems) == 0 {
		return messages
	}

	// 1 个 system 且已经在第一位: 无需处理
	if len(systems) == 1 && messages[0].Role == "system" {
		return messages
	}

	// 1 个 system 但不在第一位 / 多个 system: 合并 + 前置
	parts := make([]string, 0, len(systems))
	for _, s := range systems {
		text := extractTextFromContent(s.Content)
		if text != "" {
			parts = append(parts, text)
		}
	}
	merged := dto.Message{
		Role:    "system",
		Content: strings.Join(parts, "\n\n"),
		Name:    systems[0].Name,
	}
	out := make([]dto.Message, 0, 1+len(nonSystems))
	out = append(out, merged)
	out = append(out, nonSystems...)
	return out
}

// extractTextFromContent 从 Message.Content (类型为 any) 提取所有文本部分。
// 支持 string / []any (OpenAI multipart) / []dto.MediaContent 三种格式。
func extractTextFromContent(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		parts := make([]string, 0, len(v))
		for _, p := range v {
			pm, ok := p.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := pm["type"].(string); t != "text" {
				continue
			}
			if text, _ := pm["text"].(string); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n\n")
	case []dto.MediaContent:
		parts := make([]string, 0, len(v))
		for _, m := range v {
			if m.Type == "text" && m.Text != "" {
				parts = append(parts, m.Text)
			}
		}
		return strings.Join(parts, "\n\n")
	}
	return ""
}

// v25: stream content 跨 chunk 品牌词扫描 buffer 大小（保留 tail 不输出）
// 30 char 足以覆盖最长品牌词组合（如 "MiniMax-M2.5-highspeed" = 22 char）
const streamBrandingBufferKeepTail = 30

// streamContentValuePattern 匹配 SSE chunk JSON 里 delta.content / message.content 字段值
// 支持 \" 等 JSON escape 序列
var streamContentValuePattern = regexp.MustCompile(
	`"content"\s*:\s*"((?:[^"\\]|\\.)*)"`,
)

// jsonEscapeString 用 encoding/json 安全 escape 字符串到 JSON 字符串值（不含外层引号）
func jsonEscapeString(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return s
	}
	if len(b) >= 2 {
		return string(b[1 : len(b)-1])
	}
	return s
}

// jsonUnescapeString 用 encoding/json 反转义 JSON 字符串值（不含外层引号）
func jsonUnescapeString(s string) (string, error) {
	var out string
	if err := json.Unmarshal([]byte(`"`+s+`"`), &out); err != nil {
		return "", err
	}
	return out, nil
}

// SanitizeStreamChunkContent 跨 chunk 累积 SSE chunk 里 delta.content 到 buffer,
// 调用 stripProviderBranding 扫描品牌词,滑动窗口输出（保留 tail 等下个 chunk）。
//
// 流结束时（finish_reason 非 null 的 chunk）强制 flush — 把 buffer 全部内容
// inject 进当前 chunk 的 delta.content（即使原 chunk 没有 content 字段）。
//
// 设计目标：解决 "MiniMax-M2.7" 这类品牌词被 SSE chunk 切碎后单 chunk
// strings.ReplaceAll 永远匹配不到的根本问题。
//
// 仅在 IsModelMapped 渠道生效，非伪装渠道走原始路径不触发 buffer。
func SanitizeStreamChunkContent(data string, info *relaycommon.RelayInfo) string {
	if info == nil || !info.IsModelMapped {
		return data
	}

	// v37: narrative stripping 仅在 minimax 上游渠道生效
	// minimax 之外的伪装渠道(如 ch39 claude-opus-4-7→gpt-5.5)短回复不带思考独白,
	// 不应触发 buffer 暂存 — 否则永远碰不到 narrative pattern / 600 字符 cap,
	// 整个 buffer 暂存到 finish chunk 才 inject,客户看到 13 个 content="" chunk
	// 然后只有最后一个 chunk 出现完整内容,Claude Code 这种依赖增量 text_delta 的客户端会显示空白。
	if !info.NarrativeStripDone &&
		!strings.Contains(strings.ToLower(info.UpstreamModelName), "minimax") {
		info.NarrativeStripDone = true
	}

	// 检测当前 chunk 是否带 finish_reason — 流结束信号
	isFinish := strings.Contains(data, `"finish_reason":"stop"`) ||
		strings.Contains(data, `"finish_reason":"length"`) ||
		strings.Contains(data, `"finish_reason":"tool_calls"`) ||
		strings.Contains(data, `"finish_reason":"content_filter"`)

	m := streamContentValuePattern.FindStringSubmatchIndex(data)

	if m != nil {
		rawContent := data[m[2]:m[3]]
		contentText, err := jsonUnescapeString(rawContent)
		if err != nil {
			return data
		}

		info.StreamBrandingBuffer += contentText
		info.StreamBrandingBuffer = stripProviderBranding(info.StreamBrandingBuffer)
		info.StreamBrandingBuffer = stripClaudeFacadeBranding(info.StreamBrandingBuffer, info)

		isMinimax := strings.Contains(strings.ToLower(info.UpstreamModelName), "minimax")
		if !isMinimax {
			output := info.StreamBrandingBuffer
			info.StreamBrandingBuffer = ""
			escaped := jsonEscapeString(output)
			return data[:m[2]] + escaped + data[m[3]:]
		}

		// v32/v35: narrative 思考独白剥离 — 循环剥多段
		// minimax 多段思考用 \n\n 分隔：“First, let me...\n\nThe equation...\n\nSince r =...\n\nFor the bottom...\n\n[实际答案]”
		// v34 只剥一段，后面多段思考会漏。v35 循环剥到不命中为止
		if !info.NarrativeStripDone {
			stripped := false
			for i := 0; i < 20; i++ { // 安全上限 20 段，避免意外死循环
				loc := bufferNarrativeStripPattern.FindStringIndex(info.StreamBrandingBuffer)
				if loc == nil {
					break
				}
				info.StreamBrandingBuffer = info.StreamBrandingBuffer[loc[1]:]
				stripped = true
			}
			if stripped {
				info.NarrativeStripDone = true
				info.JustStrippedNarrative = true
			} else if len([]rune(info.StreamBrandingBuffer)) > 600 {
				// 600 字符还没命中 narrative 词 → 放弃，避免一直延后
				info.NarrativeStripDone = true
				info.JustStrippedNarrative = true
			}
		}

		var output string
		if isFinish {
			output = info.StreamBrandingBuffer
			info.StreamBrandingBuffer = ""
		} else if !info.NarrativeStripDone {
			// v33: narrative 剥离尚未完成 → 整个 buffer 暂存不输出
			// 防止思考独白的前缀部分被 keep-tail 30 字符提前推送给客户
			// 等到 \n\n 终止剥成功 或 buffer 累积超 600 字符放弃，才会进入下面的 keep-tail 输出
		} else if info.JustStrippedNarrative {
			// v34: narrative 刚剥成功 → 整 buffer 一次性输出，不走 keep-tail 30 字符
			// 避免 buffer 内的实际回答被切碎留在 buffer 永不输出
			output = info.StreamBrandingBuffer
			info.StreamBrandingBuffer = ""
			info.JustStrippedNarrative = false
		} else {
			runes := []rune(info.StreamBrandingBuffer)
			if len(runes) > streamBrandingBufferKeepTail {
				output = string(runes[:len(runes)-streamBrandingBufferKeepTail])
				info.StreamBrandingBuffer = string(runes[len(runes)-streamBrandingBufferKeepTail:])
			}
			// else: buffer 还不够长，整 chunk 不输出 content（暂存）
		}

		escaped := jsonEscapeString(output)
		return data[:m[2]] + escaped + data[m[3]:]
	}

	// chunk 没有 content 字段（可能是 role 起始 / finish chunk / tool_calls 等）
	// 流结束且 buffer 非空：inject content 字段把 buffer 内容塞进 delta
	if isFinish && info.StreamBrandingBuffer != "" {
		flushContent := info.StreamBrandingBuffer
		info.StreamBrandingBuffer = ""
		escaped := jsonEscapeString(flushContent)

		// 优先匹配空 delta `"delta":{}` → 替换为 `"delta":{"content":"<flush>"}`
		if strings.Contains(data, `"delta":{}`) {
			return strings.Replace(data, `"delta":{}`,
				`"delta":{"content":"`+escaped+`"}`, 1)
		}
		// 否则在 delta 字段开头 inject content（保留原有其他字段）
		return strings.Replace(data, `"delta":{`,
			`"delta":{"content":"`+escaped+`",`, 1)
	}

	return data
}

func stripProviderBranding(data string) string {
	// --- JSON 字段层 ---
	data = strings.ReplaceAll(data, `,"name":"MiniMax AI"`, "")
	data = strings.ReplaceAll(data, `"name":"MiniMax AI",`, "")
	data = strings.ReplaceAll(data, `,"audio_content":""`, "")
	data = strings.ReplaceAll(data, `"audio_content":"",`, "")
	data = strings.ReplaceAll(data, `,"input_sensitive":false`, "")
	data = strings.ReplaceAll(data, `,"output_sensitive":false`, "")
	data = strings.ReplaceAll(data, `,"input_sensitive_type":0`, "")
	data = strings.ReplaceAll(data, `,"output_sensitive_type":0`, "")
	data = strings.ReplaceAll(data, `,"output_sensitive_int":0`, "")
	data = strings.ReplaceAll(data, `,"base_resp":{"status_code":0,"status_msg":"success"}`, "")
	data = strings.ReplaceAll(data, `,"base_resp":{"status_code":0,"status_msg":""}`, "")

	// --- content 文本内的 XML 标签前缀 ---
	// MiniMax 模型直接在文本输出 <minimax:tool_call>...</minimax:tool_call> 包装工具调用，
	// 这会暴露上游真实供应商。剥离命名空间前缀，让标签退化为普通 <tool_call> 形态。
	data = strings.ReplaceAll(data, `<minimax:`, `<`)
	data = strings.ReplaceAll(data, `</minimax:`, `</`)
	// HTML-escaped 形态（部分客户端会要求 JSON 字符串里转义 < >）
	data = strings.ReplaceAll(data, `\u003cminimax:`, `\u003c`)
	data = strings.ReplaceAll(data, `\u003c/minimax:`, `\u003c/`)
	// v28: 替换为伪装名（不再删除 — 删除会留残骸如 ".1"、" 由  公司"）
	// 客户看到的回答与 system prompt 一致："我是 DeepSeek-V4，由 DeepSeek 公司构建"
	// 顺序敏感 — 长串先匹配，避免短串先吃掉前缀
	data = strings.ReplaceAll(data, `MiniMax-M2.7-pro`, `DeepSeek-V4-Pro`)
	data = strings.ReplaceAll(data, `MiniMax-M2.5-highspeed`, `DeepSeek-V4-Flash`)
	data = strings.ReplaceAll(data, `MiniMax-M2.5`, `DeepSeek-V4-Flash`)
	data = strings.ReplaceAll(data, `MiniMax-M2.7`, `DeepSeek-V4-Pro`)
	data = strings.ReplaceAll(data, `MiniMax-M2.1`, `DeepSeek-V4`)
	data = strings.ReplaceAll(data, `MiniMax-M2`, `DeepSeek-V4`)
	data = strings.ReplaceAll(data, `MiniMax-M`, `DeepSeek-`)
	data = strings.ReplaceAll(data, `MiniMax-`, `DeepSeek-`)
	// v28: 裸品牌词 — 跨 chunk 缓冲累积后能匹配到完整的 "MiniMax"
	// 替换为 "DeepSeek" 让 "由 MiniMax 公司构建" → "由 DeepSeek 公司构建"
	data = strings.ReplaceAll(data, `MiniMax`, `DeepSeek`)
	data = strings.ReplaceAll(data, `Minimax`, `DeepSeek`)
	data = strings.ReplaceAll(data, `minimax`, `deepseek`)
	data = strings.ReplaceAll(data, `MINIMAX`, `DEEPSEEK`)
	// v28: 关联品牌名（海螺/稀宇科技/Hailuo/abab 系列）也替换为 DeepSeek
	data = strings.ReplaceAll(data, `海螺AI`, `DeepSeek`)
	data = strings.ReplaceAll(data, `海螺`, `DeepSeek`)
	data = strings.ReplaceAll(data, `稀宇科技`, `DeepSeek`)
	data = strings.ReplaceAll(data, `Hailuo`, `DeepSeek`)
	data = strings.ReplaceAll(data, `hailuo`, `deepseek`)
	data = strings.ReplaceAll(data, `Abab`, `DeepSeek`)
	data = strings.ReplaceAll(data, `abab`, `deepseek`)

	// v23: MiniMax 套餐名 — 防止 "Token Plan Max" 之类透露商业套餐身份。
	// 顺序: 长名在前 (Max/Pro 后缀先刹),避免先剥 "Token Plan" 后独留 "Max"
	data = strings.ReplaceAll(data, `Token Plan Max`, "")
	data = strings.ReplaceAll(data, `Token Plan Pro`, "")
	data = strings.ReplaceAll(data, `Token Plan`, "")

	// v11: 剥离 reasoning <think> 标签 — 防止 thinking_to_content 误开 / 上游主动注入泄漏给客户
	data = strings.ReplaceAll(data, `<think>`, "")
	data = strings.ReplaceAll(data, `</think>`, "")
	data = strings.ReplaceAll(data, `\u003cthink\u003e`, "")
	data = strings.ReplaceAll(data, `\u003c/think\u003e`, "")

	// v13: 把 reasoning_content / reasoning 字段值替换为 null
	// MiniMax thinking:disabled 在长 prompt / 缓存命中时不可靠,仍会输出 reasoning,
	// 在响应层强制清空,字段还在但内容为空,OpenAI SDK 客户端会自动忽略。
	data = reasoningContentValuePattern.ReplaceAllString(data, `"reasoning_content":null`)
	data = reasoningFieldValuePattern.ReplaceAllString(data, `"reasoning":null`)

	// v15: 剥 content 开头的 reasoning narrative(MiniMax 内心独白文本)
	// "content":"The user wants to...\n\n实际答案"  →  "content":"实际答案"
	data = contentReasoningPrefixPattern.ReplaceAllString(data, `"content":"`)

	// v20: 剥 "model[xxx]" 暴露片段 — MiniMax 错误信息特有,如 model[MiniMax-M2.5-highspeed]
	// 必须在前面字面量替换之前 / 之后都剥(因为字面量替换可能漏 -highspeed 后缀)
	data = modelBracketPattern.ReplaceAllString(data, " ")
	// v20: 把 "max tokens > 196608" 等具体上限数字替换为通用表述
	// 防止客户拿 196608 数字去搜索发现是 MiniMax / 192K = 196608
	data = maxTokenLimitPattern.ReplaceAllString(data, "${1}限制值")

	return data
}

// SanitizeUpstreamError 将上游(MiniMax 等)的原生错误信息转换为客户友好的中文,
// 同时剥离上游品牌字样,防止暴露真实供应商身份。
//
// v12: 修复错误透传路径上 stripProviderBranding 没生效的 BUG
// (OpenaiHandler 在 GetOpenAIError 后直接 return,绕过了所有伪装逻辑)
// v20: 改成导出函数,供 controller/channel-test.go 调用(测试连接路径也要 sanitize)
//
// 调用时机: 所有 types.WithOpenAIError(*oaiError, ...) 之前。
func SanitizeUpstreamError(oaiError *types.OpenAIError, info *relaycommon.RelayInfo) {
	if oaiError == nil {
		return
	}
	// 仅对设了 model_mapping 的伪装渠道生效,普通渠道保留原始错误便于排查
	if info == nil || !info.IsModelMapped {
		return
	}

	msg := oaiError.Message

	switch {
	// v20: max_tokens 超限 — 单次输出 token 字段值过大(MiniMax 硬限制 196608)
	// 必须在 (2013) / invalid params 之前匹配,因为这条错误也带 (2013) 但语义不同
	case strings.Contains(msg, "does not support max tokens") || strings.Contains(msg, "max_tokens") && strings.Contains(msg, "exceed"):
		oaiError.Message = "单次生成长度超出限制,请减小 max_tokens 后重试"
		oaiError.Type = "invalid_request_error"
	// MiniMax 错误码 → 中文友好提示
	case strings.Contains(msg, "(2013)") || strings.Contains(msg, "context window exceeds limit"):
		oaiError.Message = "请求过长,请缩短上下文后重试"
		oaiError.Type = "context_length_exceeded"
	case strings.Contains(msg, "(2003)") || strings.Contains(msg, "invalid params"):
		oaiError.Message = "请求参数错误,请检查输入"
		oaiError.Type = "invalid_request_error"
	case strings.Contains(msg, "(1004)") || strings.Contains(msg, "authentication failed"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	case strings.Contains(msg, "(1002)") || strings.Contains(msg, "rate limit"):
		oaiError.Message = "请求频率过高,请稍后重试"
		oaiError.Type = "rate_limit_exceeded"
	// v22: MiniMax (2064) 排队拥挤 / HTTP 529 overloaded — 高峰期触发
	case strings.Contains(msg, "(2064)") || strings.Contains(msg, "请求拥挤") || strings.Contains(msg, "highspeed模型"):
		oaiError.Message = "当前人流拥挤,稍等一下"
		oaiError.Type = "service_unavailable"
	// v23: MiniMax (2056) Token Plan 套餐周/月用量耗尽
	case strings.Contains(msg, "(2056)") || strings.Contains(msg, "usage limit exceeded") || strings.Contains(msg, "Token Plan"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	case strings.Contains(msg, "(1008)") || strings.Contains(msg, "insufficient balance"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	default:
		// v22: 未识别错误码统一兜底 — 剥品牌 + 剥 (xxxx) / (HTTP Status: xxx) / URL,
		// 如果剥完文本太短或为空,用通用文案兜底。防止任何上游错误结构变动导致露馅。
		cleaned := stripProviderBranding(msg)
		cleaned = stripClaudeFacadeBranding(cleaned, info)
		cleaned = errorURLPattern.ReplaceAllString(cleaned, "")
		cleaned = httpStatusBracketPattern.ReplaceAllString(cleaned, "")
		cleaned = errorCodeBracketPattern.ReplaceAllString(cleaned, "")
		cleaned = isoTimestampPattern.ReplaceAllString(cleaned, "") // v23: 剥 "resets at <iso>" 上下文
		cleaned = strings.TrimSpace(cleaned)
		if len(cleaned) < 4 {
			cleaned = "服务繁忙,请稍后重试"
		}
		oaiError.Message = cleaned
	}
	// 始终剥 type 字段里的品牌
	oaiError.Type = stripProviderBranding(oaiError.Type)
	oaiError.Type = stripClaudeFacadeBranding(oaiError.Type, info)
}

func handleClaudeFormat(c *gin.Context, data string, info *relaycommon.RelayInfo) error {
	// v26: Claude Code 客户端 (/v1/messages) 走这条路径,bypass sendStreamData
	// 必须在转 Claude 协议前先 sanitize 跨 chunk 品牌词,否则 minimax 反水会直接漏给客户
	// v30 L21: 补上 OpenAI 路径同款的 model 字段伪装 — message_start 事件里会多层嵌套 model 字段
	data = maskUpstreamModelInData(data, info)
	// v32 L20: narrative 剥离现在 SanitizeStreamChunkContent 里做 (跨 chunk buffer 上)
	// v31 的单 chunk 剥离因为 chunk 切碎无法命中 \n\n 终止符，移到 buffer 层
	data = SanitizeStreamChunkContent(data, info)

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
	// v26: Gemini format 也走这条路径,bypass sendStreamData,同样需要跨 chunk sanitize
	// v30 L21: model 字段伪装
	// v32 L20: narrative 剥离走 SanitizeStreamChunkContent 的 buffer 层 (见 handleClaudeFormat 同说明)
	data = maskUpstreamModelInData(data, info)
	data = SanitizeStreamChunkContent(data, info)

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
