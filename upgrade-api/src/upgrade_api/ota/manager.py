"""OTA 业务编排：备份、git/zip 应用、依赖安装、重启、健康检查、失败回滚。

设计原则（与德道经"慎终若始，则无败事矣"呼应）：
  1. 任何变更前先备份（tar.gz）→ 写入 ota_backups
  2. 备份/恢复都跳过 .venv / data / result / __pycache__
     - .venv 体积大且与平台绑定，回滚后用 pip install 重建即可
     - data / result 是业务数据，绝不参与版本切换
  3. 重启后必须健康检查通过；不通过自动回滚
  4. 所有 subprocess 输出实时写入 job.log，前端可 SSE 订阅
"""

from __future__ import annotations

import os
import shutil
import tarfile
import threading
import time
import uuid
import zipfile
from pathlib import Path

from ..config import Settings, get_settings
from ..db import connect, now_ts
from . import runner
from .jobs import Job, registry

# 备份时排除（这些不进 tar.gz）
BACKUP_EXCLUDES = {".venv", "data", "result", "__pycache__", ".pytest_cache", ".mypy_cache"}
# 恢复时保护（这些目录不会被清空 / 不会被覆盖）
RESTORE_PROTECT = {".venv", "data", "result"}


# ---------- 备份 / 恢复 ----------

def _tar_filter(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(tarinfo.name).parts
    for p in parts:
        if p in BACKUP_EXCLUDES:
            return None
    return tarinfo


def _backup_current(s: Settings, log, note: str) -> tuple[str, Path, str]:
    """打包当前 target_repo 到 backup_dir/<id>.tar.gz，写入 DB。返回 (id, path, commit_before)。"""
    backup_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    backup_path = s.backup_dir / f"{backup_id}.tar.gz"
    commit_before = runner.git_current_commit(s.target_repo_dir) or "(no git)"

    log(f"backup: commit_before={commit_before[:12]}")
    log(f"backup: writing {backup_path}")
    with tarfile.open(backup_path, "w:gz") as tar:
        tar.add(
            str(s.target_repo_dir),
            arcname=s.target_repo_dir.name,
            filter=_tar_filter,
        )
    size = backup_path.stat().st_size
    log(f"backup: done, size={size:,} bytes")

    with connect(s.db_path) as conn:
        conn.execute(
            """INSERT INTO ota_backups (id, path, commit_before, note, size_bytes, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (backup_id, str(backup_path), commit_before, note, size, now_ts()),
        )
    return backup_id, backup_path, commit_before


def _restore_from_backup(s: Settings, backup_id: str, log) -> None:
    """从 tar.gz 恢复 target_repo。保护 .venv / data / result。"""
    with connect(s.db_path) as conn:
        row = conn.execute(
            "SELECT path FROM ota_backups WHERE id = ?", (backup_id,)
        ).fetchone()
    if not row:
        raise RuntimeError(f"backup not found: {backup_id}")
    backup_path = Path(row["path"])
    if not backup_path.exists():
        raise RuntimeError(f"backup file missing: {backup_path}")

    log(f"restore: backup={backup_id}, file={backup_path}")

    # 1. 清空 target，但保留 RESTORE_PROTECT
    target = s.target_repo_dir
    log(f"restore: clearing {target} (protecting {sorted(RESTORE_PROTECT)})")
    if target.exists():
        for entry in target.iterdir():
            if entry.name in RESTORE_PROTECT:
                continue
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
    else:
        target.mkdir(parents=True)

    # 2. tar 解到 target 的父目录（tar 里 arcname 是 target.name，所以解到 parent）
    log("restore: extracting tar.gz")
    with tarfile.open(backup_path, "r:gz") as tar:
        # 兼容 Python 3.12+ 引入的 filter 警告
        try:
            tar.extractall(path=str(target.parent), filter="data")
        except TypeError:
            tar.extractall(path=str(target.parent))
    log("restore: extract done")


# ---------- 应用变更 ----------

def _apply_git(s: Settings, ref: str, log) -> None:
    repo = s.target_repo_dir
    log(f"git: fetch all refs in {repo}")
    runner.run(["git", "fetch", "--all", "--tags", "--prune"], cwd=repo, log=log, timeout=120)

    log(f"git: checkout {ref}")
    runner.run(["git", "checkout", "--force", ref], cwd=repo, log=log, timeout=60)

    # 如果 ref 是 branch，再 pull --ff-only
    branch = runner.git_current_branch(repo)
    if branch and branch != "HEAD" and branch == ref:
        log(f"git: pull --ff-only on branch {branch}")
        runner.run(["git", "pull", "--ff-only"], cwd=repo, log=log, timeout=120, check=False)

    log(f"git: now at {runner.git_current_commit(repo)[:12]} ({runner.git_current_message(repo)})")


def _apply_zip(s: Settings, zip_path: Path, log) -> None:
    """解压 zip 覆盖 target。zip 内可以是 chatgpt2cpa/ 顶层目录，也可以平铺。"""
    repo = s.target_repo_dir
    tmp = s.upload_dir / f"extract-{uuid.uuid4().hex[:8]}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        log(f"zip: extract {zip_path} -> {tmp}")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)

        # 找到真正的源目录：如果 tmp 下只有一个目录且包含 pyproject.toml，则用它
        entries = list(tmp.iterdir())
        if len(entries) == 1 and entries[0].is_dir() and (entries[0] / "pyproject.toml").exists():
            src_root = entries[0]
        else:
            src_root = tmp
        log(f"zip: source root = {src_root}")

        # 清掉 target 内除 RESTORE_PROTECT 之外的内容
        log(f"zip: clearing {repo} (protecting {sorted(RESTORE_PROTECT)})")
        for entry in repo.iterdir():
            if entry.name in RESTORE_PROTECT:
                continue
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()

        # 拷贝 src_root 下所有项到 target（跳过 RESTORE_PROTECT）
        for entry in src_root.iterdir():
            if entry.name in RESTORE_PROTECT:
                continue
            dst = repo / entry.name
            if entry.is_dir():
                shutil.copytree(entry, dst, symlinks=True)
            else:
                shutil.copy2(entry, dst)
        log("zip: apply done")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _pip_install(s: Settings, log) -> None:
    if not s.target_venv_pip.exists():
        log(f"!! pip not found at {s.target_venv_pip}, skipping install")
        return
    log(f"pip: install -e {s.target_repo_dir}")
    runner.run(
        [str(s.target_venv_pip), "install", "-e", str(s.target_repo_dir)],
        log=log,
        timeout=600,
    )


def _restart_service(s: Settings, log) -> None:
    """重启目标 systemd 服务。优先 sudo，失败回退到不带 sudo（本服务以 root 跑时可用）。"""
    cmd_sudo = ["sudo", "-n", "/bin/systemctl", "restart", s.target_service]
    cmd_plain = ["/bin/systemctl", "restart", s.target_service]
    chosen = cmd_sudo if os.geteuid() != 0 else cmd_plain
    log(f"systemctl: restart {s.target_service}")
    rc = runner.run(chosen, log=log, timeout=60, check=False)
    if rc != 0 and chosen is cmd_sudo:
        log("sudo restart failed, trying without sudo")
        runner.run(cmd_plain, log=log, timeout=60)


def _health(s: Settings, log) -> bool:
    return runner.health_check(
        s.target_health_url,
        retries=s.health_retries,
        interval=s.health_interval_sec,
        log=log,
    )


# ---------- 公共编排 ----------

def status() -> dict:
    s = get_settings()
    return {
        "service": s.target_service,
        "serviceActive": runner.systemd_is_active(s.target_service),
        "currentBranch": runner.git_current_branch(s.target_repo_dir) or "(detached)",
        "currentCommit": runner.git_current_commit(s.target_repo_dir),
        "currentCommitMessage": runner.git_current_message(s.target_repo_dir),
        "healthUrl": s.target_health_url,
        "healthOk": _quick_health(s.target_health_url),
    }


def _quick_health(url: str) -> bool:
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return 200 <= resp.status < 500
    except urllib.error.HTTPError as e:
        return 400 <= e.code < 500   # 服务在响应
    except Exception:
        return False


def list_backups() -> list[dict]:
    s = get_settings()
    with connect(s.db_path) as conn:
        rows = conn.execute(
            """SELECT id, commit_before, note, size_bytes, created_at
                 FROM ota_backups ORDER BY created_at DESC LIMIT 50"""
        ).fetchall()
    return [
        {
            "id": r["id"],
            "commitBefore": r["commit_before"],
            "note": r["note"],
            "sizeBytes": r["size_bytes"],
            "createdAt": r["created_at"],
        }
        for r in rows
    ]


def _execute_deploy(job: Job, apply_fn, *, run_pip_install: bool, note: str) -> None:
    """通用部署流水线：备份 → 应用 → pip → 重启 → 健康检查 → 失败回滚。"""
    s = get_settings()
    log = job.append
    job.set_status("running")

    backup_id: str | None = None
    try:
        backup_id, backup_path, commit_before = _backup_current(s, log, note)
        log(f"---- applying change ----")
        apply_fn(s, log)

        if run_pip_install:
            log(f"---- installing dependencies ----")
            _pip_install(s, log)

        log(f"---- restarting service ----")
        _restart_service(s, log)

        log(f"---- health check ----")
        if not _health(s, log):
            raise RuntimeError("health check failed after restart")

        job.set_status("success")
        log("DEPLOY SUCCESS")
    except Exception as exc:
        log(f"!! deploy failed: {exc}")
        if backup_id:
            try:
                log(f"---- auto rollback to {backup_id} ----")
                _restore_from_backup(s, backup_id, log)
                _pip_install(s, log) if run_pip_install else log("pip install skipped on rollback")
                _restart_service(s, log)
                if _health(s, log):
                    job.set_status("rolled_back")
                    log("ROLLBACK SUCCESS")
                else:
                    job.set_status("failed")
                    log("!! ROLLBACK HEALTH CHECK FAILED — manual intervention required")
            except Exception as rexc:
                log(f"!! rollback itself failed: {rexc}")
                job.set_status("failed")
        else:
            job.set_status("failed")
    finally:
        registry().persist(job)


def deploy_git(ref: str, run_pip_install: bool, note: str) -> Job:
    job = registry().create("deploy_git", payload=f"ref={ref}")
    job.append(f"deploy_git: ref={ref}, pip_install={run_pip_install}, note={note!r}")
    threading.Thread(
        target=_execute_deploy,
        args=(job, lambda s, log: _apply_git(s, ref, log)),
        kwargs={"run_pip_install": run_pip_install, "note": note},
        daemon=True,
    ).start()
    return job


def deploy_zip(zip_path: Path, run_pip_install: bool, note: str) -> Job:
    job = registry().create("deploy_zip", payload=f"zip={zip_path.name}")
    job.append(f"deploy_zip: file={zip_path}, pip_install={run_pip_install}, note={note!r}")
    threading.Thread(
        target=_execute_deploy,
        args=(job, lambda s, log: _apply_zip(s, zip_path, log)),
        kwargs={"run_pip_install": run_pip_install, "note": note},
        daemon=True,
    ).start()
    return job


def rollback(backup_id: str) -> Job:
    job = registry().create("rollback", payload=f"backup_id={backup_id}")
    job.append(f"rollback: backup_id={backup_id}")

    def _do():
        s = get_settings()
        log = job.append
        job.set_status("running")
        try:
            _restore_from_backup(s, backup_id, log)
            _pip_install(s, log)
            _restart_service(s, log)
            if _health(s, log):
                job.set_status("success")
                log("ROLLBACK SUCCESS")
            else:
                job.set_status("failed")
                log("!! ROLLBACK HEALTH CHECK FAILED — manual intervention required")
        except Exception as exc:
            log(f"!! rollback failed: {exc}")
            job.set_status("failed")
        finally:
            registry().persist(job)

    threading.Thread(target=_do, daemon=True).start()
    return job
