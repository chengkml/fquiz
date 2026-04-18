from fastapi import APIRouter, Depends, Query

from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.jwt_generator import (
    JwtGenerateRequest,
    JwtGenerateResponse,
    JwtGeneratorUserListResponse,
)
from ...services.jwt_generator_service import generate_jwt_for_user, list_jwt_generator_users

router = APIRouter(prefix="/admin/jwt-generator", tags=["admin-jwt-generator"])


@router.get("/users", response_model=JwtGeneratorUserListResponse)
def list_users_for_jwt_generator(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_any_permission("jwt_generator.read", "jwt_generator.manage")),
) -> JwtGeneratorUserListResponse:
    return list_jwt_generator_users(
        keyword=keyword,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )


@router.post("/generate", response_model=JwtGenerateResponse)
def generate_jwt_endpoint(
    payload: JwtGenerateRequest,
    _: CurrentUser = Depends(require_permission("jwt_generator.manage")),
) -> JwtGenerateResponse:
    return generate_jwt_for_user(payload)
