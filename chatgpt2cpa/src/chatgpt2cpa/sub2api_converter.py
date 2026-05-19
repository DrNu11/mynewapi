import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .converter import (
    build_auth_data_from_fields,
    build_export_warnings,
    extract_session_fields,
    safe_filename_part,
)
from .schemas import Sub2ApiConversionResult


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_records(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    return [data]


def choose_name(
    credentials: dict[str, Any],
    source_name: str,
    index: int,
    name_source: str,
    name_prefix: str,
) -> str:
    if name_source == "index":
        return f"{name_prefix}-{index:03d}"

    if name_source == "email":
        email = str(credentials.get("email", "")).strip()
        if email:
            return email
        account_id = str(credentials.get("account_id", "")).strip()
        if account_id:
            return account_id

    return source_name or f"{name_prefix}-{index:03d}"


def dedupe_name(name: str, used: dict[str, int]) -> str:
    current = used.get(name, 0) + 1
    used[name] = current
    if current == 1:
        return name
    return f"{name}-{current}"


def normalize_sub2api_filename(filename: str, auth_data: dict[str, Any] | None = None) -> str:
    name = str(filename or "").strip().split("/")[-1].split("\\")[-1]
    if not name:
        data = auth_data or {}
        email = safe_filename_part(str(data.get("email", "")), "unknown")
        plan_type = safe_filename_part(str(data.get("plan_type", "")), "unknown")
        return f"codex-{email}-{plan_type}-sub2api.json"
    stem = re.sub(r"[^A-Za-z0-9@._+-]", "-", name.rsplit(".", 1)[0]).strip("._-")
    if not stem.lower().endswith("-sub2api"):
        stem = f"{stem}-sub2api"
    if not stem:
        raise ValueError("invalid sub2api filename")
    return f"{stem}.json"


def build_sub2api_payload_from_records(
    records: list[tuple[Any, str]],
    *,
    platform: str,
    account_type: str,
    concurrency: int,
    priority: int,
    name_source: str,
    name_prefix: str,
) -> dict[str, Any]:
    accounts: list[dict[str, Any]] = []
    used_names: dict[str, int] = {}
    counter = 1

    for raw_record, source_name in records:
        for item in normalize_records(raw_record):
            credentials = item if isinstance(item, dict) else {"raw_value": item}
            base_name = choose_name(credentials, source_name, counter, name_source, name_prefix)
            name = dedupe_name(base_name, used_names)
            accounts.append(
                {
                    "name": name,
                    "platform": platform,
                    "type": account_type,
                    "credentials": credentials,
                    "concurrency": concurrency,
                    "priority": priority,
                }
            )
            counter += 1

    return {
        "type": "sub2api-data",
        "version": 1,
        "exported_at": iso_now(),
        "proxies": [],
        "accounts": accounts,
    }


def build_sub2api_json(source: dict[str, Any], requested_filename: str) -> Sub2ApiConversionResult:
    fields = extract_session_fields(source)
    credentials = build_auth_data_from_fields(fields)
    warnings = build_export_warnings(fields, credentials, export_format="sub2api")
    source_name = Path(str(requested_filename or "").strip() or "sub2api_accounts_import").stem or "sub2api_accounts_import"
    payload_data = build_sub2api_payload_from_records(
        [(credentials, source_name)],
        platform="openai",
        account_type="oauth",
        concurrency=3,
        priority=50,
        name_source="email",
        name_prefix="acc",
    )
    return Sub2ApiConversionResult(
        filename=normalize_sub2api_filename(requested_filename, credentials),
        payload_data=payload_data,
        warnings=warnings,
    )
