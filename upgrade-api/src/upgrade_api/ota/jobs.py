"""Job 状态：内存里实时维护，结束时落 SQLite。SSE 从内存读 log buffer。"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Iterable

from ..config import get_settings
from ..db import connect, now_ts


@dataclass
class Job:
    id: str
    kind: str
    status: str = "pending"          # pending | running | success | failed | rolled_back
    payload: str = ""
    log_lines: list[str] = field(default_factory=list)
    started_at: int = field(default_factory=now_ts)
    finished_at: int | None = None
    _cond: threading.Condition = field(default_factory=threading.Condition)

    def append(self, line: str) -> None:
        with self._cond:
            stamp = time.strftime("%H:%M:%S")
            self.log_lines.append(f"[{stamp}] {line}")
            self._cond.notify_all()

    def set_status(self, status: str) -> None:
        with self._cond:
            self.status = status
            if status in ("success", "failed", "rolled_back"):
                self.finished_at = now_ts()
            self._cond.notify_all()

    def tail(self, after: int) -> tuple[list[str], int]:
        """返回 (新增日志, 新游标)。after 是上一次的 cursor。"""
        with self._cond:
            new = self.log_lines[after:]
            return new, len(self.log_lines)

    def wait_for_change(self, after: int, timeout: float) -> None:
        with self._cond:
            if len(self.log_lines) > after or self.finished_at is not None:
                return
            self._cond.wait(timeout=timeout)


class JobRegistry:
    """全局 job 表。运行中的 job 留在内存，结束时持久化到 DB。"""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, payload: str = "") -> Job:
        job = Job(id=uuid.uuid4().hex[:16], kind=kind, payload=payload)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> Iterable[Job]:
        with self._lock:
            return list(self._jobs.values())

    def persist(self, job: Job) -> None:
        with connect(get_settings().db_path) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO ota_jobs
                       (id, kind, status, payload, log, started_at, finished_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    job.id,
                    job.kind,
                    job.status,
                    job.payload,
                    "\n".join(job.log_lines),
                    job.started_at,
                    job.finished_at,
                ),
            )


_registry = JobRegistry()


def registry() -> JobRegistry:
    return _registry
