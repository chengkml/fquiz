"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Alert as AntAlert, Empty, Popconfirm, Spin, Tag, Tabs, type TabsProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, Card, Checkbox, Dialog, Select, Table, TextArea, TextField } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  ModelHealthStatus,
  ModelListResponse,
  ModelRegistryItem,
  ModelRouteRuleItem,
  ModelRouteRuleListResponse,
  ModelRouteType,
  ModelStatus,
  ModelTestRunItem,
  ModelTestRunListResponse,
  ModelTestStatus,
} from "@/types/auth";

const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  DRAFT: "草稿",
  ENABLED: "已启用",
  DISABLED: "已停用",
  DEPRECATED: "已归档",
};

const MODEL_STATUS_TRANSITIONS: Record<ModelStatus, ModelStatus[]> = {
  DRAFT: ["ENABLED", "DISABLED", "DEPRECATED"],
  ENABLED: ["DISABLED", "DEPRECATED"],
  DISABLED: ["ENABLED", "DEPRECATED"],
  DEPRECATED: ["DISABLED"],
};

const HEALTH_STATUS_LABELS: Record<ModelHealthStatus, string> = {
  HEALTHY: "健康",
  DEGRADED: "退化",
  UNHEALTHY: "不健康",
};

const TEST_STATUS_LABELS: Record<ModelTestStatus, string> = {
  PASSED: "通过",
  FAILED: "失败",
};

const ROUTE_TYPE_OPTIONS: ModelRouteType[] = ["GLOBAL", "CAPABILITY", "BUSINESS", "AGENT"];
const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "Qwen" },
  { value: "grok", label: "Grok" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "other", label: "其他" },
];

const MODELS_PATH = "/api/v1/admin/models";
const ROUTES_PATH = "/api/v1/admin/model-routes";
const GLOBAL_ROUTE_KEY = "__global__";

type AgentCreateFormState = {
  code: string;
  name: string;
  provider: string;
  provider_model: string;
  status: ModelStatus;
  capabilities: string;
  description: string;
  base_url: string;
  api_key: string;
};

const EMPTY_AGENT_CREATE_FORM: AgentCreateFormState = {
  code: "",
  name: "",
  provider: "openai",
  provider_model: "",
  status: "DRAFT",
  capabilities: "",
  description: "",
  base_url: "",
  api_key: "",
};

type AgentInstructionFormState = {
  description: string;
  capabilities: string;
};

type AgentSettingsFormState = {
  name: string;
  provider: string;
  provider_model: string;
  base_url: string;
};

type AgentRouteFormState = {
  route_type: ModelRouteType;
  route_key: string;
  target_model_code: string;
  priority: string;
  enabled: boolean;
  note: string;
};

const EMPTY_ROUTE_FORM: AgentRouteFormState = {
  route_type: "AGENT",
  route_key: "",
  target_model_code: "",
  priority: "100",
  enabled: true,
  note: "",
};

type AgentTestFormState = {
  kind: string;
  input_tokens: string;
  output_tokens: string;
};

const EMPTY_TEST_FORM: AgentTestFormState = {
  kind: "SMOKE",
  input_tokens: "16",
  output_tokens: "32",
};

function parseCapabilities(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort();
}

function formatModelStatus(status: ModelStatus): string {
  return `${MODEL_STATUS_LABELS[status]}（${status}）`;
}

function formatHealthStatus(status: ModelHealthStatus | null): string {
  if (!status) {
    return "未检测";
  }
  return `${HEALTH_STATUS_LABELS[status]}（${status}）`;
}

function formatTestStatus(status: ModelTestStatus): string {
  return `${TEST_STATUS_LABELS[status]}（${status}）`;
}

function getModelStatusTagColor(status: ModelStatus): string {
  switch (status) {
    case "ENABLED":
      return "green";
    case "DISABLED":
      return "orange";
    case "DEPRECATED":
      return "default";
    case "DRAFT":
    default:
      return "blue";
  }
}

function getHealthStatusTagColor(status: ModelHealthStatus | null): string {
  switch (status) {
    case "HEALTHY":
      return "green";
    case "DEGRADED":
      return "orange";
    case "UNHEALTHY":
      return "red";
    default:
      return "default";
  }
}

function getTestStatusTagColor(status: ModelTestStatus): string {
  return status === "PASSED" ? "green" : "red";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

async function invalidateAgentQueries(queryClient: ReturnType<typeof useQueryClient>, modelId?: number): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [MODELS_PATH] });
  await queryClient.invalidateQueries({ queryKey: [ROUTES_PATH] });
  if (modelId) {
    await queryClient.invalidateQueries({ queryKey: ["admin.agent.tests", modelId] });
  }
}

export default function AdminAgentPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("model.read") || hasPermission("model.manage");
  const canManage = hasPermission("model.manage");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [keyword, setKeyword] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState("instructions");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<AgentCreateFormState>(EMPTY_AGENT_CREATE_FORM);

  const [instructionForm, setInstructionForm] = useState<AgentInstructionFormState>({
    description: "",
    capabilities: "",
  });

  const [settingsForm, setSettingsForm] = useState<AgentSettingsFormState>({
    name: "",
    provider: "",
    provider_model: "",
    base_url: "",
  });

  const [showRouteModal, setShowRouteModal] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [routeForm, setRouteForm] = useState<AgentRouteFormState>(EMPTY_ROUTE_FORM);

  const [testForm, setTestForm] = useState<AgentTestFormState>(EMPTY_TEST_FORM);

  const loadModels = useCallback(async () => {
    const response = await fetchWithAuth(MODELS_PATH);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as ModelListResponse;
  }, [fetchWithAuth]);

  const loadRoutes = useCallback(async () => {
    const response = await fetchWithAuth(ROUTES_PATH);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as ModelRouteRuleListResponse;
  }, [fetchWithAuth]);

  const modelsQuery = useQuery({
    queryKey: [MODELS_PATH],
    queryFn: loadModels,
    enabled: !!user && canRead,
  });

  const routesQuery = useQuery({
    queryKey: [ROUTES_PATH],
    queryFn: loadRoutes,
    enabled: !!user && canRead,
  });

  const models = modelsQuery.data?.items ?? [];
  const routes = routesQuery.data?.items ?? [];

  const filteredAgents = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return models.filter((model) => {
      if (!showArchived && model.status === "DEPRECATED") {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${model.code} ${model.name} ${model.provider} ${model.provider_model} ${model.description}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [keyword, models, showArchived]);

  const archivedCount = useMemo(() => models.filter((model) => model.status === "DEPRECATED").length, [models]);

  useEffect(() => {
    if (filteredAgents.length === 0) {
      setSelectedModelId(null);
      return;
    }
    if (selectedModelId === null || !filteredAgents.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(filteredAgents[0]?.id ?? null);
    }
  }, [filteredAgents, selectedModelId]);

  const selectedAgent = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const boundRoutes = useMemo(() => {
    if (!selectedAgent) {
      return [];
    }
    return routes
      .filter((item) => item.target_model_code === selectedAgent.code)
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
  }, [routes, selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) {
      return;
    }
    setInstructionForm({
      description: selectedAgent.description,
      capabilities: selectedAgent.capabilities.join(", "),
    });
    setSettingsForm({
      name: selectedAgent.name,
      provider: selectedAgent.provider,
      provider_model: selectedAgent.provider_model,
      base_url: selectedAgent.base_url ?? "",
    });
    setRouteForm((previous) => ({
      ...previous,
      target_model_code: selectedAgent.code,
    }));
    setTestForm(EMPTY_TEST_FORM);
  }, [selectedAgent]);

  const testHistoryQuery = useQuery({
    queryKey: ["admin.agent.tests", selectedAgent?.id ?? 0],
    queryFn: async () => {
      if (!selectedAgent) {
        return { items: [], total: 0 } as ModelTestRunListResponse;
      }
      const response = await fetchWithAuth(`/api/v1/admin/models/${selectedAgent.id}/tests?limit=20`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestRunListResponse;
    },
    enabled: !!selectedAgent && !!user && canRead,
  });

  const createAgentMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: createForm.code.trim().toLowerCase(),
        name: createForm.name.trim(),
        provider: createForm.provider.trim(),
        provider_model: createForm.provider_model.trim(),
        status: createForm.status,
        capabilities: parseCapabilities(createForm.capabilities),
        description: createForm.description.trim(),
        base_url: createForm.base_url.trim() || null,
        api_key: createForm.api_key.trim() || null,
      };

      const response = await fetchWithAuth(MODELS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelRegistryItem;
    },
    onSuccess: async (created) => {
      setError("");
      setSuccess("Agent 已创建");
      setShowCreateModal(false);
      setCreateForm(EMPTY_AGENT_CREATE_FORM);
      await invalidateAgentQueries(queryClient, created.id);
      setSelectedModelId(created.id);
      setActiveTab("instructions");
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建 Agent 失败");
    },
  });

  const updateModelMutation = useMutation({
    mutationFn: async ({ modelId, payload }: { modelId: number; payload: Record<string, unknown> }) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelRegistryItem;
    },
    onSuccess: async (updated) => {
      setError("");
      setSuccess(`Agent「${updated.name}」已更新`);
      await invalidateAgentQueries(queryClient, updated.id);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "更新 Agent 失败");
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ modelId, status }: { modelId: number; status: ModelStatus }) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelRegistryItem;
    },
    onSuccess: async (updated) => {
      setError("");
      setSuccess(`状态已流转为 ${formatModelStatus(updated.status)}`);
      await invalidateAgentQueries(queryClient, updated.id);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "状态流转失败");
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: async (modelId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}/health-check`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("健康检查已触发");
      await invalidateAgentQueries(queryClient, selectedAgent?.id ?? undefined);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "健康检查失败");
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (modelId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("Agent 已删除");
      await invalidateAgentQueries(queryClient);
      setSelectedModelId(null);
      setActiveTab("instructions");
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除 Agent 失败");
    },
  });

  const saveRouteMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        route_type: routeForm.route_type,
        route_key: routeForm.route_type === "GLOBAL" ? null : routeForm.route_key.trim() || null,
        target_model_code: routeForm.target_model_code.trim().toLowerCase(),
        priority: Number(routeForm.priority || 100),
        enabled: routeForm.enabled,
        note: routeForm.note.trim() || null,
      };

      if (editingRouteId) {
        const response = await fetchWithAuth(`/api/v1/admin/model-routes/${editingRouteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return response.json();
      }

      const response = await fetchWithAuth(ROUTES_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess(editingRouteId ? "路由规则已更新" : "路由规则已创建");
      setShowRouteModal(false);
      setEditingRouteId(null);
      setRouteForm((previous) => ({
        ...EMPTY_ROUTE_FORM,
        target_model_code: previous.target_model_code,
      }));
      await invalidateAgentQueries(queryClient, selectedAgent?.id ?? undefined);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存路由规则失败");
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/model-routes/${routeId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("路由规则已删除");
      await invalidateAgentQueries(queryClient, selectedAgent?.id ?? undefined);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除路由规则失败");
    },
  });

  const runTestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) {
        throw new Error("未选中 Agent");
      }
      const response = await fetchWithAuth(`/api/v1/admin/models/${selectedAgent.id}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: testForm.kind.trim().toUpperCase() || "SMOKE",
          input_tokens: Number(testForm.input_tokens || 0),
          output_tokens: Number(testForm.output_tokens || 0),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestRunItem;
    },
    onSuccess: async (run) => {
      setError("");
      setSuccess(`测试完成：${formatTestStatus(run.status)}`);
      await invalidateAgentQueries(queryClient, selectedAgent?.id ?? undefined);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "执行测试失败");
    },
  });

  const instructionDirty =
    !!selectedAgent &&
    (instructionForm.description !== selectedAgent.description ||
      parseCapabilities(instructionForm.capabilities).join(",") !== selectedAgent.capabilities.join(","));

  const settingsDirty =
    !!selectedAgent &&
    (settingsForm.name !== selectedAgent.name ||
      settingsForm.provider !== selectedAgent.provider ||
      settingsForm.provider_model !== selectedAgent.provider_model ||
      settingsForm.base_url !== (selectedAgent.base_url ?? ""));

  const openCreateRoute = useCallback(() => {
    if (!selectedAgent) {
      return;
    }
    setEditingRouteId(null);
    setRouteForm({
      ...EMPTY_ROUTE_FORM,
      target_model_code: selectedAgent.code,
    });
    setShowRouteModal(true);
  }, [selectedAgent]);

  const openEditRoute = useCallback((route: ModelRouteRuleItem) => {
    setEditingRouteId(route.id);
    setRouteForm({
      route_type: route.route_type,
      route_key: route.route_type === "GLOBAL" ? "" : route.route_key,
      target_model_code: route.target_model_code,
      priority: String(route.priority),
      enabled: route.enabled,
      note: route.note ?? "",
    });
    setShowRouteModal(true);
  }, []);

  const transitionCandidates = selectedAgent ? MODEL_STATUS_TRANSITIONS[selectedAgent.status] : [];

  const loading = modelsQuery.isLoading || routesQuery.isLoading;
  const loadingMessage = modelsQuery.isLoading ? "加载 Agent 列表中..." : "加载路由规则中...";

  const tabItems = useMemo<TabsProps["items"]>(() => {
    const items: TabsProps["items"] = [
      {
        key: "instructions",
        label: (
          <span className="inline-flex items-center gap-2">
            <FileTextOutlined />
            说明
          </span>
        ),
        children: (
          <div className="space-y-4 pt-2">
            <label className="block space-y-2 text-sm">
              <span className="text-[var(--gray-11)]">Agent 说明</span>
              <TextArea
                rows={8}
                value={instructionForm.description}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                  setInstructionForm((previous) => ({ ...previous, description: event.currentTarget.value }));
                }}
                placeholder="描述 Agent 的角色、职责和工作方式"
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="text-[var(--gray-11)]">能力标签（逗号分隔）</span>
              <TextField.Root
                value={instructionForm.capabilities}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setInstructionForm((previous) => ({ ...previous, capabilities: event.currentTarget.value }));
                }}
                placeholder="chat, reasoning, coding"
              />
            </label>
            {canManage && selectedAgent && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={!instructionDirty || updateModelMutation.isPending}
                  onClick={() => {
                    updateModelMutation.mutate({
                      modelId: selectedAgent.id,
                      payload: {
                        description: instructionForm.description.trim(),
                        capabilities: parseCapabilities(instructionForm.capabilities),
                      },
                    });
                  }}
                >
                  {updateModelMutation.isPending ? "保存中..." : "保存说明"}
                </Button>
              </div>
            )}
          </div>
        ),
      },
      {
        key: "routes",
        label: (
          <span className="inline-flex items-center gap-2">
            <NodeIndexOutlined />
            路由
          </span>
        ),
        children: (
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--gray-11)]">
                当前 Agent 绑定 {boundRoutes.length} 条路由规则。
              </p>
              {canManage && (
                <Button type="button" onClick={openCreateRoute}>
                  <PlusOutlined />
                  新建路由
                </Button>
              )}
            </div>

            {boundRoutes.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前 Agent 暂无路由规则" />
            ) : (
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Key</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>优先级</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>备注</Table.ColumnHeaderCell>
                    {canManage && <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {boundRoutes.map((route) => (
                    <Table.Row key={route.id}>
                      <Table.Cell>{route.route_type}</Table.Cell>
                      <Table.Cell>{route.route_type === "GLOBAL" ? GLOBAL_ROUTE_KEY : route.route_key}</Table.Cell>
                      <Table.Cell>{route.priority}</Table.Cell>
                      <Table.Cell>
                        <Tag color={route.enabled ? "green" : "default"}>{route.enabled ? "启用" : "停用"}</Tag>
                      </Table.Cell>
                      <Table.Cell>{route.note || "-"}</Table.Cell>
                      {canManage && (
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <Button type="button" size="1" color="gray" variant="soft" onClick={() => openEditRoute(route)}>
                              <EditOutlined />
                              编辑
                            </Button>
                            <Popconfirm
                              title="确认删除该路由规则？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => deleteRouteMutation.mutate(route.id)}
                            >
                              <Button type="button" size="1" color="red" variant="soft">
                                <DeleteOutlined />
                                删除
                              </Button>
                            </Popconfirm>
                          </div>
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </div>
        ),
      },
      {
        key: "tests",
        label: (
          <span className="inline-flex items-center gap-2">
            <CheckCircleOutlined />
            测试
          </span>
        ),
        children: (
          <div className="space-y-4 pt-2">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">类型</span>
                <TextField.Root
                  value={testForm.kind}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setTestForm((previous) => ({ ...previous, kind: event.currentTarget.value }));
                  }}
                  placeholder="SMOKE"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">输入 Tokens</span>
                <TextField.Root
                  type="number"
                  min={0}
                  value={testForm.input_tokens}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setTestForm((previous) => ({ ...previous, input_tokens: event.currentTarget.value }));
                  }}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">输出 Tokens</span>
                <TextField.Root
                  type="number"
                  min={0}
                  value={testForm.output_tokens}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setTestForm((previous) => ({ ...previous, output_tokens: event.currentTarget.value }));
                  }}
                />
              </label>
            </div>

            {canManage && selectedAgent && (
              <div className="flex justify-end">
                <Button type="button" onClick={() => runTestMutation.mutate()} disabled={runTestMutation.isPending}>
                  {runTestMutation.isPending ? "测试中..." : "执行测试"}
                </Button>
              </div>
            )}

            {testHistoryQuery.isLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spin size="small" />
              </div>
            ) : (testHistoryQuery.data?.items?.length ?? 0) === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无测试记录" />
            ) : (
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>输入</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>输出</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>耗时(ms)</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>时间</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {(testHistoryQuery.data?.items ?? []).map((item) => (
                    <Table.Row key={item.id}>
                      <Table.Cell>
                        <Tag color={getTestStatusTagColor(item.status)}>{formatTestStatus(item.status)}</Tag>
                      </Table.Cell>
                      <Table.Cell>{item.kind}</Table.Cell>
                      <Table.Cell>{item.input_tokens}</Table.Cell>
                      <Table.Cell>{item.output_tokens}</Table.Cell>
                      <Table.Cell>{item.latency_ms ?? "-"}</Table.Cell>
                      <Table.Cell>{formatDateTime(item.created_at)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </div>
        ),
      },
      {
        key: "settings",
        label: (
          <span className="inline-flex items-center gap-2">
            <SettingOutlined />
            设置
          </span>
        ),
        children: (
          <div className="space-y-4 pt-2">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">模型 Code（只读）</span>
                <TextField.Root value={selectedAgent?.code ?? ""} disabled />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">名称</span>
                <TextField.Root
                  value={settingsForm.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setSettingsForm((previous) => ({ ...previous, name: event.currentTarget.value }));
                  }}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">Provider</span>
                <Select.Root
                  value={settingsForm.provider}
                  onValueChange={(value: string) => {
                    setSettingsForm((previous) => ({ ...previous, provider: value }));
                  }}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    {PROVIDER_OPTIONS.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--gray-11)]">Provider Model</span>
                <TextField.Root
                  value={settingsForm.provider_model}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setSettingsForm((previous) => ({ ...previous, provider_model: event.currentTarget.value }));
                  }}
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-[var(--gray-11)]">Base URL</span>
                <TextField.Root
                  value={settingsForm.base_url}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setSettingsForm((previous) => ({ ...previous, base_url: event.currentTarget.value }));
                  }}
                  placeholder="https://api.example.com"
                />
              </label>
            </div>

            {canManage && selectedAgent && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={!settingsDirty || updateModelMutation.isPending}
                  onClick={() => {
                    updateModelMutation.mutate({
                      modelId: selectedAgent.id,
                      payload: {
                        name: settingsForm.name.trim(),
                        provider: settingsForm.provider.trim(),
                        provider_model: settingsForm.provider_model.trim(),
                        base_url: settingsForm.base_url.trim() || null,
                      },
                    });
                  }}
                >
                  {updateModelMutation.isPending ? "保存中..." : "保存设置"}
                </Button>
              </div>
            )}
          </div>
        ),
      },
    ];

    return items;
  }, [
    boundRoutes,
    canManage,
    deleteRouteMutation,
    instructionDirty,
    instructionForm.capabilities,
    instructionForm.description,
    openCreateRoute,
    openEditRoute,
    routeForm.route_type,
    runTestMutation,
    selectedAgent,
    settingsDirty,
    settingsForm.base_url,
    settingsForm.name,
    settingsForm.provider,
    settingsForm.provider_model,
    testForm.input_tokens,
    testForm.kind,
    testForm.output_tokens,
    testHistoryQuery.data?.items,
    testHistoryQuery.isLoading,
    updateModelMutation,
  ]);

  if (initializing || loading) {
    return (
      <Card size="2">
        <div className="flex min-h-[260px] items-center justify-center">
          <Spin size="small" />
          <span className="ml-3 text-sm text-[var(--gray-11)]">{loadingMessage}</span>
        </div>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card size="2">
        <p className="text-sm text-[var(--gray-11)]">请先登录后访问 Agent 页面。</p>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card size="2">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `model.read`）。</p>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card size="2" className="min-h-[560px] lg:h-[calc(100vh-190px)]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--gray-6)] pb-3">
              <div>
                <h1 className="text-sm font-semibold">Agents</h1>
                <p className="mt-1 text-xs text-[var(--gray-11)]">共 {models.length} 个 Agent 模型</p>
              </div>
              <div className="flex items-center gap-2">
                {archivedCount > 0 && (
                  <Button
                    type="button"
                    size="1"
                    color="gray"
                    variant={showArchived ? "solid" : "soft"}
                    onClick={() => setShowArchived((previous) => !previous)}
                    title={showArchived ? "隐藏已归档" : "显示已归档"}
                  >
                    <StopOutlined />
                  </Button>
                )}
                {canManage && (
                  <Button type="button" size="1" onClick={() => setShowCreateModal(true)}>
                    <PlusOutlined />
                    新建
                  </Button>
                )}
              </div>
            </div>

            <div className="py-3">
              <TextField.Root
                value={keyword}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
                placeholder="搜索名称 / code / provider"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-[var(--gray-6)]">
              {filteredAgents.length === 0 ? (
                <div className="flex h-full min-h-56 items-center justify-center">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={showArchived ? "暂无归档 Agent" : "暂无可显示 Agent"}
                  />
                </div>
              ) : (
                <div className="divide-y divide-[var(--gray-6)]">
                  {filteredAgents.map((model) => {
                    const isSelected = model.id === selectedModelId;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setSelectedModelId(model.id);
                          setActiveTab("instructions");
                        }}
                        className={`w-full px-3 py-3 text-left transition-colors ${
                          isSelected ? "bg-[var(--gray-2)]" : "hover:bg-[var(--gray-a2)]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--gray-2)] text-[var(--gray-11)]">
                            <RobotOutlined />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{model.name}</p>
                              <Tag color={getModelStatusTagColor(model.status)} className="m-0">
                                {MODEL_STATUS_LABELS[model.status]}
                              </Tag>
                            </div>
                            <p className="mt-1 truncate text-xs text-[var(--gray-11)]">{model.code}</p>
                            <p className="mt-1 truncate text-xs text-[var(--gray-11)]">
                              {model.provider} / {model.provider_model}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card size="2" className="min-h-[560px] lg:h-[calc(100vh-190px)]">
          {!selectedAgent ? (
            <div className="flex h-full items-center justify-center">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个 Agent" />
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="space-y-3 border-b border-[var(--gray-6)] pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{selectedAgent.name}</h2>
                      <Tag color={getModelStatusTagColor(selectedAgent.status)}>{formatModelStatus(selectedAgent.status)}</Tag>
                      <Tag color={getHealthStatusTagColor(selectedAgent.latest_health_status)}>
                        {formatHealthStatus(selectedAgent.latest_health_status)}
                      </Tag>
                    </div>
                    <p className="mt-1 text-sm text-[var(--gray-11)]">{selectedAgent.code}</p>
                    <p className="mt-1 text-xs text-[var(--gray-11)]">
                      {selectedAgent.provider} / {selectedAgent.provider_model}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        color="gray"
                        variant="soft"
                        onClick={() => healthCheckMutation.mutate(selectedAgent.id)}
                        disabled={healthCheckMutation.isPending}
                      >
                        <ReloadOutlined />
                        健康检查
                      </Button>
                      {transitionCandidates.map((status) => (
                        <Button
                          key={status}
                          type="button"
                          color="gray"
                          variant="soft"
                          onClick={() => transitionMutation.mutate({ modelId: selectedAgent.id, status })}
                          disabled={transitionMutation.isPending}
                        >
                          流转到 {MODEL_STATUS_LABELS[status]}
                        </Button>
                      ))}
                      <Popconfirm
                        title="确认删除该 Agent？"
                        description="删除后不可恢复，请谨慎操作。"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => deleteModelMutation.mutate(selectedAgent.id)}
                      >
                        <Button type="button" color="red" variant="soft" disabled={deleteModelMutation.isPending}>
                          <DeleteOutlined />
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                  )}
                </div>

                {(error || success) && (
                  <div className="space-y-2">
                    {error && <AntAlert type="error" showIcon message={error} />}
                    {success && <AntAlert type="success" showIcon message={success} />}
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pt-3">
                <Tabs
                  activeKey={activeTab}
                  onChange={setActiveTab}
                  items={tabItems}
                  destroyOnHidden={false}
                />
              </div>
            </div>
          )}
        </Card>
      </div>

      {canManage && (
        <Dialog.Root
          open={showCreateModal}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setShowCreateModal(false);
              setCreateForm(EMPTY_AGENT_CREATE_FORM);
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">新建 Agent</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">使用现有模型注册能力创建 Agent 条目。</p>
              </div>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateForm(EMPTY_AGENT_CREATE_FORM);
                }}
              >
                关闭
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>模型编码（稳定引用键）</span>
                <TextField.Root
                  value={createForm.code}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, code: event.currentTarget.value }));
                  }}
                  placeholder="agent.coder"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>名称</span>
                <TextField.Root
                  value={createForm.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, name: event.currentTarget.value }));
                  }}
                  placeholder="Coding Agent"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>Provider</span>
                <Select.Root
                  value={createForm.provider}
                  onValueChange={(value: string) => {
                    setCreateForm((previous) => ({ ...previous, provider: value }));
                  }}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    {PROVIDER_OPTIONS.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>Provider Model</span>
                <TextField.Root
                  value={createForm.provider_model}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, provider_model: event.currentTarget.value }));
                  }}
                  placeholder="gpt-4.1"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>初始状态</span>
                <Select.Root
                  value={createForm.status}
                  onValueChange={(value: string) => {
                    setCreateForm((previous) => ({ ...previous, status: value as ModelStatus }));
                  }}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    {Object.keys(MODEL_STATUS_LABELS).map((status) => (
                      <Select.Item key={status} value={status}>
                        {formatModelStatus(status as ModelStatus)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>能力标签（逗号分隔）</span>
                <TextField.Root
                  value={createForm.capabilities}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, capabilities: event.currentTarget.value }));
                  }}
                  placeholder="chat, reasoning"
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>Base URL</span>
                <TextField.Root
                  value={createForm.base_url}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, base_url: event.currentTarget.value }));
                  }}
                  placeholder="https://api.example.com"
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>初始 API Key（可选）</span>
                <TextField.Root
                  value={createForm.api_key}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setCreateForm((previous) => ({ ...previous, api_key: event.currentTarget.value }));
                  }}
                  placeholder="sk-..."
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>说明</span>
                <TextArea
                  rows={4}
                  value={createForm.description}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    setCreateForm((previous) => ({ ...previous, description: event.currentTarget.value }));
                  }}
                  placeholder="描述该 Agent 的用途和边界"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={() => createAgentMutation.mutate()}
                disabled={
                  createAgentMutation.isPending ||
                  !createForm.code.trim() ||
                  !createForm.name.trim() ||
                  !createForm.provider_model.trim()
                }
              >
                {createAgentMutation.isPending ? "创建中..." : "创建 Agent"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {canManage && (
        <Dialog.Root
          open={showRouteModal}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setShowRouteModal(false);
              setEditingRouteId(null);
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{editingRouteId ? "编辑路由规则" : "新建路由规则"}</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">GLOBAL 的 route key 固定为 {GLOBAL_ROUTE_KEY}。</p>
              </div>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => {
                  setShowRouteModal(false);
                  setEditingRouteId(null);
                }}
              >
                关闭
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>路由类型</span>
                <Select.Root
                  value={routeForm.route_type}
                  onValueChange={(value: string) => {
                    setRouteForm((previous) => ({ ...previous, route_type: value as ModelRouteType }));
                  }}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content>
                    {ROUTE_TYPE_OPTIONS.map((type) => (
                      <Select.Item key={type} value={type}>
                        {type}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>Route Key</span>
                <TextField.Root
                  value={routeForm.route_type === "GLOBAL" ? GLOBAL_ROUTE_KEY : routeForm.route_key}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setRouteForm((previous) => ({ ...previous, route_key: event.currentTarget.value }));
                  }}
                  disabled={routeForm.route_type === "GLOBAL"}
                  placeholder="chat.default"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>目标模型 Code</span>
                <TextField.Root
                  value={routeForm.target_model_code}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setRouteForm((previous) => ({ ...previous, target_model_code: event.currentTarget.value }));
                  }}
                  placeholder="agent.coder"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>优先级</span>
                <TextField.Root
                  type="number"
                  value={routeForm.priority}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setRouteForm((previous) => ({ ...previous, priority: event.currentTarget.value }));
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <Checkbox
                  checked={routeForm.enabled}
                  onCheckedChange={(checked: boolean) => {
                    setRouteForm((previous) => ({ ...previous, enabled: checked }));
                  }}
                >
                  启用该规则
                </Checkbox>
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>备注</span>
                <TextArea
                  rows={3}
                  value={routeForm.note}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    setRouteForm((previous) => ({ ...previous, note: event.currentTarget.value }));
                  }}
                  placeholder="可选"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={() => saveRouteMutation.mutate()}
                disabled={saveRouteMutation.isPending || !routeForm.target_model_code.trim()}
              >
                {saveRouteMutation.isPending ? "保存中..." : editingRouteId ? "保存路由" : "创建路由"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
}
