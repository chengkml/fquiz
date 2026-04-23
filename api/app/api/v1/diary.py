from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.diary import (
    DiaryCreateRequest,
    DiaryPageResponse,
    DiaryQueryRequest,
    DiarySummary,
    DiaryUpdateRequest,
)
from ...services.diary_service import (
    archive_diary,
    create_diary,
    delete_diary,
    get_diary_by_id,
    search_diaries,
    serialize_diary,
    update_diary,
)

router = APIRouter(prefix="/diary", tags=["diary"])


@router.post("/search", response_model=DiaryPageResponse)
def search_diary_endpoint(
    payload: DiaryQueryRequest,
    current_user: CurrentUser = Depends(require_any_permission("menu.read", "menu.manage")),
    db: Session = Depends(get_db),
) -> DiaryPageResponse:
    return search_diaries(db, payload, actor=current_user.user)


@router.get("/get/{diary_id}", response_model=DiarySummary)
def get_diary_endpoint(
    diary_id: str,
    current_user: CurrentUser = Depends(require_any_permission("menu.read", "menu.manage")),
    db: Session = Depends(get_db),
) -> DiarySummary:
    item = get_diary_by_id(db, diary_id, actor=current_user.user)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")
    return serialize_diary(item)


@router.post("/create", response_model=DiarySummary)
def create_diary_endpoint(
    payload: DiaryCreateRequest,
    current_user: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> DiarySummary:
    return create_diary(db, payload, actor=current_user.user)


@router.put("/update", response_model=DiarySummary)
def update_diary_endpoint(
    payload: DiaryUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> DiarySummary:
    return update_diary(db, payload, actor=current_user.user)


@router.delete("/delete/{diary_id}")
def delete_diary_endpoint(
    diary_id: str,
    current_user: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_diary(db, diary_id, actor=current_user.user)


@router.post("/{diary_id}/archive", response_model=DiarySummary)
def archive_diary_endpoint(
    diary_id: str,
    archived: bool = Query(default=True),
    current_user: CurrentUser = Depends(require_permission("menu.manage")),
    db: Session = Depends(get_db),
) -> DiarySummary:
    return archive_diary(db, diary_id, archived, actor=current_user.user)
