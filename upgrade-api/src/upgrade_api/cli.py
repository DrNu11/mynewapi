"""命令行入口。`upgrade-api` 即 `uvicorn upgrade_api.main:app`。"""

from __future__ import annotations

import argparse

import uvicorn

from .config import get_settings


def main() -> None:
    s = get_settings()
    parser = argparse.ArgumentParser(prog="upgrade-api")
    parser.add_argument("--host", default=s.host)
    parser.add_argument("--port", type=int, default=s.port)
    parser.add_argument("--reload", action="store_true", help="开发用，自动热重载")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    uvicorn.run(
        "upgrade_api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
