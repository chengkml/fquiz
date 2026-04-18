"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { Button, Select, Table, TextArea, TextField } from "@radix-ui/themes";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  VocabularyWordListResponse,
  VocabularyWordSummary,
} from "@/types/auth";

type StatusFilter = "all" | "enabled" | "disabled";

type FormState = {
  word: string;
  phonetic: string;
  meaning: string;
  example: string;
  status: "enabled" | "disabled";
};

const EMPTY_FORM: FormState = {
  word: "",
  phonetic: "",
  meaning: "",
  example: "",
  status: "enabled",
};

export default function AdminVocabularyPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("vocabulary.read") || hasPermission("vocabulary.manage");
  const canManage = hasPermission("vocabulary.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    const qs = params.toString();
    return `/api/v1/admin/vocabulary${qs ? `?${qs}` : ""}`;
  }, [keyword, statusFilter]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as VocabularyWordListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/vocabulary"),
    });
  }, [queryClient]);

  useTopicSubscription("admin.vocabulary", useCallback(() => {
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

  const startEdit = (item: VocabularyWordSummary) => {
    setError("");
    setSuccess("");
    setEditingId(item.id);
    setForm({
      word: item.word,
      phonetic: item.phonetic ?? "",
      meaning: item.meaning,
      example: item.example ?? "",
      status: item.status,
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 vocabulary.manage 权限");
      }
      if (!form.word.trim()) {
        throw new Error("词条不能为空");
      }

      if (editingId === null) {
        const response = await fetchWithAuth("/api/v1/admin/vocabulary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word: form.word.trim(),
            phonetic: form.phonetic.trim() || null,
            meaning: form.meaning,
            example: form.example.trim() || null,
            status: form.status,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created";
      }

      const response = await fetchWithAuth(`/api/v1/admin/vocabulary/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: form.word.trim(),
          phonetic: form.phonetic.trim() || null,
          meaning: form.meaning,
          example: form.example.trim() || null,
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
      setSuccess(mode === "created" ? "词条已创建" : "词条已更新");
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: VocabularyWordSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/vocabulary/${item.id}`, {
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
      setSuccess("词条已删除");
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
    return <p className="text-sm text-[var(--gray-11)]">Loading poetry notebook...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问诗词本页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `vocabulary.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || listError) && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error || listError}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">诗词本列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">维护诗词词条、拼音、释义与示例。</p>
          </div>
          {canManage && (
            <Button type="button" onClick={startCreate}>新建词条</Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
              placeholder="按词条 / 音标 / 释义筛选"
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
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">词条</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">音标</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">释义</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-4 py-3">{item.id}</Table.Cell>
                  <Table.Cell className="px-4 py-3 font-medium">{item.word}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.phonetic || "-"}</Table.Cell>
                  <Table.Cell className="px-4 py-3 max-w-[360px] truncate" title={item.meaning}>{item.meaning || "-"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.status === "enabled" ? "已启用" : "已禁用"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button color="gray" size="1" type="button" variant="soft" onClick={() => startEdit(item)}>编辑</Button>
                        <Button
                          color="red"
                          size="1"
                          variant="soft"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`确认删除词条 ${item.word} 吗？`)) {
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
                    未找到词条数据。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      {canManage && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">{editingId === null ? "新建词条" : "编辑词条"}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-1">
              <span>词条</span>
              <TextField.Root
                value={form.word}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, word: event.currentTarget.value }))}
                placeholder="例如：abandon"
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-1">
              <span>音标</span>
              <TextField.Root
                value={form.phonetic}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, phonetic: event.currentTarget.value }))}
                placeholder="例如：/əˈbændən/"
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>释义</span>
              <TextArea
                value={form.meaning}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, meaning: event.currentTarget.value }))}
                rows={3}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>例句</span>
              <TextArea
                value={form.example}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, example: event.currentTarget.value }))}
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
