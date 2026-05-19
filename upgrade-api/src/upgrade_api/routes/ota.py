"""OTA 接口：/api/ota/*。全部要 admin token。"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..auth import require_admin
from ..config import get_settings
from ..models import (
    OtaBackupItem,
    OtaDeployGitIn,
    OtaJobOut,
    OtaRollbackIn,
    OtaStatusOut,
)
from ..ota import manager
from ..ota.jobs import registry

router = APIRouter(prefix="/api/ota", tags=["ota"], dependencies=[Depends(require_admin)])


def _job_to_out(job) -> OtaJobOut:
    return OtaJobOut(
        jobId=job.id,
        kind=job.kind,
        status=job.status,  # type: ignore[arg-type]
        startedAt=job.started_at,
        finishedAt=job.finished_at,
    )


@router.get("/status", response_model=OtaStatusOut)
def status() -> OtaStatusOut:
    return OtaStatusOut(**manager.status())


@router.get("/backups", response_model=list[OtaBackupItem])
def list_backups() -> list[OtaBackupItem]:
    return [OtaBackupItem(**b) for b in manager.list_backups()]


@router.post("/deploy/git", response_model=OtaJobOut)
def deploy_git(payload: OtaDeployGitIn) -> OtaJobOut:
    job = manager.deploy_git(payload.ref, payload.runPipInstall, payload.note)
    return _job_to_out(job)


@router.post("/deploy/zip", response_model=OtaJobOut)
async def deploy_zip(
    file: UploadFile = File(...),
    runPipInstall: bool = Form(True),
    note: str = Form(""),
) -> OtaJobOut:
    s = get_settings()
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="file must be a .zip")

    # 大小检查 + 落盘
    dest = s.upload_dir / f"{uuid.uuid4().hex}.zip"
    max_bytes = s.max_upload_mb * 1024 * 1024
    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"zip too large (> {s.max_upload_mb} MB)",
                    )
                out.write(chunk)
    finally:
        await file.close()

    job = manager.deploy_zip(dest, runPipInstall, note)
    return _job_to_out(job)


@router.post("/rollback", response_model=OtaJobOut)
def rollback(payload: OtaRollbackIn) -> OtaJobOut:
    job = manager.rollback(payload.backupId)
    return _job_to_out(job)


@router.get("/jobs/{job_id}", response_model=OtaJobOut)
def get_job(job_id: str) -> OtaJobOut:
    job = registry().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_to_out(job)


@router.get("/jobs/{job_id}/logs")
def stream_logs(job_id: str):
    """SSE: 实时推送 job 日志。前端 EventSource 订阅。"""
    job = registry().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    def gen():
        cursor = 0
        # 第一条 ping，让前端立刻打开通道
        yield "event: open\ndata: {}\n\n"
        while True:
            new_lines, cursor = job.tail(cursor)
            for line in new_lines:
                # SSE 要求每条 data 不含裸换行
                safe = line.replace("\r", "")
                yield f"data: {json.dumps(safe, ensure_ascii=False)}\n\n"
            if job.finished_at is not None:
                payload = {
                    "status": job.status,
                    "finishedAt": job.finished_at,
                }
                yield f"event: done\ndata: {json.dumps(payload)}\n\n"
                return
            # 阻塞等待新日志或结束信号，最多 5s 醒一次发心跳
            job.wait_for_change(cursor, timeout=5.0)
            yield ": keep-alive\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",   # 让 nginx 不缓冲
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)
