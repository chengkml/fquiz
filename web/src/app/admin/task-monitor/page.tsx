"use client";

import Link from "next/link";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
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

const DEFAULT_RISK_LIMIT = 20;
const DEFAULT_STALE_HOURS = 48;

type TaskMonitorBucketItem = {
  key: string;
  label: string;
  count: number;
};

type TaskMonitorRequirementRiskItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  updated_at: string;
  stale_hours: number;
};

type TaskMonitorTodoRiskItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  expire_time: string | null;
  overdue_hours: number;
};

type TaskMonitorOverviewResponse = {
  generated_at: string;
  requirement_total: number;
  requirement_active: number;
  requirement_completed: number;
  requirement_status_buckets: TaskMonitorBucketItem[];
  requirement_priority_buckets: TaskMonitorBucketItem[];
  high_priority_requirements: TaskMonitorRequirementRiskItem[];
  stale_requirements: TaskMonitorRequirementRiskItem[];
  todo_total: number;
  todo_active: number;
  todo_completed: number;
  todo_overdue: number;
  todo_status_buckets: TaskMonitorBucketItem[];
  todo_priority_buckets: TaskMonitorBucketItem[];
  overdue_todos: TaskMonitorTodoRiskItem[];
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return "-";
  }
  return parsed.format("YYYY-MM-DD HH:mm");
}

function normalizePositiveInt(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function renderPriorityTag(priority: string) {
  const normalized = (priority || "").toUpperCase();
  const color =
    normalized === "URGENT" ? "red" : normalized === "HIGH" ? "volcano" : normalized === "LOW" ? "green" : "blue";
  const label =
    normalized === "URGENT" ? "紧急" : normalized === "HIGH" ? "高" : normalized === "LOW" ? "低" : "中";
  return <Tag color={color}>{label}</Tag>;
}

function renderRequirementStatusTag(status: string) {
  const normalized = (status || "").toUpperCase();
  const color =
    normalized === "COMPLETED" || normalized === "CLOSED"
      ? "green"
      : normalized === "IN_PROGRESS"
        ? "processing"
        : normalized === "PENDING_REVISION"
          ? "orange"
          : normalized === "CANCELLED"
            ? "default"
            : "blue";
  const labelMap: Record<string, string> = {
    PENDING_ANALYSIS: "待分析",
    PENDING_REVIEW: "待评审",
    PENDING_REVISION: "待修订",
    OPEN: "待处理",
    IN_PROGRESS: "处理中",
    COMPLETED: "已完成",
    CLOSED: "已关闭",
    CANCELLED: "已取消",
  };
  return <Tag color={color}>{labelMap[normalized] ?? normalized}</Tag>;
}

function renderTodoStatusTag(status: string) {
  const normalized = (status || "").toUpperCase();
  const color =
    normalized === "COMPLETED"
      ? "green"
      : normalized === "IN_PROGRESS"
        ? "processing"
        : normalized === "EXPIRED"
          ? "red"
          : normalized === "CANCELLED"
            ? "default"
            : "blue";
  const labelMap: Record<string, string> = {
    SCHEDULED: "已计划",
    IN_PROGRESS: "处理中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    EXPIRED: "已过期",
  };
  return <Tag color={color}>{labelMap[normalized] ?? normalized}</Tag>;
}

function pickTodoDeadline(item: TaskMonitorTodoRiskItem): string | null {
  const candidates = [item.expire_time, item.due_date].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    return null;
  }
  const sorted = candidates
    .map((raw) => ({ raw, parsed: dayjs(raw) }))
    .filter((item) => item.parsed.isValid())
    .sort((a, b) => a.parsed.valueOf() - b.parsed.valueOf());
  if (sorted.length === 0) {
    return null;
  }
  return sorted[0].raw;
}

export default function AdminTaskMonitorPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [riskLimit, setRiskLimit] = useState(DEFAULT_RISK_LIMIT);
  const [staleHours, setStaleHours] = useState(DEFAULT_STALE_HOURS);

  const canReadRequirements = hasPermission("requirement.read")
    || hasPermission("requirement.process")
    || hasPermission("requirement.manage");
  const canReadTodos = hasPermission("todo.read")
    || hasPermission("todo.process")
    || hasPermission("todo.manage");
  const canRead = canReadRequirements || canReadTodos;

  const overviewPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("risk_limit", String(riskLimit));
    params.set("stale_hours", String(staleHours));
    return `/api/v1/admin/task-monitor/overview?${params.toString()}`;
  }, [riskLimit, staleHours]);

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
    staleTime: 30_000,
  });

  const requirementColumns = useMemo<TableColumnsType<TaskMonitorRequirementRiskItem>>(
    () => [
      {
        title: "需求标题",
        dataIndex: "title",
        key: "title",
        render: (_: string, record) => <Link href={`/requirements/${record.id}`}>{record.title}</Link>,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (value: string) => renderRequirementStatusTag(value),
      },
      {
        title: "优先级",
        dataIndex: "priority",
        key: "priority",
        width: 90,
        render: (value: string) => renderPriorityTag(value),
      },
      {
        title: "最后更新",
        dataIndex: "updated_at",
        key: "updated_at",
        width: 180,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "滞留(小时)",
        dataIndex: "stale_hours",
        key: "stale_hours",
        width: 120,
      },
    ],
    [],
  );

  const todoColumns = useMemo<TableColumnsType<TaskMonitorTodoRiskItem>>(
    () => [
      {
        title: "待办标题",
        dataIndex: "title",
        key: "title",
        render: (_: string, record) => <Link href="/schedule">{record.title}</Link>,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (value: string) => renderTodoStatusTag(value),
      },
      {
        title: "优先级",
        dataIndex: "priority",
        key: "priority",
        width: 90,
        render: (value: string) => renderPriorityTag(value),
      },
      {
        title: "截止时间",
        key: "deadline",
        width: 180,
        render: (_: unknown, record) => formatDateTime(pickTodoDeadline(record)),
      },
      {
        title: "逾期(小时)",
        dataIndex: "overdue_hours",
        key: "overdue_hours",
        width: 120,
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `requirement.read` 或 `todo.read`）。</p>
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
            <Text>风险项上限</Text>
            <InputNumber
              min={1}
              max={200}
              value={riskLimit}
              onChange={(value) => setRiskLimit(normalizePositiveInt(value, DEFAULT_RISK_LIMIT, 1, 200))}
            />
          </Space>
          <Space size={8}>
            <Text>需求滞留阈值(小时)</Text>
            <InputNumber
              min={1}
              max={24 * 30}
              value={staleHours}
              onChange={(value) => setStaleHours(normalizePositiveInt(value, DEFAULT_STALE_HOURS, 1, 24 * 30))}
            />
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
            {canReadRequirements && (
              <>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="需求总量" value={overview.requirement_total} />
                  </AntCard>
                </Col>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="活跃需求" value={overview.requirement_active} />
                  </AntCard>
                </Col>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="已完成需求" value={overview.requirement_completed} />
                  </AntCard>
                </Col>
              </>
            )}
            {canReadTodos && (
              <>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="待办总量" value={overview.todo_total} />
                  </AntCard>
                </Col>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="活跃待办" value={overview.todo_active} />
                  </AntCard>
                </Col>
                <Col xs={24} md={8}>
                  <AntCard>
                    <Statistic title="超期待办" value={overview.todo_overdue} valueStyle={{ color: "#cf1322" }} />
                  </AntCard>
                </Col>
              </>
            )}
          </Row>

          {canReadRequirements && (
            <AntCard title="需求分布">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  {overview.requirement_status_buckets.length > 0 ? (
                    overview.requirement_status_buckets.map((item) => (
                      <Tag key={`requirement-status-${item.key}`} color="blue">{`${item.label}: ${item.count}`}</Tag>
                    ))
                  ) : (
                    <Text type="secondary">暂无状态分布数据</Text>
                  )}
                </Space>
                <Space wrap>
                  {overview.requirement_priority_buckets.length > 0 ? (
                    overview.requirement_priority_buckets.map((item) => (
                      <Tag key={`requirement-priority-${item.key}`} color="purple">{`${item.label}: ${item.count}`}</Tag>
                    ))
                  ) : (
                    <Text type="secondary">暂无优先级分布数据</Text>
                  )}
                </Space>
              </Space>
            </AntCard>
          )}

          {canReadTodos && (
            <AntCard title="待办分布">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  {overview.todo_status_buckets.length > 0 ? (
                    overview.todo_status_buckets.map((item) => (
                      <Tag key={`todo-status-${item.key}`} color="geekblue">{`${item.label}: ${item.count}`}</Tag>
                    ))
                  ) : (
                    <Text type="secondary">暂无状态分布数据</Text>
                  )}
                </Space>
                <Space wrap>
                  {overview.todo_priority_buckets.length > 0 ? (
                    overview.todo_priority_buckets.map((item) => (
                      <Tag key={`todo-priority-${item.key}`} color="magenta">{`${item.label}: ${item.count}`}</Tag>
                    ))
                  ) : (
                    <Text type="secondary">暂无优先级分布数据</Text>
                  )}
                </Space>
              </Space>
            </AntCard>
          )}

          {canReadRequirements && (
            <AntCard title="高优先级需求（待处理）">
              <Table<TaskMonitorRequirementRiskItem>
                rowKey={(record) => record.id}
                columns={requirementColumns}
                dataSource={overview.high_priority_requirements}
                pagination={false}
                locale={{ emptyText: "暂无高优先级待处理需求" }}
                scroll={{ x: 760 }}
              />
            </AntCard>
          )}

          {canReadRequirements && (
            <AntCard title="滞留需求（超阈值）">
              <Table<TaskMonitorRequirementRiskItem>
                rowKey={(record) => record.id}
                columns={requirementColumns}
                dataSource={overview.stale_requirements}
                pagination={false}
                locale={{ emptyText: "暂无滞留需求" }}
                scroll={{ x: 760 }}
              />
            </AntCard>
          )}

          {canReadTodos && (
            <AntCard title="超期待办">
              <Table<TaskMonitorTodoRiskItem>
                rowKey={(record) => record.id}
                columns={todoColumns}
                dataSource={overview.overdue_todos}
                pagination={false}
                locale={{ emptyText: "暂无超期待办" }}
                scroll={{ x: 760 }}
              />
            </AntCard>
          )}
        </>
      )}
    </Space>
  );
}
