from chatgpt2cpa.converter import (
    build_codex_auth_json,
    extract_session_fields,
    normalize_auth_filename,
)
from tests.helpers import sample_session_payload


def test_extract_session_fields_resolves_nested_session_values() -> None:
    source = sample_session_payload(include_id_token=True)

    fields = extract_session_fields(source)

    assert fields["email"] == "demo@example.com"
    assert fields["account_id"] == "acc_1234567890"
    assert fields["plan_type"] == "plus"
    assert fields["user_id"] == "user_123"
    assert fields["access_token"] == source["access_token"]
    assert fields["refresh_token"] == "refresh-demo"


def test_build_codex_auth_json_uses_real_id_token() -> None:
    source = sample_session_payload(include_id_token=True)
    result = build_codex_auth_json(source, "demo-auth")

    assert result.filename == "demo-auth-cpa.json"
    assert result.auth_data["type"] == "codex"
    assert result.auth_data["email"] == "demo@example.com"
    assert result.auth_data["account_id"] == "acc_1234567890"
    assert result.auth_data["plan_type"] == "plus"
    assert result.auth_data["id_token"] == source["id_token"]
    assert result.auth_data["access_token"] == source["access_token"]
    assert result.warnings == []


def test_build_codex_auth_json_synthesizes_missing_id_token() -> None:
    source = sample_session_payload(include_id_token=False)
    result = build_codex_auth_json(source, "")

    assert result.filename == "codex-demo@example.com-plus-cpa.json"
    assert result.auth_data["id_token"].count(".") == 2
    assert result.auth_data["id_token_synthetic"] is True
    assert "缺少真实 id_token" in result.warnings[0]


def test_build_codex_auth_json_requires_access_token() -> None:
    source = sample_session_payload(include_id_token=False)
    source.pop("access_token")

    try:
        build_codex_auth_json(source, "")
    except ValueError as exc:
        assert str(exc) == "missing access_token/accessToken"
    else:
        raise AssertionError("expected ValueError")


def test_normalize_auth_filename_appends_json_suffix() -> None:
    auth_data = {"email": "demo@example.com", "account_id": "acc_1234567890"}
    assert normalize_auth_filename("custom-name", auth_data) == "custom-name-cpa.json"
