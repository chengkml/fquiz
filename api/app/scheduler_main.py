from fastapi import FastAPI

from .api.v1.scheduler import router as scheduler_router

app = FastAPI(
    title="fquiz-scheduler",
    version="0.1.0",
)

app.include_router(scheduler_router, prefix="/api/v1")
