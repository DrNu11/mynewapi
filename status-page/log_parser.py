"""
Docker 容器日志行解析器。

支持的日志格式:
  newapi_gin: NewAPI(gin 默认格式)
    [GIN] 2026/05/24 - 20:11:27 | relay | <req_id> | 200 | 18.487607655s | 2604:... | POST /v1/responses

  cpa_gin: cli-proxy-api(自定义 gin)
    [2026-05-24 20:11:45] [--------] [info ] [gin_logger.go:101] 200 |     16.071s |    172.18.0.4 | POST    "/v1/responses"

返回字典:
  { status: int, latency_ms: int, ip: str, method: str, path: str }
失败返回 None。
"""
from __future__ import annotations

import re
from typing import Optional

# Latency string -> ms
def _parse_latency(s: str) -> int:
    s = s.strip()
    try:
        if s.endswith("ms"):
            return int(round(float(s[:-2].strip())))
        if s.endswith("µs") or s.endswith("us"):
            return max(1, int(round(float(s[:-2].strip()) / 1000)))
        if s.endswith("s"):
            return int(round(float(s[:-1].strip()) * 1000))
        # 兜底:数字 + 没单位,假设 ms
        return int(round(float(s)))
    except (ValueError, AttributeError):
        return 0


_NEWAPI_GIN_RE = re.compile(
    r"\[GIN\][^|]*\|[^|]*\|[^|]*\|\s*(?P<status>\d+)\s*\|\s*"
    r"(?P<latency>[\d.]+\s*\S+?)\s*\|\s*(?P<ip>[^|]+?)\s*\|\s*"
    r"(?P<method>[A-Z]+)\s+(?P<path>\S+)"
)

_CPA_GIN_RE = re.compile(
    r"\]\s*(?P<status>\d{3})\s*\|\s*"
    r"(?P<latency>[\d.]+\s*\S+?)\s*\|\s*"
    r"(?P<ip>\S+)\s*\|\s*"
    r"(?P<method>[A-Z]+)\s+\"(?P<path>[^\"]+)\""
)


def parse_newapi_gin(line: str) -> Optional[dict]:
    if "[GIN]" not in line:
        return None
    m = _NEWAPI_GIN_RE.search(line)
    if not m:
        return None
    return {
        "status": int(m.group("status")),
        "latency_ms": _parse_latency(m.group("latency")),
        "ip": m.group("ip").strip(),
        "method": m.group("method"),
        "path": m.group("path"),
    }


def parse_cpa_gin(line: str) -> Optional[dict]:
    if "gin_logger" not in line:
        return None
    m = _CPA_GIN_RE.search(line)
    if not m:
        return None
    return {
        "status": int(m.group("status")),
        "latency_ms": _parse_latency(m.group("latency")),
        "ip": m.group("ip").strip(),
        "method": m.group("method"),
        "path": m.group("path"),
    }


PARSERS = {
    "newapi_gin": parse_newapi_gin,
    "cpa_gin": parse_cpa_gin,
}


def get_parser(name: str):
    return PARSERS.get(name)
