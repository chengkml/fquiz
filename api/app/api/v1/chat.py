from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_permission
from ...schemas.chat import (
    ChatMessageCreateRequest,
    ChatMessageListResponse,
    ChatSendResponse,
    ChatSessionCreateRequest,
    ChatSessionListResponse,
    ChatSessionPublic,
)
from ...services.chat_service import create_session, list_messages, list_sessions, send_message

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/sessions", response_model=ChatSessionListResponse)
def get_chat_sessions(
    current_user: CurrentUser = Depends(require_permission("chat.use")),
    db: Session = Depends(get_db),
) -> ChatSessionListResponse:
    return list_sessions(db, actor=current_user.user)


@router.post("/sessions", response_model=ChatSessionPublic)
def create_chat_session(
    payload: ChatSessionCreateRequest,
    current_user: CurrentUser = Depends(require_permission("chat.use")),
    db: Session = Depends(get_db),
) -> ChatSessionPublic:
    return create_session(db, payload, actor=current_user.user)


@router.get("/sessions/{session_id}/messages", response_model=ChatMessageListResponse)
def get_chat_messages(
    session_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    current_user: CurrentUser = Depends(require_permission("chat.use")),
    db: Session = Depends(get_db),
) -> ChatMessageListResponse:
    return list_messages(db, session_id=session_id, actor=current_user.user, limit=limit)


@router.post("/sessions/{session_id}/messages", response_model=ChatSendResponse)
def send_chat_message(
    session_id: str,
    payload: ChatMessageCreateRequest,
    current_user: CurrentUser = Depends(require_permission("chat.use")),
    db: Session = Depends(get_db),
) -> ChatSendResponse:
    return send_message(db, session_id=session_id, payload=payload, actor=current_user.user)
