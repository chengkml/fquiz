from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ModelStatus = Literal["DRAFT", "ENABLED", "DISABLED", "DEPRECATED"]
ModelRouteType = Literal["GLOBAL", "CAPABILITY", "BUSINESS", "AGENT"]
ModelHealthStatus = Literal["HEALTHY", "DEGRADED", "UNHEALTHY"]
ModelTestStatus = Literal["PASSED", "FAILED"]


class ModelUsageSummary(BaseModel):
    request_count: int = 0
    success_count: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    success_rate: float | None = None


class ModelTestSummary(BaseModel):
    total_runs: int = 0
    passed_runs: int = 0
    failed_runs: int = 0
    pass_rate: float | None = None


class ModelRegistryPublic(BaseModel):
    id: int
    code: str
    name: str
    provider: str
    provider_model: str
    status: ModelStatus
    capabilities: list[str] = Field(default_factory=list)
    description: str = ""
    base_url: str | None = None
    active_key_masked: str | None = None
    active_key_version: int | None = None
    active_key_fingerprint: str | None = None
    active_key_rotated_at: datetime | None = None
    latest_health_status: ModelHealthStatus | None = None
    latest_health_reason: str | None = None
    latest_health_at: datetime | None = None
    route_bindings_count: int = 0
    usage_7d: ModelUsageSummary = Field(default_factory=ModelUsageSummary)
    tests_7d: ModelTestSummary = Field(default_factory=ModelTestSummary)
    created_at: datetime
    updated_at: datetime


class ModelListResponse(BaseModel):
    items: list[ModelRegistryPublic]
    total: int


class ModelCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]{1,63}$")
    name: str = Field(min_length=2, max_length=128)
    provider: str = Field(min_length=2, max_length=64)
    provider_model: str = Field(min_length=1, max_length=128)
    status: ModelStatus = "DRAFT"
    capabilities: list[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=2000)
    base_url: str | None = Field(default=None, max_length=255)
    api_key: str | None = Field(default=None, min_length=8, max_length=1024)


class ModelUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=128)
    provider: str | None = Field(default=None, min_length=2, max_length=64)
    provider_model: str | None = Field(default=None, min_length=1, max_length=128)
    capabilities: list[str] | None = None
    description: str | None = Field(default=None, max_length=2000)
    base_url: str | None = Field(default=None, max_length=255)


class ModelTransitionRequest(BaseModel):
    status: ModelStatus
    note: str | None = Field(default=None, max_length=255)


class ModelRouteRulePublic(BaseModel):
    id: int
    route_type: ModelRouteType
    route_key: str
    target_model_code: str
    priority: int
    enabled: bool
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class ModelRouteRuleListResponse(BaseModel):
    items: list[ModelRouteRulePublic]
    total: int


class ModelRouteRuleCreateRequest(BaseModel):
    route_type: ModelRouteType
    route_key: str | None = Field(default=None, max_length=128)
    target_model_code: str = Field(min_length=2, max_length=64)
    priority: int = 100
    enabled: bool = True
    note: str | None = Field(default=None, max_length=255)


class ModelRouteRuleUpdateRequest(BaseModel):
    route_type: ModelRouteType | None = None
    route_key: str | None = Field(default=None, max_length=128)
    target_model_code: str | None = Field(default=None, min_length=2, max_length=64)
    priority: int | None = None
    enabled: bool | None = None
    note: str | None = Field(default=None, max_length=255)


class ModelApiKeyPublic(BaseModel):
    id: int
    model_id: int
    version: int
    secret_masked: str
    secret_fingerprint: str
    is_active: bool
    rotation_note: str | None = None
    created_by_user_id: str | None = None
    created_at: datetime


class ModelApiKeyListResponse(BaseModel):
    items: list[ModelApiKeyPublic]
    total: int


class ModelRotateKeyRequest(BaseModel):
    api_key: str = Field(min_length=8, max_length=1024)
    note: str | None = Field(default=None, max_length=255)


class ModelHealthCheckPublic(BaseModel):
    id: int
    model_id: int
    status: ModelHealthStatus
    reason: str
    latency_ms: int | None = None
    detail_json: dict | None = None
    created_at: datetime


class ModelHealthCheckListResponse(BaseModel):
    items: list[ModelHealthCheckPublic]
    total: int


class ModelTestRunRequest(BaseModel):
    kind: str = Field(default="SMOKE", min_length=2, max_length=32)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class ModelTestChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    system_prompt: str | None = Field(default=None, max_length=4000)


class ModelTestRunPublic(BaseModel):
    id: int
    model_id: int
    model_code: str
    kind: str
    status: ModelTestStatus
    input_tokens: int
    output_tokens: int
    latency_ms: int | None = None
    error_message: str | None = None
    created_by_user_id: str | None = None
    created_at: datetime


class ModelTestChatResponse(BaseModel):
    model_id: int
    model_code: str
    provider: str
    provider_model: str
    reply: str | None = None
    latency_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    test_status: ModelTestStatus
    error_message: str | None = None


class ModelTestRunListResponse(BaseModel):
    items: list[ModelTestRunPublic]
    total: int


class ModelUsageIngestRequest(BaseModel):
    model_code: str = Field(min_length=2, max_length=64)
    source: str = Field(default="RUNTIME", min_length=2, max_length=32)
    request_count: int = Field(default=1, ge=1)
    success_count: int = Field(default=1, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    total_cost_usd: float = Field(default=0.0, ge=0)


class ModelSummaryResponse(BaseModel):
    total_models: int
    status_counts: dict[str, int]
    total_route_rules: int
    route_type_counts: dict[str, int]
    enabled_without_healthy_check: int
    usage_7d: ModelUsageSummary
    tests_7d: ModelTestSummary
