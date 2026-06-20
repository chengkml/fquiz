from __future__ import annotations

import os
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..models.ai_chat import AiChatConversation, AiChatMessage
from ..schemas.ai_chat import (
    AiChatConversationCreateRequest,
    AiChatConversationDetail,
    AiChatConversationListResponse,
    AiChatConversationSummary,
    AiChatConversationUpdateRequest,
    AiChatMessageSummary,
)
from ..services.system_param_service import get_system_param_by_key
from .user_service import serialize_user


def serialize_message(msg: AiChatMessage) -> AiChatMessageSummary:
    return AiChatMessageSummary(
        id=msg.id,
        conversation_id=msg.conversation_id,
        role=msg.role,
        content=msg.content,
        created_at=msg.created_at,
    )


def serialize_conversation(conv: AiChatConversation, message_count: int = 0) -> AiChatConversationSummary:
    return AiChatConversationSummary(
        id=conv.id,
        title=conv.title,
        user_id=conv.user_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        user=serialize_user(conv.user) if conv.user else None,
        message_count=message_count,
    )


def serialize_conversation_detail(conv: AiChatConversation) -> AiChatConversationDetail:
    messages = sorted(conv.messages, key=lambda m: m.created_at)
    return AiChatConversationDetail(
        id=conv.id,
        title=conv.title,
        user_id=conv.user_id,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        user=serialize_user(conv.user) if conv.user else None,
        messages=[serialize_message(msg) for msg in messages],
    )


def list_conversations(
    db: Session,
    *,
    user_id: str,
    limit: int,
    offset: int,
) -> AiChatConversationListResponse:
    stmt = (
        select(AiChatConversation)
        .options(selectinload(AiChatConversation.user))
        .where(AiChatConversation.user_id == user_id)
    )

    total_stmt = select(func.count()).select_from(AiChatConversation).where(AiChatConversation.user_id == user_id)

    total = db.scalar(total_stmt) or 0
    items = (
        db.execute(
            stmt.order_by(AiChatConversation.updated_at.desc(), AiChatConversation.id.desc())
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    result_items = []
    for item in items:
        msg_count = db.scalar(
            select(func.count()).select_from(AiChatMessage).where(AiChatMessage.conversation_id == item.id)
        ) or 0
        result_items.append(serialize_conversation(item, message_count=msg_count))

    return AiChatConversationListResponse(items=result_items, total=total)


def get_conversation_by_id(db: Session, conversation_id: int, user_id: str) -> AiChatConversation | None:
    return db.execute(
        select(AiChatConversation)
        .options(
            selectinload(AiChatConversation.user),
            selectinload(AiChatConversation.messages),
        )
        .where(AiChatConversation.id == conversation_id, AiChatConversation.user_id == user_id)
    ).scalar_one_or_none()


def create_conversation(
    db: Session,
    payload: AiChatConversationCreateRequest,
    *,
    user_id: str,
) -> AiChatConversationSummary:
    conv = AiChatConversation(
        title=payload.title.strip(),
        user_id=user_id,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return serialize_conversation(conv, message_count=0)


def update_conversation(
    db: Session,
    conversation_id: int,
    payload: AiChatConversationUpdateRequest,
    *,
    user_id: str,
) -> AiChatConversationSummary | None:
    conv = get_conversation_by_id(db, conversation_id, user_id)
    if not conv:
        return None

    conv.title = payload.title.strip()
    db.commit()

    msg_count = db.scalar(
        select(func.count()).select_from(AiChatMessage).where(AiChatMessage.conversation_id == conv.id)
    ) or 0

    return serialize_conversation(conv, message_count=msg_count)


def delete_conversation(db: Session, conversation_id: int, *, user_id: str) -> bool:
    conv = get_conversation_by_id(db, conversation_id, user_id)
    if not conv:
        return False

    db.delete(conv)
    db.commit()
    return True


def send_message(
    db: Session,
    conversation_id: int,
    content: str,
    *,
    user_id: str,
) -> tuple[AiChatMessageSummary, AiChatMessageSummary] | None:
    conv = get_conversation_by_id(db, conversation_id, user_id)
    if not conv:
        return None

    user_message = AiChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=content.strip(),
    )
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    history = sorted(conv.messages, key=lambda m: m.created_at)
    history.append(user_message)

    try:
        reply_content = _call_openai_api(db, history)
    except Exception as e:
        reply_content = f"抱歉，AI服务暂时不可用：{str(e)}"

    assistant_message = AiChatMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=reply_content,
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    return serialize_message(user_message), serialize_message(assistant_message)


def _call_openai_api(db: Session, history: list[AiChatMessage]) -> str:
    api_key_param = get_system_param_by_key(db, "ai_chat.openai_api_key")
    model_param = get_system_param_by_key(db, "ai_chat.model")
    base_url_param = get_system_param_by_key(db, "ai_chat.base_url")

    api_key = api_key_param.param_value if api_key_param and api_key_param.status == "enabled" else None
    model = model_param.param_value if model_param and model_param.status == "enabled" else "gpt-3.5-turbo"
    base_url = base_url_param.param_value if base_url_param and base_url_param.status == "enabled" else "https://api.openai.com/v1"

    if not api_key:
        api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        raise ValueError("AI模型配置缺失：请在系统参数中配置 ai_chat.openai_api_key")

    messages = [{"role": msg.role, "content": msg.content} for msg in history]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    return data["choices"][0]["message"]["content"]
