from __future__ import annotations

import asyncio

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.vocabulary_word import VocabularyWord
from ..schemas.vocabulary_word import (
    VocabularyInitialBucketItem,
    VocabularyStatsSummary,
    VocabularyStatusBucketItem,
    VocabularyWordCreateRequest,
    VocabularyWordListResponse,
    VocabularyWordStatsResponse,
    VocabularyWordSummary,
    VocabularyWordTrendItem,
    VocabularyWordUpdateRequest,
)
from .push_service import publish_topic
from .user_service import serialize_user

VOCABULARY_TOPIC = "admin.vocabulary"


def _vocabulary_stmt():
    return select(VocabularyWord).options(
        selectinload(VocabularyWord.created_by),
        selectinload(VocabularyWord.updated_by),
    )


def serialize_vocabulary_word(item: VocabularyWord) -> VocabularyWordSummary:
    return VocabularyWordSummary(
        id=item.id,
        word=item.word,
        phonetic=item.phonetic,
        meaning=item.meaning,
        example=item.example,
        status=item.status,
        created_by_user_id=item.created_by_user_id,
        updated_by_user_id=item.updated_by_user_id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        created_by=serialize_user(item.created_by) if item.created_by else None,
        updated_by=serialize_user(item.updated_by) if item.updated_by else None,
    )


def list_vocabulary_words(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
) -> VocabularyWordListResponse:
    stmt = _vocabulary_stmt()

    normalized = (keyword or "").strip()
    if normalized:
        like = f"%{normalized}%"
        stmt = stmt.where(
            or_(
                VocabularyWord.word.ilike(like),
                VocabularyWord.phonetic.ilike(like),
                VocabularyWord.meaning.ilike(like),
                VocabularyWord.example.ilike(like),
            )
        )

    if status_filter in {"enabled", "disabled"}:
        stmt = stmt.where(VocabularyWord.status == status_filter)

    total_stmt = select(func.count()).select_from(VocabularyWord)
    if normalized:
        like = f"%{normalized}%"
        total_stmt = total_stmt.where(
            or_(
                VocabularyWord.word.ilike(like),
                VocabularyWord.phonetic.ilike(like),
                VocabularyWord.meaning.ilike(like),
                VocabularyWord.example.ilike(like),
            )
        )
    if status_filter in {"enabled", "disabled"}:
        total_stmt = total_stmt.where(VocabularyWord.status == status_filter)

    total = db.scalar(total_stmt) or 0
    items = db.execute(stmt.order_by(VocabularyWord.updated_at.desc(), VocabularyWord.id.desc())).scalars().all()
    return VocabularyWordListResponse(items=[serialize_vocabulary_word(item) for item in items], total=total)


def get_vocabulary_word_stats(db: Session) -> VocabularyWordStatsResponse:
    summary_row = db.execute(
        select(
            func.count(VocabularyWord.id),
            func.sum(case((VocabularyWord.status == "enabled", 1), else_=0)),
            func.sum(case((VocabularyWord.status == "disabled", 1), else_=0)),
            func.sum(case((or_(VocabularyWord.phonetic.is_(None), func.trim(VocabularyWord.phonetic) == ""), 1), else_=0)),
            func.sum(case((or_(VocabularyWord.example.is_(None), func.trim(VocabularyWord.example) == ""), 1), else_=0)),
        )
    ).one()

    total_words = int(summary_row[0] or 0)
    enabled_words = int(summary_row[1] or 0)
    disabled_words = int(summary_row[2] or 0)
    missing_phonetic_words = int(summary_row[3] or 0)
    missing_example_words = int(summary_row[4] or 0)

    status_rows = db.execute(
        select(VocabularyWord.status, func.count(VocabularyWord.id))
        .group_by(VocabularyWord.status)
        .order_by(VocabularyWord.status.asc())
    ).all()
    status_buckets = [
        VocabularyStatusBucketItem(status=str(row[0]), count=int(row[1] or 0))
        for row in status_rows
    ]

    initial_expr = func.upper(func.substr(func.trim(VocabularyWord.word), 1, 1))
    initial_rows = db.execute(
        select(initial_expr, func.count(VocabularyWord.id))
        .where(func.trim(VocabularyWord.word) != "")
        .group_by(initial_expr)
        .order_by(func.count(VocabularyWord.id).desc(), initial_expr.asc())
        .limit(12)
    ).all()
    initial_buckets = [
        VocabularyInitialBucketItem(initial=str(row[0]), count=int(row[1] or 0))
        for row in initial_rows
    ]

    recent_items = db.execute(
        select(VocabularyWord)
        .order_by(VocabularyWord.updated_at.desc(), VocabularyWord.id.desc())
        .limit(10)
    ).scalars().all()
    recently_updated = [
        VocabularyWordTrendItem(
            id=item.id,
            word=item.word,
            status=item.status,
            updated_at=item.updated_at,
        )
        for item in recent_items
    ]

    return VocabularyWordStatsResponse(
        summary=VocabularyStatsSummary(
            total_words=total_words,
            enabled_words=enabled_words,
            disabled_words=disabled_words,
            enabled_rate=round(enabled_words / total_words, 4) if total_words > 0 else None,
            missing_phonetic_words=missing_phonetic_words,
            missing_example_words=missing_example_words,
        ),
        status_buckets=status_buckets,
        initial_buckets=initial_buckets,
        recently_updated=recently_updated,
    )


def get_vocabulary_word_by_id(db: Session, word_id: int) -> VocabularyWord | None:
    return db.execute(_vocabulary_stmt().where(VocabularyWord.id == word_id)).scalar_one_or_none()


def _get_vocabulary_word_by_text(db: Session, word: str) -> VocabularyWord | None:
    normalized = word.strip().lower()
    return db.scalar(select(VocabularyWord).where(func.lower(VocabularyWord.word) == normalized))


def create_vocabulary_word(
    db: Session,
    payload: VocabularyWordCreateRequest,
    *,
    actor_user_id: str,
) -> VocabularyWordSummary | None:
    normalized_word = payload.word.strip()
    if _get_vocabulary_word_by_text(db, normalized_word):
        return None

    item = VocabularyWord(
        word=normalized_word,
        phonetic=(payload.phonetic or "").strip() or None,
        meaning=payload.meaning,
        example=(payload.example or "").strip() or None,
        status=payload.status,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(item)
    db.commit()

    saved = get_vocabulary_word_by_id(db, item.id)
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            VOCABULARY_TOPIC,
            name="vocabulary.changed",
            payload={"action": "created", "word_id": saved.id, "word": saved.word},
            requires_refetch=["/api/v1/admin/vocabulary", "/api/v1/admin/vocabulary/stats"],
            dedupe_key=f"vocabulary:created:{saved.id}",
        )
    )

    return serialize_vocabulary_word(saved)


def update_vocabulary_word(
    db: Session,
    word_id: int,
    payload: VocabularyWordUpdateRequest,
    *,
    actor_user_id: str,
) -> VocabularyWordSummary | None:
    item = get_vocabulary_word_by_id(db, word_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)

    if "word" in update_data and update_data["word"] is not None:
        normalized_word = str(update_data["word"]).strip()
        existed = _get_vocabulary_word_by_text(db, normalized_word)
        if existed and existed.id != item.id:
            return None
        item.word = normalized_word

    if "phonetic" in update_data:
        item.phonetic = (str(update_data["phonetic"]) if update_data["phonetic"] is not None else "").strip() or None
    if "meaning" in update_data and update_data["meaning"] is not None:
        item.meaning = str(update_data["meaning"])
    if "example" in update_data:
        item.example = (str(update_data["example"]) if update_data["example"] is not None else "").strip() or None
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"])

    item.updated_by_user_id = actor_user_id
    db.commit()

    saved = get_vocabulary_word_by_id(db, word_id)
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            VOCABULARY_TOPIC,
            name="vocabulary.changed",
            payload={"action": "updated", "word_id": saved.id, "word": saved.word},
            requires_refetch=["/api/v1/admin/vocabulary", f"/api/v1/admin/vocabulary/{saved.id}", "/api/v1/admin/vocabulary/stats"],
            dedupe_key=f"vocabulary:updated:{saved.id}",
        )
    )

    return serialize_vocabulary_word(saved)


def delete_vocabulary_word(db: Session, word_id: int) -> bool:
    item = get_vocabulary_word_by_id(db, word_id)
    if not item:
        return False

    deleted_id = item.id
    deleted_word = item.word
    db.delete(item)
    db.commit()

    _fire_and_forget(
        publish_topic(
            VOCABULARY_TOPIC,
            name="vocabulary.changed",
            payload={"action": "deleted", "word_id": deleted_id, "word": deleted_word},
            requires_refetch=["/api/v1/admin/vocabulary", "/api/v1/admin/vocabulary/stats"],
            dedupe_key=f"vocabulary:deleted:{deleted_id}",
        )
    )
    return True


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
