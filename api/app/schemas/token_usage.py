from __future__ import annotations

from pydantic import BaseModel, Field


class TokenUsageSummary(BaseModel):
    request_count: int = 0
    success_count: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    success_rate: float | None = None


class TokenUsageDailyItem(TokenUsageSummary):
    date: str


class TokenUsageModelItem(TokenUsageSummary):
    model_code: str


class TokenUsageOverviewResponse(BaseModel):
    days: int = Field(ge=1, le=90)
    model_code: str | None = None
    start_date: str
    end_date: str
    summary: TokenUsageSummary
    trend: list[TokenUsageDailyItem]
    top_models: list[TokenUsageModelItem]
