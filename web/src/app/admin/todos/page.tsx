"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, Dialog, Select, Table, TextArea, TextField } from "@radix-ui/themes";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  TodoListResponse,
  TodoPriority,
  TodoStatus,
  UserListResponse,
  UserPublic,
} from "@/types/auth";

const STATUS_OPTIONS: TodoStatus[] = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTIONS: TodoPriority[] = ["low", "medium", "high", "urgent"];

const STATUS_LABEL: Record<TodoStatus, string> = {
  TODO: "待开始",
  IN_PROGRESS: "进行中",
  DONE: "已完成",
};

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const ALL_STATUS_KEY = "__all_status__";
const ALL_PRIORITY_KEY = "__all_priority__";
const ALL_ASSIGNEE_KEY = "__all_assignee__";
const UNASSIGNED_KEY = "__todo_unassigned__";

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

type CreateDraft = {
  title: string;
  description: string;
  priority: TodoPriority;
  status: TodoStatus;
  assignee_user_id: string;
  due_at: string;
};

const DEFAULT_CREATE_DRAFT: CreateDraft = {
  title: "",
  description: "",
  priority: "medium",
  status: "TODO",
  assignee_user_id: "",
  due_at: "",
};

const STATUS_TRANSITIONS: Record<TodoStatus, TodoStatus[]> = {
  TODO: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["TODO", "DONE"],
  DONE: ["TODO", "IN_PROGRESS"],
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function TodoPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(DEFAULT_CREATE_DRAFT);
  const [panelError, setPanelError] = useState("");

  const canRead = hasPermission("todo.read");
  const canCreate = hasPermission("todo.create") || hasPermission("todo.manage");
  const canProcess = hasPermission("todo.process") || hasPermission("todo.manage");
  const canManage = hasPermission("todo.manage");
  const canManageUsers = hasPermission("user.manage");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.assignee_user_id) params.set("assignee_user_id", filters.assignee_user_id);
    return params.toString();
  }, [filters]);

  const todosPath = queryString ? `/api/v1/todos?${queryString}` : "/api/v1/todos";

  const loadTodos = useCallback(async () => {
    const response = await fetchWithAuth(todosPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as TodoListResponse;
  }, [fetchWithAuth, todosPath]);

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const todosQuery = useQuery({
    queryKey: [todosPath],
    queryFn: loadTodos,
    enabled: !!user && canRead,
  });

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManageUsers,
  });

  useTopicSubscription(
    "todos",
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: [todosPath] });
    }, [queryClient, todosPath]),
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createDraft.title,
          description: createDraft.description,
          status: createDraft.status,
          priority: createDraft.priority,
          assignee_user_id: createDraft.assignee_user_id || null,
          due_at: createDraft.due_at ? new Date(createDraft.due_at).toISOString() : null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setPanelError("");
      setCreateOpen(false);
      setCreateDraft(DEFAULT_CREATE_DRAFT);
      await queryClient.invalidateQueries({ queryKey: [todosPath] });
    },
    onError: (error) => {
      setPanelError(error instanceof Error ? error.message : "创建待办失败");
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ todoId, status }: { todoId: string; status: TodoStatus }) => {
      const response = await fetchWithAuth(`/api/v1/todos/${todoId}/transition`, {
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
      setPanelError("");
      await queryClient.invalidateQueries({ queryKey: [todosPath] });
    },
    onError: (error) => {
      setPanelError(error instanceof Error ? error.message : "状态流转失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (todoId: string) => {
      const response = await fetchWithAuth(`/api/v1/todos/${todoId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setPanelError("");
      await queryClient.invalidateQueries({ queryKey: [todosPath] });
    },
    onError: (error) => {
      setPanelError(error instanceof Error ? error.message : "删除待办失败");
    },
  });

  const todoError = todosQuery.error instanceof Error ? todosQuery.error.message : "";

  if (initializing || todosQuery.isLoading) {
    return <p className="text-sm text-muted">Loading todos...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问待办管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `todo.read`）。</p>
        <Link href="/" className="btn-secondary w-fit">
          返回首页
        </Link>
      </main>
    );
  }

  const users: UserPublic[] = usersQuery.data?.items ?? [];
  const items = todosQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {(todoError || panelError) && <pre className="notice notice-error">{todoError || panelError}</pre>}

      <section className="surface-card">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">待办列表</h2>
            <p className="mt-1 text-sm text-muted">支持筛选、状态流转、删除与快捷创建。</p>
          </div>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)} type="button">
              新建待办
            </Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <TextField.Root
            value={filters.keyword}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilters((prev) => ({ ...prev, keyword: event.currentTarget.value }))
            }
            placeholder="关键词"
            className="w-full"
          />

          <Select.Root
            value={filters.status || ALL_STATUS_KEY}
            onValueChange={(value: string) => {
              setFilters((prev) => ({
                ...prev,
                status: value !== ALL_STATUS_KEY ? value : "",
              }));
            }}
          >
            <Select.Trigger aria-label="状态筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_STATUS_KEY}>全部状态</Select.Item>
              {STATUS_OPTIONS.map((item) => (
                <Select.Item key={item} value={item}>
                  {STATUS_LABEL[item]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          <Select.Root
            value={filters.priority || ALL_PRIORITY_KEY}
            onValueChange={(value: string) => {
              setFilters((prev) => ({
                ...prev,
                priority: value !== ALL_PRIORITY_KEY ? value : "",
              }));
            }}
          >
            <Select.Trigger aria-label="优先级筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_PRIORITY_KEY}>全部优先级</Select.Item>
              {PRIORITY_OPTIONS.map((item) => (
                <Select.Item key={item} value={item}>
                  {PRIORITY_LABEL[item]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          <Select.Root
            value={filters.assignee_user_id || ALL_ASSIGNEE_KEY}
            onValueChange={(value: string) => {
              setFilters((prev) => ({
                ...prev,
                assignee_user_id: value !== ALL_ASSIGNEE_KEY ? value : "",
              }));
            }}
          >
            <Select.Trigger aria-label="指派人筛选" className="w-full" />
            <Select.Content>
              <Select.Item value={ALL_ASSIGNEE_KEY}>全部指派人</Select.Item>
              {users.map((item) => (
                <Select.Item key={item.id} value={item.id}>
                  {item.username}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
      </section>

      <section className="surface-card">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted">共 {todosQuery.data?.total ?? 0} 条</p>
          {todosQuery.isFetching && <p className="text-xs text-muted">刷新中...</p>}
        </div>

        <Table.Root className="w-full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>标题</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>优先级</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>指派人</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>截止时间</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>更新时间</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description || "-"}</p>
                </Table.Cell>
                <Table.Cell>{STATUS_LABEL[item.status]}</Table.Cell>
                <Table.Cell>{PRIORITY_LABEL[item.priority]}</Table.Cell>
                <Table.Cell>{item.assignee?.username ?? "-"}</Table.Cell>
                <Table.Cell>{formatDateTime(item.due_at)}</Table.Cell>
                <Table.Cell>{formatDateTime(item.updated_at)}</Table.Cell>
                <Table.Cell>
                  <div className="flex flex-wrap gap-2">
                    {canProcess &&
                      STATUS_TRANSITIONS[item.status].map((next) => (
                        <Button
                          key={next}
                          variant="soft"
                          size="1"
                          onClick={() => transitionMutation.mutate({ todoId: item.id, status: next })}
                          disabled={transitionMutation.isPending}
                          type="button"
                        >
                          {STATUS_LABEL[next]}
                        </Button>
                      ))}
                    {canManage && (
                      <Button
                        color="red"
                        variant="soft"
                        size="1"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        type="button"
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </section>

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Content className="max-w-3xl">
          <Dialog.Title>新建待办</Dialog.Title>

          <div className="grid gap-3">
            <TextField.Root
              className="w-full"
              value={createDraft.title}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setCreateDraft((prev) => ({ ...prev, title: event.currentTarget.value }))
              }
              placeholder="标题"
            />
            <TextArea
              className="w-full"
              rows={4}
              value={createDraft.description}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setCreateDraft((prev) => ({ ...prev, description: event.currentTarget.value }))
              }
              placeholder="描述"
            />

            <div className="grid gap-3 md:grid-cols-2">
              <Select.Root
                value={createDraft.status}
                onValueChange={(value: string) => {
                  if (STATUS_OPTIONS.includes(value as TodoStatus)) {
                    setCreateDraft((prev) => ({ ...prev, status: value as TodoStatus }));
                  }
                }}
              >
                <Select.Trigger aria-label="新建待办状态" className="w-full" />
                <Select.Content>
                  {STATUS_OPTIONS.map((item) => (
                    <Select.Item key={item} value={item}>
                      {STATUS_LABEL[item]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>

              <Select.Root
                value={createDraft.priority}
                onValueChange={(value: string) => {
                  if (PRIORITY_OPTIONS.includes(value as TodoPriority)) {
                    setCreateDraft((prev) => ({ ...prev, priority: value as TodoPriority }));
                  }
                }}
              >
                <Select.Trigger aria-label="新建待办优先级" className="w-full" />
                <Select.Content>
                  {PRIORITY_OPTIONS.map((item) => (
                    <Select.Item key={item} value={item}>
                      {PRIORITY_LABEL[item]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>

              <TextField.Root
                type="datetime-local"
                className="w-full"
                value={createDraft.due_at}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setCreateDraft((prev) => ({ ...prev, due_at: event.currentTarget.value }))
                }
              />

              <Select.Root
                value={createDraft.assignee_user_id || UNASSIGNED_KEY}
                onValueChange={(value: string) => {
                  setCreateDraft((prev) => ({
                    ...prev,
                    assignee_user_id: value !== UNASSIGNED_KEY ? value : "",
                  }));
                }}
              >
                <Select.Trigger aria-label="新建待办指派人" className="w-full" />
                <Select.Content>
                  <Select.Item value={UNASSIGNED_KEY}>暂不指派</Select.Item>
                  {users.map((item) => (
                    <Select.Item key={item.id} value={item.id}>
                      {item.username}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="soft" onClick={() => setCreateOpen(false)} type="button">
              取消
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createDraft.title.trim()}
              type="button"
            >
              {createMutation.isPending ? "创建中..." : "创建待办"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
