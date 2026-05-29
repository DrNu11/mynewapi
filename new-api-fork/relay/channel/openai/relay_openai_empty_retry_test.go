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
