from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission
from ...schemas.token_usage import TokenUsageOverviewResponse
from ...services.model_service import get_token_usage_overview

router = APIRouter(prefix="/admin/token-usage", tags=["admin-token-usage"])


@router.get("/overview", response_model=TokenUsageOverviewResponse)
def get_token_usage_overview_endpoint(
    days: int = Query(default=7, ge=1, le=90),
    model_code: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("model.read", "model.manage")),
    db: Session = Depends(get_db),
) -> TokenUsageOverviewResponse:
    return get_token_usage_overview(db, days=days, model_code=model_code)
