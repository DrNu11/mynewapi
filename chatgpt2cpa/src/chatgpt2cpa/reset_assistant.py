import json
import os
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from fastapi import HTTPException

from .converter import build_codex_auth_json
from .schemas import SessionSummary

SENSITIVE_KEY_PARTS = ("access_token", "refresh_token", "id_token", "session_token", "authorization", "api-key", "key")


class ManagementAPIError(RuntimeError):
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self.payload = payload
        super().__init__(f"management api returned {status_code}")


def management_base_url() -> str:
    return os.getenv("CPA_MANAGEMENT_BASE_URL", "http://127.0.0.1:8317/v0/management").strip().rstrip("/")


def management_key() -> str:
    return os.getenv("CPA_MANAGEMENT_KEY", "").strip()


def management_configured() -> bool:
    return bool(management_base_url() and management_key())


def import_reset_enabled() -> bool:
    flag = os.getenv("CPA_ENABLE_IMPORT_RESET", "").strip().lower()
    return flag in {"1", "true", "yes", "on"} and management_configured()


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in SENSITIVE_KEY_PARTS):
                redacted[key] = "****"
            else:
                redacted[key] = redact_sensitive(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, str) and len(value) > 120 and "." in value:
        return f"{value[:6]}****{value[-4:]}"
    return value


def safe_detail(message: str, payload: Any | None = None) -> dict[str, Any]:
    detail: dict[str, Any] = {"message": message}
    if payload is not None:
        detail["upstream"] = redact_sensitive(payload)
    return detail


def parse_json_text(raw_json: str) -> dict[str, Any]:
    try:
        source = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="输入不是合法 JSON。") from exc
    if not isinstance(source, dict):
        raise HTTPException(status_code=400, detail="session JSON 必须是对象。")
    return source


def summarize_auth(auth_data: dict[str, Any]) -> SessionSummary:
    return SessionSummary(
        email=str(auth_data.get("email", "")),
        account_id=str(auth_data.get("account_id", "")),
        plan_type=str(auth_data.get("plan_type", "")),
        expired=str(auth_data.get("expired", "")),
        has_refresh_token=bool(auth_data.get("refresh_token")),
        has_id_token=bool(auth_data.get("id_token")),
        id_token_synthetic=bool(auth_data.get("id_token_synthetic")),
    )


def parse_session_to_cpa(raw_json: str, filename: str) -> tuple[str, dict[str, Any], SessionSummary, list[str]]:
    source = parse_json_text(raw_json)
    try:
        result = build_codex_auth_json(source, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result.filename, result.auth_data, summarize_auth(result.auth_data), result.warnings


def management_request(method: str, path: str, body: Any | None = None, query: dict[str, str] | None = None) -> Any:
    base_url = management_base_url()
    if not base_url or not management_key():
        raise HTTPException(status_code=503, detail="CPA Management API 未配置。")

    url = f"{base_url}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{parse.urlencode(query)}"

    data = None
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {management_key()}",
    }
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, headers=headers, method=method.upper())
    timeout = float(os.getenv("CPA_MANAGEMENT_TIMEOUT", "15"))

    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw_body = resp.read()
    except error.HTTPError as exc:
        raw_body = exc.read()
        payload = decode_management_body(raw_body)
        raise ManagementAPIError(exc.code, payload) from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail=safe_detail("连接 CPA Management API 失败。")) from exc

    return decode_management_body(raw_body)


def decode_management_body(raw_body: bytes) -> Any:
    if not raw_body:
        return {}
    try:
        return json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw_body.decode("utf-8", errors="replace")


def public_auth_file(entry: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = {
        "id",
        "auth_index",
        "name",
        "provider",
        "label",
        "status",
        "status_message",
        "disabled",
        "unavailable",
        "runtime_only",
        "source",
        "size",
        "modtime",
        "success",
        "failed",
        "email",
        "account_type",
        "account",
        "created_at",
        "updated_at",
        "last_refresh",
    }
    return {key: redact_sensitive(value) for key, value in entry.items() if key in allowed_keys}


def normalize_name(value: Any) -> str:
    return Path(str(value or "").strip()).name.lower()


def find_uploaded_auth_file(files_payload: Any, filename: str, auth_data: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(files_payload, dict):
        return None
    files = files_payload.get("files")
    if not isinstance(files, list):
        return None

    target_filename = normalize_name(filename)
    target_stem = Path(target_filename).stem
    target_email = str(auth_data.get("email", "")).strip().lower()
    target_account = str(auth_data.get("account_id", "")).strip().lower()

    def score(entry: dict[str, Any]) -> int:
        candidates = {
            normalize_name(entry.get("name")),
            normalize_name(entry.get("id")),
            normalize_name(entry.get("path")),
        }
        candidates.update({f"{item}.json" for item in list(candidates) if item and not item.endswith(".json")})
        points = 0
        if target_filename in candidates:
            points += 100
        if target_stem and target_stem in candidates:
            points += 70
        if target_email and str(entry.get("email", "")).strip().lower() == target_email:
            points += 30
        account = str(entry.get("account", "") or entry.get("account_id", "")).strip().lower()
        if target_account and account == target_account:
            points += 30
        if str(entry.get("auth_index", "")).strip():
            points += 10
        return points

    candidates = [entry for entry in files if isinstance(entry, dict)]
    ranked = sorted(candidates, key=score, reverse=True)
    if ranked and score(ranked[0]) > 0:
        return ranked[0]
    return None


def import_cpa_and_reset(filename: str, auth_data: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any] | None, dict[str, Any] | None]:
    try:
        upload_status = management_request("POST", "/auth-files", body=auth_data, query={"name": filename})
        files_payload = management_request("GET", "/auth-files")
    except ManagementAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail=safe_detail(f"CPA Management API 返回 {exc.status_code}。", exc.payload),
        ) from exc

    auth_file = find_uploaded_auth_file(files_payload, filename, auth_data)
    if not auth_file:
        return upload_status if isinstance(upload_status, dict) else {"status": upload_status}, "", None, None

    auth_index = str(auth_file.get("auth_index", "")).strip()
    if not auth_index:
        return upload_status if isinstance(upload_status, dict) else {"status": upload_status}, "", public_auth_file(auth_file), None

    try:
        reset_status = management_request("POST", "/reset-quota", body={"auth_index": auth_index})
    except ManagementAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail=safe_detail(f"CPA reset-quota 返回 {exc.status_code}。", exc.payload),
        ) from exc

    upload = upload_status if isinstance(upload_status, dict) else {"status": upload_status}
    reset = reset_status if isinstance(reset_status, dict) else {"status": reset_status}
    return upload, auth_index, public_auth_file(auth_file), reset
