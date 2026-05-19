import argparse
from collections.abc import Sequence

import uvicorn


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="chatgpt2cpa",
        description="Run the local chatgpt2cpa web UI.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind host. Default stays 127.0.0.1; set 0.0.0.0 explicitly only when needed.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Bind port for the local web UI.",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for local development.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    uvicorn.run(
        "chatgpt2cpa.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
