"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  ChatMessage,
  ChatMessageListResponse,
  ChatSendResponse,
  ChatSession,
  ChatSessionListResponse,
} from "@/types/auth";

const SESSIONS_PATH = "/api/v1/chat/sessions";

function formatTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export default function AdminChatPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canUseChat = hasPermission("chat.use");

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const sessionsQuery = useQuery({
    queryKey: [SESSIONS_PATH],
    queryFn: async () => {
      const response = await fetchWithAuth(SESSIONS_PATH);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ChatSessionListResponse;
    },
    enabled: !!user && canUseChat,
  });

  const sessionItems = sessionsQuery.data?.items;
  const sessions = useMemo(() => sessionItems ?? [], [sessionItems]);
  const effectiveSessionId = useMemo(() => {
    if (activeSessionId && sessions.some((item) => item.id === activeSessionId)) {
      return activeSessionId;
    }
    return sessions[0]?.id ?? null;
  }, [activeSessionId, sessions]);
  const activeSession = useMemo(
    () => sessions.find((item) => item.id === effectiveSessionId) ?? null,
    [effectiveSessionId, sessions],
  );

  const messagesPath = effectiveSessionId ? `${SESSIONS_PATH}/${effectiveSessionId}/messages` : null;
  const messagesQuery = useQuery({
    queryKey: [messagesPath ?? "chat.messages.empty"],
    queryFn: async () => {
      if (!messagesPath) {
        return { items: [], total: 0 } satisfies ChatMessageListResponse;
      }
      const response = await fetchWithAuth(messagesPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ChatMessageListResponse;
    },
    enabled: !!user && canUseChat && !!messagesPath,
  });

  const messageItems = messagesQuery.data?.items;
  const messages = useMemo(() => messageItems ?? [], [messageItems]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const createSessionMutation = useMutation({
    mutationFn: async (): Promise<ChatSession> => {
      const response = await fetchWithAuth(SESSIONS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ChatSession;
    },
    onSuccess: async (session) => {
      setActiveSessionId(session.id);
      setFeedback("会话已创建");
      setError("");
      await queryClient.invalidateQueries({ queryKey: [SESSIONS_PATH] });
    },
    onError: (candidate) => {
      setFeedback("");
      setError(candidate instanceof Error ? candidate.message : "创建会话失败");
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (): Promise<ChatSendResponse> => {
      if (!effectiveSessionId) {
        throw new Error("请先选择会话");
      }
      const content = draft.trim();
      if (!content) {
        throw new Error("消息不能为空");
      }
      const response = await fetchWithAuth(`${SESSIONS_PATH}/${effectiveSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ChatSendResponse;
    },
    onSuccess: async () => {
      setDraft("");
      setFeedback("消息已发送");
      setError("");
      await queryClient.invalidateQueries({ queryKey: [SESSIONS_PATH] });
      if (messagesPath) {
        await queryClient.invalidateQueries({ queryKey: [messagesPath] });
      }
    },
    onError: (candidate) => {
      setFeedback("");
      setError(candidate instanceof Error ? candidate.message : "消息发送失败");
    },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    setFeedback("");
    setError("");
    sendMessageMutation.mutate();
  };

  const handlePressEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.shiftKey) {
      return;
    }
    const nativeEvent = event.nativeEvent as { isComposing?: boolean };
    if (nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (!effectiveSessionId || sendMessageMutation.isPending || !draft.trim()) {
      return;
    }
    submit();
  };

  const combinedError = useMemo(() => {
    if (error) {
      return error;
    }
    if (sessionsQuery.error instanceof Error) {
      return sessionsQuery.error.message;
    }
    if (messagesQuery.error instanceof Error) {
      return messagesQuery.error.message;
    }
    return "";
  }, [error, messagesQuery.error, sessionsQuery.error]);

  if (initializing) {
    return (
      <Card>
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">Loading chat workspace...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (!user) {
    return <Alert type="info" showIcon message="请先登录后再使用 AI 聊天。" />;
  }

  if (!canUseChat) {
    return <Alert type="error" showIcon message="当前账号没有 `chat.use` 权限。" />;
  }

  return (
    <Space direction="vertical" size={16} className="w-full">
      {combinedError ? <Alert type="error" showIcon closable message={combinedError} /> : null}
      {feedback ? <Alert type="success" showIcon closable message={feedback} /> : null}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card
          size="small"
          title="会话列表"
          extra={(
            <Button
              type="default"
              onClick={() => createSessionMutation.mutate()}
              loading={createSessionMutation.isPending}
            >
              新建会话
            </Button>
          )}
        >
          {sessionsQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spin />
            </div>
          ) : sessions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无会话，点击“新建会话”开始。"
            >
              <Button type="primary" onClick={() => createSessionMutation.mutate()}>
                新建会话
              </Button>
            </Empty>
          ) : (
            <List
              dataSource={sessions}
              split={false}
              renderItem={(session) => {
                const selected = effectiveSessionId === session.id;
                return (
                  <List.Item style={{ paddingInline: 0, border: "none", paddingBlock: 4 }}>
                    <Button
                      block
                      type={selected ? "primary" : "text"}
                      onClick={() => setActiveSessionId(session.id)}
                      style={{
                        height: "auto",
                        textAlign: "left",
                        justifyContent: "flex-start",
                        padding: "10px 12px",
                      }}
                    >
                      <Space direction="vertical" size={2} style={{ width: "100%" }}>
                        <Typography.Text ellipsis strong>
                          {session.title || "未命名会话"}
                        </Typography.Text>
                        <Typography.Text type={selected ? undefined : "secondary"} style={{ fontSize: 12 }}>
                          {formatTime(session.last_message_at || session.updated_at)}
                        </Typography.Text>
                      </Space>
                    </Button>
                  </List.Item>
                );
              }}
            />
          )}
        </Card>

        <Card
          size="small"
          title={activeSession?.title || "请选择会话"}
          extra={
            activeSession?.model_code ? <Tag>{activeSession.model_code}</Tag> : <Tag>chat.default -&gt; GLOBAL</Tag>
          }
        >
          <div className="flex min-h-[70vh] flex-col">
            <Typography.Text type="secondary" className="mb-3 text-xs">
              {activeSession?.model_code
                ? "最近使用模型"
                : "模型将按 chat.default -> GLOBAL 路由规则自动选择"}
            </Typography.Text>

            <div className="flex-1 overflow-y-auto pr-1">
              {!effectiveSessionId ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先创建或选择会话。" />
                </div>
              ) : messagesQuery.isLoading ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Spin />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无消息，发送第一条消息开始对话。" />
                </div>
              ) : (
                <List
                  dataSource={messages}
                  split={false}
                  renderItem={(message) => (
                    <List.Item key={message.id} style={{ border: "none", paddingBlock: 6, paddingInline: 0 }}>
                      <MessageItem message={message} currentUserId={user.id} />
                    </List.Item>
                  )}
                />
              )}
              <div ref={messageEndRef} />
            </div>

            <Form layout="vertical" className="mt-4 border-t border-[var(--border)] pt-4" onSubmitCapture={submit}>
              <Form.Item label="输入消息" required className="mb-3">
                <Input.TextArea
                  rows={3}
                  placeholder="请输入你的问题..."
                  value={draft}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
                  onPressEnter={handlePressEnter}
                  disabled={!effectiveSessionId || sendMessageMutation.isPending}
                />
              </Form.Item>
              <div className="flex items-center justify-between gap-3">
                <Typography.Text type="secondary" className="text-xs">
                  Enter 发送，Shift + Enter 换行
                </Typography.Text>
                <Button
                  htmlType="submit"
                  type="primary"
                  loading={sendMessageMutation.isPending}
                  disabled={!effectiveSessionId || sendMessageMutation.isPending || !draft.trim()}
                >
                  发送
                </Button>
              </div>
            </Form>
          </div>
        </Card>
      </div>
    </Space>
  );
}

function MessageItem({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const fromCurrentUser = message.role === "user" && message.author_user_id === currentUserId;
  const isAssistant = message.role === "assistant";

  const bubbleStyle: CSSProperties = fromCurrentUser
    ? {
        background: "var(--accent-9)",
        borderColor: "var(--accent-7)",
        color: "var(--accent-contrast, #fff)",
      }
    : message.is_error
      ? {
          background: "var(--red-a2)",
          borderColor: "var(--red-6)",
          color: "var(--red-11)",
        }
      : {};

  return (
    <div className={`flex ${fromCurrentUser ? "justify-end" : "justify-start"}`}>
      <Card size="small" className="max-w-[90%]" style={bubbleStyle}>
        <Typography.Paragraph
          style={{
            marginBottom: 8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: fromCurrentUser ? "inherit" : undefined,
          }}
        >
          {message.content}
        </Typography.Paragraph>

        <Space size={6} wrap>
          <Typography.Text
            type={fromCurrentUser ? undefined : "secondary"}
            style={{
              fontSize: 12,
              color: fromCurrentUser ? "var(--accent-a2)" : undefined,
            }}
          >
            {formatTime(message.created_at)}
          </Typography.Text>
          {isAssistant && message.model_code ? <Tag>{message.model_code}</Tag> : null}
          {isAssistant && message.total_tokens !== null ? <Tag>tokens {message.total_tokens}</Tag> : null}
          {isAssistant && message.latency_ms !== null ? <Tag>{message.latency_ms}ms</Tag> : null}
        </Space>
      </Card>
    </div>
  );
}
