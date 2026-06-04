package openai

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// feed runs a sequence of content deltas through splitInlineThink and returns
// the accumulated reasoning and content. The final delta is flushed.
func feed(deltas []string) (string, string) {
	ti := &relaycommon.ThinkingContentInfo{}
	var reasoning, content string
	for i, d := range deltas {
		flush := i == len(deltas)-1
		r, c := splitInlineThink(ti, d, flush)
		reasoning += r
		content += c
	}
	return reasoning, content
}

func TestSplitInlineThink(t *testing.T) {
	cases := []struct {
		name      string
		deltas    []string
		reasoning string
		content   string
	}{
		{"separate_tag_deltas", []string{"<think>", "reasoning here", "</think>", "the answer"}, "reasoning here", "the answer"},
		{"split_open_tag", []string{"<thi", "nk>reason", "</think>ans"}, "reason", "ans"},
		{"split_close_tag", []string{"<think>r", "</thi", "nk>a"}, "r", "a"},
		{"no_think", []string{"hello", " world"}, "", "hello world"},
		{"inline_one_delta", []string{"pre<think>r</think>post"}, "r", "prepost"},
		{"lone_lt_not_tag", []string{"a < b"}, "", "a < b"},
		{"content_then_think", []string{"answer first <think>then reason</think>"}, "then reason", "answer first "},
		{"multiline_reason", []string{"<think>line1\nline2\n</think>\n\n2 + 2 = 4."}, "line1\nline2\n", "\n\n2 + 2 = 4."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, c := feed(tc.deltas)
			if r != tc.reasoning {
				t.Errorf("reasoning = %q, want %q", r, tc.reasoning)
			}
			if c != tc.content {
				t.Errorf("content = %q, want %q", c, tc.content)
			}
		})
	}
}

func TestExtractInlineThinkWhole(t *testing.T) {
	r, c := extractInlineThinkWhole("<think>reasoning</think>\n\nfinal answer")
	if r != "reasoning" || c != "\n\nfinal answer" {
		t.Errorf("got reasoning=%q content=%q", r, c)
	}
	r, c = extractInlineThinkWhole("plain answer, no think")
	if r != "" || c != "plain answer, no think" {
		t.Errorf("got reasoning=%q content=%q", r, c)
	}
}
