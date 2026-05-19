from pathlib import Path


def test_frontend_script_uses_delayed_blob_cleanup_and_download_state_guard() -> None:
    script = Path("src/chatgpt2cpa/static/app.js").read_text(encoding="utf-8")

    assert "window.setTimeout" in script
    assert "URL.revokeObjectURL(url)" in script
    assert "el.downloadBtn.disabled" in script
    assert "el.copyNameBtn.disabled" in script
