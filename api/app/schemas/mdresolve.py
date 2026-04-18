from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .question_bank import QuestionBankSummary

QuestionType = Literal["single_choice", "multiple_choice", "true_false", "short_answer"]
QuestionStatus = Literal["draft", "published", "archived"]
QuestionDifficulty = Literal["easy", "medium", "hard"]


class MdResolveOption(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    content: str = Field(min_length=1, max_length=20000)


class MdResolveQuestionDraft(BaseModel):
    question_type: QuestionType = "single_choice"
    stem: str = Field(min_length=1, max_length=20000)
    options_json: list[MdResolveOption] | None = None
    answer: str = Field(min_length=1, max_length=20000)
    analysis: str | None = Field(default=None, max_length=20000)
    difficulty: QuestionDifficulty = "medium"
    status: QuestionStatus = "draft"
    tags_json: list[str] = Field(default_factory=list)


class MdResolveParseRequest(BaseModel):
    markdown: str = Field(min_length=1, max_length=300000)
    default_question_type: QuestionType = "single_choice"
    default_difficulty: QuestionDifficulty = "medium"
    default_status: QuestionStatus = "draft"


class MdResolveParseResponse(BaseModel):
    items: list[MdResolveQuestionDraft]
    total: int
    warnings: list[str] = Field(default_factory=list)


class MdResolveImportRequest(BaseModel):
    items: list[MdResolveQuestionDraft] = Field(min_length=1, max_length=500)


class MdResolveImportResponse(BaseModel):
    created_count: int
    items: list[QuestionBankSummary]
    warnings: list[str] = Field(default_factory=list)
