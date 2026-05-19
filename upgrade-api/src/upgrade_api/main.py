"""FastAPI app 工厂。"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .db import init_db
from .routes import admin as admin_routes
from .routes import ota as ota_routes
from .routes import upgrade as upgrade_routes


def create_app() -> FastAPI:
    settings = get_settings()
    init_db(settings.db_path)

    app = FastAPI(
        title="upgrade-api",
        version=__version__,
        docs_url="/api/_docs",
        redoc_url=None,
        openapi_url="/api/_openapi.json",
    )

    # 开发环境:允许 chatgpt2cpa 前端 (默认 :7888) 跨端口调本服务的 /api/upgrade/*
    # 生产同源经 nginx 反代,不会触发 CORS,加这个不影响生产。
    cors_origins = os.environ.get(
        "UPGRADE_API_CORS_ORIGINS",
        "http://127.0.0.1:7888,http://localhost:7888,http://127.0.0.1:8000,http://localhost:8000",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Admin-Token"],
    )

    @app.get("/api/health", tags=["meta"])
    def health() -> JSONResponse:
        return JSONResponse({"ok": True, "version": __version__})

    app.include_router(upgrade_routes.router)
    app.include_router(admin_routes.router)
    app.include_router(ota_routes.router)

    # 静态：/upgrade -> static/index.html；/admin -> static/admin.html
    static_dir: Path = settings.static_dir
    if static_dir.exists():
        # /upgrade/*  →  static/*
        app.mount("/upgrade", StaticFiles(directory=str(static_dir), html=True), name="upgrade")

        @app.get("/admin", include_in_schema=False)
        def admin_page() -> FileResponse:
            f = static_dir / "admin.html"
            if not f.exists():
                return JSONResponse({"error": "admin.html missing"}, status_code=404)
            return FileResponse(f)

    return app


app = create_app()
