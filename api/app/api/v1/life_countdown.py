from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.life_countdown import (
    LifeCountdownGenerateWarningDto,
    LifeCountdownProfileDto,
    LifeCountdownSaveDto,
    LifeCountdownWarningDto,
)
from ...services.life_countdown_service import (
    generate_today_warning,
    get_current_profile,
    save_profile,
)

router = APIRouter(prefix="/admin/life-countdown", tags=["life-countdown"])


@router.get("/current", response_model=LifeCountdownProfileDto)
def get_current_life_countdown(
    current_user: CurrentUser = Depends(require_any_permission("life_countdown.read", "life_countdown.manage")),
    db: Session = Depends(get_db),
) -> LifeCountdownProfileDto:
    return get_current_profile(db, user_id=current_user.user.id)


@router.post("/save", response_model=LifeCountdownProfileDto)
def save_life_countdown(
    payload: LifeCountdownSaveDto,
    current_user: CurrentUser = Depends(require_permission("life_countdown.manage")),
    db: Session = Depends(get_db),
) -> LifeCountdownProfileDto:
    return save_profile(db, user_id=current_user.user.id, payload=payload)


@router.post("/generate-warning", response_model=LifeCountdownWarningDto)
def generate_life_countdown_warning(
    payload: LifeCountdownGenerateWarningDto | None = None,
    current_user: CurrentUser = Depends(require_permission("life_countdown.manage")),
    db: Session = Depends(get_db),
) -> LifeCountdownWarningDto:
    request_payload = payload or LifeCountdownGenerateWarningDto()
    return generate_today_warning(db, user_id=current_user.user.id, payload=request_payload)
