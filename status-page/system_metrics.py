"""
VPS 系统指标采集 - 输出与 status.iqach.top 前端 schema 对齐

返回结构:
{
  "cpu_percent": float,
  "memory":  { "used_mb": int, "total_mb": int, "percent": float },
  "disk":    { "used_gb": float, "total_gb": float, "percent": float },
  "network": { "rx_speed_bps": int, "tx_speed_bps": int },
  "load":    [float, float, float],  # 1/5/15 min,Linux 才有
  "uptime_seconds": int,
}
"""
from __future__ import annotations

import time
from typing import Optional

import psutil


# 模块级缓存:首次调用 cpu_percent / 网络速率需要"两次采样之间的差"。
_last_net: Optional[dict] = None  # {"ts": float, "rx": int, "tx": int}


def _net_speed() -> tuple[int, int]:
    """计算最近一次到现在的网络瞬时速率(bps)。第一次调用返回 0/0。"""
    global _last_net
    counters = psutil.net_io_counters()
    now = time.time()
    rx, tx = counters.bytes_recv, counters.bytes_sent

    if _last_net is None:
        _last_net = {"ts": now, "rx": rx, "tx": tx}
        return 0, 0

    dt = max(now - _last_net["ts"], 1e-3)
    rx_bps = int((rx - _last_net["rx"]) * 8 / dt)
    tx_bps = int((tx - _last_net["tx"]) * 8 / dt)
    _last_net = {"ts": now, "rx": rx, "tx": tx}

    # 防止 counter 重置导致的负值
    return max(rx_bps, 0), max(tx_bps, 0)


def collect() -> dict:
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    rx_bps, tx_bps = _net_speed()

    try:
        load1, load5, load15 = psutil.getloadavg()
        load = [load1, load5, load15]
    except (AttributeError, OSError):
        load = None

    try:
        uptime_seconds = int(time.time() - psutil.boot_time())
    except Exception:
        uptime_seconds = 0

    return {
        "cpu_percent": psutil.cpu_percent(interval=None),
        "memory": {
            "used_mb": int(mem.used / 1024 / 1024),
            "total_mb": int(mem.total / 1024 / 1024),
            "percent": round(mem.percent, 1),
        },
        "disk": {
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "percent": round(disk.percent, 1),
        },
        "network": {
            "rx_speed_bps": rx_bps,
            "tx_speed_bps": tx_bps,
        },
        "load": load,
        "uptime_seconds": uptime_seconds,
    }
