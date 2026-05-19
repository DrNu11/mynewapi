from fastapi.testclient import TestClient

from chatgpt2cpa.app import app


def test_home_page_renders_dual_export_actions() -> None:
    client = TestClient(app)
    response = client.get("/")
    text = response.text

    assert response.status_code == 200
    assert "OpenAI / Codex JSON 导出" in text
    assert "支持 session -> CPA 与 session -> sub2api" in text
    assert "生成后可下载 CPA 或 sub2api JSON 文件。" in text
    assert "codex-&lt;email&gt;-&lt;plan_type&gt;-cpa.json" in text
    assert "codex-&lt;email&gt;-&lt;plan_type&gt;-sub2api.json" in text
    assert "自动补上 -cpa 或 -sub2api" in text
    assert 'id="convertForm"' in text
    assert "https://chatgpt.com/api/auth/session" in text
    assert 'id="rawJson"' in text
    assert 'id="fileName"' in text
    assert 'id="generateCpaBtn"' in text
    assert 'class="generate-btn generate-btn-cpa"' in text
    assert 'id="generateSub2apiBtn"' in text
    assert 'class="generate-btn generate-btn-sub2api"' in text
    assert 'id="errorBox"' in text
    assert 'id="statusPill"' in text
    assert 'id="resultPanelActions"' in text
    assert 'id="summary"' in text
    assert 'id="warnings"' in text
    assert 'id="downloadBtn"' in text
    assert 'disabled' in text
    assert 'id="copyNameBtn"' in text
    assert "复制文件名" in text
    assert "操作" not in text
    assert "下载与复制" not in text
    assert 'href="/static/styles.css"' in text
    assert 'src="/static/app.js"' in text
