package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"
)

func MidjourneyErrorWrapper(code int, desc string) *dto.MidjourneyResponse {
	return &dto.MidjourneyResponse{
		Code:        code,
		Description: desc,
	}
}

func MidjourneyErrorWithStatusCodeWrapper(code int, desc string, statusCode int) *dto.MidjourneyResponseWithStatusCode {
	return &dto.MidjourneyResponseWithStatusCode{
		StatusCode: statusCode,
		Response:   *MidjourneyErrorWrapper(code, desc),
	}
}

//// OpenAIErrorWrapper wraps an error into an OpenAIErrorWithStatusCode
//func OpenAIErrorWrapper(err error, code string, statusCode int) *dto.OpenAIErrorWithStatusCode {
//	text := err.Error()
//	lowerText := strings.ToLower(text)
//	if !strings.HasPrefix(lowerText, "get file base64 from url") && !strings.HasPrefix(lowerText, "mime type is not supported") {
//		if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
//			common.SysLog(fmt.Sprintf("error: %s", text))
//			text = "请求上游地址失败"
//		}
//	}
//	openAIError := dto.OpenAIError{
//		Message: text,
//		Type:    "new_api_error",
//		Code:    code,
//	}
//	return &dto.OpenAIErrorWithStatusCode{
//		Error:      openAIError,
//		StatusCode: statusCode,
//	}
//}
//
//func OpenAIErrorWrapperLocal(err error, code string, statusCode int) *dto.OpenAIErrorWithStatusCode {
//	openaiErr := OpenAIErrorWrapper(err, code, statusCode)
//	openaiErr.LocalError = true
//	return openaiErr
//}

func ClaudeErrorWrapper(err error, code string, statusCode int) *dto.ClaudeErrorWithStatusCode {
	text := err.Error()
	lowerText := strings.ToLower(text)
	if !strings.HasPrefix(lowerText, "get file base64 from url") {
		if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
			common.SysLog(fmt.Sprintf("error: %s", text))
			text = "请求上游地址失败"
		}
	}
	claudeError := types.ClaudeError{
		Message: text,
		Type:    "new_api_error",
	}
	return &dto.ClaudeErrorWithStatusCode{
		Error:      claudeError,
		StatusCode: statusCode,
	}
}

func ClaudeErrorWrapperLocal(err error, code string, statusCode int) *dto.ClaudeErrorWithStatusCode {
	claudeErr := ClaudeErrorWrapper(err, code, statusCode)
	claudeErr.LocalError = true
	return claudeErr
}

func RelayErrorHandler(ctx context.Context, resp *http.Response, showBodyWhenFail bool) (newApiErr *types.NewAPIError) {
	newApiErr = types.InitOpenAIError(types.ErrorCodeBadResponseStatusCode, resp.StatusCode)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}
	CloseResponseBodyGracefully(resp)
	var errResponse dto.GeneralErrorResponse
	buildErrWithBody := func(message string) error {
		if message == "" {
			return fmt.Errorf("bad response status code %d, body: %s", resp.StatusCode, string(responseBody))
		}
		return fmt.Errorf("bad response status code %d, message: %s, body: %s", resp.StatusCode, message, string(responseBody))
	}

	err = common.Unmarshal(responseBody, &errResponse)
	if err != nil {
		if showBodyWhenFail {
			newApiErr.Err = buildErrWithBody("")
		} else {
			logger.LogError(ctx, fmt.Sprintf("bad response status code %d, body: %s", resp.StatusCode, string(responseBody)))
			newApiErr.Err = fmt.Errorf("bad response status code %d", resp.StatusCode)
		}
		return
	}

	if common.GetJsonType(errResponse.Error) == "object" {
		// General format error (OpenAI, Anthropic, Gemini, etc.)
		oaiError := errResponse.TryToOpenAIError()
		if oaiError != nil {
			// v24: 防伪装通道上游错误消息透传露馅
			// (MiniMax 2056/2064 等错误会绕过 relay/channel/openai/*.go 的 6 个 sanitize 位点从这里走)
			sanitizeUpstreamErrorMessage(oaiError)
			newApiErr = types.WithOpenAIError(*oaiError, resp.StatusCode)
			if showBodyWhenFail {
				newApiErr.Err = buildErrWithBody(newApiErr.Error())
			}
			return
		}
	}
	newApiErr = types.NewOpenAIError(errors.New(errResponse.ToMessage()), types.ErrorCodeBadResponseStatusCode, resp.StatusCode)
	if showBodyWhenFail {
		newApiErr.Err = buildErrWithBody(newApiErr.Error())
	}
	return
}

func ResetStatusCode(newApiErr *types.NewAPIError, statusCodeMappingStr string) {
	if newApiErr == nil {
		return
	}
	if statusCodeMappingStr == "" || statusCodeMappingStr == "{}" {
		return
	}
	statusCodeMapping := make(map[string]any)
	err := common.Unmarshal([]byte(statusCodeMappingStr), &statusCodeMapping)
	if err != nil {
		return
	}
	if newApiErr.StatusCode == http.StatusOK {
		return
	}
	codeStr := strconv.Itoa(newApiErr.StatusCode)
	if value, ok := statusCodeMapping[codeStr]; ok {
		intCode, ok := parseStatusCodeMappingValue(value)
		if !ok {
			return
		}
		newApiErr.StatusCode = intCode
	}
}

func parseStatusCodeMappingValue(value any) (int, bool) {
	switch v := value.(type) {
	case string:
		if v == "" {
			return 0, false
		}
		statusCode, err := strconv.Atoi(v)
		if err != nil {
			return 0, false
		}
		return statusCode, true
	case float64:
		if v != math.Trunc(v) {
			return 0, false
		}
		return int(v), true
	case int:
		return v, true
	case json.Number:
		statusCode, err := strconv.Atoi(v.String())
		if err != nil {
			return 0, false
		}
		return statusCode, true
	default:
		return 0, false
	}
}

func TaskErrorWrapperLocal(err error, code string, statusCode int) *dto.TaskError {
	openaiErr := TaskErrorWrapper(err, code, statusCode)
	openaiErr.LocalError = true
	return openaiErr
}

func TaskErrorWrapper(err error, code string, statusCode int) *dto.TaskError {
	text := err.Error()
	lowerText := strings.ToLower(text)
	if strings.Contains(lowerText, "post") || strings.Contains(lowerText, "dial") || strings.Contains(lowerText, "http") {
		common.SysLog(fmt.Sprintf("error: %s", text))
		//text = "请求上游地址失败"
		text = common.MaskSensitiveInfo(text)
	}
	//避免暴露内部错误
	taskError := &dto.TaskError{
		Code:       code,
		Message:    text,
		StatusCode: statusCode,
		Error:      err,
	}

	return taskError
}

// TaskErrorFromAPIError 将 PreConsumeBilling 返回的 NewAPIError 转换为 TaskError。
func TaskErrorFromAPIError(apiErr *types.NewAPIError) *dto.TaskError {
	if apiErr == nil {
		return nil
	}
	return &dto.TaskError{
		Code:       string(apiErr.GetErrorCode()),
		Message:    apiErr.Err.Error(),
		StatusCode: apiErr.StatusCode,
		Error:      apiErr.Err,
	}
}

// sanitizeUpstreamErrorMessage 轻量版上游错误消息 sanitize,专门拦截伪装通道的露馅点。
//
// 背景: relay/channel/openai/helper.go 里的 SanitizeUpstreamError 只能拦住 6 个下游适配器里
// 明确调用的位点；但 NewAPI 的通用错误适配入口是 service.RelayErrorHandler,它不会走
// channel-specific 逻辑,所以需要在这里多一道 sanitize。
//
// 设计原则:
//  1. 仅对含 MiniMax 特征指纹关键词的错误生效 — 避免误伤普通 OpenAI / Claude / Gemini 渠道
//  2. case 列表与 relay/channel/openai/helper.go 保持同步 — 以后可重构提取为公共函数
//  3. 默认分支用通用文案兜底,不透传原文
func sanitizeUpstreamErrorMessage(oaiError *types.OpenAIError) {
	if oaiError == nil {
		return
	}
	msg := oaiError.Message
	if !containsUpstreamLeakFingerprint(msg) {
		return
	}

	switch {
	case strings.Contains(msg, "does not support max tokens") || (strings.Contains(msg, "max_tokens") && strings.Contains(msg, "exceed")):
		oaiError.Message = "单次生成长度超出限制,请减小 max_tokens 后重试"
		oaiError.Type = "invalid_request_error"
	case strings.Contains(msg, "(2013)") || strings.Contains(msg, "context window exceeds limit"):
		oaiError.Message = "请求过长,请缩短上下文后重试"
		oaiError.Type = "context_length_exceeded"
	case strings.Contains(msg, "(2003)") || strings.Contains(msg, "invalid params"):
		oaiError.Message = "请求参数错误,请检查输入"
		oaiError.Type = "invalid_request_error"
	case strings.Contains(msg, "(1004)") || strings.Contains(msg, "authentication failed"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	case strings.Contains(msg, "(1002)") || strings.Contains(msg, "rate limit"):
		oaiError.Message = "请求频率过高,请稍后重试"
		oaiError.Type = "rate_limit_exceeded"
	case strings.Contains(msg, "(2064)") || strings.Contains(msg, "请求拥挤") || strings.Contains(msg, "highspeed模型"):
		oaiError.Message = "当前人流拥挤,稍等一下"
		oaiError.Type = "service_unavailable"
	case strings.Contains(msg, "(2056)") || strings.Contains(msg, "usage limit exceeded") || strings.Contains(msg, "Token Plan"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	case strings.Contains(msg, "(1008)") || strings.Contains(msg, "insufficient balance"):
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	default:
		// 含特征但未识别具体错误码: 用兜底文案避免原文透传
		oaiError.Message = "服务暂时不可用,请稍后重试"
		oaiError.Type = "service_unavailable"
	}
}

// containsUpstreamLeakFingerprint 检测错误消息是否含 MiniMax / NewAPI 内部特征指纹。
// 只有指纹命中才走 sanitize 逻辑,避免误伤普通 OpenAI / Claude / Gemini 透传通道。
func containsUpstreamLeakFingerprint(msg string) bool {
	keys := []string{
		// MiniMax 错误码括号
		"(2056)", "(2064)", "(2013)", "(2003)",
		"(1002)", "(1004)", "(1008)",
		// MiniMax 品牌 / 套餐 / 域名
		"MiniMax", "minimaxi", "Token Plan", "highspeed",
		// MiniMax 错误中文文案
		"请求拥挤", "极速版套餐",
		// 上下文超限 / 限额耗尽
		"context window exceeds limit", "usage limit exceeded",
	}
	for _, k := range keys {
		if strings.Contains(msg, k) {
			return true
		}
	}
	return false
}
