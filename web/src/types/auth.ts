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
  id: number;
  code: string;
  name: string;
  permission_codes: string[];
  menu_ids: number[];
};

export type RoleListResponse = {
  items: RoleItem[];
  total: number;
};

export type MenuItem = {
  id: number;
  code: string;
  name: string;
  path: string | null;
  icon: string | null;
  parent_id: number | null;
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

export type ModelSummaryResponse = {
  total_models: number;
  status_counts: Record<string, number>;
  total_route_rules: number;
  route_type_counts: Record<string, number>;
  enabled_without_healthy_check: number;
  usage_7d: ModelUsageSummary;
  tests_7d: ModelTestSummary;
};

export type RequirementStatus =
  | "PENDING_ANALYSIS"
  | "PENDING_REVISION"
  | "OPEN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type RequirementPriority = "low" | "medium" | "high" | "urgent";
export type RequirementCommentKind = "comment" | "analysis" | "revision" | "system";

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
  id: number;
  requirement_id: string;
  actor_user_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: string;
  actor: UserPublic | null;
};
