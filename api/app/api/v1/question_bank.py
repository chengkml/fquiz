from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.question_bank import (
    QuestionBankCreateRequest,
    QuestionBankListResponse,
    QuestionBankSummary,
    QuestionBankUpdateRequest,
    QuestionTagDeleteRequest,
    QuestionTagListResponse,
    QuestionTagMutationResponse,
    QuestionTagRenameRequest,
)
from ...services.question_bank_service import (
    create_question,
    delete_question,
    delete_question_tag,
    get_question_by_id,
    list_question_tags,
    list_questions,
    rename_question_tag,
    serialize_question,
    update_question,
)

router = APIRouter(prefix="/admin/question-bank", tags=["admin-question-bank"])


@router.get("", response_model=QuestionBankListResponse)
def get_question_list(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    difficulty: str | None = Query(default=None),
    question_type: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionBankListResponse:
    return list_questions(
        db,
        keyword=keyword,
        status_filter=status_filter,
        difficulty=difficulty,
        question_type=question_type,
        tag=tag,
    )


@router.get("/tags", response_model=QuestionTagListResponse)
def get_question_tag_list(
    keyword: str | None = Query(default=None),
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionTagListResponse:
    return list_question_tags(db, keyword=keyword)


@router.patch("/tags/rename", response_model=QuestionTagMutationResponse)
def rename_question_tag_endpoint(
    payload: QuestionTagRenameRequest,
    _: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionTagMutationResponse:
    return rename_question_tag(db, payload)


@router.api_route("/tags", methods=["DELETE"], response_model=QuestionTagMutationResponse)
def delete_question_tag_endpoint(
    payload: QuestionTagDeleteRequest,
    _: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionTagMutationResponse:
    return delete_question_tag(db, payload)


@router.post("", response_model=QuestionBankSummary)
def create_question_endpoint(
    payload: QuestionBankCreateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionBankSummary:
    return create_question(db, payload, actor_user_id=current_user.user.id)


@router.get("/{question_id}", response_model=QuestionBankSummary)
def get_question_detail(
    question_id: int,
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionBankSummary:
    item = get_question_by_id(db, question_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return serialize_question(item)


@router.patch("/{question_id}", response_model=QuestionBankSummary)
def update_question_endpoint(
    question_id: int,
    payload: QuestionBankUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> QuestionBankSummary:
    updated = update_question(db, question_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return updated


@router.delete("/{question_id}")
def delete_question_endpoint(
    question_id: int,
    _: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_question(db, question_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return {"success": True}
