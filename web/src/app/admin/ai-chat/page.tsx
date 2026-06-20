"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import {
  PlusOutlined,
  SendOutlined,
  DeleteOutlined,
  EditOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { readApiError, API_BASE_URL } from "@/lib/api";
import type {
  AiChatConversation,
  AiChatConversationListResponse,
  AiChatMessage,
  AiChatMessageResponse,
} from "@/types/ai-chat";

const { TextArea } = Input;
const { Title, Text } = Typography;

export default function AiChatPage() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState("新对话");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      message.success("创建对话成功");
    },
    onError: (error: Error) => {
      message.error(`创建对话失败: ${error.message}`);
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
      message.success("删除对话成功");
    },
    onError: (error: Error) => {
      message.error(`删除对话失败: ${error.message}`);
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
    onError: (error: Error) => {
      message.error(`发送消息失败: ${error.message}`);
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

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px", borderBottom: "1px solid #f0f0f0" }}>
        <Title level={3} style={{ margin: 0 }}>
          <RobotOutlined /> AI 问答
        </Title>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div
          style={{
            width: "280px",
            borderRight: "1px solid #f0f0f0",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "16px" }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              block
              onClick={() => setCreateModalOpen(true)}
            >
              新建对话
            </Button>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "0 16px" }}>
            {convLoading ? (
              <Spin />
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
                        selectedConvId === conv.id ? "#e6f7ff" : "transparent",
                      padding: "8px",
                      borderRadius: "4px",
                      marginBottom: "8px",
                    }}
                  >
                    <List.Item.Meta
                      title={conv.title}
                      description={`${conv.message_count || 0} 条消息`}
                    />
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConvMutation.mutate(conv.id);
                      }}
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {!selectedConvId ? (
            <Empty
              description="请选择或创建一个对话"
              style={{ marginTop: "100px" }}
            />
          ) : (
            <>
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  padding: "24px",
                  background: "#fafafa",
                }}
              >
                {convDetailLoading ? (
                  <Spin />
                ) : (
                  <Space direction="vertical" style={{ width: "100%" }} size="large">
                    {currentConv?.messages?.map((msg) => (
                      <Card
                        key={msg.id}
                        style={{
                          maxWidth: "80%",
                          marginLeft: msg.role === "user" ? "auto" : 0,
                          background: msg.role === "user" ? "#1890ff" : "#fff",
                          color: msg.role === "user" ? "#fff" : "#000",
                        }}
                      >
                        <Text
                          strong
                          style={{
                            color: msg.role === "user" ? "#fff" : "#000",
                          }}
                        >
                          {msg.role === "user" ? "我" : "AI"}
                        </Text>
                        <div style={{ marginTop: "8px", whiteSpace: "pre-wrap" }}>
                          {msg.content}
                        </div>
                      </Card>
                    ))}
                    <div ref={messagesEndRef} />
                  </Space>
                )}
              </div>

              <div
                style={{
                  padding: "16px",
                  borderTop: "1px solid #f0f0f0",
                  background: "#fff",
                }}
              >
                <Space.Compact style={{ width: "100%" }}>
                  <TextArea
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="输入消息..."
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
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
        </div>
      </div>

      <Modal
        title="新建对话"
        open={createModalOpen}
        onOk={() => createConvMutation.mutate(newConvTitle)}
        onCancel={() => {
          setCreateModalOpen(false);
          setNewConvTitle("新对话");
        }}
        confirmLoading={createConvMutation.isPending}
      >
        <Input
          placeholder="对话标题"
          value={newConvTitle}
          onChange={(e) => setNewConvTitle(e.target.value)}
        />
      </Modal>
    </div>
  );
}
