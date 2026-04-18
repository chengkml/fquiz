"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Table, TextField } from "@radix-ui/themes";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  QuestionTagListResponse,
  QuestionTagMutationResponse,
  QuestionTagSummary,
} from "@/types/auth";

export default function AdminTagPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sourceTag, setSourceTag] = useState("");
  const [targetTag, setTargetTag] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const tagsPath = useMemo(() => {
    const params = new URLSearchParams();
    const normalized = keyword.trim();
    if (normalized) {
      params.set("keyword", normalized);
    }
    const query = params.toString();
    return `/api/v1/admin/question-bank/tags${query ? `?${query}` : ""}`;
  }, [keyword]);

  const loadTags = useQuery({
    queryKey: [tagsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(tagsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as QuestionTagListResponse;
    },
  });

  const refreshTags = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/question-bank/tags"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.question_bank",
    useCallback(() => {
      void refreshTags();
    }, [refreshTags]),
  );

  const renameMutation = useMutation({
    mutationFn: async (payload: { old_tag: string; new_tag: string }) => {
      const response = await fetchWithAuth("/api/v1/admin/question-bank/tags/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as QuestionTagMutationResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setSuccess(`分组已重命名，影响题目数：${payload.affected_questions}`);
      setRenameDialogOpen(false);
      setTargetTag("");
      await refreshTags();
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey)
          && typeof query.queryKey[0] === "string"
          && query.queryKey[0].startsWith("/api/v1/admin/question-bank"),
      });
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "分组重命名失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (tag: QuestionTagSummary) => {
      const response = await fetchWithAuth("/api/v1/admin/question-bank/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tag.name }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return { tag: tag.name, ...(await response.json() as QuestionTagMutationResponse) };
    },
    onSuccess: async (payload) => {
      setError("");
      setSuccess(`分组 ${payload.tag} 已删除，影响题目数：${payload.affected_questions}`);
      await refreshTags();
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey)
          && typeof query.queryKey[0] === "string"
          && query.queryKey[0].startsWith("/api/v1/admin/question-bank"),
      });
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "分组删除失败");
    },
  });

  const openRenameDialog = (tag: QuestionTagSummary) => {
    setError("");
    setSuccess("");
    setSourceTag(tag.name);
    setTargetTag(tag.name);
    setRenameDialogOpen(true);
  };

  const submitRename = () => {
    const oldTag = sourceTag.trim();
    const newTag = targetTag.trim();
    if (!oldTag || !newTag) {
      setError("分组名不能为空");
      return;
    }
    renameMutation.mutate({ old_tag: oldTag, new_tag: newTag });
  };

  const removeTag = (tag: QuestionTagSummary) => {
    if (!window.confirm(`确认删除分组「${tag.name}」吗？将从 ${tag.count} 道题中移除。`)) {
      return;
    }
    deleteMutation.mutate(tag);
  };

  const items = loadTags.data?.items ?? [];
  const queryError = loadTags.error instanceof Error ? loadTags.error.message : "";

  if (initializing || loadTags.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading group manager...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问分组管理页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `question_bank.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || queryError) && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error || queryError}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">分组管理</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">迁移 quiz group 菜单能力：分组检索、重命名、解除关联。</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <TextField.Root
            value={keyword}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
            placeholder="按分组关键词筛选"
            className="w-full md:col-span-2"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">分组</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">关联题目数</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((tag) => (
                <Table.Row key={tag.name}>
                  <Table.Cell className="px-4 py-3">{tag.name}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{tag.count}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          color="gray"
                          size="1"
                          variant="soft"
                          onClick={() => openRenameDialog(tag)}
                          disabled={renameMutation.isPending || deleteMutation.isPending}
                        >
                          重命名
                        </Button>
                        <Button
                          color="red"
                          size="1"
                          variant="soft"
                          onClick={() => removeTag(tag)}
                          disabled={renameMutation.isPending || deleteMutation.isPending}
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
                  <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 3 : 2}>
                    暂无分组数据。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <Dialog.Root open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <Dialog.Content maxWidth="540px">
          <Dialog.Title>重命名分组</Dialog.Title>
          <Dialog.Description size="2" className="text-[var(--gray-11)]">
            原分组会批量替换为新分组，并自动去重。
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="space-y-1 text-sm block">
              <span>原分组</span>
              <TextField.Root value={sourceTag} disabled className="w-full" />
            </label>

            <label className="space-y-1 text-sm block">
              <span>新分组</span>
              <TextField.Root
                value={targetTag}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setTargetTag(event.currentTarget.value)}
                className="w-full"
                placeholder="请输入新分组名"
              />
            </label>
          </div>

          <div className="mt-6 flex gap-2">
            <Button onClick={submitRename} disabled={renameMutation.isPending}>
              {renameMutation.isPending ? "提交中..." : "确认重命名"}
            </Button>
            <Button color="gray" variant="soft" onClick={() => setRenameDialogOpen(false)}>
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
