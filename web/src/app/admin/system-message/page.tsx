"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { SystemMessageListResponse, SystemMessageSummary } from "@/types/auth";
import { Button, Select, Table, TextArea, TextField } from "@/components/ui-antd";

type StatusFilter = "all" | "draft" | "published" | "archived";
type LevelFilter = "all" | "info" | "success" | "warning" | "error";

type FormState = {
  title: string;
  content: string;
  level: "info" | "success" | "warning" | "error";
  status: "draft" | "published" | "archived";
  start_at: string;
  end_at: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  content: "",
  level: "info",
  status: "draft",
  start_at: "",
  end_at: "",
};

function toDatetimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}

function toUtcIso(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export default function AdminSystemMessagePage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("system_message.read") || hasPermission("system_message.manage");
  const canManage = hasPermission("system_message.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (levelFilter !== "all") {
      params.set("level", levelFilter);
    }
    const qs = params.toString();
    return `/api/v1/admin/system-messages${qs ? `?${qs}` : ""}`;
  }, [keyword, statusFilter, levelFilter]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemMessageListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/system-messages"),
    });
  }, [queryClient]);

  useTopicSubscription("admin.system-messages", useCallback(() => {
    void refreshList();
  }, [refreshList]));

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startCreate = () => {
    setError("");
    setSuccess("");
    resetForm();
  };

  const startEdit = (item: SystemMessageSummary) => {
    setError("");
    setSuccess("");
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content,
      level: item.level,
      status: item.status,
      start_at: toDatetimeLocal(item.start_at),
      end_at: toDatetimeLocal(item.end_at),
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 system_message.manage 权限");
      }
      if (!form.title.trim() || !form.content.trim()) {
        throw new Error("标题和内容不能为空");
      }

      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        status: form.status,
        start_at: toUtcIso(form.start_at),
        end_at: toUtcIso(form.end_at),
      };

      if (editingId === null) {
        const response = await fetchWithAuth("/api/v1/admin/system-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created";
      }

      const response = await fetchWithAuth(`/api/v1/admin/system-messages/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "updated";
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "系统消息已创建" : "系统消息已更新");
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: SystemMessageSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/system-messages/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return item.id;
    },
    onSuccess: async (deletedId) => {
      if (editingId === deletedId) {
        resetForm();
      }
      setError("");
      setSuccess("系统消息已删除");
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
  });

  const items = listQuery.data?.items ?? [];
  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";

  if (initializing || listQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading system messages...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问系统消息页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `system_message.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || listError) && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error || listError}</pre>}
      {success && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">系统消息列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">维护系统公告消息，支持等级、有效期与发布状态。</p>
          </div>
          {canManage && (
            <Button type="button" onClick={startCreate}>新建消息</Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="text-[var(--gray-11)]">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
              placeholder="按标题/内容筛选"
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="text-[var(--gray-11)]">状态</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value: string) => setStatusFilter(value as StatusFilter)}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部</Select.Item>
                <Select.Item value="draft">草稿</Select.Item>
                <Select.Item value="published">已发布</Select.Item>
                <Select.Item value="archived">已归档</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          <label className="space-y-1 text-sm md:col-span-1">
            <span className="text-[var(--gray-11)]">等级</span>
            <Select.Root
              value={levelFilter}
              onValueChange={(value: string) => setLevelFilter(value as LevelFilter)}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部</Select.Item>
                <Select.Item value="info">信息</Select.Item>
                <Select.Item value="success">成功</Select.Item>
                <Select.Item value="warning">警告</Select.Item>
                <Select.Item value="error">错误</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">标题</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">等级</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">有效期</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-4 py-3">{item.id}</Table.Cell>
                  <Table.Cell className="px-4 py-3">
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 max-w-[420px] truncate text-xs text-[var(--gray-11)]" title={item.content}>
                      {item.content}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.level}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.status}</Table.Cell>
                  <Table.Cell className="px-4 py-3 text-xs text-[var(--gray-11)]">
                    {item.start_at ? new Date(item.start_at).toLocaleString() : "-"}
                    {" ~ "}
                    {item.end_at ? new Date(item.end_at).toLocaleString() : "-"}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-3">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button color="gray" size="1" type="button" variant="soft" onClick={() => startEdit(item)}>编辑</Button>
                        <Button
                          color="red" size="1" variant="soft"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`确认删除系统消息「${item.title}」吗？`)) {
                              return;
                            }
                            deleteMutation.mutate(item);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
              {items.length === 0 && (
                <Table.Row>
                  <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 7 : 6}>
                    未找到系统消息。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      {canManage && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{editingId === null ? "新建系统消息" : "编辑系统消息"}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span>标题</span>
              <TextField.Root
                value={form.title}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, title: event.currentTarget.value }))}
                placeholder="请输入消息标题"
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>内容</span>
              <TextArea
                value={form.content}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, content: event.currentTarget.value }))}
                rows={5}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>等级</span>
              <Select.Root
                value={form.level}
                onValueChange={(value: string) => setForm((prev) => ({ ...prev, level: value as FormState["level"] }))}
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="info">信息</Select.Item>
                  <Select.Item value="success">成功</Select.Item>
                  <Select.Item value="warning">警告</Select.Item>
                  <Select.Item value="error">错误</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>状态</span>
              <Select.Root
                value={form.status}
                onValueChange={(value: string) => setForm((prev) => ({ ...prev, status: value as FormState["status"] }))}
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="draft">草稿</Select.Item>
                  <Select.Item value="published">已发布</Select.Item>
                  <Select.Item value="archived">已归档</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>生效时间</span>
              <TextField.Root
                type="datetime-local"
                value={form.start_at}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, start_at: event.currentTarget.value }))}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>失效时间</span>
              <TextField.Root
                type="datetime-local"
                value={form.end_at}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, end_at: event.currentTarget.value }))}
                className="w-full"
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
             
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "提交中..." : editingId === null ? "创建" : "保存"}
            </Button>
            <Button color="gray" type="button" variant="soft" onClick={resetForm}>重置</Button>
          </div>
        </section>
      )}
    </div>
  );
}
