package openai

import (
	"strings"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"

	"github.com/gin-gonic/gin"
)

const (
	thinkOpenTag  = "<think>"
	thinkCloseTag = "</think>"
)

// trailingPartialLen returns the length of the longest suffix of s that is a
// proper (shorter-than-full) prefix of tag. It is used to detect a tag that is
// split across streaming deltas so we can buffer it instead of leaking it.
func trailingPartialLen(s, tag string) int {
	limit := len(tag) - 1
	if limit > len(s) {
		limit = len(s)
	}
	for n := limit; n >= 1; n-- {
		if s[len(s)-n:] == tag[:n] {
			return n
		}
	}
	return 0
}

// splitInlineThink consumes a content delta and splits it into a reasoning part
// (text inside <think>...</think>) and a content part (everything else). It is
// stateful across deltas via the ThinkingContentInfo fields, and buffers a tag
// that is split across delta boundaries. flush=true forces any buffered partial
// tag to be emitted as content (used on the final chunk of a stream).
func splitInlineThink(ti *relaycommon.ThinkingContentInfo, s string, flush bool) (reasoning string, content string) {
	s = ti.ContentThinkBuffer + s
	ti.ContentThinkBuffer = ""

	var rb, cb strings.Builder
	for len(s) > 0 {
		if !ti.ContentThinkInThink {
			if idx := strings.Index(s, thinkOpenTag); idx >= 0 {
				cb.WriteString(s[:idx])
				s = s[idx+len(thinkOpenTag):]
				ti.ContentThinkInThink = true
				ti.ContentThinkSawOpen = true
				continue
			}
			if p := trailingPartialLen(s, thinkOpenTag); p > 0 && !flush {
				cb.WriteString(s[:len(s)-p])
				ti.ContentThinkBuffer = s[len(s)-p:]
				s = ""
				continue
			}
			cb.WriteString(s)
			s = ""
		} else {
			if idx := strings.Index(s, thinkCloseTag); idx >= 0 {
				rb.WriteString(s[:idx])
				s = s[idx+len(thinkCloseTag):]
				ti.ContentThinkInThink = false
				ti.ContentThinkDone = true
				continue
			}
			if p := trailingPartialLen(s, thinkCloseTag); p > 0 && !flush {
				rb.WriteString(s[:len(s)-p])
				ti.ContentThinkBuffer = s[len(s)-p:]
				s = ""
				continue
			}
			rb.WriteString(s)
			s = ""
		}
	}
	return rb.String(), cb.String()
}

// extractInlineThinkWhole pulls all <think>...</think> blocks out of a complete
// (non-streamed) string, returning the concatenated reasoning and the remaining
// content. Used on the non-streaming chat path.
func extractInlineThinkWhole(s string) (reasoning string, content string) {
	ti := &relaycommon.ThinkingContentInfo{}
	return splitInlineThink(ti, s, true)
}

// streamChunkHasMeaningfulFields reports whether the chunk carries anything we
// must forward even when its content/reasoning deltas are empty (so we don't
// drop finish_reason / usage / tool_calls while buffering a partial tag).
func streamChunkHasMeaningfulFields(resp *dto.ChatCompletionsStreamResponse) bool {
	if resp.Usage != nil {
		return true
	}
	for i := range resp.Choices {
		ch := &resp.Choices[i]
		if ch.FinishReason != nil || len(ch.Delta.ToolCalls) > 0 || ch.Delta.Role != "" {
			return true
		}
		if ch.Delta.GetContentString() != "" || ch.Delta.GetReasoningContent() != "" {
			return true
		}
	}
	return false
}

// sendDisguisedStreamChunk applies the disguise transforms (inline <think> ->
// reasoning_content and/or text-tool-call salvage) to a chat-completions stream
// chunk before forwarding it. It is only called when at least one of the two
// channel settings is enabled.
func sendDisguisedStreamChunk(c *gin.Context, info *relaycommon.RelayInfo, resp *dto.ChatCompletionsStreamResponse) error {
	ti := &info.ThinkingContentInfo
	thinkOn := info.ChannelSetting.ContentThinkToReasoning
	salvageOn := info.ChannelSetting.SalvageTextToolCalls

	// model-name disguise: never leak the upstream model name to the client.
	if info.OriginModelName != "" && resp.Model != info.OriginModelName {
		resp.Model = info.OriginModelName
	}

	flush := false
	for i := range resp.Choices {
		if resp.Choices[i].FinishReason != nil {
			flush = true
		}
	}

	for i := range resp.Choices {
		ch := &resp.Choices[i]
		content := ch.Delta.GetContentString()

		// Step 1: extract inline <think> into reasoning_content.
		if thinkOn && content != "" {
			reasoning, rest := splitInlineThink(ti, content, flush)
			if reasoning != "" {
				ch.Delta.SetReasoningContent(reasoning)
			}
			content = rest
		}

		// Step 2: feed remaining content through the salvage state machine.
		if salvageOn {
			ch.Delta.Content = nil
			out := salvageFeed(ti, content, flush)
			if out != "" {
				ch.Delta.SetContentString(out)
			}
		} else {
			if content == "" {
				ch.Delta.Content = nil
			} else {
				ch.Delta.SetContentString(content)
			}
		}
	}

	// Step 3: on the final chunk, if we withheld a tool-call candidate, emit it
	// as structured tool_calls (or flush it back as content if not parseable).
	if salvageOn && flush && ti.SalvageBuffering {
		if err := emitSalvagedToolCalls(c, info, resp); err != nil {
			return err
		}
	}

	if !streamChunkHasMeaningfulFields(resp) {
		return nil
	}
	return helper.ObjectData(c, *resp)
}

// salvageFeed accumulates content while deciding whether the assistant turn is a
// text-encoded tool call. It returns the content that should be forwarded now
// (empty while buffering a candidate).
func salvageFeed(ti *relaycommon.ThinkingContentInfo, content string, flush bool) string {
	if !ti.SalvageDecided {
		ti.SalvageBuffer += content
		candidate, undecided := streamToolCandidateState(ti.SalvageBuffer)
		if undecided && !flush {
			return ""
		}
		ti.SalvageDecided = true
		if candidate {
			ti.SalvageBuffering = true
			return ""
		}
		// prose: release whatever we buffered
		out := ti.SalvageBuffer
		ti.SalvageBuffer = ""
		return out
	}
	if ti.SalvageBuffering {
		ti.SalvageBuffer += content
		return ""
	}
	return content
}

// emitSalvagedToolCalls parses the buffered candidate; on success it sends a
// structured tool_calls delta and marks the final chunk finish_reason as
// tool_calls. On failure it flushes the buffer back as plain content.
func emitSalvagedToolCalls(c *gin.Context, info *relaycommon.RelayInfo, resp *dto.ChatCompletionsStreamResponse) error {
	ti := &info.ThinkingContentInfo
	buffered := ti.SalvageBuffer
	ti.SalvageBuffer = ""
	ti.SalvageBuffering = false

	calls, ok := parseTextToolCalls(buffered)
	if !ok {
		// not actually a tool call; don't lose the content
		if len(resp.Choices) > 0 {
			resp.Choices[0].Delta.SetContentString(buffered)
		}
		return nil
	}

	toolChunk := dto.ChatCompletionsStreamResponse{
		Id:      resp.Id,
		Object:  resp.Object,
		Created: resp.Created,
		Model:   resp.Model,
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					Role:      "assistant",
					ToolCalls: calls,
				},
			},
		},
	}
	if err := helper.ObjectData(c, toolChunk); err != nil {
		return err
	}

	toolReason := "tool_calls"
	for i := range resp.Choices {
		resp.Choices[i].Delta.Content = nil
		resp.Choices[i].FinishReason = &toolReason
	}
	return nil
}
