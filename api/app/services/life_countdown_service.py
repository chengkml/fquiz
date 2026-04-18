from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.life_countdown import LifeCountdownProfile
from ..models.model_registry import ModelApiKey, ModelRegistry, ModelRouteRule
from ..schemas.life_countdown import (
    LifeCountdownGenerateWarningDto,
    LifeCountdownProfileDto,
    LifeCountdownSaveDto,
    LifeCountdownWarningDto,
)
from .llm_gateway import create_reply_with_model

CHAT_WARNING_CAPABILITY_ROUTE_KEY = "life-countdown.warning"
GLOBAL_ROUTE_KEY = "__global__"
FALLBACK_WARNING = "今天别再拿未来下注，你剩下的时间正在按秒结算。"


def get_current_profile(db: Session, *, user_id: str) -> LifeCountdownProfileDto:
    profile = _get_profile(db, user_id)
    if not profile:
        return LifeCountdownProfileDto()
    return _to_profile_dto(profile)


def save_profile(db: Session, *, user_id: str, payload: LifeCountdownSaveDto) -> LifeCountdownProfileDto:
    death_date = payload.deathDate
    if death_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="死亡日期不能为空")
    if death_date < date.today():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="死亡日期不能早于今天")

    profile = _get_profile(db, user_id)
    if not profile:
        profile = LifeCountdownProfile(user_id=user_id)
        db.add(profile)
        db.flush()

    death_date_changed = profile.death_date != death_date
    profile.death_date = death_date
    if death_date_changed:
        _clear_warning_cache(profile)

    db.commit()
    db.refresh(profile)
    return _to_profile_dto(profile)


def generate_today_warning(
    db: Session,
    *,
    user_id: str,
    payload: LifeCountdownGenerateWarningDto,
) -> LifeCountdownWarningDto:
    profile = _get_profile(db, user_id)
    if not profile or profile.death_date is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先设置死亡日期")
    if profile.death_date < date.today():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="死亡日期已过，请先重新设置")

    force_refresh = bool(payload.forceRefresh)
    today = date.today()
    if (
        not force_refresh
        and profile.today_warning_date == today
        and (profile.today_warning_text or "").strip()
    ):
        return _to_warning_dto(profile, cached=True)

    model = _resolve_warning_model(db)

    warning_text = FALLBACK_WARNING
    model_name = payload.modelName.strip() if payload.modelName and payload.modelName.strip() else None
    if model:
        try:
            prompt = _build_warning_prompt(profile.death_date)
            result = create_reply_with_model(
                model=model,
                user_message=prompt,
                context_messages=[],
                system_prompt="你是一个克制、直白、促行动的中文文案助手。",
            )
            warning_text = _normalize_warning_text(result.content)
            model_name = payload.modelName.strip() if payload.modelName and payload.modelName.strip() else result.provider_model
        except Exception:
            warning_text = FALLBACK_WARNING
            if not model_name:
                model_name = model.provider_model

    profile.today_warning_text = warning_text
    profile.today_warning_date = today
    profile.today_warning_generated_at = utcnow()
    profile.today_warning_model = model_name

    db.commit()
    db.refresh(profile)
    return _to_warning_dto(profile, cached=False)


def _get_profile(db: Session, user_id: str) -> LifeCountdownProfile | None:
    return db.execute(
        select(LifeCountdownProfile).where(LifeCountdownProfile.user_id == user_id)
    ).scalar_one_or_none()


def _clear_warning_cache(profile: LifeCountdownProfile) -> None:
    profile.today_warning_date = None
    profile.today_warning_text = None
    profile.today_warning_generated_at = None
    profile.today_warning_model = None


def _build_warning_prompt(death_date: date) -> str:
    remaining_days = max(0, (death_date - date.today()).days)
    return (
        "请基于以下信息生成一句冷静、克制、促行动的中文今日警示语，"
        "只输出一句话，不要标题、解释、序号和引号，不要鼓励自伤或绝望。"
        f"死亡日期：{death_date.isoformat()}；剩余天数：{remaining_days}。"
    )


def _normalize_warning_text(content: str | None) -> str:
    normalized = (content or "").strip()
    if not normalized:
        return FALLBACK_WARNING
    normalized = " ".join(normalized.replace("\r", " ").replace("\n", " ").split())
    normalized = normalized.strip("\"“”'` ")
    if not normalized:
        return FALLBACK_WARNING
    if len(normalized) > 80:
        normalized = normalized[:80].strip()
    return normalized or FALLBACK_WARNING


def _resolve_warning_model(db: Session) -> ModelRegistry | None:
    model = _resolve_model_from_route(db, route_type="CAPABILITY", route_key=CHAT_WARNING_CAPABILITY_ROUTE_KEY)
    if model:
        return model
    return _resolve_model_from_route(db, route_type="GLOBAL", route_key=GLOBAL_ROUTE_KEY)


def _resolve_model_from_route(db: Session, *, route_type: str, route_key: str) -> ModelRegistry | None:
    rows = db.execute(
        select(ModelRouteRule, ModelRegistry)
        .join(ModelRegistry, ModelRouteRule.target_model_code == ModelRegistry.code)
        .where(
            ModelRouteRule.route_type == route_type,
            ModelRouteRule.route_key == route_key,
            ModelRouteRule.enabled.is_(True),
            ModelRegistry.status == "ENABLED",
        )
        .order_by(ModelRouteRule.priority.asc(), ModelRouteRule.id.asc())
    ).all()
    if not rows:
        return None

    for _, model in rows:
        active_key_exists = db.scalar(
            select(ModelApiKey.id).where(
                ModelApiKey.model_id == model.id,
                ModelApiKey.is_active.is_(True),
            )
        )
        if active_key_exists is not None:
            return model
    return None


def _to_profile_dto(profile: LifeCountdownProfile) -> LifeCountdownProfileDto:
    return LifeCountdownProfileDto(
        id=profile.id,
        deathDate=profile.death_date,
        todayWarningDate=profile.today_warning_date,
        todayWarningText=profile.today_warning_text,
        todayWarningGeneratedAt=profile.today_warning_generated_at,
        todayWarningModel=profile.today_warning_model,
        createDate=profile.created_at,
        updateDate=profile.updated_at,
    )


def _to_warning_dto(profile: LifeCountdownProfile, *, cached: bool) -> LifeCountdownWarningDto:
    return LifeCountdownWarningDto(
        warningText=profile.today_warning_text,
        warningDate=profile.today_warning_date,
        generatedAt=profile.today_warning_generated_at,
        modelName=profile.today_warning_model,
        cached=cached,
    )
