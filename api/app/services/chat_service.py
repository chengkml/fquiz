from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..models.base import utcnow
from ..models.chat import ChatMessage, ChatSession
from ..models.user import User
from ..schemas.chat import (
    ChatMessageCreateRequest,
    ChatMessageListResponse,
    ChatMessagePublic,
    ChatSendResponse,
    ChatSessionCreateRequest,
    ChatSessionListResponse,
    ChatSessionPublic,
)
from .llm_gateway import create_assistant_reply

settings = get_settings()


def list_sessions(db: Session, *, actor: User) -> ChatSessionListResponse:
    sessions = db.execute(
        select(ChatSession)
        .where(ChatSession.owner_user_id == actor.id)
        .order_by(ChatSession.updated_at.desc(), ChatSession.created_at.desc())
    ).scalars().all()
    return ChatSessionListResponse(items=[serialize_session(item) for item in sessions], total=len(sessions))


def create_session(
    db: Session,
    payload: ChatSessionCreateRequest,
    *,
    actor: User,
) -> ChatSessionPublic:
    title = (payload.title or "").strip() or "新会话"
    system_prompt = (payload.system_prompt or "").strip() or settings.chat_default_system_prompt
    session = ChatSession(
        owner_user_id=actor.id,
        title=title,
        system_prompt=system_prompt,
    )
    db.add(session)
    db.commit()

    saved = get_owned_session(db, session.id, actor_id=actor.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Chat session save failed")
    return serialize_session(saved)


def list_messages(
    db: Session,
    *,
    session_id: str,
    actor: User,
    limit: int = 200,
) -> ChatMessageListResponse:
    session = get_owned_session(db, session_id, actor_id=actor.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")

    safe_limit = max(1, min(limit, 500))
    messages = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
        .limit(safe_limit)
    ).scalars().all()
    return ChatMessageListResponse(items=[serialize_message(item) for item in messages], total=len(messages))


def send_message(
    db: Session,
    *,
    session_id: str,
    payload: ChatMessageCreateRequest,
    actor: User,
) -> ChatSendResponse:
    session = get_owned_session(db, session_id, actor_id=actor.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")

    normalized_content = payload.content.strip()
    if not normalized_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message content cannot be empty")

    user_message = ChatMessage(
        session_id=session.id,
        author_user_id=actor.id,
        role="user",
        content=normalized_content,
    )
    db.add(user_message)
    db.flush()

    context_messages = _load_context_messages(db, session_id=session.id, exclude_message_id=user_message.id)

    assistant_message: ChatMessage
    try:
        result = create_assistant_reply(
            db,
            user_message=normalized_content,
            context_messages=context_messages,
            system_prompt=session.system_prompt or settings.chat_default_system_prompt,
        )
        assistant_message = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=result.content,
            model_code=result.model_code,
            provider=result.provider,
            provider_model=result.provider_model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.total_tokens,
            latency_ms=result.latency_ms,
            is_error=False,
        )
        session.model_code = result.model_code
    except HTTPException as exc:
        assistant_message = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=f"模型调用失败：{exc.detail}",
            is_error=True,
            error_message=str(exc.detail),
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        assistant_message = ChatMessage(
            session_id=session.id,
            role="assistant",
            content="模型调用失败：unexpected_error",
            is_error=True,
            error_message=str(exc),
        )

    db.add(assistant_message)

    # Set a meaningful title after first user turn.
    if session.title in {"新会话", "New Chat"}:
        session.title = _derive_title(normalized_content)

    now = utcnow()
    session.last_message_at = now
    session.updated_at = now
    db.commit()

    saved_session = get_owned_session(db, session.id, actor_id=actor.id)
    saved_user_message = db.execute(select(ChatMessage).where(ChatMessage.id == user_message.id)).scalar_one_or_none()
    saved_assistant_message = db.execute(select(ChatMessage).where(ChatMessage.id == assistant_message.id)).scalar_one_or_none()
    if not saved_session or not saved_user_message or not saved_assistant_message:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Chat message save failed")

    return ChatSendResponse(
        session=serialize_session(saved_session),
        user_message=serialize_message(saved_user_message),
        assistant_message=serialize_message(saved_assistant_message),
    )


def get_owned_session(db: Session, session_id: str, *, actor_id: str) -> ChatSession | None:
    return db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.owner_user_id == actor_id,
        )
    ).scalar_one_or_none()


def serialize_session(session: ChatSession) -> ChatSessionPublic:
    return ChatSessionPublic(
        id=session.id,
        owner_user_id=session.owner_user_id,
        title=session.title,
        system_prompt=session.system_prompt,
        model_code=session.model_code,
        last_message_at=session.last_message_at,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def serialize_message(message: ChatMessage) -> ChatMessagePublic:
    return ChatMessagePublic(
        id=message.id,
        session_id=message.session_id,
        author_user_id=message.author_user_id,
        role=message.role,
        content=message.content,
        is_error=message.is_error,
        model_code=message.model_code,
        provider=message.provider,
        provider_model=message.provider_model,
        prompt_tokens=message.prompt_tokens,
        completion_tokens=message.completion_tokens,
        total_tokens=message.total_tokens,
        latency_ms=message.latency_ms,
        error_message=message.error_message,
        created_at=message.created_at,
    )


def _load_context_messages(
    db: Session,
    *,
    session_id: str,
    exclude_message_id: int | None = None,
) -> list[tuple[str, str]]:
    limit = max(1, settings.chat_context_message_limit)
    messages = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(limit)
    ).scalars().all()
    messages.reverse()
    result: list[tuple[str, str]] = []
    for item in messages:
        if item.role not in {"user", "assistant"}:
            continue
        if exclude_message_id is not None and item.id == exclude_message_id:
            continue
        result.append((item.role, item.content))
    return result


def _derive_title(content: str) -> str:
    compact = " ".join(content.split())
    if len(compact) <= 32:
        return compact or "新会话"
    return f"{compact[:32]}..."
