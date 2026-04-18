from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .user import UserPublic


class HotSearchRecordSummary(BaseModel):
    id: int
    source: str
    external_id: str | None = None
    title: str
    url: str | None = None
    hot_value: str | None = None
    rank_index: int | None = None
    crawl_time: datetime
    batch_no: str | None = None
    detail_markdown: str | None = None
    extra_json: dict | None = None
    matched_topics: list[str] = Field(default_factory=list)
    creator_user_id: str | None = None
    updater_user_id: str | None = None
    created_at: datetime
    updated_at: datetime
    creator: UserPublic | None = None
    updater: UserPublic | None = None


class HotSearchListResponse(BaseModel):
    items: list[HotSearchRecordSummary]
    total: int


class HotSearchQueryRequest(BaseModel):
    source: str | None = Field(default=None, max_length=32)
    title_keyword: str | None = Field(default=None, max_length=255)
    followed_only: bool = False


class HotSearchFollowTopicSummary(BaseModel):
    id: int
    topic_name: str
    keywords: str | None = None
    enabled: bool = True
    seq: int = 0
    created_at: datetime
    updated_at: datetime
    creator: UserPublic | None = None
    updater: UserPublic | None = None


class HotSearchFollowTopicListResponse(BaseModel):
    items: list[HotSearchFollowTopicSummary]
    total: int


class HotSearchFollowTopicCreateRequest(BaseModel):
    topic_name: str = Field(min_length=1, max_length=128)
    keywords: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    seq: int = Field(default=0, ge=0, le=999999)


class HotSearchFollowTopicUpdateRequest(BaseModel):
    topic_name: str | None = Field(default=None, min_length=1, max_length=128)
    keywords: str | None = Field(default=None, max_length=2000)
    enabled: bool | None = None
    seq: int | None = Field(default=None, ge=0, le=999999)
