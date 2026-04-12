from __future__ import annotations

import asyncio
import hashlib
import time
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.model_registry import (
    ModelApiKey,
    ModelHealthCheck,
    ModelRegistry,
    ModelRouteRule,
    ModelTestRun,
    ModelUsageLog,
)
from ..models.user import User
from ..schemas.model_registry import (
    ModelApiKeyListResponse,
    ModelApiKeyPublic,
    ModelCreateRequest,
    ModelHealthCheckListResponse,
    ModelHealthCheckPublic,
    ModelListResponse,
    ModelRegistryPublic,
    ModelRotateKeyRequest,
    ModelRouteRuleCreateRequest,
    ModelRouteRuleListResponse,
    ModelRouteRulePublic,
    ModelRouteRuleUpdateRequest,
    ModelSummaryResponse,
    ModelTestRunListResponse,
    ModelTestRunPublic,
    ModelTestRunRequest,
    ModelTestSummary,
    ModelTransitionRequest,
    ModelUpdateRequest,
    ModelUsageIngestRequest,
    ModelUsageSummary,
)
from .push_service import publish_topic

MODEL_TOPIC = "admin.models"
GLOBAL_ROUTE_KEY = "__global__"
VALID_STATUSES = ("DRAFT", "ENABLED", "DISABLED", "DEPRECATED")
VALID_ROUTE_TYPES = ("GLOBAL", "CAPABILITY", "BUSINESS", "AGENT")
MODEL_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"ENABLED", "DISABLED", "DEPRECATED"},
    "ENABLED": {"DISABLED", "DEPRECATED"},
    "DISABLED": {"ENABLED", "DEPRECATED"},
    "DEPRECATED": {"DISABLED"},
}


def list_models(db: Session, *, status_filter: str | None, keyword: str | None) -> ModelListResponse:
    stmt = select(ModelRegistry)

    if status_filter:
        normalized_status = status_filter.strip().upper()
        if normalized_status not in VALID_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status filter: {status_filter}")
        stmt = stmt.where(ModelRegistry.status == normalized_status)

    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                ModelRegistry.code.ilike(like),
                ModelRegistry.name.ilike(like),
                ModelRegistry.provider.ilike(like),
                ModelRegistry.provider_model.ilike(like),
            )
        )

    models = db.execute(stmt.order_by(ModelRegistry.updated_at.desc(), ModelRegistry.id.desc())).scalars().all()
    metrics = _collect_model_metrics(db, models)
    return ModelListResponse(
        items=[_serialize_model(model, metrics) for model in models],
        total=len(models),
    )


def get_model_summary(db: Session) -> ModelSummaryResponse:
    status_counts = {status_code: 0 for status_code in VALID_STATUSES}
    for row in db.execute(select(ModelRegistry.status, func.count()).group_by(ModelRegistry.status)).all():
        status_counts[str(row[0])] = int(row[1])

    route_type_counts = {route_type: 0 for route_type in VALID_ROUTE_TYPES}
    for row in db.execute(select(ModelRouteRule.route_type, func.count()).group_by(ModelRouteRule.route_type)).all():
        route_type_counts[str(row[0])] = int(row[1])

    usage_7d = _aggregate_usage_7d(
        db,
        model_codes=None,
    )
    tests_7d = _aggregate_tests_7d(
        db,
        model_ids=None,
    )

    enabled_models = db.execute(
        select(ModelRegistry.id).where(ModelRegistry.status == "ENABLED")
    ).scalars().all()
    enabled_without_healthy_check = _count_enabled_without_healthy(db, enabled_models)

    total_models = db.scalar(select(func.count()).select_from(ModelRegistry)) or 0
    total_route_rules = db.scalar(select(func.count()).select_from(ModelRouteRule)) or 0

    return ModelSummaryResponse(
        total_models=int(total_models),
        status_counts=status_counts,
        total_route_rules=int(total_route_rules),
        route_type_counts=route_type_counts,
        enabled_without_healthy_check=enabled_without_healthy_check,
        usage_7d=usage_7d,
        tests_7d=tests_7d,
    )


def get_model_detail(db: Session, model_id: int) -> ModelRegistryPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    metrics = _collect_model_metrics(db, [model])
    return _serialize_model(model, metrics)


def create_model(db: Session, payload: ModelCreateRequest, *, actor: User) -> ModelRegistryPublic:
    code = _normalize_code(payload.code)
    existing = db.scalar(select(ModelRegistry.id).where(ModelRegistry.code == code))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate model code")

    model = ModelRegistry(
        code=code,
        name=payload.name.strip(),
        provider=payload.provider.strip(),
        provider_model=payload.provider_model.strip(),
        status=payload.status,
        capabilities=_normalize_capabilities(payload.capabilities),
        description=payload.description.strip(),
        base_url=_normalize_nullable_str(payload.base_url),
    )

    db.add(model)
    db.flush()

    if payload.api_key:
        _rotate_model_key_internal(db, model=model, raw_key=payload.api_key, actor_user_id=actor.id, note="initial")

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Model create failed due to duplicate or invalid data")

    saved = _get_model_by_id(db, model.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Model save failed")

    _publish_model_changed("created", model=saved)
    return get_model_detail(db, saved.id)


def update_model(db: Session, model_id: int, payload: ModelUpdateRequest) -> ModelRegistryPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return get_model_detail(db, model_id)

    if "name" in update_data:
        model.name = str(update_data["name"]).strip()
    if "provider" in update_data:
        model.provider = str(update_data["provider"]).strip()
    if "provider_model" in update_data:
        model.provider_model = str(update_data["provider_model"]).strip()
    if "capabilities" in update_data:
        model.capabilities = _normalize_capabilities(update_data["capabilities"])
    if "description" in update_data:
        model.description = str(update_data["description"] or "").strip()
    if "base_url" in update_data:
        model.base_url = _normalize_nullable_str(update_data["base_url"])

    db.commit()

    saved = _get_model_by_id(db, model_id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Model load failed")

    _publish_model_changed("updated", model=saved)
    return get_model_detail(db, model_id)


def transition_model_status(
    db: Session,
    model_id: int,
    payload: ModelTransitionRequest,
    *,
    actor: User,
) -> ModelRegistryPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    current_status = model.status
    target_status = payload.status
    if current_status == target_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is unchanged")

    allowed = MODEL_STATUS_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transition not allowed: {current_status} -> {target_status}",
        )

    if target_status == "ENABLED":
        active_key_exists = db.scalar(
            select(ModelApiKey.id).where(
                ModelApiKey.model_id == model.id,
                ModelApiKey.is_active.is_(True),
            )
        )
        if active_key_exists is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Active API key is required before enabling model")

    model.status = target_status
    db.commit()

    saved = _get_model_by_id(db, model_id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Model load failed")

    _publish_model_changed(
        "status_transitioned",
        model=saved,
        extra_payload={
            "from_status": current_status,
            "to_status": target_status,
            "note": _normalize_nullable_str(payload.note),
            "actor_user_id": actor.id,
        },
    )
    return get_model_detail(db, model_id)


def delete_model(db: Session, model_id: int) -> None:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    if model.status == "ENABLED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enabled model cannot be deleted; disable or deprecate first")

    bound_rules = db.execute(
        select(ModelRouteRule)
        .where(ModelRouteRule.target_model_code == model.code)
        .order_by(ModelRouteRule.route_type.asc(), ModelRouteRule.route_key.asc())
    ).scalars().all()
    if bound_rules:
        refs = [f"{rule.route_type}:{rule.route_key}" for rule in bound_rules[:5]]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model is referenced by {len(bound_rules)} route rule(s): {', '.join(refs)}",
        )

    deleted_model_id = model.id
    deleted_model_code = model.code
    db.delete(model)
    db.commit()

    _fire_and_forget(
        publish_topic(
            MODEL_TOPIC,
            name="models.changed",
            payload={"action": "deleted", "model_id": deleted_model_id, "model_code": deleted_model_code},
            requires_refetch=["/api/v1/admin/models", "/api/v1/admin/models/summary", "/api/v1/admin/model-routes"],
            dedupe_key=f"models:deleted:{deleted_model_id}",
        )
    )


def list_model_keys(db: Session, model_id: int) -> ModelApiKeyListResponse:
    _require_model_exists(db, model_id)
    keys = db.execute(
        select(ModelApiKey)
        .where(ModelApiKey.model_id == model_id)
        .order_by(ModelApiKey.version.desc(), ModelApiKey.id.desc())
    ).scalars().all()
    return ModelApiKeyListResponse(items=[_serialize_key(item) for item in keys], total=len(keys))


def rotate_model_key(
    db: Session,
    model_id: int,
    payload: ModelRotateKeyRequest,
    *,
    actor: User,
) -> ModelApiKeyPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    rotated = _rotate_model_key_internal(
        db,
        model=model,
        raw_key=payload.api_key,
        actor_user_id=actor.id,
        note=_normalize_nullable_str(payload.note),
    )
    db.commit()

    _publish_model_changed(
        "key_rotated",
        model=model,
        extra_payload={"key_version": rotated.version, "actor_user_id": actor.id},
    )
    return _serialize_key(rotated)


def run_model_health_check(db: Session, model_id: int) -> ModelHealthCheckPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    start = time.perf_counter()
    active_key = _get_active_key(db, model.id)
    route_count = int(
        db.scalar(
            select(func.count())
            .select_from(ModelRouteRule)
            .where(
                ModelRouteRule.target_model_code == model.code,
                ModelRouteRule.enabled.is_(True),
            )
        )
        or 0
    )
    status_value, reason, detail = _evaluate_health(model=model, has_active_key=active_key is not None, route_count=route_count)
    latency_ms = int((time.perf_counter() - start) * 1000)

    check = ModelHealthCheck(
        model_id=model.id,
        status=status_value,
        reason=reason,
        latency_ms=latency_ms,
        detail_json=detail,
    )
    db.add(check)
    db.commit()

    _publish_model_changed(
        "health_checked",
        model=model,
        extra_payload={"health_status": check.status, "health_reason": check.reason},
    )
    return _serialize_health_check(check)


def list_model_health_checks(db: Session, model_id: int, *, limit: int = 20) -> ModelHealthCheckListResponse:
    _require_model_exists(db, model_id)
    checks = db.execute(
        select(ModelHealthCheck)
        .where(ModelHealthCheck.model_id == model_id)
        .order_by(ModelHealthCheck.id.desc())
        .limit(max(1, min(limit, 100)))
    ).scalars().all()
    return ModelHealthCheckListResponse(
        items=[_serialize_health_check(item) for item in checks],
        total=len(checks),
    )


def run_model_test(
    db: Session,
    model_id: int,
    payload: ModelTestRunRequest,
    *,
    actor: User,
) -> ModelTestRunPublic:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    start = time.perf_counter()
    active_key = _get_active_key(db, model.id)

    passed = model.status == "ENABLED" and active_key is not None
    error_message = None
    if not passed:
        if model.status != "ENABLED":
            error_message = f"Model status is {model.status}; expected ENABLED"
        elif active_key is None:
            error_message = "No active API key"
        else:
            error_message = "Unknown test failure"

    latency_ms = int((time.perf_counter() - start) * 1000)
    status_value = "PASSED" if passed else "FAILED"

    test_run = ModelTestRun(
        model_id=model.id,
        kind=payload.kind.strip().upper(),
        status=status_value,
        input_tokens=payload.input_tokens,
        output_tokens=payload.output_tokens,
        latency_ms=latency_ms,
        error_message=error_message,
        created_by_user_id=actor.id,
    )
    db.add(test_run)

    total_tokens = payload.input_tokens + payload.output_tokens
    usage_log = ModelUsageLog(
        model_code=model.code,
        source="TEST",
        request_count=1,
        success_count=1 if passed else 0,
        total_tokens=total_tokens,
        total_cost_usd=Decimal("0"),
    )
    db.add(usage_log)

    db.commit()

    _publish_model_changed(
        "tested",
        model=model,
        extra_payload={
            "test_status": status_value,
            "test_id": test_run.id,
            "actor_user_id": actor.id,
        },
    )
    return _serialize_test_run(test_run, model_code=model.code)


def list_model_tests(db: Session, model_id: int, *, limit: int = 20) -> ModelTestRunListResponse:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    tests = db.execute(
        select(ModelTestRun)
        .where(ModelTestRun.model_id == model.id)
        .order_by(ModelTestRun.id.desc())
        .limit(max(1, min(limit, 100)))
    ).scalars().all()
    return ModelTestRunListResponse(
        items=[_serialize_test_run(item, model_code=model.code) for item in tests],
        total=len(tests),
    )


def ingest_model_usage(db: Session, payload: ModelUsageIngestRequest) -> dict[str, bool]:
    if payload.success_count > payload.request_count:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="success_count cannot be greater than request_count")

    model_code = _normalize_code(payload.model_code)
    exists = db.scalar(select(ModelRegistry.id).where(ModelRegistry.code == model_code))
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model code not found")

    total_cost = _to_decimal(payload.total_cost_usd)
    log = ModelUsageLog(
        model_code=model_code,
        source=payload.source.strip().upper(),
        request_count=payload.request_count,
        success_count=payload.success_count,
        total_tokens=payload.total_tokens,
        total_cost_usd=total_cost,
    )
    db.add(log)
    db.commit()

    _fire_and_forget(
        publish_topic(
            MODEL_TOPIC,
            name="models.usage_ingested",
            payload={"model_code": model_code, "request_count": payload.request_count},
            requires_refetch=["/api/v1/admin/models", "/api/v1/admin/models/summary"],
            dedupe_key=f"models:usage:{model_code}",
        )
    )
    return {"success": True}


def list_route_rules(db: Session) -> ModelRouteRuleListResponse:
    rules = db.execute(
        select(ModelRouteRule)
        .order_by(ModelRouteRule.route_type.asc(), ModelRouteRule.priority.asc(), ModelRouteRule.id.asc())
    ).scalars().all()
    return ModelRouteRuleListResponse(items=[_serialize_route_rule(item) for item in rules], total=len(rules))


def create_route_rule(db: Session, payload: ModelRouteRuleCreateRequest) -> ModelRouteRulePublic:
    route_type = payload.route_type
    route_key = _normalize_route_key(route_type, payload.route_key)
    target_model_code = _normalize_code(payload.target_model_code)

    _require_target_model_routable(db, target_model_code)

    existing = db.scalar(
        select(ModelRouteRule.id).where(
            ModelRouteRule.route_type == route_type,
            ModelRouteRule.route_key == route_key,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Route rule already exists")

    rule = ModelRouteRule(
        route_type=route_type,
        route_key=route_key,
        target_model_code=target_model_code,
        priority=payload.priority,
        enabled=payload.enabled,
        note=_normalize_nullable_str(payload.note),
    )
    db.add(rule)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Route rule create failed")

    _publish_route_changed("created", rule=rule)
    return _serialize_route_rule(rule)


def update_route_rule(db: Session, route_rule_id: int, payload: ModelRouteRuleUpdateRequest) -> ModelRouteRulePublic:
    rule = db.execute(select(ModelRouteRule).where(ModelRouteRule.id == route_rule_id)).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route rule not found")

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _serialize_route_rule(rule)

    next_route_type = update_data.get("route_type", rule.route_type)
    next_route_key_raw = update_data.get("route_key", rule.route_key)
    next_route_key = _normalize_route_key(next_route_type, next_route_key_raw)

    existing = db.scalar(
        select(ModelRouteRule.id).where(
            ModelRouteRule.route_type == next_route_type,
            ModelRouteRule.route_key == next_route_key,
            ModelRouteRule.id != rule.id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Route rule already exists")

    rule.route_type = next_route_type
    rule.route_key = next_route_key

    if "target_model_code" in update_data:
        target_model_code = _normalize_code(str(update_data["target_model_code"]))
        _require_target_model_routable(db, target_model_code)
        rule.target_model_code = target_model_code

    if "priority" in update_data:
        rule.priority = int(update_data["priority"])
    if "enabled" in update_data:
        rule.enabled = bool(update_data["enabled"])
    if "note" in update_data:
        rule.note = _normalize_nullable_str(update_data["note"])

    db.commit()
    _publish_route_changed("updated", rule=rule)
    return _serialize_route_rule(rule)


def delete_route_rule(db: Session, route_rule_id: int) -> dict[str, bool]:
    rule = db.execute(select(ModelRouteRule).where(ModelRouteRule.id == route_rule_id)).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route rule not found")

    deleted_rule_id = rule.id
    deleted_route_type = rule.route_type
    deleted_route_key = rule.route_key
    db.delete(rule)
    db.commit()

    _fire_and_forget(
        publish_topic(
            MODEL_TOPIC,
            name="model_routes.changed",
            payload={
                "action": "deleted",
                "route_rule_id": deleted_rule_id,
                "route_type": deleted_route_type,
                "route_key": deleted_route_key,
            },
            requires_refetch=["/api/v1/admin/model-routes", "/api/v1/admin/models", "/api/v1/admin/models/summary"],
            dedupe_key=f"model_routes:deleted:{deleted_rule_id}",
        )
    )
    return {"success": True}


def _collect_model_metrics(db: Session, models: list[ModelRegistry]) -> dict[str, dict]:
    if not models:
        return {
            "active_keys": {},
            "latest_health": {},
            "route_counts": {},
            "usage_7d": {},
            "tests_7d": {},
        }

    model_ids = [model.id for model in models]
    model_codes = [model.code for model in models]

    active_key_map: dict[int, ModelApiKey] = {}
    for key in db.execute(
        select(ModelApiKey).where(
            ModelApiKey.model_id.in_(model_ids),
            ModelApiKey.is_active.is_(True),
        )
    ).scalars().all():
        current = active_key_map.get(key.model_id)
        if current is None or key.version > current.version:
            active_key_map[key.model_id] = key

    latest_health_map: dict[int, ModelHealthCheck] = {}
    latest_health_subq = (
        select(
            ModelHealthCheck.model_id,
            func.max(ModelHealthCheck.id).label("max_id"),
        )
        .where(ModelHealthCheck.model_id.in_(model_ids))
        .group_by(ModelHealthCheck.model_id)
        .subquery()
    )
    for check in db.execute(
        select(ModelHealthCheck).join(
            latest_health_subq,
            ModelHealthCheck.id == latest_health_subq.c.max_id,
        )
    ).scalars().all():
        latest_health_map[check.model_id] = check

    route_counts = {
        str(row[0]): int(row[1])
        for row in db.execute(
            select(ModelRouteRule.target_model_code, func.count())
            .where(ModelRouteRule.target_model_code.in_(model_codes))
            .group_by(ModelRouteRule.target_model_code)
        ).all()
    }

    usage_7d_map = _aggregate_usage_7d(db, model_codes=model_codes, by_model=True)
    tests_7d_map = _aggregate_tests_7d(db, model_ids=model_ids, by_model=True)

    return {
        "active_keys": active_key_map,
        "latest_health": latest_health_map,
        "route_counts": route_counts,
        "usage_7d": usage_7d_map,
        "tests_7d": tests_7d_map,
    }


def _serialize_model(model: ModelRegistry, metrics: dict[str, dict]) -> ModelRegistryPublic:
    active_key = metrics["active_keys"].get(model.id)
    latest_health = metrics["latest_health"].get(model.id)
    usage_7d = metrics["usage_7d"].get(model.code, ModelUsageSummary())
    tests_7d = metrics["tests_7d"].get(model.id, ModelTestSummary())

    return ModelRegistryPublic(
        id=model.id,
        code=model.code,
        name=model.name,
        provider=model.provider,
        provider_model=model.provider_model,
        status=model.status,
        capabilities=list(model.capabilities or []),
        description=model.description,
        base_url=model.base_url,
        active_key_masked=active_key.secret_masked if active_key else None,
        active_key_version=active_key.version if active_key else None,
        active_key_fingerprint=active_key.secret_fingerprint if active_key else None,
        active_key_rotated_at=active_key.created_at if active_key else None,
        latest_health_status=latest_health.status if latest_health else None,
        latest_health_reason=latest_health.reason if latest_health else None,
        latest_health_at=latest_health.created_at if latest_health else None,
        route_bindings_count=int(metrics["route_counts"].get(model.code, 0)),
        usage_7d=usage_7d,
        tests_7d=tests_7d,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _aggregate_usage_7d(
    db: Session,
    *,
    model_codes: list[str] | None,
    by_model: bool = False,
) -> ModelUsageSummary | dict[str, ModelUsageSummary]:
    since = utcnow() - timedelta(days=7)
    if by_model:
        if not model_codes:
            return {}

        rows = db.execute(
            select(
                ModelUsageLog.model_code,
                func.coalesce(func.sum(ModelUsageLog.request_count), 0),
                func.coalesce(func.sum(ModelUsageLog.success_count), 0),
                func.coalesce(func.sum(ModelUsageLog.total_tokens), 0),
                func.coalesce(func.sum(ModelUsageLog.total_cost_usd), Decimal("0")),
            )
            .where(
                ModelUsageLog.model_code.in_(model_codes),
                ModelUsageLog.recorded_at >= since,
            )
            .group_by(ModelUsageLog.model_code)
        ).all()

        result: dict[str, ModelUsageSummary] = {}
        for row in rows:
            model_code = str(row[0])
            request_count = int(row[1] or 0)
            success_count = int(row[2] or 0)
            total_tokens = int(row[3] or 0)
            total_cost = float(row[4] or 0)
            success_rate = round(success_count / request_count, 4) if request_count > 0 else None
            result[model_code] = ModelUsageSummary(
                request_count=request_count,
                success_count=success_count,
                total_tokens=total_tokens,
                total_cost_usd=total_cost,
                success_rate=success_rate,
            )
        return result

    row = db.execute(
        select(
            func.coalesce(func.sum(ModelUsageLog.request_count), 0),
            func.coalesce(func.sum(ModelUsageLog.success_count), 0),
            func.coalesce(func.sum(ModelUsageLog.total_tokens), 0),
            func.coalesce(func.sum(ModelUsageLog.total_cost_usd), Decimal("0")),
        ).where(ModelUsageLog.recorded_at >= since)
    ).one()

    request_count = int(row[0] or 0)
    success_count = int(row[1] or 0)
    total_tokens = int(row[2] or 0)
    total_cost = float(row[3] or 0)
    return ModelUsageSummary(
        request_count=request_count,
        success_count=success_count,
        total_tokens=total_tokens,
        total_cost_usd=total_cost,
        success_rate=round(success_count / request_count, 4) if request_count > 0 else None,
    )


def _aggregate_tests_7d(
    db: Session,
    *,
    model_ids: list[int] | None,
    by_model: bool = False,
) -> ModelTestSummary | dict[int, ModelTestSummary]:
    since = utcnow() - timedelta(days=7)

    passed_case = case((ModelTestRun.status == "PASSED", 1), else_=0)
    failed_case = case((ModelTestRun.status == "FAILED", 1), else_=0)

    if by_model:
        if not model_ids:
            return {}

        rows = db.execute(
            select(
                ModelTestRun.model_id,
                func.count(ModelTestRun.id),
                func.coalesce(func.sum(passed_case), 0),
                func.coalesce(func.sum(failed_case), 0),
            )
            .where(
                ModelTestRun.model_id.in_(model_ids),
                ModelTestRun.created_at >= since,
            )
            .group_by(ModelTestRun.model_id)
        ).all()

        result: dict[int, ModelTestSummary] = {}
        for row in rows:
            model_id = int(row[0])
            total_runs = int(row[1] or 0)
            passed_runs = int(row[2] or 0)
            failed_runs = int(row[3] or 0)
            result[model_id] = ModelTestSummary(
                total_runs=total_runs,
                passed_runs=passed_runs,
                failed_runs=failed_runs,
                pass_rate=round(passed_runs / total_runs, 4) if total_runs > 0 else None,
            )
        return result

    row = db.execute(
        select(
            func.count(ModelTestRun.id),
            func.coalesce(func.sum(passed_case), 0),
            func.coalesce(func.sum(failed_case), 0),
        ).where(ModelTestRun.created_at >= since)
    ).one()

    total_runs = int(row[0] or 0)
    passed_runs = int(row[1] or 0)
    failed_runs = int(row[2] or 0)
    return ModelTestSummary(
        total_runs=total_runs,
        passed_runs=passed_runs,
        failed_runs=failed_runs,
        pass_rate=round(passed_runs / total_runs, 4) if total_runs > 0 else None,
    )


def _count_enabled_without_healthy(db: Session, enabled_model_ids: list[int]) -> int:
    if not enabled_model_ids:
        return 0

    latest_subq = (
        select(
            ModelHealthCheck.model_id,
            func.max(ModelHealthCheck.id).label("max_id"),
        )
        .where(ModelHealthCheck.model_id.in_(enabled_model_ids))
        .group_by(ModelHealthCheck.model_id)
        .subquery()
    )

    latest_checks = db.execute(
        select(ModelHealthCheck).join(latest_subq, ModelHealthCheck.id == latest_subq.c.max_id)
    ).scalars().all()
    latest_map = {item.model_id: item for item in latest_checks}

    total = 0
    for model_id in enabled_model_ids:
        latest = latest_map.get(model_id)
        if not latest or latest.status != "HEALTHY":
            total += 1
    return total


def _serialize_key(item: ModelApiKey) -> ModelApiKeyPublic:
    return ModelApiKeyPublic(
        id=item.id,
        model_id=item.model_id,
        version=item.version,
        secret_masked=item.secret_masked,
        secret_fingerprint=item.secret_fingerprint,
        is_active=item.is_active,
        rotation_note=item.rotation_note,
        created_by_user_id=item.created_by_user_id,
        created_at=item.created_at,
    )


def _serialize_health_check(item: ModelHealthCheck) -> ModelHealthCheckPublic:
    return ModelHealthCheckPublic(
        id=item.id,
        model_id=item.model_id,
        status=item.status,
        reason=item.reason,
        latency_ms=item.latency_ms,
        detail_json=item.detail_json,
        created_at=item.created_at,
    )


def _serialize_test_run(item: ModelTestRun, *, model_code: str) -> ModelTestRunPublic:
    return ModelTestRunPublic(
        id=item.id,
        model_id=item.model_id,
        model_code=model_code,
        kind=item.kind,
        status=item.status,
        input_tokens=item.input_tokens,
        output_tokens=item.output_tokens,
        latency_ms=item.latency_ms,
        error_message=item.error_message,
        created_by_user_id=item.created_by_user_id,
        created_at=item.created_at,
    )


def _serialize_route_rule(item: ModelRouteRule) -> ModelRouteRulePublic:
    return ModelRouteRulePublic(
        id=item.id,
        route_type=item.route_type,
        route_key=item.route_key,
        target_model_code=item.target_model_code,
        priority=item.priority,
        enabled=item.enabled,
        note=item.note,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _get_model_by_id(db: Session, model_id: int) -> ModelRegistry | None:
    return db.execute(select(ModelRegistry).where(ModelRegistry.id == model_id)).scalar_one_or_none()


def _require_model_exists(db: Session, model_id: int) -> ModelRegistry:
    model = _get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return model


def _require_target_model_routable(db: Session, model_code: str) -> ModelRegistry:
    model = db.execute(select(ModelRegistry).where(ModelRegistry.code == model_code)).scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Target model code not found: {model_code}")
    if model.status == "DEPRECATED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deprecated model cannot be used in route rule")
    return model


def _normalize_code(value: str) -> str:
    return value.strip().lower()


def _normalize_capabilities(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidate = value.strip().lower()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    normalized.sort()
    return normalized


def _normalize_nullable_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_route_key(route_type: str, route_key: str | None) -> str:
    if route_type == "GLOBAL":
        return GLOBAL_ROUTE_KEY

    normalized = (route_key or "").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"route_key is required for route_type={route_type}")
    if normalized == GLOBAL_ROUTE_KEY:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"route_key {GLOBAL_ROUTE_KEY} is reserved")
    return normalized


def _hash_secret(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _mask_secret(raw_key: str) -> str:
    value = raw_key.strip()
    if len(value) <= 2:
        return "**"
    if len(value) <= 8:
        return f"{value[0]}***{value[-1]}"
    return f"{value[:4]}***{value[-4:]}"


def _fingerprint_secret(raw_key: str) -> str:
    return _hash_secret(raw_key)[:12]


def _rotate_model_key_internal(
    db: Session,
    *,
    model: ModelRegistry,
    raw_key: str,
    actor_user_id: str,
    note: str | None,
) -> ModelApiKey:
    value = raw_key.strip()
    if not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="api_key cannot be empty")

    active_keys = db.execute(
        select(ModelApiKey).where(
            ModelApiKey.model_id == model.id,
            ModelApiKey.is_active.is_(True),
        )
    ).scalars().all()
    for key in active_keys:
        key.is_active = False

    current_max_version = db.scalar(
        select(func.max(ModelApiKey.version)).where(ModelApiKey.model_id == model.id)
    )
    next_version = int(current_max_version or 0) + 1

    next_key = ModelApiKey(
        model_id=model.id,
        version=next_version,
        secret_hash=_hash_secret(value),
        secret_masked=_mask_secret(value),
        secret_fingerprint=_fingerprint_secret(value),
        is_active=True,
        rotation_note=note,
        created_by_user_id=actor_user_id,
    )
    db.add(next_key)
    db.flush()
    return next_key


def _get_active_key(db: Session, model_id: int) -> ModelApiKey | None:
    return db.execute(
        select(ModelApiKey)
        .where(
            ModelApiKey.model_id == model_id,
            ModelApiKey.is_active.is_(True),
        )
        .order_by(ModelApiKey.version.desc(), ModelApiKey.id.desc())
    ).scalars().first()


def _evaluate_health(*, model: ModelRegistry, has_active_key: bool, route_count: int) -> tuple[str, str, dict[str, object]]:
    if model.status != "ENABLED":
        return (
            "UNHEALTHY",
            f"Model status is {model.status}; expected ENABLED",
            {
                "model_status": model.status,
                "has_active_key": has_active_key,
                "route_count": route_count,
            },
        )
    if not has_active_key:
        return (
            "UNHEALTHY",
            "No active API key",
            {
                "model_status": model.status,
                "has_active_key": has_active_key,
                "route_count": route_count,
            },
        )
    if route_count == 0:
        return (
            "DEGRADED",
            "No enabled route rule bound to this model",
            {
                "model_status": model.status,
                "has_active_key": has_active_key,
                "route_count": route_count,
            },
        )
    return (
        "HEALTHY",
        "Model is enabled with active key and route bindings",
        {
            "model_status": model.status,
            "has_active_key": has_active_key,
            "route_count": route_count,
        },
    )


def _to_decimal(value: float) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.000001"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _publish_model_changed(action: str, *, model: ModelRegistry, extra_payload: dict | None = None) -> None:
    payload = {
        "action": action,
        "model_id": model.id,
        "model_code": model.code,
        "model_status": model.status,
    }
    if extra_payload:
        payload.update(extra_payload)
    _fire_and_forget(
        publish_topic(
            MODEL_TOPIC,
            name="models.changed",
            payload=payload,
            requires_refetch=["/api/v1/admin/models", "/api/v1/admin/models/summary", "/api/v1/admin/model-routes"],
            dedupe_key=f"models:{action}:{model.id}",
        )
    )


def _publish_route_changed(action: str, *, rule: ModelRouteRule) -> None:
    _fire_and_forget(
        publish_topic(
            MODEL_TOPIC,
            name="model_routes.changed",
            payload={
                "action": action,
                "route_rule_id": rule.id,
                "route_type": rule.route_type,
                "route_key": rule.route_key,
                "target_model_code": rule.target_model_code,
            },
            requires_refetch=["/api/v1/admin/model-routes", "/api/v1/admin/models", "/api/v1/admin/models/summary"],
            dedupe_key=f"model_routes:{action}:{rule.id}",
        )
    )


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
