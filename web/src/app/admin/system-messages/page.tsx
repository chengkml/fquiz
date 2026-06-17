"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
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
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError } from "@/lib/api";
import type { SystemMessageListResponse, SystemMessageSummary, SystemMessageType } from "@/types/auth";

type CreateMessageValues = {
  title: string;
  content: string;
  message_type: SystemMessageType;
  target_user_id?: string;
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

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isSafeMarkdownLink(href: string): boolean {
  try {
    const parsed = new URL(href, "http://local.invalid");
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) || href.startsWith("/");
  } catch {
    return false;
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      nodes.push(<Typography.Text code key={key}>{token.slice(1, -1)}</Typography.Text>);
    } else if (token.startsWith("**")) {
      nodes.push(<Typography.Text strong key={key}>{token.slice(2, -2)}</Typography.Text>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch && isSafeMarkdownLink(linkMatch[2].trim())) {
        nodes.push(
          <Typography.Link
            href={linkMatch[2].trim()}
            key={key}
            rel="noreferrer"
            target={linkMatch[2].trim().startsWith("/") ? undefined : "_blank"}
          >
            {linkMatch[1]}
          </Typography.Link>,
        );
      } else if (linkMatch) {
        nodes.push(linkMatch[1]);
      } else {
        nodes.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function isUnorderedListLine(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

function isMarkdownBlockStart(line: string): boolean {
  return (
    line.startsWith("```")
    || /^#{1,6}\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || isUnorderedListLine(line)
    || isOrderedListLine(line)
  );
}

function renderMarkdownBlocks(content: string, compact: boolean): ReactNode[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre
          className="my-2 overflow-auto rounded-md border border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] p-3 text-xs leading-5"
          key={`code-${index}`}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = Math.min(5, headingMatch[1].length + 3) as 1 | 2 | 3 | 4 | 5;
      blocks.push(
        <Typography.Title className="!mb-2 !mt-3" key={`heading-${index}`} level={level}>
          {renderInlineMarkdown(headingMatch[2], `heading-${index}`)}
        </Typography.Title>,
      );
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          className="my-2 border-l-4 border-[var(--ant-color-border)] pl-3 text-[var(--ant-color-text-secondary)]"
          key={`quote-${index}`}
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <Typography.Paragraph className="!mb-1" key={`quote-${index}-${quoteIndex}`}>
              {renderInlineMarkdown(quoteLine, `quote-${index}-${quoteIndex}`)}
            </Typography.Paragraph>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (isUnorderedListLine(line) || isOrderedListLine(line)) {
      const ordered = isOrderedListLine(line);
      const listItems: string[] = [];
      while (
        index < lines.length
        && (ordered ? isOrderedListLine(lines[index]) : isUnorderedListLine(lines[index]))
      ) {
        listItems.push(lines[index].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, ""));
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          className={ordered ? "my-2 list-decimal pl-5" : "my-2 list-disc pl-5"}
          key={`list-${index}`}
        >
          {listItems.map((item, itemIndex) => (
            <li className="mb-1" key={`list-${index}-${itemIndex}`}>
              {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length
      && lines[index].trim()
      && !isMarkdownBlockStart(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <Typography.Paragraph className={compact ? "!mb-1" : "!mb-2"} key={`paragraph-${index}`}>
        {renderInlineMarkdown(paragraphLines.join(" "), `paragraph-${index}`)}
      </Typography.Paragraph>,
    );
  }

  return blocks;
}

function MarkdownPreview({
  content,
  compact = false,
  placeholder = "暂无内容",
}: {
  content: string;
  compact?: boolean;
  placeholder?: string;
}) {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return <Typography.Text type="secondary">{placeholder}</Typography.Text>;
  }

  return (
    <div
      className={
        compact
          ? "max-h-24 min-w-[260px] overflow-hidden text-sm leading-6"
          : "min-h-[180px] overflow-auto rounded-md border border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] p-3 text-sm leading-6"
      }
    >
      {renderMarkdownBlocks(trimmedContent, compact)}
    </div>
  );
}

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
  const contentPreview = Form.useWatch("content", formApi) ?? "";
  const [messageTypeFilter, setMessageTypeFilter] = useState<SystemMessageType | "all">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [createMessageModalOpen, setCreateMessageModalOpen] = useState(false);
  const [detailMessage, setDetailMessage] = useState<SystemMessageSummary | null>(null);
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
    mutationFn: async (values: CreateMessageValues) => {
      if (!canManage) {
        throw new Error("缺少 admin.system_message 权限");
      }

      const response = await fetchWithAuth("/api/v1/system-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title.trim(),
          content: values.content.trim(),
          message_type: values.message_type,
          target_user_id: values.target_user_id?.trim() || null,
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
      setCreateMessageModalOpen(false);
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

  const openCreateMessageModal = () => {
    setError("");
    setSuccess("");
    formApi.resetFields();
    setCreateMessageModalOpen(true);
  };

  const closeCreateMessageModal = () => {
    if (createMutation.isPending) return;
    setCreateMessageModalOpen(false);
    formApi.resetFields();
  };

  const handleSubmitCreateMessage = (values: CreateMessageValues) => {
    setError("");
    setSuccess("");
    createMutation.mutate(values);
  };

  const columns: TableColumnsType<SystemMessageSummary> = [
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
      render: (value: string) => <MarkdownPreview compact content={value} />,
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
      width: 190,
      fixed: "right",
      render: (_, item) => {
        const isDeleting = deletingMessageId === item.id;

        return (
          <Space size="small">
            <Button size="small" type="link" onClick={() => setDetailMessage(item)}>
              查看
            </Button>
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
                <Button danger disabled={isDeleting} loading={isDeleting} size="small" type="link">
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

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
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问系统消息页面。</p>
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
      <AntCard
        title="消息列表"
        extra={(
          <Space>
            {listQuery.isFetching && <Spin size="small" />}
            <Tag color="blue">总数 {listQuery.data?.total ?? 0}</Tag>
            <Tag color="processing">未读 {listQuery.data?.unread_count ?? 0}</Tag>
            <Button
              disabled={unreadIds.length === 0}
              loading={markReadMutation.isPending && unreadIds.some((id) => markReadMutation.variables?.includes(id))}
              onClick={() => markReadMutation.mutate(unreadIds)}
            >
              全部已读
            </Button>
            {canManage && (
              <Button type="primary" onClick={openCreateMessageModal}>
                发送消息
              </Button>
            )}
          </Space>
        )}
      >
        {listQuery.isError && (
          <Alert
            showIcon
            className="mb-4"
            type="error"
            message="系统消息加载失败"
            description={listQuery.error instanceof Error ? listQuery.error.message : "请检查后端服务。"}
          />
        )}

        {!canManage && (
          <Alert
            showIcon
            className="mb-4"
            type="info"
            message="当前账号仅可查看和标记自己的系统消息。"
          />
        )}

        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="类型" className="min-w-[170px]">
            <Select<SystemMessageType | "all">
              value={messageTypeFilter}
              options={[
                { label: "全部类型", value: "all" },
                ...MESSAGE_TYPE_OPTIONS,
              ]}
              onChange={setMessageTypeFilter}
            />
          </Form.Item>

          <Form.Item label="状态" className="min-w-[170px]">
            <Select<"all" | "unread">
              value={unreadOnly ? "unread" : "all"}
              options={[
                { label: "全部状态", value: "all" },
                { label: "仅未读", value: "unread" },
              ]}
              onChange={(value) => setUnreadOnly(value === "unread")}
            />
          </Form.Item>

          <Form.Item>
            <Button onClick={() => void listQuery.refetch()}>刷新</Button>
          </Form.Item>
        </Form>

        <Table<SystemMessageSummary>
          rowKey="id"
          className="mt-4"
          columns={columns}
          dataSource={messages}
          loading={listQuery.isFetching}
          locale={{ emptyText: <Empty description="暂无系统消息" /> }}
          pagination={{ pageSize: 20, showSizeChanger: true, hideOnSinglePage: false, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 1100 }}
        />
      </AntCard>

      <Modal
        title="发送消息"
        open={createMessageModalOpen}
        destroyOnClose
        width={960}
        onCancel={closeCreateMessageModal}
        onOk={() => formApi.submit()}
        okText="发送消息"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
      >
        <Form<CreateMessageValues>
          form={formApi}
          layout="vertical"
          initialValues={{ message_type: "info", target_user_id: "" }}
          onFinish={handleSubmitCreateMessage}
          autoComplete="off"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item
              label="标题"
              name="title"
              rules={[
                { required: true, message: "请输入标题" },
                { max: 255, message: "标题不能超过 255 字符" },
              ]}
            >
              <Input maxLength={255} placeholder="请输入消息标题" />
            </Form.Item>

            <Form.Item
              label="类型"
              name="message_type"
              rules={[{ required: true, message: "请选择类型" }]}
            >
              <Select options={MESSAGE_TYPE_OPTIONS} />
            </Form.Item>

            <Form.Item label="目标用户 ID" name="target_user_id" className="md:col-span-2">
              <Input allowClear placeholder="留空表示全员广播" />
            </Form.Item>
          </div>

          <Form.Item label="内容（Markdown）" required style={{ marginBottom: 0 }}>
            <div className="grid gap-3 md:grid-cols-2">
              <Form.Item
                name="content"
                rules={[{ required: true, message: "请输入内容" }]}
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea
                  autoSize={{ minRows: 10, maxRows: 18 }}
                  placeholder={"支持 Markdown，例如：\n# 标题\n- 列表项\n**重点内容**\n[链接](https://example.com)"}
                />
              </Form.Item>

              <div className="flex flex-col gap-2">
                <Typography.Text strong>预览</Typography.Text>
                <MarkdownPreview content={contentPreview} placeholder="输入 Markdown 后在这里预览" />
              </div>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={detailMessage ? detailMessage.title : "消息详情"}
        open={!!detailMessage}
        width={760}
        footer={null}
        onCancel={() => setDetailMessage(null)}
      >
        {detailMessage && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color={MESSAGE_TYPE_COLORS[detailMessage.message_type]}>
                {MESSAGE_TYPE_LABELS[detailMessage.message_type]}
              </Tag>
              <Tag color={detailMessage.is_read ? "default" : "processing"}>
                {detailMessage.is_read ? "已读" : "未读"}
              </Tag>
              <Typography.Text type="secondary">
                {detailMessage.target_user_id ? `用户：${detailMessage.target_user_id}` : "全员广播"}
              </Typography.Text>
              <Typography.Text type="secondary">
                {formatDateTime(detailMessage.created_at)}
              </Typography.Text>
            </Space>
            <MarkdownPreview content={detailMessage.content} />
          </Space>
        )}
      </Modal>
    </div>
  );
}
