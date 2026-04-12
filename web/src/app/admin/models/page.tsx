"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  ModelListResponse,
  ModelRegistryItem,
  ModelRouteRuleListResponse,
  ModelRouteType,
  ModelStatus,
  ModelSummaryResponse,
} from "@/types/auth";

const MODEL_STATUS_OPTIONS: ModelStatus[] = ["DRAFT", "ENABLED", "DISABLED", "DEPRECATED"];
const MODEL_STATUS_TRANSITIONS: Record<ModelStatus, ModelStatus[]> = {
  DRAFT: ["ENABLED", "DISABLED", "DEPRECATED"],
  ENABLED: ["DISABLED", "DEPRECATED"],
  DISABLED: ["ENABLED", "DEPRECATED"],
  DEPRECATED: ["DISABLED"],
};
const ROUTE_TYPE_OPTIONS: ModelRouteType[] = ["GLOBAL", "CAPABILITY", "BUSINESS", "AGENT"];
const GLOBAL_ROUTE_KEY = "__global__";

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

const EMPTY_ROUTE_FORM = {
  route_type: "GLOBAL" as ModelRouteType,
  route_key: "",
  target_model_code: "",
  priority: "100",
  enabled: true,
  note: "",
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

export default function AdminModelsPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("model.read") || hasPermission("model.manage");
  const canManage = hasPermission("model.manage");

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingModelId, setEditingModelId] = useState<number | null>(null);
  const [modelForm, setModelForm] = useState(EMPTY_MODEL_FORM);

  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [routeForm, setRouteForm] = useState(EMPTY_ROUTE_FORM);

  const modelsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    const query = params.toString();
    return query ? `/api/v1/admin/models?${query}` : "/api/v1/admin/models";
  }, [keyword, statusFilter]);
  const summaryPath = "/api/v1/admin/models/summary";
  const routesPath = "/api/v1/admin/model-routes";

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
      setEditingModelId(null);
      setModelForm(EMPTY_MODEL_FORM);
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
        setEditingModelId(null);
        setModelForm(EMPTY_MODEL_FORM);
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
    mutationFn: async (modelId: number) => {
      const response = await fetchWithAuth(`/api/v1/admin/models/${modelId}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "SMOKE", input_tokens: 16, output_tokens: 32 }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setError("");
      setSuccess("冒烟测试已执行并计入统计");
      await invalidateModelQueries(queryClient, modelsPath, summaryPath, routesPath);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "冒烟测试失败");
    },
  });

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
      setEditingRouteId(null);
      setRouteForm(EMPTY_ROUTE_FORM);
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
        setEditingRouteId(null);
        setRouteForm(EMPTY_ROUTE_FORM);
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

  const summary = summaryQuery.data;
  const models = modelsQuery.data?.items ?? [];
  const routes = routesQuery.data?.items ?? [];

  const queryError = useMemo(() => {
    for (const candidate of [summaryQuery.error, modelsQuery.error, routesQuery.error]) {
      if (candidate instanceof Error) {
        return candidate.message;
      }
    }
    return "";
  }, [modelsQuery.error, routesQuery.error, summaryQuery.error]);

  if (initializing || modelsQuery.isLoading || summaryQuery.isLoading || routesQuery.isLoading) {
    return <p className="text-sm text-muted">Loading model management...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问模型管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `model.read`）。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || queryError) && (
        <pre className="notice notice-error">{error || queryError}</pre>
      )}
      {success && (
        <pre className="notice notice-success">{success}</pre>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="surface-card">
          <p className="text-sm text-muted">模型总数</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.total_models ?? 0}</p>
          <p className="mt-2 text-xs text-muted">ENABLED: {summary?.status_counts.ENABLED ?? 0}</p>
        </div>
        <div className="surface-card">
          <p className="text-sm text-muted">路由规则</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.total_route_rules ?? 0}</p>
          <p className="mt-2 text-xs text-muted">GLOBAL: {summary?.route_type_counts.GLOBAL ?? 0}</p>
        </div>
        <div className="surface-card">
          <p className="text-sm text-muted">近 7 天用量</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.usage_7d.request_count ?? 0}</p>
          <p className="mt-2 text-xs text-muted">成功率: {formatPercent(summary?.usage_7d.success_rate ?? null)}</p>
        </div>
        <div className="surface-card">
          <p className="text-sm text-muted">健康风险</p>
          <p className="mt-2 text-3xl font-semibold">{summary?.enabled_without_healthy_check ?? 0}</p>
          <p className="mt-2 text-xs text-muted">ENABLED 且未健康</p>
        </div>
      </section>

      <section className="surface-card">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">模型列表</h2>
            <p className="mt-1 text-sm text-muted">稳定 `code` 作为引用键，`name` 仅用于展示。</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索 code/name/provider"
              className="control"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="control"
            >
              <option value="">全部状态</option>
              {MODEL_STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Provider/Model</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">密钥</th>
                <th className="px-4 py-3 font-medium">健康</th>
                <th className="px-4 py-3 font-medium">7日用量</th>
                <th className="px-4 py-3 font-medium">7日测试</th>
                <th className="px-4 py-3 font-medium">路由绑定</th>
                {canManage && <th className="px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {models.map((model) => (
                <tr key={model.id}>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{model.code}</p>
                    <p className="mt-1 text-xs text-muted">{model.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{model.provider}</p>
                    <p className="mt-1 font-mono text-xs text-muted">{model.provider_model}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{model.status}</p>
                    <p className="mt-1 text-xs text-muted">{model.capabilities.join(", ") || "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p>{model.active_key_masked ?? "-"}</p>
                    <p className="mt-1 text-muted">v{model.active_key_version ?? "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p>{model.latest_health_status ?? "-"}</p>
                    <p className="mt-1 text-muted">{model.latest_health_at ? new Date(model.latest_health_at).toLocaleString() : "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p>请求: {model.usage_7d.request_count}</p>
                    <p className="mt-1 text-muted">成功率: {formatPercent(model.usage_7d.success_rate)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p>Runs: {model.tests_7d.total_runs}</p>
                    <p className="mt-1 text-muted">通过率: {formatPercent(model.tests_7d.pass_rate)}</p>
                  </td>
                  <td className="px-4 py-3">{model.route_bindings_count}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => startEditModel(model)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => {
                            const key = window.prompt(`为 ${model.code} 输入新 API Key`);
                            if (key && key.trim()) {
                              rotateKeyMutation.mutate({ modelId: model.id, apiKey: key.trim() });
                            }
                          }}
                          disabled={rotateKeyMutation.isPending}
                        >
                          轮换密钥
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => healthCheckMutation.mutate(model.id)}
                          disabled={healthCheckMutation.isPending}
                        >
                          健康检查
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => testMutation.mutate(model.id)}
                          disabled={testMutation.isPending}
                        >
                          冒烟测试
                        </button>
                        {MODEL_STATUS_TRANSITIONS[model.status].map((nextStatus) => (
                          <button
                            key={`${model.id}:${nextStatus}`}
                            type="button"
                            className="btn-secondary btn-small"
                            onClick={() => transitionMutation.mutate({ modelId: model.id, status: nextStatus })}
                            disabled={transitionMutation.isPending}
                          >
                            {"-> "}
                            {nextStatus}
                          </button>
                        ))}
                        {model.status !== "ENABLED" && (
                          <button
                            type="button"
                            className="btn-danger btn-small"
                            onClick={() => {
                              if (window.confirm(`确认删除模型 ${model.code} 吗？`)) {
                                deleteModelMutation.mutate(model);
                              }
                            }}
                            disabled={deleteModelMutation.isPending}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <section className="surface-card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{editingModelId ? "编辑模型" : "新建模型"}</h2>
              <p className="mt-1 text-sm text-muted">创建时可设置初始密钥；编辑阶段仅维护模型元数据。</p>
            </div>
            {editingModelId && (
              <button
                type="button"
                className="btn-secondary w-fit"
                onClick={() => {
                  setEditingModelId(null);
                  setModelForm(EMPTY_MODEL_FORM);
                }}
              >
                取消编辑
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span>模型编码（稳定引用键）</span>
              <input
                value={modelForm.code}
                disabled={editingModelId !== null}
                onChange={(event) => setModelForm((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="openai.gpt-5"
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>模型名称（展示用）</span>
              <input
                value={modelForm.name}
                onChange={(event) => setModelForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="GPT-5 主模型"
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>Provider</span>
              <input
                value={modelForm.provider}
                onChange={(event) => setModelForm((prev) => ({ ...prev, provider: event.target.value }))}
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>Provider Model</span>
              <input
                value={modelForm.provider_model}
                onChange={(event) => setModelForm((prev) => ({ ...prev, provider_model: event.target.value }))}
                placeholder="gpt-5"
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>初始状态</span>
              <select
                value={modelForm.status}
                disabled={editingModelId !== null}
                onChange={(event) => setModelForm((prev) => ({ ...prev, status: event.target.value as ModelStatus }))}
                className="control w-full"
              >
                {MODEL_STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>能力标签（逗号分隔）</span>
              <input
                value={modelForm.capabilities}
                onChange={(event) => setModelForm((prev) => ({ ...prev, capabilities: event.target.value }))}
                placeholder="chat,reasoning"
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span>Base URL</span>
              <input
                value={modelForm.base_url}
                onChange={(event) => setModelForm((prev) => ({ ...prev, base_url: event.target.value }))}
                placeholder="https://api.example.com"
                className="control w-full"
              />
            </label>
            {!editingModelId && (
              <label className="space-y-2 text-sm md:col-span-2">
                <span>初始 API Key（仅创建时）</span>
                <input
                  value={modelForm.api_key}
                  onChange={(event) => setModelForm((prev) => ({ ...prev, api_key: event.target.value }))}
                  placeholder="sk-..."
                  className="control w-full"
                />
              </label>
            )}
            <label className="space-y-2 text-sm md:col-span-2">
              <span>描述</span>
              <textarea
                rows={4}
                value={modelForm.description}
                onChange={(event) => setModelForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="模型用途、限制、成本策略..."
                className="control w-full"
              />
            </label>
          </div>

          <div className="mt-4">
            <button
              type="button"
              className="btn-primary"
              disabled={saveModelMutation.isPending || !modelForm.code.trim() || !modelForm.name.trim() || !modelForm.provider_model.trim()}
              onClick={() => saveModelMutation.mutate()}
            >
              {saveModelMutation.isPending ? "提交中..." : editingModelId ? "保存模型" : "创建模型"}
            </button>
          </div>
        </section>
      )}

      <section className="surface-card">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">路由规则</h2>
          <p className="mt-1 text-sm text-muted">支持 GLOBAL / CAPABILITY / BUSINESS / AGENT 四类规则。</p>
        </div>

        <div className="overflow-x-auto">
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">目标模型 Code</th>
                <th className="px-4 py-3 font-medium">优先级</th>
                <th className="px-4 py-3 font-medium">状态</th>
                {canManage && <th className="px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {routes.map((route) => (
                <tr key={route.id}>
                  <td className="px-4 py-3">{route.route_type}</td>
                  <td className="px-4 py-3 font-mono text-xs">{route.route_key}</td>
                  <td className="px-4 py-3 font-mono text-xs">{route.target_model_code}</td>
                  <td className="px-4 py-3">{route.priority}</td>
                  <td className="px-4 py-3">{route.enabled ? "enabled" : "disabled"}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => startEditRoute(route)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-small"
                          onClick={() => {
                            if (window.confirm(`确认删除路由规则 ${route.route_type}:${route.route_key} 吗？`)) {
                              deleteRouteMutation.mutate(route.id);
                            }
                          }}
                          disabled={deleteRouteMutation.isPending}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <section className="surface-card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{editingRouteId ? "编辑路由规则" : "新建路由规则"}</h2>
              <p className="mt-1 text-sm text-muted">GLOBAL 规则的 key 固定为 {GLOBAL_ROUTE_KEY}。</p>
            </div>
            {editingRouteId && (
              <button
                type="button"
                className="btn-secondary w-fit"
                onClick={() => {
                  setEditingRouteId(null);
                  setRouteForm(EMPTY_ROUTE_FORM);
                }}
              >
                取消编辑
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span>路由类型</span>
              <select
                value={routeForm.route_type}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, route_type: event.target.value as ModelRouteType }))}
                className="control w-full"
              >
                {ROUTE_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Route Key</span>
              <input
                value={routeForm.route_type === "GLOBAL" ? GLOBAL_ROUTE_KEY : routeForm.route_key}
                disabled={routeForm.route_type === "GLOBAL"}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, route_key: event.target.value }))}
                placeholder="chat.default"
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span>目标模型 Code</span>
              <input
                value={routeForm.target_model_code}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, target_model_code: event.target.value }))}
                list="model-code-options"
                className="control w-full"
              />
              <datalist id="model-code-options">
                {activeModelCodes.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label className="space-y-2 text-sm">
              <span>优先级（越小越高）</span>
              <input
                type="number"
                value={routeForm.priority}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, priority: event.target.value }))}
                className="control w-full"
              />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span>备注</span>
              <input
                value={routeForm.note}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="例如：客服场景优先使用"
                className="control w-full"
              />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={routeForm.enabled}
                onChange={(event) => setRouteForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>启用规则</span>
            </label>
          </div>

          <div className="mt-4">
            <button
              type="button"
              className="btn-primary"
              disabled={saveRouteMutation.isPending || !routeForm.target_model_code.trim()}
              onClick={() => saveRouteMutation.mutate()}
            >
              {saveRouteMutation.isPending ? "提交中..." : editingRouteId ? "保存规则" : "创建规则"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
