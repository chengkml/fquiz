from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


FlAnalysisJobType = Literal["normal", "tongtiao", "risk", "mitigation", "report", "scenario"]
FlAnalysisJobStatus = Literal["pending", "queued", "running", "blocked", "success", "failed"]
FlAnalysisRunStatus = Literal["pending", "running", "blocked", "success", "failed"]
FlAnalysisAdapter = Literal["placeholder", "wine", "atp", "custom"]


class FlAnalysisRunSummary(BaseModel):
    id: str
    job_id: str
    status: FlAnalysisRunStatus
    runner_kind: FlAnalysisAdapter | str
    engine_command: str | None = None
    working_dir: str | None = None
    error_message: str | None = None
    snapshot_tower_count: int = 0
    result_tower_count: int = 0
    duration_ms: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class FlAnalysisJobSummary(BaseModel):
    id: str
    line_id: str
    line_code: str | None = None
    line_name: str | None = None
    job_name: str | None = None
    job_type: FlAnalysisJobType | str
    source_kind: str
    status: FlAnalysisJobStatus | str
    task_id: str | None = None
    latest_run_id: str | None = None
    total_tower_count: int = 0
    snapshotted_tower_count: int = 0
    result_tower_count: int = 0
    external_adapter: FlAnalysisAdapter | str
    adapter_config_json: dict[str, Any] = Field(default_factory=dict)
    execution_options_json: dict[str, Any] = Field(default_factory=dict)
    result_summary_json: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class FlAnalysisJobDetail(FlAnalysisJobSummary):
    runs: list[FlAnalysisRunSummary] = Field(default_factory=list)


class FlAnalysisJobListResponse(BaseModel):
    items: list[FlAnalysisJobSummary]
    total: int


class FlAnalysisJobCreateRequest(BaseModel):
    line_id: str = Field(min_length=1, max_length=64)
    job_name: str | None = Field(default=None, min_length=1, max_length=255)
    job_type: FlAnalysisJobType = "normal"
    external_adapter: FlAnalysisAdapter = "placeholder"
    adapter_config_json: dict[str, Any] = Field(default_factory=dict)
    execution_options_json: dict[str, Any] = Field(default_factory=dict)


class FlAnalysisJobCreateResponse(BaseModel):
    job: FlAnalysisJobDetail


class FlAnalysisJobStartResponse(BaseModel):
    job: FlAnalysisJobDetail
    queued: bool = True


class FlAnalysisTowerResultSummary(BaseModel):
    id: str
    job_id: str
    run_id: str
    snapshot_id: str
    tower_id: str
    seq_no: int
    tower_no: str
    tower_model: str | None = None
    tower_type: str | None = None
    status: str
    risk_level: str | None = None
    summary_text: str | None = None
    result_json: dict[str, Any] = Field(default_factory=dict)
    create_date: datetime
    update_date: datetime


class FlAnalysisTowerResultListResponse(BaseModel):
    items: list[FlAnalysisTowerResultSummary]
    total: int
