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
  Drawer,
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

const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps>;

const DEFAULT_RECENT_LIMIT = 100;

type WorkerMonitorWorkerItem = {
  worker: string;
  status: string;
  queue_names: string[];
  concurrency: number;
  prefetch_count: number;
  processed_count: number;
  active_count: number;
  reserved_count: number;
  scheduled_count: number;
  registered_count: number;
  last_heartbeat_at: string | null;
};

type WorkerMonitorOverviewResponse = {
  generated_at: string;
  summary: {
    total: number;
    online: number;
    offline: number;
  };
  workers: WorkerMonitorWorkerItem[];
};

type WorkerMonitorTaskItem = {
  task_id: string;
  name: string;
  state: string;
  source: string;
  queue_name: string | null;
  worker: string;
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

type WorkerMonitorTaskOverviewResponse = {
  generated_at: string;
  worker: string;
  summary: {
    active: number;
    reserved: number;
    scheduled: number;
    recent: number;
  };
  active_tasks: WorkerMonitorTaskItem[];
  reserved_tasks: WorkerMonitorTaskItem[];
  scheduled_tasks: WorkerMonitorTaskItem[];
  recent_tasks: WorkerMonitorTaskItem[];
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

function parseStatusFilter(value: string | undefined): "all" | "online" | "offline" {
  if (value === "online" || value === "offline") {
    return value;
  }
  return "all";
}

export default function AdminWorkersPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const canRead = hasPermission("celery.read") || hasPermission("celery.manage");

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [workerKeyword, setWorkerKeyword] = useState("");
  const [queueKeyword, setQueueKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["worker-monitor-overview"],
    enabled: Boolean(user) && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/flower/workers?forceRefresh=true");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as WorkerMonitorOverviewResponse;
    },
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 15_000,
  });

  const workerTasksPath = useMemo(() => {
    if (!selectedWorker) {
      return null;
    }
    const params = new URLSearchParams();
    params.set("worker", selectedWorker);
    params.set("recentLimit", String(DEFAULT_RECENT_LIMIT));
    params.set("forceRefresh", "true");
    return `/api/v1/admin/flower/worker-tasks?${params.toString()}`;
  }, [selectedWorker]);

  const workerTasksQuery = useQuery({
    queryKey: ["worker-monitor-tasks", workerTasksPath],
    enabled: Boolean(user) && canRead && Boolean(workerTasksPath),
    queryFn: async () => {
      if (!workerTasksPath) {
        throw new Error("missing worker path");
      }
      const response = await fetchWithAuth(workerTasksPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as WorkerMonitorTaskOverviewResponse;
    },
    refetchInterval: autoRefresh ? 5_000 : false,
    staleTime: 15_000,
  });

  const workerColumns = useMemo<TableColumnsType<WorkerMonitorWorkerItem>>(
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
        title: "最近心跳",
        dataIndex: "last_heartbeat_at",
        key: "last_heartbeat_at",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "Active/Reserved/Scheduled",
        key: "runtime_counts",
        width: 190,
        render: (_: unknown, record) => `${record.active_count}/${record.reserved_count}/${record.scheduled_count}`,
      },
      {
        title: "操作",
        key: "action",
        width: 120,
        fixed: "right",
        render: (_: unknown, record) => (
          <Button size="small" onClick={() => setSelectedWorker(record.worker)}>
            查看任务
          </Button>
        ),
      },
    ],
    [],
  );

  const taskColumns = useMemo<TableColumnsType<WorkerMonitorTaskItem>>(
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
        title: "来源",
        dataIndex: "source",
        key: "source",
        width: 90,
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
        title: "ETA",
        dataIndex: "eta",
        key: "eta",
        width: 170,
        render: (value: string | null) => formatDateTime(value),
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
        title: "Result",
        dataIndex: "result_text",
        key: "result_text",
        width: 220,
        render: (value: string | null) =>
          value ? (
            <Text ellipsis={{ tooltip: value }}>
              {value}
            </Text>
          ) : (
            "-"
          ),
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
    const rows = overviewQuery.data?.workers || [];
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
  }, [overviewQuery.data?.workers, queueKeyword, statusFilter, workerKeyword]);

  if (initializing || (overviewQuery.isLoading && !overviewQuery.data && canRead && Boolean(user))) {
    return (
      <div className="py-10">
        <Spin tip="Worker监控数据加载中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问Worker监控页面。</p>
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
  const taskOverview = workerTasksQuery.data;

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
          <Button onClick={() => void overviewQuery.refetch()} loading={overviewQuery.isFetching}>
            刷新Worker
          </Button>
          <Text type="secondary">生成时间：{formatDateTime(overview?.generated_at)}</Text>
        </Space>
      </AntCard>

      {overviewQuery.error && (
        <Alert
          type="error"
          showIcon
          message={overviewQuery.error instanceof Error ? overviewQuery.error.message : "Worker监控数据加载失败"}
        />
      )}

      {!overview && !overviewQuery.isFetching && (
        <AntCard>
          <Empty description="暂无Worker监控数据" />
        </AntCard>
      )}

      {overview && (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="Worker总数" value={overview.summary.total} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="在线Worker" value={overview.summary.online} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="离线Worker" value={overview.summary.offline} />
              </AntCard>
            </Col>
            <Col xs={24} md={6}>
              <AntCard>
                <Statistic title="筛选结果" value={filteredWorkers.length} />
              </AntCard>
            </Col>
          </Row>

          <AntCard title="Worker列表">
            <Table<WorkerMonitorWorkerItem>
              rowKey={(record) => record.worker}
              columns={workerColumns}
              dataSource={filteredWorkers}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              locale={{ emptyText: "暂无Worker数据" }}
              scroll={{ x: 1600 }}
            />
          </AntCard>
        </>
      )}

      <Drawer
        title={`Worker任务明细 - ${selectedWorker || "-"}`}
        open={Boolean(selectedWorker)}
        width={1260}
        onClose={() => setSelectedWorker(null)}
        extra={
          <Space>
            <Button size="small" onClick={() => void workerTasksQuery.refetch()} loading={workerTasksQuery.isFetching}>
              刷新任务
            </Button>
            <Text type="secondary">{taskOverview ? `采集时间：${formatDateTime(taskOverview.generated_at)}` : "-"}</Text>
          </Space>
        }
      >
        {workerTasksQuery.isLoading && !taskOverview ? <Spin tip="任务数据加载中..." /> : null}
        {workerTasksQuery.error ? (
          <Alert
            type="error"
            showIcon
            message={workerTasksQuery.error instanceof Error ? workerTasksQuery.error.message : "任务数据加载失败"}
          />
        ) : null}
        {!workerTasksQuery.isLoading && !taskOverview ? <Empty description="暂无任务数据" /> : null}
        {taskOverview ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space size={8} wrap>
              <Tag color="processing">运行中: {taskOverview.summary.active}</Tag>
              <Tag color="blue">保留中: {taskOverview.summary.reserved}</Tag>
              <Tag color="purple">已调度: {taskOverview.summary.scheduled}</Tag>
              <Tag color="geekblue">最近任务: {taskOverview.summary.recent}</Tag>
            </Space>

            <AntCard title="运行中任务">
              <Table<WorkerMonitorTaskItem>
                rowKey={(record) => `active-${record.task_id}`}
                columns={taskColumns}
                dataSource={taskOverview.active_tasks}
                pagination={false}
                locale={{ emptyText: "暂无运行中任务" }}
                scroll={{ x: 2200 }}
              />
            </AntCard>

            <AntCard title="保留任务">
              <Table<WorkerMonitorTaskItem>
                rowKey={(record) => `reserved-${record.task_id}`}
                columns={taskColumns}
                dataSource={taskOverview.reserved_tasks}
                pagination={false}
                locale={{ emptyText: "暂无保留任务" }}
                scroll={{ x: 2200 }}
              />
            </AntCard>

            <AntCard title="定时任务">
              <Table<WorkerMonitorTaskItem>
                rowKey={(record) => `scheduled-${record.task_id}`}
                columns={taskColumns}
                dataSource={taskOverview.scheduled_tasks}
                pagination={false}
                locale={{ emptyText: "暂无定时任务" }}
                scroll={{ x: 2200 }}
              />
            </AntCard>

            <AntCard title="最近完成任务">
              <Table<WorkerMonitorTaskItem>
                rowKey={(record) => `recent-${record.task_id}`}
                columns={taskColumns}
                dataSource={taskOverview.recent_tasks}
                pagination={false}
                locale={{ emptyText: "暂无最近任务" }}
                scroll={{ x: 2200 }}
              />
            </AntCard>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
