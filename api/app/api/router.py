from fastapi import APIRouter

from .v1.admin import router as admin_router
from .v1.admin_files import router as admin_files_router
from .v1.auth import router as auth_router
from .v1.chat import router as chat_router
from .v1.hot_search import router as hot_search_router
from .v1.jwt_generator import router as jwt_generator_router
from .v1.life_countdown import router as life_countdown_router
from .v1.mdresolve import router as mdresolve_router
from .v1.question_bank import router as question_bank_router
from .v1.requirements import router as requirements_router
from .v1.system_messages import router as system_messages_router
from .v1.system_params import router as system_params_router
from .v1.todos import router as todos_router
from .v1.token_usage import router as token_usage_router
from .v1.users import router as users_router
from .v1.vocabulary import router as vocabulary_router
from .v1.ws import router as ws_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(admin_router)
api_router.include_router(admin_files_router)
api_router.include_router(requirements_router)
api_router.include_router(todos_router)
api_router.include_router(token_usage_router)
api_router.include_router(system_messages_router)
api_router.include_router(system_params_router)
api_router.include_router(jwt_generator_router)
api_router.include_router(chat_router)
api_router.include_router(life_countdown_router)
api_router.include_router(question_bank_router)
api_router.include_router(hot_search_router)
api_router.include_router(mdresolve_router)
api_router.include_router(vocabulary_router)
api_router.include_router(ws_router)


@api_router.get("/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}
