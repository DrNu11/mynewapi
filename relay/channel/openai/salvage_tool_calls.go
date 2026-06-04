package openai

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// Some upstream models, when they cannot use native function calling, emit the
// tool call as plain text instead of a structured tool_calls field. This file
// detects those text encodings and converts them back into structured
// tool_calls. It is gated behind the SalvageTextToolCalls channel setting.

var (
	invokeBlockRe = regexp.MustCompile(`(?s)<invoke\s+name="([^"]+)"\s*>(.*?)</invoke>`)
	parameterRe   = regexp.MustCompile(`(?s)<parameter\s+name="([^"]+)"\s*>(.*?)</parameter>`)
	jsonFenceRe   = regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*?\\})\\s*```")
	numberRe      = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
)

// xmlToolMarkers are the unambiguous leading markers that indicate the assistant
// turn is a text-encoded tool call (used for the streaming buffer decision).
var xmlToolMarkers = []string{"<invoke", "<minimax:tool_call", "<tool_call", "<tool_code", "<function_calls"}

// hasNativeToolCalls reports whether the raw tool_calls field already contains
// structured tool calls (so we should not attempt to salvage from text).
func hasNativeToolCalls(raw []byte) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null" && s != "[]"
}

func coerceParamValue(v string) interface{} {
	t := strings.TrimSpace(v)
	switch t {
	case "true":
		return true
	case "false":
		return false
	case "null":
		return nil
	}
	if numberRe.MatchString(t) {
		var n any
		if err := common.UnmarshalJsonStr(t, &n); err == nil {
			return n
		}
	}
	return v
}

func newSalvagedToolCall(name, arguments string, index int) dto.ToolCallResponse {
	return dto.ToolCallResponse{
		Index: common.GetPointer(index),
		ID:    fmt.Sprintf("call_%s", common.GetUUID()),
		Type:  "function",
		Function: dto.FunctionResponse{
			Name:      name,
			Arguments: arguments,
		},
	}
}

// parseInvokeBlocks parses the XML <invoke name=".."><parameter ..>..</parameter></invoke>
// encoding (used by MiniMax / antml style tool calls).
func parseInvokeBlocks(s string) ([]dto.ToolCallResponse, bool) {
	matches := invokeBlockRe.FindAllStringSubmatch(s, -1)
	if len(matches) == 0 {
		return nil, false
	}
	calls := make([]dto.ToolCallResponse, 0, len(matches))
	for i, m := range matches {
		name := strings.TrimSpace(m[1])
		if name == "" {
			continue
		}
		args := map[string]interface{}{}
		for _, p := range parameterRe.FindAllStringSubmatch(m[2], -1) {
			args[strings.TrimSpace(p[1])] = coerceParamValue(p[2])
		}
		argBytes, err := common.Marshal(args)
		if err != nil {
			return nil, false
		}
		calls = append(calls, newSalvagedToolCall(name, string(argBytes), i))
	}
	if len(calls) == 0 {
		return nil, false
	}
	return calls, true
}

// parseJSONToolCall parses a JSON-encoded tool call such as
// {"tool":"run_command","args":{...}} or {"name":"..","arguments":{..}},
// optionally wrapped in a ```json fenced block.
func parseJSONToolCall(s string) ([]dto.ToolCallResponse, bool) {
	candidate := strings.TrimSpace(s)
	if m := jsonFenceRe.FindStringSubmatch(candidate); m != nil {
		candidate = m[1]
	}
	if !strings.HasPrefix(candidate, "{") {
		return nil, false
	}
	var obj map[string]interface{}
	if err := common.UnmarshalJsonStr(candidate, &obj); err != nil {
		return nil, false
	}
	name := ""
	for _, k := range []string{"tool", "name", "function", "tool_name"} {
		if v, ok := obj[k]; ok {
			if str, ok := v.(string); ok && str != "" {
				name = str
				break
			}
		}
	}
	if name == "" {
		return nil, false
	}
	var arguments string
	for _, k := range []string{"args", "arguments", "parameters", "input"} {
		if v, ok := obj[k]; ok {
			switch val := v.(type) {
			case string:
				arguments = val
			default:
				if b, err := common.Marshal(val); err == nil {
					arguments = string(b)
				}
			}
			break
		}
	}
	if arguments == "" {
		arguments = "{}"
	}
	return []dto.ToolCallResponse{newSalvagedToolCall(name, arguments, 0)}, true
}

// parseTextToolCalls attempts to extract structured tool calls from a full text
// assistant turn. Returns the calls and true if anything was salvaged.
func parseTextToolCalls(s string) ([]dto.ToolCallResponse, bool) {
	if calls, ok := parseInvokeBlocks(s); ok {
		return calls, true
	}
	if calls, ok := parseJSONToolCall(s); ok {
		return calls, true
	}
	return nil, false
}

// streamToolCandidateState classifies whether the accumulated content (after any
// leading whitespace) is the start of an XML text tool call. undecided=true means
// we have only whitespace / a partial marker prefix so far and need more data.
func streamToolCandidateState(acc string) (candidate bool, undecided bool) {
	trimmed := strings.TrimLeft(acc, " \t\r\n")
	if trimmed == "" {
		return false, true
	}
	for _, marker := range xmlToolMarkers {
		if strings.HasPrefix(trimmed, marker) {
			return true, false
		}
		// a marker that is only partially received so far -> wait for more
		if len(trimmed) < len(marker) && strings.HasPrefix(marker, trimmed) {
			return false, true
		}
	}
	return false, false
}
