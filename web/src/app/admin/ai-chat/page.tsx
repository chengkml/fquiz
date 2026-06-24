"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  type CardProps,
} from "antd";
import {
  PlusOutlined,
  SendOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefAttributes } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError, API_BASE_URL } from "@/lib/api";
import type {
  AiChatConversation,
  AiChatConversationListResponse,
  AiChatMessage,
} from "@/types/ai-chat";

const { TextArea } = Input;
const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

type ChatStreamEvent =
  | { type: "message"; message: AiChatMessage }
  | { type: "delta"; content: string }
  | { type: "done"; reply: AiChatMessage };

export default function AiChatPage() {
  const { user, initializing, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState("新对话");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Record<number, AiChatMessage[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useToastFeedback({
    errorMessage: error,
    successMessage: success,
    errorTitle: "操作失败",
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const { data: conversations, isLoading: convLoading } = useQuery({
    queryKey: ["ai-chat-conversations"],
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations?limit=100`
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AiChatConversationListResponse;
    },
    enabled: !!user,
  });

  const { data: currentConv, isLoading: convDetailLoading } = useQuery({
    queryKey: ["ai-chat-conversation", selectedConvId],
    queryFn: async () => {
      if (!selectedConvId) return null;
      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations/${selectedConvId}`
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AiChatConversation;
    },
    enabled: !!selectedConvId,
  });

  const createConvMutation = useMutation({
    mutationFn: async (title: string) => {
      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AiChatConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat-conversations"] });
      setSelectedConvId(data.id);
      setCreateModalOpen(false);
      setNewConvTitle("新对话");
      setSuccess("创建对话成功");
    },
    onError: (err: Error) => {
      setError(`创建对话失败: ${err.message}`);
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations/${id}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-chat-conversations"] });
      setSelectedConvId(null);
      setSuccess("删除对话成功");
    },
    onError: (err: Error) => {
      setError(`删除对话失败: ${err.message}`);
    },
  });

  const currentMessages = useMemo(
    () => (selectedConvId ? optimisticMessages[selectedConvId] ?? currentConv?.messages ?? [] : []),
    [currentConv?.messages, optimisticMessages, selectedConvId],
  );

  const updateOptimisticMessages = useCallback(
    (convId: number, updater: (messages: AiChatMessage[]) => AiChatMessage[]) => {
      setOptimisticMessages((current) => ({
        ...current,
        [convId]: updater(current[convId] ?? currentConv?.messages ?? []),
      }));
    },
    [currentConv?.messages],
  );

  const readChatStream = useCallback(
    async (convId: number, content: string) => {
      const now = new Date().toISOString();
      const assistantTempId = -Date.now();
      const userTempId = assistantTempId - 1;
      const userMessage: AiChatMessage = {
        id: userTempId,
        conversation_id: convId,
        role: "user",
        content,
        created_at: now,
      };
      const assistantMessage: AiChatMessage = {
        id: assistantTempId,
        conversation_id: convId,
        role: "assistant",
        content: "",
        created_at: now,
      };

      setStreamingMessageId(assistantTempId);
      updateOptimisticMessages(convId, (messages) => [...messages, userMessage, assistantMessage]);

      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations/${convId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      if (!response.body) {
        throw new Error("浏览器未返回流式响应体");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const applyStreamEvent = (event: ChatStreamEvent) => {
        if (event.type === "message") {
          updateOptimisticMessages(convId, (messages) =>
            messages.map((msg) => (msg.id === userTempId ? event.message : msg)),
          );
          return;
        }

        if (event.type === "delta") {
          updateOptimisticMessages(convId, (messages) =>
            messages.map((msg) =>
              msg.id === assistantTempId
                ? { ...msg, content: `${msg.content}${event.content}` }
                : msg,
            ),
          );
          return;
        }

        updateOptimisticMessages(convId, (messages) =>
          messages.map((msg) => (msg.id === assistantTempId ? event.reply : msg)),
        );
      };

      const parseBufferedEvents = () => {
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          applyStreamEvent(JSON.parse(trimmed) as ChatStreamEvent);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        parseBufferedEvents();
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        applyStreamEvent(JSON.parse(buffer.trim()) as ChatStreamEvent);
      }

      await queryClient.invalidateQueries({ queryKey: ["ai-chat-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["ai-chat-conversation", convId] });
    },
    [fetchWithAuth, queryClient, updateOptimisticMessages],
  );

  const sendMessageMutation = useMutation({
    mutationFn: async ({ convId, content }: { convId: number; content: string }) => {
      await readChatStream(convId, content);
    },
    onSuccess: (_, variables) => {
      setMessageInput("");
      setStreamingMessageId(null);
      setOptimisticMessages((current) => {
        const next = { ...current };
        delete next[variables.convId];
        return next;
      });
    },
    onError: (err: Error, variables) => {
      setStreamingMessageId(null);
      setOptimisticMessages((current) => {
        const next = { ...current };
        delete next[variables.convId];
        return next;
      });
      queryClient.invalidateQueries({
        queryKey: ["ai-chat-conversation", variables.convId],
      });
      setError(`发送消息失败: ${err.message}`);
    },
  });

  const handleSendMessage = useCallback(() => {
    if (!selectedConvId || !messageInput.trim()) return;
    sendMessageMutation.mutate({
      convId: selectedConvId,
      content: messageInput.trim(),
    });
  }, [selectedConvId, messageInput, sendMessageMutation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages]);

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AntCard
        className="admin-ai-chat-page-card"
        title="AI 问答助手"
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            新建对话
          </Button>
        }
      >
        <Row gutter={[24, 24]} style={{ height: "100%" }}>
          <Col xs={24} lg={7} xl={6}>
            <AntCard
              title="对话列表"
              size="small"
              styles={{
                body: {
                  padding: 0,
                  maxHeight: "calc(100vh - 280px)",
                  minHeight: 500,
                  overflowY: "auto"
                }
              }}
            >
              {convLoading ? (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <Spin />
                </div>
              ) : conversations?.items.length === 0 ? (
                <Empty
                  description="暂无对话"
                  style={{ padding: "60px 20px" }}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <List
                  dataSource={conversations?.items || []}
                  renderItem={(conv) => (
                    <List.Item
                      key={conv.id}
                      onClick={() => setSelectedConvId(conv.id)}
                      style={{
                        cursor: "pointer",
                        background:
                          selectedConvId === conv.id
                            ? "var(--ant-color-primary-bg)"
                            : "transparent",
                        padding: "16px",
                        transition: "all 0.2s ease",
                        borderLeft: selectedConvId === conv.id ? "3px solid var(--ant-color-primary)" : "3px solid transparent",
                      }}
                      actions={[
                        <Popconfirm
                          key="delete"
                          title="确认删除"
                          description="删除后将无法恢复，确定删除此对话吗？"
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            deleteConvMutation.mutate(conv.id);
                          }}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Button
                            danger
                            size="small"
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={<span style={{ fontSize: 14, fontWeight: 500 }}>{conv.title}</span>}
                        description={
                          <Space size={6}>
                            <Tag color="blue" style={{ fontSize: 12 }}>{conv.message_count || 0} 条消息</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {new Date(conv.updated_at).toLocaleString("zh-CN", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </AntCard>
          </Col>

          <Col xs={24} lg={17} xl={18}>
            <AntCard
              title={currentConv ? currentConv.title : "AI 对话"}
              size="small"
              styles={{
                body: {
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  height: "calc(100vh - 280px)",
                  minHeight: 500,
                },
              }}
            >
              {!selectedConvId ? (
                <Empty
                  description="请选择或创建一个对话开始聊天"
                  style={{ margin: "auto" }}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <>
                  <div
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      padding: "20px 16px",
                      background: "var(--ant-color-bg-layout)",
                    }}
                  >
                    {convDetailLoading ? (
                      <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin />
                      </div>
                    ) : (
                      <Space direction="vertical" style={{ width: "100%" }} size={16}>
                        {currentMessages.map((msg) => (
                          <div
                            key={msg.id}
                            style={{
                              display: "flex",
                              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                              gap: 8,
                            }}
                          >
                            <Card
                              size="small"
                              style={{
                                maxWidth: "75%",
                                background:
                                  msg.role === "user"
                                    ? "var(--ant-color-primary)"
                                    : "var(--ant-color-bg-container)",
                                border:
                                  msg.role === "user"
                                    ? "1px solid var(--ant-color-primary)"
                                    : "1px solid var(--ant-color-border)",
                                borderRadius: 12,
                                boxShadow: msg.role === "user"
                                  ? "0 2px 8px rgba(139, 92, 246, 0.15)"
                                  : "0 2px 8px rgba(0, 0, 0, 0.06)",
                              }}
                              styles={{
                                body: {
                                  padding: "12px 16px",
                                }
                              }}
                            >
                              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                <Text
                                  strong
                                  style={{
                                    color:
                                      msg.role === "user"
                                        ? "var(--ant-color-white)"
                                        : "var(--ant-color-text)",
                                    fontSize: 13,
                                  }}
                                >
                                  {msg.role === "user" ? "我" : "AI 助手"}
                                </Text>
                                <div
                                  style={{
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    color:
                                      msg.role === "user"
                                        ? "var(--ant-color-white)"
                                        : "var(--ant-color-text)",
                                    lineHeight: 1.6,
                                    fontSize: 14,
                                  }}
                                >
                                  {msg.content || (msg.id === streamingMessageId ? "正在回复..." : "")}
                                </div>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 12,
                                    color:
                                      msg.role === "user"
                                        ? "rgba(255, 255, 255, 0.75)"
                                        : "var(--ant-color-text-secondary)",
                                  }}
                                >
                                  {new Date(msg.created_at).toLocaleTimeString("zh-CN")}
                                </Text>
                              </Space>
                            </Card>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </Space>
                    )}
                  </div>

                  <div
                    style={{
                      padding: "16px 20px",
                      borderTop: "1px solid var(--ant-color-border)",
                      background: "var(--ant-color-bg-container)",
                    }}
                  >
                    <Space.Compact style={{ width: "100%", gap: 8 }}>
                      <TextArea
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder="输入消息...（Shift + Enter 换行，Enter 发送）"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        onPressEnter={(e) => {
                          if (!e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        disabled={sendMessageMutation.isPending}
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        loading={sendMessageMutation.isPending}
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
                        style={{ height: "auto", minHeight: 32 }}
                      >
                        发送
                      </Button>
                    </Space.Compact>
                  </div>
                </>
              )}
            </AntCard>
          </Col>
        </Row>
      </AntCard>

      <Modal
        title="新建对话"
        open={createModalOpen}
        destroyOnClose
        onCancel={() => {
          setCreateModalOpen(false);
          setNewConvTitle("新对话");
        }}
        onOk={() => createConvMutation.mutate(newConvTitle)}
        okText="创建"
        cancelText="取消"
        confirmLoading={createConvMutation.isPending}
      >
        <Form layout="vertical">
          <Form.Item label="对话标题">
            <Input
              placeholder="请输入对话标题"
              value={newConvTitle}
              onChange={(e) => setNewConvTitle(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
