"use client";

import { Alert as AntAlert, Dropdown, Empty, Popconfirm, Spin, Tag, type MenuProps } from "antd";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Checkbox, Dialog, Select, TextArea, TextField, Button, Table } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  ModelHealthStatus,
  ModelListResponse,
  ModelRegistryItem,
  ModelRouteRuleListResponse,
  ModelRouteType,
  ModelStatus,
  ModelSummaryResponse,
  ModelTestChatResponse,
  ModelTestRunItem,
  ModelTestRunListResponse,
  ModelTestStatus,
} from "@/types/auth";

const MODEL_STATUS_OPTIONS: ModelStatus[] = ["DRAFT", "ENABLED", "DISABLED", "DEPRECATED"];
const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  DRAFT: "草稿",
  ENABLED: "已启用",
  DISABLED: "已停用",
  DEPRECATED: "已废弃",
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
const GLOBAL_ROUTE_KEY = "__global__";
const MODEL_STATUS_ALL_FILTER = "__all_model_status__";
const ROUTE_TYPE_ALL_FILTER = "__all_route_type__";
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

const EMPTY_MODEL_FORM = {
  code: "",
  name: "",
  provider: "openai",
  provider_model: "",
  status: "DRAFT" as ModelStatus,
  capabilities: "",
  description: "",
  base_url: "",
  api_key: "",
};

type RouteFormState = {
  route_type: ModelRouteType;
  route_key: string;
  target_model_code: string;
  priority: string;
  enabled: boolean;
  note: string;
};

const EMPTY_ROUTE_FORM: RouteFormState = {
  route_type: "GLOBAL",
  route_key: "",
  target_model_code: "",
  priority: "100",
  enabled: true,
  note: "",
};

const EMPTY_TEST_FORM = {
  kind: "SMOKE",
  input_tokens: "16",
  output_tokens: "32",
};

const EMPTY_CHAT_TEST_FORM = {
  message: "",
  system_prompt: "",
};

type AdminModelsPageScene = "models" | "mcp" | "agent" | "orchestration";

type AdminModelsPageCopy = {
  entityLabel: string;
  loadingText: string;
  loginHint: string;
  permissionHint: string;
  modelListTitle: string;
  modelListDescription: string;
  emptyModelDescription: string;
  emptyFilteredModelDescription: string;
  maintainTitle: string;
  maintainDescription: string;
  createEntityLabel: string;
  routeTitle: string;
  routeDescription: string;
  emptyRouteDescription: string;
  createRouteLabel: string;
  rotateKeyHintPrefix: string;
  createEntityModalTitle: string;
  editEntityModalTitle: string;
};

const ADMIN_MODELS_PAGE_COPY: Record<AdminModelsPageScene, AdminModelsPageCopy> = {
  models: {
    entityLabel: "模型",
    loadingText: "加载模型管理数据中...",
    loginHint: "请先登录后再访问模型管理页面。",
    permissionHint: "你没有访问该页面的权限（需要 `model.read`）。",
    modelListTitle: "模型列表",
    modelListDescription: "稳定 `code` 作为引用键，`name` 仅用于展示。",
    emptyModelDescription: "暂无模型数据",
    emptyFilteredModelDescription: "未找到符合筛选条件的模型",
    maintainTitle: "模型维护",
    maintainDescription: "新建/编辑模型已迁移为弹窗操作。",
    createEntityLabel: "新建模型",
    routeTitle: "路由规则",
    routeDescription: "支持 GLOBAL / CAPABILITY / BUSINESS / AGENT 四类规则。",
    emptyRouteDescription: "暂无路由规则",
    createRouteLabel: "新建路由规则",
    rotateKeyHintPrefix: "为模型",
    createEntityModalTitle: "新建模型",
    editEntityModalTitle: "编辑模型",
  },
  mcp: {
    entityLabel: "MCP Server",
    loadingText: "加载 MCP 管理数据中...",
    loginHint: "请先登录后再访问 MCP 管理页面。",
    permissionHint: "你没有访问该页面的权限（需要 `model.read`）。",
    modelListTitle: "MCP Server 列表",
    modelListDescription: "复用模型编码与路由能力，统一管理 MCP Server 的服务配置与状态。",
    emptyModelDescription: "暂无 MCP Server 数据",
    emptyFilteredModelDescription: "未找到符合筛选条件的 MCP Server",
    maintainTitle: "MCP Server 维护",
    maintainDescription: "新建/编辑 MCP Server 采用统一弹窗流程。",
    createEntityLabel: "新建 MCP Server",
    routeTitle: "MCP 编排规则",
    routeDescription: "基于 GLOBAL / CAPABILITY / BUSINESS / AGENT 规则编排 MCP 服务路由。",
    emptyRouteDescription: "暂无 MCP 编排规则",
    createRouteLabel: "新建编排规则",
    rotateKeyHintPrefix: "为 MCP Server",
    createEntityModalTitle: "新建 MCP Server",
    editEntityModalTitle: "编辑 MCP Server",
  },
  agent: {
    entityLabel: "Agent 模型",
    loadingText: "加载 Agent 管理数据中...",
    loginHint: "请先登录后再访问 Agent 管理页面。",
    permissionHint: "你没有访问该页面的权限（需要 `model.read`）。",
    modelListTitle: "Agent 模型列表",
    modelListDescription: "统一管理 Agent 入口使用的模型配置、健康状态与调用指标。",
    emptyModelDescription: "暂无 Agent 模型数据",
    emptyFilteredModelDescription: "未找到符合筛选条件的 Agent 模型",
    maintainTitle: "Agent 模型维护",
    maintainDescription: "新建/编辑 Agent 模型采用统一弹窗流程。",
    createEntityLabel: "新建 Agent 模型",
    routeTitle: "Agent 路由规则",
    routeDescription: "支持 GLOBAL / CAPABILITY / BUSINESS / AGENT 四类规则，并可聚焦 Agent 场景编排。",
    emptyRouteDescription: "暂无 Agent 路由规则",
    createRouteLabel: "新建 Agent 路由规则",
    rotateKeyHintPrefix: "为 Agent 模型",
    createEntityModalTitle: "新建 Agent 模型",
    editEntityModalTitle: "编辑 Agent 模型",
  },
  orchestration: {
    entityLabel: "编排模型",
    loadingText: "加载编排管理数据中...",
    loginHint: "请先登录后再访问编排管理页面。",
    permissionHint: "你没有访问该页面的权限（需要 `model.read`）。",
    modelListTitle: "编排模型列表",
    modelListDescription: "用于路由目标选择的模型清单。",
    emptyModelDescription: "暂无可用于编排的模型",
    emptyFilteredModelDescription: "未找到符合筛选条件的编排模型",
    maintainTitle: "编排模型维护",
    maintainDescription: "模型维护入口保留在模型管理页。",
    createEntityLabel: "新建编排模型",
    routeTitle: "编排路由规则",
    routeDescription: "默认聚焦 AGENT 路由，可按需切换查看 GLOBAL / CAPABILITY / BUSINESS。",
    emptyRouteDescription: "暂无编排路由规则",
    createRouteLabel: "新建编排规则",
    rotateKeyHintPrefix: "为编排模型",
    createEntityModalTitle: "新建编排模型",
    editEntityModalTitle: "编辑编排模型",
  },
};

function parseCapabilities(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort();
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatModelStatus(status: ModelStatus): string {
  return `${MODEL_STATUS_LABELS[status]}（${status}）`;
}

function formatHealthStatus(status: ModelHealthStatus | null): string {
  if (!status) return "-";
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
      return "red";
    case "DRAFT":
    default:
      return "default";
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

function getRouteEnabledTagColor(enabled: boolean): string {
  return enabled ? "green" : "default";
}

async function invalidateModelQueries(
  queryClient: QueryClient,
  modelsPath: string,
  summaryPath: string,
  routesPath: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [modelsPath] });
  await queryClient.invalidateQueries({ queryKey: [summaryPath] });
  await queryClient.invalidateQueries({ queryKey: [routesPath] });
}

export default function AdminModelsPageContent({ scene = "models" }: { scene?: AdminModelsPageScene }) {
  const pageCopy = ADMIN_MODELS_PAGE_COPY[scene];
  const isOrchestrationScene = scene === "orchestration";
  const defaultRouteType: ModelRouteType = isOrchestrationScene ? "AGENT" : "GLOBAL";
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("model.read") || hasPermission("model.manage");
  const canManage = hasPermission("model.manage");

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingModelId, setEditingModelId] = useState<number | null>(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelForm, setModelForm] = useState(EMPTY_MODEL_FORM);

  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeForm, setRouteForm] = useState<RouteFormState>({
    ...EMPTY_ROUTE_FORM,
    route_type: defaultRouteType,
  });
  const [routeTypeFilter, setRouteTypeFilter] = useState<string>(isOrchestrationScene ? "AGENT" : "");
  const [routeKeyword, setRouteKeyword] = useState("");

  const [showTestModal, setShowTestModal] = useState(false);
  const [testingModel, setTestingModel] = useState<ModelRegistryItem | null>(null);
  const [testForm, setTestForm] = useState(EMPTY_TEST_FORM);
  const [testRunHistory, setTestRunHistory] = useState<ModelTestRunItem[]>([]);

  const [showChatTestModal, setShowChatTestModal] = useState(false);
  const [chatTestingModel, setChatTestingModel] = useState<ModelRegistryItem | null>(null);
  const [chatTestForm, setChatTestForm] = useState(EMPTY_CHAT_TEST_FORM);
  const [chatTestResult, setChatTestResult] = useState<ModelTestChatResponse | null>(null);

  const [rotateKeyModel, setRotateKeyModel] = useState<ModelRegistryItem | null>(null);
  const [rotateKeyInput, setRotateKeyInput] = useState("");

  const modelsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    const query = params.toString();
    return query ? `/api/v1/admin/models?${query}` : "/api/v1/admin/models";
  }, [keyword, statusFilter]);
  const summaryPath = "/api/v1/admin/models/summary";
  const routesPath = "/api/v1/admin/model-routes";

  const resetModelModal = useCallback(() => {
    setEditingModelId(null);
    setShowModelModal(false);
    setModelForm(EMPTY_MODEL_FORM);
  }, []);

  const resetRouteModal = useCallback(() => {
    setEditingRouteId(null);
    setShowRouteModal(false);
    setRouteForm({ ...EMPTY_ROUTE_FORM, route_type: defaultRouteType });
  }, [defaultRouteType]);

  const resetTestModal = useCallback(() => {
    setShowTestModal(false);
    setTestingModel(null);
    setTestForm(EMPTY_TEST_FORM);
    setTestRunHistory([]);
  }, []);

  const resetChatTestModal = useCallback(() => {
    setShowChatTestModal(false);
    setChatTestingModel(null);
    setChatTestForm(EMPTY_CHAT_TEST_FORM);
    setChatTestResult(null);
  }, []);

  const loadModels = useCallback(async () => {
    const response = await fetchWithAuth(modelsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as ModelListResponse;
  }, [fetchWithAuth, modelsPath]);

  const loadSummary = useCallback(async () => {
    const response = await fetchWithAuth(summaryPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as ModelSummaryResponse;
  }, [fetchWithAuth]);

  const loadRoutes = useCallback(async () => {
    const response = await fetchWithAuth(routesPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as ModelRouteRuleListResponse;
  }, [fetchWithAuth]);

  const modelsQuery = useQuery({
    queryKey: [modelsPath],
    queryFn: loadModels,
    enabled: !!user && canRead,
  });

  const summaryQuery = useQuery({
    queryKey: [summaryPath],
    queryFn: loadSummary,
    enabled: !!user && canRead,
  });

  const routesQuery = useQuery({
    queryKey: [routesPath],
    queryFn: loadRoutes,
    enabled: !!user && canRead,
  });

  useTopicSubscription(
    "admin.models",
    useCallback(() => {
      if (!user || !canRead) {
        return;
      }
      void invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    }, [canRead, modelsPath, queryClient, routesPath, summaryPath, user]),
  );

  const saveModelMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: modelForm.code.trim().toLowerCase(),
        name: modelForm.name.trim(),
        provider: modelForm.provider.trim(),
        provider_model: modelForm.provider_model.trim(),
        status: modelForm.status,
        capabilities: parseCapabilities(modelForm.capabilities),
        description: modelForm.description.trim(),
        base_url: modelForm.base_url.trim() || null,
        api_key: modelForm.api_key.trim() || null,
      };

      if (editingModelId) {
        const response = await fetchWithAuth(`/api/v1/admin/models/${editingModelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            provider: payload.provider,
            provider_model: payload.provider_model,
            capabilities: payload.capabilities,
            description: payload.description,
            base_url: payload.base_url,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return response.json();
      }

      const response = await fetchWithAuth("/api/v1/admin/models", {
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
      setSuccess(editingModelId ? "模型已更新" : "模型已创建");
      setError("");
      resetModelModal();
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "模型保存失败");
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
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("模型状态已流转");
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "状态流转失败");
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (model: ModelRegistryItem) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${model.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("模型已删除");
      if (editingModelId) {
        resetModelModal();
      }
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "模型删除失败");
    },
  });

  const rotateKeyMutation = useMutation({
    mutationFn: async ({ modelId, apiKey }: { modelId: number; apiKey: string }) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}/rotate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setRotateKeyModel(null);
      setRotateKeyInput("");
      setError("");
      setSuccess("密钥已轮换");
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "密钥轮换失败");
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
      setSuccess("健康检查已执行");
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "健康检查失败");
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!testingModel) {
        throw new Error("未选择待测试模型");
      }
      const payload = {
        kind: testForm.kind.trim().toUpperCase() || "SMOKE",
        input_tokens: Number(testForm.input_tokens || 0),
        output_tokens: Number(testForm.output_tokens || 0),
      };
      const response = await fetchWithAuth(`/api/v1/admin/models/${testingModel.id}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestRunItem;
    },
    onSuccess: async (created) => {
      setError("");
      setSuccess(`冒烟测试已执行：${formatTestStatus(created.status)}`);
      setTestRunHistory((prev) => [created, ...prev].slice(0, 20));
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "模型测试失败");
    },
  });

  const chatTestMutation = useMutation({
    mutationFn: async () => {
      if (!chatTestingModel) {
        throw new Error("未选择待测试模型");
      }
      const payload = {
        message: chatTestForm.message.trim(),
        system_prompt: chatTestForm.system_prompt.trim() || null,
      };
      if (!payload.message) {
        throw new Error("请输入测试内容");
      }
      const response = await fetchWithAuth(`/api/v1/admin/models/${chatTestingModel.id}/test-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestChatResponse;
    },
    onSuccess: async (result) => {
      setError("");
      setSuccess(`对话测试已执行：${formatTestStatus(result.test_status)}`);
      setChatTestResult(result);
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setChatTestResult(null);
      setError(candidate instanceof Error ? candidate.message : "对话测试失败");
    },
  });

  const loadModelTests = useCallback(
    async (modelId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}/tests?limit=20`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const data = (await response.json()) as ModelTestRunListResponse;
      return data.items;
    },
    [fetchWithAuth],
  );

  const openTestModal = useCallback(
    async (model: ModelRegistryItem) => {
      setError("");
      setSuccess("");
      setTestingModel(model);
      setShowTestModal(true);
      setTestForm(EMPTY_TEST_FORM);
      try {
        const history = await loadModelTests(model.id);
        setTestRunHistory(history);
      } catch (candidate) {
        setTestRunHistory([]);
        setError(candidate instanceof Error ? candidate.message : "获取模型测试记录失败");
      }
    },
    [loadModelTests],
  );

  const openChatTestModal = useCallback((model: ModelRegistryItem) => {
    setError("");
    setSuccess("");
    setChatTestingModel(model);
    setShowChatTestModal(true);
    setChatTestForm(EMPTY_CHAT_TEST_FORM);
    setChatTestResult(null);
  }, []);

  const openRotateKeyModal = useCallback((model: ModelRegistryItem) => {
    setRotateKeyModel(model);
    setRotateKeyInput("");
    setError("");
    setSuccess("");
  }, []);

  const submitRotateKey = useCallback(() => {
    if (!rotateKeyModel || !rotateKeyInput.trim()) {
      return;
    }
    rotateKeyMutation.mutate({ modelId: rotateKeyModel.id, apiKey: rotateKeyInput.trim() });
  }, [rotateKeyInput, rotateKeyModel, rotateKeyMutation]);

  const saveRouteMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        route_type: routeForm.route_type,
        route_key: routeForm.route_type === "GLOBAL" ? null : (routeForm.route_key.trim() || null),
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

      const response = await fetchWithAuth("/api/v1/admin/model-routes", {
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
      resetRouteModal();
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "路由规则保存失败");
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeRuleId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/model-routes/${routeRuleId}`, {
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
      if (editingRouteId) {
        resetRouteModal();
      }
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "路由规则删除失败");
    },
  });

  const startEditModel = (model: ModelRegistryItem) => {
    setEditingModelId(model.id);
    setShowModelModal(true);
    setModelForm({
      code: model.code,
      name: model.name,
      provider: model.provider,
      provider_model: model.provider_model,
      status: model.status,
      capabilities: model.capabilities.join(", "),
      description: model.description,
      base_url: model.base_url ?? "",
      api_key: "",
    });
  };

  const startEditRoute = (route: NonNullable<ModelRouteRuleListResponse["items"][number]>) => {
    setEditingRouteId(route.id);
    setShowRouteModal(true);
    setRouteForm({
      route_type: route.route_type,
      route_key: route.route_type === "GLOBAL" ? "" : route.route_key,
      target_model_code: route.target_model_code,
      priority: String(route.priority),
      enabled: route.enabled,
      note: route.note ?? "",
    });
  };

  const activeModelCodes = useMemo(() => {
    return (modelsQuery.data?.items ?? []).map((item) => item.code);
  }, [modelsQuery.data?.items]);

  const providerOptions = useMemo(() => {
    const currentProvider = modelForm.provider.trim().toLowerCase();
    if (!currentProvider) {
      return PROVIDER_OPTIONS;
    }
    if (PROVIDER_OPTIONS.some((item) => item.value === currentProvider)) {
      return PROVIDER_OPTIONS;
    }
    return [{ value: currentProvider, label: `${currentProvider}（当前）` }, ...PROVIDER_OPTIONS];
  }, [modelForm.provider]);

  const summary = summaryQuery.data;
  const models = modelsQuery.data?.items ?? [];
  const routes = routesQuery.data?.items ?? [];
  const filteredRoutes = useMemo(() => {
    return routes.filter((route) => {
      const matchType = routeTypeFilter ? route.route_type === routeTypeFilter : true;
      const keyword = routeKeyword.trim().toLowerCase();
      if (!keyword) {
        return matchType;
      }
      const keyText = `${route.route_key} ${route.target_model_code} ${route.note ?? ""}`.toLowerCase();
      return matchType && keyText.includes(keyword);
    });
  }, [routeKeyword, routeTypeFilter, routes]);
  const hasRouteFilters = Boolean(routeTypeFilter) || Boolean(routeKeyword.trim());
  const hasModelFilters = Boolean(keyword.trim()) || Boolean(statusFilter);

  const queryError = useMemo(() => {
    for (const candidate of [summaryQuery.error, modelsQuery.error, routesQuery.error]) {
      if (candidate instanceof Error) {
        return candidate.message;
      }
    }
    return "";
  }, [modelsQuery.error, routesQuery.error, summaryQuery.error]);

  if (initializing || modelsQuery.isLoading || summaryQuery.isLoading || routesQuery.isLoading) {
    return (
      <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-8">
        <div className="flex items-center justify-center gap-3 text-sm text-[var(--gray-11)]">
          <Spin size="small" />
          <span>{pageCopy.loadingText}</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">{pageCopy.loginHint}</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">{pageCopy.permissionHint}</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || queryError) && (
        <AntAlert
          type="error"
          showIcon
          message="操作失败"
          description={<div className="whitespace-pre-wrap text-xs leading-5">{error || queryError}</div>}
        />
      )}
      {success && <AntAlert type="success" showIcon message={success} />}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-sm text-[var(--gray-11)]">{pageCopy.entityLabel}总数</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.total_models ?? 0}</p>
          <p className="mt-2 text-xs text-[var(--gray-11)]">已启用: {summary?.status_counts.ENABLED ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-sm text-[var(--gray-11)]">路由规则</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.total_route_rules ?? 0}</p>
          <p className="mt-2 text-xs text-[var(--gray-11)]">GLOBAL: {summary?.route_type_counts.GLOBAL ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-sm text-[var(--gray-11)]">近 7 天用量</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.usage_7d.request_count ?? 0}</p>
          <p className="mt-2 text-xs text-[var(--gray-11)]">成功率: {formatPercent(summary?.usage_7d.success_rate ?? null)}</p>
        </div>
        <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-sm text-[var(--gray-11)]">健康风险</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.enabled_without_healthy_check ?? 0}</p>
          <p className="mt-2 text-xs text-[var(--gray-11)]">ENABLED 且未健康</p>
        </div>
      </section>

      {!isOrchestrationScene && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{pageCopy.modelListTitle}</h2>
              <p className="mt-1 text-sm text-[var(--gray-11)]">{pageCopy.modelListDescription}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <TextField.Root
                aria-label={`按关键字搜索${pageCopy.entityLabel}`}
                value={keyword}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
                placeholder={`搜索 code/name/provider（${pageCopy.entityLabel}）`}
                className="w-full"
              />
              <Select.Root
                value={statusFilter || MODEL_STATUS_ALL_FILTER}
                onValueChange={(value: string) => setStatusFilter(value === MODEL_STATUS_ALL_FILTER ? "" : value)}
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value={MODEL_STATUS_ALL_FILTER}>全部状态</Select.Item>
                  {MODEL_STATUS_OPTIONS.map((item) => (
                    <Select.Item key={item} value={item}>
                      {formatModelStatus(item)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div className="overflow-x-auto">
            {models.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-8">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={hasModelFilters ? pageCopy.emptyFilteredModelDescription : pageCopy.emptyModelDescription}
                >
                  {hasModelFilters ? (
                    <Button
                      type="button"
                      color="gray"
                      variant="soft"
                      onClick={() => {
                        setKeyword("");
                        setStatusFilter("");
                      }}
                    >
                      清空筛选
                    </Button>
                  ) : null}
                </Empty>
              </div>
            ) : (
              <Table.Root className="w-full min-w-full text-left text-sm">
                <Table.Header className="bg-[var(--gray-a3)]">
                  <Table.Row>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Code</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Provider/Model</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">密钥</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">健康</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">7日用量</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">7日测试</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">路由绑定</Table.ColumnHeaderCell>
                    {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
                  </Table.Row>
                </Table.Header>
                <Table.Body className="divide-y">
                  {models.map((model) => (
                    <Table.Row key={model.id}>
                      <Table.Cell className="px-4 py-3">
                        <p className="font-mono text-xs">{model.code}</p>
                        <p className="mt-1 text-xs text-[var(--gray-11)]">{model.name}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3">
                        <p>{model.provider}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--gray-11)]">{model.provider_model}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3">
                        <Tag color={getModelStatusTagColor(model.status)}>{formatModelStatus(model.status)}</Tag>
                        <p className="mt-1 text-xs text-[var(--gray-11)]">{model.capabilities.join(", ") || "-"}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3 text-xs">
                        <p>{model.active_key_masked ?? "-"}</p>
                        <p className="mt-1 text-[var(--gray-11)]">v{model.active_key_version ?? "-"}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3 text-xs">
                        <Tag color={getHealthStatusTagColor(model.latest_health_status)}>{formatHealthStatus(model.latest_health_status)}</Tag>
                        <p className="mt-1 text-[var(--gray-11)]">{model.latest_health_at ? new Date(model.latest_health_at).toLocaleString() : "-"}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3 text-xs">
                        <p>请求: {model.usage_7d.request_count}</p>
                        <p className="mt-1 text-[var(--gray-11)]">成功率: {formatPercent(model.usage_7d.success_rate)}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3 text-xs">
                        <p>Runs: {model.tests_7d.total_runs}</p>
                        <p className="mt-1 text-[var(--gray-11)]">通过率: {formatPercent(model.tests_7d.pass_rate)}</p>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3">{model.route_bindings_count}</Table.Cell>
                      {canManage && (
                        <Table.Cell className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              color="gray"
                              size="1"
                              variant="soft"
                              onClick={() => startEditModel(model)}
                            >
                              编辑
                            </Button>
                            <Dropdown
                              menu={{
                                items: [
                                  {
                                    key: "rotate-key",
                                    label: "轮换密钥",
                                    disabled: rotateKeyMutation.isPending,
                                  },
                                  {
                                    key: "health-check",
                                    label: "健康检查",
                                    disabled: healthCheckMutation.isPending,
                                  },
                                  {
                                    key: "smoke-test",
                                    label: "冒烟测试",
                                    disabled: testMutation.isPending,
                                  },
                                  {
                                    key: "chat-test",
                                    label: "对话测试",
                                    disabled: chatTestMutation.isPending,
                                  },
                                  {
                                    type: "divider",
                                  },
                                  ...MODEL_STATUS_TRANSITIONS[model.status].map((nextStatus) => ({
                                    key: `transition:${nextStatus}`,
                                    label: `流转到 ${formatModelStatus(nextStatus)}`,
                                    disabled: transitionMutation.isPending,
                                  })),
                                ] as MenuProps["items"],
                                onClick: ({ key }) => {
                                  if (key === "rotate-key") {
                                    openRotateKeyModal(model);
                                    return;
                                  }
                                  if (key === "health-check") {
                                    healthCheckMutation.mutate(model.id);
                                    return;
                                  }
                                  if (key === "smoke-test") {
                                    openTestModal(model);
                                    return;
                                  }
                                  if (key === "chat-test") {
                                    openChatTestModal(model);
                                    return;
                                  }
                                  if (typeof key === "string" && key.startsWith("transition:")) {
                                    const nextStatus = key.replace("transition:", "") as ModelStatus;
                                    transitionMutation.mutate({ modelId: model.id, status: nextStatus });
                                  }
                                },
                              }}
                              trigger={["click"]}
                            >
                              <Button type="button" color="gray" size="1" variant="soft">
                                更多操作
                              </Button>
                            </Dropdown>
                            {model.status !== "ENABLED" && (
                              <Popconfirm
                                title="确认删除模型"
                                description={`确认删除模型 ${model.code} 吗？`}
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true, loading: deleteModelMutation.isPending }}
                                onConfirm={() => deleteModelMutation.mutate(model)}
                              >
                                <Button
                                  type="button"
                                  color="red"
                                  size="1"
                                  variant="soft"
                                  disabled={deleteModelMutation.isPending}
                                >
                                  删除
                                </Button>
                              </Popconfirm>
                            )}
                          </div>
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </div>
        </section>
      )}

      {!isOrchestrationScene && canManage && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{pageCopy.maintainTitle}</h2>
              <p className="mt-1 text-sm text-[var(--gray-11)]">{pageCopy.maintainDescription}</p>
            </div>
            <Button
              type="button"
             
              onClick={() => {
                setModelForm(EMPTY_MODEL_FORM);
                setEditingModelId(null);
                setShowModelModal(true);
              }}
            >
              {pageCopy.createEntityLabel}
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{pageCopy.routeTitle}</h2>
          <p className="mt-1 text-sm text-[var(--gray-11)]">{pageCopy.routeDescription}</p>
        </div>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-2 md:grid-cols-2">
            <Select.Root
              value={routeTypeFilter || ROUTE_TYPE_ALL_FILTER}
              onValueChange={(value: string) => setRouteTypeFilter(value === ROUTE_TYPE_ALL_FILTER ? "" : value)}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value={ROUTE_TYPE_ALL_FILTER}>全部类型</Select.Item>
                {ROUTE_TYPE_OPTIONS.map((item) => (
                  <Select.Item key={item} value={item}>
                    {item}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <TextField.Root
              aria-label="按路由关键字搜索"
              value={routeKeyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setRouteKeyword(event.currentTarget.value)}
              placeholder="搜索 route key / 目标模型 / 备注"
              className="w-full"
            />
          </div>
          {canManage && (
            <Button
              type="button"
             
              onClick={() => {
                setRouteForm({ ...EMPTY_ROUTE_FORM, route_type: defaultRouteType });
                setEditingRouteId(null);
                setShowRouteModal(true);
              }}
            >
              {pageCopy.createRouteLabel}
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          {filteredRoutes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-8">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={pageCopy.emptyRouteDescription}>
                {hasRouteFilters ? (
                  <Button
                    type="button"
                    color="gray"
                    variant="soft"
                    onClick={() => {
                      setRouteTypeFilter(isOrchestrationScene ? "AGENT" : "");
                      setRouteKeyword("");
                    }}
                  >
                    清空筛选
                  </Button>
                ) : null}
              </Empty>
            </div>
          ) : (
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header className="bg-[var(--gray-a3)]">
                <Table.Row>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">类型</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Key</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">目标模型 Code</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">优先级</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                  {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
                </Table.Row>
              </Table.Header>
              <Table.Body className="divide-y">
                {filteredRoutes.map((route) => (
                  <Table.Row key={route.id}>
                    <Table.Cell className="px-4 py-3">
                      <Tag color="blue">{route.route_type}</Tag>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-3 font-mono text-xs">{route.route_type === "GLOBAL" ? GLOBAL_ROUTE_KEY : route.route_key}</Table.Cell>
                    <Table.Cell className="px-4 py-3 font-mono text-xs">{route.target_model_code}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{route.priority}</Table.Cell>
                    <Table.Cell className="px-4 py-3">
                      <Tag color={getRouteEnabledTagColor(route.enabled)}>{route.enabled ? "启用" : "停用"}</Tag>
                    </Table.Cell>
                    {canManage && (
                      <Table.Cell className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            color="gray" size="1" variant="soft"
                            onClick={() => startEditRoute(route)}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title="确认删除路由规则"
                            description={`确认删除路由规则 ${route.route_type}:${route.route_key} 吗？`}
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true, loading: deleteRouteMutation.isPending }}
                            onConfirm={() => deleteRouteMutation.mutate(route.id)}
                          >
                            <Button
                              type="button"
                              color="red" size="1" variant="soft"
                              disabled={deleteRouteMutation.isPending}
                            >
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
      </section>

      {canManage && (
        <Dialog.Root
          open={rotateKeyModel !== null}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setRotateKeyModel(null);
              setRotateKeyInput("");
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">轮换 API Key</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">
                  {rotateKeyModel ? `${pageCopy.rotateKeyHintPrefix} ${rotateKeyModel.code} 设置新密钥` : "请输入新密钥"}
                </p>
              </div>
              <Button
                type="button"
                className="w-fit" color="gray" variant="soft"
                onClick={() => {
                  setRotateKeyModel(null);
                  setRotateKeyInput("");
                }}
              >
                关闭
              </Button>
            </div>

            <label className="space-y-2 text-sm">
              <span>新 API Key</span>
              <TextField.Root
                type="password"
                value={rotateKeyInput}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setRotateKeyInput(event.currentTarget.value)}
                placeholder="sk-..."
                className="w-full"
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => {
                  setRotateKeyModel(null);
                  setRotateKeyInput("");
                }}
                disabled={rotateKeyMutation.isPending}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={!rotateKeyInput.trim() || rotateKeyMutation.isPending}
                onClick={submitRotateKey}
              >
                {rotateKeyMutation.isPending ? "提交中..." : "确认轮换"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {canManage && (
        <Dialog.Root
          open={showModelModal}
          onOpenChange={(open: boolean) => {
            if (!open) {
              resetModelModal();
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{editingModelId ? pageCopy.editEntityModalTitle : pageCopy.createEntityModalTitle}</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">创建时可设置初始密钥；编辑阶段仅维护模型元数据。</p>
              </div>
              <Button
                type="button"
                className="w-fit" color="gray" variant="soft"
                onClick={resetModelModal}
              >
                关闭
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>模型编码（稳定引用键）</span>
                <TextField.Root
                  value={modelForm.code}
                  disabled={editingModelId !== null}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, code: event.currentTarget.value }))}
                  placeholder="openai.gpt-5"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>模型名称（展示用）</span>
                <TextField.Root
                  value={modelForm.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, name: event.currentTarget.value }))}
                  placeholder="GPT-5 主模型"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>Provider</span>
                <Select.Root
                  value={modelForm.provider}
                  onValueChange={(value: string) => setModelForm((prev) => ({ ...prev, provider: value }))}
                >
                  <Select.Trigger className="w-full">
                  </Select.Trigger>
                  <Select.Content>
                    {providerOptions.map((item) => (
                      <Select.Item key={item.value} value={item.value}>
                        {item.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>Provider Model</span>
                <TextField.Root
                  value={modelForm.provider_model}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, provider_model: event.currentTarget.value }))}
                  placeholder="gpt-5"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>初始状态</span>
                <Select.Root
                  value={modelForm.status}
                  disabled={editingModelId !== null}
                  onValueChange={(value: string) => setModelForm((prev) => ({ ...prev, status: value as ModelStatus }))}
                >
                  <Select.Trigger className="w-full">
                  </Select.Trigger>
                  <Select.Content>
                    {MODEL_STATUS_OPTIONS.map((item) => (
                      <Select.Item key={item} value={item}>
                        {formatModelStatus(item)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>能力标签（逗号分隔）</span>
                <TextField.Root
                  value={modelForm.capabilities}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, capabilities: event.currentTarget.value }))}
                  placeholder="chat,reasoning"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>Base URL</span>
                <TextField.Root
                  value={modelForm.base_url}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, base_url: event.currentTarget.value }))}
                  placeholder="https://api.example.com"
                  className="w-full"
                />
              </label>
              {!editingModelId && (
                <label className="space-y-2 text-sm md:col-span-2">
                  <span>初始 API Key（仅创建时）</span>
                  <TextField.Root
                    value={modelForm.api_key}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setModelForm((prev) => ({ ...prev, api_key: event.currentTarget.value }))}
                    placeholder="sk-..."
                    className="w-full"
                  />
                </label>
              )}
              <label className="space-y-2 text-sm md:col-span-2">
                <span>描述</span>
                <TextArea
                  rows={4}
                  value={modelForm.description}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setModelForm((prev) => ({ ...prev, description: event.currentTarget.value }))}
                  placeholder="模型用途、限制、成本策略..."
                  className="w-full"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
               
                disabled={saveModelMutation.isPending || !modelForm.code.trim() || !modelForm.name.trim() || !modelForm.provider_model.trim()}
                onClick={() => saveModelMutation.mutate()}
              >
                {saveModelMutation.isPending ? "提交中..." : editingModelId ? "保存模型" : "创建模型"}
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
              resetRouteModal();
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{editingRouteId ? "编辑路由规则" : "新建路由规则"}</h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">GLOBAL 规则的 key 固定为 {GLOBAL_ROUTE_KEY}。</p>
              </div>
              <Button
                type="button"
                className="w-fit" color="gray" variant="soft"
                onClick={resetRouteModal}
              >
                关闭
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>路由类型</span>
                <Select.Root
                  value={routeForm.route_type}
                  onValueChange={(value: string) => setRouteForm((prev) => ({ ...prev, route_type: value as ModelRouteType }))}
                >
                  <Select.Trigger className="w-full">
                  </Select.Trigger>
                  <Select.Content>
                    {ROUTE_TYPE_OPTIONS.map((item) => (
                      <Select.Item key={item} value={item}>
                        {item}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label className="space-y-2 text-sm">
                <span>Route Key</span>
                <TextField.Root
                  value={routeForm.route_type === "GLOBAL" ? GLOBAL_ROUTE_KEY : routeForm.route_key}
                  disabled={routeForm.route_type === "GLOBAL"}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setRouteForm((prev) => ({ ...prev, route_key: event.currentTarget.value }))}
                  placeholder="chat.default"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>目标模型 Code</span>
                <TextField.Root
                  value={routeForm.target_model_code}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setRouteForm((prev) => ({ ...prev, target_model_code: event.currentTarget.value }))}
                  list="model-code-options"
                  className="w-full"
                />
                <datalist id="model-code-options">
                  {activeModelCodes.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-2 text-sm">
                <span>优先级（越小越高）</span>
                <TextField.Root
                  type="number"
                  value={routeForm.priority}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setRouteForm((prev) => ({ ...prev, priority: event.currentTarget.value }))}
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span>备注</span>
                <TextArea
                  value={routeForm.note}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setRouteForm((prev) => ({ ...prev, note: event.currentTarget.value }))}
                  placeholder="例如：客服场景优先使用"
                  rows={2}
                  className="w-full"
                />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <Checkbox
                  checked={routeForm.enabled}
                  onCheckedChange={(checked: boolean | "indeterminate") =>
                    setRouteForm((prev) => ({ ...prev, enabled: checked === true }))
                  }
                />
                <span>启用规则</span>
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
               
                disabled={saveRouteMutation.isPending || !routeForm.target_model_code.trim()}
                onClick={() => saveRouteMutation.mutate()}
              >
                {saveRouteMutation.isPending ? "提交中..." : editingRouteId ? "保存规则" : "创建规则"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}
      {canManage && (
        <Dialog.Root
          open={showTestModal}
          onOpenChange={(open: boolean) => {
            if (!open) {
              resetTestModal();
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  冒烟测试：{testingModel ? `${testingModel.code} / ${testingModel.name}` : "-"}
                </h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">支持自定义测试类型与输入/输出 token，提交后可查看最近 20 条测试记录。</p>
              </div>
              <Button className="w-fit" color="gray" type="button" variant="soft" onClick={resetTestModal}>
                关闭
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm">
                <span>测试类型</span>
                <TextField.Root
                  value={testForm.kind}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setTestForm((prev) => ({ ...prev, kind: event.currentTarget.value }))
                  }
                  placeholder="SMOKE"
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>输入 Token</span>
                <TextField.Root
                  type="number"
                  min={0}
                  value={testForm.input_tokens}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setTestForm((prev) => ({ ...prev, input_tokens: event.currentTarget.value }))
                  }
                  className="w-full"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>输出 Token</span>
                <TextField.Root
                  type="number"
                  min={0}
                  value={testForm.output_tokens}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setTestForm((prev) => ({ ...prev, output_tokens: event.currentTarget.value }))
                  }
                  className="w-full"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
               
                disabled={
                  testMutation.isPending ||
                  !testingModel ||
                  !testForm.kind.trim() ||
                  Number(testForm.input_tokens || 0) < 0 ||
                  Number(testForm.output_tokens || 0) < 0
                }
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? "测试中..." : "执行测试"}
              </Button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <Table.Root className="w-full min-w-full text-left text-sm">
                <Table.Header className="bg-[var(--gray-a3)]">
                  <Table.Row>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">时间</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Token</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">耗时</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">错误</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body className="divide-y">
                  {testRunHistory.length === 0 ? (
                    <Table.Row>
                      <Table.Cell className="px-4 py-6" colSpan={6}>
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无测试记录" />
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    testRunHistory.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell className="px-4 py-3 text-xs">{new Date(item.created_at).toLocaleString()}</Table.Cell>
                        <Table.Cell className="px-4 py-3">{item.kind}</Table.Cell>
                        <Table.Cell className="px-4 py-3">{formatTestStatus(item.status)}</Table.Cell>
                        <Table.Cell className="px-4 py-3 text-xs">{item.input_tokens} / {item.output_tokens}</Table.Cell>
                        <Table.Cell className="px-4 py-3 text-xs">{item.latency_ms ?? "-"} ms</Table.Cell>
                        <Table.Cell className="px-4 py-3 text-xs text-red-600">{item.error_message ?? "-"}</Table.Cell>
                      </Table.Row>
                    ))
                  )}
                </Table.Body>
              </Table.Root>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}
      {canManage && (
        <Dialog.Root
          open={showChatTestModal}
          onOpenChange={(open: boolean) => {
            if (!open) {
              resetChatTestModal();
            }
          }}
        >
          <Dialog.Content className="max-h-[90vh] w-full max-w-3xl overflow-auto">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  对话测试：{chatTestingModel ? `${chatTestingModel.code} / ${chatTestingModel.name}` : "-"}
                </h2>
                <p className="mt-1 text-sm text-[var(--gray-11)]">向目标模型发送真实对话请求并展示回复、耗时与 token 统计。</p>
              </div>
              <Button className="w-fit" color="gray" type="button" variant="soft" onClick={resetChatTestModal}>
                关闭
              </Button>
            </div>

            <div className="space-y-4">
              <label className="space-y-2 text-sm">
                <span>用户输入</span>
                <TextArea
                  value={chatTestForm.message}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setChatTestForm((prev) => ({ ...prev, message: event.currentTarget.value }))
                  }
                  placeholder="请输入要测试的用户消息"
                  rows={5}
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>系统提示词（可选）</span>
                <TextArea
                  value={chatTestForm.system_prompt}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setChatTestForm((prev) => ({ ...prev, system_prompt: event.currentTarget.value }))
                  }
                  placeholder="可选：覆盖默认 system prompt"
                  rows={4}
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
               
                disabled={chatTestMutation.isPending || !chatTestingModel || !chatTestForm.message.trim()}
                onClick={() => chatTestMutation.mutate()}
              >
                {chatTestMutation.isPending ? "测试中..." : "执行对话测试"}
              </Button>
            </div>

            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              {chatTestResult ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-4">
                    <span>状态：{formatTestStatus(chatTestResult.test_status)}</span>
                    <span>耗时：{chatTestResult.latency_ms ?? "-"} ms</span>
                    <span>
                      Token：{chatTestResult.prompt_tokens ?? "-"} / {chatTestResult.completion_tokens ?? "-"} / {chatTestResult.total_tokens ?? "-"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--gray-11)]">
                    模型：{chatTestResult.provider} / {chatTestResult.provider_model}
                  </div>
                  {chatTestResult.error_message ? (
                    <AntAlert
                      type="error"
                      showIcon
                      message="对话测试失败"
                      description={<pre className="whitespace-pre-wrap text-xs leading-5">{chatTestResult.error_message}</pre>}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-md bg-black/30 p-3 text-xs leading-6">{chatTestResult.reply ?? "(空回复)"}</pre>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--gray-11)]">尚未执行对话测试。</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Root>
      )}

    </div>
  );
}

