import json

from fastapi.testclient import TestClient

from chatgpt2cpa.app import app
from tests.helpers import sample_session_payload


def test_reset_assistant_status_defaults_to_parse_only(monkeypatch) -> None:
    monkeypatch.delenv("CPA_ENABLE_IMPORT_RESET", raising=False)
    monkeypatch.delenv("CPA_MANAGEMENT_KEY", raising=False)

    client = TestClient(app)
    response = client.get("/api/reset-assistant/status")

    assert response.status_code == 200
    assert response.json() == {
        "import_reset_enabled": False,
        "management_configured": False,
    }


def test_reset_assistant_parse_returns_cpa_download_data() -> None:
    client = TestClient(app)
    payload = sample_session_payload(include_id_token=True)

    response = client.post(
        "/api/reset-assistant/parse",
        json={"raw_json": json.dumps(payload), "filename": "customer-a"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "customer-a-cpa.json"
    assert body["summary"] == {
        "email": "demo@example.com",
        "account_id": "acc_1234567890",
        "plan_type": "plus",
        "expired": "2030-01-01T00:00:00Z",
        "has_refresh_token": True,
        "has_id_token": True,
        "id_token_synthetic": False,
    }
    assert body["auth_data"]["type"] == "codex"
    assert body["auth_data"]["access_token"] == payload["access_token"]


def test_reset_assistant_parse_rejects_invalid_json_without_echoing_input() -> None:
    client = TestClient(app)
    bad_input = "eyJ.fake.token"

    response = client.post(
        "/api/reset-assistant/parse",
        json={"raw_json": bad_input, "filename": ""},
    )

    assert response.status_code == 400
    assert bad_input not in response.text
    assert response.json() == {"detail": "输入不是合法 JSON。"}


def test_reset_assistant_import_reset_requires_enabled_management() -> None:
    client = TestClient(app)
    payload = sample_session_payload(include_id_token=True)

    response = client.post(
        "/api/reset-assistant/import-reset",
        json={
            "raw_json": json.dumps(payload),
            "filename": "customer-a",
            "confirm_authorized": True,
        },
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "服务器未启用 CPA 导入/重置。"}


def test_reset_assistant_import_reset_uses_management_adapter(monkeypatch) -> None:
    monkeypatch.setenv("CPA_ENABLE_IMPORT_RESET", "1")
    monkeypatch.setenv("CPA_MANAGEMENT_BASE_URL", "http://127.0.0.1:8317/v0/management")
    monkeypatch.setenv("CPA_MANAGEMENT_KEY", "secret-test-key")

    calls = []

    def fake_import_cpa_and_reset(filename, auth_data):
        calls.append((filename, auth_data["email"]))
        return (
            {"status": "ok"},
            "auth-index-123",
            {
                "auth_index": "auth-index-123",
                "name": filename,
                "email": auth_data["email"],
                "status": "ready",
            },
            {"status": "ok", "auth_index": "auth-index-123", "models": ["gpt-5"]},
        )

    monkeypatch.setattr("chatgpt2cpa.app.import_cpa_and_reset", fake_import_cpa_and_reset)

    client = TestClient(app)
    payload = sample_session_payload(include_id_token=True)
    response = client.post(
        "/api/reset-assistant/import-reset",
        json={
            "raw_json": json.dumps(payload),
            "filename": "customer-a",
            "confirm_authorized": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert calls == [("customer-a-cpa.json", "demo@example.com")]
    assert body["ok"] is True
    assert body["auth_index"] == "auth-index-123"
    assert body["auth_file"]["email"] == "demo@example.com"
    assert body["reset_status"]["models"] == ["gpt-5"]
