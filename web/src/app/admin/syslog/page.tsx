"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import { Button, TextField, Table } from "@radix-ui/themes";
import type { AuditLogListResponse } from "@/types/auth";

const PAGE_SIZE = 50;

type Filters = {
  action: string;
  user_id: string;
};

const EMPTY_FILTERS: Filters = {
  action: "",
  user_id: "",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export default function AdminSyslogPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [offset, setOffset] = useState(0);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");

  const logsPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (filters.action.trim()) {
      params.set("action", filters.action.trim());
    }
    if (filters.user_id.trim()) {
      params.set("user_id", filters.user_id.trim());
    }
    return `/api/v1/admin/audit-logs?${params.toString()}`;
  }, [filters.action, filters.user_id, offset]);

  const loadLogs = useCallback(async () => {
    const response = await fetchWithAuth(logsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as AuditLogListResponse;
  }, [fetchWithAuth, logsPath]);

  const logsQuery = useQuery({
    queryKey: [logsPath],
    queryFn: loadLogs,
    enabled: !!user && canRead,
  });

  useTopicSubscription(
    "admin.audit_logs",
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: [logsPath] });
    }, [logsPath, queryClient]),
  );

  if (initializing || logsQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading audit logs...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问系统日志页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">
          返回首页
        </Link>
      </main>
    );
  }

  const logs = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const error = logsQuery.error instanceof Error ? logsQuery.error.message : "";
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      {error && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">系统日志</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">查看鉴权与会话类审计日志，支持按动作和用户筛选。</p>
          </div>
          <div className="text-xs text-[var(--gray-11)]">常见动作：auth.login / auth.logout / auth.refresh</div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <TextField.Root
            className="w-full"
            placeholder="按动作筛选（如 auth.login）"
            value={draftFilters.action}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDraftFilters((prev) => ({ ...prev, action: event.currentTarget.value }))
            }
          />
          <TextField.Root
            className="w-full"
            placeholder="按用户ID筛选（如 openclaw）"
            value={draftFilters.user_id}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDraftFilters((prev) => ({ ...prev, user_id: event.currentTarget.value }))
            }
          />
          <Button
            type="button"
            onClick={() => {
              setOffset(0);
              setFilters({
                action: draftFilters.action.trim(),
                user_id: draftFilters.user_id.trim(),
              });
            }}
          >
            查询
          </Button>
          <Button
            type="button"
            variant="soft"
            onClick={() => {
              setOffset(0);
              setDraftFilters(EMPTY_FILTERS);
              setFilters(EMPTY_FILTERS);
            }}
          >
            重置
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--gray-11)]">
            共 {total} 条，当前第 {Math.floor(offset / PAGE_SIZE) + 1} 页
          </p>
          <div className="flex items-center gap-2">
            {logsQuery.isFetching && <span className="text-xs text-[var(--gray-11)]">刷新中...</span>}
            <Button
              type="button"
              variant="soft"
              disabled={!hasPrev || logsQuery.isFetching}
              onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="soft"
              disabled={!hasNext || logsQuery.isFetching}
              onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            >
              下一页
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">时间</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">用户</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">动作</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">详情</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {logs.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={4} className="px-4 py-6 text-center text-sm text-[var(--gray-11)]">
                    暂无日志数据
                  </Table.Cell>
                </Table.Row>
              ) : (
                logs.map((item) => (
                  <Table.Row key={item.id}>
                    <Table.Cell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--gray-11)]">{formatDate(item.created_at)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3">
                      {item.username ?? "-"}
                      <span className="ml-2 font-mono text-xs text-[var(--gray-11)]">{item.user_id ?? "-"}</span>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.action}</Table.Cell>
                    <Table.Cell className="px-4 py-3 text-xs text-[var(--gray-11)]">{item.detail || "-"}</Table.Cell>
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
