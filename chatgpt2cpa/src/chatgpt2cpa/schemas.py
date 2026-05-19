from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ExportFormat(str, Enum):
    CPA = "cpa"
    SUB2API = "sub2api"


class ConvertRequest(BaseModel):
    raw_json: str
    filename: str = ""
    export_format: ExportFormat = ExportFormat.CPA


class ExportResponse(BaseModel):
    export_format: ExportFormat
    filename: str
    download_data: dict[str, Any]
    auth_data: dict[str, Any] | None = None
    warnings: list[str] = Field(default_factory=list)


class ConversionResult(BaseModel):
    filename: str
    auth_data: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)


class Sub2ApiConversionResult(BaseModel):
    filename: str
    payload_data: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)


class UpgradeRequest(BaseModel):
    email: str
    order: str
    invite_code: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        text = value.strip().lower()
        if not text or "@" not in text or "." not in text.rsplit("@", 1)[-1]:
            raise ValueError("请输入有效邮箱。")
        if len(text) > 254:
            raise ValueError("邮箱过长。")
        return text

    @field_validator("order")
    @classmethod
    def validate_order(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("请输入 gopay 订单号。")
        if len(text) > 120:
            raise ValueError("gopay 订单号过长。")
        return text

    @field_validator("invite_code")
    @classmethod
    def validate_invite_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip().upper()
        if not text:
            return None
        if len(text) > 32:
            raise ValueError("邀请码过长。")
        return text


class UpgradeResponse(BaseModel):
    ok: bool
    queue_count: int
    invite_count: int
    invite_code: str
    share_url: str
    message: str


class ErrorResponse(BaseModel):
    detail: str
