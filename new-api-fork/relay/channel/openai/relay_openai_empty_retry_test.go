package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestShouldRetryEmptyMinimaxDeepSeekResponse(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-v4-pro",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "MiniMax-M2.7",
		},
	}
	resp := &dto.OpenAITextResponse{
		Choices: []dto.OpenAITextResponseChoice{
			{FinishReason: constant.FinishReasonLength},
		},
	}

	if !shouldRetryEmptyMinimaxDeepSeekResponse(info, resp) {
		t.Fatal("expected empty length response to be retryable")
	}
}

func TestShouldRetryEmptyMinimaxDeepSeekResponseSkipsNormalContent(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-v4-pro",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "MiniMax-M2.7",
		},
	}
	message := dto.Message{}
	message.SetStringContent("OK")
	resp := &dto.OpenAITextResponse{
		Choices: []dto.OpenAITextResponseChoice{
			{
				Message:      message,
				FinishReason: constant.FinishReasonLength,
			},
		},
	}

	if shouldRetryEmptyMinimaxDeepSeekResponse(info, resp) {
		t.Fatal("did not expect non-empty response to be retryable")
	}
}

func TestShouldRetryEmptyMinimaxDeepSeekResponseSkipsOtherUpstreams(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-v4-pro",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "DeepSeek-V4-Pro",
		},
	}
	resp := &dto.OpenAITextResponse{
		Choices: []dto.OpenAITextResponseChoice{
			{FinishReason: constant.FinishReasonLength},
		},
	}

	if shouldRetryEmptyMinimaxDeepSeekResponse(info, resp) {
		t.Fatal("did not expect non-MiniMax upstream to be retryable")
	}
}

func TestMaskMinimaxDeepSeekSpecificUpstreamErrors(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-v4-pro",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "MiniMax-M2.7",
		},
	}

	cases := []struct {
		message    string
		statusCode int
		want       string
	}{
		{"invalid character 'é' looking for beginning of value", 502, "上游响应格式异常,请稍后重试"},
		{"invalid character ':' after object key:value pair", 502, "上游响应格式异常,请稍后重试"},
		{"unknown error 999", 500, "上游返回未知错误999,请稍后重试"},
		{"unknown error, 999 (1000)", 500, "上游返回未知错误999,请稍后重试"},
		{"当前服务集群负载较高，请稍后重试，感谢您的耐心等待。 (2064)", 529, "当前服务集群负载较高,请稍后重试"},
		{"bad gateway", 502, "上游服务暂时不可用,请稍后重试"},
		{"too many requests", 429, "请求频率过高,请稍后重试"},
		{"usage limit exceeded, 5-hour usage limit reached for Token Plan Max (19834000/19834000 used), resets at 2026-06-03T15:00:00+08:00 (2056)", 500, "上游额度或频率达到限制,请稍后重试"},
	}

	for _, tc := range cases {
		got := maskMinimaxDeepSeekError(info, tc.message, tc.statusCode)
		if got == nil {
			t.Fatalf("message %q was not masked", tc.message)
		}
		if got.ToOpenAIError().Message != tc.want {
			t.Fatalf("message %q normalized to %q, want %q", tc.message, got.ToOpenAIError().Message, tc.want)
		}
	}
}
