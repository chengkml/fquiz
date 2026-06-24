"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Empty,
  Input,
  List,
  Popconfirm,
  Space,
  Spin,
  Typography,
} from "antd";
import {
  PlusOutlined,
  SendOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type ChatStreamEvent =
  | { type: "message"; message: AiChatMessage }
  | { type: "delta"; content: string }
  | { type: "done"; reply: AiChatMessage };

export default function AiChatPage() {
  const { user, initializing, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Record<number, AiChatMessage[]>>({});
  const [autoCreating, setAutoCreating] = useState(false);
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
      setSuccess("创建对话成功");
      setAutoCreating(false);
    },
    onError: (err: Error) => {
      setError(`创建对话失败: ${err.message}`);
      setAutoCreating(false);
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

  // Auto-select first conversation when conversations load
  useEffect(() => {
    if (!convLoading && conversations?.items && conversations.items.length > 0 && !selectedConvId) {
      setSelectedConvId(conversations.items[0].id);
    }
  }, [convLoading, conversations?.items, selectedConvId]);

  // Auto-create conversation if none exist
  useEffect(() => {
    if (!convLoading && conversations?.items && conversations.items.length === 0 && !autoCreating && !createConvMutation.isPending) {
      setAutoCreating(true);
      createConvMutation.mutate("新对话");
    }
  }, [convLoading, conversations?.items, autoCreating, createConvMutation]);

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", overflow: "hidden" }}>
      {/* Left Sidebar - Conversation List */}
      <div
        style={{
          width: 280,
          background: "#171717",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #2a2a2a",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px", borderBottom: "1px solid #2a2a2a" }}>
          <Text strong style={{ color: "#ffffff", fontSize: 16 }}>
            AI 问答助手
          </Text>
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {convLoading ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <Spin />
            </div>
          ) : conversations?.items.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center" }}>
              <Text style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 14 }}>
                {autoCreating ? "正在创建对话..." : "暂无对话"}
              </Text>
            </div>
          ) : (
            <List
              dataSource={conversations?.items || []}
              renderItem={(conv) => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  style={{
                    cursor: "pointer",
                    background:
                      selectedConvId === conv.id
                        ? "rgba(255, 255, 255, 0.12)"
                        : "transparent",
                    padding: "12px 16px",
                    transition: "background 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderLeft: selectedConvId === conv.id ? "3px solid #C8853F" : "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (selectedConvId !== conv.id) {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedConvId !== conv.id) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "#ffffff",
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {conv.title}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)" }}>
                      {conv.message_count || 0} 条消息
                    </div>
                  </div>
                  <Popconfirm
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
                      style={{
                        color: "rgba(255, 255, 255, 0.6)",
                      }}
                    />
                  </Popconfirm>
                </div>
              )}
            />
          )}
        </div>

        {/* New Conversation Button */}
        <div style={{ padding: "16px", borderTop: "1px solid #2a2a2a" }}>
          <Button
            type="default"
            block
            icon={<PlusOutlined />}
            onClick={() => createConvMutation.mutate("新对话")}
            loading={createConvMutation.isPending}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              color: "#ffffff",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              height: 40,
              borderRadius: 8,
            }}
          >
            新建对话
          </Button>
        </div>
      </div>

      {/* Right Side - Chat Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        {!selectedConvId ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Empty
              description="请选择或创建一个对话开始聊天"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid #e5e5e5",
                background: "#ffffff",
              }}
            >
              <Text strong style={{ fontSize: 16 }}>
                {currentConv ? currentConv.title : "AI 对话"}
              </Text>
            </div>

            {/* Messages Area */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px",
                background: "#f9f9f9",
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
                      }}
                    >
                      <div
                        style={{
                          maxWidth: "70%",
                          background: msg.role === "user" ? "#2f2f2f" : "#f4f4f4",
                          color: msg.role === "user" ? "#ffffff" : "#1a1a1a",
                          padding: "12px 16px",
                          borderRadius: 18,
                          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
                        }}
                      >
                        <div
                          style={{
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            lineHeight: 1.6,
                            fontSize: 14,
                          }}
                        >
                          {msg.content || (msg.id === streamingMessageId ? "正在回复..." : "")}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            marginTop: 6,
                            opacity: 0.6,
                          }}
                        >
                          {new Date(msg.created_at).toLocaleTimeString("zh-CN")}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </Space>
              )}
            </div>

            {/* Input Area */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e5e5e5",
                background: "#ffffff",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
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
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    background: "#f4f4f4",
                    border: "1px solid #e5e5e5",
                    padding: "10px 14px",
                  }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sendMessageMutation.isPending}
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                  style={{
                    height: "auto",
                    minHeight: 40,
                    borderRadius: 12,
                    paddingLeft: 20,
                    paddingRight: 20,
                    background: "#C8853F",
                    borderColor: "#C8853F",
                  }}
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
