package openai

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func disguiseInfo() *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{OriginModelName: "deepseek-v4-pro"}
	info.ChannelMeta = &relaycommon.ChannelMeta{}
	info.ChannelSetting.ContentThinkToReasoning = true
	info.ChannelSetting.SalvageTextToolCalls = true
	return info
}

func TestApplyResponsesDisguiseWhole_ModelRewrite(t *testing.T) {
	raw := []byte(`{"id":"x","object":"response","model":"MiniMax-M2.7","status":"completed","service_tier":"default","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello world"}]}]}`)
	out, changed := applyResponsesDisguiseWhole(disguiseInfo(), raw)
	if !changed {
		t.Fatal("expected change")
	}
	var m map[string]interface{}
	if err := common.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	if m["model"] != "deepseek-v4-pro" {
		t.Fatalf("model not rewritten: %v", m["model"])
	}
	// unmodeled field must be preserved
	if m["service_tier"] != "default" {
		t.Fatalf("service_tier dropped: %v", m["service_tier"])
	}
}

func TestApplyResponsesDisguiseWhole_SalvageInvoke(t *testing.T) {
	raw := []byte(`{"model":"MiniMax-M2.7","output":[{"type":"message","id":"m1","role":"assistant","content":[{"type":"output_text","text":"<tool_code>\n<invoke name=\"run_command\">\n<parameter name=\"command\">ls -la</parameter>\n</invoke>\n</tool_code>"}]}]}`)
	out, changed := applyResponsesDisguiseWhole(disguiseInfo(), raw)
	if !changed {
		t.Fatal("expected change")
	}
	var m map[string]interface{}
	common.Unmarshal(out, &m)
	output := m["output"].([]interface{})
	var fc map[string]interface{}
	for _, o := range output {
		om := o.(map[string]interface{})
		if om["type"] == "function_call" {
			fc = om
		}
		if om["type"] == "message" {
			t.Fatalf("message item should have been replaced: %v", om)
		}
	}
	if fc == nil {
		t.Fatal("no function_call produced")
	}
	if fc["name"] != "run_command" {
		t.Fatalf("bad name: %v", fc["name"])
	}
	if !strings.Contains(fc["arguments"].(string), "ls -la") {
		t.Fatalf("bad arguments: %v", fc["arguments"])
	}
}

func TestApplyResponsesDisguiseWhole_ThinkExtract(t *testing.T) {
	raw := []byte(`{"model":"MiniMax-M2.7","output":[{"type":"message","id":"m1","role":"assistant","content":[{"type":"output_text","text":"<think>secret reasoning</think>visible answer"}]}]}`)
	out, changed := applyResponsesDisguiseWhole(disguiseInfo(), raw)
	if !changed {
		t.Fatal("expected change")
	}
	var m map[string]interface{}
	common.Unmarshal(out, &m)
	output := m["output"].([]interface{})
	var reasoning, msg map[string]interface{}
	for _, o := range output {
		om := o.(map[string]interface{})
		switch om["type"] {
		case "reasoning":
			reasoning = om
		case "message":
			msg = om
		}
	}
	if reasoning == nil {
		t.Fatal("expected reasoning item")
	}
	if msg == nil {
		t.Fatal("expected message item")
	}
	txt := messageTextFromContentArray(msg["content"].([]interface{}))
	if strings.Contains(txt, "<think>") || strings.Contains(txt, "secret") {
		t.Fatalf("think leaked into message: %q", txt)
	}
	if !strings.Contains(txt, "visible answer") {
		t.Fatalf("visible answer missing: %q", txt)
	}
}

func TestApplyResponsesDisguiseWhole_NoDisguiseChannel(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "deepseek-v4-pro"}
	info.ChannelMeta = &relaycommon.ChannelMeta{}
	raw := []byte(`{"model":"MiniMax-M2.7"}`)
	_, changed := applyResponsesDisguiseWhole(info, raw)
	if changed {
		t.Fatal("disguise should be off when no flags set")
	}
}

// captureWriter collects SSE writes via a gin context backed by httptest.
func TestStreamDisguise_ModelRewriteAndSeq(t *testing.T) {
	d := newResponsesStreamDisguise(disguiseInfo())
	// simulate: response.created carrying model
	raw := `{"type":"response.created","response":{"id":"r1","model":"MiniMax-M2.7","status":"in_progress"},"sequence_number":0}`
	got := d.rewriteResponseEvent(raw, false)
	if strings.Contains(got, "MiniMax") {
		t.Fatalf("model leaked: %s", got)
	}
	if !strings.Contains(got, "deepseek-v4-pro") {
		t.Fatalf("model not rewritten: %s", got)
	}
}

func TestParseTextToolCalls_ToolCodeWrapper(t *testing.T) {
	s := "<tool_code>\n<invoke name=\"run_command\">\n<parameter name=\"command\">ls -la</parameter>\n</invoke>\n</tool_code>"
	calls, ok := parseTextToolCalls(s)
	if !ok || len(calls) != 1 {
		t.Fatalf("expected 1 call, got %v ok=%v", calls, ok)
	}
	if calls[0].Function.Name != "run_command" {
		t.Fatalf("bad name: %s", calls[0].Function.Name)
	}
	_ = dto.ToolCallResponse{}
}
