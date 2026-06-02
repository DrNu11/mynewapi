package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetUserWarnings(c *gin.Context) {
	userId := c.GetInt("id")
	warnings, err := model.GetActiveUserWarnings(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, warnings)
}

func AcknowledgeUserWarning(c *gin.Context) {
	userId := c.GetInt("id")
	warningId, err := strconv.Atoi(c.Param("id"))
	if err != nil || warningId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.AcknowledgeUserWarning(userId, warningId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
