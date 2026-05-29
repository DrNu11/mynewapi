"""
后台 tail docker 容器日志,在内存维护 5 分钟滑动窗口的请求统计。

设计:
- 每个容器一个 DockerLogTailer 实例,启动后台线程跟随读日志(`docker logs --follow`)。
- 解析每行(委托给 log_parser),把 (status, latency_ms, path) 写入 5s 一桶的滚动窗口。
- query(window) 聚合最近 N 秒,返回 status_codes / paths / latency 分布。

注意:
- 需要挂载 /var/run/docker.sock 进容器(只读),或本地 docker daemon 可用。
- docker logs follow 在容器重启 / SIGHUP 时会断流,需要自动重连。
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Optional

import docker

import log_parser

logger = logging.getLogger("docker-log-collector")

BUCKET_SIZE_S = 5    # 5s 一桶
WINDOW_S = 300       # 5min 窗口
MAX_BUCKETS = WINDOW_S // BUCKET_SIZE_S


def _new_bucket() -> dict:
    return {
        "count": 0,
        "status": defaultdict(int),
        "latencies": [],          # 仅保留 latency_ms 列表,query 时排序算 percentile
        "paths": defaultdict(lambda: {"count": 0, "lat_sum": 0, "success": 0}),
    }


class DockerLogTailer:
    def __init__(self, container_name: str, log_format: str):
        self.container_name = container_name
        self.parser = log_parser.get_parser(log_format)
        if not self.parser:
            raise ValueError(f"unknown log_format: {log_format}")

        self._lock = threading.Lock()
        self._buckets: dict[int, dict] = {}
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._started_at: Optional[float] = None

    # ---------------- public ----------------
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"tail-{self.container_name}", daemon=True)
        self._thread.start()
        self._started_at = time.time()

    def stop(self):
        self._stop.set()

    def query(self, window_seconds: int = WINDOW_S) -> dict:
        now = int(time.time())
        cutoff = now - window_seconds
        cutoff_bucket = (cutoff // BUCKET_SIZE_S) * BUCKET_SIZE_S

        total = 0
        status_codes: dict[int, int] = defaultdict(int)
        latencies: list[int] = []
        paths_acc: dict[str, dict] = defaultdict(lambda: {"count": 0, "lat_sum": 0, "success": 0})

        with self._lock:
            for ts, b in self._buckets.items():
                if ts < cutoff_bucket:
                    continue
                total += b["count"]
                for code, n in b["status"].items():
                    status_codes[code] += n
                latencies.extend(b["latencies"])
                for p, pd in b["paths"].items():
                    pa = paths_acc[p]
                    pa["count"] += pd["count"]
                    pa["lat_sum"] += pd["lat_sum"]
                    pa["success"] += pd["success"]

        latencies.sort()
        success = sum(n for code, n in status_codes.items() if 200 <= code < 400)

        return {
            "total": total,
            "status_codes": dict(status_codes),
            "success": success,
            "success_rate": (success / total * 100) if total else 100.0,
            "latencies_sorted": latencies,
            "paths": dict(paths_acc),
            "started_at": self._started_at,
        }

    # ---------------- internal ----------------
    def _run(self):
        backoff = 1.0
        while not self._stop.is_set():
            try:
                self._tail_once()
                # 正常退出(stream 结束),重置 backoff
                backoff = 1.0
            except docker.errors.NotFound:
                logger.warning("[%s] container not found, retrying in %ds", self.container_name, int(backoff))
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)
            except Exception as e:  # noqa: BLE001
                logger.warning("[%s] tail loop error: %s, retrying in %ds", self.container_name, e, int(backoff))
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def _tail_once(self):
        client = docker.from_env()
        c = client.containers.get(self.container_name)
        # follow=True, tail=0:从当前时刻开始
        stream = c.logs(stream=True, follow=True, tail=0, timestamps=False)
        try:
            for raw in stream:
                if self._stop.is_set():
                    break
                try:
                    line = raw.decode("utf-8", errors="ignore").rstrip()
                except Exception:
                    continue
                self._handle_line(line)
        finally:
            try:
                stream.close()
            except Exception:
                pass

    def _handle_line(self, line: str):
        evt = self.parser(line)
        if not evt:
            return

        status = evt["status"]
        path = evt["path"]
        lat = evt["latency_ms"]
        is_success = 200 <= status < 400

        ts_bucket = (int(time.time()) // BUCKET_SIZE_S) * BUCKET_SIZE_S
        with self._lock:
            b = self._buckets.get(ts_bucket)
            if not b:
                b = _new_bucket()
                self._buckets[ts_bucket] = b

            b["count"] += 1
            b["status"][status] += 1
            b["latencies"].append(lat)

            p = b["paths"][path]
            p["count"] += 1
            p["lat_sum"] += lat
            if is_success:
                p["success"] += 1

            # 清理超出 window 的旧桶
            if len(self._buckets) > MAX_BUCKETS + 5:
                cutoff = ts_bucket - WINDOW_S
                for k in list(self._buckets.keys()):
                    if k < cutoff:
                        del self._buckets[k]


# 全局 tailer 注册表(容器名 -> tailer 实例)
_TAILERS: dict[str, DockerLogTailer] = {}


def get_or_create(container_name: str, log_format: str) -> DockerLogTailer:
    key = container_name
    if key not in _TAILERS:
        t = DockerLogTailer(container_name, log_format)
        t.start()
        _TAILERS[key] = t
        logger.info("started docker log tailer: container=%s format=%s", container_name, log_format)
    return _TAILERS[key]


def stop_all():
    for t in _TAILERS.values():
        t.stop()
