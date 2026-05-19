from chatgpt2cpa.cli import build_parser, main


def test_build_parser_uses_local_defaults() -> None:
    args = build_parser().parse_args([])

    assert args.host == "127.0.0.1"
    assert args.port == 8000
    assert args.reload is False


def test_build_parser_allows_explicit_public_host() -> None:
    args = build_parser().parse_args(["--host", "0.0.0.0"])

    assert args.host == "0.0.0.0"


def test_main_runs_uvicorn_with_package_import_path(monkeypatch) -> None:
    called: dict[str, object] = {}

    def fake_run(app_path: str, *, host: str, port: int, reload: bool) -> None:
        called["app_path"] = app_path
        called["host"] = host
        called["port"] = port
        called["reload"] = reload

    monkeypatch.setattr("chatgpt2cpa.cli.uvicorn.run", fake_run)

    main(["--port", "9001", "--reload"])

    assert called == {
        "app_path": "chatgpt2cpa.app:app",
        "host": "127.0.0.1",
        "port": 9001,
        "reload": True,
    }
