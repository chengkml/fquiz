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
  Input,
  Row,
  Select,
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
import { getTaskDisplayName } from "@/lib/celery-task-display";

const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps>;

const DEFAULT_RECENT_LIMIT = 100;

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

function renderWorkerStatusTag(status: string) {
  return (status || "").toUpperCase() === "ONLINE" ? <Tag color="green">在线</Tag> : <Tag color="default">离线</Tag>;
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
  const canRead = hasPermission("celery.read") || hasPermission("celery.manage");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [workerKeyword, setWorkerKeyword] = useState("");
  const [queueKeyword, setQueueKeyword] = useState("");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");

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

  const workerColumns = useMemo<TableColumnsType<FlowerWorkerItem>>(
    () => [
      {
        title: "Worker",
        dataIndex: "worker",
        key: "worker",
        width: 280,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 90,
        render: (value: string) => renderWorkerStatusTag(value),
      },
      {
        title: "队列",
        dataIndex: "queue_names",
        key: "queue_names",
        render: (value: string[]) => (value.length > 0 ? value.join(", ") : "-"),
      },
      {
        title: "并发",
        dataIndex: "concurrency",
        key: "concurrency",
        width: 80,
      },
      {
        title: "Prefetch",
        dataIndex: "prefetch_count",
        key: "prefetch_count",
        width: 90,
      },
      {
        title: "已注册任务",
        dataIndex: "registered_count",
        key: "registered_count",
        width: 110,
      },
      {
        title: "累计处理",
        dataIndex: "processed_count",
        key: "processed_count",
        width: 110,
      },
      {
        title: "Active/Reserved/Scheduled",
        key: "runtime_counts",
        width: 190,
        render: (_: unknown, record) => `${record.active_count}/${record.reserved_count}/${record.scheduled_count}`,
      },
      {
        title: "最近心跳",
        dataIndex: "last_heartbeat_at",
        key: "last_heartbeat_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
    ],
    [],
  );

  const taskColumns = useMemo<TableColumnsType<TaskTableRow>>(
    () => [
      {
        title: "Task ID",
        dataIndex: "task_id",
        key: "task_id",
        width: 260,
        render: (value: string) => <Text copyable>{value}</Text>,
      },
      {
        title: "任务名",
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
        title: "来源",
        dataIndex: "source",
        key: "source",
        width: 100,
        render: (value: string) => value || "-",
      },
      {
        title: "队列",
        dataIndex: "queue_name",
        key: "queue_name",
        width: 120,
        render: (value: string | null) => value || "-",
      },
      {
        title: "Worker",
        dataIndex: "worker",
        key: "worker",
        width: 220,
        render: (value: string) => value || "-",
      },
      {
        title: "接收",
        dataIndex: "received_at",
        key: "received_at",
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
        render: (value: number | null) => (value === null ? "-" : `${value.toFixed(3)}s`),
      },
      {
        title: "Args",
        dataIndex: "args_text",
        key: "args_text",
        width: 220,
        render: (value: string | null) => (value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : "-"),
      },
      {
        title: "Kwargs",
        dataIndex: "kwargs_text",
        key: "kwargs_text",
        width: 220,
        render: (value: string | null) => (value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : "-"),
      },
      {
        title: "Exception",
        dataIndex: "exception_text",
        key: "exception_text",
        width: 220,
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
        const text = item.queue_names.join(", ");
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
    return rows;
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
      const haystack = [item.task_id, item.name, item.queue_name || "", item.worker, item.args_text || "", item.kwargs_text || ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword.toLowerCase());
    });
  }, [allTaskRows, filteredWorkers, taskKeyword]);

  const stateBuckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of filteredTaskRows) {
      const state = (row.state || "UNKNOWN").toUpperCase();
      counts.set(state, (counts.get(state) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([state, count]) => ({ state, count }));
  }, [filteredTaskRows]);

  const queuePendingTotal = filteredWorkers.reduce(
    (sum, item) => sum + item.active_count + item.reserved_count + item.scheduled_count,
    0,
  );

  if (initializing || (workersOverviewQuery.isLoading && !workersOverviewQuery.data && canRead && Boolean(user))) {
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

  const workersOverview = workersOverviewQuery.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <AntCard>
        <Space size={16} wrap>
          <Input
            allowClear
            placeholder="按 Worker 名称筛选"
            value={workerKeyword}
            onChange={(event) => setWorkerKeyword(event.target.value)}
            style={{ width: 220 }}
          />
          <Input
            allowClear
            placeholder="按队列名称筛选"
            value={queueKeyword}
            onChange={(event) => setQueueKeyword(event.target.value)}
            style={{ width: 220 }}
          />
          <Input
            allowClear
            placeholder="按 Task ID/任务名筛选"
            value={taskKeyword}
            onChange={(event) => setTaskKeyword(event.target.value)}
            style={{ width: 240 }}
          />
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(parseStatusFilter(value))}
            options={[
              { label: "全部状态", value: "all" },
              { label: "在线", value: "online" },
              { label: "离线", value: "offline" },
            ]}
            style={{ width: 150 }}
          />
          <Space size={8}>
            <Text>自动刷新</Text>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
          </Space>
          <Button
            onClick={() => {
              void workersOverviewQuery.refetch();
              void allTasksQuery.refetch();
            }}
            loading={workersOverviewQuery.isFetching || allTasksQuery.isFetching}
          >
            刷新监控数据
          </Button>
          <Text type="secondary">生成时间：{formatDateTime(workersOverview?.generated_at)}</Text>
        </Space>
      </AntCard>

      {workersOverviewQuery.error && (
        <Alert
          type="error"
          showIcon
          message={workersOverviewQuery.error instanceof Error ? workersOverviewQuery.error.message : "任务监控数据加载失败"}
        />
      )}
      {allTasksQuery.error && (
        <Alert
          type="error"
          showIcon
          message={allTasksQuery.error instanceof Error ? allTasksQuery.error.message : "任务列表数据加载失败"}
        />
      )}

      {!workersOverview && !workersOverviewQuery.isFetching && (
        <AntCard>
          <Empty description="暂无任务监控数据" />
        </AntCard>
      )}

      {workersOverview && (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="在线 Worker" value={workersOverview.summary.online} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="离线 Worker" value={workersOverview.summary.offline} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="队列待处理" value={queuePendingTotal} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="采样任务数" value={filteredTaskRows.length} />
              </AntCard>
            </Col>
          </Row>

          <AntCard title="任务状态分布">
            <Space wrap>
              {stateBuckets.length > 0 ? (
                stateBuckets.map((item) => (
                  <Tag key={`task-state-${item.state}`} color="geekblue">{`${item.state}: ${item.count}`}</Tag>
                ))
              ) : (
                <Text type="secondary">暂无状态分布数据</Text>
              )}
            </Space>
          </AntCard>

          <AntCard title="Worker 概览">
            <Table<FlowerWorkerItem>
              rowKey={(record) => record.worker}
              columns={workerColumns}
              dataSource={filteredWorkers}
              pagination={false}
              locale={{ emptyText: "暂无 Worker 数据" }}
              scroll={{ x: 1500 }}
            />
          </AntCard>

          <AntCard title="任务明细">
            <Table<TaskTableRow>
              rowKey={(record) => record.key}
              columns={taskColumns}
              dataSource={filteredTaskRows}
              pagination={{ pageSize: 50, showSizeChanger: true }}
              locale={{ emptyText: "暂无任务数据" }}
              scroll={{ x: 2600 }}
            />
          </AntCard>
        </>
      )}
    </Space>
  );
}
