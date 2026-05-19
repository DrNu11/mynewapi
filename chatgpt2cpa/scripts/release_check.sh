#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT_DIR"
rm -rf build dist

python -m pip install -U pip
python -m pip install -U build twine
python -m build
python -m twine check dist/*

python - <<'PY'
from pathlib import Path
import tarfile
import zipfile

dist_dir = Path("dist")
wheel_path = next(dist_dir.glob("chatgpt2cpa-*.whl"))
sdist_path = next(dist_dir.glob("chatgpt2cpa-*.tar.gz"))

with zipfile.ZipFile(wheel_path) as wheel_file:
    wheel_names = set(wheel_file.namelist())

assert "chatgpt2cpa/templates/index.html" in wheel_names
assert "chatgpt2cpa/static/app.js" in wheel_names
assert "chatgpt2cpa/static/styles.css" in wheel_names

with tarfile.open(sdist_path, "r:gz") as sdist_file:
    sdist_names = set(sdist_file.getnames())

assert any(name.endswith("src/chatgpt2cpa/templates/index.html") for name in sdist_names)
assert any(name.endswith("src/chatgpt2cpa/static/app.js") for name in sdist_names)
assert any(name.endswith("src/chatgpt2cpa/static/styles.css") for name in sdist_names)
PY

python -m venv "$TMP_DIR/venv"
"$TMP_DIR/venv/bin/python" -m pip install -U pip
"$TMP_DIR/venv/bin/pip" install "$ROOT_DIR"/dist/*.whl
"$TMP_DIR/venv/bin/python" - <<'PY'
from importlib.resources import files

from chatgpt2cpa.app import app
from chatgpt2cpa.cli import build_parser

assert app.title == "chatgpt2cpa"
assert build_parser().parse_args([]).host == "127.0.0.1"
assert build_parser().parse_args([]).port == 8000
assert build_parser().parse_args(["--host", "0.0.0.0"]).host == "0.0.0.0"
assert files("chatgpt2cpa").joinpath("templates/index.html").is_file()
assert files("chatgpt2cpa").joinpath("static/app.js").is_file()
assert files("chatgpt2cpa").joinpath("static/styles.css").is_file()
PY
"$TMP_DIR/venv/bin/chatgpt2cpa" --help >/dev/null
