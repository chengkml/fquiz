from fastapi import APIRouter

from .project_requirement import router as project_requirement_router
from .v1.admin import router as admin_router
from .v1.admin_files import router as admin_files_router
from .v1.auth import router as auth_router
from .v1.calendar import router as calendar_router
from .v1.chat import router as chat_router
from .v1.diary import router as diary_router
from .v1.life_countdown import router as life_countdown_router
from .v1.lightning import router as lightning_router
from .v1.lines import router as lines_router
from .v1.mermaids import router as mermaids_router
from .v1.mind_map import router as mind_map_router
from .v1.question_bank import router as question_bank_router
from .v1.requirements import router as requirements_router
from .v1.system_params import router as system_params_router
from .v1.task_monitor import router as task_monitor_router
from .v1.todos import router as todos_router
from .v1.token_usage import router as token_usage_router
from .v1.users import router as users_router
from .v1.vocabulary import router as vocabulary_router
from .v1.wine import router as wine_router
from .v1.ws import router as ws_router

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(auth_router)
v1_router.include_router(users_router)
v1_router.include_router(admin_router)
v1_router.include_router(admin_files_router)
v1_router.include_router(requirements_router)
v1_router.include_router(todos_router)
v1_router.include_router(task_monitor_router)
v1_router.include_router(token_usage_router)
v1_router.include_router(system_params_router)
v1_router.include_router(chat_router)
v1_router.include_router(calendar_router)
v1_router.include_router(diary_router)
v1_router.include_router(life_countdown_router)
v1_router.include_router(lightning_router)
v1_router.include_router(lines_router)
v1_router.include_router(question_bank_router)
v1_router.include_router(mind_map_router)
v1_router.include_router(mermaids_router)
v1_router.include_router(vocabulary_router)
v1_router.include_router(wine_router)
v1_router.include_router(ws_router)

legacy_mermaid_router = APIRouter(prefix="/api")
legacy_mermaid_router.include_router(mermaids_router)


@v1_router.get("/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}


api_router = APIRouter()
api_router.include_router(v1_router)
api_router.include_router(project_requirement_router)
api_router.include_router(legacy_mermaid_router)
