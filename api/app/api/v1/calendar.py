from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.calendar_event import (
    CalendarEventCreateRequest,
    CalendarEventPageResponse,
    CalendarEventQueryRequest,
    CalendarEventSummary,
    CalendarEventUpdateRequest,
)
from ...services.calendar_event_service import (
    complete_calendar_event,
    create_calendar_event,
    delete_calendar_event,
    get_calendar_event_by_id,
    search_calendar_events,
    serialize_calendar_event,
    stream_generate_calendar_event,
    update_calendar_event,
)

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.post("/search", response_model=CalendarEventPageResponse)
def search_calendar_endpoint(
    payload: CalendarEventQueryRequest,
    current_user: CurrentUser = Depends(require_permission("todo.read")),
    db: Session = Depends(get_db),
) -> CalendarEventPageResponse:
    return search_calendar_events(db, payload, actor=current_user.user)


@router.get("/get/{event_id}", response_model=CalendarEventSummary)
def get_calendar_endpoint(
    event_id: str,
    current_user: CurrentUser = Depends(require_permission("todo.read")),
    db: Session = Depends(get_db),
) -> CalendarEventSummary:
    event = get_calendar_event_by_id(db, event_id, actor=current_user.user)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
    return serialize_calendar_event(event)


@router.post("/create", response_model=CalendarEventSummary)
def create_calendar_endpoint(
    payload: CalendarEventCreateRequest,
    current_user: CurrentUser = Depends(require_any_permission("todo.create", "todo.manage")),
    db: Session = Depends(get_db),
) -> CalendarEventSummary:
    return create_calendar_event(db, payload, actor=current_user.user)


@router.put("/update", response_model=CalendarEventSummary)
def update_calendar_endpoint(
    payload: CalendarEventUpdateRequest,
    current_user: CurrentUser = Depends(require_any_permission("todo.process", "todo.manage")),
    db: Session = Depends(get_db),
) -> CalendarEventSummary:
    return update_calendar_event(db, payload, actor=current_user.user)


@router.delete("/delete/{event_id}")
def delete_calendar_endpoint(
    event_id: str,
    current_user: CurrentUser = Depends(require_any_permission("todo.process", "todo.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_calendar_event(db, event_id, actor=current_user.user)


@router.post("/{event_id}/complete", response_model=CalendarEventSummary)
def complete_calendar_endpoint(
    event_id: str,
    current_user: CurrentUser = Depends(require_any_permission("todo.process", "todo.manage")),
    db: Session = Depends(get_db),
) -> CalendarEventSummary:
    return complete_calendar_event(db, event_id, actor=current_user.user)


@router.get("/generate/stream")
async def generate_calendar_stream_endpoint(
    descr: str = Query(min_length=1),
    _: CurrentUser = Depends(require_permission("todo.read")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    async def event_gen() -> AsyncGenerator[str, None]:
        async for chunk in stream_generate_calendar_event(db, descr=descr):
            yield f"data: {chunk}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
