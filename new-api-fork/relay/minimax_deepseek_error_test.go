package relay

import (
	"errors"
	"net/http"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
)

func TestNormalizeMinimaxDeepSeekSpecificUpstreamErrors(t *testing.T) {
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
		{"invalid character 'é' looking for beginning of value", http.StatusBadGateway, "上游响应格式异常,请稍后重试"},
		{"invalid character ':' after object key:value pair", http.StatusBadGateway, "上游响应格式异常,请稍后重试"},
		{"unknown error 999", http.StatusInternalServerError, "上游返回未知错误999,请稍后重试"},
		{"unknown error, 999 (1000)", http.StatusInternalServerError, "上游返回未知错误999,请稍后重试"},
		{"当前服务集群负载较高，请稍后重试，感谢您的耐心等待。 (2064)", 529, "当前服务集群负载较高,请稍后重试"},
		{"bad gateway", http.StatusBadGateway, "上游服务暂时不可用,请稍后重试"},
		{"too many requests", http.StatusTooManyRequests, "请求频率过高,请稍后重试"},
		{"usage limit exceeded, 5-hour usage limit reached for Token Plan Max (19834000/19834000 used), resets at 2026-06-03T15:00:00+08:00 (2056)", http.StatusInternalServerError, "上游额度或频率达到限制,请稍后重试"},
	}

	for _, tc := range cases {
		apiErr := types.NewOpenAIError(errors.New(tc.message), types.ErrorCodeBadResponseBody, tc.statusCode)
		got := NormalizeMinimaxDeepSeekError(info, apiErr).ToOpenAIError()
		if got.Message != tc.want {
			t.Fatalf("message %q normalized to %q, want %q", tc.message, got.Message, tc.want)
		}
	}
}
