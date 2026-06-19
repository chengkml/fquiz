"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Empty, Form, Input, Row, Space, Spin, Table, Tag, Typography, type CardProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CSSProperties, ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { AuditLogItem, AuditLogListResponse } from "@/types/auth";

const PAGE_SIZE = 50;
const SYSLOG_TABLE_MIN_SCROLL_Y = 180;
const SYSLOG_TABLE_VIEWPORT_GAP = 40;
const SYSLOG_TABLE_FALLBACK_RESERVE = 220;
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
  const isMobile = useMobileDetection();

  const [offset, setOffset] = useState(0);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [tableScrollY, setTableScrollY] = useState(SYSLOG_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const viewMode: "table" | "card" = isMobile ? "card" : "table";
  const [cardViewPage, setCardViewPage] = useState(1);
  const [allLoadedLogs, setAllLoadedLogs] = useState<AuditLogItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageCardRef = useRef<HTMLDivElement | null>(null);
  const actionDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userIdDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");

  const handleActionChange = (value: string) => {
    setDraftFilters((prev) => ({ ...prev, action: value }));

    if (actionDebounceTimeoutRef.current) {
      clearTimeout(actionDebounceTimeoutRef.current);
    }

    actionDebounceTimeoutRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, action: value.trim() }));
      setOffset(0);
      setCardViewPage(1);
      setAllLoadedLogs([]);
    }, 500);
  };

  const handleUserIdChange = (value: string) => {
    setDraftFilters((prev) => ({ ...prev, user_id: value }));

    if (userIdDebounceTimeoutRef.current) {
      clearTimeout(userIdDebounceTimeoutRef.current);
    }

    userIdDebounceTimeoutRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, user_id: value.trim() }));
      setOffset(0);
      setCardViewPage(1);
      setAllLoadedLogs([]);
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (actionDebounceTimeoutRef.current) {
        clearTimeout(actionDebounceTimeoutRef.current);
      }
      if (userIdDebounceTimeoutRef.current) {
        clearTimeout(userIdDebounceTimeoutRef.current);
      }
    };
  }, []);

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

  // Update allLoadedLogs when logs data changes in card view
  useEffect(() => {
    if (viewMode === "card" && !logsQuery.isLoading) {
      if (cardViewPage === 1) {
        setAllLoadedLogs(logs);
      } else {
        setAllLoadedLogs((prev) => {
          if (logs.length === 0) {
            return prev;
          }
          const existingIds = new Set(prev.map(l => l.id));
          const newLogs = logs.filter(l => !existingIds.has(l.id));
          return [...prev, ...newLogs];
        });
      }
      setIsLoadingMore(false);
    }
  }, [logs, logsQuery.isLoading, viewMode, cardViewPage]);

  // Handle infinite scroll for card view
  useEffect(() => {
    if (viewMode !== "card") return;

    const pageCard = pageCardRef.current;
    if (!pageCard) return;

    const cardBody = pageCard.querySelector<HTMLElement>(".ant-card-body");
    if (!cardBody) return;

    const handleScroll = () => {
      if (isLoadingMore || logsQuery.isLoading) return;

      const scrollTop = cardBody.scrollTop;
      const scrollHeight = cardBody.scrollHeight;
      const clientHeight = cardBody.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100) {
        const loadedCount = allLoadedLogs.length;

        if (loadedCount < total) {
          setIsLoadingMore(true);
          setCardViewPage((prev) => prev + 1);
          setOffset((prev) => prev + PAGE_SIZE);
        }
      }
    };

    cardBody.addEventListener("scroll", handleScroll);
    return () => cardBody.removeEventListener("scroll", handleScroll);
  }, [viewMode, isLoadingMore, logsQuery.isLoading, total, allLoadedLogs.length]);

  // Reset card view state when filters change
  useEffect(() => {
    setCardViewPage(1);
    setAllLoadedLogs([]);
  }, [filters.action, filters.user_id]);

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

  const updateTableScrollY = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const anchorTop = anchor.getBoundingClientRect().top;
    const tableWrapper = anchor.querySelector<HTMLElement>(".ant-table-wrapper");
    const tableBody = anchor.querySelector<HTMLElement>(".ant-table-body");

    let nextHeight = Math.floor(window.innerHeight - anchorTop - SYSLOG_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? SYSLOG_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - SYSLOG_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(SYSLOG_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    updateTableScrollY();
  }, [error, logs.length, logsQuery.isFetching, total, updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updateTableScrollY);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateTableScrollY);
    });
    resizeObserver.observe(anchor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateTableScrollY]);

  const renderLogCard = (log: AuditLogItem) => (
    <AntCard
      key={log.id}
      className="admin-syslog-log-card"
      size="small"
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <div className="admin-syslog-log-card-field">
          <Typography.Text type="secondary">时间</Typography.Text>
          <Typography.Text className="text-xs">
            {formatDate(log.created_at)}
          </Typography.Text>
        </div>
        <div className="admin-syslog-log-card-field">
          <Typography.Text type="secondary">用户</Typography.Text>
          <Space size={6}>
            <span>{log.username ?? "-"}</span>
            <Typography.Text code type="secondary">
              {log.user_id ?? "-"}
            </Typography.Text>
          </Space>
        </div>
        <div className="admin-syslog-log-card-field">
          <Typography.Text type="secondary">动作</Typography.Text>
          <Tag>{log.action}</Tag>
        </div>
        {log.detail && (
          <div className="admin-syslog-log-card-field">
            <Typography.Text type="secondary">详情</Typography.Text>
            <Typography.Text type="secondary">{log.detail}</Typography.Text>
          </div>
        )}
      </Space>
    </AntCard>
  );

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
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
    <div className="flex flex-1 flex-col space-y-6">
      {error ? <Alert type="error" showIcon message="日志加载失败" description={error} /> : null}

      <AntCard ref={pageCardRef} title="系统日志" style={{ height: '100%' }}>
        {viewMode === "card" ? (
          <Form layout="vertical" style={{ marginBottom: 16 }}>
            <Form.Item label="动作">
              <Input
                allowClear
                placeholder="按动作筛选（如 auth.login）"
                value={draftFilters.action}
                onChange={(event) => handleActionChange(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="用户ID">
              <Input
                allowClear
                placeholder="按用户ID筛选（如 openclaw）"
                value={draftFilters.user_id}
                onChange={(event) => handleUserIdChange(event.target.value)}
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
        ) : (
          <Form layout="inline" style={{ rowGap: 12 }}>
            <Form.Item label="动作" className="min-w-[280px]">
              <Input
                allowClear
                placeholder="按动作筛选（如 auth.login）"
                value={draftFilters.action}
                onChange={(event) => handleActionChange(event.target.value)}
              />
            </Form.Item>
            <Form.Item label="用户ID" className="min-w-[280px]">
              <Input
                allowClear
                placeholder="按用户ID筛选（如 openclaw）"
                value={draftFilters.user_id}
                onChange={(event) => handleUserIdChange(event.target.value)}
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
        )}

        {viewMode === "table" ? (
          <div
            ref={tableScrollAnchorRef}
            className="admin-syslog-table-anchor mt-4"
            style={{ "--admin-syslog-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
          >
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
                hideOnSinglePage: false,
                style: { marginBottom: 0 },
              }}
              locale={{
                emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志数据" />,
              }}
              scroll={{ x: 980, y: tableScrollY }}
            />
          </div>
        ) : (
          <div className="admin-syslog-card-view">
            {logsQuery.isLoading && allLoadedLogs.length === 0 ? (
              <div className="admin-syslog-card-view-state">
                <Spin tip="加载中..." />
              </div>
            ) : allLoadedLogs.length === 0 ? (
              <div className="admin-syslog-card-view-state">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无日志数据"
                />
              </div>
            ) : (
              <div className="admin-syslog-card-view-content">
                <Row gutter={[12, 12]}>
                  {allLoadedLogs.map((log) => (
                    <Col key={log.id} xs={24} sm={24} md={12} lg={8} xl={6}>
                      {renderLogCard(log)}
                    </Col>
                  ))}
                </Row>
                {isLoadingMore && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin tip="加载更多..." />
                  </div>
                )}
                {allLoadedLogs.length >= total && allLoadedLogs.length > 0 && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Typography.Text type="secondary">
                      已加载全部 {allLoadedLogs.length} 条数据
                    </Typography.Text>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </AntCard>
    </div>
  );
}
