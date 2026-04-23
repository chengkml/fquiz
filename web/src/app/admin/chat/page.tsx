"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { TextArea, Button } from "@/components/ui-antd";
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback("");
    setError("");
    sendMessageMutation.mutate();
  };

  if (initializing) {
    return (
      <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm text-sm text-[var(--gray-11)]">Loading chat workspace...</div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm text-sm text-[var(--gray-11)]">请先登录后再使用 AI 聊天。</div>
    );
  }

  if (!canUseChat) {
    return (
      <div className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">当前账号没有 `chat.use` 权限。</div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">会话列表</h2>
          <Button
            type="button"
            color="gray" size="1" variant="soft"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
          >
            {createSessionMutation.isPending ? "创建中..." : "新建会话"}
          </Button>
        </div>

        {sessionsQuery.isLoading ? (
          <p className="text-sm text-[var(--gray-11)]">加载中...</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-[var(--gray-11)]">暂无会话，点击“新建会话”开始。</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <Button
                key={session.id}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  effectiveSessionId === session.id
                    ? "border-[var(--accent-7)] bg-[var(--accent-a3)]"
                    : "border-[var(--border)] bg-[var(--color-panel-solid,var(--gray-1))] hover:border-[var(--accent-6)]"
                }`}
              >
                <p className="truncate text-sm font-medium">{session.title || "未命名会话"}</p>
                <p className="mt-1 text-xs text-[var(--gray-11)]">{formatTime(session.last_message_at || session.updated_at)}</p>
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm flex min-h-[70vh] flex-col">
        <div className="mb-4 border-b border-[var(--border)] pb-3">
          <h2 className="text-base font-semibold">{activeSession?.title || "请选择会话"}</h2>
          <p className="mt-1 text-xs text-[var(--gray-11)]">
            {activeSession?.model_code ? `最近使用模型：${activeSession.model_code}` : "模型将按 chat.default -> GLOBAL 路由规则自动选择"}
          </p>
        </div>

        {(error || sessionsQuery.error || messagesQuery.error) && (
          <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)] mb-3 text-xs">
            {error
              || (sessionsQuery.error instanceof Error ? sessionsQuery.error.message : "")
              || (messagesQuery.error instanceof Error ? messagesQuery.error.message : "")}
          </pre>
        )}
        {feedback && <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)] mb-3 text-xs">{feedback}</pre>}

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {!effectiveSessionId ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--gray-11)]">
              请先创建或选择会话。
            </div>
          ) : messagesQuery.isLoading ? (
            <p className="text-sm text-[var(--gray-11)]">加载消息中...</p>
          ) : messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--gray-11)]">
              暂无消息，发送第一条消息开始对话。
            </div>
          ) : (
            messages.map((message) => (
              <MessageItem key={message.id} message={message} currentUserId={user.id} />
            ))
          )}
          <div ref={messageEndRef} />
        </div>

        <form className="mt-4 border-t border-[var(--border)] pt-4" onSubmit={handleSubmit}>
          <label className="mb-2 block text-sm text-[var(--gray-11)]">输入消息</label>
          <TextArea
            rows={3}
            className="w-full"
            placeholder="请输入你的问题..."
            value={draft}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.currentTarget.value)}
            disabled={!effectiveSessionId || sendMessageMutation.isPending}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="submit"
             
              disabled={!effectiveSessionId || sendMessageMutation.isPending || !draft.trim()}
            >
              {sendMessageMutation.isPending ? "发送中..." : "发送"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MessageItem({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const fromCurrentUser = message.role === "user" && message.author_user_id === currentUserId;
  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex ${fromCurrentUser ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[90%] rounded-xl border px-4 py-3 text-sm shadow-sm ${
          fromCurrentUser
            ? "border-[var(--accent-7)] bg-[var(--accent-9)] text-[var(--accent-contrast,#fff)]"
            : message.is_error
              ? "border-[var(--red-7)] bg-[var(--red-a3)] text-[var(--red-11)]"
              : "border-[var(--border)] bg-[var(--color-panel-solid,var(--gray-1))] text-[var(--gray-12)]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words leading-6">{message.content}</p>
        <div className={`mt-2 text-xs ${fromCurrentUser ? "text-[var(--accent-a2)]" : "text-[var(--gray-11)]"}`}>
          <span>{formatTime(message.created_at)}</span>
          {isAssistant && message.model_code && <span className="ml-2">· {message.model_code}</span>}
          {isAssistant && message.total_tokens !== null && <span className="ml-2">· tokens {message.total_tokens}</span>}
          {isAssistant && message.latency_ms !== null && <span className="ml-2">· {message.latency_ms}ms</span>}
        </div>
      </article>
    </div>
  );
}
