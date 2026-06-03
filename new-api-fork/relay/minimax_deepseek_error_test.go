package relay

import (
	"errors"
	"net/http"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func TestNormalizeMinimaxDeepSeekMalformedUpstreamErrors(t *testing.T) {
	info := &relaycommon.RelayInfo{
		OriginModelName: "deepseek-v4-pro",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "MiniMax-M2.7",
		},
	}

	cases := []string{
		"invalid character 'é' looking for beginning of value",
		"invalid character ':' after object key:value pair",
		"unknown error 999",
	}

	for _, message := range cases {
		apiErr := types.NewOpenAIError(errors.New(message), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		got := normalizeMinimaxDeepSeekError(info, apiErr).ToOpenAIError()
		if got.Message != "速率达到限制,请稍后重试" {
			t.Fatalf("message %q normalized to %q", message, got.Message)
		}
	}
}
