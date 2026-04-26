"use client";

import Link from "next/link";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  type CardProps,
  type TableColumnsType,
} from "antd";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";

const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps>;

const DEFAULT_TASK_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 100;

type TaskMonitorBucketItem = {
  key: string;
  label: string;
  count: number;
};

type TaskMonitorWorkerItem = {
  worker: string;
  online: boolean;
  queue_names: string[];
  max_concurrency: number;
  prefetch_count: number;
  uptime_seconds: number;
  processed_total: number;
  active_count: number;
  reserved_count: number;
  scheduled_count: number;
};

type TaskMonitorQueueItem = {
  name: string;
  pending_count: number;
  consumer_count: number;
  active_count: number;
  reserved_count: number;
  scheduled_count: number;
};

type TaskMonitorTaskItem = {
  task_id: string;
  name: string;
  state: string;
  queue_name: string | null;
  worker: string | null;
  retries: number;
  eta: string | null;
  started_at: string | null;
  done_at: string | null;
  runtime_seconds: number | null;
  error: string | null;
};

type TaskMonitorOverviewResponse = {
  generated_at: string;
  broker_url: string;
  result_backend: string;
  workers_online: number;
  worker_concurrency_total: number;
  queue_pending_total: number;
  task_state_buckets: TaskMonitorBucketItem[];
  workers: TaskMonitorWorkerItem[];
  queues: TaskMonitorQueueItem[];
  tasks: TaskMonitorTaskItem[];
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

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remain}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remain}s`;
  }
  return `${remain}s`;
}

function normalizePositiveInt(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function renderTaskStateTag(state: string) {
  const normalized = (state || "").toUpperCase();
  const color =
    normalized === "STARTED"
      ? "processing"
      : normalized === "RECEIVED"
        ? "blue"
        : normalized === "SCHEDULED"
          ? "purple"
          : normalized === "RETRY"
            ? "orange"
            : normalized === "SUCCESS"
              ? "green"
              : normalized === "FAILURE"
                ? "red"
                : normalized === "REVOKED"
                  ? "default"
                  : "geekblue";
  return <Tag color={color}>{normalized || "UNKNOWN"}</Tag>;
}

function renderOnlineTag(online: boolean) {
  return online ? <Tag color="green">在线</Tag> : <Tag color="default">离线</Tag>;
}

export default function AdminTaskMonitorPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [taskLimit, setTaskLimit] = useState(DEFAULT_TASK_LIMIT);
  const [historyLimit, setHistoryLimit] = useState(DEFAULT_HISTORY_LIMIT);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const canRead = hasPermission("celery.read") || hasPermission("celery.manage");

  const overviewPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("task_limit", String(taskLimit));
    params.set("history_limit", String(historyLimit));
    return `/api/v1/admin/task-monitor/overview?${params.toString()}`;
  }, [historyLimit, taskLimit]);

  const overviewQuery = useQuery({
    queryKey: ["task-monitor-overview", overviewPath],
    enabled: Boolean(user) && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(overviewPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TaskMonitorOverviewResponse;
    },
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 15_000,
  });

  const workerColumns = useMemo<TableColumnsType<TaskMonitorWorkerItem>>(
    () => [
      {
        title: "Worker",
        dataIndex: "worker",
        key: "worker",
        width: 260,
      },
      {
        title: "状态",
        dataIndex: "online",
        key: "online",
        width: 90,
        render: (value: boolean) => renderOnlineTag(value),
      },
      {
        title: "队列",
        dataIndex: "queue_names",
        key: "queue_names",
        render: (value: string[]) => (value.length > 0 ? value.join(", ") : "-"),
      },
      {
        title: "并发",
        dataIndex: "max_concurrency",
        key: "max_concurrency",
        width: 90,
      },
      {
        title: "预取",
        dataIndex: "prefetch_count",
        key: "prefetch_count",
        width: 90,
      },
      {
        title: "在线时长",
        dataIndex: "uptime_seconds",
        key: "uptime_seconds",
        width: 120,
        render: (value: number) => formatDuration(value),
      },
      {
        title: "累计处理",
        dataIndex: "processed_total",
        key: "processed_total",
        width: 120,
      },
      {
        title: "Active/Reserved/Scheduled",
        key: "runtime_counts",
        width: 190,
        render: (_: unknown, record) => `${record.active_count}/${record.reserved_count}/${record.scheduled_count}`,
      },
    ],
    [],
  );

  const queueColumns = useMemo<TableColumnsType<TaskMonitorQueueItem>>(
    () => [
      {
        title: "队列",
        dataIndex: "name",
        key: "name",
      },
      {
        title: "Pending",
        dataIndex: "pending_count",
        key: "pending_count",
        width: 110,
      },
      {
        title: "Consumer",
        dataIndex: "consumer_count",
        key: "consumer_count",
        width: 110,
      },
      {
        title: "Active",
        dataIndex: "active_count",
        key: "active_count",
        width: 100,
      },
      {
        title: "Reserved",
        dataIndex: "reserved_count",
        key: "reserved_count",
        width: 110,
      },
      {
        title: "Scheduled",
        dataIndex: "scheduled_count",
        key: "scheduled_count",
        width: 120,
      },
    ],
    [],
  );

  const taskColumns = useMemo<TableColumnsType<TaskMonitorTaskItem>>(
    () => [
      {
        title: "Task ID",
        dataIndex: "task_id",
        key: "task_id",
        width: 280,
        render: (value: string) => <Text copyable>{value}</Text>,
      },
      {
        title: "任务名",
        dataIndex: "name",
        key: "name",
        width: 260,
        render: (value: string) => value || "-",
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
        width: 130,
        render: (value: string | null) => value || "-",
      },
      {
        title: "Worker",
        dataIndex: "worker",
        key: "worker",
        width: 220,
        render: (value: string | null) => value || "-",
      },
      {
        title: "重试",
        dataIndex: "retries",
        key: "retries",
        width: 80,
      },
      {
        title: "ETA",
        dataIndex: "eta",
        key: "eta",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "开始",
        dataIndex: "started_at",
        key: "started_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "完成",
        dataIndex: "done_at",
        key: "done_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "运行时长",
        dataIndex: "runtime_seconds",
        key: "runtime_seconds",
        width: 110,
        render: (value: number | null) => (value === null ? "-" : `${value.toFixed(1)}s`),
      },
      {
        title: "错误",
        dataIndex: "error",
        key: "error",
        width: 260,
        render: (value: string | null) =>
          value ? (
            <Text type="danger" ellipsis={{ tooltip: value }}>
              {value}
            </Text>
          ) : (
            "-"
          ),
      },
    ],
    [],
  );

  if (initializing || (overviewQuery.isLoading && !overviewQuery.data && canRead && Boolean(user))) {
    return (
      <div className="py-10">
        <Spin tip="任务监控数据加载中..." />
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `celery.read` 或 `celery.manage`）。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  const overview = overviewQuery.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <AntCard>
        <Space size={16} wrap>
          <Space size={8}>
            <Text>任务列表上限</Text>
            <InputNumber
              min={1}
              max={500}
              value={taskLimit}
              onChange={(value) => setTaskLimit(normalizePositiveInt(value, DEFAULT_TASK_LIMIT, 1, 500))}
            />
          </Space>
          <Space size={8}>
            <Text>历史任务扫描上限</Text>
            <InputNumber
              min={0}
              max={500}
              value={historyLimit}
              onChange={(value) => setHistoryLimit(normalizePositiveInt(value, DEFAULT_HISTORY_LIMIT, 0, 500))}
            />
          </Space>
          <Space size={8}>
            <Text>自动刷新</Text>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </Space>
          <Button onClick={() => void overviewQuery.refetch()} loading={overviewQuery.isFetching}>
            刷新监控数据
          </Button>
          <Text type="secondary">生成时间：{formatDateTime(overview?.generated_at)}</Text>
        </Space>
      </AntCard>

      {overviewQuery.error && (
        <Alert
          type="error"
          showIcon
          message={overviewQuery.error instanceof Error ? overviewQuery.error.message : "任务监控数据加载失败"}
        />
      )}

      {!overview && !overviewQuery.isFetching && (
        <AntCard>
          <Empty description="暂无任务监控数据" />
        </AntCard>
      )}

      {overview && (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="在线 Worker" value={overview.workers_online} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="总并发" value={overview.worker_concurrency_total} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="队列待处理" value={overview.queue_pending_total} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="采样任务数" value={overview.tasks.length} />
              </AntCard>
            </Col>
          </Row>

          <AntCard title="任务状态分布">
            <Space wrap>
              {overview.task_state_buckets.length > 0 ? (
                overview.task_state_buckets.map((item) => (
                  <Tag key={`task-state-${item.key}`} color="geekblue">{`${item.label}: ${item.count}`}</Tag>
                ))
              ) : (
                <Text type="secondary">暂无状态分布数据</Text>
              )}
            </Space>
          </AntCard>

          <AntCard title="Worker 概览" extra={<Text type="secondary">Broker: {overview.broker_url || "-"}</Text>}>
            <Table<TaskMonitorWorkerItem>
              rowKey={(record) => record.worker}
              columns={workerColumns}
              dataSource={overview.workers}
              pagination={false}
              locale={{ emptyText: "暂无 Worker 数据" }}
              scroll={{ x: 1200 }}
            />
          </AntCard>

          <AntCard title="Queue 概览" extra={<Text type="secondary">Result Backend: {overview.result_backend || "-"}</Text>}>
            <Table<TaskMonitorQueueItem>
              rowKey={(record) => record.name}
              columns={queueColumns}
              dataSource={overview.queues}
              pagination={false}
              locale={{ emptyText: "暂无 Queue 数据" }}
              scroll={{ x: 760 }}
            />
          </AntCard>

          <AntCard title="任务明细">
            <Table<TaskMonitorTaskItem>
              rowKey={(record) => record.task_id}
              columns={taskColumns}
              dataSource={overview.tasks}
              pagination={false}
              locale={{ emptyText: "暂无任务数据" }}
              scroll={{ x: 2200 }}
            />
          </AntCard>
        </>
      )}
    </Space>
  );
}
