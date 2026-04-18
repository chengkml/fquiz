from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .user import UserPublic


class VocabularyWordSummary(BaseModel):
    id: int
    word: str
    phonetic: str | None = None
    meaning: str
    example: str | None = None
    status: str
    created_by_user_id: str | None = None
    updated_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UserPublic | None = None
    updated_by: UserPublic | None = None


class VocabularyWordListResponse(BaseModel):
    items: list[VocabularyWordSummary]
    total: int


class VocabularyWordCreateRequest(BaseModel):
    word: str = Field(min_length=1, max_length=128)
    phonetic: str | None = Field(default=None, max_length=128)
    meaning: str = Field(default="", max_length=20000)
    example: str | None = Field(default=None, max_length=20000)
    status: str = Field(default="enabled", pattern="^(enabled|disabled)$")


class VocabularyWordUpdateRequest(BaseModel):
    word: str | None = Field(default=None, min_length=1, max_length=128)
    phonetic: str | None = Field(default=None, max_length=128)
    meaning: str | None = Field(default=None, max_length=20000)
    example: str | None = Field(default=None, max_length=20000)
    status: str | None = Field(default=None, pattern="^(enabled|disabled)$")


class VocabularyStatsSummary(BaseModel):
    total_words: int = 0
    enabled_words: int = 0
    disabled_words: int = 0
    enabled_rate: float | None = None
    missing_phonetic_words: int = 0
    missing_example_words: int = 0


class VocabularyStatusBucketItem(BaseModel):
    status: str
    count: int


class VocabularyInitialBucketItem(BaseModel):
    initial: str
    count: int


class VocabularyWordTrendItem(BaseModel):
    id: int
    word: str
    status: str
    updated_at: datetime


class VocabularyWordStatsResponse(BaseModel):
    summary: VocabularyStatsSummary
    status_buckets: list[VocabularyStatusBucketItem]
    initial_buckets: list[VocabularyInitialBucketItem]
    recently_updated: list[VocabularyWordTrendItem]
