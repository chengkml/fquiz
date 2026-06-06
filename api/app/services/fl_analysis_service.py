from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..models.base import utcnow
from ..models.fl_analysis import FlAnalysisJob, FlAnalysisRun, FlAnalysisTowerResult, FlAnalysisTowerSnapshot
from ..models.line import Line
from ..models.line_tower import LineTower
from ..models.tower_profile import TowerProfile
from ..models.user import User
from ..schemas.fl_analysis import (
    FlAnalysisJobCreateRequest,
    FlAnalysisJobCreateResponse,
    FlAnalysisJobDetail,
    FlAnalysisJobListResponse,
    FlAnalysisJobStartResponse,
    FlAnalysisJobSummary,
    FlAnalysisRunSummary,
    FlAnalysisTowerResultListResponse,
    FlAnalysisTowerResultSummary,
)
from .push_service import publish_topic

FL_ANALYSIS_TOPIC = "admin.fl-analysis"


def serialize_run(item: FlAnalysisRun) -> FlAnalysisRunSummary:
    return FlAnalysisRunSummary(
        id=item.id,
        job_id=item.job_id,
        status=item.status,
        runner_kind=item.runner_kind,
        engine_command=item.engine_command,
        working_dir=item.working_dir,
        error_message=item.error_message,
        snapshot_tower_count=item.snapshot_tower_count,
        result_tower_count=item.result_tower_count,
        duration_ms=item.duration_ms,
        started_at=item.started_at,
        finished_at=item.finished_at,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_job(item: FlAnalysisJob, *, include_runs: bool = False) -> FlAnalysisJobDetail | FlAnalysisJobSummary:
    line = item.line
    payload: dict[str, Any] = {
        "id": item.id,
        "line_id": item.line_id,
        "line_code": line.code if line else None,
        "line_name": line.name if line else None,
        "job_name": item.job_name,
        "job_type": item.job_type,
        "source_kind": item.source_kind,
        "status": item.status,
        "task_id": item.task_id,
        "latest_run_id": item.latest_run_id,
        "total_tower_count": item.total_tower_count,
        "snapshotted_tower_count": item.snapshotted_tower_count,
        "result_tower_count": item.result_tower_count,
        "external_adapter": item.external_adapter,
        "adapter_config_json": item.adapter_config_json or {},
        "execution_options_json": item.execution_options_json or {},
        "result_summary_json": item.result_summary_json or {},
        "error_message": item.error_message,
        "started_at": item.started_at,
        "finished_at": item.finished_at,
        "create_date": item.create_date,
        "create_user": item.create_user,
        "update_date": item.update_date,
        "update_user": item.update_user,
    }
    if include_runs:
        payload["runs"] = [serialize_run(run) for run in item.runs]
        return FlAnalysisJobDetail(**payload)
    return FlAnalysisJobSummary(**payload)


def serialize_tower_result(item: FlAnalysisTowerResult) -> FlAnalysisTowerResultSummary:
    snapshot = item.snapshot
    return FlAnalysisTowerResultSummary(
        id=item.id,
        job_id=item.job_id,
        run_id=item.run_id,
        snapshot_id=item.snapshot_id,
        tower_id=snapshot.tower_id,
        seq_no=snapshot.seq_no,
        tower_no=snapshot.tower_no,
        tower_model=snapshot.tower_model,
        tower_type=snapshot.tower_type,
        status=item.status,
        risk_level=item.risk_level,
        summary_text=item.summary_text,
        result_json=item.result_json or {},
        create_date=item.create_date,
        update_date=item.update_date,
    )


def get_job_by_id(db: Session, job_id: str) -> FlAnalysisJob | None:
    return db.execute(select(FlAnalysisJob).where(FlAnalysisJob.id == job_id)).scalar_one_or_none()


def list_jobs(
    db: Session,
    *,
    line_id: str | None,
    status_filter: str | None,
    limit: int,
) -> FlAnalysisJobListResponse:
    stmt = select(FlAnalysisJob)
    total_stmt = select(func.count()).select_from(FlAnalysisJob)

    if line_id:
        stmt = stmt.where(FlAnalysisJob.line_id == line_id)
        total_stmt = total_stmt.where(FlAnalysisJob.line_id == line_id)
    if status_filter:
        stmt = stmt.where(FlAnalysisJob.status == status_filter)
        total_stmt = total_stmt.where(FlAnalysisJob.status == status_filter)

    total = int(db.scalar(total_stmt) or 0)
    items = db.execute(
        stmt.order_by(FlAnalysisJob.update_date.desc(), FlAnalysisJob.id.desc()).limit(limit)
    ).scalars().all()
    return FlAnalysisJobListResponse(items=[serialize_job(item) for item in items], total=total)


def list_tower_results(db: Session, *, job_id: str, run_id: str | None = None) -> FlAnalysisTowerResultListResponse:
    stmt = select(FlAnalysisTowerResult).where(FlAnalysisTowerResult.job_id == job_id)
    total_stmt = select(func.count()).select_from(FlAnalysisTowerResult).where(FlAnalysisTowerResult.job_id == job_id)

    if run_id:
        stmt = stmt.where(FlAnalysisTowerResult.run_id == run_id)
        total_stmt = total_stmt.where(FlAnalysisTowerResult.run_id == run_id)

    total = int(db.scalar(total_stmt) or 0)
    items = db.execute(
        stmt.order_by(FlAnalysisTowerResult.risk_level.desc(), FlAnalysisTowerResult.create_date.asc())
    ).scalars().all()
    return FlAnalysisTowerResultListResponse(items=[serialize_tower_result(item) for item in items], total=total)


def create_job(
    db: Session,
    payload: FlAnalysisJobCreateRequest,
    *,
    actor: User,
) -> FlAnalysisJobCreateResponse:
    line = db.execute(select(Line).where(Line.id == payload.line_id)).scalar_one_or_none()
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="线路不存在")

    total_tower_count = int(
        db.scalar(
            select(func.count()).select_from(LineTower).where(LineTower.line_id == line.id)
        )
        or 0
    )
    if total_tower_count <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前线路没有可分析的杆塔数据")

    now = utcnow()
    job = FlAnalysisJob(
        line_id=line.id,
        job_name=(payload.job_name or "").strip() or None,
        job_type=payload.job_type,
        source_kind="line",
        status="pending",
        total_tower_count=total_tower_count,
        external_adapter=payload.external_adapter,
        adapter_config_json=payload.adapter_config_json or {},
        execution_options_json=payload.execution_options_json or {},
        result_summary_json={},
        create_date=now,
        create_user=actor.id,
        update_date=now,
        update_user=actor.id,
    )
    db.add(job)
    db.commit()

    saved = get_job_by_id(db, job.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="创建防雷分析任务失败")

    _publish_change(
        "fl_analysis.job.created",
        {"action": "job_created", "job_id": saved.id, "line_id": saved.line_id},
    )
    return FlAnalysisJobCreateResponse(job=serialize_job(saved, include_runs=True))


def start_job(
    db: Session,
    job_id: str,
    *,
    actor: User,
) -> FlAnalysisJobStartResponse:
    job = get_job_by_id(db, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="防雷分析任务不存在")
    if job.status in {"queued", "running"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="任务已在排队或执行中")

    try:
        task = _dispatch_fl_analysis_task(job_id=job.id)
    except Exception as exc:
        job.error_message = str(exc)
        job.update_date = utcnow()
        job.update_user = actor.id
        db.commit()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"任务派发失败: {exc}") from exc

    job.status = "queued"
    job.task_id = getattr(task, "id", None)
    job.error_message = None
    job.finished_at = None
    job.update_date = utcnow()
    job.update_user = actor.id
    db.commit()

    latest = get_job_by_id(db, job.id)
    if not latest:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="任务派发后查询失败")

    _publish_change(
        "fl_analysis.job.queued",
        {"action": "job_queued", "job_id": latest.id, "line_id": latest.line_id, "task_id": latest.task_id},
    )
    return FlAnalysisJobStartResponse(job=serialize_job(latest, include_runs=True), queued=True)


def execute_job(job_id: str) -> None:
    db = SessionLocal()
    started_perf = time.perf_counter()
    run_id: str | None = None
    try:
        job = get_job_by_id(db, job_id)
        if not job:
            return

        now = utcnow()
        job.status = "running"
        job.started_at = now
        job.finished_at = None
        job.error_message = None
        job.result_summary_json = {}
        job.update_date = now

        run = FlAnalysisRun(
            job_id=job.id,
            status="running",
            runner_kind=job.external_adapter,
            started_at=now,
            create_date=now,
            create_user=job.update_user or job.create_user,
            update_date=now,
            update_user=job.update_user or job.create_user,
        )
        db.add(run)
        db.flush()
        run_id = run.id
        job.latest_run_id = run.id
        db.commit()

        _publish_change(
            "fl_analysis.job.running",
            {"action": "job_running", "job_id": job.id, "line_id": job.line_id, "run_id": run.id},
        )

        towers = db.execute(
            select(LineTower).where(LineTower.line_id == job.line_id).order_by(LineTower.seq_no.asc())
        ).scalars().all()
        if not towers:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前线路没有可分析的杆塔数据")

        tower_ids = [tower.id for tower in towers]
        profile_rows = db.execute(select(TowerProfile).where(TowerProfile.tower_id.in_(tower_ids))).scalars().all()
        profile_map = {item.tower_id: item for item in profile_rows}

        db.execute(delete(FlAnalysisTowerResult).where(FlAnalysisTowerResult.run_id == run.id))
        db.execute(delete(FlAnalysisTowerSnapshot).where(FlAnalysisTowerSnapshot.run_id == run.id))
        db.flush()

        snapshot_count = 0
        snapshots: list[FlAnalysisTowerSnapshot] = []
        for tower in towers:
            profile = profile_map.get(tower.id)
            snapshot = FlAnalysisTowerSnapshot(
                job_id=job.id,
                run_id=run.id,
                tower_id=tower.id,
                seq_no=tower.seq_no,
                tower_no=tower.tower_no,
                tower_model=tower.tower_model,
                tower_type=tower.tower_type,
                longitude=tower.longitude,
                latitude=tower.latitude,
                altitude_m=tower.altitude_m,
                terrain=tower.terrain,
                base_tower_json=_build_base_tower_json(tower),
                profile_json=_build_profile_json(profile),
                create_date=utcnow(),
            )
            db.add(snapshot)
            snapshots.append(snapshot)
            snapshot_count += 1

        db.flush()

        result_count = 0
        summary = _new_result_summary()
        tower_map = {tower.id: tower for tower in towers}
        for snapshot in snapshots:
            graded = _grade_snapshot_payload(
                {
                    "base_tower_json": snapshot.base_tower_json or {},
                    "profile_json": snapshot.profile_json or {},
                }
            )
            db.add(
                FlAnalysisTowerResult(
                    job_id=job.id,
                    run_id=run.id,
                    snapshot_id=snapshot.id,
                    status="success",
                    risk_level=graded["risk_level"],
                    summary_text=graded["summary_text"],
                    result_json=graded,
                    create_date=utcnow(),
                    update_date=utcnow(),
                )
            )
            result_count += 1
            _accumulate_result_summary(summary, graded)

            tower = tower_map.get(snapshot.tower_id)
            if tower is not None:
                tower.risk_level = graded["risk_level"]
                tower.update_date = utcnow()
                tower.update_user = job.update_user or job.create_user

        run.snapshot_tower_count = snapshot_count
        run.result_tower_count = result_count
        job.total_tower_count = len(towers)
        job.snapshotted_tower_count = snapshot_count
        job.result_tower_count = result_count
        db.commit()

        _finish_rule_based_run(
            db,
            job_id=job.id,
            run_id=run.id,
            started_perf=started_perf,
            summary=summary,
        )

    except Exception as exc:
        db.rollback()
        if run_id is not None:
            _mark_run_failed(db, job_id=job_id, run_id=run_id, error_message=str(exc), started_perf=started_perf)
        else:
            _mark_job_failed_without_run(db, job_id=job_id, error_message=str(exc))
    finally:
        db.close()


def _dispatch_fl_analysis_task(*, job_id: str):
    from ..tasks.fl_analysis_tasks import execute_fl_analysis_job

    return execute_fl_analysis_job.delay(job_id)


def _finish_rule_based_run(
    db: Session,
    *,
    job_id: str,
    run_id: str,
    started_perf: float,
    summary: dict[str, Any],
) -> None:
    job = get_job_by_id(db, job_id)
    run = db.execute(select(FlAnalysisRun).where(FlAnalysisRun.id == run_id)).scalar_one_or_none()
    if not job or not run:
        return

    duration_ms = int((time.perf_counter() - started_perf) * 1000)
    now = utcnow()

    run.status = "success"
    run.error_message = None
    run.duration_ms = max(duration_ms, 0)
    run.finished_at = now
    run.update_date = now

    job.status = "success"
    job.error_message = None
    job.result_summary_json = {
        **summary,
        "adapter_status": "computed",
        "external_adapter": job.external_adapter,
    }
    job.finished_at = now
    job.update_date = now
    db.commit()

    _publish_change(
        "fl_analysis.job.success",
        {
            "action": "job_success",
            "job_id": job.id,
            "line_id": job.line_id,
            "run_id": run.id,
            "summary": job.result_summary_json,
        },
    )


def _mark_run_failed(
    db: Session,
    *,
    job_id: str,
    run_id: str,
    error_message: str,
    started_perf: float,
) -> None:
    run = db.execute(select(FlAnalysisRun).where(FlAnalysisRun.id == run_id)).scalar_one_or_none()
    job = get_job_by_id(db, job_id)
    if not run or not job:
        return

    duration_ms = int((time.perf_counter() - started_perf) * 1000)
    now = utcnow()
    run.status = "failed"
    run.error_message = error_message
    run.duration_ms = max(duration_ms, 0)
    run.finished_at = now
    run.update_date = now

    job.status = "failed"
    job.error_message = error_message
    job.finished_at = now
    job.update_date = now
    db.commit()

    _publish_change(
        "fl_analysis.job.failed",
        {"action": "job_failed", "job_id": job.id, "line_id": job.line_id, "run_id": run.id},
    )


def _mark_job_failed_without_run(db: Session, *, job_id: str, error_message: str) -> None:
    job = get_job_by_id(db, job_id)
    if not job:
        return
    now = utcnow()
    job.status = "failed"
    job.error_message = error_message
    job.finished_at = now
    job.update_date = now
    db.commit()

    _publish_change(
        "fl_analysis.job.failed",
        {"action": "job_failed", "job_id": job.id, "line_id": job.line_id},
    )


def _build_base_tower_json(tower: LineTower) -> dict[str, Any]:
    return {
        "tower_id": tower.id,
        "line_id": tower.line_id,
        "seq_no": tower.seq_no,
        "tower_no": tower.tower_no,
        "tower_model": tower.tower_model,
        "tower_type": tower.tower_type,
        "longitude": tower.longitude,
        "latitude": tower.latitude,
        "altitude_m": tower.altitude_m,
        "terrain": tower.terrain,
        "ground_resistance_ohm": tower.ground_resistance_ohm,
        "lightning_density": tower.lightning_density,
        "span_small_m": tower.span_small_m,
        "span_large_m": tower.span_large_m,
        "slope_1": tower.slope_1,
        "slope_2": tower.slope_2,
        "risk_level": tower.risk_level,
        "circuit_geometry_json": tower.circuit_geometry_json or {},
        "lightning_result_json": tower.lightning_result_json or {},
        "raw_extra_json": tower.raw_extra_json or {},
    }


def _build_profile_json(profile: TowerProfile | None) -> dict[str, Any]:
    if profile is None:
        return {}
    return {
        "phase_sequence_1": profile.phase_sequence_1,
        "phase_sequence_2": profile.phase_sequence_2,
        "phase_sequence_3": profile.phase_sequence_3,
        "phase_sequence_4": profile.phase_sequence_4,
        "arrester_a": profile.arrester_a,
        "arrester_b": profile.arrester_b,
        "arrester_c": profile.arrester_c,
        "protection_angle_left_deg": profile.protection_angle_left_deg,
        "protection_angle_right_deg": profile.protection_angle_right_deg,
        "shield_wire_height_m": profile.shield_wire_height_m,
        "insulator_length_m": profile.insulator_length_m,
        "call_height_m": profile.call_height_m,
        "angle_deg": profile.angle_deg,
        "current_a": profile.current_a,
        "current_b": profile.current_b,
        "structure_kind": profile.structure_kind,
        "stroke_mode": profile.stroke_mode,
        "current_type": profile.current_type,
        "current_head_time_us": profile.current_head_time_us,
        "current_tail_time_us": profile.current_tail_time_us,
        "geometry_layers_json": profile.geometry_layers_json or {},
        "extra_profile_json": profile.extra_profile_json or {},
    }


def _grade_snapshot_payload(payload: dict[str, Any]) -> dict[str, Any]:
    base = payload.get("base_tower_json") or {}
    profile = payload.get("profile_json") or {}

    score = 0
    causes: list[str] = []
    recommendations: list[str] = []

    ground_resistance = _as_float(base.get("ground_resistance_ohm"))
    lightning_density = _as_float(base.get("lightning_density"))
    span_large = _as_float(base.get("span_large_m"))
    tower_type = str(base.get("tower_type") or profile.get("structure_kind") or "")
    stroke_mode = str(profile.get("stroke_mode") or "")
    arrester_values = [profile.get("arrester_a"), profile.get("arrester_b"), profile.get("arrester_c")]

    if ground_resistance is not None:
        if ground_resistance >= 30:
            score += 35
            causes.append("接地电阻偏高")
            recommendations.append("优先降低接地电阻，复核接地网与冲击接地通道")
        elif ground_resistance >= 15:
            score += 18
            causes.append("接地电阻偏高趋势明显")

    if lightning_density is not None:
        if lightning_density >= 6:
            score += 25
            causes.append("地闪密度较高")
            recommendations.append("按高雷区口径校核绝缘与屏蔽配置")
        elif lightning_density >= 3:
            score += 12
            causes.append("地闪密度中等偏高")

    if span_large is not None:
        if span_large >= 500:
            score += 20
            causes.append("大号侧档距过大")
            recommendations.append("复核大跨距杆塔绝缘配合与防雷保护")
        elif span_large >= 300:
            score += 10
            causes.append("档距偏大")

    if "耐张" in tower_type:
        score += 10
        causes.append("耐张杆塔参数更敏感")

    if "反击" in stroke_mode:
        score += 10
        causes.append("当前以反击风险为主")
        recommendations.append("优先关注反击耐雷水平与接地改造")

    if any(str(value or "").strip() in {"否", "无", "未装", "0"} for value in arrester_values):
        score += 15
        causes.append("避雷器配置不足")
        recommendations.append("补充关键相避雷器并复核安装位置")

    score = min(score, 100)
    if score >= 80:
        risk_level = "high"
    elif score >= 45:
        risk_level = "medium"
    else:
        risk_level = "low"

    if not causes:
        causes.append("主要输入参数处于低风险区间")
    if not recommendations:
        recommendations.append("维持现有防雷配置并保持常规巡检")

    cause_analysis = "；".join(dict.fromkeys(causes))
    mitigation_recommendation = "；".join(dict.fromkeys(recommendations))
    tower_no = str(base.get("tower_no") or "")
    summary_text = f"{tower_no or '当前杆塔'}评估为{risk_level}风险，综合得分{score}"

    return {
        "risk_level": risk_level,
        "score": score,
        "cause_analysis": cause_analysis,
        "mitigation_recommendation": mitigation_recommendation,
        "summary_text": summary_text,
        "inputs": {
            "ground_resistance_ohm": ground_resistance,
            "lightning_density": lightning_density,
            "span_large_m": span_large,
            "tower_type": tower_type,
            "stroke_mode": stroke_mode,
        },
    }


def _new_result_summary() -> dict[str, Any]:
    return {
        "risk_counts": {"high": 0, "medium": 0, "low": 0},
        "score_total": 0,
        "score_average": 0,
    }


def _accumulate_result_summary(summary: dict[str, Any], graded: dict[str, Any]) -> None:
    risk_counts = summary.setdefault("risk_counts", {"high": 0, "medium": 0, "low": 0})
    risk_level = str(graded.get("risk_level") or "low")
    risk_counts[risk_level] = int(risk_counts.get(risk_level, 0)) + 1

    score = int(graded.get("score") or 0)
    summary["score_total"] = int(summary.get("score_total", 0)) + score
    total_count = sum(int(value) for value in risk_counts.values())
    summary["score_average"] = round(summary["score_total"] / total_count, 2) if total_count else 0


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _placeholder_message_for_adapter(adapter: str) -> str:
    if adapter == "wine":
        return "Wine 外部程序适配器已预留，真实执行链路尚未接入"
    if adapter == "atp":
        return "ATP 适配器已预留，真实执行链路尚未接入"
    if adapter == "custom":
        return "自定义外部程序适配器已预留，真实执行链路尚未接入"
    return "外部分析适配器尚未接入，当前仅完成任务骨架与快照链路"


def _publish_change(event_name: str, payload: dict[str, Any]) -> None:
    _fire_and_forget(
        publish_topic(
            FL_ANALYSIS_TOPIC,
            name=event_name,
            payload=payload,
            requires_refetch=[],
            dedupe_key=f"fl-analysis:{event_name}:{payload.get('job_id', '-')}:"
            f"{payload.get('run_id', payload.get('line_id', '-'))}",
        )
    )


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)