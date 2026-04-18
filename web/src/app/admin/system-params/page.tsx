"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { SystemParamListResponse, SystemParamSummary } from "@/types/auth";
import { Button, Select, Table, TextArea, TextField } from "@radix-ui/themes";

type StatusFilter = "all" | "enabled" | "disabled";

type FormState = {
  param_key: string;
  param_name: string;
  param_value: string;
  description: string;
  status: "enabled" | "disabled";
};

const EMPTY_FORM: FormState = {
  param_key: "",
  param_name: "",
  param_value: "",
  description: "",
  status: "enabled",
};

export default function AdminSystemParamsPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("system_param.read") || hasPermission("system_param.manage");
  const canManage = hasPermission("system_param.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    const qs = params.toString();
    return `/api/v1/admin/system-params${qs ? `?${qs}` : ""}`;
  }, [keyword, statusFilter]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemParamListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/system-params"),
    });
  }, [queryClient]);

  useTopicSubscription("admin.system-params", useCallback(() => {
    void refreshList();
  }, [refreshList]));

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startCreate = () => {
    setError("");
    setSuccess("");
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (item: SystemParamSummary) => {
    setError("");
    setSuccess("");
    setEditingId(item.id);
    setForm({
      param_key: item.param_key,
      param_name: item.param_name,
      param_value: item.param_value,
      description: item.description ?? "",
      status: item.status,
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 system_param.manage 权限");
      }
      if (!form.param_name.trim() || !form.param_key.trim()) {
        throw new Error("参数键和参数名称不能为空");
      }

      if (editingId === null) {
        const response = await fetchWithAuth("/api/v1/admin/system-params", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            param_key: form.param_key.trim(),
            param_name: form.param_name.trim(),
            param_value: form.param_value,
            description: form.description,
            status: form.status,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created";
      }

      const response = await fetchWithAuth(`/api/v1/admin/system-params/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          param_name: form.param_name.trim(),
          param_value: form.param_value,
          description: form.description,
          status: form.status,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "updated";
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "系统参数已创建" : "系统参数已更新");
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: SystemParamSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/system-params/${item.id}`, {
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
      setSuccess("系统参数已删除");
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
    return <p className="text-sm text-[var(--gray-11)]">Loading system params...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问系统参数页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `system_param.read`）。</p>
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
            <h2 className="text-lg font-semibold">系统参数列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">维护系统级参数键值、状态与说明。</p>
          </div>
          {canManage && (
            <Button type="button" onClick={startCreate}>新建参数</Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
              placeholder="按参数键 / 名称 / 值筛选"
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">状态</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value: string) => setStatusFilter(value as StatusFilter)}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部</Select.Item>
                <Select.Item value="enabled">已启用</Select.Item>
                <Select.Item value="disabled">已禁用</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">参数键</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">参数名称</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">参数值</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-4 py-3">{item.id}</Table.Cell>
                  <Table.Cell className="px-4 py-3 font-mono text-xs">{item.param_key}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.param_name}</Table.Cell>
                  <Table.Cell className="px-4 py-3 max-w-[360px] truncate" title={item.param_value}>{item.param_value || "-"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.status === "enabled" ? "已启用" : "已禁用"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button color="gray" size="1" type="button" variant="soft" onClick={() => startEdit(item)}>编辑</Button>
                        <Button
                          color="red" size="1" variant="soft"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`确认删除系统参数 ${item.param_key} 吗？`)) {
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
                    未找到系统参数。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      {canManage && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{editingId === null ? "新建系统参数" : "编辑系统参数"}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-1">
              <span>参数键</span>
              <TextField.Root
                value={form.param_key}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, param_key: event.currentTarget.value }))}
                disabled={editingId !== null}
                placeholder="如 site.title"
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>参数名称</span>
              <TextField.Root
                value={form.param_name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, param_name: event.currentTarget.value }))}
                placeholder="如 站点标题"
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>参数值</span>
              <TextArea
                value={form.param_value}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, param_value: event.currentTarget.value }))}
                rows={4}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>说明</span>
              <TextArea
                value={form.description}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, description: event.currentTarget.value }))}
                rows={3}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>状态</span>
              <Select.Root
                value={form.status}
                onValueChange={(value: string) => setForm((prev) => ({ ...prev, status: value as "enabled" | "disabled" }))}
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="enabled">已启用</Select.Item>
                  <Select.Item value="disabled">已禁用</Select.Item>
                </Select.Content>
              </Select.Root>
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
