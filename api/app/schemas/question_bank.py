from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .user import UserPublic

QuestionType = Literal["single_choice", "multiple_choice", "true_false", "short_answer"]
QuestionStatus = Literal["draft", "published", "archived"]
QuestionDifficulty = Literal["easy", "medium", "hard"]


class QuestionOption(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    content: str = Field(min_length=1, max_length=2000)


class QuestionBankSummary(BaseModel):
    id: int
    question_type: QuestionType
    stem: str
    options_json: list[dict[str, Any]] | None = None
    answer: str
    analysis: str | None = None
    difficulty: QuestionDifficulty
    status: QuestionStatus
    tags_json: list[str] | None = None
    creator_user_id: str | None = None
    updater_user_id: str | None = None
    created_at: datetime
    updated_at: datetime
    creator: UserPublic | None = None
    updater: UserPublic | None = None


class QuestionBankListResponse(BaseModel):
    items: list[QuestionBankSummary]
    total: int


class QuestionBankCreateRequest(BaseModel):
    question_type: QuestionType = "single_choice"
    stem: str = Field(min_length=1, max_length=20000)
    options_json: list[dict[str, Any]] | None = None
    answer: str = Field(min_length=1, max_length=20000)
    analysis: str | None = Field(default=None, max_length=20000)
    difficulty: QuestionDifficulty = "medium"
    status: QuestionStatus = "draft"
    tags_json: list[str] | None = None


class QuestionBankUpdateRequest(BaseModel):
    question_type: QuestionType | None = None
    stem: str | None = Field(default=None, min_length=1, max_length=20000)
    options_json: list[dict[str, Any]] | None = None
    answer: str | None = Field(default=None, min_length=1, max_length=20000)
    analysis: str | None = Field(default=None, max_length=20000)
    difficulty: QuestionDifficulty | None = None
    status: QuestionStatus | None = None
    tags_json: list[str] | None = None


class QuestionTagSummary(BaseModel):
    name: str
    count: int


class QuestionTagListResponse(BaseModel):
    items: list[QuestionTagSummary]
    total: int


class QuestionTagRenameRequest(BaseModel):
    old_tag: str = Field(min_length=1, max_length=128)
    new_tag: str = Field(min_length=1, max_length=128)


class QuestionTagDeleteRequest(BaseModel):
    tag: str = Field(min_length=1, max_length=128)


class QuestionTagMutationResponse(BaseModel):
    affected_questions: int
