from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.calendar_event import CalendarEvent
from ..models.todo import Todo
from ..models.user import User
from ..schemas.calendar_event import (
    CalendarEventCreateRequest,
    CalendarEventPageResponse,
    CalendarEventQueryRequest,
    CalendarEventSummary,
    CalendarEventUpdateRequest,
)
from .llm_gateway import create_assistant_reply

logger = logging.getLogger(__name__)

SCHEDULE_ACTIVE_STATUSES = {"SCHEDULED", "IN_PROGRESS"}

SCHEDULE_GENERATION_PROMPT = """你是日程生成助手。\n请根据用户输入，输出一个 JSON 对象，不要输出额外文本。\n字段要求：\n- title: string，日程标题\n- descr: string，日程描述\n- status: 固定返回 SCHEDULED\n- priority: LOW | MEDIUM | HIGH\n- start_time: ISO-8601 日期时间字符串\n- end_time: ISO-8601 日期时间字符串\n- expire_time: ISO-8601 日期时间字符串或 null\n- all_day: boolean\n\n如果用户没有提供明确时间，start_time 使用当前时间后 1 小时，end_time 为 start_time 后 1 小时。\n"""


def search_calendar_events(
    db: Session,
    payload: CalendarEventQueryRequest,
    *,
    actor: User,
) -> CalendarEventPageResponse:
    expire_overdue_events(db)

    filters = [CalendarEvent.create_user == actor.username]
    if payload.title:
        keyword = f"%{payload.title.strip()}%"
        filters.append(CalendarEvent.title.ilike(keyword))
    if payload.status:
        filters.append(CalendarEvent.status == payload.status)
    if payload.priority:
        filters.append(CalendarEvent.priority == payload.priority)
    if payload.start_time_from:
        filters.append(CalendarEvent.start_time >= payload.start_time_from)
    if payload.start_time_to:
        filters.append(CalendarEvent.start_time <= payload.start_time_to)

    where_clause = and_(*filters)

    total = int(
        db.scalar(
            select(func.count())
            .select_from(CalendarEvent)
            .where(where_clause)
        )
        or 0
    )

    events = db.execute(
        select(CalendarEvent)
        .where(where_clause)
        .order_by(CalendarEvent.create_date.desc())
        .offset(payload.page_num * payload.page_size)
        .limit(payload.page_size)
    ).scalars().all()

    return CalendarEventPageResponse(
        items=[serialize_calendar_event(item) for item in events],
        total=total,
        page_num=payload.page_num,
        page_size=payload.page_size,
    )


def get_calendar_event_by_id(
    db: Session,
    event_id: str,
    *,
    actor: User | None = None,
) -> CalendarEvent | None:
    event = db.execute(select(CalendarEvent).where(CalendarEvent.id == event_id)).scalar_one_or_none()
    if not event:
        return None
    if actor and event.create_user != actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to access calendar event")
    return event


def get_calendar_event_by_todo_id(db: Session, todo_id: str) -> CalendarEvent | None:
    return db.execute(
        select(CalendarEvent).where(CalendarEvent.todo_id == todo_id)
    ).scalar_one_or_none()


def create_calendar_event(
    db: Session,
    payload: CalendarEventCreateRequest,
    *,
    actor: User,
    syncing: bool = False,
) -> CalendarEventSummary:
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be later than start_time")

    now = utcnow()
    event = CalendarEvent(
        title=payload.title.strip(),
        descr=payload.descr.strip(),
        status=payload.status,
        priority=payload.priority,
        start_time=payload.start_time,
        end_time=payload.end_time,
        expire_time=payload.expire_time,
        all_day=payload.all_day,
        completed_at=now if payload.status == "COMPLETED" else None,
        todo_id=payload.todo_id,
        create_user=actor.username,
        update_user=actor.username,
        create_date=now,
        update_date=now,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    if not (payload.is_sync or syncing):
        _sync_create_todo_for_event(db, event=event, actor=actor)

    saved = get_calendar_event_by_id(db, event.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Calendar event save failed")
    return serialize_calendar_event(saved)


def update_calendar_event(
    db: Session,
    payload: CalendarEventUpdateRequest,
    *,
    actor: User,
    syncing: bool = False,
) -> CalendarEventSummary:
    event = get_calendar_event_by_id(db, payload.id, actor=actor)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")

    update_data = payload.model_dump(exclude_unset=True)

    next_start = update_data.get("start_time", event.start_time)
    next_end = update_data.get("end_time", event.end_time)
    if next_end <= next_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be later than start_time")

    for field in [
        "title",
        "descr",
        "status",
        "priority",
        "start_time",
        "end_time",
        "expire_time",
        "all_day",
        "completed_at",
    ]:
        if field in update_data:
            value = update_data[field]
            if isinstance(value, str):
                value = value.strip()
            setattr(event, field, value)

    if "status" in update_data:
        if event.status == "COMPLETED" and event.completed_at is None:
            event.completed_at = utcnow()
        if event.status != "COMPLETED" and "completed_at" not in update_data:
            event.completed_at = None

    event.update_user = actor.username
    event.update_date = utcnow()
    db.commit()
    db.refresh(event)

    if not (payload.is_sync or syncing):
        _sync_update_todo_for_event(db, event=event, actor=actor)

    saved = get_calendar_event_by_id(db, event.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Calendar event load failed")
    return serialize_calendar_event(saved)


def delete_calendar_event(
    db: Session,
    event_id: str,
    *,
    actor: User,
    syncing: bool = False,
) -> dict[str, bool]:
    event = get_calendar_event_by_id(db, event_id, actor=actor)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")

    linked_todo_id = event.todo_id
    db.delete(event)
    db.commit()

    if linked_todo_id and not syncing:
        from .todo_service import delete_todo

        try:
            delete_todo(db, linked_todo_id, actor=actor, syncing=True)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise

    return {"success": True}


def complete_calendar_event(
    db: Session,
    event_id: str,
    *,
    actor: User,
    syncing: bool = False,
) -> CalendarEventSummary:
    event = get_calendar_event_by_id(db, event_id, actor=actor)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")

    event.status = "COMPLETED"
    event.completed_at = utcnow()
    event.update_user = actor.username
    event.update_date = utcnow()
    db.commit()
    db.refresh(event)

    if event.todo_id and not syncing:
        from ..schemas.todo import TodoTransitionRequest
        from .todo_service import transition_todo

        try:
            transition_todo(
                db,
                event.todo_id,
                TodoTransitionRequest(status="COMPLETED", is_sync=True),
                actor=actor,
                syncing=True,
            )
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise

    saved = get_calendar_event_by_id(db, event.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Calendar event load failed")
    return serialize_calendar_event(saved)


async def stream_generate_calendar_event(
    db: Session,
    *,
    descr: str,
) -> AsyncGenerator[str, None]:
    text = descr.strip()
    if not text:
        yield "[ERROR]日程描述不能为空"
        return

    yield "connected"

    try:
        result = create_assistant_reply(
            db,
            user_message=text,
            context_messages=[],
            system_prompt=SCHEDULE_GENERATION_PROMPT,
        )
        content = result.content.strip()
    except HTTPException as exc:
        yield f"[ERROR]{exc.detail}"
        return
    except Exception as exc:  # pragma: no cover - defensive fallback
        yield f"[ERROR]服务异常: {exc}"
        return

    for chunk in _chunk_text(content, chunk_size=120):
        yield chunk

    try:
        generated = _coerce_generated_event(content)
        yield "[PARSE_RESULT]"
        yield f"[EVENT]{json.dumps(generated, ensure_ascii=False)}"
    except Exception as exc:
        yield f"[ERROR]解析JSON失败: {exc}"


def serialize_calendar_event(event: CalendarEvent) -> CalendarEventSummary:
    return CalendarEventSummary(
        id=event.id,
        title=event.title,
        descr=event.descr,
        status=event.status,
        priority=event.priority,
        start_time=event.start_time,
        end_time=event.end_time,
        expire_time=event.expire_time,
        all_day=bool(event.all_day),
        completed_at=event.completed_at,
        todo_id=event.todo_id,
        create_date=event.create_date,
        create_user=event.create_user,
        update_date=event.update_date,
        update_user=event.update_user,
    )


def sync_from_todo_create(db: Session, *, todo: Todo, actor: User) -> None:
    if todo.calendar_event_id:
        return

    start_time = todo.start_time or todo.due_date or utcnow()
    end_time = todo.due_date or (start_time + timedelta(hours=1))

    try:
        event = create_calendar_event(
            db,
            CalendarEventCreateRequest(
                title=todo.title,
                descr=todo.descr or "",
                status=todo.status,
                priority=todo.priority,
                start_time=start_time,
                end_time=end_time,
                expire_time=todo.expire_time,
                all_day=False,
                is_sync=True,
                todo_id=todo.id,
            ),
            actor=actor,
            syncing=True,
        )
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync todo->schedule create: %s", exc)
        return

    todo.calendar_event_id = event.id
    todo.update_user = actor.username
    todo.update_date = utcnow()
    db.commit()


def sync_from_todo_update(db: Session, *, todo: Todo, actor: User) -> None:
    event_id = todo.calendar_event_id
    if not event_id:
        sync_from_todo_create(db, todo=todo, actor=actor)
        return

    event = get_calendar_event_by_id(db, event_id)
    if not event:
        sync_from_todo_create(db, todo=todo, actor=actor)
        return

    next_start = todo.start_time or event.start_time
    next_end = todo.due_date or event.end_time
    if next_end <= next_start:
        next_end = next_start + timedelta(hours=1)

    try:
        update_calendar_event(
            db,
            CalendarEventUpdateRequest(
                id=event.id,
                title=todo.title,
                descr=todo.descr or "",
                status=todo.status,
                priority=todo.priority,
                start_time=next_start,
                end_time=next_end,
                expire_time=todo.expire_time,
                is_sync=True,
            ),
            actor=actor,
            syncing=True,
        )
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync todo->schedule update: %s", exc)


def sync_from_todo_delete(db: Session, *, todo: Todo, actor: User) -> None:
    event_id = todo.calendar_event_id
    if not event_id:
        event = get_calendar_event_by_todo_id(db, todo.id)
        event_id = event.id if event else None

    if not event_id:
        return

    try:
        delete_calendar_event(db, event_id, actor=actor, syncing=True)
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync todo->schedule delete: %s", exc)


def sync_from_todo_transition(db: Session, *, todo: Todo, actor: User) -> None:
    if not todo.calendar_event_id:
        return

    event = get_calendar_event_by_id(db, todo.calendar_event_id)
    if not event:
        return

    try:
        payload = CalendarEventUpdateRequest(
            id=event.id,
            status=todo.status,
            is_sync=True,
        )
        if todo.status == "COMPLETED":
            payload.completed_at = utcnow()
        update_calendar_event(db, payload, actor=actor, syncing=True)
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync todo->schedule transition: %s", exc)


def _sync_create_todo_for_event(db: Session, *, event: CalendarEvent, actor: User) -> None:
    from ..schemas.todo import TodoCreateRequest
    from .todo_service import create_todo

    try:
        todo = create_todo(
            db,
            TodoCreateRequest(
                title=event.title,
                descr=event.descr,
                status=event.status,
                priority=event.priority,
                start_time=event.start_time,
                due_date=event.end_time,
                expire_time=event.expire_time,
                is_sync=True,
                calendar_event_id=event.id,
            ),
            actor=actor,
            syncing=True,
        )
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync schedule->todo create: %s", exc)
        return

    event.todo_id = todo.id
    event.update_user = actor.username
    event.update_date = utcnow()
    db.commit()


def _sync_update_todo_for_event(db: Session, *, event: CalendarEvent, actor: User) -> None:
    if not event.todo_id:
        return

    from ..schemas.todo import TodoTransitionRequest, TodoUpdateRequest
    from .todo_service import get_todo_by_id, transition_todo, update_todo

    todo = get_todo_by_id(db, event.todo_id)
    if not todo:
        return

    try:
        update_todo(
            db,
            event.todo_id,
            TodoUpdateRequest(
                title=event.title,
                descr=event.descr,
                priority=event.priority,
                start_time=event.start_time,
                due_date=event.end_time,
                expire_time=event.expire_time,
                calendar_event_id=event.id,
                is_sync=True,
            ),
            actor=actor,
            syncing=True,
        )

        if todo.status != event.status:
            transition_todo(
                db,
                event.todo_id,
                TodoTransitionRequest(status=event.status, is_sync=True),
                actor=actor,
                syncing=True,
            )
    except Exception as exc:  # pragma: no cover - best effort sync
        logger.warning("Failed to sync schedule->todo update: %s", exc)


def expire_overdue_events(db: Session) -> int:
    now = utcnow()
    events = db.execute(
        select(CalendarEvent).where(
            CalendarEvent.expire_time.is_not(None),
            CalendarEvent.expire_time <= now,
            CalendarEvent.status.in_(sorted(SCHEDULE_ACTIVE_STATUSES)),
        )
    ).scalars().all()

    if not events:
        return 0

    for event in events:
        event.status = "EXPIRED"
        event.update_user = "system"
        event.update_date = now

    db.commit()
    return len(events)


def _chunk_text(text: str, *, chunk_size: int) -> list[str]:
    if not text:
        return []
    return [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]


def _coerce_generated_event(content: str) -> dict[str, object]:
    payload = _extract_json_object(content)

    title = str(payload.get("title") or "新日程").strip() or "新日程"
    descr = str(payload.get("descr") or payload.get("description") or "").strip()

    start_value = payload.get("start_time") or payload.get("startTime")
    end_value = payload.get("end_time") or payload.get("endTime")
    expire_value = payload.get("expire_time") or payload.get("expireTime")

    start_dt = _parse_datetime(start_value) or (utcnow() + timedelta(hours=1))
    end_dt = _parse_datetime(end_value) or (start_dt + timedelta(hours=1))
    if end_dt <= start_dt:
        end_dt = start_dt + timedelta(hours=1)

    expire_dt = _parse_datetime(expire_value)

    status_value = str(payload.get("status") or "SCHEDULED").upper()
    if status_value not in {"SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"}:
        status_value = "SCHEDULED"

    priority_value = str(payload.get("priority") or "MEDIUM").upper()
    if priority_value not in {"LOW", "MEDIUM", "HIGH"}:
        priority_value = "MEDIUM"

    all_day = bool(payload.get("all_day") if "all_day" in payload else payload.get("allDay", False))

    return {
        "title": title,
        "descr": descr,
        "status": status_value,
        "priority": priority_value,
        "start_time": start_dt.isoformat(),
        "end_time": end_dt.isoformat(),
        "expire_time": expire_dt.isoformat() if expire_dt else None,
        "all_day": all_day,
    }


def _extract_json_object(content: str) -> dict[str, object]:
    text = content.strip()
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no json object found")

    candidate = text[start:end + 1]
    value = json.loads(candidate)
    if not isinstance(value, dict):
        raise ValueError("json payload must be object")
    return value


def _parse_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None
