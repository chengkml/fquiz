from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.mermaid_diagram import MermaidDiagram
from ..models.model_registry import ModelApiKey, ModelRegistry
from ..models.object_group import ObjectGroup, ObjectGroupRelation
from ..models.user import User
from ..schemas.mermaid import (
    MermaidChatStreamRequest,
    MermaidDiagramCreateRequest,
    MermaidDiagramDataPatchRequest,
    MermaidDiagramPageResponse,
    MermaidDiagramQueryRequest,
    MermaidDiagramSummary,
    MermaidDiagramUpdateRequest,
    MermaidGroupListResponse,
    MermaidGroupSummary,
)
from .llm_gateway import create_assistant_reply, create_reply_with_model

MERMAID_GROUP_TYPE = "MERMAID"

MERMAID_GENERATE_SYSTEM_PROMPT = """You are an expert in Mermaid diagrams.
Please update or generate Mermaid code based on the user advice.
IMPORTANT RULES:
1. Return ONLY the raw Mermaid code.
2. Do NOT wrap the code in markdown code blocks.
3. Do NOT include any conversational text."""

MERMAID_CHAT_SYSTEM_PROMPT_TEMPLATE = """You are an expert in Mermaid diagrams.
Current Mermaid Code:
{diagram_data}

IMPORTANT RULES:
1. Return ONLY the raw Mermaid code.
2. Do NOT wrap the code in markdown code blocks.
3. Do NOT include any conversational text."""


def search_mermaid_diagrams(
    db: Session,
    payload: MermaidDiagramQueryRequest,
    *,
    actor: User,
) -> MermaidDiagramPageResponse:
    filters = [MermaidDiagram.create_user == actor.username]

    keyword = _normalize_str(payload.key_word)
    if keyword:
        filters.append(MermaidDiagram.diagram_name.ilike(f"%{keyword}%"))

    normalized_group = _normalize_str(payload.group)
    if normalized_group:
        group_obj_ids = db.execute(
            select(ObjectGroupRelation.obj_id)
            .join(ObjectGroup, ObjectGroup.id == ObjectGroupRelation.group_id)
            .where(
                ObjectGroup.create_user == actor.username,
                ObjectGroup.type == MERMAID_GROUP_TYPE,
                ObjectGroup.name == normalized_group,
            )
        ).scalars().all()
        if not group_obj_ids:
            return MermaidDiagramPageResponse(
                items=[],
                total=0,
                page_num=payload.page_num,
                page_size=payload.page_size,
            )
        filters.append(MermaidDiagram.id.in_(set(group_obj_ids)))

    total_stmt = select(func.count()).select_from(MermaidDiagram).where(*filters)
    total = int(db.execute(total_stmt).scalar_one() or 0)

    items = db.execute(
        select(MermaidDiagram)
        .where(*filters)
        .order_by(MermaidDiagram.update_date.desc(), MermaidDiagram.create_date.desc())
        .offset(payload.page_num * payload.page_size)
        .limit(payload.page_size)
    ).scalars().all()

    group_map = _build_group_map(db, [item.id for item in items])
    return MermaidDiagramPageResponse(
        items=[serialize_mermaid_diagram(item, group_map.get(item.id)) for item in items],
        total=total,
        page_num=payload.page_num,
        page_size=payload.page_size,
    )


def list_mermaid_groups(
    db: Session,
    *,
    actor: User,
) -> MermaidGroupListResponse:
    groups = db.execute(
        select(ObjectGroup)
        .where(
            ObjectGroup.create_user == actor.username,
            ObjectGroup.type == MERMAID_GROUP_TYPE,
        )
        .order_by(ObjectGroup.label.asc(), ObjectGroup.name.asc())
    ).scalars().all()
    return MermaidGroupListResponse(
        items=[serialize_mermaid_group(item) for item in groups],
        total=len(groups),
    )


def get_mermaid_diagram_by_id(
    db: Session,
    diagram_id: str,
    *,
    actor: User | None = None,
) -> MermaidDiagram | None:
    item = db.execute(select(MermaidDiagram).where(MermaidDiagram.id == diagram_id)).scalar_one_or_none()
    if not item:
        return None
    if actor and item.create_user != actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to access mermaid diagram")
    return item


def get_mermaid_diagram_summary(
    db: Session,
    diagram_id: str,
    *,
    actor: User,
) -> MermaidDiagramSummary | None:
    item = get_mermaid_diagram_by_id(db, diagram_id, actor=actor)
    if not item:
        return None
    group_map = _build_group_map(db, [item.id])
    return serialize_mermaid_diagram(item, group_map.get(item.id))


def create_mermaid_diagram(
    db: Session,
    payload: MermaidDiagramCreateRequest,
    *,
    actor: User,
) -> MermaidDiagramSummary:
    now = utcnow()
    item = MermaidDiagram(
        id=uuid4().hex,
        diagram_name=payload.diagram_name.strip(),
        description=_normalize_str(payload.description) or "",
        diagram_data=_normalize_str(payload.diagram_data) or "",
        create_user=actor.username,
        update_user=actor.username,
        create_date=now,
        update_date=now,
    )
    db.add(item)
    db.flush()

    _replace_mermaid_group_relation(
        db,
        diagram_id=item.id,
        group_name=payload.group,
        actor=actor,
        now=now,
    )

    db.commit()
    saved = get_mermaid_diagram_summary(db, item.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mermaid diagram save failed")
    return saved


def update_mermaid_diagram(
    db: Session,
    payload: MermaidDiagramUpdateRequest,
    *,
    actor: User,
) -> MermaidDiagramSummary:
    item = get_mermaid_diagram_by_id(db, payload.id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mermaid diagram not found")

    now = utcnow()
    update_data = payload.model_dump(exclude_unset=True)

    if "diagram_name" in update_data and update_data["diagram_name"] is not None:
        item.diagram_name = str(update_data["diagram_name"]).strip()
    if "description" in update_data:
        item.description = _normalize_str(update_data["description"]) or ""
    if "diagram_data" in update_data:
        item.diagram_data = _normalize_str(update_data["diagram_data"]) or ""

    if "group" in update_data:
        _replace_mermaid_group_relation(
            db,
            diagram_id=item.id,
            group_name=update_data["group"],
            actor=actor,
            now=now,
        )

    item.update_user = actor.username
    item.update_date = now
    db.commit()

    saved = get_mermaid_diagram_summary(db, item.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mermaid diagram load failed")
    return saved


def update_mermaid_diagram_data(
    db: Session,
    diagram_id: str,
    payload: MermaidDiagramDataPatchRequest,
    *,
    actor: User,
) -> MermaidDiagramSummary:
    item = get_mermaid_diagram_by_id(db, diagram_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mermaid diagram not found")

    item.diagram_data = payload.diagram_data.strip()
    item.update_user = actor.username
    item.update_date = utcnow()
    db.commit()

    saved = get_mermaid_diagram_summary(db, diagram_id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mermaid diagram load failed")
    return saved


def delete_mermaid_diagram(
    db: Session,
    diagram_id: str,
    *,
    actor: User,
) -> dict[str, bool]:
    item = get_mermaid_diagram_by_id(db, diagram_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mermaid diagram not found")

    db.execute(delete(ObjectGroupRelation).where(ObjectGroupRelation.obj_id == item.id))
    db.delete(item)
    db.commit()
    return {"success": True}


async def stream_generate_mermaid_code(
    db: Session,
    *,
    advice: str,
    diagram_data: str | None,
    model_name: str | None,
) -> AsyncGenerator[str, None]:
    normalized_advice = (advice or "").strip()
    if not normalized_advice:
        yield "[ERROR]Advice cannot be empty"
        return

    system_prompt = (
        f"{MERMAID_GENERATE_SYSTEM_PROMPT}\n\n"
        f"Current Mermaid Code:\n{(diagram_data or '').strip()}"
    )

    try:
        result = _generate_mermaid_reply(
            db=db,
            user_message=normalized_advice,
            context_messages=[],
            system_prompt=system_prompt,
            model_name=model_name,
        )
    except HTTPException as exc:
        yield f"[ERROR]{exc.detail}"
        return
    except Exception as exc:  # pragma: no cover - defensive fallback
        yield f"[ERROR]服务异常: {exc}"
        return

    for chunk in _chunk_text(result, chunk_size=120):
        yield chunk


async def stream_chat_mermaid_code(
    db: Session,
    payload: MermaidChatStreamRequest,
) -> AsyncGenerator[str, None]:
    normalized_messages: list[tuple[str, str]] = []
    for item in payload.messages:
        content = item.content.strip()
        if not content:
            continue
        normalized_messages.append((item.role, content))

    if not normalized_messages:
        yield "[ERROR]Messages cannot be empty"
        return

    user_message: str | None = None
    context_messages: list[tuple[str, str]] = []
    for role, content in normalized_messages:
        if role == "user":
            user_message = content
            continue
        if role in {"assistant"}:
            context_messages.append((role, content))

    if not user_message:
        yield "[ERROR]Last user message is required"
        return

    # Use all messages except last user turn as context.
    context_messages = [
        (role, content)
        for role, content in normalized_messages[:-1]
        if role in {"user", "assistant"}
    ]

    system_prompt = MERMAID_CHAT_SYSTEM_PROMPT_TEMPLATE.format(
        diagram_data=(payload.diagram_data or "").strip(),
    )

    try:
        result = _generate_mermaid_reply(
            db=db,
            user_message=user_message,
            context_messages=context_messages,
            system_prompt=system_prompt,
            model_name=payload.model_name,
        )
    except HTTPException as exc:
        yield f"[ERROR]{exc.detail}"
        return
    except Exception as exc:  # pragma: no cover - defensive fallback
        yield f"[ERROR]服务异常: {exc}"
        return

    for chunk in _chunk_text(result, chunk_size=120):
        yield chunk


def serialize_mermaid_group(item: ObjectGroup) -> MermaidGroupSummary:
    return MermaidGroupSummary(
        id=item.id,
        name=item.name,
        label=item.label,
        type=item.type,
        descr=item.descr,
    )


def serialize_mermaid_diagram(
    item: MermaidDiagram,
    group: ObjectGroup | None,
) -> MermaidDiagramSummary:
    return MermaidDiagramSummary(
        id=item.id,
        diagram_name=item.diagram_name,
        description=item.description,
        diagram_data=item.diagram_data,
        group_name=group.name if group else None,
        group_label=group.label if group else None,
        tag_names=[],
        tag_labels=[],
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def _build_group_map(db: Session, diagram_ids: list[str]) -> dict[str, ObjectGroup]:
    if not diagram_ids:
        return {}

    relation_rows = db.execute(
        select(ObjectGroupRelation.obj_id, ObjectGroupRelation.group_id)
        .where(ObjectGroupRelation.obj_id.in_(diagram_ids))
        .order_by(ObjectGroupRelation.rela_id.asc())
    ).all()
    if not relation_rows:
        return {}

    obj_to_group_id: dict[str, str] = {}
    for obj_id, group_id in relation_rows:
        if obj_id not in obj_to_group_id:
            obj_to_group_id[obj_id] = group_id

    group_ids = sorted(set(obj_to_group_id.values()))
    groups = db.execute(select(ObjectGroup).where(ObjectGroup.id.in_(group_ids))).scalars().all()
    group_map = {group.id: group for group in groups}
    return {obj_id: group_map[group_id] for obj_id, group_id in obj_to_group_id.items() if group_id in group_map}


def _replace_mermaid_group_relation(
    db: Session,
    *,
    diagram_id: str,
    group_name: str | None,
    actor: User,
    now: datetime,
) -> None:
    db.execute(delete(ObjectGroupRelation).where(ObjectGroupRelation.obj_id == diagram_id))
    normalized_group_name = _normalize_str(group_name)
    if not normalized_group_name:
        return

    group = db.execute(
        select(ObjectGroup).where(
            ObjectGroup.create_user == actor.username,
            ObjectGroup.type == MERMAID_GROUP_TYPE,
            ObjectGroup.name == normalized_group_name,
        )
    ).scalar_one_or_none()

    if not group:
        group = ObjectGroup(
            id=uuid4().hex,
            name=normalized_group_name,
            label=normalized_group_name,
            type=MERMAID_GROUP_TYPE,
            descr="",
            create_user=actor.username,
            update_user=actor.username,
            create_date=now,
            update_date=now,
        )
        db.add(group)
        db.flush()

    relation = ObjectGroupRelation(
        rela_id=uuid4().hex,
        group_id=group.id,
        obj_id=diagram_id,
    )
    db.add(relation)


def _generate_mermaid_reply(
    db: Session,
    *,
    user_message: str,
    context_messages: list[tuple[str, str]],
    system_prompt: str,
    model_name: str | None,
) -> str:
    model = _resolve_enabled_model_by_name(db, model_name=model_name)
    if model:
        result = create_reply_with_model(
            model=model,
            user_message=user_message,
            context_messages=context_messages,
            system_prompt=system_prompt,
        )
        return result.content.strip()

    result = create_assistant_reply(
        db,
        user_message=user_message,
        context_messages=context_messages,
        system_prompt=system_prompt,
    )
    return result.content.strip()


def _resolve_enabled_model_by_name(
    db: Session,
    *,
    model_name: str | None,
) -> ModelRegistry | None:
    normalized = _normalize_str(model_name)
    if not normalized:
        return None

    candidates = db.execute(
        select(ModelRegistry)
        .where(
            ModelRegistry.name == normalized,
            ModelRegistry.status == "ENABLED",
        )
        .order_by(ModelRegistry.id.desc())
    ).scalars().all()

    for model in candidates:
        active_key = db.scalar(
            select(ModelApiKey.id).where(
                ModelApiKey.model_id == model.id,
                ModelApiKey.is_active.is_(True),
            )
        )
        if active_key is not None:
            return model

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Model not found or unavailable: {normalized}",
    )


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _chunk_text(text: str, *, chunk_size: int) -> list[str]:
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        start += chunk_size
    return chunks
