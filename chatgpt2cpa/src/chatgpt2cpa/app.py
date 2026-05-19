import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .converter import build_codex_auth_json
from .schemas import (
    ConvertRequest,
    ErrorResponse,
    ExportFormat,
    ExportResponse,
)
from .sub2api_converter import build_sub2api_json

# 在线升级表单 (/api/upgrade/submit) 已迁移到独立的 upgrade-api 服务,
# 由 nginx 反代 /api/upgrade/* 到 upgrade-api:7889 处理。
# 这里只保留:首页 plus.html 渲染 + chatgpt2cpa 自身的 /api/convert 工具。

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parents[1]
RESULT_DIR = PROJECT_DIR / "result"
TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title="chatgpt2cpa")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


def unique_result_path(filename: str) -> Path:
    output_path = RESULT_DIR / Path(filename).name
    if not output_path.exists():
        return output_path

    stem = output_path.stem
    suffix = output_path.suffix
    index = 1
    while True:
        candidate = RESULT_DIR / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def save_result_file(filename: str, data: dict[str, Any]) -> None:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(RESULT_DIR, 0o700)
    output_path = unique_result_path(filename)
    body = f"{json.dumps(data, ensure_ascii=False, indent=2)}\n"
    descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        file.write(body)


@app.get("/", response_class=HTMLResponse)
def plus_index(request: Request) -> HTMLResponse:
    return TEMPLATES.TemplateResponse(request=request, name="plus.html")


@app.get("/tools/chatgpt2cpa", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return TEMPLATES.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "session_url": "https://chatgpt.com/api/auth/session",
        },
    )


@app.post(
    "/api/convert",
    response_model=ExportResponse,
    responses={400: {"model": ErrorResponse}},
)
def convert(payload: ConvertRequest) -> ExportResponse:
    try:
        source = json.loads(payload.raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="输入不是合法 JSON。") from exc

    try:
        if payload.export_format == ExportFormat.SUB2API:
            result = build_sub2api_json(source, payload.filename)
            return ExportResponse(
                export_format=ExportFormat.SUB2API,
                filename=result.filename,
                download_data=result.payload_data,
                warnings=result.warnings,
                auth_data=None,
            )

        result = build_codex_auth_json(source, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ExportResponse(
        export_format=ExportFormat.CPA,
        filename=result.filename,
        download_data=result.auth_data,
        auth_data=result.auth_data,
        warnings=result.warnings,
    )
