from fastapi.testclient import TestClient

from chatgpt2cpa.app import app


def test_home_page_renders_dual_export_actions() -> None:
    client = TestClient(app)
    response = client.get("/")
    text = response.text

    assert response.status_code == 200
    assert "Codex 额度助手" in text
    assert "额度重置" in text
    assert 'id="sessionForm"' in text
    assert 'id="rawJson"' in text
    assert 'id="fileName"' in text
    assert 'id="confirmAuthorized"' in text
    assert 'id="parseBtn"' in text
    assert 'id="downloadBtn"' in text
    assert 'id="importResetBtn"' in text
    assert "导入并重置" in text
    assert "https://chatgpt.com/api/auth/session" in text
    assert 'id="warnings"' in text
    assert 'disabled' in text
    assert 'href="static/reset-assistant.css"' in text
    assert 'src="static/reset-assistant.js"' in text


def test_reset_assistant_alias_renders_home() -> None:
    client = TestClient(app)
    response = client.get("/reset-assistant/")

    assert response.status_code == 200
    assert "Codex 额度助手" in response.text
