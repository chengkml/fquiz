"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { RequirementListResponse, RequirementPriority, RequirementStatus, UserListResponse, UserPublic } from "@/types/auth";

const STATUS_OPTIONS: RequirementStatus[] = [
  "PENDING_ANALYSIS",
  "PENDING_REVISION",
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];
const PRIORITY_OPTIONS: RequirementPriority[] = ["low", "medium", "high", "urgent"];

type Filters = {
  keyword: string;
  status: string;
  priority: string;
  assignee_user_id: string;
};

const DEFAULT_FILTERS: Filters = {
  keyword: "",
  status: "",
  priority: "",
  assignee_user_id: "",
};

export default function RequirementsPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const canRead = hasPermission("requirement.read");
  const canCreate = hasPermission("requirement.create") || hasPermission("requirement.manage");
  const canProcess = hasPermission("requirement.process") || hasPermission("requirement.manage");
  const canManageUsers = hasPermission("user.manage");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.assignee_user_id) params.set("assignee_user_id", filters.assignee_user_id);
    return params.toString();
  }, [filters]);

  const requirementsPath = queryString ? `/api/v1/requirements?${queryString}` : "/api/v1/requirements";

  const loadRequirements = useCallback(async () => {
    const response = await fetchWithAuth(requirementsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RequirementListResponse;
  }, [fetchWithAuth, requirementsPath]);

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const requirementsQuery = useQuery({
    queryKey: [requirementsPath],
    queryFn: loadRequirements,
    enabled: !!user && canRead,
  });

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManageUsers,
  });

  useTopicSubscription(
    "requirements",
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    }, [queryClient, requirementsPath]),
  );

  const claimMutation = useMutation({
    mutationFn: async (requirementId: string) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}/claim`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ requirementId, status }: { requirementId: string; status: RequirementStatus }) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}/transition`, {
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
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
  });

  if (initializing || requirementsQuery.isLoading) {
    return <p className="text-sm text-muted">Loading requirements...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问需求管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `requirement.read`）。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  const users: UserPublic[] = usersQuery.data?.items ?? [];
  const items = requirementsQuery.data?.items ?? [];
  const error = requirementsQuery.error instanceof Error ? requirementsQuery.error.message : "";

  return (
    <div className="space-y-6">
      {error && (
        <pre className="notice notice-error">{error}</pre>
      )}

      <section className="surface-card">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">需求列表</h2>
            <p className="mt-1 text-sm text-muted">按关键词、状态、优先级、指派人筛选当前需求。</p>
          </div>
          {canCreate && (
            <Link
              href="/admin/requirements/new"
              className="btn-primary"
            >
              新建需求
            </Link>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="关键词 / 编号"
            className="control"
          />
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="control"
          >
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            value={filters.priority}
            onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}
            className="control"
          >
            <option value="">全部优先级</option>
            {PRIORITY_OPTIONS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            value={filters.assignee_user_id}
            onChange={(event) => setFilters((prev) => ({ ...prev, assignee_user_id: event.target.value }))}
            className="control"
            disabled={!canManageUsers}
          >
            <option value="">全部指派人</option>
            {users.map((item) => (
              <option key={item.id} value={item.id}>{item.username}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="surface-card">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted">共 {requirementsQuery.data?.total ?? 0} 条</p>
          {requirementsQuery.isFetching && <p className="text-xs text-muted">刷新中...</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">编号</th>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">优先级</th>
                <th className="px-4 py-3 font-medium">项目</th>
                <th className="px-4 py-3 font-medium">指派人</th>
                <th className="px-4 py-3 font-medium">更新时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/requirements/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                      {item.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description || "-"}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{item.status}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.priority}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.project_name ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.assignee?.username ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{new Date(item.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canProcess && (
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => claimMutation.mutate(item.id)}
                          disabled={claimMutation.isPending}
                        >
                          领取
                        </button>
                      )}
                      {canProcess && item.status === "OPEN" && (
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => transitionMutation.mutate({ requirementId: item.id, status: "IN_PROGRESS" })}
                          disabled={transitionMutation.isPending}
                        >
                          开始处理
                        </button>
                      )}
                      {canProcess && item.status === "IN_PROGRESS" && (
                        <button
                          type="button"
                          className="rounded-md border border-emerald-500/30 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                          onClick={() => transitionMutation.mutate({ requirementId: item.id, status: "COMPLETED" })}
                          disabled={transitionMutation.isPending}
                        >
                          标记完成
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
