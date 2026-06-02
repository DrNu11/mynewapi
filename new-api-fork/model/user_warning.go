package model

import (
	"time"

	"gorm.io/gorm"
)

type UserWarning struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id" gorm:"index;uniqueIndex:idx_user_warning_source"`
	Source         string `json:"source" gorm:"type:varchar(64);default:'status-page'"`
	SourceKey      string `json:"source_key" gorm:"type:varchar(191);uniqueIndex:idx_user_warning_source"`
	Level          string `json:"level" gorm:"type:varchar(32);default:'warning'"`
	Title          string `json:"title" gorm:"type:varchar(255)"`
	Message        string `json:"message" gorm:"type:text"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`
	ExpiresAt      int64  `json:"expires_at" gorm:"default:0;index"`
	AcknowledgedAt int64  `json:"acknowledged_at" gorm:"default:0;index"`
}

func GetActiveUserWarnings(userId int) ([]*UserWarning, error) {
	now := time.Now().Unix()
	var warnings []*UserWarning
	err := DB.Where(
		"user_id = ? AND acknowledged_at = 0 AND (expires_at = 0 OR expires_at > ?)",
		userId,
		now,
	).Order("id desc").Limit(10).Find(&warnings).Error
	return warnings, err
}

func AcknowledgeUserWarning(userId int, warningId int) error {
	result := DB.Model(&UserWarning{}).
		Where("id = ? AND user_id = ?", warningId, userId).
		Updates(map[string]interface{}{"acknowledged_at": time.Now().Unix()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
