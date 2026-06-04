package openai

import (
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestParseInvokeBlocks(t *testing.T) {
	// The exact format that leaked to the customer at the 17:23 incident.
	s := "<tool_code>\n<invoke name=\"run_command\">\n<parameter name=\"command\">python \"C:\\skill.py\" --repo x</parameter>\n<parameter name=\"wait\">60</parameter>\n</invoke>\n</tool_code>"
	calls, ok := parseTextToolCalls(s)
	if !ok || len(calls) != 1 {
		t.Fatalf("expected 1 call, got ok=%v n=%d", ok, len(calls))
	}
	if calls[0].Function.Name != "run_command" {
		t.Errorf("name = %q", calls[0].Function.Name)
	}
	args := calls[0].Function.Arguments
	if !strings.Contains(args, "\"command\"") || !strings.Contains(args, "skill.py") {
		t.Errorf("arguments missing command: %s", args)
	}
	// wait=60 should be coerced to a number (no quotes around 60)
	if !strings.Contains(args, "\"wait\":60") {
		t.Errorf("expected numeric wait, got: %s", args)
	}
	if calls[0].Type != "function" || calls[0].ID == "" {
		t.Errorf("bad type/id: %+v", calls[0])
	}
}

func TestParseJSONToolCall(t *testing.T) {
	cases := []string{
		"```json\n{\"tool\":\"run_command\",\"args\":{\"command\":\"ls -R\"}}\n```",
		"{\"name\":\"run_command\",\"arguments\":{\"command\":\"ls -R\"}}",
	}
	for _, s := range cases {
		calls, ok := parseTextToolCalls(s)
		if !ok || len(calls) != 1 || calls[0].Function.Name != "run_command" {
			t.Fatalf("failed for %q: ok=%v calls=%+v", s, ok, calls)
		}
		if !strings.Contains(calls[0].Function.Arguments, "ls -R") {
			t.Errorf("args missing for %q: %s", s, calls[0].Function.Arguments)
		}
	}
}

func TestParseTextToolCalls_NotAToolCall(t *testing.T) {
	for _, s := range []string{
		"Here is the answer to your question.",
		"```json\n{\"result\": 42}\n```",
		"The function f(x) computes <something>.",
	} {
		if _, ok := parseTextToolCalls(s); ok {
			t.Errorf("false positive on: %q", s)
		}
	}
}

func TestHasNativeToolCalls(t *testing.T) {
	if hasNativeToolCalls([]byte("")) || hasNativeToolCalls([]byte("null")) || hasNativeToolCalls([]byte("[]")) {
		t.Error("empty/null/[] should be false")
	}
	if !hasNativeToolCalls([]byte(`[{"id":"call_1"}]`)) {
		t.Error("non-empty should be true")
	}
}

// salvageRun simulates streaming content deltas through the salvage state
// machine and returns (forwardedContent, buffered, buffering).
func salvageRun(deltas []string) (string, bool) {
	ti := &relaycommon.ThinkingContentInfo{}
	var forwarded strings.Builder
	for i, d := range deltas {
		flush := i == len(deltas)-1
		forwarded.WriteString(salvageFeed(ti, d, flush))
	}
	return forwarded.String(), ti.SalvageBuffering
}

func TestSalvageFeed_ProseStreamsThrough(t *testing.T) {
	fwd, buffering := salvageRun([]string{"Hello, ", "how can ", "I help?"})
	if buffering {
		t.Error("prose should not be buffered as tool call")
	}
	if fwd != "Hello, how can I help?" {
		t.Errorf("prose mangled: %q", fwd)
	}
}

func TestSalvageFeed_ToolCallBuffered(t *testing.T) {
	fwd, buffering := salvageRun([]string{"<inv", "oke name=\"f\">", "<parameter name=\"a\">1</parameter></invoke>"})
	if !buffering {
		t.Error("tool call should be buffered")
	}
	if fwd != "" {
		t.Errorf("tool-call content should be withheld, got %q", fwd)
	}
}

func TestSalvageFeed_JSONCodeBlockStreamsThrough(t *testing.T) {
	// A ```json code block that is NOT a tool call must keep streaming (no XML marker).
	_, buffering := salvageRun([]string{"```json\n", "{\"x\":1}\n", "```"})
	if buffering {
		t.Error("plain json code block should not be buffered in streaming mode")
	}
}
