"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  SystemMessageLevel,
  SystemMessageListResponse,
  SystemMessageStatus,
  SystemMessageSummary,
} from "@/types/auth";

type StatusFilter = "all" | SystemMessageStatus;
type LevelFilter = "all" | SystemMessageLevel;

type PromptFormValues = {
  title: string;
  content: string;
  level: SystemMessageLevel;
  status: SystemMessageStatus;
  start_at: Dayjs | null;
  end_at: Dayjs | null;
};

const DEFAULT_FORM_VALUES: PromptFormValues = {
  title: "",
  content: "",
  level: "info",
  status: "draft",
  start_at: null,
  end_at: null,
};

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "全部", value: "all" },
  { label: "草稿", value: "draft" },
  { label: "已发布", value: "published" },
  { label: "已归档", value: "archived" },
];

const LEVEL_OPTIONS: Array<{ label: string; value: LevelFilter }> = [
  { label: "全部", value: "all" },
  { label: "信息", value: "info" },
  { label: "成功", value: "success" },
  { label: "警告", value: "warning" },
  { label: "错误", value: "error" },
];

function levelText(level: SystemMessageLevel): string {
  if (level === "success") return "成功";
  if (level === "warning") return "警告";
  if (level === "error") return "错误";
  return "信息";
}

function levelColor(level: SystemMessageLevel): string {
  if (level === "success") return "success";
  if (level === "warning") return "warning";
  if (level === "error") return "error";
  return "processing";
}

function statusText(status: SystemMessageStatus): string {
  if (status === "published") return "已发布";
  if (status === "archived") return "已归档";
  return "草稿";
}

function statusColor(status: SystemMessageStatus): string {
  if (status === "published") return "success";
  if (status === "archived") return "default";
  return "gold";
}

function toPickerValue(value: string | null): Dayjs | null {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function toUtcIso(value: Dayjs | null | undefined): string | null {
  if (!value) return null;
  return value.toDate().toISOString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = dayjs(value);
  if (!parsed.isValid()) return "-";
  return parsed.format("YYYY-MM-DD HH:mm:ss");
}

export default function AdminSystemMessagePage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PromptFormValues>();
  const [messageApi, messageContextHolder] = message.useMessage();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("system_message.read") || hasPermission("system_message.manage");
  const canManage = hasPermission("system_message.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (levelFilter !== "all") {
      params.set("level", levelFilter);
    }
    const queryString = params.toString();
    return `/api/v1/admin/system-messages${queryString ? `?${queryString}` : ""}`;
  }, [keyword, statusFilter, levelFilter]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemMessageListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/system-messages"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.system-messages",
    useCallback(() => {
      void refreshList();
    }, [refreshList]),
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    form.setFieldsValue(DEFAULT_FORM_VALUES);
    form.resetFields();
  }, [form]);

  const startCreate = useCallback(() => {
    setError("");
    setSuccess("");
    resetForm();
  }, [resetForm]);

  const startEdit = useCallback(
    (item: SystemMessageSummary) => {
      setError("");
      setSuccess("");
      setEditingId(item.id);
      form.setFieldsValue({
        title: item.title,
        content: item.content,
        level: item.level,
        status: item.status,
        start_at: toPickerValue(item.start_at),
        end_at: toPickerValue(item.end_at),
      });
    },
    [form],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: PromptFormValues) => {
      if (!canManage) {
        throw new Error("缺少 system_message.manage 权限");
      }

      const payload = {
        title: values.title.trim(),
        content: values.content.trim(),
        level: values.level,
        status: values.status,
        start_at: toUtcIso(values.start_at),
        end_at: toUtcIso(values.end_at),
      };

      if (editingId === null) {
        const response = await fetchWithAuth("/api/v1/admin/system-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created" as const;
      }

      const response = await fetchWithAuth(`/api/v1/admin/system-messages/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "updated" as const;
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "提示词已创建" : "提示词已更新");
      messageApi.success(mode === "created" ? "创建成功" : "保存成功");
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      const nextError = candidate instanceof Error ? candidate.message : "保存失败";
      setError(nextError);
      messageApi.error(nextError);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: SystemMessageSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/system-messages/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return item.id;
    },
    onSuccess: async (deletedId) => {
      if (editingId === deletedId) {
        resetForm();
      }
      setError("");
      setSuccess("提示词已删除");
      messageApi.success("删除成功");
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      const nextError = candidate instanceof Error ? candidate.message : "删除失败";
      setError(nextError);
      messageApi.error(nextError);
    },
  });

  const handleSubmit = (values: PromptFormValues) => {
    setError("");
    setSuccess("");
    saveMutation.mutate(values);
  };

  const handleResetFilters = useCallback(() => {
    setKeyword("");
    setStatusFilter("all");
    setLevelFilter("all");
  }, []);

  const items = listQuery.data?.items ?? [];
  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";

  const columns = useMemo<ColumnsType<SystemMessageSummary>>(
    () => {
      const baseColumns: ColumnsType<SystemMessageSummary> = [
        {
          title: "ID",
          dataIndex: "id",
          key: "id",
          width: 90,
        },
        {
          title: "标题 / 内容",
          key: "content",
          render: (_, record) => (
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{record.title}</Typography.Text>
              <Typography.Text type="secondary" ellipsis={{ tooltip: record.content }}>
                {record.content}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: "等级",
          key: "level",
          dataIndex: "level",
          width: 100,
          render: (value: SystemMessageLevel) => <Tag color={levelColor(value)}>{levelText(value)}</Tag>,
        },
        {
          title: "状态",
          key: "status",
          dataIndex: "status",
          width: 110,
          render: (value: SystemMessageStatus) => <Tag color={statusColor(value)}>{statusText(value)}</Tag>,
        },
        {
          title: "有效期",
          key: "period",
          width: 300,
          render: (_, record) => (
            <Typography.Text type="secondary">
              {formatDateTime(record.start_at)} ~ {formatDateTime(record.end_at)}
            </Typography.Text>
          ),
        },
        {
          title: "更新时间",
          key: "updated_at",
          dataIndex: "updated_at",
          width: 180,
          render: (value: string) => formatDateTime(value),
        },
      ];

      if (!canManage) {
        return baseColumns;
      }

      baseColumns.push({
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 170,
        render: (_, item) => (
          <Space>
            <Button size="small" onClick={() => startEdit(item)}>
              编辑
            </Button>
            <Popconfirm
              title="删除提示词"
              description={`确认删除「${item.title}」吗？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate(item)}
            >
              <Button size="small" danger loading={deleteMutation.isPending}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      });

      return baseColumns;
    },
    [canManage, deleteMutation, startEdit],
  );

  if (initializing) {
    return (
      <div className="flex justify-center py-16">
        <Spin size="large" tip="正在加载提示词页面..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Alert message="请先登录后再访问提示词管理页面。" type="info" showIcon />
        <Link href="/">
          <Button type="default">返回首页</Button>
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Alert message="你没有访问该页面的权限（需要 system_message.read）。" type="warning" showIcon />
        <Link href="/">
          <Button type="default">返回首页</Button>
        </Link>
      </main>
    );
  }

  return (
    <Space direction="vertical" size="large" className="w-full">
      {messageContextHolder}

      {(error || listError) && (
        <Alert
          type="error"
          showIcon
          message="操作失败"
          description={error || listError}
          closable
          onClose={() => setError("")}
        />
      )}

      {success && (
        <Alert
          type="success"
          showIcon
          message="操作成功"
          description={success}
          closable
          onClose={() => setSuccess("")}
        />
      )}

      <Card
        title="提示词列表"
        extra={
          canManage ? (
            <Button type="primary" onClick={startCreate}>
              新建提示词
            </Button>
          ) : null
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          复用 system-message 接口维护提示词内容，支持关键词、状态、等级筛选。
        </Typography.Paragraph>

        <Form layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="关键词">
                <Input
                  allowClear
                  placeholder="按标题或内容筛选"
                  value={keyword}
                  onChange={(event) => setKeyword(event.currentTarget.value)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="状态">
                <Select
                  value={statusFilter}
                  options={STATUS_OPTIONS}
                  onChange={(value) => setStatusFilter(value)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="等级">
                <Select
                  value={levelFilter}
                  options={LEVEL_OPTIONS}
                  onChange={(value) => setLevelFilter(value)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item label=" " colon={false}>
                <Button block onClick={handleResetFilters}>
                  重置筛选
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Table<SystemMessageSummary>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={listQuery.isFetching}
          scroll={{ x: 980 }}
          pagination={false}
          locale={{
            emptyText: listQuery.isLoading ? (
              <Spin />
            ) : (
              <Empty description="未找到符合条件的提示词" />
            ),
          }}
        />
      </Card>

      {canManage && (
        <Card title={editingId === null ? "新建提示词" : `编辑提示词 #${editingId}`}>
          <Form<PromptFormValues>
            form={form}
            layout="vertical"
            initialValues={DEFAULT_FORM_VALUES}
            onFinish={handleSubmit}
          >
            <Form.Item
              label="标题"
              name="title"
              rules={[{ required: true, whitespace: true, message: "请输入标题" }]}
            >
              <Input placeholder="请输入提示词标题" maxLength={120} showCount />
            </Form.Item>

            <Form.Item
              label="内容"
              name="content"
              rules={[{ required: true, whitespace: true, message: "请输入内容" }]}
            >
              <Input.TextArea rows={6} placeholder="请输入提示词内容" showCount maxLength={5000} />
            </Form.Item>

            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item label="等级" name="level" rules={[{ required: true, message: "请选择等级" }]}>
                  <Select
                    options={LEVEL_OPTIONS.filter((item) => item.value !== "all")}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
                  <Select options={STATUS_OPTIONS.filter((item) => item.value !== "all")} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="生效时间" name="start_at">
                  <DatePicker showTime className="w-full" placeholder="可选" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  label="失效时间"
                  name="end_at"
                  dependencies={["start_at"]}
                  rules={[
                    ({ getFieldValue }) => ({
                      validator(_, value: Dayjs | null) {
                        const start = getFieldValue("start_at") as Dayjs | null;
                        if (!value || !start || value.isAfter(start)) {
                          return Promise.resolve();
                        }
                        return Promise.reject(new Error("失效时间需晚于生效时间"));
                      },
                    }),
                  ]}
                >
                  <DatePicker showTime className="w-full" placeholder="可选" />
                </Form.Item>
              </Col>
            </Row>

            <Space>
              <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                {saveMutation.isPending ? "提交中..." : editingId === null ? "创建" : "保存"}
              </Button>
              <Button onClick={resetForm}>重置</Button>
            </Space>
          </Form>
        </Card>
      )}
    </Space>
  );
}
