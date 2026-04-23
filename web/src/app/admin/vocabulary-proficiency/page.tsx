"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Button, Table } from "@/components/ui-antd";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { VocabularyWordStatsResponse } from "@/types/auth";

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export default function AdminVocabularyProficiencyPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission("vocabulary.read") || hasPermission("vocabulary.manage");
  const statsPath = "/api/v1/admin/vocabulary/stats";

  const statsQuery = useQuery({
    queryKey: [statsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(statsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as VocabularyWordStatsResponse;
    },
  });

  const refreshStats = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [statsPath] });
  }, [queryClient]);

  useTopicSubscription("admin.vocabulary", useCallback(() => {
    void refreshStats();
  }, [refreshStats]));

  if (initializing || statsQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading vocabulary proficiency...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问单词统计页面。</p>
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

  const data = statsQuery.data;
  const error = statsQuery.error instanceof Error ? statsQuery.error.message : "";

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">单词统计</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">统计词条规模、状态分布、首字母分布与最近更新情况。</p>
          </div>
          <Button asChild color="gray" variant="soft">
            <Link href="/admin/poetry">进入诗词本</Link>
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">词条总数</p>
            <p className="mt-1 text-xl font-semibold">{data?.summary.total_words ?? 0}</p>
          </article>
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">启用词条</p>
            <p className="mt-1 text-xl font-semibold">{data?.summary.enabled_words ?? 0}</p>
          </article>
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">禁用词条</p>
            <p className="mt-1 text-xl font-semibold">{data?.summary.disabled_words ?? 0}</p>
          </article>
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">启用占比</p>
            <p className="mt-1 text-xl font-semibold">{formatPercent(data?.summary.enabled_rate)}</p>
          </article>
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">缺少音标</p>
            <p className="mt-1 text-xl font-semibold">{data?.summary.missing_phonetic_words ?? 0}</p>
          </article>
          <article className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-3">
            <p className="text-xs text-[var(--gray-11)]">缺少例句</p>
            <p className="mt-1 text-xl font-semibold">{data?.summary.missing_example_words ?? 0}</p>
          </article>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h3 className="text-base font-semibold">状态分布</h3>
          <div className="mt-3 overflow-x-auto">
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header className="bg-[var(--gray-a3)]">
                <Table.Row>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">数量</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body className="divide-y divide-y">
                {(data?.status_buckets ?? []).map((item) => (
                  <Table.Row key={item.status}>
                    <Table.Cell className="px-4 py-3">{item.status}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{item.count}</Table.Cell>
                  </Table.Row>
                ))}
                {(data?.status_buckets ?? []).length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={2} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">暂无状态分布数据</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </div>
        </article>

        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h3 className="text-base font-semibold">高频首字母（Top 12）</h3>
          <div className="mt-3 overflow-x-auto">
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header className="bg-[var(--gray-a3)]">
                <Table.Row>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">首字母</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">数量</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body className="divide-y divide-y">
                {(data?.initial_buckets ?? []).map((item) => (
                  <Table.Row key={item.initial}>
                    <Table.Cell className="px-4 py-3 font-mono">{item.initial}</Table.Cell>
                    <Table.Cell className="px-4 py-3">{item.count}</Table.Cell>
                  </Table.Row>
                ))}
                {(data?.initial_buckets ?? []).length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={2} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">暂无首字母分布数据</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <h3 className="text-base font-semibold">最近更新词条</h3>
        <p className="mt-1 text-sm text-[var(--gray-11)]">按更新时间倒序展示最近 10 条，便于快速巡检。</p>
        <div className="mt-3 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">词条</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {(data?.recently_updated ?? []).map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-4 py-3">{item.id}</Table.Cell>
                  <Table.Cell className="px-4 py-3 font-medium">{item.word}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{item.status === "enabled" ? "已启用" : "已禁用"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                </Table.Row>
              ))}
              {(data?.recently_updated ?? []).length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={4} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">暂无最近更新数据</Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>
    </div>
  );
}
