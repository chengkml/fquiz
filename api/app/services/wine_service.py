from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from ..core.config import get_settings
from ..schemas.wine import WineRunRequest, WineStatusResponse


settings = get_settings()


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


def _sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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

    try:
        process = await asyncio.create_subprocess_exec(
            resolved,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        output, _ = await asyncio.wait_for(process.communicate(), timeout=10)
    except (OSError, asyncio.TimeoutError) as exc:
        return WineStatusResponse(
            wine_binary=binary,
            resolved_binary=resolved,
            available=False,
            allowed_root=allowed_root,
            default_timeout_seconds=settings.wine_default_timeout_seconds,
            max_timeout_seconds=settings.wine_max_timeout_seconds,
            error=str(exc),
        )

    version = output.decode("utf-8", errors="replace").strip() or None
    return WineStatusResponse(
        wine_binary=binary,
        resolved_binary=resolved,
        available=process.returncode == 0,
        version=version,
        allowed_root=allowed_root,
        default_timeout_seconds=settings.wine_default_timeout_seconds,
        max_timeout_seconds=settings.wine_max_timeout_seconds,
        error=None if process.returncode == 0 else version,
    )


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()


async def stream_wine_run(payload: WineRunRequest) -> AsyncGenerator[str, None]:
    run_id = uuid4().hex
    resolved_binary = _resolve_binary()
    if not resolved_binary:
        yield _sse_event("error", {"run_id": run_id, "message": "Wine binary not found"})
        return

    try:
        executable = _resolve_executable(payload.exe_path)
        working_dir = _resolve_working_dir(payload.working_dir, executable)
        timeout_seconds = _resolve_timeout(payload.timeout_seconds)
    except HTTPException as exc:
        yield _sse_event("error", {"run_id": run_id, "message": str(exc.detail)})
        return
    command = [resolved_binary, str(executable), *payload.arguments]
    env = os.environ.copy()
    env.update(payload.environment)

    yield _sse_event(
        "start",
        {
            "run_id": run_id,
            "command": command,
            "cwd": str(working_dir),
            "timeout_seconds": timeout_seconds,
            "started_at": time.time(),
        },
    )

    process: asyncio.subprocess.Process | None = None
    timed_out = False
    deadline = time.monotonic() + timeout_seconds
    last_heartbeat = time.monotonic()

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(working_dir),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        if process.stdout is None:
            yield _sse_event("error", {"run_id": run_id, "message": "Process stdout is unavailable"})
            await _terminate_process(process)
            return

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                yield _sse_event("error", {"run_id": run_id, "message": "Execution timed out"})
                await _terminate_process(process)
                break

            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=min(0.5, remaining))
            except asyncio.TimeoutError:
                if process.returncode is not None:
                    break
                if time.monotonic() - last_heartbeat >= 15:
                    last_heartbeat = time.monotonic()
                    yield _sse_event("heartbeat", {"run_id": run_id})
                continue

            if line:
                yield _sse_event(
                    "log",
                    {
                        "run_id": run_id,
                        "message": line.decode("utf-8", errors="replace").rstrip("\r\n"),
                    },
                )
                continue
            break

        exit_code = await process.wait()
        yield _sse_event(
            "exit",
            {
                "run_id": run_id,
                "exit_code": exit_code,
                "timed_out": timed_out,
                "finished_at": time.time(),
            },
        )
    except asyncio.CancelledError:
        if process is not None:
            await _terminate_process(process)
        raise
    except OSError as exc:
        yield _sse_event("error", {"run_id": run_id, "message": str(exc)})
        if process is not None:
            await _terminate_process(process)
