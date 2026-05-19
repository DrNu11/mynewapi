from chatgpt2cpa.converter import build_codex_auth_json
from chatgpt2cpa.sub2api_converter import (
    build_sub2api_json,
    build_sub2api_payload_from_records,
    normalize_sub2api_filename,
)
from tests.helpers import make_unsigned_jwt, sample_session_payload


def test_build_sub2api_json_builds_single_account_from_session() -> None:
    source = sample_session_payload(include_id_token=False)
    cpa = build_codex_auth_json(source, "").auth_data

    result = build_sub2api_json(source, "")

    account = result.payload_data["accounts"][0]
    assert result.filename == "codex-demo@example.com-plus-sub2api.json"
    assert result.payload_data["type"] == "sub2api-data"
    assert result.payload_data["version"] == 1
    assert account["name"] == cpa["email"]
    assert account["platform"] == "openai"
    assert account["type"] == "oauth"
    assert account["concurrency"] == 3
    assert account["priority"] == 50
    assert account["credentials"] == cpa


def test_build_sub2api_json_preserves_existing_cpa_payload_when_input_is_cpa_json() -> None:
    session_source = sample_session_payload(include_id_token=False)
    cpa_source = build_codex_auth_json(session_source, "").auth_data

    result = build_sub2api_json(cpa_source, "")

    assert result.filename == "codex-demo@example.com-plus-sub2api.json"
    assert result.payload_data["accounts"][0]["credentials"] == cpa_source


def test_build_sub2api_json_uses_filename_when_identity_missing() -> None:
    source = {"access_token": make_unsigned_jwt({"exp": 1893456000})}

    result = build_sub2api_json(source, "manual-batch")

    assert result.payload_data["accounts"][0]["name"] == "manual-batch"


def test_build_sub2api_payload_from_records_dedupes_email_names() -> None:
    first = {"email": "demo@example.com", "account_id": "acc_1"}
    second = {"email": "demo@example.com", "account_id": "acc_2"}

    payload = build_sub2api_payload_from_records(
        [(first, "token_a"), (second, "token_b")],
        platform="openai",
        account_type="oauth",
        concurrency=3,
        priority=50,
        name_source="email",
        name_prefix="acc",
    )

    assert [account["name"] for account in payload["accounts"]] == [
        "demo@example.com",
        "demo@example.com-2",
    ]


def test_build_sub2api_payload_from_records_falls_back_to_source_name() -> None:
    payload = build_sub2api_payload_from_records(
        [({"access_token": "token-only"}, "manual-upload")],
        platform="openai",
        account_type="oauth",
        concurrency=3,
        priority=50,
        name_source="email",
        name_prefix="acc",
    )

    assert payload["accounts"][0]["name"] == "manual-upload"


def test_build_codex_auth_json_still_uses_shared_session_fields() -> None:
    source = sample_session_payload(include_id_token=True)

    result = build_codex_auth_json(source, "demo-auth")

    assert result.filename == "demo-auth-cpa.json"
    assert result.auth_data["email"] == "demo@example.com"
    assert result.auth_data["account_id"] == "acc_1234567890"


def test_normalize_sub2api_filename_tags_manual_name_with_format_suffix() -> None:
    assert normalize_sub2api_filename("export") == "export-sub2api.json"
