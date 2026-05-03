from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ElevationDatasetStatus = Literal["active", "disabled"]
ElevationDatasetUsageStatus = Literal["idle", "in_use"]
ElevationApplyMode = Literal["fill_null_only", "overwrite_all"]
ElevationApplyJobStatus = Literal["pending", "running", "success", "failed"]


class ElevationDatasetSummary(BaseModel):
    id: str
    code: str
    name: str
    source: str | None = None
    file_format: str
    mount_code: str
    dataset_dir: str
    file_path: str
    resolution_m: float | None = None
    status: ElevationDatasetStatus
    usage_status: ElevationDatasetUsageStatus
    sample_count: int = 0
    bbox_min_lon: float | None = None
    bbox_max_lon: float | None = None
    bbox_min_lat: float | None = None
    bbox_max_lat: float | None = None
    notes: str | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class ElevationDatasetListResponse(BaseModel):
    items: list[ElevationDatasetSummary]
    total: int


class ElevationDatasetBatchImportResponse(BaseModel):
    imported_count: int
    analyzed_count: int
    skipped_count: int
    warning_count: int
    warnings: list[str] = Field(default_factory=list)
    items: list[ElevationDatasetSummary] = Field(default_factory=list)


class ElevationDatasetCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=255)
    source: str | None = Field(default=None, max_length=128)
    mount_code: str | None = Field(default=None, min_length=2, max_length=64)
    file_name: str | None = Field(default=None, min_length=1, max_length=255)
    resolution_m: float | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=2000)


class ElevationDatasetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    source: str | None = Field(default=None, max_length=128)
    resolution_m: float | None = Field(default=None, gt=0)
    status: ElevationDatasetStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ElevationDatasetAnalyzeResponse(BaseModel):
    dataset: ElevationDatasetSummary
    warnings: list[str] = Field(default_factory=list)


class ElevationDatasetPreviewPoint(BaseModel):
    longitude: float
    latitude: float
    altitude_m: float


class ElevationDatasetPreviewCell(BaseModel):
    min_longitude: float
    max_longitude: float
    min_latitude: float
    max_latitude: float
    altitude_m: float


class ElevationDatasetPreviewDiagnostics(BaseModel):
    source_crs: str | None = None
    source_bounds_min_x: float | None = None
    source_bounds_max_x: float | None = None
    source_bounds_min_y: float | None = None
    source_bounds_max_y: float | None = None
    wgs84_bounds_min_lon: float | None = None
    wgs84_bounds_max_lon: float | None = None
    wgs84_bounds_min_lat: float | None = None
    wgs84_bounds_max_lat: float | None = None
    raster_width: int | None = None
    raster_height: int | None = None
    target_samples: int | None = None
    sampling_step: int | None = None
    scanned_candidates: int | None = None
    valid_preview_count: int | None = None
    skip_read_error: int = 0
    skip_masked: int = 0
    skip_nodata: int = 0
    skip_nonfinite: int = 0
    skip_sample_transform_error: int = 0
    sample_tx_first_error: str | None = None
    skip_sample_out_of_range: int = 0
    skip_cell_transform_error: int = 0
    skip_cell_out_of_range: int = 0


class ElevationDatasetPreviewResponse(BaseModel):
    dataset: ElevationDatasetSummary
    preview_mode: Literal["point_cloud", "terrain_grid"]
    total_points: int
    sampled_points: int
    points: list[ElevationDatasetPreviewPoint] = Field(default_factory=list)
    cells: list[ElevationDatasetPreviewCell] = Field(default_factory=list)
    diagnostics: ElevationDatasetPreviewDiagnostics | None = None
    warnings: list[str] = Field(default_factory=list)


class ElevationDatasetDataImportResponse(BaseModel):
    dataset: ElevationDatasetSummary
    uploaded_file_count: int
    extracted_file_count: int
    imported_file_count: int
    analyzed: bool = False
    warning_count: int
    warnings: list[str] = Field(default_factory=list)
    imported_files: list[str] = Field(default_factory=list)


class ElevationApplyJobSummary(BaseModel):
    id: str
    line_id: str
    line_code: str | None = None
    line_name: str | None = None
    dataset_id: str
    dataset_code: str | None = None
    dataset_name: str | None = None
    mode: ElevationApplyMode
    status: ElevationApplyJobStatus
    task_id: str | None = None
    total_tower_count: int = 0
    updated_tower_count: int = 0
    skipped_tower_count: int = 0
    missing_geo_count: int = 0
    unmatched_count: int = 0
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class ElevationApplyJobListResponse(BaseModel):
    items: list[ElevationApplyJobSummary]
    total: int


class ElevationApplyJobCreateRequest(BaseModel):
    line_id: str = Field(min_length=1, max_length=64)
    dataset_id: str = Field(min_length=1, max_length=64)
    mode: ElevationApplyMode = "fill_null_only"


class ElevationApplyJobCreateResponse(BaseModel):
    job: ElevationApplyJobSummary
    queued: bool = True
