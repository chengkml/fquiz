from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AtpModelStatus = Literal["enabled", "disabled"]
AtpModelSourceType = Literal["atpdraw", "atp", "manual"]
AtpModelVersionStatus = Literal["draft", "released", "archived"]
AtpSimulationRunStatus = Literal["pending", "running", "success", "failed"]
AtpEngineMode = Literal["wine", "native"]


class AtpModelSummary(BaseModel):
    id: str
    code: str
    name: str
    source_type: AtpModelSourceType
    description: str
    status: AtpModelStatus
    tags_json: list[str] = Field(default_factory=list)
    latest_version_no: int = 0
    active_version_no: int | None = None
    version_count: int = 0
    run_count: int = 0
    last_run_status: AtpSimulationRunStatus | None = None
    last_run_date: datetime | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class AtpModelListResponse(BaseModel):
    items: list[AtpModelSummary]
    total: int


class AtpModelCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    source_type: AtpModelSourceType = "atpdraw"
    description: str = Field(default="", max_length=8000)
    status: AtpModelStatus = "enabled"
    tags_json: list[str] = Field(default_factory=list, max_length=128)


class AtpModelUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    source_type: AtpModelSourceType | None = None
    description: str | None = Field(default=None, max_length=8000)
    status: AtpModelStatus | None = None
    tags_json: list[str] | None = Field(default=None, max_length=128)


class AtpModelVersionSummary(BaseModel):
    id: str
    model_id: str
    version_no: int
    version_tag: str | None = None
    status: AtpModelVersionStatus
    entry_file: str | None = None
    change_note: str
    artifact_manifest_json: dict[str, Any] = Field(default_factory=dict)
    content_hash: str
    atp_text_size: int
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class AtpModelVersionDetail(AtpModelVersionSummary):
    atp_text: str
    graph_json: dict[str, Any] = Field(default_factory=dict)


class AtpModelVersionListResponse(BaseModel):
    items: list[AtpModelVersionSummary]
    total: int


class AtpModelVersionCreateRequest(BaseModel):
    version_tag: str | None = Field(default=None, max_length=64)
    status: AtpModelVersionStatus = "released"
    entry_file: str | None = Field(default=None, max_length=255)
    change_note: str = Field(default="", max_length=8000)
    artifact_manifest_json: dict[str, Any] = Field(default_factory=dict)
    graph_json: dict[str, Any] = Field(default_factory=dict)
    atp_text: str = Field(min_length=1)


class AtpModelVersionUpdateRequest(BaseModel):
    version_tag: str | None = Field(default=None, max_length=64)
    status: AtpModelVersionStatus | None = None
    entry_file: str | None = Field(default=None, max_length=255)
    change_note: str | None = Field(default=None, max_length=8000)
    artifact_manifest_json: dict[str, Any] | None = None
    graph_json: dict[str, Any] | None = None
    atp_text: str | None = Field(default=None, min_length=1)


class AtpSimulationRunSummary(BaseModel):
    id: str
    model_id: str
    version_id: str | None = None
    version_no: int | None = None
    status: AtpSimulationRunStatus
    engine_mode: AtpEngineMode
    engine_command: str | None = None
    working_dir: str | None = None
    timeout_seconds: int
    exit_code: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    error_message: str | None = None
    stdout_size: int = 0
    stderr_size: int = 0
    create_date: datetime
    create_user: str | None = None


class AtpSimulationRunDetail(AtpSimulationRunSummary):
    stdout_text: str | None = None
    stderr_text: str | None = None


class AtpSimulationRunListResponse(BaseModel):
    items: list[AtpSimulationRunSummary]
    total: int


class AtpSimulationRunRequest(BaseModel):
    version_id: str | None = None
    version_no: int | None = Field(default=None, ge=1)
    timeout_seconds: int | None = Field(default=None, ge=1)
    extra_args: list[str] = Field(default_factory=list, max_length=32)
    environment: dict[str, str] = Field(default_factory=dict, max_length=16)
    dry_run: bool = False


class AtpEngineStatusResponse(BaseModel):
    mode: AtpEngineMode
    available: bool
    executable_path: str
    resolved_executable: str | None = None
    storage_root: str
    workdir: str
    default_timeout_seconds: int
    max_timeout_seconds: int
    error: str | None = None
