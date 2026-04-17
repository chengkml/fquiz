from fastapi import APIRouter

from .v1.admin import router as admin_router
from .v1.admin_files import router as admin_files_router
from .v1.auth import router as auth_router
from .v1.chat import router as chat_router
from .v1.requirements import router as requirements_router
from .v1.todos import router as todos_router
from .v1.users import router as users_router
from .v1.ws import router as ws_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(admin_router)
api_router.include_router(admin_files_router)
api_router.include_router(requirements_router)
api_router.include_router(todos_router)
api_router.include_router(chat_router)
api_router.include_router(ws_router)


@api_router.get("/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}
