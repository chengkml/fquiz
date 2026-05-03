export type UserPublic = {
  id: string;
  email: string;
  username: string;
  status: string;
  role_codes: string[];
  permission_codes: string[];
  created_at: string;
  last_login_at: string | null;
};

export type AuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserPublic;
};

export type UserListResponse = {
  items: UserPublic[];
  total: number;
};

export type PermissionItem = {
  id: number;
  code: string;
  name: string;
};

export type RoleItem = {
  id: string;
  code: string;
  name: string;
  permission_codes: string[];
  menu_ids: string[];
};

export type RoleListResponse = {
  items: RoleItem[];
  total: number;
};

export type MenuItem = {
  id: string;
  code: string;
  name: string;
  path: string | null;
  icon: string | null;
  parent_id: string | null;
  type: string;
  sort_order: number;
  status: string;
  visible: boolean;
  cacheable: boolean;
  component: string | null;
  permission_code: string | null;
};

export type MenuTreeItem = MenuItem & {
  children: MenuTreeItem[];
};

export type MenuListResponse = {
  items: MenuItem[];
  total: number;
};

export type AuditLogItem = {
  id: number;
  user_id: string | null;
  username: string | null;
  action: string;
  detail: string | null;
  created_at: string;
};

export type AuditLogListResponse = {
  items: AuditLogItem[];
  total: number;
  limit: number;
  offset: number;
};

export type SystemParamStatus = "enabled" | "disabled";

export type SystemParamSummary = {
  id: number;
  param_key: string;
  param_name: string;
  param_value: string;
  description: string | null;
  status: SystemParamStatus;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: UserPublic | null;
  updated_by: UserPublic | null;
};

export type SystemParamListResponse = {
  items: SystemParamSummary[];
  total: number;
};

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "short_answer";

export type QuestionStatus = "draft" | "published" | "archived";
export type QuestionDifficulty = "easy" | "medium" | "hard";

export type QuestionBankType = QuestionType;
export type QuestionBankStatus = QuestionStatus;
export type QuestionBankDifficulty = QuestionDifficulty;

export type QuestionBankSummary = {
  id: number;
  question_type: QuestionType;
  stem: string;
  options_json: Array<Record<string, unknown>> | null;
  answer: string;
  analysis: string | null;
  difficulty: QuestionDifficulty;
  status: QuestionStatus;
  tags_json: string[] | null;
  creator_user_id: string | null;
  updater_user_id: string | null;
  created_at: string;
  updated_at: string;
  creator: UserPublic | null;
  updater: UserPublic | null;
};

export type QuestionBankListResponse = {
  items: QuestionBankSummary[];
  total: number;
};

export type QuestionTagSummary = {
  name: string;
  count: number;
};

export type QuestionTagListResponse = {
  items: QuestionTagSummary[];
  total: number;
};

export type QuestionTagMutationResponse = {
  affected_questions: number;
};

export type HotSearchRecordSummary = {
  id: number;
  source: string;
  external_id: string | null;
  title: string;
  url: string | null;
  hot_value: string | null;
  rank_index: number | null;
  crawl_time: string;
  batch_no: string | null;
  detail_markdown: string | null;
  extra_json: Record<string, unknown> | null;
  matched_topics: string[];
  creator_user_id: string | null;
  updater_user_id: string | null;
  created_at: string;
  updated_at: string;
  creator: UserPublic | null;
  updater: UserPublic | null;
};

export type HotSearchListResponse = {
  items: HotSearchRecordSummary[];
  total: number;
};

export type HotSearchFollowTopicSummary = {
  id: number;
  topic_name: string;
  keywords: string | null;
  enabled: boolean;
  seq: number;
  created_at: string;
  updated_at: string;
  creator: UserPublic | null;
  updater: UserPublic | null;
};

export type HotSearchFollowTopicListResponse = {
  items: HotSearchFollowTopicSummary[];
  total: number;
};

export type MdResolveQuestionDraft = {
  question_type: QuestionType;
  stem: string;
  options_json: Array<{ key: string; content: string }> | null;
  answer: string;
  analysis: string | null;
  difficulty: QuestionDifficulty;
  status: QuestionStatus;
  tags_json: string[];
};

export type MdResolveParseResponse = {
  items: MdResolveQuestionDraft[];
  total: number;
  warnings: string[];
};

export type MdResolveImportResponse = {
  created_count: number;
  items: QuestionBankSummary[];
  warnings: string[];
};

export type FileStorageDriverType = "VFS" | "S3";

export type FileStorageBackendSummary = {
  id: number;
  code: string;
  name: string;
  driver_type: FileStorageDriverType;
  status: string;
  is_default: boolean;
  config_summary: Record<string, unknown>;
};

export type FileStorageMount = {
  id: number;
  code: string;
  name: string;
  mount_path: string;
  root_path: string;
  is_enabled: boolean;
  backend: FileStorageBackendSummary;
};

export type FileBreadcrumbItem = {
  name: string;
  path: string;
};

export type FileEntryItem = {
  id: number;
  path: string;
  parent_path: string;
  name: string;
  is_dir: boolean;
  size: number;
  mime_type: string | null;
  etag: string | null;
  storage_key: string | null;
  modified_at: string | null;
  synced_at: string;
};

export type FileListResponse = {
  mounts: FileStorageMount[];
  current_mount: FileStorageMount;
  current_path: string;
  breadcrumbs: FileBreadcrumbItem[];
  items: FileEntryItem[];
  total: number;
  synced_at: string;
};

export type FileOperationResponse = {
  success: boolean;
  mount_code: string;
  path: string;
  action: string | null;
  target_path: string | null;
};

export type ElevationDatasetStatus = "active" | "disabled";
export type ElevationDatasetUsageStatus = "idle" | "in_use";
export type ElevationApplyMode = "fill_null_only" | "overwrite_all";
export type ElevationApplyJobStatus = "pending" | "running" | "success" | "failed";

export type ElevationDatasetSummary = {
  id: string;
  code: string;
  name: string;
  source: string | null;
  file_format: string;
  mount_code: string;
  dataset_dir: string;
  file_path: string;
  resolution_m: number | null;
  status: ElevationDatasetStatus;
  usage_status: ElevationDatasetUsageStatus;
  sample_count: number;
  bbox_min_lon: number | null;
  bbox_max_lon: number | null;
  bbox_min_lat: number | null;
  bbox_max_lat: number | null;
  analysis_task_id: string | null;
  analysis_status: string;
  analysis_error_message: string | null;
  analysis_started_at: string | null;
  analysis_finished_at: string | null;
  notes: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type ElevationDatasetListResponse = {
  items: ElevationDatasetSummary[];
  total: number;
};

export type ElevationDatasetAnalyzeResponse = {
  dataset: ElevationDatasetSummary;
  warnings: string[];
};

export type ElevationDatasetBatchImportResponse = {
  imported_count: number;
  analyzed_count: number;
  skipped_count: number;
  warning_count: number;
  warnings: string[];
  items: ElevationDatasetSummary[];
};

export type ElevationDatasetDataImportResponse = {
  dataset: ElevationDatasetSummary;
  uploaded_file_count: number;
  extracted_file_count: number;
  imported_file_count: number;
  analysis_task_queued: boolean;
  analysis_task_id: string | null;
  warning_count: number;
  warnings: string[];
  imported_files: string[];
};

export type ElevationDatasetFileItem = {
  path: string;
  name: string;
  size: number;
  modified_at: string | null;
  mime_type: string | null;
};

export type ElevationDatasetFileListResponse = {
  dataset_id: string;
  dataset_code: string;
  dataset_dir: string;
  mount_code: string;
  items: ElevationDatasetFileItem[];
  total: number;
};

export type ElevationDatasetAnalysisTaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "unknown"
  | "not_found";

export type ElevationDatasetAnalysisTaskStatusResponse = {
  dataset_id: string;
  dataset_code: string;
  task_id: string | null;
  status: ElevationDatasetAnalysisTaskStatus;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  update_date: string | null;
};

export type ElevationDatasetPreviewPoint = {
  longitude: number;
  latitude: number;
  altitude_m: number;
};

export type ElevationDatasetPreviewCell = {
  min_longitude: number;
  max_longitude: number;
  min_latitude: number;
  max_latitude: number;
  altitude_m: number;
};

export type ElevationDatasetPreviewDiagnostics = {
  source_crs: string | null;
  source_bounds_min_x: number | null;
  source_bounds_max_x: number | null;
  source_bounds_min_y: number | null;
  source_bounds_max_y: number | null;
  wgs84_bounds_min_lon: number | null;
  wgs84_bounds_max_lon: number | null;
  wgs84_bounds_min_lat: number | null;
  wgs84_bounds_max_lat: number | null;
  raster_width: number | null;
  raster_height: number | null;
  target_samples: number | null;
  sampling_step: number | null;
  scanned_candidates: number | null;
  valid_preview_count: number | null;
  skip_read_error: number;
  skip_masked: number;
  skip_nodata: number;
  skip_nonfinite: number;
  skip_sample_transform_error: number;
  sample_tx_first_error: string | null;
  skip_sample_out_of_range: number;
  skip_cell_transform_error: number;
  skip_cell_out_of_range: number;
};

export type ElevationDatasetPreviewResponse = {
  dataset: ElevationDatasetSummary;
  preview_mode: "point_cloud" | "terrain_grid";
  total_points: number;
  sampled_points: number;
  points: ElevationDatasetPreviewPoint[];
  cells: ElevationDatasetPreviewCell[];
  diagnostics: ElevationDatasetPreviewDiagnostics | null;
  warnings: string[];
};

export type ElevationApplyJobSummary = {
  id: string;
  line_id: string;
  line_code: string | null;
  line_name: string | null;
  dataset_id: string;
  dataset_code: string | null;
  dataset_name: string | null;
  mode: ElevationApplyMode;
  status: ElevationApplyJobStatus;
  task_id: string | null;
  total_tower_count: number;
  updated_tower_count: number;
  skipped_tower_count: number;
  missing_geo_count: number;
  unmatched_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type ElevationApplyJobListResponse = {
  items: ElevationApplyJobSummary[];
  total: number;
};

export type ElevationApplyJobCreateResponse = {
  job: ElevationApplyJobSummary;
  queued: boolean;
};

export type LineStatus = "enabled" | "disabled";

export type LineSummary = {
  id: string;
  code: string;
  name: string;
  voltage_kv: number | null;
  tower_shape: string | null;
  phase_sequence_json: Record<string, unknown>;
  arrester_install_json: Record<string, unknown>;
  lightning_param_json: Record<string, unknown>;
  status: LineStatus;
  tower_count: number;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type LineListResponse = {
  items: LineSummary[];
  total: number;
};

export type LineTowerSummary = {
  id: string;
  line_id: string;
  seq_no: number;
  tower_no: string;
  tower_model: string | null;
  tower_type: string | null;
  longitude: number | null;
  latitude: number | null;
  altitude_m: number | null;
  terrain: string | null;
  ground_resistance_ohm: number | null;
  lightning_density: number | null;
  span_small_m: number | null;
  span_large_m: number | null;
  slope_1: number | null;
  slope_2: number | null;
  risk_level: string | null;
  circuit_geometry_json: Record<string, unknown>;
  lightning_result_json: Record<string, unknown>;
  raw_extra_json: Record<string, unknown>;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type LineTowerListResponse = {
  items: LineTowerSummary[];
  total: number;
};

export type LineTowerImportResponse = {
  line: LineSummary;
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  warning_count: number;
  warnings: string[];
};

export type AtpModelStatus = "enabled" | "disabled";
export type AtpModelSourceType = "atpdraw" | "atp" | "manual";
export type AtpModelVersionStatus = "draft" | "released" | "archived";
export type AtpSimulationRunStatus = "pending" | "running" | "success" | "failed";
export type AtpEngineMode = "wine" | "native";

export type AtpModelSummary = {
  id: string;
  code: string;
  name: string;
  source_type: AtpModelSourceType;
  description: string;
  status: AtpModelStatus;
  tags_json: string[];
  latest_version_no: number;
  active_version_no: number | null;
  version_count: number;
  run_count: number;
  last_run_status: AtpSimulationRunStatus | null;
  last_run_date: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type AtpModelListResponse = {
  items: AtpModelSummary[];
  total: number;
};

export type AtpModelVersionSummary = {
  id: string;
  model_id: string;
  version_no: number;
  version_tag: string | null;
  status: AtpModelVersionStatus;
  entry_file: string | null;
  change_note: string;
  artifact_manifest_json: Record<string, unknown>;
  content_hash: string;
  atp_text_size: number;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type AtpModelVersionDetail = AtpModelVersionSummary & {
  atp_text: string;
  graph_json: Record<string, unknown>;
};

export type AtpModelVersionListResponse = {
  items: AtpModelVersionSummary[];
  total: number;
};

export type AtpSimulationRunSummary = {
  id: string;
  model_id: string;
  version_id: string | null;
  version_no: number | null;
  status: AtpSimulationRunStatus;
  engine_mode: AtpEngineMode;
  engine_command: string | null;
  working_dir: string | null;
  timeout_seconds: number;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  stdout_size: number;
  stderr_size: number;
  create_date: string;
  create_user: string | null;
};

export type AtpSimulationRunDetail = AtpSimulationRunSummary & {
  stdout_text: string | null;
  stderr_text: string | null;
};

export type AtpSimulationRunListResponse = {
  items: AtpSimulationRunSummary[];
  total: number;
};

export type AtpEngineStatusResponse = {
  mode: AtpEngineMode;
  available: boolean;
  executable_path: string;
  resolved_executable: string | null;
  storage_root: string;
  workdir: string;
  default_timeout_seconds: number;
  max_timeout_seconds: number;
  error: string | null;
};

export type LightningPolarity = "positive" | "negative" | "mixed" | "unknown";

export type LightningCurrentEventSummary = {
  id: string;
  event_id: string;
  source_file_name: string | null;
  event_time: string | null;
  sample_count: number;
  sample_interval_us: number | null;
  sampling_frequency_hz: number | null;
  peak_current_ka: number | null;
  peak_abs_current_ka: number | null;
  wavefront_time_t1_us: number | null;
  half_value_time_t2_us: number | null;
  steepness_ka_per_us: number | null;
  action_integral_j_ohm: number | null;
  wave_shape: string | null;
  polarity: LightningPolarity;
  stroke_count: number;
  stroke_peaks_json: Array<Record<string, unknown>>;
  region_id: string | null;
  location_tag: string | null;
  city: string | null;
  longitude: number | null;
  latitude: number | null;
  altitude_m: number | null;
  sensor_model: string | null;
  install_position: string | null;
  weather_level: string | null;
  pressure_hpa: number | null;
  humidity_percent: number | null;
  is_synthetic: boolean;
  feature_json: Record<string, unknown>;
  notes: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type LightningCurrentEventListResponse = {
  items: LightningCurrentEventSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type LightningCurrentImportResponse = {
  event: LightningCurrentEventSummary;
  warning_count: number;
  warnings: string[];
};

export type LightningCurrentSampleItem = {
  id: number;
  event_ref_id: string;
  seq_no: number;
  time_us: number;
  current_ka: number;
};

export type LightningCurrentSampleListResponse = {
  items: LightningCurrentSampleItem[];
  total: number;
  limit: number;
  offset: number;
};

export type LightningCurrentExceedancePoint = {
  threshold_ka: number;
  exceedance_probability: number;
  exceedance_count: number;
};

export type LightningCurrentExceedanceResponse = {
  total_events: number;
  thresholds: LightningCurrentExceedancePoint[];
};

export type LightningDistributionImportResponse = {
  imported_count: number;
  skipped_count: number;
  warning_count: number;
  warnings: string[];
};

export type LightningDistributionSummary = {
  total_records: number;
  area_km2: number;
  data_years: number;
  grid_size_km: number;
  overall_ng_per_km2_year: number;
  max_abs_current_ka: number | null;
  avg_abs_current_ka: number | null;
};

export type LightningPolarityStats = {
  positive_count: number;
  negative_count: number;
  mixed_count: number;
  unknown_count: number;
  positive_ratio: number;
  negative_ratio: number;
};

export type LightningSourceStats = {
  measured_count: number;
  synthetic_count: number;
};

export type LightningDistributionGridCell = {
  grid_x: number;
  grid_y: number;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
  center_lat: number;
  center_lon: number;
  strike_count: number;
  ng_per_km2_year: number;
  i_max_ka: number | null;
  i_avg_ka: number | null;
  positive_ratio: number;
};

export type LightningDistributionScatterPoint = {
  id: string;
  event_id: string;
  longitude: number;
  latitude: number;
  current_ka: number | null;
  abs_current_ka: number | null;
  polarity: LightningPolarity;
  region_id: string | null;
  city: string | null;
  location_tag: string | null;
  event_time: string | null;
};

export type LightningDistributionStatsResponse = {
  summary: LightningDistributionSummary;
  polarity: LightningPolarityStats;
  sources: LightningSourceStats;
  grid_cells: LightningDistributionGridCell[];
  scatter_points: LightningDistributionScatterPoint[];
  p_curve: LightningCurrentExceedancePoint[];
};

export type LightningTowerBufferEventItem = {
  id: string;
  event_id: string;
  longitude: number | null;
  latitude: number | null;
  current_ka: number | null;
  abs_current_ka: number | null;
  polarity: LightningPolarity;
  event_time: string | null;
  location_tag: string | null;
  city: string | null;
  distance_km: number;
};

export type LightningTowerTerrainMetrics = {
  slope_deg: number | null;
  aspect_deg: number | null;
  slope_mean_deg: number | null;
  slope_p95_deg: number | null;
  slope_max_deg: number | null;
  slope_along_line_deg: number | null;
  slope_cross_line_deg: number | null;
  relief_m_50: number | null;
  dem_source: string | null;
  dem_resolution_m: number | null;
  quality_score: number | null;
  quality_level: string | null;
  terrain_exposure_index: number | null;
  windward_factor: number | null;
  algorithm_version: string | null;
  computed_at: string | null;
  land_cover_type: string | null;
};

export type LightningTowerBufferStatsResponse = {
  tower_id: string | null;
  tower_no: string | null;
  line_id: string | null;
  center_longitude: number;
  center_latitude: number;
  radius_km: number;
  design_current_ka: number;
  strike_count: number;
  exceed_design_count: number;
  max_abs_current_ka: number | null;
  avg_abs_current_ka: number | null;
  ng_per_km2_year: number;
  positive_ratio: number;
  risk_level: string;
  recommended_action: string;
  events: LightningTowerBufferEventItem[];
  terrain_metrics: LightningTowerTerrainMetrics | null;
};

export type LightningTowerTerrainComputeRequest = {
  tower_id?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  altitude_m?: number | null;
  dem_grid_m: number[][];
  cell_size_m?: number;
  search_radius_m?: number;
  dem_source?: string | null;
  dem_resolution_m?: number | null;
  wind_direction_deg?: number | null;
  land_cover_type?: string | null;
  persist?: boolean;
};

export type LightningTowerTerrainComputeResponse = {
  tower_id: string | null;
  tower_no: string | null;
  line_id: string | null;
  center_longitude: number;
  center_latitude: number;
  method: string;
  persisted: boolean;
  terrain_metrics: LightningTowerTerrainMetrics;
  warnings: string[];
};

export type LightningSyntheticDatasetStats = {
  count: number;
  max_abs_current_ka: number | null;
  avg_abs_current_ka: number | null;
  positive_ratio: number;
  ng_per_km2_year: number;
};

export type LightningSyntheticCompareResponse = {
  grid_size_km: number;
  data_years: number;
  measured: LightningSyntheticDatasetStats;
  synthetic: LightningSyntheticDatasetStats;
  grid_cosine_similarity: number | null;
  note: string | null;
};

export type LightningDistributionEventBrief = {
  id: string;
  event_id: string;
  longitude: number | null;
  latitude: number | null;
  current_ka: number | null;
  abs_current_ka: number | null;
  polarity: LightningPolarity;
  event_time: string | null;
  location_tag: string | null;
  city: string | null;
};

export type LightningDistributionReportResponse = {
  period: "week" | "month";
  start_time: string;
  end_time: string;
  strike_count: number;
  max_abs_current_ka: number | null;
  avg_abs_current_ka: number | null;
  positive_ratio: number;
  ng_per_km2_year: number;
  most_severe_event: LightningDistributionEventBrief | null;
};
