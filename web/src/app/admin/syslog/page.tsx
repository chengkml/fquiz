"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Form, Input, Space, Spin, Table, Tag, Typography, type CardProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { AuditLogItem, AuditLogListResponse } from "@/types/auth";

const PAGE_SIZE = 50;
const AntCard = Card as unknown as ComponentType<CardProps>;

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

  const logs = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const error = logsQuery.error instanceof Error ? logsQuery.error.message : "";
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const columns = useMemo<ColumnsType<AuditLogItem>>(
    () => [
      {
        title: "时间",
        dataIndex: "created_at",
        key: "created_at",
        width: 220,
        render: (value: string) => (
          <Typography.Text type="secondary" className="text-xs">
            {formatDate(value)}
          </Typography.Text>
        ),
      },
      {
        title: "用户",
        key: "user",
        width: 260,
        render: (_value, record) => (
          <Space size={6}>
            <span>{record.username ?? "-"}</span>
            <Typography.Text code type="secondary">
              {record.user_id ?? "-"}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "动作",
        dataIndex: "action",
        key: "action",
        width: 220,
        render: (value: string) => <Tag>{value}</Tag>,
      },
      {
        title: "详情",
        dataIndex: "detail",
        key: "detail",
        render: (value: string | null) => (
          <Typography.Text type="secondary">{value || "-"}</Typography.Text>
        ),
      },
    ],
    [],
  );

  if (initializing || logsQuery.isLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="系统日志加载中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问系统日志页面。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <Alert type="error" showIcon message="日志加载失败" description={error} /> : null}

      <AntCard title="系统日志" extra={<Typography.Text type="secondary">常见动作：auth.login / auth.logout / auth.refresh</Typography.Text>}>
        <Typography.Paragraph type="secondary" className="!mb-4">
          查看鉴权与会话类审计日志，支持按动作和用户筛选。
        </Typography.Paragraph>

        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="动作" className="min-w-[280px]">
            <Input
              allowClear
              placeholder="按动作筛选（如 auth.login）"
              value={draftFilters.action}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  action: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="用户ID" className="min-w-[280px]">
            <Input
              allowClear
              placeholder="按用户ID筛选（如 openclaw）"
              value={draftFilters.user_id}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  user_id: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item>
            <Space size={8}>
              <Button
                type="primary"
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
                onClick={() => {
                  setOffset(0);
                  setDraftFilters(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                }}
              >
                重置筛选
              </Button>
            </Space>
          </Form.Item>
        </Form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Typography.Text type="secondary">
            共 {total} 条，当前第 {currentPage} 页
          </Typography.Text>
          {logsQuery.isFetching ? <Typography.Text type="secondary">刷新中...</Typography.Text> : null}
        </div>

        <Table<AuditLogItem>
          rowKey={(record) => String(record.id)}
          columns={columns}
          dataSource={logs}
          loading={logsQuery.isFetching}
          pagination={{
            current: currentPage,
            pageSize: PAGE_SIZE,
            total,
            onChange: (page) => setOffset((page - 1) * PAGE_SIZE),
            showSizeChanger: false,
            showQuickJumper: false,
            showTotal: (value) => `共 ${value} 条`,
          }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志数据" />,
          }}
          scroll={{ x: 980 }}
        />
      </AntCard>
    </div>
  );
}
