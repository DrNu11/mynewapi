import json

from fastapi.testclient import TestClient

from chatgpt2cpa.app import app
from tests.helpers import sample_session_payload


def test_convert_endpoint_defaults_to_cpa_export() -> None:
    client = TestClient(app)
    payload = sample_session_payload(include_id_token=True)

    response = client.post(
        "/api/convert",
        json={"raw_json": json.dumps(payload), "filename": "my-auth"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["export_format"] == "cpa"
    assert body["filename"] == "my-auth-cpa.json"
    assert body["download_data"]["type"] == "codex"
    assert body["auth_data"]["type"] == "codex"
    assert body["auth_data"]["email"] == "demo@example.com"
    assert body["download_data"]["access_token"] == payload["access_token"]
    assert body["warnings"] == []


def test_convert_endpoint_returns_sub2api_payload_when_requested() -> None:
    client = TestClient(app)
    payload = sample_session_payload(include_id_token=False)

    response = client.post(
        "/api/convert",
        json={
            "raw_json": json.dumps(payload),
            "filename": "",
            "export_format": "sub2api",
        },
    )

    assert response.status_code == 200
    body = response.json()
    account = body["download_data"]["accounts"][0]
    credentials = account["credentials"]
    assert body["export_format"] == "sub2api"
    assert body["filename"] == "codex-demo@example.com-plus-sub2api.json"
    assert body["download_data"]["type"] == "sub2api-data"
    assert account["name"] == "demo@example.com"
    assert credentials["type"] == "codex"
    assert credentials["chatgpt_account_id"] == "acc_1234567890"
    assert credentials["chatgpt_plan_type"] == "plus"
    assert credentials["id_token_synthetic"] is True
    assert "source_format" not in credentials
    assert body["auth_data"] is None


def test_convert_endpoint_returns_sub2api_warnings_when_tokens_missing() -> None:
    client = TestClient(app)
    payload = sample_session_payload(include_id_token=False)
    payload.pop("refresh_token")

    response = client.post(
        "/api/convert",
        json={
            "raw_json": json.dumps(payload),
            "filename": "sub2api",
            "export_format": "sub2api",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert any("缺少 refresh_token" in warning for warning in body["warnings"])


def test_convert_endpoint_returns_400_for_invalid_json() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/convert",
        json={"raw_json": "{", "filename": "", "export_format": "cpa"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "输入不是合法 JSON。"}
