from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.diary import Diary
from ..models.user import User
from ..schemas.diary import (
    DiaryCreateRequest,
    DiaryPageResponse,
    DiaryQueryRequest,
    DiarySummary,
    DiaryUpdateRequest,
)


def serialize_diary(item: Diary) -> DiarySummary:
    return DiarySummary(
        id=item.id,
        title=item.title,
        content=item.content,
        diary_date=item.diary_date,
        mood=item.mood,
        weather=item.weather,
        archived=bool(item.archived),
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def get_diary_by_id(
    db: Session,
    diary_id: str,
    *,
    actor: User | None = None,
) -> Diary | None:
    item = db.execute(select(Diary).where(Diary.id == diary_id)).scalar_one_or_none()
    if not item:
        return None
    if actor and item.create_user and item.create_user != actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to access diary")
    return item


def search_diaries(
    db: Session,
    payload: DiaryQueryRequest,
    *,
    actor: User,
) -> DiaryPageResponse:
    filters = [Diary.create_user == actor.username]

    title = (payload.title or "").strip()
    if title:
        filters.append(Diary.title.ilike(f"%{title}%"))
    if payload.mood:
        filters.append(Diary.mood == payload.mood)
    if payload.archived is not None:
        filters.append(Diary.archived == payload.archived)
    if payload.diary_date_start:
        filters.append(Diary.diary_date >= payload.diary_date_start)
    if payload.diary_date_end:
        filters.append(Diary.diary_date <= payload.diary_date_end)

    total_stmt = select(func.count()).select_from(Diary).where(*filters)
    total = int(db.execute(total_stmt).scalar_one() or 0)

    items = db.execute(
        select(Diary)
        .where(*filters)
        .order_by(Diary.diary_date.desc(), Diary.create_date.desc())
        .offset(payload.page_num * payload.page_size)
        .limit(payload.page_size)
    ).scalars().all()

    return DiaryPageResponse(
        items=[serialize_diary(item) for item in items],
        total=total,
        page_num=payload.page_num,
        page_size=payload.page_size,
    )


def create_diary(
    db: Session,
    payload: DiaryCreateRequest,
    *,
    actor: User,
) -> DiarySummary:
    now = utcnow()
    item = Diary(
        title=payload.title.strip(),
        content=payload.content.strip(),
        diary_date=payload.diary_date or date.today(),
        mood=payload.mood or "CALM",
        weather=_normalize_nullable_text(payload.weather),
        archived=bool(payload.archived),
        create_user=actor.username,
        update_user=actor.username,
        create_date=now,
        update_date=now,
    )
    db.add(item)
    db.commit()

    saved = get_diary_by_id(db, item.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Diary save failed")
    return serialize_diary(saved)


def update_diary(
    db: Session,
    payload: DiaryUpdateRequest,
    *,
    actor: User,
) -> DiarySummary:
    item = get_diary_by_id(db, payload.id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")

    item.title = payload.title.strip()
    item.content = payload.content.strip()
    item.diary_date = payload.diary_date
    item.mood = payload.mood
    item.weather = _normalize_nullable_text(payload.weather)
    item.archived = bool(payload.archived)
    item.update_user = actor.username
    item.update_date = utcnow()

    db.commit()

    saved = get_diary_by_id(db, payload.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Diary load failed")
    return serialize_diary(saved)


def delete_diary(
    db: Session,
    diary_id: str,
    *,
    actor: User,
) -> dict[str, bool]:
    item = get_diary_by_id(db, diary_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")

    db.delete(item)
    db.commit()
    return {"success": True}


def archive_diary(
    db: Session,
    diary_id: str,
    archived: bool,
    *,
    actor: User,
) -> DiarySummary:
    item = get_diary_by_id(db, diary_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diary not found")

    item.archived = bool(archived)
    item.update_user = actor.username
    item.update_date = utcnow()
    db.commit()

    saved = get_diary_by_id(db, diary_id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Diary load failed")
    return serialize_diary(saved)


def _normalize_nullable_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None
