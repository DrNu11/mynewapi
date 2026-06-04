package openai

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"

	"github.com/gin-gonic/gin"
)

// This file implements the MiniMax->DeepSeek disguise transforms for the OpenAI
// "responses" protocol (used by codex). The chat-completions path is handled in
// relay-openai.go / content_think.go. The transforms here are gated behind the
// ContentThinkToReasoning / SalvageTextToolCalls channel settings and consist of:
//
//   - model-name rewrite: replace the upstream model (e.g. "MiniMax-M2.7") with
//     the client-requested model (info.OriginModelName) so the upstream identity
//     never leaks.
//   - <think> handling: pull inline <think>...</think> out of assistant message
//     text (non-stream: moved into a reasoning output item; stream: stripped).
//   - text tool-call salvage: when the upstream writes a tool call as plain text
//     (<invoke> / <tool_code> / <minimax:tool_call> / ```json), convert it into a
//     structured function_call output item / event sequence.

var (
	seqNumberRe = regexp.MustCompile(`"sequence_number"\s*:\s*-?\d+`)
)

func responsesDisguiseEnabled(info *relaycommon.RelayInfo) bool {
	return info != nil && info.ChannelMeta != nil &&
		(info.ChannelSetting.ContentThinkToReasoning || info.ChannelSetting.SalvageTextToolCalls)
}

// ---------- shared output-array transform (non-stream + stream snapshot) ----------

// messageTextFromContentArray concatenates the text of all output_text parts of
// a responses "message" output item (represented as a generic map).
func messageTextFromContentArray(content []interface{}) string {
	var b strings.Builder
	for _, partAny := range content {
		part, ok := partAny.(map[string]interface{})
		if !ok {
			continue
		}
		if t, _ := part["type"].(string); t == "output_text" || t == "text" {
			if txt, ok := part["text"].(string); ok {
				b.WriteString(txt)
			}
		}
	}
	return b.String()
}

func itemID(item map[string]interface{}, fallback string) string {
	if id, ok := item["id"].(string); ok && id != "" {
		return id
	}
	if fallback != "" {
		return fallback
	}
	return "msg_" + common.GetUUID()
}

func makeReasoningItemMap(baseID, reasoning string) map[string]interface{} {
	return map[string]interface{}{
		"id":      baseID + "_rs",
		"type":    "reasoning",
		"status":  "completed",
		"summary": []interface{}{},
		"content": []interface{}{
			map[string]interface{}{"type": "reasoning_text", "text": reasoning},
		},
	}
}

func makeFunctionCallItemMap(baseID string, idx int, call dto.ToolCallResponse) map[string]interface{} {
	return map[string]interface{}{
		"id":        fmt.Sprintf("%s_fc_%d", baseID, idx),
		"type":      "function_call",
		"status":    "completed",
		"call_id":   call.ID,
		"name":      call.Function.Name,
		"arguments": call.Function.Arguments,
	}
}

// transformResponsesOutputArray applies <think> + salvage transforms to the
// "output" array of a responses response. thinkToReasoningItem controls whether
// extracted <think> text becomes a reasoning output item (true, non-stream) or
// is simply stripped (false, stream snapshot where reasoning already streamed).
func transformResponsesOutputArray(info *relaycommon.RelayInfo, output []interface{}, thinkToReasoningItem bool) ([]interface{}, bool) {
	thinkOn := info.ChannelSetting.ContentThinkToReasoning
	salvageOn := info.ChannelSetting.SalvageTextToolCalls
	if !thinkOn && !salvageOn {
		return output, false
	}
	changed := false
	newOut := make([]interface{}, 0, len(output))
	for _, itAny := range output {
		it, ok := itAny.(map[string]interface{})
		if !ok {
			newOut = append(newOut, itAny)
			continue
		}
		if t, _ := it["type"].(string); t != "message" {
			newOut = append(newOut, itAny)
			continue
		}
		contentArr, _ := it["content"].([]interface{})
		text := messageTextFromContentArray(contentArr)
		base := itemID(it, "")

		if thinkOn && strings.Contains(text, thinkOpenTag) {
			reasoning, rest := extractInlineThinkWhole(text)
			if reasoning != "" {
				if thinkToReasoningItem {
					newOut = append(newOut, makeReasoningItemMap(base, reasoning))
				}
				text = rest
				it["content"] = []interface{}{
					map[string]interface{}{"type": "output_text", "text": rest, "annotations": []interface{}{}},
				}
				changed = true
			}
		}

		if salvageOn {
			if calls, ok := parseTextToolCalls(text); ok {
				for i, call := range calls {
					newOut = append(newOut, makeFunctionCallItemMap(base, i, call))
				}
				changed = true
				continue // drop the original message item
			}
		}
		newOut = append(newOut, it)
	}
	return newOut, changed
}

// applyResponsesDisguiseWhole transforms a complete (non-streamed) responses
// response body. It preserves all upstream fields by operating on a generic map.
func applyResponsesDisguiseWhole(info *relaycommon.RelayInfo, raw []byte) ([]byte, bool) {
	if !responsesDisguiseEnabled(info) {
		return raw, false
	}
	var m map[string]interface{}
	if err := common.Unmarshal(raw, &m); err != nil {
		return raw, false
	}
	changed := false
	if info.OriginModelName != "" {
		if cur, _ := m["model"].(string); cur != "" && cur != info.OriginModelName {
			m["model"] = info.OriginModelName
			changed = true
		}
	}
	if outAny, ok := m["output"].([]interface{}); ok {
		if newOut, c := transformResponsesOutputArray(info, outAny, true); c {
			m["output"] = newOut
			changed = true
		}
	}
	if !changed {
		return raw, false
	}
	b, err := common.Marshal(m)
	if err != nil {
		return raw, false
	}
	return b, true
}

// applyResponsesModelRewriteOnResponseObject rewrites response.model on a stream
// event that embeds a full response object (response.created/in_progress/...).
// It also fixes up response.completed/incomplete output arrays so the final
// snapshot matches what was streamed.
func (d *responsesStreamDisguise) rewriteResponseEvent(raw string, fixupOutput bool) string {
	if d.info.OriginModelName == "" && !fixupOutput {
		return raw
	}
	var m map[string]interface{}
	if err := common.Unmarshal([]byte(raw), &m); err != nil {
		return raw
	}
	resp, ok := m["response"].(map[string]interface{})
	if !ok {
		return raw
	}
	changed := false
	if d.info.OriginModelName != "" {
		if cur, _ := resp["model"].(string); cur != "" && cur != d.info.OriginModelName {
			resp["model"] = d.info.OriginModelName
			changed = true
		}
	}
	if fixupOutput {
		if outAny, ok := resp["output"].([]interface{}); ok {
			if newOut, c := transformResponsesOutputArray(d.info, outAny, false); c {
				resp["output"] = newOut
				changed = true
			}
		}
	}
	if !changed {
		return raw
	}
	b, err := common.Marshal(m)
	if err != nil {
		return raw
	}
	return string(b)
}

// ---------- streaming state machine ----------

type responsesStreamDisguise struct {
	info      *relaycommon.RelayInfo
	thinkOn   bool
	salvageOn bool
	seq       int

	// message-item buffering state
	inMessage      bool
	decided        bool
	buffering      bool // true: holding a tool/think candidate; false: prose passthrough
	msgOutputIndex int
	msgItemID      string
	buf            string
	heldAdded      string
	heldPartAdded  string
}

func newResponsesStreamDisguise(info *relaycommon.RelayInfo) *responsesStreamDisguise {
	return &responsesStreamDisguise{
		info:      info,
		thinkOn:   info.ChannelSetting.ContentThinkToReasoning,
		salvageOn: info.ChannelSetting.SalvageTextToolCalls,
	}
}

// emitPass forwards an upstream event verbatim (apart from renumbering its
// sequence_number so the renumbered stream stays gap-free and monotonic).
func (d *responsesStreamDisguise) emitPass(c *gin.Context, eventType, data string) {
	data = seqNumberRe.ReplaceAllString(data, fmt.Sprintf(`"sequence_number":%d`, d.seq))
	d.seq++
	helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventType}, data)
}

// emitMap emits a synthetic event built from a map, injecting type + sequence_number.
func (d *responsesStreamDisguise) emitMap(c *gin.Context, eventType string, m map[string]interface{}) {
	m["type"] = eventType
	m["sequence_number"] = d.seq
	d.seq++
	b, err := common.Marshal(m)
	if err != nil {
		return
	}
	helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventType}, string(b))
}

func startsWithThink(s string) bool {
	return strings.HasPrefix(strings.TrimLeft(s, " \t\r\n"), thinkOpenTag)
}

// handleEvent is called for every upstream SSE data line. It returns after
// emitting whatever client-facing events are appropriate.
func (d *responsesStreamDisguise) handleEvent(c *gin.Context, sr dto.ResponsesStreamResponse, data string) {
	et := sr.Type

	// Events that carry a full response object: rewrite model (+ fix snapshot).
	if sr.Response != nil {
		fixup := et == "response.completed" || et == "response.incomplete" || et == "response.failed"
		d.emitPass(c, et, d.rewriteResponseEvent(data, fixup))
		return
	}

	switch et {
	case "response.output_item.added":
		if sr.Item != nil && sr.Item.Type == "message" {
			d.inMessage = true
			d.decided = false
			d.buffering = false
			d.buf = ""
			d.heldPartAdded = ""
			if sr.OutputIndex != nil {
				d.msgOutputIndex = *sr.OutputIndex
			}
			d.msgItemID = sr.Item.ID
			d.heldAdded = data
			return // hold
		}
		d.emitPass(c, et, data)
	case "response.content_part.added":
		if d.inMessage && sr.ItemID == d.msgItemID {
			d.heldPartAdded = data
			return // hold
		}
		d.emitPass(c, et, data)
	case "response.output_text.delta":
		if d.inMessage {
			d.buf += sr.Delta
			if !d.decided {
				candidate, undecided := streamToolCandidateState(d.buf)
				if d.thinkOn && startsWithThink(d.buf) {
					candidate, undecided = true, false
				}
				if undecided {
					return
				}
				d.decided = true
				if candidate {
					d.buffering = true
					return
				}
				// prose: release held events + buffered text, then stream live
				d.flushHeldProsePrefix(c)
				if d.buf != "" {
					d.emitTextDelta(c, d.buf)
				}
				return
			}
			if d.buffering {
				return
			}
			d.emitPass(c, et, data) // prose live passthrough
			return
		}
		d.emitPass(c, et, data)
	case "response.output_text.done":
		if d.inMessage {
			if !d.decided {
				d.decided = true
				candidate, _ := streamToolCandidateState(d.buf)
				if d.thinkOn && startsWithThink(d.buf) {
					candidate = true
				}
				if candidate {
					d.buffering = true
				} else {
					d.flushHeldProsePrefix(c)
					if d.buf != "" {
						d.emitTextDelta(c, d.buf)
					}
				}
			}
			if d.buffering {
				return // finalize at item.done
			}
			d.emitPass(c, et, data)
			return
		}
		d.emitPass(c, et, data)
	case "response.content_part.done":
		if d.inMessage && sr.ItemID == d.msgItemID {
			if d.buffering {
				return
			}
			d.emitPass(c, et, data)
			return
		}
		d.emitPass(c, et, data)
	case "response.output_item.done":
		if d.inMessage && sr.Item != nil && sr.Item.Type == "message" {
			d.finalizeMessage(c, sr, data)
			d.inMessage = false
			return
		}
		d.emitPass(c, et, data)
	default:
		d.emitPass(c, et, data)
	}
}

// flushHeldProsePrefix releases the held output_item.added + content_part.added
// events when we decide the message is prose (not a tool call).
func (d *responsesStreamDisguise) flushHeldProsePrefix(c *gin.Context) {
	if d.heldAdded != "" {
		d.emitPass(c, "response.output_item.added", d.heldAdded)
		d.heldAdded = ""
	}
	if d.heldPartAdded != "" {
		d.emitPass(c, "response.content_part.added", d.heldPartAdded)
		d.heldPartAdded = ""
	} else {
		d.emitMap(c, "response.content_part.added", map[string]interface{}{
			"item_id":       d.msgItemID,
			"output_index":  d.msgOutputIndex,
			"content_index": 0,
			"part":          map[string]interface{}{"type": "output_text", "text": "", "annotations": []interface{}{}},
		})
	}
}

func (d *responsesStreamDisguise) emitTextDelta(c *gin.Context, text string) {
	d.emitMap(c, "response.output_text.delta", map[string]interface{}{
		"item_id":       d.msgItemID,
		"output_index":  d.msgOutputIndex,
		"content_index": 0,
		"delta":         text,
	})
}

// finalizeMessage decides what a fully-buffered message item becomes.
func (d *responsesStreamDisguise) finalizeMessage(c *gin.Context, sr dto.ResponsesStreamResponse, data string) {
	if !d.buffering {
		// prose was streamed live; just forward the item.done.
		d.emitPass(c, "response.output_item.done", data)
		return
	}

	text := d.buf
	if text == "" && sr.Item != nil {
		text = messageTextFromOutputItem(sr.Item)
	}
	if d.thinkOn && strings.Contains(text, thinkOpenTag) {
		_, text = extractInlineThinkWhole(text)
	}

	if d.salvageOn {
		if calls, ok := parseTextToolCalls(text); ok {
			d.emitFunctionCalls(c, calls)
			return
		}
	}

	// not a tool call: emit the (think-stripped) text as a normal message.
	d.flushHeldProsePrefix(c)
	if text != "" {
		d.emitTextDelta(c, text)
	}
	d.emitMap(c, "response.output_text.done", map[string]interface{}{
		"item_id":       d.msgItemID,
		"output_index":  d.msgOutputIndex,
		"content_index": 0,
		"text":          text,
	})
	d.emitMap(c, "response.content_part.done", map[string]interface{}{
		"item_id":       d.msgItemID,
		"output_index":  d.msgOutputIndex,
		"content_index": 0,
		"part":          map[string]interface{}{"type": "output_text", "text": text, "annotations": []interface{}{}},
	})
	d.emitMap(c, "response.output_item.done", map[string]interface{}{
		"output_index": d.msgOutputIndex,
		"item": map[string]interface{}{
			"id":      d.msgItemID,
			"type":    "message",
			"status":  "completed",
			"role":    "assistant",
			"content": []interface{}{map[string]interface{}{"type": "output_text", "text": text, "annotations": []interface{}{}}},
		},
	})
}

// emitFunctionCalls turns salvaged text tool calls into the native responses
// function_call streaming event sequence.
func (d *responsesStreamDisguise) emitFunctionCalls(c *gin.Context, calls []dto.ToolCallResponse) {
	base := d.msgItemID
	if base == "" {
		base = "fc_" + common.GetUUID()
	}
	for i, call := range calls {
		fcID := fmt.Sprintf("%s_fc_%d", base, i)
		outIdx := d.msgOutputIndex + i
		args := call.Function.Arguments
		if args == "" {
			args = "{}"
		}
		d.emitMap(c, "response.output_item.added", map[string]interface{}{
			"output_index": outIdx,
			"item": map[string]interface{}{
				"id":        fcID,
				"type":      "function_call",
				"status":    "in_progress",
				"call_id":   call.ID,
				"name":      call.Function.Name,
				"arguments": "",
			},
		})
		d.emitMap(c, "response.function_call_arguments.delta", map[string]interface{}{
			"item_id":      fcID,
			"output_index": outIdx,
			"delta":        args,
		})
		d.emitMap(c, "response.function_call_arguments.done", map[string]interface{}{
			"item_id":      fcID,
			"output_index": outIdx,
			"arguments":    args,
		})
		d.emitMap(c, "response.output_item.done", map[string]interface{}{
			"output_index": outIdx,
			"item": map[string]interface{}{
				"id":        fcID,
				"type":      "function_call",
				"status":    "completed",
				"call_id":   call.ID,
				"name":      call.Function.Name,
				"arguments": args,
			},
		})
	}
}

// messageTextFromOutputItem reads the text of a typed message output item.
func messageTextFromOutputItem(item *dto.ResponsesOutput) string {
	if item == nil {
		return ""
	}
	var b strings.Builder
	for _, part := range item.Content {
		if part.Type == "output_text" || part.Type == "text" {
			b.WriteString(part.Text)
		}
	}
	return b.String()
}
