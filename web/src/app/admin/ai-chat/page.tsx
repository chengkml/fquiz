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
import { useCallback, useEffect, useRef, useState, type ComponentType, type RefAttributes } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError, API_BASE_URL } from "@/lib/api";
import type {
  AiChatConversation,
  AiChatConversationListResponse,
  AiChatMessageResponse,
} from "@/types/ai-chat";

const { TextArea } = Input;
const { Text } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

export default function AiChatPage() {
  const { user, initializing, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState("新对话");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

  const sendMessageMutation = useMutation({
    mutationFn: async ({
      convId,
      content,
    }: {
      convId: number;
      content: string;
    }) => {
      const response = await fetchWithAuth(
        `${API_BASE_URL}/api/v1/ai-chat/conversations/${convId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AiChatMessageResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ai-chat-conversation", selectedConvId],
      });
      setMessageInput("");
    },
    onError: (err: Error) => {
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
  }, [currentConv?.messages]);

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
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <AntCard
              title="对话列表"
              size="small"
              styles={{ body: { padding: 0, maxHeight: 600, overflowY: "auto" } }}
            >
              {convLoading ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <Spin />
                </div>
              ) : conversations?.items.length === 0 ? (
                <Empty
                  description="暂无对话"
                  style={{ padding: 40 }}
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
                        padding: "12px 16px",
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
                        title={conv.title}
                        description={
                          <Space size={4}>
                            <Tag color="blue">{conv.message_count || 0} 条消息</Tag>
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

          <Col xs={24} md={16}>
            <AntCard
              title={currentConv ? currentConv.title : "AI 对话"}
              size="small"
              styles={{
                body: {
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  height: 600,
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
                      padding: 16,
                      background: "var(--ant-color-bg-layout)",
                    }}
                  >
                    {convDetailLoading ? (
                      <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin />
                      </div>
                    ) : (
                      <Space direction="vertical" style={{ width: "100%" }} size={12}>
                        {currentConv?.messages?.map((msg) => (
                          <div
                            key={msg.id}
                            style={{
                              display: "flex",
                              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                            }}
                          >
                            <Card
                              size="small"
                              style={{
                                maxWidth: "80%",
                                background:
                                  msg.role === "user"
                                    ? "var(--ant-color-primary)"
                                    : "var(--ant-color-bg-container)",
                                border:
                                  msg.role === "user"
                                    ? "1px solid var(--ant-color-primary)"
                                    : undefined,
                              }}
                            >
                              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                                <Text
                                  strong
                                  style={{
                                    color:
                                      msg.role === "user"
                                        ? "var(--ant-color-white)"
                                        : "var(--ant-color-text)",
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
                                  }}
                                >
                                  {msg.content}
                                </div>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 12,
                                    color:
                                      msg.role === "user"
                                        ? "rgba(255, 255, 255, 0.65)"
                                        : undefined,
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
                      padding: 16,
                      borderTop: "1px solid var(--ant-color-border)",
                      background: "var(--ant-color-bg-container)",
                    }}
                  >
                    <Space.Compact style={{ width: "100%" }}>
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
                      />
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        loading={sendMessageMutation.isPending}
                        onClick={handleSendMessage}
                        disabled={!messageInput.trim()}
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
