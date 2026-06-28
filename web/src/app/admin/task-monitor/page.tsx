"use client";

import Link from "next/link";
import dayjs from "dayjs";
import type { ComponentType, RefAttributes } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  type CardProps,
  type TableColumnsType,
} from "antd";

import { useAuth } from "@/components/auth-provider";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError } from "@/lib/api";
import { getTaskDisplayName } from "@/lib/celery-task-display";
import {
  formatTaskMonitorDuration,
  formatTaskMonitorErrorMessage,
  getQueueDisplayName,
  getTaskSourceDisplay,
  getTaskStateDisplay,
} from "@/lib/task-monitor-display";

const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

const DEFAULT_RECENT_LIMIT = 100;
const TASK_MONITOR_TABLE_MIN_SCROLL_Y = 180;
const TASK_MONITOR_TABLE_VIEWPORT_GAP = 40;
const TASK_MONITOR_TABLE_FALLBACK_RESERVE = 220;

type FlowerWorkerItem = {
  worker: string;
  status: string;
  queue_names: string[];
  registered_count: number;
  processed_count: number;
  concurrency: number;
  prefetch_count: number;
  active_count: number;
  reserved_count: number;
  scheduled_count: number;
  last_heartbeat_at: string | null;
};

type FlowerWorkersOverviewResponse = {
  generated_at: string;
  workers: FlowerWorkerItem[];
  summary: {
    total: number;
    online: number;
    offline: number;
  };
};

type FlowerTaskItem = {
  task_id: string;
  name: string;
  state: string;
  source: string;
  worker: string;
  queue_name: string | null;
  args_text: string | null;
  kwargs_text: string | null;
  eta: string | null;
  received_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  runtime_seconds: number | null;
  result_text: string | null;
  exception_text: string | null;
};

type FlowerWorkerTaskOverviewResponse = {
  generated_at: string;
  worker: string;
  active_tasks: FlowerTaskItem[];
  reserved_tasks: FlowerTaskItem[];
  scheduled_tasks: FlowerTaskItem[];
  recent_tasks: FlowerTaskItem[];
  summary: {
    active: number;
    reserved: number;
    scheduled: number;
    recent: number;
  };
};

type TaskTableRow = FlowerTaskItem & {
  key: string;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return "-";
  }
  return parsed.format("YYYY-MM-DD HH:mm:ss");
}

function renderTaskStateTag(state: string) {
  const display = getTaskStateDisplay(state);
  return <Tag color={display.color}>{display.label}</Tag>;
}

function renderTaskSourceTag(source: string) {
  const display = getTaskSourceDisplay(source);
  return <Tag color={display.color}>{display.label}</Tag>;
}

function containsText(source: string | null | undefined, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  return (source || "").toLowerCase().includes(keyword.toLowerCase());
}

function toTaskRows(workerName: string, source: string, tasks: FlowerTaskItem[]): TaskTableRow[] {
  return tasks.map((item, index) => ({
    ...item,
    source: item.source || source,
    worker: item.worker || workerName,
    key: `${workerName}:${source}:${item.task_id}:${index + 1}`,
  }));
}

function parseStatusFilter(value: string | undefined): "all" | "online" | "offline" {
  if (value === "online" || value === "offline") {
    return value;
  }
  return "all";
}

export default function AdminTaskMonitorPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const isMobile = useMobileDetection();
  const canRead = hasPermission("celery.read") || hasPermission("celery.manage");

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [workerKeyword, setWorkerKeyword] = useState("");
  const [queueKeyword, setQueueKeyword] = useState("");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [tableScrollY, setTableScrollY] = useState(TASK_MONITOR_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const viewMode: "table" | "card" = isMobile ? "card" : "table";
  const [cardViewPage, setCardViewPage] = useState(1);
  const [allLoadedTasks, setAllLoadedTasks] = useState<TaskTableRow[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageCardRef = useRef<HTMLDivElement | null>(null);
  const { current: paginationCurrent, pageSize: paginationPageSize } = pagination;
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [logModalContent, setLogModalContent] = useState("");
  const [logModalTaskId, setLogModalTaskId] = useState("");
  const [logModalLoading, setLogModalLoading] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailModalTask, setDetailModalTask] = useState<TaskTableRow | null>(null);
  const [exceptionModalVisible, setExceptionModalVisible] = useState(false);
  const [exceptionModalTask, setExceptionModalTask] = useState<TaskTableRow | null>(null);

  const resetTaskListPagination = useCallback(() => {
    setPagination((prev) => ({ ...prev, current: 1 }));
    setCardViewPage(1);
    setAllLoadedTasks([]);
    setIsLoadingMore(false);
  }, []);

  const handleViewLog = async (taskId: string) => {
    setLogModalTaskId(taskId);
    setLogModalVisible(true);
    setLogModalLoading(true);
    setLogModalContent("");

    try {
      const response = await fetchWithAuth(`/api/v1/admin/task-logs/${encodeURIComponent(taskId)}`);
      if (!response.ok) {
        const errorText = await readApiError(response);
        throw new Error(errorText);
      }
      const data = await response.json();
      setLogModalContent(data.log_content || "日志内容为空");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "获取日志失败";
      setLogModalContent(`错误：${errorMessage}`);
    } finally {
      setLogModalLoading(false);
    }
  };

  const handleCloseLogModal = () => {
    setLogModalVisible(false);
    setLogModalTaskId("");
    setLogModalContent("");
  };

  const handleViewDetail = (task: TaskTableRow) => {
    setDetailModalTask(task);
    setDetailModalVisible(true);
  };

  const handleCloseDetailModal = () => {
    setDetailModalVisible(false);
    setDetailModalTask(null);
  };

  const handleViewException = (task: TaskTableRow) => {
    setExceptionModalTask(task);
    setExceptionModalVisible(true);
  };

  const handleCloseExceptionModal = () => {
    setExceptionModalVisible(false);
    setExceptionModalTask(null);
  };

  const workersOverviewQuery = useQuery({
    queryKey: ["flower-workers-overview"],
    enabled: Boolean(user) && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/flower/workers?forceRefresh=false");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FlowerWorkersOverviewResponse;
    },
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 15_000,
  });

  const workerNames = useMemo(() => (workersOverviewQuery.data?.workers || []).map((item) => item.worker), [workersOverviewQuery.data?.workers]);

  const allTasksQuery = useQuery({
    queryKey: ["flower-worker-tasks-batch", workerNames],
    enabled: Boolean(user) && canRead && workerNames.length > 0,
    queryFn: async () => {
      const settled = await Promise.all(
        workerNames.map(async (worker) => {
          const params = new URLSearchParams();
          params.set("worker", worker);
          params.set("recentLimit", String(DEFAULT_RECENT_LIMIT));
          params.set("forceRefresh", "false");
          const response = await fetchWithAuth(`/api/v1/admin/flower/worker-tasks?${params.toString()}`);
          if (!response.ok) {
            throw new Error(await readApiError(response));
          }
          return (await response.json()) as FlowerWorkerTaskOverviewResponse;
        }),
      );
      return settled;
    },
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 15_000,
  });

  const workersOverview = workersOverviewQuery.data;

  const taskColumns = useMemo<TableColumnsType<TaskTableRow>>(
    () => [
      {
        title: "任务 ID",
        dataIndex: "task_id",
        key: "task_id",
        width: 260,
        render: (value: string) => <Text copyable>{value}</Text>,
      },
      {
        title: "任务名称",
        dataIndex: "name",
        key: "name",
        width: 220,
        render: (value: string) => getTaskDisplayName(value),
      },
      {
        title: "状态",
        dataIndex: "state",
        key: "state",
        width: 110,
        render: (value: string) => renderTaskStateTag(value),
      },
      {
        title: "队列",
        dataIndex: "queue_name",
        key: "queue_name",
        width: 120,
        render: (value: string | null) => getQueueDisplayName(value),
      },
      {
        title: "执行节点",
        dataIndex: "worker",
        key: "worker",
        width: 220,
        render: (value: string) => value || "-",
      },
      {
        title: "开始时间",
        dataIndex: "started_at",
        key: "started_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "完成时间",
        dataIndex: "finished_at",
        key: "finished_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "运行时长",
        dataIndex: "runtime_seconds",
        key: "runtime_seconds",
        width: 110,
        render: (value: number | null) => formatTaskMonitorDuration(value),
      },
      {
        title: "操作",
        key: "actions",
        width: 180,
        fixed: "right",
        render: (_: unknown, record: TaskTableRow) => (
          <Space size={4}>
            <Button size="small" onClick={() => handleViewLog(record.task_id)}>
              日志
            </Button>
            <Button size="small" onClick={() => handleViewDetail(record)}>
              详情
            </Button>
            <Button size="small" onClick={() => handleViewException(record)} disabled={!record.exception_text}>
              异常
            </Button>
          </Space>
        ),
      },
    ],
    [handleViewLog],
  );

  const filteredWorkers = useMemo(() => {
    const rows = workersOverviewQuery.data?.workers || [];
    return rows.filter((item) => {
      const online = (item.status || "").toUpperCase() === "ONLINE";
      if (statusFilter === "online" && !online) {
        return false;
      }
      if (statusFilter === "offline" && online) {
        return false;
      }
      if (!containsText(item.worker, workerKeyword.trim())) {
        return false;
      }
      if (queueKeyword.trim()) {
        const text = [
          item.queue_names.join(", "),
          item.queue_names.map((queueName) => getQueueDisplayName(queueName)).join(", "),
        ].join(" ");
        if (!containsText(text, queueKeyword.trim())) {
          return false;
        }
      }
      return true;
    });
  }, [workersOverviewQuery.data?.workers, statusFilter, workerKeyword, queueKeyword]);

  const allTaskRows = useMemo(() => {
    const workerTaskOverviews = allTasksQuery.data || [];
    const rows: TaskTableRow[] = [];
    for (const overview of workerTaskOverviews) {
      rows.push(...toTaskRows(overview.worker, "ACTIVE", overview.active_tasks));
      rows.push(...toTaskRows(overview.worker, "RESERVED", overview.reserved_tasks));
      rows.push(...toTaskRows(overview.worker, "SCHEDULED", overview.scheduled_tasks));
      rows.push(...toTaskRows(overview.worker, "RECENT", overview.recent_tasks));
    }
    return rows.filter((task) =>
      task.name !== "app.tasks.worker_registry_tasks.sweep_worker_registry_offline" &&
      task.name !== "app.tasks.scheduled_task_tasks.dispatch_due_scheduled_tasks"
    );
  }, [allTasksQuery.data]);

  const filteredTaskRows = useMemo(() => {
    const workerSet = new Set(filteredWorkers.map((item) => item.worker));
    const keyword = taskKeyword.trim();
    return allTaskRows.filter((item) => {
      if (!workerSet.has(item.worker)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        item.task_id,
        item.name,
        getTaskDisplayName(item.name),
        item.queue_name || "",
        getQueueDisplayName(item.queue_name),
        item.worker,
        getTaskSourceDisplay(item.source).label,
        getTaskStateDisplay(item.state).label,
        item.args_text || "",
        item.kwargs_text || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword.toLowerCase());
    });
  }, [allTaskRows, filteredWorkers, taskKeyword]);

  const handleResetFilters = () => {
    setWorkerKeyword("");
    setQueueKeyword("");
    setTaskKeyword("");
    setStatusFilter("all");
    resetTaskListPagination();
  };

  const workersOverviewErrorMessage = workersOverviewQuery.error instanceof Error
    ? formatTaskMonitorErrorMessage(workersOverviewQuery.error.message, "任务监控数据加载失败，请稍后重试。")
    : "";
  const allTasksErrorMessage = allTasksQuery.error instanceof Error
    ? formatTaskMonitorErrorMessage(allTasksQuery.error.message, "任务列表数据加载失败，请稍后重试。")
    : "";
  const anyError = workersOverviewErrorMessage || allTasksErrorMessage;

  useToastFeedback({
    errorMessage: anyError,
  });

  useEffect(() => {
    if (viewMode !== "card" || allTasksQuery.isLoading) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const nextTasks = filteredTaskRows.slice(0, cardViewPage * paginationPageSize);

      if (cardViewPage === 1) {
        setAllLoadedTasks(() => nextTasks);
      } else {
        setAllLoadedTasks((prev) => {
          if (nextTasks.length === 0) {
            return prev;
          }
          const existingKeys = new Set(prev.map((task) => task.key));
          const newTasks = nextTasks.filter((task) => !existingKeys.has(task.key));
          return [...prev, ...newTasks];
        });
      }

      setIsLoadingMore(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [allTasksQuery.isLoading, cardViewPage, filteredTaskRows, paginationPageSize, viewMode]);

  useEffect(() => {
    if (viewMode !== "card") {
      return;
    }

    const pageCard = pageCardRef.current;
    if (!pageCard) {
      return;
    }

    const cardBody = pageCard.querySelector<HTMLElement>(".ant-card-body");
    if (!cardBody) {
      return;
    }

    const handleScroll = () => {
      if (isLoadingMore || allTasksQuery.isLoading) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = cardBody;
      if (scrollTop + clientHeight >= scrollHeight - 100) {
        const total = filteredTaskRows.length;
        const loadedCount = allLoadedTasks.length;

        if (loadedCount < total) {
          setIsLoadingMore(true);
          setCardViewPage((prev) => prev + 1);
          setPagination((prev) => ({ ...prev, current: prev.current + 1 }));
        }
      }
    };

    cardBody.addEventListener("scroll", handleScroll);
    return () => {
      cardBody.removeEventListener("scroll", handleScroll);
    };
  }, [allLoadedTasks.length, allTasksQuery.isLoading, filteredTaskRows.length, isLoadingMore, viewMode]);

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - TASK_MONITOR_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? TASK_MONITOR_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - TASK_MONITOR_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(TASK_MONITOR_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (viewMode !== "table") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [
    allTasksQuery.isFetching,
    filteredTaskRows.length,
    statusFilter,
    updateTableScrollY,
    workerKeyword,
    viewMode,
    workersOverviewQuery.error,
    workersOverviewQuery.isFetching,
    workersOverview?.summary.total,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (viewMode !== "table") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updateTableScrollY);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updateTableScrollY, viewMode]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }
    if (viewMode !== "table") {
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
  }, [updateTableScrollY, viewMode]);

  const renderTaskCard = (task: TaskTableRow) => (
    <AntCard
      key={task.key}
      className="admin-task-monitor-task-card"
      size="small"
      title={
        <Space className="min-w-0" size={8}>
          <Typography.Text strong ellipsis={{ tooltip: getTaskDisplayName(task.name) }}>
            {getTaskDisplayName(task.name)}
          </Typography.Text>
          {renderTaskStateTag(task.state)}
        </Space>
      }
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">任务 ID</Typography.Text>
          <Typography.Text copyable ellipsis={{ tooltip: task.task_id }}>
            {task.task_id}
          </Typography.Text>
        </div>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">队列</Typography.Text>
          <Typography.Text>{getQueueDisplayName(task.queue_name)}</Typography.Text>
        </div>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">节点</Typography.Text>
          <Typography.Text ellipsis={{ tooltip: task.worker || "-" }}>
            {task.worker || "-"}
          </Typography.Text>
        </div>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">开始</Typography.Text>
          <Typography.Text>{formatDateTime(task.started_at)}</Typography.Text>
        </div>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">完成</Typography.Text>
          <Typography.Text>{formatDateTime(task.finished_at)}</Typography.Text>
        </div>
        <div className="admin-task-monitor-task-card-field">
          <Typography.Text type="secondary">时长</Typography.Text>
          <Typography.Text>{formatTaskMonitorDuration(task.runtime_seconds)}</Typography.Text>
        </div>
        <div style={{ marginTop: 8 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Button size="small" block onClick={() => handleViewLog(task.task_id)}>
              日志
            </Button>
            <Button size="small" block onClick={() => handleViewDetail(task)}>
              详情
            </Button>
            <Button size="small" block onClick={() => handleViewException(task)} disabled={!task.exception_text}>
              异常
            </Button>
          </Space>
        </div>
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
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问任务监控页面。</p>
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问任务监控页面的权限，请联系管理员开通相关权限。</p>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <AntCard
        ref={pageCardRef}
        className="admin-task-monitor-page-card"
        title="任务监控"
        extra={(
          <Space>
            {(workersOverviewQuery.isFetching || allTasksQuery.isFetching) && <Spin size="small" />}
          </Space>
        )}
      >
        {viewMode === "card" ? (
          <Form layout="vertical" style={{ marginBottom: 16 }}>
            <Form.Item label="执行节点" style={{ marginBottom: 0 }}>
              <Input
                allowClear
                placeholder="按执行节点名称筛选"
                value={workerKeyword}
                onChange={(event) => {
                  setWorkerKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="队列" style={{ marginBottom: 0 }}>
              <Input
                allowClear
                placeholder="按队列名称筛选"
                value={queueKeyword}
                onChange={(event) => {
                  setQueueKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="任务" style={{ marginBottom: 0 }}>
              <Input
                allowClear
                placeholder="按任务 ID / 任务名称筛选"
                value={taskKeyword}
                onChange={(event) => {
                  setTaskKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="状态" style={{ marginBottom: 0 }}>
              <Select
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(parseStatusFilter(value));
                  resetTaskListPagination();
                }}
                options={[
                  { label: "全部状态", value: "all" },
                  { label: "在线", value: "online" },
                  { label: "离线", value: "offline" },
                ]}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button onClick={handleResetFilters}>重置筛选</Button>
            </Form.Item>
          </Form>
        ) : (
          <Form layout="inline" style={{ rowGap: 12 }}>
            <Form.Item label="执行节点" style={{ width: 220 }}>
              <Input
                allowClear
                placeholder="按执行节点名称筛选"
                value={workerKeyword}
                onChange={(event) => {
                  setWorkerKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="队列" style={{ width: 220 }}>
              <Input
                allowClear
                placeholder="按队列名称筛选"
                value={queueKeyword}
                onChange={(event) => {
                  setQueueKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="任务" style={{ width: 240 }}>
              <Input
                allowClear
                placeholder="按任务 ID / 任务名称筛选"
                value={taskKeyword}
                onChange={(event) => {
                  setTaskKeyword(event.target.value);
                  resetTaskListPagination();
                }}
              />
            </Form.Item>

            <Form.Item label="状态" style={{ width: 170 }}>
              <Select
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(parseStatusFilter(value));
                  resetTaskListPagination();
                }}
                options={[
                  { label: "全部状态", value: "all" },
                  { label: "在线", value: "online" },
                  { label: "离线", value: "offline" },
                ]}
              />
            </Form.Item>

            <Form.Item>
              <Button onClick={handleResetFilters}>重置筛选</Button>
            </Form.Item>
          </Form>
        )}


        {!workersOverview && !workersOverviewQuery.isFetching && (
          <div className="mt-4">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无任务监控数据"
            />
          </div>
        )}

        {workersOverview && viewMode === "table" ? (
          <div
            ref={tableScrollAnchorRef}
            className="admin-task-monitor-table-anchor mt-4"
            style={{ "--admin-task-monitor-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
          >
            <Table<TaskTableRow>
              rowKey={(record) => record.key}
              columns={taskColumns}
              dataSource={filteredTaskRows}
              loading={workersOverviewQuery.isLoading || allTasksQuery.isLoading}
              tableLayout="fixed"
              pagination={{
                current: paginationCurrent,
                pageSize: paginationPageSize,
                total: Math.max(filteredTaskRows.length, 1),
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: () => `共 ${filteredTaskRows.length} 条`,
                hideOnSinglePage: false,
                style: { marginBottom: 0 },
                onChange: (page, pageSize) => {
                  setPagination({ current: page, pageSize });
                },
              }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到符合筛选条件的任务。"
                  />
                ),
              }}
              scroll={{ y: tableScrollY }}
            />
          </div>
        ) : workersOverview ? (
          <div className="admin-task-monitor-card-view">
            {allTasksQuery.isLoading && allLoadedTasks.length === 0 ? (
              <div className="admin-task-monitor-card-view-state">
                <Spin tip="加载中..." />
              </div>
            ) : allLoadedTasks.length === 0 ? (
              <div className="admin-task-monitor-card-view-state">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到符合筛选条件的任务。"
                />
              </div>
            ) : (
              <div className="admin-task-monitor-card-view-content">
                <Row gutter={[12, 12]}>
                  {allLoadedTasks.map((task) => (
                    <Col key={task.key} xs={24} sm={24} md={12} lg={8} xl={6}>
                      {renderTaskCard(task)}
                    </Col>
                  ))}
                </Row>
                {isLoadingMore && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin tip="加载更多..." />
                  </div>
                )}
                {allLoadedTasks.length >= filteredTaskRows.length && allLoadedTasks.length > 0 && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Typography.Text type="secondary">
                      已加载全部 {allLoadedTasks.length} 条数据
                    </Typography.Text>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </AntCard>

      <Modal
        title={`任务执行日志 - ${logModalTaskId}`}
        open={logModalVisible}
        onCancel={handleCloseLogModal}
        footer={[
          <Button key="close" onClick={handleCloseLogModal}>
            关闭
          </Button>,
        ]}
        width={800}
        style={{ top: 20 }}
      >
        {logModalLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin tip="加载日志中..." />
          </div>
        ) : (
          <pre
            style={{
              maxHeight: "60vh",
              overflow: "auto",
              padding: "16px",
              backgroundColor: "#f5f5f5",
              borderRadius: "4px",
              fontSize: "12px",
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {logModalContent}
          </pre>
        )}
      </Modal>

      <Modal
        title={`任务参数详情 - ${detailModalTask?.task_id || ""}`}
        open={detailModalVisible}
        onCancel={handleCloseDetailModal}
        footer={[
          <Button key="close" onClick={handleCloseDetailModal}>
            关闭
          </Button>,
        ]}
        width={800}
        style={{ top: 20 }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>任务名称：</Typography.Text>
            <Typography.Text>{getTaskDisplayName(detailModalTask?.name)}</Typography.Text>
          </div>
          <div>
            <Typography.Text strong>位置参数：</Typography.Text>
            <pre
              style={{
                marginTop: "8px",
                padding: "12px",
                backgroundColor: "#f5f5f5",
                borderRadius: "4px",
                fontSize: "12px",
                lineHeight: "1.5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "30vh",
                overflow: "auto",
              }}
            >
              {detailModalTask?.args_text || "无"}
            </pre>
          </div>
          <div>
            <Typography.Text strong>关键字参数：</Typography.Text>
            <pre
              style={{
                marginTop: "8px",
                padding: "12px",
                backgroundColor: "#f5f5f5",
                borderRadius: "4px",
                fontSize: "12px",
                lineHeight: "1.5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "30vh",
                overflow: "auto",
              }}
            >
              {detailModalTask?.kwargs_text || "无"}
            </pre>
          </div>
        </Space>
      </Modal>

      <Modal
        title={`任务异常信息 - ${exceptionModalTask?.task_id || ""}`}
        open={exceptionModalVisible}
        onCancel={handleCloseExceptionModal}
        footer={[
          <Button key="close" onClick={handleCloseExceptionModal}>
            关闭
          </Button>,
        ]}
        width={800}
        style={{ top: 20 }}
      >
        <pre
          style={{
            maxHeight: "60vh",
            overflow: "auto",
            padding: "16px",
            backgroundColor: "#fff2f0",
            borderRadius: "4px",
            fontSize: "12px",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#cf1322",
          }}
        >
          {exceptionModalTask?.exception_text || "无异常信息"}
        </pre>
      </Modal>
    </div>
  );
}
