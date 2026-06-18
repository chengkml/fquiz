import traceback
from fastapi import Request, status
from fastapi.responses import JSONResponse

from .config import get_settings


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    settings = get_settings()

    error_response = {
        "detail": str(exc),
        "type": type(exc).__name__,
    }

    if settings.debug_mode:
        error_response["stacktrace"] = traceback.format_exc()

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_response,
    )
