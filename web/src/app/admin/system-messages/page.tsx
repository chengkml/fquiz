"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
  type TableColumnsType,
} from "antd";
import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError } from "@/lib/api";
import type { SystemMessageListResponse, SystemMessageSummary, SystemMessageType } from "@/types/auth";

type CreateMessageValues = {
  title: string;
  content: string;
  message_type: SystemMessageType;
  target_user_id: string;
};

const AntCard = Card as unknown as ComponentType<CardProps>;

const MESSAGE_TYPE_OPTIONS: Array<{ label: string; value: SystemMessageType }> = [
  { label: "通知", value: "info" },
  { label: "成功", value: "success" },
  { label: "警告", value: "warning" },
  { label: "错误", value: "error" },
];

const MESSAGE_TYPE_LABELS: Record<SystemMessageType, string> = {
  info: "通知",
  success: "成功",
  warning: "警告",
  error: "错误",
};

const MESSAGE_TYPE_COLORS: Record<SystemMessageType, string> = {
  info: "blue",
  success: "green",
  warning: "orange",
  error: "red",
};

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN");
}

export default function AdminSystemMessagesPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [formApi] = Form.useForm<CreateMessageValues>();
  const [messageTypeFilter, setMessageTypeFilter] = useState<SystemMessageType | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("admin.system_message");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (unreadOnly) {
      params.set("unread_only", "true");
    }
    const qs = params.toString();
    return `/api/v1/system-messages/me?${qs}`;
  }, [unreadOnly]);

  const listQuery = useQuery({
    queryKey: ["admin.system-messages", listPath],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemMessageListResponse;
    },
  });

  const refreshMessages = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin.system-messages"] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 admin.system_message 权限");
      }

      const values = await formApi.validateFields();
      const response = await fetchWithAuth("/api/v1/system-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title.trim(),
          content: values.content.trim(),
          message_type: values.message_type,
          target_user_id: values.target_user_id.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemMessageSummary;
    },
    onSuccess: async () => {
      setError("");
      setSuccess("系统消息已发送");
      formApi.resetFields();
      await refreshMessages();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "发送失败");
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (messageIds: string[]) => {
      const response = await fetchWithAuth("/api/v1/system-messages/me/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_ids: messageIds }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json() as Promise<{ affected: number }>;
    },
    onSuccess: async () => {
      setError("");
      setSuccess("消息已标记为已读");
      await refreshMessages();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "标记已读失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!canManage) {
        throw new Error("缺少 admin.system_message 权限");
      }

      const response = await fetchWithAuth(`/api/v1/system-messages/${messageId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json() as Promise<{ message: string }>;
    },
    onMutate: (messageId) => {
      setDeletingMessageId(messageId);
      setSuccess("");
      setError("");
    },
    onSuccess: async () => {
      setError("");
      setSuccess("系统消息已删除");
      await refreshMessages();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
    onSettled: () => {
      setDeletingMessageId(null);
    },
  });

  useToastFeedback({
    errorMessage: error,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const messages = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    if (messageTypeFilter === "all") {
      return items;
    }
    return items.filter((item) => item.message_type === messageTypeFilter);
  }, [listQuery.data?.items, messageTypeFilter]);

  const unreadIds = useMemo(
    () => messages.filter((item) => !item.is_read).map((item) => item.id),
    [messages],
  );

  const columns = useMemo<TableColumnsType<SystemMessageSummary>>(
    () => [
      {
        title: "标题",
        dataIndex: "title",
        key: "title",
        width: 220,
        render: (_, item) => (
          <Space direction="vertical" size={2}>
            <Typography.Text strong={!item.is_read}>{item.title}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {item.target_user_id ? `用户：${item.target_user_id}` : "全员广播"}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "类型",
        dataIndex: "message_type",
        key: "message_type",
        width: 90,
        render: (value: SystemMessageType) => (
          <Tag color={MESSAGE_TYPE_COLORS[value]}>{MESSAGE_TYPE_LABELS[value]}</Tag>
        ),
      },
      {
        title: "内容",
        dataIndex: "content",
        key: "content",
        ellipsis: true,
        render: (value: string) => <Typography.Text>{value}</Typography.Text>,
      },
      {
        title: "状态",
        dataIndex: "is_read",
        key: "is_read",
        width: 90,
        render: (value: boolean) => (
          <Tag color={value ? "default" : "processing"}>{value ? "已读" : "未读"}</Tag>
        ),
      },
      {
        title: "创建时间",
        dataIndex: "created_at",
        key: "created_at",
        width: 180,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "操作",
        key: "actions",
        width: 120,
        fixed: "right",
        render: (_, item) => {
          const isDeleting = deletingMessageId === item.id;

          return (
            <Space size="small">
              <Button
                disabled={item.is_read || isDeleting}
                loading={markReadMutation.isPending && markReadMutation.variables?.includes(item.id)}
                size="small"
                type="link"
                onClick={() => markReadMutation.mutate([item.id])}
              >
                标记已读
              </Button>
              {canManage && (
                <Popconfirm
                  title="删除系统消息"
                  description={`确认删除系统消息「${item.title}」吗？`}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true, loading: isDeleting }}
                  onConfirm={() => deleteMutation.mutate(item.id)}
                >
                  <Button danger loading={isDeleting} size="small" type="link">
                    删除
                  </Button>
                </Popconfirm>
              )}
            </Space>
          );
        },
      },
    ],
    [canManage, deleteMutation, deletingMessageId, markReadMutation],
  );

  if (initializing) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space align="start" direction="vertical" size={4}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          系统消息
        </Typography.Title>
        <Typography.Text type="secondary">
          管理当前账号可见的系统消息，并发送全员或指定用户通知。
        </Typography.Text>
      </Space>

      {listQuery.isError && (
        <Alert
          showIcon
          type="error"
          message="系统消息加载失败"
          description={listQuery.error instanceof Error ? listQuery.error.message : "请检查后端服务。"}
        />
      )}

      {canManage && (
        <AntCard title="发送消息">
          <Form
            form={formApi}
            layout="vertical"
            initialValues={{ message_type: "info", target_user_id: "" }}
            onFinish={() => createMutation.mutate()}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px_260px]">
              <Form.Item
                label="标题"
                name="title"
                rules={[{ required: true, message: "请输入标题" }]}
              >
                <Input maxLength={255} placeholder="请输入消息标题" />
              </Form.Item>

              <Form.Item label="类型" name="message_type">
                <Select options={MESSAGE_TYPE_OPTIONS} />
              </Form.Item>

              <Form.Item label="目标用户 ID" name="target_user_id">
                <Input allowClear placeholder="留空表示全员广播" />
              </Form.Item>
            </div>

            <Form.Item
              label="内容"
              name="content"
              rules={[{ required: true, message: "请输入内容" }]}
            >
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="请输入消息内容" />
            </Form.Item>

            <Space>
              <Button htmlType="submit" loading={createMutation.isPending} type="primary">
                发送消息
              </Button>
              <Button htmlType="button" onClick={() => formApi.resetFields()}>
                重置
              </Button>
            </Space>
          </Form>
        </AntCard>
      )}

      {!canManage && (
        <Alert
          showIcon
          type="info"
          message="当前账号仅可查看和标记自己的系统消息。"
        />
      )}

      <AntCard
        title={(
          <Space wrap>
            <span>消息列表</span>
            <Tag color="blue">总数 {listQuery.data?.total ?? 0}</Tag>
            <Tag color="processing">未读 {listQuery.data?.unread_count ?? 0}</Tag>
          </Space>
        )}
        extra={(
          <Space wrap>
            <Select
              style={{ width: 132 }}
              value={messageTypeFilter}
              options={[
                { label: "全部类型", value: "all" },
                ...MESSAGE_TYPE_OPTIONS,
              ]}
              onChange={setMessageTypeFilter}
            />
            <Select
              style={{ width: 112 }}
              value={unreadOnly ? "unread" : "all"}
              options={[
                { label: "全部状态", value: "all" },
                { label: "仅未读", value: "unread" },
              ]}
              onChange={(value) => setUnreadOnly(value === "unread")}
            />
            <Button onClick={() => void listQuery.refetch()}>刷新</Button>
            <Button
              disabled={unreadIds.length === 0}
              loading={markReadMutation.isPending && unreadIds.some((id) => markReadMutation.variables?.includes(id))}
              onClick={() => markReadMutation.mutate(unreadIds)}
            >
              全部已读
            </Button>
          </Space>
        )}
      >
        <Table<SystemMessageSummary>
          rowKey="id"
          columns={columns}
          dataSource={messages}
          loading={listQuery.isFetching}
          locale={{ emptyText: <Empty description="暂无系统消息" /> }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 980 }}
        />
      </AntCard>
    </Space>
  );
}
