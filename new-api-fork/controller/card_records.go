package controller

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

const cardRecordsMaxErrorSummaryLen = 160

type cardRecordsQueryRequest struct {
	CardCode string `json:"card_code"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}

type cardRecordsLookupResponse struct {
	Success bool   `json:"success"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Card    struct {
		CodeMasked    string `json:"code_masked"`
		Category      string `json:"category"`
		Plan          string `json:"plan"`
		PlanDays      int    `json:"plan_days"`
		Status        string `json:"status"`
		ActivatedAt   int64  `json:"activated_at"`
		ExpiresAt     int64  `json:"expires_at"`
		NewAPITokenID int    `json:"newapi_token_id"`
		NewAPIUserID  int    `json:"newapi_user_id"`
	} `json:"card"`
}

type cardRecordItem struct {
	CreatedAt        int64  `json:"created_at"`
	ModelName        string `json:"model_name"`
	Status           string `json:"status"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	TotalTokens      int    `json:"total_tokens"`
	Quota            int    `json:"quota"`
	RequestIDShort   string `json:"request_id_short"`
	ErrorSummary     string `json:"error_summary"`
}

type cardRecordsCardMeta struct {
	CodeMasked  string `json:"code_masked"`
	Category    string `json:"category"`
	Plan        string `json:"plan"`
	PlanDays    int    `json:"plan_days"`
	Status      string `json:"status"`
	ActivatedAt int64  `json:"activated_at"`
	ExpiresAt   int64  `json:"expires_at"`
}

func QueryCardRecords(c *gin.Context) {
	var req cardRecordsQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.CardCode = strings.TrimSpace(req.CardCode)
	if req.CardCode == "" {
		common.ApiErrorMsg(c, "请输入卡密")
		return
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = common.ItemsPerPage
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}

	lookup, err := lookupCardRecord(req.CardCode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !lookup.Success {
		common.ApiErrorMsg(c, normalizeCardLookupMessage(lookup.Code, lookup.Message))
		return
	}
	if lookup.Card.Plan != "7d" && lookup.Card.Plan != "30d" {
		common.ApiErrorMsg(c, "当前仅支持周卡/月卡查看调用记录")
		return
	}
	if lookup.Card.NewAPIUserID <= 0 {
		common.ApiErrorMsg(c, "该卡密不属于当前用户")
		return
	}

	userId := c.GetInt("id")
	role := c.GetInt("role")
	if role < common.RoleAdminUser && lookup.Card.NewAPIUserID != userId {
		common.ApiErrorMsg(c, "该卡密不属于当前用户")
		return
	}

	pageInfo := &common.PageInfo{Page: req.Page, PageSize: req.PageSize}
	logs, total, err := model.GetLogsByTokenId(lookup.Card.NewAPITokenID, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]cardRecordItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, buildCardRecordItem(log))
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)

	common.ApiSuccess(c, gin.H{
		"card": cardRecordsCardMeta{
			CodeMasked:  lookup.Card.CodeMasked,
			Category:    lookup.Card.Category,
			Plan:        lookup.Card.Plan,
			PlanDays:    lookup.Card.PlanDays,
			Status:      lookup.Card.Status,
			ActivatedAt: lookup.Card.ActivatedAt,
			ExpiresAt:   lookup.Card.ExpiresAt,
		},
		"records": pageInfo,
	})
}

func lookupCardRecord(cardCode string) (*cardRecordsLookupResponse, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("NASSA_CARDS_INTERNAL_URL")), "/")
	secret := strings.TrimSpace(os.Getenv("NASSA_INTERNAL_API_SECRET"))
	if baseURL == "" || secret == "" {
		return nil, errors.New("卡密记录服务未配置")
	}
	body, err := common.Marshal(map[string]string{"card_code": cardCode})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/api/internal/card-records/lookup", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+secret)

	client := service.GetHttpClient()
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, errors.New("卡密记录服务暂不可用")
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, errors.New("卡密记录服务响应读取失败")
	}
	var lookup cardRecordsLookupResponse
	if err := common.Unmarshal(respBody, &lookup); err != nil {
		return nil, errors.New("卡密记录服务响应格式错误")
	}
	return &lookup, nil
}

func normalizeCardLookupMessage(code string, message string) string {
	switch code {
	case "not_found":
		return "卡密不存在"
	case "unsupported_plan":
		return "当前仅支持周卡/月卡查看调用记录"
	case "unauthorized", "internal_secret_missing":
		return "卡密记录服务未配置"
	}
	if strings.TrimSpace(message) == "" {
		return "查询失败"
	}
	return message
}

func buildCardRecordItem(log *model.Log) cardRecordItem {
	item := cardRecordItem{
		CreatedAt:        log.CreatedAt,
		ModelName:        sanitizeCardRecordText(log.ModelName, 80),
		Status:           cardRecordStatus(log.Type),
		PromptTokens:     log.PromptTokens,
		CompletionTokens: log.CompletionTokens,
		TotalTokens:      log.PromptTokens + log.CompletionTokens,
		Quota:            log.Quota,
		RequestIDShort:   shortRequestID(log.RequestId),
	}
	if log.Type == model.LogTypeError {
		item.ErrorSummary = sanitizeCardRecordText(log.Content, cardRecordsMaxErrorSummaryLen)
	}
	return item
}

func cardRecordStatus(logType int) string {
	switch logType {
	case model.LogTypeConsume:
		return "成功"
	case model.LogTypeError:
		return "失败"
	case model.LogTypeRefund:
		return "退款"
	default:
		return "其他"
	}
}

func shortRequestID(requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return "-"
	}
	if len(requestID) <= 12 {
		return requestID
	}
	return requestID[:12]
}

func sanitizeCardRecordText(value string, maxLen int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		"MiniMax-M3", "[hidden]",
		"minimax-m3", "[hidden]",
		"MiniMax", "[hidden]",
		"minimax", "[hidden]",
		"channel_id", "[hidden]",
		"channel", "[hidden]",
		"provider", "[hidden]",
		"upstream", "[hidden]",
		"base_url", "[hidden]",
		"模型映射", "[hidden]",
	)
	value = replacer.Replace(value)
	value = strings.Join(strings.Fields(value), " ")
	if maxLen > 0 && len([]rune(value)) > maxLen {
		runes := []rune(value)
		return fmt.Sprintf("%s…", string(runes[:maxLen]))
	}
	return value
}
