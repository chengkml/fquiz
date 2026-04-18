from __future__ import annotations

import asyncio
from datetime import datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.hot_search import HotSearchFollowTopic, HotSearchRecord
from ..schemas.hot_search import (
    HotSearchFollowTopicCreateRequest,
    HotSearchFollowTopicListResponse,
    HotSearchFollowTopicSummary,
    HotSearchFollowTopicUpdateRequest,
    HotSearchListResponse,
    HotSearchQueryRequest,
    HotSearchRecordSummary,
)
from .push_service import publish_topic
from .user_service import serialize_user

HOT_SEARCH_TOPIC = "admin.hot_search"
HOT_SEARCH_FOLLOW_TOPIC = "admin.hot_search.follow_topics"


def _record_stmt() -> Select[tuple[HotSearchRecord]]:
    return select(HotSearchRecord).options(
        selectinload(HotSearchRecord.creator),
        selectinload(HotSearchRecord.updater),
    )


def _topic_stmt() -> Select[tuple[HotSearchFollowTopic]]:
    return select(HotSearchFollowTopic).options(
        selectinload(HotSearchFollowTopic.creator),
        selectinload(HotSearchFollowTopic.updater),
    )


def _normalize_topic_name(value: str) -> str:
    return value.strip()


def _normalize_keywords(value: str | None) -> list[str]:
    if not value:
        return []
    cleaned = value.replace("，", ",").replace("\n", ",")
    parts = [part.strip().lower() for part in cleaned.split(",")]
    return [part for part in parts if part]


def _extract_text_haystack(record: HotSearchRecord) -> str:
    chunks: list[str] = []
    for candidate in [record.title, record.detail_markdown, record.hot_value, record.url]:
        if candidate:
            chunks.append(candidate.lower())
    return " ".join(chunks)


def _calc_matched_topics(record: HotSearchRecord, topics: list[HotSearchFollowTopic]) -> list[str]:
    if not topics:
        return []

    haystack = _extract_text_haystack(record)
    if not haystack:
        return []

    matched: list[str] = []
    for topic in topics:
        if topic.enabled is False:
            continue
        keywords = _normalize_keywords(topic.keywords)
        if not keywords:
            continue
        if any(keyword in haystack for keyword in keywords):
            matched.append(topic.topic_name)
    return matched


def _to_record_summary(record: HotSearchRecord, matched_topics: list[str]) -> HotSearchRecordSummary:
    return HotSearchRecordSummary(
        id=record.id,
        source=record.source,
        external_id=record.external_id,
        title=record.title,
        url=record.url,
        hot_value=record.hot_value,
        rank_index=record.rank_index,
        crawl_time=record.crawl_time,
        batch_no=record.batch_no,
        detail_markdown=record.detail_markdown,
        extra_json=record.extra_json,
        matched_topics=matched_topics,
        creator_user_id=record.creator_user_id,
        updater_user_id=record.updater_user_id,
        created_at=record.created_at,
        updated_at=record.updated_at,
        creator=serialize_user(record.creator) if record.creator else None,
        updater=serialize_user(record.updater) if record.updater else None,
    )


def _to_topic_summary(topic: HotSearchFollowTopic) -> HotSearchFollowTopicSummary:
    return HotSearchFollowTopicSummary(
        id=topic.id,
        topic_name=topic.topic_name,
        keywords=topic.keywords,
        enabled=topic.enabled,
        seq=topic.seq,
        created_at=topic.created_at,
        updated_at=topic.updated_at,
        creator=serialize_user(topic.creator) if topic.creator else None,
        updater=serialize_user(topic.updater) if topic.updater else None,
    )


def _seed_initial_hot_search_records(db: Session) -> None:
    existing = db.scalar(select(func.count(HotSearchRecord.id))) or 0
    if existing > 0:
        return

    now = datetime.now().replace(microsecond=0)
    samples = [
        HotSearchRecord(
            source="TOUTIAO",
            external_id="sample-1",
            title="AI 模型价格再次下调，开发者关注推理成本",
            hot_value="1960万",
            rank_index=1,
            url="https://example.com/hot-search/sample-1",
            detail_markdown="## 事件摘要\n\n多家模型服务商下调 API 价格，企业正评估迁移窗口。",
            batch_no="bootstrap",
            crawl_time=now,
            extra_json={"channel": "sample", "category": "ai"},
        ),
        HotSearchRecord(
            source="TOUTIAO",
            external_id="sample-2",
            title="多地中小学上线 AI 助教系统，作业讲评提效",
            hot_value="1320万",
            rank_index=2,
            url="https://example.com/hot-search/sample-2",
            detail_markdown="## 校园场景\n\nAI 助教用于错题归因与个性化讲解，教师反馈效率提升。",
            batch_no="bootstrap",
            crawl_time=now,
            extra_json={"channel": "sample", "category": "education"},
        ),
        HotSearchRecord(
            source="TOUTIAO",
            external_id="sample-3",
            title="开源社区发布新一代推理框架，支持边缘部署",
            hot_value="980万",
            rank_index=3,
            url="https://example.com/hot-search/sample-3",
            detail_markdown="## 技术亮点\n\n新增量化与缓存优化，边缘设备延迟降低约 30%。",
            batch_no="bootstrap",
            crawl_time=now,
            extra_json={"channel": "sample", "category": "opensource"},
        ),
    ]
    db.add_all(samples)
    db.flush()


def _seed_initial_follow_topics(db: Session) -> None:
    existing = db.scalar(select(func.count(HotSearchFollowTopic.id))) or 0
    if existing > 0:
        return

    topics = [
        HotSearchFollowTopic(topic_name="AI模型", keywords="ai,模型,推理,大模型", enabled=True, seq=10),
        HotSearchFollowTopic(topic_name="教育场景", keywords="作业,学校,助教,教学", enabled=True, seq=20),
        HotSearchFollowTopic(topic_name="开源技术", keywords="开源,框架,部署", enabled=True, seq=30),
    ]
    db.add_all(topics)
    db.flush()


def seed_hot_search_defaults(db: Session) -> None:
    _seed_initial_hot_search_records(db)
    _seed_initial_follow_topics(db)


def _build_search_stmt(payload: HotSearchQueryRequest) -> Select[tuple[HotSearchRecord]]:
    stmt = _record_stmt()
    if payload.source and payload.source.strip():
        stmt = stmt.where(HotSearchRecord.source == payload.source.strip().upper())

    if payload.title_keyword and payload.title_keyword.strip():
        keyword = payload.title_keyword.strip()
        like = f"%{keyword}%"
        stmt = stmt.where(
            or_(
                HotSearchRecord.title.ilike(like),
                HotSearchRecord.detail_markdown.ilike(like),
                HotSearchRecord.hot_value.ilike(like),
            )
        )
    return stmt


def list_hot_search_records(db: Session, payload: HotSearchQueryRequest) -> HotSearchListResponse:
    topics = db.execute(
        _topic_stmt().where(HotSearchFollowTopic.enabled.is_(True)).order_by(HotSearchFollowTopic.seq.asc(), HotSearchFollowTopic.id.asc())
    ).scalars().all()

    stmt = _build_search_stmt(payload)
    rows = db.execute(stmt.order_by(HotSearchRecord.crawl_time.desc(), HotSearchRecord.rank_index.asc().nullslast(), HotSearchRecord.id.desc())).scalars().all()

    items: list[HotSearchRecordSummary] = []
    for row in rows:
        matched_topics = _calc_matched_topics(row, topics)
        if payload.followed_only and not matched_topics:
            continue
        items.append(_to_record_summary(row, matched_topics))

    return HotSearchListResponse(items=items, total=len(items))


def get_hot_search_record(db: Session, record_id: int) -> HotSearchRecordSummary | None:
    record = db.execute(_record_stmt().where(HotSearchRecord.id == record_id)).scalar_one_or_none()
    if not record:
        return None

    topics = db.execute(
        _topic_stmt().where(HotSearchFollowTopic.enabled.is_(True)).order_by(HotSearchFollowTopic.seq.asc(), HotSearchFollowTopic.id.asc())
    ).scalars().all()
    matched_topics = _calc_matched_topics(record, topics)
    return _to_record_summary(record, matched_topics)


def list_hot_search_follow_topics(db: Session) -> HotSearchFollowTopicListResponse:
    items = db.execute(_topic_stmt().order_by(HotSearchFollowTopic.seq.asc(), HotSearchFollowTopic.id.asc())).scalars().all()
    return HotSearchFollowTopicListResponse(items=[_to_topic_summary(item) for item in items], total=len(items))


def _get_topic_by_name(db: Session, topic_name: str) -> HotSearchFollowTopic | None:
    normalized = _normalize_topic_name(topic_name).lower()
    return db.scalar(select(HotSearchFollowTopic).where(func.lower(HotSearchFollowTopic.topic_name) == normalized))


def create_hot_search_follow_topic(
    db: Session,
    payload: HotSearchFollowTopicCreateRequest,
    *,
    actor_user_id: str,
) -> HotSearchFollowTopicSummary | None:
    topic_name = _normalize_topic_name(payload.topic_name)
    if not topic_name:
        return None

    existed = _get_topic_by_name(db, topic_name)
    if existed:
        return None

    item = HotSearchFollowTopic(
        topic_name=topic_name,
        keywords=(payload.keywords or "").strip() or None,
        enabled=payload.enabled,
        seq=payload.seq,
        creator_user_id=actor_user_id,
        updater_user_id=actor_user_id,
    )
    db.add(item)
    db.commit()

    saved = db.execute(_topic_stmt().where(HotSearchFollowTopic.id == item.id)).scalar_one_or_none()
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            HOT_SEARCH_FOLLOW_TOPIC,
            name="hot_search.follow_topic.changed",
            payload={"action": "created", "topic_id": saved.id, "topic_name": saved.topic_name},
            requires_refetch=["/api/v1/admin/hot-search/follow-topics", "/api/v1/admin/hot-search/search"],
            dedupe_key=f"hot-search:follow-topic:created:{saved.id}",
        )
    )

    return _to_topic_summary(saved)


def update_hot_search_follow_topic(
    db: Session,
    topic_id: int,
    payload: HotSearchFollowTopicUpdateRequest,
    *,
    actor_user_id: str,
) -> tuple[HotSearchFollowTopicSummary | None, str | None]:
    item = db.execute(_topic_stmt().where(HotSearchFollowTopic.id == topic_id)).scalar_one_or_none()
    if not item:
        return None, "not_found"

    update_data = payload.model_dump(exclude_unset=True)

    if "topic_name" in update_data and update_data["topic_name"] is not None:
        topic_name = _normalize_topic_name(str(update_data["topic_name"]))
        if not topic_name:
            return None, "invalid_topic_name"
        existed = _get_topic_by_name(db, topic_name)
        if existed and existed.id != item.id:
            return None, "duplicate_topic_name"
        item.topic_name = topic_name

    if "keywords" in update_data:
        item.keywords = (str(update_data["keywords"]) if update_data["keywords"] is not None else "").strip() or None
    if "enabled" in update_data and update_data["enabled"] is not None:
        item.enabled = bool(update_data["enabled"])
    if "seq" in update_data and update_data["seq"] is not None:
        item.seq = int(update_data["seq"])

    item.updater_user_id = actor_user_id
    db.commit()

    saved = db.execute(_topic_stmt().where(HotSearchFollowTopic.id == topic_id)).scalar_one_or_none()
    if not saved:
        return None, "not_found"

    _fire_and_forget(
        publish_topic(
            HOT_SEARCH_FOLLOW_TOPIC,
            name="hot_search.follow_topic.changed",
            payload={"action": "updated", "topic_id": saved.id, "topic_name": saved.topic_name},
            requires_refetch=["/api/v1/admin/hot-search/follow-topics", "/api/v1/admin/hot-search/search"],
            dedupe_key=f"hot-search:follow-topic:updated:{saved.id}",
        )
    )

    return _to_topic_summary(saved), None


def delete_hot_search_follow_topic(db: Session, topic_id: int) -> bool:
    item = db.execute(_topic_stmt().where(HotSearchFollowTopic.id == topic_id)).scalar_one_or_none()
    if not item:
        return False

    deleted_id = item.id
    db.delete(item)
    db.commit()

    _fire_and_forget(
        publish_topic(
            HOT_SEARCH_FOLLOW_TOPIC,
            name="hot_search.follow_topic.changed",
            payload={"action": "deleted", "topic_id": deleted_id},
            requires_refetch=["/api/v1/admin/hot-search/follow-topics", "/api/v1/admin/hot-search/search"],
            dedupe_key=f"hot-search:follow-topic:deleted:{deleted_id}",
        )
    )
    return True


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
