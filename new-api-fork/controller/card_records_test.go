package controller

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestBuildCardRecordItemSanitizesErrorDetails(t *testing.T) {
	item := buildCardRecordItem(&model.Log{
		Type:             model.LogTypeError,
		CreatedAt:        123,
		ModelName:        "MiniMax-M3",
		Content:          "provider upstream channel_id base_url 模型映射 should not leak",
		PromptTokens:     11,
		CompletionTokens: 22,
		Quota:            33,
		RequestId:        "202607011234567890",
	})

	if item.Status != "失败" {
		t.Fatalf("unexpected status: %s", item.Status)
	}
	if item.TotalTokens != 33 {
		t.Fatalf("unexpected total tokens: %d", item.TotalTokens)
	}
	if item.RequestIDShort != "202607011234" {
		t.Fatalf("unexpected short request id: %s", item.RequestIDShort)
	}

	payload := strings.ToLower(item.ModelName + " " + item.ErrorSummary)
	for _, forbidden := range []string{"minimax", "provider", "upstream", "channel_id", "base_url", "模型映射"} {
		if strings.Contains(payload, strings.ToLower(forbidden)) {
			t.Fatalf("forbidden text %q leaked in %q", forbidden, payload)
		}
	}
}
