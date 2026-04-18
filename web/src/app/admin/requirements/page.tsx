"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Select, TextField, Button, Table } from "@radix-ui/themes";
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

const STATUS_LABEL: Record<RequirementStatus, string> = {
  PENDING_ANALYSIS: "待分析",
  PENDING_REVISION: "待修订",
  OPEN: "待处理",
  IN_PROGRESS: "处理中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const PRIORITY_LABEL: Record<RequirementPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

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

const ALL_STATUS_FILTER = "__all_status__";
const ALL_PRIORITY_FILTER = "__all_priority__";
const ALL_ASSIGNEE_FILTER = "__all_assignee__";

export default function RequirementsPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [actionError, setActionError] = useState("");
  const [deletingRequirementId, setDeletingRequirementId] = useState<string | null>(null);

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
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "领取需求失败");
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
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "更新需求状态失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (requirementId: string) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setActionError("");
      setDeletingRequirementId(null);
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "删除需求失败");
      setDeletingRequirementId(null);
    },
  });

  if (initializing || requirementsQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading requirements...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问需求管理页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `requirement.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  const users: UserPublic[] = usersQuery.data?.items ?? [];
  const items = requirementsQuery.data?.items ?? [];
  const queryError = requirementsQuery.error instanceof Error ? requirementsQuery.error.message : "";
  const error = queryError || actionError;

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">需求列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">按关键词、状态、优先级、指派人筛选当前需求。</p>
          </div>
          {canCreate && (
            <Button asChild>
              <Link href="/admin/requirements/new">新建需求</Link>
            </Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <TextField.Root
            value={filters.keyword}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilters((prev) => ({ ...prev, keyword: event.currentTarget.value }))
            }
            placeholder="关键词 / 编号"
            className="w-full"
          />
          <Select.Root
            value={filters.status || ALL_STATUS_FILTER}
            onValueChange={(value: string) =>
              setFilters((prev) => ({ ...prev, status: value === ALL_STATUS_FILTER ? "" : value }))
            }
          >
            <Select.Trigger aria-label="状态筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_STATUS_FILTER}>全部状态</Select.Item>
              {STATUS_OPTIONS.map((item) => (
                <Select.Item key={item} value={item}>
                  {STATUS_LABEL[item]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root
            value={filters.priority || ALL_PRIORITY_FILTER}
            onValueChange={(value: string) =>
              setFilters((prev) => ({ ...prev, priority: value === ALL_PRIORITY_FILTER ? "" : value }))
            }
          >
            <Select.Trigger aria-label="优先级筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_PRIORITY_FILTER}>全部优先级</Select.Item>
              {PRIORITY_OPTIONS.map((item) => (
                <Select.Item key={item} value={item}>
                  {PRIORITY_LABEL[item]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Select.Root
            value={filters.assignee_user_id || ALL_ASSIGNEE_FILTER}
            onValueChange={(value: string) =>
              setFilters((prev) => ({ ...prev, assignee_user_id: value === ALL_ASSIGNEE_FILTER ? "" : value }))
            }
            disabled={!canManageUsers}
          >
            <Select.Trigger aria-label="指派人筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_ASSIGNEE_FILTER}>全部指派人</Select.Item>
              {users.map((item) => (
                <Select.Item key={item.id} value={item.id}>
                  {item.username}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-[var(--gray-11)]">共 {requirementsQuery.data?.total ?? 0} 条</p>
          {requirementsQuery.isFetching && <p className="text-xs text-[var(--gray-11)]">刷新中...</p>}
        </div>

        <div className="overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">编号</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">标题</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">优先级</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">项目</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">指派人</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.code}</Table.Cell>
                  <Table.Cell className="px-4 py-3">
                    <Link href={`/admin/requirements/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                      {item.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--gray-11)]">{item.description || "-"}</p>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap px-4 py-3">{STATUS_LABEL[item.status]}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap px-4 py-3">{PRIORITY_LABEL[item.priority]}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap px-4 py-3">{item.project_name ?? "-"}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap px-4 py-3">{item.assignee?.username ?? "-"}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--gray-11)]">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                  <Table.Cell className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canProcess && (
                        <Button
                          type="button"
                          color="gray" size="1" variant="soft"
                          onClick={() => claimMutation.mutate(item.id)}
                          disabled={claimMutation.isPending || deletingRequirementId === item.id}
                        >
                          领取
                        </Button>
                      )}
                      {canProcess && item.status === "OPEN" && (
                        <Button
                          type="button"
                          color="gray" size="1" variant="soft"
                          onClick={() => transitionMutation.mutate({ requirementId: item.id, status: "IN_PROGRESS" })}
                          disabled={transitionMutation.isPending || deletingRequirementId === item.id}
                        >
                          开始处理
                        </Button>
                      )}
                      {canProcess && item.status === "IN_PROGRESS" && (
                        <Button
                          type="button"
                          color="green" size="1" variant="soft"
                          onClick={() => transitionMutation.mutate({ requirementId: item.id, status: "COMPLETED" })}
                          disabled={transitionMutation.isPending || deletingRequirementId === item.id}
                        >
                          标记完成
                        </Button>
                      )}
                      {canProcess && (
                        <Button
                          type="button"
                          color="red" size="1" variant="soft"
                          onClick={() => {
                            const confirmed = window.confirm(`确认删除需求 ${item.code}（${item.title}）？`);
                            if (!confirmed) {
                              return;
                            }
                            setDeletingRequirementId(item.id);
                            deleteMutation.mutate(item.id);
                          }}
                          disabled={deleteMutation.isPending || transitionMutation.isPending || claimMutation.isPending}
                        >
                          {deletingRequirementId === item.id ? "删除中..." : "删除"}
                        </Button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>
      </section>
    </div>
  );
}
