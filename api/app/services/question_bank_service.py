from __future__ import annotations

import asyncio

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.question_bank import QuestionBank
from ..schemas.question_bank import (
    QuestionBankCreateRequest,
    QuestionBankListResponse,
    QuestionBankSummary,
    QuestionBankUpdateRequest,
    QuestionTagDeleteRequest,
    QuestionTagListResponse,
    QuestionTagMutationResponse,
    QuestionTagRenameRequest,
    QuestionTagSummary,
)
from .push_service import publish_topic
from .user_service import serialize_user

QUESTION_BANK_TOPIC = "admin.question_bank"


def _question_bank_stmt():
    return select(QuestionBank).options(
        selectinload(QuestionBank.creator),
        selectinload(QuestionBank.updater),
    )


def _normalize_tag(tag: str) -> str:
    return str(tag).strip()


def _normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    dedup: list[str] = []
    seen = set()
    for tag in tags:
        normalized = _normalize_tag(tag)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        dedup.append(normalized)
    return dedup


def serialize_question(item: QuestionBank) -> QuestionBankSummary:
    return QuestionBankSummary(
        id=item.id,
        question_type=item.question_type,
        stem=item.stem,
        options_json=item.options_json,
        answer=item.answer,
        analysis=item.analysis,
        difficulty=item.difficulty,
        status=item.status,
        tags_json=item.tags_json,
        creator_user_id=item.creator_user_id,
        updater_user_id=item.updater_user_id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        creator=serialize_user(item.creator) if item.creator else None,
        updater=serialize_user(item.updater) if item.updater else None,
    )


def list_questions(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
    difficulty: str | None,
    question_type: str | None,
    tag: str | None,
) -> QuestionBankListResponse:
    stmt = _question_bank_stmt()

    normalized_keyword = (keyword or "").strip()
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        stmt = stmt.where(
            or_(
                QuestionBank.stem.ilike(like),
                QuestionBank.answer.ilike(like),
                QuestionBank.analysis.ilike(like),
            )
        )

    if status_filter in {"draft", "published", "archived"}:
        stmt = stmt.where(QuestionBank.status == status_filter)

    if difficulty in {"easy", "medium", "hard"}:
        stmt = stmt.where(QuestionBank.difficulty == difficulty)

    if question_type in {"single_choice", "multiple_choice", "true_false", "short_answer"}:
        stmt = stmt.where(QuestionBank.question_type == question_type)

    normalized_tag = (tag or "").strip()
    if normalized_tag:
        stmt = stmt.where(QuestionBank.tags_json.contains([normalized_tag]))

    total_stmt = select(func.count()).select_from(QuestionBank)
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        total_stmt = total_stmt.where(
            or_(
                QuestionBank.stem.ilike(like),
                QuestionBank.answer.ilike(like),
                QuestionBank.analysis.ilike(like),
            )
        )
    if status_filter in {"draft", "published", "archived"}:
        total_stmt = total_stmt.where(QuestionBank.status == status_filter)
    if difficulty in {"easy", "medium", "hard"}:
        total_stmt = total_stmt.where(QuestionBank.difficulty == difficulty)
    if question_type in {"single_choice", "multiple_choice", "true_false", "short_answer"}:
        total_stmt = total_stmt.where(QuestionBank.question_type == question_type)
    if normalized_tag:
        total_stmt = total_stmt.where(QuestionBank.tags_json.contains([normalized_tag]))

    total = db.scalar(total_stmt) or 0
    items = db.execute(stmt.order_by(QuestionBank.updated_at.desc(), QuestionBank.id.desc())).scalars().all()
    return QuestionBankListResponse(items=[serialize_question(item) for item in items], total=total)


def list_question_tags(db: Session, *, keyword: str | None) -> QuestionTagListResponse:
    rows = db.execute(select(QuestionBank.tags_json).where(QuestionBank.tags_json.is_not(None))).scalars().all()

    counters: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, list):
            continue
        tags = _normalize_tags([str(tag) for tag in row])
        for name in tags:
            counters[name] = counters.get(name, 0) + 1

    normalized_keyword = (keyword or "").strip().lower()
    items = [
        QuestionTagSummary(name=name, count=count)
        for name, count in counters.items()
        if not normalized_keyword or normalized_keyword in name.lower()
    ]
    items.sort(key=lambda item: (-item.count, item.name))

    return QuestionTagListResponse(items=items, total=len(items))


def rename_question_tag(
    db: Session,
    payload: QuestionTagRenameRequest,
) -> QuestionTagMutationResponse:
    old_tag = _normalize_tag(payload.old_tag)
    new_tag = _normalize_tag(payload.new_tag)
    if not old_tag or not new_tag or old_tag == new_tag:
        return QuestionTagMutationResponse(affected_questions=0)

    questions = db.execute(select(QuestionBank).where(QuestionBank.tags_json.is_not(None))).scalars().all()

    affected = 0
    for question in questions:
        if not isinstance(question.tags_json, list):
            continue
        tags = _normalize_tags([str(tag) for tag in question.tags_json])
        if old_tag not in tags:
            continue

        replaced: list[str] = []
        seen = set()
        for tag in tags:
            candidate = new_tag if tag == old_tag else tag
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            replaced.append(candidate)

        question.tags_json = replaced
        affected += 1

    if affected <= 0:
        return QuestionTagMutationResponse(affected_questions=0)

    db.commit()

    _fire_and_forget(
        publish_topic(
            QUESTION_BANK_TOPIC,
            name="question_bank.tags_changed",
            payload={"action": "renamed", "old_tag": old_tag, "new_tag": new_tag, "affected_questions": affected},
            requires_refetch=["/api/v1/admin/question-bank", "/api/v1/admin/question-bank/tags"],
            dedupe_key=f"question-bank:tag-renamed:{old_tag}:{new_tag}",
        )
    )

    return QuestionTagMutationResponse(affected_questions=affected)


def delete_question_tag(
    db: Session,
    payload: QuestionTagDeleteRequest,
) -> QuestionTagMutationResponse:
    target_tag = _normalize_tag(payload.tag)
    if not target_tag:
        return QuestionTagMutationResponse(affected_questions=0)

    questions = db.execute(select(QuestionBank).where(QuestionBank.tags_json.is_not(None))).scalars().all()

    affected = 0
    for question in questions:
        if not isinstance(question.tags_json, list):
            continue
        tags = _normalize_tags([str(tag) for tag in question.tags_json])
        if target_tag not in tags:
            continue

        question.tags_json = [tag for tag in tags if tag != target_tag]
        affected += 1

    if affected <= 0:
        return QuestionTagMutationResponse(affected_questions=0)

    db.commit()

    _fire_and_forget(
        publish_topic(
            QUESTION_BANK_TOPIC,
            name="question_bank.tags_changed",
            payload={"action": "deleted", "tag": target_tag, "affected_questions": affected},
            requires_refetch=["/api/v1/admin/question-bank", "/api/v1/admin/question-bank/tags"],
            dedupe_key=f"question-bank:tag-deleted:{target_tag}",
        )
    )

    return QuestionTagMutationResponse(affected_questions=affected)


def get_question_by_id(db: Session, question_id: int) -> QuestionBank | None:
    return db.execute(_question_bank_stmt().where(QuestionBank.id == question_id)).scalar_one_or_none()


def create_question(
    db: Session,
    payload: QuestionBankCreateRequest,
    *,
    actor_user_id: str,
) -> QuestionBankSummary:
    item = QuestionBank(
        question_type=payload.question_type,
        stem=payload.stem.strip(),
        options_json=payload.options_json,
        answer=payload.answer.strip(),
        analysis=(payload.analysis or "").strip(),
        difficulty=payload.difficulty,
        status=payload.status,
        tags_json=_normalize_tags(payload.tags_json),
        creator_user_id=actor_user_id,
        updater_user_id=actor_user_id,
    )
    db.add(item)
    db.commit()

    saved = get_question_by_id(db, item.id)
    if not saved:
        raise RuntimeError("Question create succeeded but reload failed")

    _fire_and_forget(
        publish_topic(
            QUESTION_BANK_TOPIC,
            name="question_bank.changed",
            payload={"action": "created", "question_id": saved.id},
            requires_refetch=["/api/v1/admin/question-bank", "/api/v1/admin/question-bank/tags"],
            dedupe_key=f"question-bank:created:{saved.id}",
        )
    )
    return serialize_question(saved)


def update_question(
    db: Session,
    question_id: int,
    payload: QuestionBankUpdateRequest,
    *,
    actor_user_id: str,
) -> QuestionBankSummary | None:
    item = get_question_by_id(db, question_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    if "question_type" in update_data and update_data["question_type"] is not None:
        item.question_type = update_data["question_type"]
    if "stem" in update_data and update_data["stem"] is not None:
        item.stem = str(update_data["stem"]).strip()
    if "options_json" in update_data:
        item.options_json = update_data["options_json"]
    if "answer" in update_data and update_data["answer"] is not None:
        item.answer = str(update_data["answer"]).strip()
    if "analysis" in update_data:
        item.analysis = (str(update_data["analysis"]) if update_data["analysis"] is not None else "").strip()
    if "difficulty" in update_data and update_data["difficulty"] is not None:
        item.difficulty = update_data["difficulty"]
    if "status" in update_data and update_data["status"] is not None:
        item.status = update_data["status"]
    if "tags_json" in update_data:
        item.tags_json = _normalize_tags(update_data["tags_json"])

    item.updater_user_id = actor_user_id
    db.commit()

    saved = get_question_by_id(db, question_id)
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            QUESTION_BANK_TOPIC,
            name="question_bank.changed",
            payload={"action": "updated", "question_id": saved.id},
            requires_refetch=[
                "/api/v1/admin/question-bank",
                "/api/v1/admin/question-bank/tags",
                f"/api/v1/admin/question-bank/{saved.id}",
            ],
            dedupe_key=f"question-bank:updated:{saved.id}",
        )
    )
    return serialize_question(saved)


def delete_question(db: Session, question_id: int) -> bool:
    item = get_question_by_id(db, question_id)
    if not item:
        return False

    deleted_id = item.id
    db.delete(item)
    db.commit()

    _fire_and_forget(
        publish_topic(
            QUESTION_BANK_TOPIC,
            name="question_bank.changed",
            payload={"action": "deleted", "question_id": deleted_id},
            requires_refetch=["/api/v1/admin/question-bank", "/api/v1/admin/question-bank/tags"],
            dedupe_key=f"question-bank:deleted:{deleted_id}",
        )
    )
    return True


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
