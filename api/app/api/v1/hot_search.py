from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.hot_search import (
    HotSearchFollowTopicCreateRequest,
    HotSearchFollowTopicListResponse,
    HotSearchFollowTopicSummary,
    HotSearchFollowTopicUpdateRequest,
    HotSearchListResponse,
    HotSearchQueryRequest,
    HotSearchRecordSummary,
)
from ...services.hot_search_service import (
    create_hot_search_follow_topic,
    delete_hot_search_follow_topic,
    get_hot_search_record,
    list_hot_search_follow_topics,
    list_hot_search_records,
    update_hot_search_follow_topic,
)

router = APIRouter(prefix="/admin/hot-search", tags=["admin-hot-search"])


@router.get("/follow-topics", response_model=HotSearchFollowTopicListResponse)
def list_follow_topics_endpoint(
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> HotSearchFollowTopicListResponse:
    return list_hot_search_follow_topics(db)


@router.post("/follow-topics", response_model=HotSearchFollowTopicSummary)
def create_follow_topic_endpoint(
    payload: HotSearchFollowTopicCreateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> HotSearchFollowTopicSummary:
    item = create_hot_search_follow_topic(db, payload, actor_user_id=current_user.user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Follow topic already exists")
    return item


@router.patch("/follow-topics/{topic_id}", response_model=HotSearchFollowTopicSummary)
def update_follow_topic_endpoint(
    topic_id: int,
    payload: HotSearchFollowTopicUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> HotSearchFollowTopicSummary:
    item, error = update_hot_search_follow_topic(db, topic_id, payload, actor_user_id=current_user.user.id)
    if not item:
        if error == "duplicate_topic_name":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Follow topic already exists")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Follow topic not found")
    return item


@router.delete("/follow-topics/{topic_id}")
def delete_follow_topic_endpoint(
    topic_id: int,
    _: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_hot_search_follow_topic(db, topic_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Follow topic not found")
    return {"success": True}


@router.post("/search", response_model=HotSearchListResponse)
def search_hot_search_records(
    payload: HotSearchQueryRequest,
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> HotSearchListResponse:
    return list_hot_search_records(db, payload)


@router.get("/{record_id}", response_model=HotSearchRecordSummary)
def get_hot_search_record_detail(
    record_id: int,
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> HotSearchRecordSummary:
    item = get_hot_search_record(db, record_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hot search record not found")
    return item
