"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs, { Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type {
  TodoListResponse,
  TodoPriority,
  TodoStatus,
  TodoSummary,
} from "@/types/auth";

type SearchParams = {
  title: string;
  status: TodoStatus | "";
  priority: TodoPriority | "";
};

type PaginationState = {
  current: number;
  pageSize: number;
  total: number;
};

type TodoFormValues = {
  title: string;
  descr?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  start_time?: Dayjs | null;
  due_date?: Dayjs | null;
  expire_time?: Dayjs | null;
};

const STATUS_OPTIONS: Array<{ label: string; value: TodoStatus }> = [
  { label: "已计划", value: "SCHEDULED" },
  { label: "处理中", value: "IN_PROGRESS" },
  { label: "已完成", value: "COMPLETED" },
  { label: "已取消", value: "CANCELLED" },
  { label: "已过期", value: "EXPIRED" },
];

const PRIORITY_OPTIONS: Array<{ label: string; value: TodoPriority }> = [
  { label: "低", value: "LOW" },
  { label: "中", value: "MEDIUM" },
  { label: "高", value: "HIGH" },
];

const STATUS_LABEL: Record<TodoStatus, string> = {
  SCHEDULED: "已计划",
  IN_PROGRESS: "处理中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

const STATUS_COLOR: Record<TodoStatus, string> = {
  SCHEDULED: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  CANCELLED: "error",
  EXPIRED: "warning",
};

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
};

const PRIORITY_COLOR: Record<TodoPriority, string> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "error",
};

const DEFAULT_SEARCH_PARAMS: SearchParams = {
  title: "",
  status: "SCHEDULED",
  priority: "",
};

const DEFAULT_PAGINATION: PaginationState = {
  current: 1,
  pageSize: 20,
  total: 0,
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toLocalDateTimeString(value: Dayjs | null | undefined): string | null {
  if (!value) return null;
  return value.format("YYYY-MM-DDTHH:mm:ss");
}

export default function TodoPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [searchForm] = Form.useForm<SearchParams>();
  const [addForm] = Form.useForm<TodoFormValues>();
  const [editForm] = Form.useForm<TodoFormValues>();

  const [searchParams, setSearchParams] = useState<SearchParams>(DEFAULT_SEARCH_PARAMS);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  const [tableData, setTableData] = useState<TodoSummary[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);

  const [currentRecord, setCurrentRecord] = useState<TodoSummary | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [panelError, setPanelError] = useState("");

  const canRead = hasPermission("todo.read");
  const canCreate = hasPermission("todo.create") || hasPermission("todo.manage");
  const canProcess = hasPermission("todo.process") || hasPermission("todo.manage");
  const canManage = hasPermission("todo.manage");
  const currentPage = pagination.current;
  const currentPageSize = pagination.pageSize;

  const fetchTableData = useCallback(
    async (
      params: SearchParams,
      pageSize: number,
      current: number,
    ) => {
      setTableLoading(true);
      try {
        const query = new URLSearchParams();
        if (params.title.trim()) query.set("title", params.title.trim());
        if (params.status) query.set("status", params.status);
        if (params.priority) query.set("priority", params.priority);
        query.set("page_num", String(current - 1));
        query.set("page_size", String(pageSize));

        const response = await fetchWithAuth(`/api/v1/todos?${query.toString()}`);
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as TodoListResponse;
        setPanelError("");
        setTableData(payload.items ?? []);
        setPagination((prev) => ({
          ...prev,
          current,
          pageSize,
          total: payload.total ?? 0,
        }));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "获取待办数据失败";
        setPanelError(messageText);
      } finally {
        setTableLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user || !canRead) return;
    void fetchTableData(searchParams, currentPageSize, currentPage);
  }, [canRead, currentPage, currentPageSize, fetchTableData, searchParams, user]);

  const handleSearch = (values: SearchParams) => {
    const nextParams: SearchParams = {
      title: values.title ?? "",
      status: values.status ?? "",
      priority: values.priority ?? "",
    };
    setSearchParams(nextParams);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleReset = () => {
    searchForm.setFieldsValue(DEFAULT_SEARCH_PARAMS);
    setSearchParams(DEFAULT_SEARCH_PARAMS);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handlePaginationChange = (current: number, pageSize: number) => {
    setPagination((prev) => ({ ...prev, current, pageSize }));
  };

  const openAddModal = () => {
    addForm.resetFields();
    addForm.setFieldsValue({
      status: "SCHEDULED",
      priority: "MEDIUM",
      descr: "",
    });
    setAddModalVisible(true);
  };

  const handleAddConfirm = async () => {
    try {
      const values = await addForm.validateFields();
      const response = await fetchWithAuth("/api/v1/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          descr: values.descr ?? "",
          status: values.status ?? "SCHEDULED",
          priority: values.priority ?? "MEDIUM",
          start_time: toLocalDateTimeString(values.start_time),
          due_date: toLocalDateTimeString(values.due_date),
          expire_time: toLocalDateTimeString(values.expire_time),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("待办创建成功");
      setAddModalVisible(false);
      addForm.resetFields();
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const messageText = error instanceof Error ? error.message : "待办创建失败";
      setPanelError(messageText);
      message.error(messageText);
    }
  };

  const openEditModal = (record: TodoSummary) => {
    setCurrentRecord(record);
    editForm.setFieldsValue({
      title: record.title,
      descr: record.descr ?? "",
      status: record.status,
      priority: record.priority,
      start_time: record.start_time ? dayjs(record.start_time) : null,
      due_date: record.due_date ? dayjs(record.due_date) : null,
      expire_time: record.expire_time ? dayjs(record.expire_time) : null,
    });
    setEditModalVisible(true);
  };

  const handleEditConfirm = async () => {
    if (!currentRecord) return;
    try {
      const values = await editForm.validateFields();
      const response = await fetchWithAuth(`/api/v1/todos/${currentRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          descr: values.descr ?? "",
          status: values.status,
          priority: values.priority,
          start_time: toLocalDateTimeString(values.start_time),
          due_date: toLocalDateTimeString(values.due_date),
          expire_time: toLocalDateTimeString(values.expire_time),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("待办更新成功");
      setEditModalVisible(false);
      setCurrentRecord(null);
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const messageText = error instanceof Error ? error.message : "待办更新失败";
      setPanelError(messageText);
      message.error(messageText);
    }
  };

  const openDetailModal = (record: TodoSummary) => {
    setCurrentRecord(record);
    setDetailModalVisible(true);
  };

  const handleDelete = async (record: TodoSummary) => {
    try {
      const response = await fetchWithAuth(`/api/v1/todos/${record.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("待办删除成功");
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "待办删除失败";
      setPanelError(messageText);
      message.error(messageText);
    }
  };

  const handleComplete = async (record: TodoSummary) => {
    try {
      const response = await fetchWithAuth(`/api/v1/todos/${record.id}/complete`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("待办已完成");
      await fetchTableData(searchParams, pagination.pageSize, pagination.current);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "完成待办失败";
      setPanelError(messageText);
      message.error(messageText);
    }
  };

  const handleAnalyze = async (record: TodoSummary) => {
    setAnalyzeLoading(true);
    try {
      const response = await fetchWithAuth(`/api/v1/todos/${record.id}/init-mindmap`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as { id: string; map_name?: string };
      message.success(`思维导图初始化成功${payload.map_name ? `：${payload.map_name}` : ""}`);
      router.push(`/admin/mindmap/edit/${payload.id}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "思维导图初始化失败";
      setPanelError(messageText);
      message.error(messageText);
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const columns: ColumnsType<TodoSummary> = [
    {
      title: "标题",
      dataIndex: "title",
      ellipsis: true,
      render: (_, record) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => {
            if (record.status === "COMPLETED" || record.status === "EXPIRED") {
              openDetailModal(record);
            } else {
              openEditModal(record);
            }
          }}
        >
          {record.title}
        </Button>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      align: "center",
      render: (status: TodoStatus) => <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>,
    },
    {
      title: "优先级",
      dataIndex: "priority",
      width: 120,
      align: "center",
      render: (priority: TodoPriority) => <Tag color={PRIORITY_COLOR[priority]}>{PRIORITY_LABEL[priority]}</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "create_date",
      width: 190,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: "操作",
      width: 220,
      align: "center",
      render: (_, record) => (
        <div className="flex items-center justify-center gap-3">
          <Tooltip title="分析">
            <Button type="text" size="small" onClick={() => void handleAnalyze(record)} loading={analyzeLoading}>
              分析
            </Button>
          </Tooltip>

          {record.status === "COMPLETED" || record.status === "EXPIRED" ? (
            <Tooltip title={record.status === "EXPIRED" ? "待办已过期" : "待办已完成"}>
              <Button
                type="text"
                size="small"
                disabled
                style={{ color: record.status === "EXPIRED" ? "var(--orange-9,#d97706)" : "var(--green-9,#15803d)" }}
              >
                完成
              </Button>
            </Tooltip>
          ) : (
            <Popconfirm title="确认完成该待办吗？" onConfirm={() => void handleComplete(record)}>
              <Tooltip title="完成">
                <Button type="text" size="small" disabled={!canProcess}>
                  完成
                </Button>
              </Tooltip>
            </Popconfirm>
          )}

          <Popconfirm title="确认删除该待办吗？" onConfirm={() => void handleDelete(record)}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger disabled={!canManage}>
                删除
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      ),
    },
  ];

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading todos...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问待办管理页面。</p>
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `todo.read`）。</p>
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
      {panelError && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">
          {panelError}
        </pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">待办列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">默认显示已计划任务，支持筛选、编辑、完成、删除。</p>
          </div>
          {canCreate && (
            <Button type="primary" onClick={openAddModal}>
              新建待办
            </Button>
          )}
        </div>

        <Form
          form={searchForm}
          layout="inline"
          initialValues={DEFAULT_SEARCH_PARAMS}
          onFinish={(values) => handleSearch(values as SearchParams)}
        >
          <Form.Item label="标题" name="title">
            <Input allowClear placeholder="请输入标题关键字" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              allowClear
              options={STATUS_OPTIONS}
              placeholder="请选择状态"
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item label="优先级" name="priority">
            <Select
              allowClear
              options={PRIORITY_OPTIONS}
              placeholder="请选择优先级"
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item>
            <div className="flex gap-2">
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </div>
          </Form.Item>
        </Form>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <Table<TodoSummary>
          columns={columns}
          dataSource={tableData}
          loading={tableLoading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showQuickJumper: true,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: handlePaginationChange,
          }}
          rowKey="id"
        />
      </section>

      <Modal
        title="新增待办"
        open={addModalVisible}
        onOk={() => void handleAddConfirm()}
        onCancel={() => setAddModalVisible(false)}
        destroyOnClose
      >
        <Form
          form={addForm}
          layout="vertical"
          initialValues={{ status: "SCHEDULED", priority: "MEDIUM", descr: "" }}
        >
          <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="请输入标题" />
          </Form.Item>
          <Form.Item label="详细描述" name="descr">
            <Input.TextArea placeholder="请输入详细描述" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select options={STATUS_OPTIONS.filter((item) => item.value !== "EXPIRED")} allowClear />
          </Form.Item>
          <Form.Item label="优先级" name="priority">
            <Select options={PRIORITY_OPTIONS} allowClear />
          </Form.Item>
          <Form.Item label="开始时间" name="start_time">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="截止时间" name="due_date">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="过期时间" name="expire_time">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑待办"
        open={editModalVisible}
        onOk={() => void handleEditConfirm()}
        onCancel={() => setEditModalVisible(false)}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="请输入标题" />
          </Form.Item>
          <Form.Item label="详细描述" name="descr">
            <Input.TextArea placeholder="请输入详细描述" autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={STATUS_OPTIONS.map((item) =>
                item.value === "EXPIRED" ? { ...item, disabled: true } : item,
              )}
              allowClear
            />
          </Form.Item>
          <Form.Item label="优先级" name="priority">
            <Select options={PRIORITY_OPTIONS} allowClear />
          </Form.Item>
          <Form.Item label="开始时间" name="start_time">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="截止时间" name="due_date">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="过期时间" name="expire_time">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="待办详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        {currentRecord && (
          <Descriptions
            column={1}
            items={[
              { label: "标题", children: currentRecord.title },
              { label: "详细描述", children: currentRecord.descr || "-" },
              {
                label: "状态",
                children: <Tag color={STATUS_COLOR[currentRecord.status]}>{STATUS_LABEL[currentRecord.status]}</Tag>,
              },
              {
                label: "优先级",
                children: (
                  <Tag color={PRIORITY_COLOR[currentRecord.priority]}>{PRIORITY_LABEL[currentRecord.priority]}</Tag>
                ),
              },
              { label: "开始时间", children: formatDateTime(currentRecord.start_time) },
              { label: "截止时间", children: formatDateTime(currentRecord.due_date) },
              { label: "过期时间", children: formatDateTime(currentRecord.expire_time) },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
