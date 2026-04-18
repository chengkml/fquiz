from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.vocabulary_word import (
    VocabularyWordCreateRequest,
    VocabularyWordListResponse,
    VocabularyWordStatsResponse,
    VocabularyWordSummary,
    VocabularyWordUpdateRequest,
)
from ...services.vocabulary_service import (
    create_vocabulary_word,
    delete_vocabulary_word,
    get_vocabulary_word_by_id,
    get_vocabulary_word_stats,
    list_vocabulary_words,
    serialize_vocabulary_word,
    update_vocabulary_word,
)

router = APIRouter(prefix="/admin/vocabulary", tags=["admin-vocabulary"])


@router.get("", response_model=VocabularyWordListResponse)
def get_vocabulary_list(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    _: CurrentUser = Depends(require_any_permission("vocabulary.read", "vocabulary.manage")),
    db: Session = Depends(get_db),
) -> VocabularyWordListResponse:
    return list_vocabulary_words(db, keyword=keyword, status_filter=status_filter)


@router.get("/stats", response_model=VocabularyWordStatsResponse)
def get_vocabulary_stats_endpoint(
    _: CurrentUser = Depends(require_any_permission("vocabulary.read", "vocabulary.manage")),
    db: Session = Depends(get_db),
) -> VocabularyWordStatsResponse:
    return get_vocabulary_word_stats(db)


@router.post("", response_model=VocabularyWordSummary)
def create_vocabulary_endpoint(
    payload: VocabularyWordCreateRequest,
    current_user: CurrentUser = Depends(require_permission("vocabulary.manage")),
    db: Session = Depends(get_db),
) -> VocabularyWordSummary:
    created = create_vocabulary_word(db, payload, actor_user_id=current_user.user.id)
    if not created:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vocabulary word already exists",
        )
    return created


@router.get("/{word_id}", response_model=VocabularyWordSummary)
def get_vocabulary_detail(
    word_id: int,
    _: CurrentUser = Depends(require_any_permission("vocabulary.read", "vocabulary.manage")),
    db: Session = Depends(get_db),
) -> VocabularyWordSummary:
    item = get_vocabulary_word_by_id(db, word_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary word not found")
    return serialize_vocabulary_word(item)


@router.patch("/{word_id}", response_model=VocabularyWordSummary)
def update_vocabulary_endpoint(
    word_id: int,
    payload: VocabularyWordUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("vocabulary.manage")),
    db: Session = Depends(get_db),
) -> VocabularyWordSummary:
    updated = update_vocabulary_word(db, word_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary word not found")
    return updated


@router.delete("/{word_id}")
def delete_vocabulary_endpoint(
    word_id: int,
    _: CurrentUser = Depends(require_permission("vocabulary.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_vocabulary_word(db, word_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary word not found")
    return {"success": True}
