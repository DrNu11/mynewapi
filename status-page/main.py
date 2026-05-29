"""
Status Page FastAPI 入口(多网关版本)

启动方式:
  开发:  python main.py
  生产:  uvicorn main:app --host 0.0.0.0 --port 8000

环境变量见 config.py 顶部注释。
"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import os

import config
import system_metrics
import gateway_metrics
import history_store
import minimax_monitor
import mock_data
import throttle_admin

# Admin secret for toggle endpoints(默认值仅本地开发用,生产必须用环境变量覆盖)
ADMIN_SECRET = os.getenv("STATUS_ADMIN_SECRET", "changeme-admin")

logger = logging.getLogger("status-page")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


_started_at = time.time()


def _build_payload() -> list[dict]:
    """组装 /api/stats:数组,每个网关一项。"""
    gateways = config.get_gateways()
    out: list[dict] = []

    if config.MOCK_MODE:
        # MOCK:不连 DB,不读 docker,纯假数据
        sys_cache = mock_data.mock_system()
        for gw in gateways:
            out.append(
                {
                    "tag": gw["tag"],
                    "name": gw["name"],
                    "error": None,
                    "system": sys_cache if gw.get("show_system") else None,
                    "history": mock_data.mock_history() if gw.get("use_mysql") else None,
                    "data": mock_data.mock_gateway_for(gw),
                }
            )
        return out

    # 真实模式 ----------------
    # 系统指标只采一次,挂给 show_system=True 的网关
    try:
        sys_data = system_metrics.collect()
    except Exception as e:  # noqa: BLE001
        logger.warning("system_metrics.collect failed: %s", e)
        sys_data = None

    # history 只对有 mysql 的网关给(目前只有 newapi)
    try:
        history_data = history_store.build_history_payload()
    except Exception as e:  # noqa: BLE001
        logger.warning("history build failed: %s", e)
        history_data = None

    for gw in gateways:
        try:
            data = gateway_metrics.collect_gateway(gw, _started_at)
            out.append(
                {
                    "tag": gw["tag"],
                    "name": gw["name"],
                    "error": None,
                    "system": sys_data if gw.get("show_system") else None,
                    "history": history_data if gw.get("use_mysql") else None,
                    "data": data,
                }
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("gateway %s collect failed: %s", gw.get("tag"), e)
            out.append(
                {
                    "tag": gw["tag"],
                    "name": gw["name"],
                    "error": f"采集失败: {e}",
                    "system": sys_data if gw.get("show_system") else None,
                    "history": None,
                    "data": None,
                }
            )
    return out


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    if not config.MOCK_MODE:
        # 1. 启动 docker logs tailer(对每个配置了 container 的网关)
        import docker_log_collector
        for gw in config.get_gateways():
            container = gw.get("container") or ""
            log_format = gw.get("log_format") or ""
            if container and log_format:
                try:
                    docker_log_collector.get_or_create(container, log_format)
                except Exception as e:  # noqa: BLE001
                    logger.warning("docker tailer start failed for %s: %s", container, e)

        # 2. 历史桶回填(只对 newapi mysql)
        try:
            history_store.backfill_if_empty()
        except Exception as e:  # noqa: BLE001
            logger.warning("history backfill failed (will retry later): %s", e)

        # 3. 周期刷新当前 history 桶
        scheduler = BackgroundScheduler(timezone="UTC")
        scheduler.add_job(
            history_store.refresh_current,
            "interval",
            seconds=config.REFRESH_SECONDS,
            id="refresh_current",
            max_instances=1,
            coalesce=True,
        )
        scheduler.start()
        logger.info("scheduler started: refresh every %ds", config.REFRESH_SECONDS)
    else:
        logger.info("running in MOCK_MODE, no scheduler, no DB/docker connection")

    yield

    if scheduler:
        scheduler.shutdown(wait=False)
    if not config.MOCK_MODE:
        import docker_log_collector
        docker_log_collector.stop_all()


app = FastAPI(title="Nassa Status Page", lifespan=lifespan)


@app.get("/api/stats")
def get_stats() -> JSONResponse:
    return JSONResponse(content=_build_payload())


@app.get("/api/health")
def get_health() -> dict:
    return {
        "status": "ok",
        "mock_mode": config.MOCK_MODE,
        "uptime_seconds": int(time.time() - _started_at),
        "gateways": [g["tag"] for g in config.get_gateways()],
    }


@app.get("/api/minimax")
def get_minimax() -> JSONResponse:
    return JSONResponse(content=minimax_monitor.collect())


# ==========================================
# DeepSeek 防并发一键开关 (admin endpoints)
# ==========================================

@app.get("/api/admin/throttle")
def get_throttle() -> JSONResponse:
    """读当前限流状态,前端展示用。无需鉴权。"""
    if config.MOCK_MODE:
        return JSONResponse(content={"enabled": False, "mock": True})
    return JSONResponse(content=throttle_admin.get_throttle_status())


@app.post("/api/admin/throttle")
def toggle_throttle(payload: dict) -> JSONResponse:
    """切换限流开关。需要 X-Admin-Secret header(或 body.secret)正确才执行。

    payload: {"enabled": true|false, "secret": "xxx"}
    """
    secret = payload.get("secret") or ""
    if secret != ADMIN_SECRET:
        return JSONResponse(content={"ok": False, "error": "密码错误"}, status_code=401)

    if config.MOCK_MODE:
        return JSONResponse(content={"ok": True, "mock": True})

    target = bool(payload.get("enabled"))
    result = throttle_admin.set_throttle_enabled(target)
    if result.get("ok"):
        # 顺便返回新状态供前端刷新
        result["status"] = throttle_admin.get_throttle_status()
    return JSONResponse(
        content=result,
        status_code=200 if result.get("ok") else 500,
    )


# 静态文件托管:把 static/ 挂在根路径,index.html 自动作为首页
app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
