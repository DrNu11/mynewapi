"""ChatGPT session → CPA auth.json 转换器。

源自 chatgpt2cpa.converter (https://github.com/WTFGEDelphia/chatgpt2cpa),
为了让 upgrade-api 后端能独立完成转换、不依赖前端或 chatgpt2cpa 服务,
代码原样复制到本服务,并把 ConversionResult 内联为本地 dataclass。

只用 Python 标准库 (base64/json/re/datetime),无第三方依赖。
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class ConversionResult:
    """转换结果:CPA auth.json 内容 + 默认文件名 + 校验告警。"""

    filename: str
    auth_data: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


def get_path_value(source: dict[str, Any], *paths: str) -> str:
    for path in paths:
        current: Any = source
        found = True
        for part in path.split("."):
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                found = False
                break
        if found and current is not None:
            value = str(current).strip()
            if value:
                return value
    return ""


def decode_base64_url(text: str) -> str:
    padded = text.replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    return base64.b64decode(padded.encode("ascii")).decode("utf-8")


def jwt_claims(token: str) -> dict[str, Any]:
    try:
        parts = str(token or "").split(".")
        if len(parts) < 2:
            return {}
        claims = json.loads(decode_base64_url(parts[1]))
        return claims if isinstance(claims, dict) else {}
    except Exception:
        return {}


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def iso_from_epoch(value: Any) -> str:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return ""
    if timestamp <= 0:
        return ""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def epoch_from_value(value: Any) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return 0
    if text.isdigit():
        return int(text)
    try:
        normalized = text.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp())
    except ValueError:
        return 0


def bytes_to_base64_url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64url_json(value: dict[str, Any]) -> str:
    body = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return bytes_to_base64_url(body)


def build_synthetic_codex_id_token(
    email: str,
    account_id: str,
    plan_type: str,
    user_id: str,
    expires: str,
) -> str:
    if not account_id:
        return ""
    now = int(datetime.now(timezone.utc).timestamp())
    exp = epoch_from_value(expires) or now + 90 * 24 * 60 * 60
    auth_info: dict[str, Any] = {"chatgpt_account_id": account_id}
    if plan_type:
        auth_info["chatgpt_plan_type"] = plan_type
    if user_id:
        auth_info["chatgpt_user_id"] = user_id
        auth_info["user_id"] = user_id
    payload: dict[str, Any] = {
        "iat": now,
        "exp": exp,
        "https://api.openai.com/auth": auth_info,
    }
    if email:
        payload["email"] = email
    header = {"alg": "none", "typ": "JWT", "cpa_synthetic": True}
    return f"{b64url_json(header)}.{b64url_json(payload)}."


def safe_filename_part(value: str, fallback: str) -> str:
    text = re.sub(r"[^a-z0-9@._+-]+", "-", str(value or fallback).strip().lower())
    text = re.sub(r"^[._-]+|[._-]+$", "", text)
    return (text or fallback or "unknown")[:96]


def normalize_auth_filename(filename: str, auth_data: dict[str, Any]) -> str:
    name = str(filename or "").strip().split("/")[-1].split("\\")[-1]
    if not name:
        email = safe_filename_part(str(auth_data.get("email", "")), "unknown")
        plan_type = safe_filename_part(str(auth_data.get("plan_type", "")), "unknown")
        return f"codex-{email}-{plan_type}-cpa.json"
    stem = re.sub(r"[^A-Za-z0-9@._+-]", "-", name.rsplit(".", 1)[0]).strip("._-")
    if not stem.lower().endswith("-cpa"):
        stem = f"{stem}-cpa"
    if not stem:
        raise ValueError("invalid auth filename")
    return f"{stem}.json"


def extract_session_fields(source: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(source, dict):
        raise ValueError("auth json must be an object")

    access_token = get_path_value(source, "access_token", "accessToken", "token.access_token", "token.accessToken")
    if not access_token:
        raise ValueError("missing access_token/accessToken")

    refresh_token = get_path_value(source, "refresh_token", "refreshToken", "token.refresh_token", "token.refreshToken")
    id_token = get_path_value(source, "id_token", "idToken", "token.id_token", "token.idToken")
    session_token = get_path_value(source, "session_token", "sessionToken")

    access_claims = jwt_claims(access_token)
    id_claims = jwt_claims(id_token)
    auth_info = access_claims.get("https://api.openai.com/auth", {})
    profile = access_claims.get("https://api.openai.com/profile", {})
    id_auth_info = id_claims.get("https://api.openai.com/auth", {})

    email = (
        get_path_value(source, "email", "user.email", "profile.email")
        or str(profile.get("email", "")).strip()
        or str(id_claims.get("email", "")).strip()
    )
    account_id = (
        get_path_value(source, "account_id", "account.id", "chatgpt_account_id")
        or str(auth_info.get("chatgpt_account_id", "")).strip()
        or str(id_auth_info.get("chatgpt_account_id", "")).strip()
    )
    plan_type = (
        get_path_value(source, "plan_type", "planType", "account.planType", "chatgpt_plan_type")
        or str(auth_info.get("chatgpt_plan_type", "")).strip()
        or str(id_auth_info.get("chatgpt_plan_type", "")).strip()
    )
    user_id = (
        get_path_value(source, "user_id", "user.id", "chatgpt_user_id")
        or str(auth_info.get("chatgpt_user_id", "")).strip()
        or str(auth_info.get("user_id", "")).strip()
        or str(id_auth_info.get("chatgpt_user_id", "")).strip()
        or str(id_auth_info.get("user_id", "")).strip()
    )
    expired = (
        get_path_value(source, "expired", "expires", "expire", "expires_at", "expiresAt")
        or iso_from_epoch(access_claims.get("exp"))
    )

    source_account_plan = ""
    if isinstance(source.get("account"), dict):
        source_account_plan = str(source["account"].get("planType", "")).strip()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "id_token": id_token,
        "session_token": session_token,
        "access_claims": access_claims,
        "id_claims": id_claims,
        "auth_info": auth_info,
        "profile": profile,
        "id_auth_info": id_auth_info,
        "email": email,
        "account_id": account_id,
        "plan_type": plan_type,
        "user_id": user_id,
        "expired": expired,
        "disabled": bool(source.get("disabled")),
        "source_last_refresh": get_path_value(source, "last_refresh"),
        "source_id_token_synthetic": bool(source.get("id_token_synthetic")),
        "source_account_plan": source_account_plan,
    }


def build_auth_data_from_fields(fields: dict[str, Any]) -> dict[str, Any]:
    original_id_token = str(fields["id_token"])
    id_token = original_id_token
    synthetic_id_token = bool(fields.get("source_id_token_synthetic"))
    if not id_token and fields["account_id"]:
        id_token = build_synthetic_codex_id_token(
            str(fields["email"]),
            str(fields["account_id"]),
            str(fields["plan_type"]),
            str(fields["user_id"]),
            str(fields["expired"]),
        )
        synthetic_id_token = bool(id_token)

    auth_data: dict[str, Any] = {
        "type": "codex",
        "email": fields["email"],
        "account_id": fields["account_id"],
        "chatgpt_account_id": fields["account_id"],
        "plan_type": fields["plan_type"],
        "chatgpt_plan_type": fields["plan_type"],
        "id_token": id_token,
        "access_token": fields["access_token"],
        "refresh_token": fields["refresh_token"],
        "session_token": fields["session_token"],
        "last_refresh": str(fields.get("source_last_refresh") or iso_now()),
        "expired": fields["expired"],
        "disabled": fields["disabled"],
    }
    if synthetic_id_token:
        auth_data["id_token_synthetic"] = True
    return auth_data


def build_export_warnings(fields: dict[str, Any], auth_data: dict[str, Any], export_format: str) -> list[str]:
    warnings: list[str] = []
    if not fields["refresh_token"]:
        if export_format == "sub2api":
            warnings.append("缺少 refresh_token,sub2api 导入后 access_token 过期时可能无法续期。")
        else:
            warnings.append("缺少 refresh_token,access_token 过期后 CPA 不能自动刷新。")
    if auth_data.get("id_token_synthetic"):
        warnings.append("缺少真实 id_token,已根据 account_id/plan_type 写入 CPA 额度面板可解析的占位 claims;上游认证仍使用 access_token。")
    elif not fields["id_token"]:
        if export_format == "sub2api":
            warnings.append("缺少 id_token,sub2api 导入数据将不包含真实 id_token。")
        else:
            warnings.append("缺少 id_token,CPA 可能无法解析套餐/账号身份信息,但请求会优先使用 access_token。")
    if not fields["account_id"]:
        warnings.append("未识别到 account_id。")
    if not fields["plan_type"]:
        warnings.append("未识别到 plan_type。")
    if not fields["email"]:
        warnings.append("未识别到 email。")
    account_plan = str(fields["source_account_plan"])
    auth_plan = str(fields["auth_info"].get("chatgpt_plan_type", "") or fields["plan_type"])
    if account_plan and auth_plan and account_plan != auth_plan:
        warnings.append(f"account.planType ({account_plan}) 与 access_token claims ({auth_plan}) 不一致。")
    return warnings


def build_codex_auth_json(source: dict[str, Any], requested_filename: str = "") -> ConversionResult:
    """主入口:输入解析后的 dict,输出 CPA auth.json 需要的全部字段 + 文件名 + warnings。"""
    fields = extract_session_fields(source)
    auth_data = build_auth_data_from_fields(fields)
    warnings = build_export_warnings(fields, auth_data, export_format="cpa")

    filename = normalize_auth_filename(requested_filename, auth_data)
    return ConversionResult(filename=filename, auth_data=auth_data, warnings=warnings)
