"""无状态工具：跑子进程、收集日志、健康检查、读 git 元信息。

把 subprocess 包成"记录式"——所有命令、stdout、stderr、退出码都进 logger，
后端 SSE / 前端 admin.html 能直接消费。
"""

from __future__ import annotations

import shlex
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Sequence

LogFn = Callable[[str], None]


def run(
    cmd: Sequence[str] | str,
    *,
    cwd: Path | None = None,
    log: LogFn,
    timeout: int = 600,
    env: dict | None = None,
    check: bool = True,
) -> int:
    """跑命令，逐行 log，返回退出码。check=True 时非零退出抛 RuntimeError。"""
    if isinstance(cmd, str):
        shown = cmd
        cmd_list = shlex.split(cmd)
    else:
        cmd_list = list(cmd)
        shown = " ".join(shlex.quote(c) for c in cmd_list)

    log(f"$ {shown}" + (f"  (cwd={cwd})" if cwd else ""))
    try:
        proc = subprocess.Popen(
            cmd_list,
            cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
        )
    except FileNotFoundError as exc:
        log(f"!! command not found: {exc}")
        if check:
            raise RuntimeError(f"command not found: {cmd_list[0]}") from exc
        return 127

    start = time.time()
    assert proc.stdout is not None
    for line in proc.stdout:
        log(line.rstrip("\n"))
        if time.time() - start > timeout:
            proc.kill()
            log(f"!! timeout after {timeout}s, killed")
            if check:
                raise RuntimeError(f"timeout: {shown}")
            return 124

    rc = proc.wait()
    log(f"[exit {rc}]")
    if check and rc != 0:
        raise RuntimeError(f"non-zero exit ({rc}): {shown}")
    return rc


def capture(cmd: Sequence[str], *, cwd: Path | None = None, timeout: int = 30) -> str:
    """跑命令并返回 stdout（strip）。失败返回空串，不抛。"""
    try:
        out = subprocess.check_output(
            list(cmd),
            cwd=str(cwd) if cwd else None,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=timeout,
        )
        return out.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def git_current_branch(repo: Path) -> str:
    return capture(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo)


def git_current_commit(repo: Path) -> str:
    return capture(["git", "rev-parse", "HEAD"], cwd=repo)


def git_current_message(repo: Path) -> str:
    return capture(["git", "log", "-1", "--pretty=%s"], cwd=repo)


def systemd_is_active(service: str) -> bool:
    return capture(["systemctl", "is-active", service]) == "active"


def health_check(url: str, *, retries: int, interval: float, log: LogFn) -> bool:
    """循环 GET url，2xx/3xx 视为通过。"""
    for i in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                code = resp.status
                if 200 <= code < 400:
                    log(f"health check OK ({code}) on try {i}")
                    return True
                log(f"health check try {i}: HTTP {code}")
        except urllib.error.HTTPError as exc:
            # 4xx 也算"服务在响应"——FastAPI 根路径可能 404，但进程是活的
            if 400 <= exc.code < 500:
                log(f"health check OK (HTTP {exc.code}, service responding) on try {i}")
                return True
            log(f"health check try {i}: HTTPError {exc.code}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            log(f"health check try {i}: {exc}")
        time.sleep(interval)
    log("!! health check failed after all retries")
    return False
