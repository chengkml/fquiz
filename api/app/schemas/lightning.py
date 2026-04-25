from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

LightningPolarity = Literal["positive", "negative", "mixed", "unknown"]


class LightningCurrentEventSummary(BaseModel):
    id: str
    event_id: str
    source_file_name: str | None = None
    event_time: datetime | None = None
    sample_count: int = 0
    sample_interval_us: float | None = None
    sampling_frequency_hz: float | None = None
    peak_current_ka: float | None = None
    peak_abs_current_ka: float | None = None
    wavefront_time_t1_us: float | None = None
    half_value_time_t2_us: float | None = None
    steepness_ka_per_us: float | None = None
    action_integral_j_ohm: float | None = None
    wave_shape: str | None = None
    polarity: LightningPolarity
    stroke_count: int = 1
    stroke_peaks_json: list[dict[str, Any]] = Field(default_factory=list)
    region_id: str | None = None
    location_tag: str | None = None
    city: str | None = None
    longitude: float | None = None
    latitude: float | None = None
    altitude_m: float | None = None
    sensor_model: str | None = None
    install_position: str | None = None
    weather_level: str | None = None
    pressure_hpa: float | None = None
    humidity_percent: float | None = None
    is_synthetic: bool = False
    feature_json: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class LightningCurrentEventListResponse(BaseModel):
    items: list[LightningCurrentEventSummary]
    total: int
    limit: int
    offset: int


class LightningCurrentEventUpdateRequest(BaseModel):
    event_time: datetime | None = None
    region_id: str | None = Field(default=None, max_length=64)
    location_tag: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=128)
    longitude: float | None = None
    latitude: float | None = None
    altitude_m: float | None = None
    sensor_model: str | None = Field(default=None, max_length=128)
    install_position: str | None = Field(default=None, max_length=128)
    weather_level: str | None = Field(default=None, max_length=64)
    pressure_hpa: float | None = None
    humidity_percent: float | None = Field(default=None, ge=0, le=100)
    is_synthetic: bool | None = None
    wave_shape: str | None = Field(default=None, max_length=32)
    notes: str | None = None
    feature_json: dict[str, Any] | None = None


class LightningCurrentImportResponse(BaseModel):
    event: LightningCurrentEventSummary
    warning_count: int
    warnings: list[str] = Field(default_factory=list)


class LightningCurrentSampleItem(BaseModel):
    id: int
    event_ref_id: str
    seq_no: int
    time_us: float
    current_ka: float


class LightningCurrentSampleListResponse(BaseModel):
    items: list[LightningCurrentSampleItem]
    total: int
    limit: int
    offset: int


class LightningCurrentExceedancePoint(BaseModel):
    threshold_ka: float
    exceedance_probability: float
    exceedance_count: int


class LightningCurrentExceedanceResponse(BaseModel):
    total_events: int
    thresholds: list[LightningCurrentExceedancePoint]


class LightningDistributionImportResponse(BaseModel):
    imported_count: int
    skipped_count: int
    warning_count: int
    warnings: list[str] = Field(default_factory=list)


class LightningDistributionSummary(BaseModel):
    total_records: int
    area_km2: float
    data_years: float
    grid_size_km: float
    overall_ng_per_km2_year: float
    max_abs_current_ka: float | None = None
    avg_abs_current_ka: float | None = None


class LightningPolarityStats(BaseModel):
    positive_count: int = 0
    negative_count: int = 0
    mixed_count: int = 0
    unknown_count: int = 0
    positive_ratio: float = 0.0
    negative_ratio: float = 0.0


class LightningSourceStats(BaseModel):
    measured_count: int = 0
    synthetic_count: int = 0


class LightningDistributionGridCell(BaseModel):
    grid_x: int
    grid_y: int
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float
    center_lat: float
    center_lon: float
    strike_count: int
    ng_per_km2_year: float
    i_max_ka: float | None = None
    i_avg_ka: float | None = None
    positive_ratio: float = 0.0


class LightningDistributionScatterPoint(BaseModel):
    id: str
    event_id: str
    longitude: float
    latitude: float
    current_ka: float | None = None
    abs_current_ka: float | None = None
    polarity: LightningPolarity
    region_id: str | None = None
    city: str | None = None
    location_tag: str | None = None
    event_time: datetime | None = None


class LightningDistributionStatsResponse(BaseModel):
    summary: LightningDistributionSummary
    polarity: LightningPolarityStats
    sources: LightningSourceStats
    grid_cells: list[LightningDistributionGridCell] = Field(default_factory=list)
    scatter_points: list[LightningDistributionScatterPoint] = Field(default_factory=list)
    p_curve: list[LightningCurrentExceedancePoint] = Field(default_factory=list)


class LightningDistributionEventBrief(BaseModel):
    id: str
    event_id: str
    longitude: float | None = None
    latitude: float | None = None
    current_ka: float | None = None
    abs_current_ka: float | None = None
    polarity: LightningPolarity
    event_time: datetime | None = None
    location_tag: str | None = None
    city: str | None = None


class LightningTowerBufferEventItem(LightningDistributionEventBrief):
    distance_km: float


class LightningTowerBufferStatsResponse(BaseModel):
    tower_id: str | None = None
    tower_no: str | None = None
    line_id: str | None = None
    center_longitude: float
    center_latitude: float
    radius_km: float
    design_current_ka: float
    strike_count: int
    exceed_design_count: int
    max_abs_current_ka: float | None = None
    avg_abs_current_ka: float | None = None
    ng_per_km2_year: float
    positive_ratio: float = 0.0
    risk_level: str
    recommended_action: str
    events: list[LightningTowerBufferEventItem] = Field(default_factory=list)


class LightningSyntheticDatasetStats(BaseModel):
    count: int
    max_abs_current_ka: float | None = None
    avg_abs_current_ka: float | None = None
    positive_ratio: float = 0.0
    ng_per_km2_year: float = 0.0


class LightningSyntheticCompareResponse(BaseModel):
    grid_size_km: float
    data_years: float
    measured: LightningSyntheticDatasetStats
    synthetic: LightningSyntheticDatasetStats
    grid_cosine_similarity: float | None = None
    note: str | None = None


class LightningDistributionReportResponse(BaseModel):
    period: Literal["week", "month"]
    start_time: datetime
    end_time: datetime
    strike_count: int
    max_abs_current_ka: float | None = None
    avg_abs_current_ka: float | None = None
    positive_ratio: float = 0.0
    ng_per_km2_year: float = 0.0
    most_severe_event: LightningDistributionEventBrief | None = None
