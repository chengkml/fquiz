"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import { Button, Select, TextField, Table } from "@/components/ui-antd";
import type { ModelListResponse, TokenUsageOverviewResponse } from "@/types/auth";

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatCost(value: number | null | undefined): string {
  return `USD ${Number(value || 0).toFixed(4)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export default function AdminTokenUsagePage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [days, setDays] = useState<number>(7);
  const [modelCodeDraft, setModelCodeDraft] = useState("");
  const [modelCode, setModelCode] = useState("");

  const canRead = hasPermission("model.read") || hasPermission("model.manage");

  const overviewPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("days", String(days));
    if (modelCode.trim()) {
      params.set("model_code", modelCode.trim());
    }
    return `/api/v1/admin/token-usage/overview?${params.toString()}`;
  }, [days, modelCode]);

  const modelsPath = "/api/v1/admin/models";

  const overviewQuery = useQuery({
    queryKey: [overviewPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(overviewPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TokenUsageOverviewResponse;
    },
  });

  const modelsQuery = useQuery({
    queryKey: [modelsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(modelsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelListResponse;
    },
  });

  useTopicSubscription("admin.models", useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [overviewPath] });
    void queryClient.invalidateQueries({ queryKey: [modelsPath] });
  }, [modelsPath, overviewPath, queryClient]));

  if (initializing || overviewQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading token usage...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问 Token 统计页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `model.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  const overview = overviewQuery.data;
  const trend = overview?.trend ?? [];
  const topModels = overview?.top_models ?? [];
  const modelOptions = modelsQuery.data?.items ?? [];

  const error = overviewQuery.error instanceof Error
    ? overviewQuery.error.message
    : modelsQuery.error instanceof Error
      ? modelsQuery.error.message
      : "";

  return (
    <div className="space-y-6">
      {error && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Token 统计</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">按时间范围聚合模型请求、成功率、Token 用量与费用，支持按模型过滤。</p>
          </div>
          <div className="text-xs text-[var(--gray-11)]">
            统计区间：{overview?.start_date ?? "-"} ~ {overview?.end_date ?? "-"}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto_auto]">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">统计天数</span>
            <Select.Root value={String(days)} onValueChange={(value: string) => setDays(Number(value))}>
              <Select.Trigger />
              <Select.Content>
                {DAY_OPTIONS.map((option) => (
                  <Select.Item key={option} value={String(option)}>{option} 天</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">模型编码（可选）</span>
            <TextField.Root
              placeholder="例如 deepseek.chat"
              value={modelCodeDraft}
              list="token-usage-model-options"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setModelCodeDraft(event.currentTarget.value)}
            />
            <datalist id="token-usage-model-options">
              {modelOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </datalist>
          </label>

          <Button
            type="button"
            onClick={() => setModelCode(modelCodeDraft.trim())}
          >
            查询
          </Button>

          <Button
            type="button"
            variant="soft"
            onClick={() => {
              setModelCodeDraft("");
              setModelCode("");
            }}
          >
            清空模型
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-xs text-[var(--gray-11)]">请求总数</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(overview?.summary.request_count)}</p>
        </article>
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-xs text-[var(--gray-11)]">成功请求</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(overview?.summary.success_count)}</p>
        </article>
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-xs text-[var(--gray-11)]">成功率</p>
          <p className="mt-2 text-2xl font-semibold">{formatPercent(overview?.summary.success_rate)}</p>
        </article>
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-xs text-[var(--gray-11)]">Token 总量</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(overview?.summary.total_tokens)}</p>
        </article>
        <article className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <p className="text-xs text-[var(--gray-11)]">费用总计</p>
          <p className="mt-2 text-2xl font-semibold">{formatCost(overview?.summary.total_cost_usd)}</p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <h3 className="text-base font-semibold">每日趋势</h3>
        <p className="mt-1 text-sm text-[var(--gray-11)]">展示统计区间内每天的请求、成功与 Token 消耗。</p>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">日期</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">请求</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">成功</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">成功率</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Token</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">费用</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {trend.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">暂无统计数据</Table.Cell>
                </Table.Row>
              ) : (
                trend.map((item) => (
                  <Table.Row key={item.date}>
                    <Table.Cell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--gray-11)]">{item.date}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatNumber(item.request_count)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatNumber(item.success_count)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatPercent(item.success_rate)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatNumber(item.total_tokens)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatCost(item.total_cost_usd)}</Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <h3 className="text-base font-semibold">Top 模型（按 Token）</h3>
        <p className="mt-1 text-sm text-[var(--gray-11)]">展示当前统计范围内 Token 消耗最高的前 10 个模型。</p>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">模型编码</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">请求</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">成功率</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">Token</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">费用</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {topModels.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={5} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">暂无模型聚合数据</Table.Cell>
                </Table.Row>
              ) : (
                topModels.map((item) => (
                  <Table.Row key={item.model_code}>
                    <Table.Cell className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.model_code}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatNumber(item.request_count)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatPercent(item.success_rate)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatNumber(item.total_tokens)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">{formatCost(item.total_cost_usd)}</Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>
    </div>
  );
}
