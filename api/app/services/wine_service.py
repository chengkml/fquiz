from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.database import SessionLocal
from ..models.base import utcnow
from ..models.wine import WineRun
from ..schemas.wine import WineRunDetail, WineRunListResponse, WineRunRequest, WineRunSummary, WineStatusResponse
from .wine_probe import probe_wine_binary, probe_wine_binary_async


settings = get_settings()
LOG_MAX_CHARS = 200_000


def _truncate_output(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= LOG_MAX_CHARS:
        return value
    return f"{value[:LOG_MAX_CHARS]}\n...[truncated]"


def _allowed_root() -> Path:
    return Path(settings.wine_allowed_root).expanduser().resolve(strict=False)


def _resolve_binary() -> str | None:
    configured = settings.wine_binary_path.strip() or "wine"
    resolved = shutil.which(configured)
    if resolved:
        return resolved

    candidate = Path(configured).expanduser()
    if candidate.exists() and candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate.resolve())
    return None


def _resolve_path_under_root(raw_path: str, *, field_name: str, must_exist: bool) -> Path:
    root = _allowed_root()
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate

    resolved = candidate.resolve(strict=False)
    if not resolved.is_relative_to(root):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be inside wine allowed root: {root}",
        )
    if must_exist and not resolved.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} does not exist: {resolved}",
        )
    return resolved


def _resolve_executable(raw_path: str) -> Path:
    executable = _resolve_path_under_root(raw_path, field_name="exe_path", must_exist=True)
    if not executable.is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"exe_path is not a file: {executable}",
        )
    return executable


def _resolve_working_dir(raw_path: str | None, executable: Path) -> Path:
    if not raw_path:
        return executable.parent
    working_dir = _resolve_path_under_root(raw_path, field_name="working_dir", must_exist=True)
    if not working_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"working_dir is not a directory: {working_dir}",
        )
    return working_dir


def _resolve_timeout(payload_timeout: int | None) -> int:
    timeout_seconds = payload_timeout or settings.wine_default_timeout_seconds
    if timeout_seconds > settings.wine_max_timeout_seconds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"timeout_seconds cannot exceed {settings.wine_max_timeout_seconds}",
        )
    return timeout_seconds


async def get_wine_status() -> WineStatusResponse:
    binary = settings.wine_binary_path.strip() or "wine"
    allowed_root = str(_allowed_root())
    resolved = _resolve_binary()
    if not resolved:
        return WineStatusResponse(
            wine_binary=binary,
            available=False,
            allowed_root=allowed_root,
            default_timeout_seconds=settings.wine_default_timeout_seconds,
            max_timeout_seconds=settings.wine_max_timeout_seconds,
            error="Wine binary not found",
        )

    probe = await probe_wine_binary_async(resolved)
    return WineStatusResponse(
        wine_binary=binary,
        resolved_binary=resolved,
        available=probe.available,
        version=probe.version,
        allowed_root=allowed_root,
        default_timeout_seconds=settings.wine_default_timeout_seconds,
        max_timeout_seconds=settings.wine_max_timeout_seconds,
        error=probe.error,
    )


def serialize_run(item: WineRun) -> WineRunSummary:
    stdout_text = item.stdout_text or ""
    stderr_text = item.stderr_text or ""
    return WineRunSummary(
        id=item.id,
        task_id=item.task_id,
        status=item.status,  # type: ignore[arg-type]
        exe_path=item.exe_path,
        arguments=item.arguments_json or [],
        working_dir=item.working_dir,
        timeout_seconds=item.timeout_seconds,
        command_text=item.command_text,
        resolved_binary=item.resolved_binary,
        exit_code=item.exit_code,
        timed_out=item.timed_out,
        started_at=item.started_at,
        finished_at=item.finished_at,
        duration_ms=item.duration_ms,
        error_message=item.error_message,
        stdout_size=len(stdout_text),
        stderr_size=len(stderr_text),
        create_date=item.create_date,
        create_user=item.create_user,
    )


def serialize_run_detail(item: WineRun) -> WineRunDetail:
    summary = serialize_run(item)
    return WineRunDetail(
        **summary.model_dump(),
        stdout_text=item.stdout_text,
        stderr_text=item.stderr_text,
    )


def list_runs(db: Session, *, limit: int, offset: int) -> WineRunListResponse:
    total = int(db.scalar(select(func.count()).select_from(WineRun)) or 0)
    items = db.execute(
        select(WineRun).order_by(WineRun.create_date.desc(), WineRun.id.desc()).limit(limit).offset(offset)
    ).scalars().all()
    return WineRunListResponse(items=[serialize_run(item) for item in items], total=total)


def get_run_by_id(db: Session, run_id: str) -> WineRun | None:
    return db.execute(select(WineRun).where(WineRun.id == run_id)).scalar_one_or_none()


def get_run_detail(db: Session, *, run_id: str) -> WineRunDetail:
    run = get_run_by_id(db, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wine run not found")
    return serialize_run_detail(run)


def create_run(
    db: Session,
    *,
    payload: WineRunRequest,
    actor_user_id: str,
) -> WineRunDetail:
    resolved_binary = _resolve_binary()
    if not resolved_binary:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wine binary not found")

    probe = probe_wine_binary(resolved_binary)
    if not probe.available:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=probe.error or "Wine binary unavailable")

    executable = _resolve_executable(payload.exe_path)
    working_dir = _resolve_working_dir(payload.working_dir, executable)
    timeout_seconds = _resolve_timeout(payload.timeout_seconds)
    command = [resolved_binary, str(executable), *payload.arguments]

    run = WineRun(
        status="pending",
        exe_path=str(executable),
        arguments_json=payload.arguments,
        working_dir=str(working_dir),
        environment_json=payload.environment,
        wine_binary=settings.wine_binary_path.strip() or "wine",
        resolved_binary=resolved_binary,
        command_text=" ".join(command),
        timeout_seconds=timeout_seconds,
        create_user=actor_user_id,
        update_user=actor_user_id,
    )
    db.add(run)
    db.flush()
    db.commit()

    try:
        task = _dispatch_wine_run_task(run_id=run.id, actor_user_id=actor_user_id)
    except Exception as exc:
        _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason=f"Celery dispatch failed: {exc}")
        saved = get_run_by_id(db, run.id)
        if not saved:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Wine run save failed") from exc
        return serialize_run_detail(saved)
    run.task_id = str(task.id)
    run.update_user = actor_user_id
    run.update_date = utcnow()
    db.commit()

    saved = get_run_by_id(db, run.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Wine run save failed")
    return serialize_run_detail(saved)


def execute_run_job(*, run_id: str, actor_user_id: str | None) -> None:
    db = SessionLocal()
    try:
        run = get_run_by_id(db, run_id)
        if not run or run.status in {"success", "failed"}:
            return

        resolved_binary = run.resolved_binary or _resolve_binary()
        if not resolved_binary:
            _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason="Wine binary not found")
            return

        command = [resolved_binary, run.exe_path, *(run.arguments_json or [])]
        env = os.environ.copy()
        env.update(run.environment_json or {})

        run.status = "running"
        run.started_at = utcnow()
        run.finished_at = None
        run.error_message = None
        run.timed_out = False
        run.update_user = actor_user_id
        run.update_date = utcnow()
        db.commit()

        started_perf = time.perf_counter()
        try:
            result = subprocess.run(
                command,
                cwd=run.working_dir,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=run.timeout_seconds,
                check=False,
            )
            run.exit_code = result.returncode
            run.stdout_text = _truncate_output(result.stdout)
            run.stderr_text = _truncate_output(result.stderr)
            if result.returncode == 0:
                run.status = "success"
                run.error_message = None
            else:
                run.status = "failed"
                run.error_message = f"Wine process exited with code {result.returncode}"
        except subprocess.TimeoutExpired as exc:
            run.status = "failed"
            run.timed_out = True
            run.exit_code = None
            run.stdout_text = _truncate_output((exc.stdout or "") if isinstance(exc.stdout, str) else "")
            run.stderr_text = _truncate_output((exc.stderr or "") if isinstance(exc.stderr, str) else "")
            run.error_message = f"Execution timed out after {run.timeout_seconds} seconds"
        except OSError as exc:
            run.status = "failed"
            run.exit_code = None
            run.stdout_text = None
            run.stderr_text = None
            run.error_message = str(exc)

        run.duration_ms = max(int((time.perf_counter() - started_perf) * 1000), 0)
        run.finished_at = utcnow()
        run.update_user = actor_user_id
        run.update_date = utcnow()
        db.commit()
    finally:
        db.close()


def _mark_run_failed(
    db: Session,
    *,
    run: WineRun,
    actor_user_id: str | None,
    reason: str,
) -> None:
    run.status = "failed"
    run.error_message = reason
    run.finished_at = utcnow()
    run.duration_ms = 0 if run.duration_ms is None else run.duration_ms
    run.update_user = actor_user_id
    run.update_date = utcnow()
    db.commit()


def _dispatch_wine_run_task(*, run_id: str, actor_user_id: str | None):
    from ..tasks.wine_tasks import execute_wine_run_job

    return execute_wine_run_job.delay(run_id, actor_user_id)
