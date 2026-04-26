from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.wine import WineRunRequest, WineStatusResponse
from ...services.wine_service import get_wine_status, stream_wine_run


router = APIRouter(prefix="/wine", tags=["wine"])


@router.get("/status", response_model=WineStatusResponse)
async def get_wine_status_endpoint(
    _: CurrentUser = Depends(require_any_permission("wine.read", "wine.manage")),
) -> WineStatusResponse:
    return await get_wine_status()


@router.post("/test/stream")
async def test_wine_stream_endpoint(
    payload: WineRunRequest,
    _: CurrentUser = Depends(require_permission("wine.manage")),
) -> StreamingResponse:
    return _wine_stream_response(payload)


@router.post("/run/stream")
async def run_wine_stream_endpoint(
    payload: WineRunRequest,
    _: CurrentUser = Depends(require_permission("wine.manage")),
) -> StreamingResponse:
    return _wine_stream_response(payload)


def _wine_stream_response(payload: WineRunRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_wine_run(payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
