from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission
from ...schemas.mermaid import (
    MermaidChatStreamRequest,
    MermaidDiagramCreateRequest,
    MermaidDiagramDataPatchRequest,
    MermaidDiagramPageResponse,
    MermaidDiagramQueryRequest,
    MermaidDiagramSummary,
    MermaidDiagramUpdateRequest,
    MermaidGroupListResponse,
)
from ...services.mermaid_service import (
    create_mermaid_diagram,
    delete_mermaid_diagram,
    get_mermaid_diagram_summary,
    list_mermaid_groups,
    search_mermaid_diagrams,
    stream_chat_mermaid_code,
    stream_generate_mermaid_code,
    update_mermaid_diagram,
    update_mermaid_diagram_data,
)

router = APIRouter(prefix="/mermaids/diagrams", tags=["mermaids"])


@router.post("/search", response_model=MermaidDiagramPageResponse)
def search_mermaid_endpoint(
    payload: MermaidDiagramQueryRequest,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidDiagramPageResponse:
    return search_mermaid_diagrams(db, payload, actor=current_user.user)


@router.get("/groups", response_model=MermaidGroupListResponse)
def list_mermaid_group_endpoint(
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidGroupListResponse:
    return list_mermaid_groups(db, actor=current_user.user)


@router.get("/get/{diagram_id}", response_model=MermaidDiagramSummary)
def get_mermaid_endpoint(
    diagram_id: str,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidDiagramSummary:
    item = get_mermaid_diagram_summary(db, diagram_id, actor=current_user.user)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mermaid diagram not found")
    return item


@router.post("/create", response_model=MermaidDiagramSummary)
def create_mermaid_endpoint(
    payload: MermaidDiagramCreateRequest,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidDiagramSummary:
    return create_mermaid_diagram(db, payload, actor=current_user.user)


@router.put("/update", response_model=MermaidDiagramSummary)
def update_mermaid_endpoint(
    payload: MermaidDiagramUpdateRequest,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidDiagramSummary:
    return update_mermaid_diagram(db, payload, actor=current_user.user)


@router.delete("/delete/{diagram_id}")
def delete_mermaid_endpoint(
    diagram_id: str,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_mermaid_diagram(db, diagram_id, actor=current_user.user)


@router.patch("/{diagram_id}/data", response_model=MermaidDiagramSummary)
def update_mermaid_data_endpoint(
    diagram_id: str,
    payload: MermaidDiagramDataPatchRequest,
    current_user: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> MermaidDiagramSummary:
    return update_mermaid_diagram_data(db, diagram_id, payload, actor=current_user.user)


@router.get("/generate/stream")
async def generate_mermaid_stream_endpoint(
    advice: str = Query(min_length=1),
    diagram_data: str | None = Query(default=None, alias="diagramData"),
    model_name: str | None = Query(default=None, alias="modelName"),
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    async def event_gen() -> AsyncGenerator[str, None]:
        async for chunk in stream_generate_mermaid_code(
            db,
            advice=advice,
            diagram_data=diagram_data,
            model_name=model_name,
        ):
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


@router.post("/chat/stream")
async def chat_mermaid_stream_endpoint(
    payload: MermaidChatStreamRequest,
    _: CurrentUser = Depends(require_any_permission("question_bank.read", "question_bank.manage")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    async def event_gen() -> AsyncGenerator[str, None]:
        async for chunk in stream_chat_mermaid_code(db, payload):
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
