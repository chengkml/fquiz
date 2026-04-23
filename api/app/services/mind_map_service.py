from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.mind_map import MindMap
from ..models.user import User
from ..schemas.mind_map import (
    MindMapBasicInfoUpdateRequest,
    MindMapCreateRequest,
    MindMapDataUpdateRequest,
    MindMapPageResponse,
    MindMapQueryRequest,
    MindMapSummary,
)
from .llm_gateway import create_assistant_reply

MIND_MAP_GENERATION_PROMPT = """你是思维导图生成助手。
请根据用户描述，输出一个 JSON 对象，不要输出额外文字。
JSON 结构必须符合下述格式：
{
  "nodeData": { "id": "root", "topic": "中心主题", "root": true },
  "nodeChild": [
    {
      "nodeData": { "id": "n1", "topic": "一级主题" },
      "nodeChild": [
        { "nodeData": { "id": "n1-1", "topic": "二级主题" }, "nodeChild": [] }
      ]
    }
  ]
}
要求：
1. 所有节点都使用 nodeData + nodeChild；
2. topic 用简洁中文短语；
3. 保持层次清晰，避免超过 4 层；
4. 输出必须是可解析 JSON。"""


def build_initial_mind_map_data(title: str) -> str:
    topic = (title or "").strip() or "新思维导图"
    data = {
        "nodeData": {
            "id": "root",
            "topic": topic,
            "root": True,
        },
        "nodeChild": [],
    }
    return json.dumps(data, ensure_ascii=False)


def serialize_mind_map(item: MindMap) -> MindMapSummary:
    return MindMapSummary(
        id=item.id,
        map_name=item.map_name,
        descr=item.descr,
        map_data=item.map_data,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def search_mind_maps(
    db: Session,
    payload: MindMapQueryRequest,
    *,
    actor: User,
) -> MindMapPageResponse:
    filters = [MindMap.create_user == actor.username]
    keyword = (payload.map_name or "").strip()
    if keyword:
        filters.append(MindMap.map_name.ilike(f"%{keyword}%"))

    total_stmt = select(func.count()).select_from(MindMap).where(*filters)
    total = int(db.execute(total_stmt).scalar_one() or 0)

    items = db.execute(
        select(MindMap)
        .where(*filters)
        .order_by(MindMap.create_date.desc())
        .offset(payload.page_num * payload.page_size)
        .limit(payload.page_size)
    ).scalars().all()

    return MindMapPageResponse(
        items=[serialize_mind_map(item) for item in items],
        total=total,
        page_num=payload.page_num,
        page_size=payload.page_size,
    )


def get_mind_map_by_id(
    db: Session,
    mind_map_id: str,
    *,
    actor: User | None = None,
) -> MindMap | None:
    item = db.execute(select(MindMap).where(MindMap.id == mind_map_id)).scalar_one_or_none()
    if not item:
        return None
    if actor and item.create_user != actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to access mind map")
    return item


def create_mind_map(
    db: Session,
    payload: MindMapCreateRequest,
    *,
    actor: User,
    fixed_id: str | None = None,
) -> MindMapSummary:
    now = utcnow()
    map_name = payload.map_name.strip()
    item = MindMap(
        id=(fixed_id or uuid4().hex),
        map_name=map_name,
        descr=_normalize_str(payload.descr) or "",
        map_data=_normalize_map_data(payload.map_data, map_name=map_name),
        create_user=actor.username,
        update_user=actor.username,
        create_date=now,
        update_date=now,
    )
    db.add(item)
    db.commit()

    saved = get_mind_map_by_id(db, item.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mind map save failed")
    return serialize_mind_map(saved)


def update_mind_map_basic_info(
    db: Session,
    payload: MindMapBasicInfoUpdateRequest,
    *,
    actor: User,
) -> MindMapSummary:
    item = get_mind_map_by_id(db, payload.id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mind map not found")

    item.map_name = payload.map_name.strip()
    item.descr = _normalize_str(payload.descr) or ""
    item.update_user = actor.username
    item.update_date = utcnow()
    db.commit()

    saved = get_mind_map_by_id(db, payload.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mind map load failed")
    return serialize_mind_map(saved)


def update_mind_map_data(
    db: Session,
    payload: MindMapDataUpdateRequest,
    *,
    actor: User,
) -> MindMapSummary:
    item = get_mind_map_by_id(db, payload.id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mind map not found")

    item.map_data = _normalize_map_data(payload.map_data, map_name=item.map_name)
    item.update_user = actor.username
    item.update_date = utcnow()
    db.commit()

    saved = get_mind_map_by_id(db, payload.id, actor=actor)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mind map load failed")
    return serialize_mind_map(saved)


def delete_mind_map(
    db: Session,
    mind_map_id: str,
    *,
    actor: User,
) -> dict[str, bool]:
    item = get_mind_map_by_id(db, mind_map_id, actor=actor)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mind map not found")

    db.delete(item)
    db.commit()
    return {"success": True}


async def stream_generate_mind_map(
    db: Session,
    *,
    descr: str,
) -> AsyncGenerator[str, None]:
    text = descr.strip()
    if not text:
        yield "[ERROR]思维导图描述不能为空"
        return

    yield "connected"
    try:
        result = create_assistant_reply(
            db,
            user_message=text,
            context_messages=[],
            system_prompt=MIND_MAP_GENERATION_PROMPT,
        )
        content = result.content.strip()
    except HTTPException as exc:
        yield f"[ERROR]{exc.detail}"
        return
    except Exception as exc:  # pragma: no cover - defensive fallback
        yield f"[ERROR]服务异常: {exc}"
        return

    for chunk in _chunk_text(content, chunk_size=120):
        yield chunk

    try:
        generated = _coerce_generated_mind_map(content)
        yield "[PARSE_RESULT]"
        yield f"[MINDMAP]{json.dumps(generated, ensure_ascii=False)}"
    except Exception as exc:
        yield f"[ERROR]解析JSON失败: {exc}"


def _normalize_map_data(map_data: str | None, *, map_name: str) -> str:
    value = (map_data or "").strip()
    if not value:
        return build_initial_mind_map_data(map_name)

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid map_data JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="map_data must be a JSON object")
    return json.dumps(parsed, ensure_ascii=False)


def _coerce_generated_mind_map(content: str) -> dict[str, object]:
    parsed = _load_json_object(content)
    if "nodeData" in parsed:
        return _normalize_node_tree(parsed, is_root=True)
    if "root" in parsed and isinstance(parsed["root"], dict):
        return _normalize_root_tree(parsed["root"], is_root=True)
    raise ValueError("JSON 格式不符合思维导图结构")


def _normalize_node_tree(node: dict[str, object], *, is_root: bool) -> dict[str, object]:
    node_data_raw = node.get("nodeData")
    node_data = node_data_raw if isinstance(node_data_raw, dict) else {}
    topic = _pick_topic(node_data, fallback="中心主题" if is_root else "未命名主题")
    node_id = _pick_node_id(node_data, fallback="root" if is_root else None)

    child_source = node.get("nodeChild")
    if not isinstance(child_source, list):
        alt_children = node.get("children")
        child_source = alt_children if isinstance(alt_children, list) else []

    normalized_children = [
        _normalize_node_tree(child, is_root=False)
        for child in child_source
        if isinstance(child, dict)
    ]
    normalized_node_data: dict[str, object] = {
        "id": node_id,
        "topic": topic,
    }
    if is_root:
        normalized_node_data["root"] = True

    return {
        "nodeData": normalized_node_data,
        "nodeChild": normalized_children,
    }


def _normalize_root_tree(node: dict[str, object], *, is_root: bool) -> dict[str, object]:
    data = node.get("data")
    data_obj = data if isinstance(data, dict) else {}
    topic = _pick_topic(data_obj, fallback="中心主题" if is_root else "未命名主题")
    node_id = _pick_node_id(node, fallback="root" if is_root else None)

    children_obj = node.get("children")
    children = children_obj if isinstance(children_obj, list) else []

    normalized_children = [
        _normalize_root_tree(child, is_root=False)
        for child in children
        if isinstance(child, dict)
    ]
    normalized_node_data: dict[str, object] = {
        "id": node_id,
        "topic": topic,
    }
    if is_root:
        normalized_node_data["root"] = True

    return {
        "nodeData": normalized_node_data,
        "nodeChild": normalized_children,
    }


def _pick_topic(data: dict[str, object], *, fallback: str) -> str:
    for key in ("topic", "text", "name", "title"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _pick_node_id(data: dict[str, object], *, fallback: str | None) -> str:
    value = data.get("id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    if fallback:
        return fallback
    return uuid4().hex[:8]


def _load_json_object(content: str) -> dict[str, object]:
    text = content.strip()
    text = _strip_markdown_fence(text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("JSON 顶层必须是对象")
    return parsed


def _strip_markdown_fence(content: str) -> str:
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _chunk_text(text: str, *, chunk_size: int) -> list[str]:
    if not text:
        return []
    return [text[index : index + chunk_size] for index in range(0, len(text), chunk_size)]


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None
