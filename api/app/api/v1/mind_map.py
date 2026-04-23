from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.mind_map import (
    MindMapBasicInfoUpdateRequest,
    MindMapCreateRequest,
    MindMapDataUpdateRequest,
    MindMapPageResponse,
    MindMapQueryRequest,
    MindMapSummary,
)
from ...services.mind_map_service import (
    create_mind_map,
    delete_mind_map,
    get_mind_map_by_id,
    search_mind_maps,
    serialize_mind_map,
    stream_generate_mind_map,
    update_mind_map_basic_info,
    update_mind_map_data,
)

router = APIRouter(prefix="/mindmap", tags=["mindmap"])


@router.post("/search", response_model=MindMapPageResponse)
def search_mind_map_endpoint(
    payload: MindMapQueryRequest,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MindMapPageResponse:
    return search_mind_maps(db, payload, actor=current_user.user)


@router.get("/get/{mind_map_id}", response_model=MindMapSummary)
def get_mind_map_endpoint(
    mind_map_id: str,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MindMapSummary:
    item = get_mind_map_by_id(db, mind_map_id, actor=current_user.user)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mind map not found")
    return serialize_mind_map(item)


@router.post("/create", response_model=MindMapSummary)
def create_mind_map_endpoint(
    payload: MindMapCreateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> MindMapSummary:
    return create_mind_map(db, payload, actor=current_user.user)


@router.put("/update-basic-info", response_model=MindMapSummary)
def update_mind_map_basic_info_endpoint(
    payload: MindMapBasicInfoUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> MindMapSummary:
    return update_mind_map_basic_info(db, payload, actor=current_user.user)


@router.put("/update-data", response_model=MindMapSummary)
def update_mind_map_data_endpoint(
    payload: MindMapDataUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> MindMapSummary:
    return update_mind_map_data(db, payload, actor=current_user.user)


@router.delete("/delete/{mind_map_id}")
def delete_mind_map_endpoint(
    mind_map_id: str,
    current_user: CurrentUser = Depends(require_permission("question_bank.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_mind_map(db, mind_map_id, actor=current_user.user)


@router.get("/generate/stream")
async def generate_mind_map_stream_endpoint(
    descr: str = Query(min_length=1),
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    async def event_gen() -> AsyncGenerator[str, None]:
        async for chunk in stream_generate_mind_map(db, descr=descr):
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
