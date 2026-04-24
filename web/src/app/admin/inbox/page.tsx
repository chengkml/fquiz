"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Dropdown,
  Empty,
  Skeleton,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import {
  ArchiveOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type { AuditLogItem, AuditLogListResponse } from "@/types/auth";

type InboxState = {
  read: boolean;
  archived: boolean;
};

type InboxStateMap = Record<string, InboxState>;

type InboxItem = {
  id: string;
  action: string;
  title: string;
  summary: string;
  detail: string;
  created_at: string;
  username: string | null;
  user_id: string | null;
  read: boolean;
  archived: boolean;
  severity: "attention" | "info";
};

const LOGS_PATH = "/api/v1/admin/audit-logs?limit=200&offset=0";
const INBOX_STATE_STORAGE_KEY_PREFIX = "fquiz:inbox:state:";
const COMPLETED_ACTION_KEYWORDS = ["done", "complete", "completed", "success", "resolved", "approved"];

function normalizeActionLabel(action: string): string {
  if (!action.trim()) {
    return "系统通知";
  }
  return action.split(".").filter(Boolean).join(" · ");
}

function buildItemSummary(log: AuditLogItem): string {
  if (log.detail?.trim()) {
    return log.detail.trim();
  }
  const actor = log.username?.trim() || log.user_id?.trim() || "系统";
  return `${actor} 执行了 ${log.action}`;
}

function inferSeverity(log: AuditLogItem): "attention" | "info" {
  const source = `${log.action} ${log.detail ?? ""}`.toLowerCase();
  if (
    source.includes("error")
    || source.includes("failed")
    || source.includes("forbid")
    || source.includes("delete")
    || source.includes("revert")
  ) {
    return "attention";
  }
  return "info";
}

function isCompletedLike(action: string): boolean {
  const normalized = action.toLowerCase();
  return COMPLETED_ACTION_KEYWORDS.some((token) => normalized.includes(token));
}

function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "-";
  }
  const deltaMs = Date.now() - timestamp;
  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) {
    return "刚刚";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes} 分钟前`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours} 小时前`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays} 天前`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function parseInboxState(raw: string | null): InboxStateMap {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, InboxState>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const normalized: InboxStateMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      normalized[key] = {
        read: Boolean(value?.read),
        archived: Boolean(value?.archived),
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

function buildStorageKey(userId: string): string {
  return `${INBOX_STATE_STORAGE_KEY_PREFIX}${userId}`;
}

export default function AdminInboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const selectedIdInUrl = searchParams.get("id") ?? "";
  const [selectedId, setSelectedId] = useState(selectedIdInUrl);
  const [stateReady, setStateReady] = useState(false);
  const [stateMap, setStateMap] = useState<InboxStateMap>({});

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");

  const loadInboxLogs = useCallback(async () => {
    const response = await fetchWithAuth(LOGS_PATH);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as AuditLogListResponse;
  }, [fetchWithAuth]);

  const logsQuery = useQuery({
    queryKey: [LOGS_PATH, user?.id ?? ""],
    queryFn: loadInboxLogs,
    enabled: !!user && canRead,
  });

  useEffect(() => {
    setSelectedId(selectedIdInUrl);
  }, [selectedIdInUrl]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      setStateMap({});
      setStateReady(true);
      return;
    }
    const key = buildStorageKey(user.id);
    setStateMap(parseInboxState(window.localStorage.getItem(key)));
    setStateReady(true);
  }, [user]);

  useEffect(() => {
    if (!user || !stateReady || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(buildStorageKey(user.id), JSON.stringify(stateMap));
  }, [stateMap, stateReady, user]);

  const updateSelection = useCallback(
    (nextId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextId) {
        params.set("id", nextId);
      } else {
        params.delete("id");
      }
      const query = params.toString();
      router.replace(query ? `/inbox?${query}` : "/inbox", { scroll: false });
      setSelectedId(nextId);
    },
    [router, searchParams],
  );

  const updateStateMap = useCallback((itemIds: string[], patch: Partial<InboxState>) => {
    if (itemIds.length === 0) {
      return;
    }
    setStateMap((prev) => {
      const next: InboxStateMap = { ...prev };
      for (const id of itemIds) {
        const current = next[id] ?? { read: false, archived: false };
        next[id] = {
          read: patch.read ?? current.read,
          archived: patch.archived ?? current.archived,
        };
      }
      return next;
    });
  }, []);

  const items = useMemo<InboxItem[]>(() => {
    const logs = logsQuery.data?.items ?? [];
    return logs
      .map((log) => {
        const id = String(log.id);
        const state = stateMap[id] ?? { read: false, archived: false };
        const summary = buildItemSummary(log);
        return {
          id,
          action: log.action,
          title: normalizeActionLabel(log.action),
          summary,
          detail: log.detail?.trim() || summary,
          created_at: log.created_at,
          username: log.username,
          user_id: log.user_id,
          read: state.read,
          archived: state.archived,
          severity: inferSeverity(log),
        };
      })
      .sort((a, b) => {
        const tsA = new Date(a.created_at).getTime();
        const tsB = new Date(b.created_at).getTime();
        return tsB - tsA;
      });
  }, [logsQuery.data?.items, stateMap]);

  const activeItems = useMemo(() => items.filter((item) => !item.archived), [items]);
  const unreadCount = useMemo(
    () => activeItems.filter((item) => !item.read).length,
    [activeItems],
  );
  const selectedItem = useMemo(
    () => activeItems.find((item) => item.id === selectedId) ?? null,
    [activeItems, selectedId],
  );

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (activeItems.some((item) => item.id === selectedId)) {
      return;
    }
    updateSelection("");
  }, [activeItems, selectedId, updateSelection]);

  const onSelectItem = useCallback(
    (item: InboxItem) => {
      updateSelection(item.id);
      if (!item.read) {
        updateStateMap([item.id], { read: true });
      }
    },
    [updateSelection, updateStateMap],
  );

  const onArchiveItem = useCallback(
    (item: InboxItem) => {
      updateStateMap([item.id], { archived: true });
      if (selectedId === item.id) {
        updateSelection("");
      }
    },
    [selectedId, updateSelection, updateStateMap],
  );

  const onMarkAllRead = useCallback(() => {
    updateStateMap(
      activeItems.filter((item) => !item.read).map((item) => item.id),
      { read: true },
    );
  }, [activeItems, updateStateMap]);

  const onArchiveAll = useCallback(() => {
    updateStateMap(
      activeItems.map((item) => item.id),
      { archived: true },
    );
    updateSelection("");
  }, [activeItems, updateSelection, updateStateMap]);

  const onArchiveAllRead = useCallback(() => {
    const targetIds = activeItems.filter((item) => item.read).map((item) => item.id);
    updateStateMap(targetIds, { archived: true });
    if (selectedId && targetIds.includes(selectedId)) {
      updateSelection("");
    }
  }, [activeItems, selectedId, updateSelection, updateStateMap]);

  const onArchiveCompleted = useCallback(() => {
    const targetIds = activeItems
      .filter((item) => isCompletedLike(item.action))
      .map((item) => item.id);
    updateStateMap(targetIds, { archived: true });
    if (selectedId && targetIds.includes(selectedId)) {
      updateSelection("");
    }
  }, [activeItems, selectedId, updateSelection, updateStateMap]);

  const actionMenuItems = useMemo<NonNullable<MenuProps["items"]>>(
    () => [
      { key: "mark-all-read", icon: <CheckCircleOutlined />, label: "全部标记已读" },
      { type: "divider" },
      { key: "archive-all", icon: <ArchiveOutlined />, label: "全部归档" },
      { key: "archive-all-read", icon: <ArchiveOutlined />, label: "归档全部已读" },
      { key: "archive-completed", icon: <ArchiveOutlined />, label: "归档已完成项" },
    ],
    [],
  );

  const onActionMenuClick = useCallback(
    ({ key }: Parameters<NonNullable<MenuProps["onClick"]>>[0]) => {
      if (key === "mark-all-read") {
        onMarkAllRead();
        return;
      }
      if (key === "archive-all") {
        onArchiveAll();
        return;
      }
      if (key === "archive-all-read") {
        onArchiveAllRead();
        return;
      }
      if (key === "archive-completed") {
        onArchiveCompleted();
      }
    },
    [onArchiveAll, onArchiveAllRead, onArchiveCompleted, onMarkAllRead],
  );

  const error = logsQuery.error instanceof Error ? logsQuery.error.message : "";

  if (initializing || !stateReady || logsQuery.isLoading) {
    return (
      <Card>
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">加载 Inbox 中...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Alert type="info" showIcon message="请先登录后访问 Inbox 页面。" />
          <Button href="/">返回首页</Button>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Alert type="error" showIcon message="你没有访问该页面的权限（需要 `menu.read`）。" />
          <Button href="/">返回首页</Button>
        </Space>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <Alert type="error" showIcon message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card
          title={(
            <Space size={8}>
              <InboxOutlined />
              <span>Inbox</span>
              <Badge
                count={unreadCount}
                size="small"
                style={{ backgroundColor: unreadCount > 0 ? "var(--ant-color-primary)" : "#d9d9d9" }}
              />
            </Space>
          )}
          extra={(
            <Dropdown menu={{ items: actionMenuItems, onClick: onActionMenuClick }} trigger={["click"]}>
              <Button size="small" icon={<MoreOutlined />} aria-label="Inbox 操作" />
            </Dropdown>
          )}
          className="h-full"
        >
          {logsQuery.isFetching ? (
            <div className="mb-3">
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </div>
          ) : null}

          {activeItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
          ) : (
            <div className="space-y-2">
              {activeItems.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                      selected
                        ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg)]"
                        : "border-[var(--ant-color-border-secondary)] hover:bg-[var(--gray-a3)]"
                    }`}
                    onClick={() => onSelectItem(item)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {!item.read ? (
                            <span className="h-2 w-2 rounded-full bg-[var(--ant-color-primary)]" aria-hidden />
                          ) : null}
                          <Typography.Text
                            strong={!item.read}
                            className="!mb-0 block truncate"
                          >
                            {item.title}
                          </Typography.Text>
                          {item.severity === "attention" ? <Tag color="red">重要</Tag> : null}
                        </div>
                      </div>

                      <Space size={2}>
                        <Typography.Text type="secondary" className="!text-xs">
                          {timeAgo(item.created_at)}
                        </Typography.Text>
                        <Tooltip title="归档">
                          <Button
                            size="small"
                            type="text"
                            icon={<ArchiveOutlined />}
                            onClick={(event) => {
                              event.stopPropagation();
                              onArchiveItem(item);
                            }}
                          />
                        </Tooltip>
                      </Space>
                    </div>

                    <Typography.Paragraph
                      ellipsis={{ rows: 1 }}
                      className="!mb-0 !mt-1 !text-xs text-[var(--ant-color-text-secondary)]"
                    >
                      {item.summary}
                    </Typography.Paragraph>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="通知详情" className="h-full">
          {selectedItem ? (
            <Space direction="vertical" size={14} className="w-full">
              <div className="flex flex-wrap items-center gap-2">
                <Typography.Title level={4} className="!mb-0">
                  {selectedItem.title}
                </Typography.Title>
                <Tag>{selectedItem.action}</Tag>
                {selectedItem.severity === "attention" ? <Tag color="red">attention</Tag> : <Tag color="blue">info</Tag>}
              </div>

              <Space split={<span className="text-[var(--gray-10)]">|</span>} wrap>
                <Typography.Text type="secondary">
                  时间：{formatDateTime(selectedItem.created_at)}
                </Typography.Text>
                <Typography.Text type="secondary">
                  操作人：{selectedItem.username || selectedItem.user_id || "系统"}
                </Typography.Text>
              </Space>

              <div className="rounded-md border border-[var(--ant-color-border-secondary)] bg-[var(--gray-2)] p-3">
                <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                  {selectedItem.detail}
                </Typography.Paragraph>
              </div>

              <Space>
                <Button
                  icon={<ArchiveOutlined />}
                  onClick={() => onArchiveItem(selectedItem)}
                >
                  归档
                </Button>
                {!selectedItem.read ? (
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={() => updateStateMap([selectedItem.id], { read: true })}
                  >
                    标记已读
                  </Button>
                ) : null}
              </Space>
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧通知查看详情" />
          )}
        </Card>
      </div>
    </div>
  );
}
