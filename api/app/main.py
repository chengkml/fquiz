from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.api_name,
    version=settings.api_version,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.api_name,
        "version": settings.api_version,
    }


@app.get("/api/v1/ping")
def ping() -> dict[str, str]:
    return {
        "message": "pong",
        "service": settings.api_name,
    }
