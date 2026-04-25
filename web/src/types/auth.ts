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

export type VocabularyWordStatus = "enabled" | "disabled";

export type VocabularyWordSummary = {
  id: number;
  word: string;
  phonetic: string | null;
  meaning: string;
  example: string | null;
  status: VocabularyWordStatus;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: UserPublic | null;
  updated_by: UserPublic | null;
};

export type VocabularyWordListResponse = {
  items: VocabularyWordSummary[];
  total: number;
};

export type VocabularyStatsSummary = {
  total_words: number;
  enabled_words: number;
  disabled_words: number;
  enabled_rate: number | null;
  missing_phonetic_words: number;
  missing_example_words: number;
};

export type VocabularyStatusBucketItem = {
  status: string;
  count: number;
};

export type VocabularyInitialBucketItem = {
  initial: string;
  count: number;
};

export type VocabularyWordTrendItem = {
  id: number;
  word: string;
  status: VocabularyWordStatus;
  updated_at: string;
};

export type VocabularyWordStatsResponse = {
  summary: VocabularyStatsSummary;
  status_buckets: VocabularyStatusBucketItem[];
  initial_buckets: VocabularyInitialBucketItem[];
  recently_updated: VocabularyWordTrendItem[];
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

export type ModelStatus = "DRAFT" | "ENABLED" | "DISABLED" | "DEPRECATED";
export type ModelRouteType = "GLOBAL" | "CAPABILITY" | "BUSINESS" | "AGENT";
export type ModelHealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export type ModelTestStatus = "PASSED" | "FAILED";

export type ModelUsageSummary = {
  request_count: number;
  success_count: number;
  total_tokens: number;
  total_cost_usd: number;
  success_rate: number | null;
};

export type ModelTestSummary = {
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  pass_rate: number | null;
};

export type ModelRegistryItem = {
  id: number;
  code: string;
  name: string;
  provider: string;
  provider_model: string;
  status: ModelStatus;
  capabilities: string[];
  description: string;
  base_url: string | null;
  active_key_masked: string | null;
  active_key_version: number | null;
  active_key_fingerprint: string | null;
  active_key_rotated_at: string | null;
  latest_health_status: ModelHealthStatus | null;
  latest_health_reason: string | null;
  latest_health_at: string | null;
  route_bindings_count: number;
  usage_7d: ModelUsageSummary;
  tests_7d: ModelTestSummary;
  created_at: string;
  updated_at: string;
};

export type ModelListResponse = {
  items: ModelRegistryItem[];
  total: number;
};

export type PasswordModelListResponse = ModelListResponse;

export type ModelRouteRuleItem = {
  id: number;
  route_type: ModelRouteType;
  route_key: string;
  target_model_code: string;
  priority: number;
  enabled: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelRouteRuleListResponse = {
  items: ModelRouteRuleItem[];
  total: number;
};

export type ModelApiKeyItem = {
  id: number;
  model_id: number;
  version: number;
  secret_masked: string;
  secret_fingerprint: string;
  is_active: boolean;
  rotation_note: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type ModelApiKeyListResponse = {
  items: ModelApiKeyItem[];
  total: number;
};

export type ModelHealthCheckItem = {
  id: number;
  model_id: number;
  status: ModelHealthStatus;
  reason: string;
  latency_ms: number | null;
  detail_json: Record<string, unknown> | null;
  created_at: string;
};

export type ModelHealthCheckListResponse = {
  items: ModelHealthCheckItem[];
  total: number;
};

export type ModelTestRunItem = {
  id: number;
  model_id: number;
  model_code: string;
  kind: string;
  status: ModelTestStatus;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
  error_message: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type ModelTestRunListResponse = {
  items: ModelTestRunItem[];
  total: number;
};

export type ModelTestChatResponse = {
  model_id: number;
  model_code: string;
  provider: string;
  provider_model: string;
  reply: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  test_status: ModelTestStatus;
  error_message: string | null;
};

export type ModelSummaryResponse = {
  total_models: number;
  status_counts: Record<string, number>;
  total_route_rules: number;
  route_type_counts: Record<string, number>;
  enabled_without_healthy_check: number;
  usage_7d: ModelUsageSummary;
  tests_7d: ModelTestSummary;
};

export type TokenUsageSummary = {
  request_count: number;
  success_count: number;
  total_tokens: number;
  total_cost_usd: number;
  success_rate: number | null;
};

export type TokenUsageDailyItem = TokenUsageSummary & {
  date: string;
};

export type TokenUsageModelItem = TokenUsageSummary & {
  model_code: string;
};

export type TokenUsageOverviewResponse = {
  days: number;
  model_code: string | null;
  start_date: string;
  end_date: string;
  summary: TokenUsageSummary;
  trend: TokenUsageDailyItem[];
  top_models: TokenUsageModelItem[];
};

export type ChatRole = "system" | "user" | "assistant";

export type ChatSession = {
  id: string;
  owner_user_id: string;
  title: string;
  system_prompt: string;
  model_code: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionListResponse = {
  items: ChatSession[];
  total: number;
};

export type ChatMessage = {
  id: number;
  session_id: string;
  author_user_id: string | null;
  role: ChatRole;
  content: string;
  is_error: boolean;
  model_code: string | null;
  provider: string | null;
  provider_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
};

export type ChatMessageListResponse = {
  items: ChatMessage[];
  total: number;
};

export type ChatSendResponse = {
  session: ChatSession;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
};

export type LifeCountdownProfile = {
  id?: string;
  deathDate?: string;
  todayWarningDate?: string;
  todayWarningText?: string;
  todayWarningGeneratedAt?: string;
  todayWarningModel?: string;
  createDate?: string;
  updateDate?: string;
};

export type LifeCountdownWarning = {
  warningText?: string;
  warningDate?: string;
  generatedAt?: string;
  modelName?: string;
  cached?: boolean;
};

export type RequirementStatus =
  | "PENDING_ANALYSIS"
  | "PENDING_REVIEW"
  | "PENDING_REVISION"
  | "OPEN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

export type RequirementPriority = "low" | "medium" | "high" | "urgent";
export type RequirementCommentKind = "comment" | "analysis" | "revision" | "system";

export type TodoStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";
export type TodoPriority = "LOW" | "MEDIUM" | "HIGH";

export type TodoSummary = {
  id: string;
  title: string;
  descr: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  start_time: string | null;
  due_date: string | null;
  expire_time: string | null;
  calendar_event_id: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type TodoListResponse = {
  items: TodoSummary[];
  total: number;
};

export type DiaryMood = "HAPPY" | "CALM" | "SAD" | "ANGRY" | "TIRED" | "EXCITED";

export type DiarySummary = {
  id: string;
  title: string;
  content: string;
  diary_date: string;
  mood: DiaryMood;
  weather: string | null;
  archived: boolean;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type DiaryListResponse = {
  items: DiarySummary[];
  total: number;
  page_num: number;
  page_size: number;
};

export type MindMapSummary = {
  id: string;
  map_name: string;
  descr: string | null;
  map_data: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type MindMapListResponse = {
  items: MindMapSummary[];
  total: number;
  page_num: number;
  page_size: number;
};

export type MermaidGroupSummary = {
  id: string;
  name: string;
  label: string;
  type: string | null;
  descr: string | null;
};

export type MermaidGroupListResponse = {
  items: MermaidGroupSummary[];
  total: number;
};

export type MermaidDiagramSummary = {
  id: string;
  diagram_name: string;
  description: string | null;
  diagram_data: string | null;
  group_name: string | null;
  group_label: string | null;
  tag_names: string[];
  tag_labels: string[];
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

export type MermaidDiagramPageResponse = {
  items: MermaidDiagramSummary[];
  total: number;
  page_num: number;
  page_size: number;
};

export type MermaidChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type RequirementSummary = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: RequirementStatus;
  priority: RequirementPriority;
  project_name: string | null;
  module_name: string | null;
  source: string | null;
  creator_user_id: string | null;
  assignee_user_id: string | null;
  reviewer_user_id: string | null;
  due_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  result_msg: string | null;
  progress_percent: number;
  git_url: string | null;
  branch: string | null;
  creator: UserPublic | null;
  assignee: UserPublic | null;
  reviewer: UserPublic | null;
};

export type RequirementListResponse = {
  items: RequirementSummary[];
  total: number;
};

export type RequirementComment = {
  id: number;
  requirement_id: string;
  author_user_id: string | null;
  content: string;
  kind: RequirementCommentKind;
  created_at: string;
  author: UserPublic | null;
};

export type RequirementEvent = {
  id: string;
  requirement_id: string;
  actor_user_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: string;
  actor: UserPublic | null;
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
