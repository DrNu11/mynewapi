"""请求 / 响应模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


# ------- 业务：升级表单 -------

class UpgradeSubmitIn(BaseModel):
    email: EmailStr
    order: str = Field(min_length=3, max_length=128)
    inviteCode: str = Field(default="", max_length=32)
    # 用户从 https://chatgpt.com/api/auth/session 复制粘贴的 session JSON 原文
    # 后端原样存到磁盘,不在数据库存(可能很大)
    sessionJson: str = Field(default="", max_length=200_000)
    # 前端用 chatgpt2cpa 的 /api/convert 转出来的 CPA auth.json (可选,优先用此值)
    authJson: dict[str, Any] | None = None


class UpgradeSubmitOut(BaseModel):
    ok: bool = True
    queueCount: int
    ownInviteCode: str
    inviteAccepted: bool
    inviteCount: int
    # 已邀请人数 — 等同于"可消耗的免单机会余额"(MVP 由老板手动核销,不自动扣减)
    inviteCredits: int
    sessionAccepted: bool
    sessionPlan: str
    message: str


class UpgradeStatsOut(BaseModel):
    queueCount: int
    ownInviteCount: int = 0


# ------- 业务：管理员看订单 -------

class OrderItem(BaseModel):
    id: int
    email: str
    order_no: str
    invite_code: str
    own_invite_code: str
    ip: str
    status: str
    has_session: bool = False
    has_auth: bool = False
    session_email: str = ""
    session_plan: str = ""
    note: str = ""
    created_at: int


class OrdersListOut(BaseModel):
    total: int
    items: list[OrderItem]


# 管理员标记订单状态/备注
class OrderStatusIn(BaseModel):
    status: Literal["queued", "processing", "done", "refunded"]
    note: str = Field(default="", max_length=500)


# 去重:同邮箱的一组订单
class DedupGroup(BaseModel):
    email: str
    kept_id: int                # 保留的订单 id(最新的)
    kept_has_auth: bool         # 保留的那条是否已转好 auth.json
    removed_ids: list[int]      # 被合并掉(改 refunded)的订单 id 列表
    total: int                  # 该邮箱原本一共多少条


class DedupResult(BaseModel):
    dry_run: bool
    scanned_emails: int         # 扫描了多少个不同的提交人邮箱
    duplicate_emails: int       # 其中有重复的有几个
    groups: list[DedupGroup]
    merged_total: int           # 这次共合并了多少订单(=sum(len(removed_ids)))


# ------- OTA -------

OtaJobStatus = Literal["pending", "running", "success", "failed", "rolled_back"]


class OtaStatusOut(BaseModel):
    service: str
    serviceActive: bool
    currentBranch: str
    currentCommit: str
    currentCommitMessage: str
    healthUrl: str
    healthOk: bool


class OtaDeployGitIn(BaseModel):
    ref: str = Field(min_length=1, max_length=200, description="branch / tag / commit sha")
    runPipInstall: bool = True
    note: str = Field(default="", max_length=200)


class OtaJobOut(BaseModel):
    jobId: str
    kind: str
    status: OtaJobStatus
    startedAt: int
    finishedAt: int | None = None


class OtaBackupItem(BaseModel):
    id: str
    commitBefore: str
    note: str
    sizeBytes: int
    createdAt: int


class OtaRollbackIn(BaseModel):
    backupId: str
