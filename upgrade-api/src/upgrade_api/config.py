"""集中读取环境变量、做合理默认。所有路径配置归此一处。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env(key: str, default: str) -> str:
    value = os.environ.get(key)
    return value if value is not None and value != "" else default


def _env_path(key: str, default: str) -> Path:
    return Path(_env(key, default)).expanduser().resolve()


@dataclass(frozen=True)
class Settings:
    # 服务自身
    host: str
    port: int

    # 鉴权
    admin_token: str

    # 数据存储
    data_dir: Path
    db_path: Path

    # 静态资源（前端 index.html / admin.html 等）
    static_dir: Path

    # OTA 目标
    target_repo_dir: Path        # /opt/chatgpt2cpa
    target_service: str          # chatgpt2cpa.service
    target_health_url: str       # http://127.0.0.1:7888/
    target_venv_pip: Path        # /opt/chatgpt2cpa/.venv/bin/pip

    # OTA 工作目录
    backup_dir: Path             # /opt/chatgpt2cpa-backups
    upload_dir: Path             # 临时上传

    # OTA 行为
    health_retries: int
    health_interval_sec: float
    max_upload_mb: int


def load_settings() -> Settings:
    data_dir = _env_path("UPGRADE_API_DATA_DIR", "./data")
    static_dir = _env_path("UPGRADE_API_STATIC_DIR", "./static")
    target_repo = _env_path("UPGRADE_TARGET_REPO", "/opt/chatgpt2cpa")
    backup_dir = _env_path("UPGRADE_BACKUP_DIR", "/opt/chatgpt2cpa-backups")
    upload_dir = _env_path("UPGRADE_UPLOAD_DIR", str(data_dir / "uploads"))

    # 自动创建必要目录（除了 target_repo，那是只读探测目标）
    for p in (data_dir, backup_dir, upload_dir):
        p.mkdir(parents=True, exist_ok=True)

    return Settings(
        host=_env("UPGRADE_API_HOST", "127.0.0.1"),
        port=int(_env("UPGRADE_API_PORT", "7889")),
        admin_token=_env("UPGRADE_API_ADMIN_TOKEN", ""),
        data_dir=data_dir,
        db_path=data_dir / "upgrade.db",
        static_dir=static_dir,
        target_repo_dir=target_repo,
        target_service=_env("UPGRADE_TARGET_SERVICE", "chatgpt2cpa.service"),
        target_health_url=_env("UPGRADE_TARGET_HEALTH_URL", "http://127.0.0.1:7888/"),
        target_venv_pip=Path(_env("UPGRADE_TARGET_VENV_PIP", str(target_repo / ".venv/bin/pip"))),
        backup_dir=backup_dir,
        upload_dir=upload_dir,
        health_retries=int(_env("UPGRADE_HEALTH_RETRIES", "20")),
        health_interval_sec=float(_env("UPGRADE_HEALTH_INTERVAL", "1.5")),
        max_upload_mb=int(_env("UPGRADE_MAX_UPLOAD_MB", "200")),
    )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings
