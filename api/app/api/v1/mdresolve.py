from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.mdresolve import (
    MdResolveImportRequest,
    MdResolveImportResponse,
    MdResolveParseRequest,
    MdResolveParseResponse,
)
from ...services.mdresolve_service import import_drafts_to_question_bank, parse_markdown_to_drafts

router = APIRouter(prefix="/admin/mdresolve", tags=["admin-mdresolve"])


@router.post("/parse", response_model=MdResolveParseResponse)
def parse_markdown_endpoint(
    payload: MdResolveParseRequest,
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
) -> MdResolveParseResponse:
    return parse_markdown_to_drafts(payload)


@router.post("/import", response_model=MdResolveImportResponse)
def import_markdown_endpoint(
    payload: MdResolveImportRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> MdResolveImportResponse:
    return import_drafts_to_question_bank(db, payload, actor_user_id=current_user.user.id)
