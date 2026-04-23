"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Row,
  Col,
  Select,
  Space,
  Typography,
  message,
} from "antd";

import { MermaidViewer } from "@/components/mermaid-viewer";
import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { MermaidChatTurn, MermaidDiagramSummary } from "@/types/auth";

type MermaidEditorProps = {
  diagramId: string;
};

const DEFAULT_EXAMPLES: Record<string, string> = {
  flowchart: `flowchart TD\n    A[开始] --> B{条件判断}\n    B -->|是| C[处理 A]\n    B -->|否| D[处理 B]\n    C --> E[结束]\n    D --> E`,
  sequence: `sequenceDiagram\n    participant 用户\n    participant 系统\n    用户->>系统: 发起请求\n    系统-->>用户: 返回结果`,
  class: `classDiagram\n    class User {\n      +String name\n      +login()\n    }\n    class Admin {\n      +manage()\n    }\n    User <|-- Admin`,
  state: `stateDiagram-v2\n    [*] --> 待处理\n    待处理 --> 处理中\n    处理中 --> 已完成\n    已完成 --> [*]`,
};

function parseSsePayload(rawEvent: string): string {
  const lines = rawEvent
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"));
  return lines.map((line) => line.slice(5).trimStart()).join("\n");
}

export function MermaidEditor({ diagramId }: MermaidEditorProps) {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [diagramName, setDiagramName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [templateType, setTemplateType] = useState("flowchart");

  const [messages, setMessages] = useState<MermaidChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [modelName, setModelName] = useState("");
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = canRead;

  const loadDiagram = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth(`/api/v1/mermaids/diagrams/get/${diagramId}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as MermaidDiagramSummary;
      setDiagramName(payload.diagram_name || "未命名流程图");
      setDescription(payload.description || "");
      setCode(payload.diagram_data || "");
      setPanelError("");
    } catch (error) {
      const text = error instanceof Error ? error.message : "加载流程图失败";
      setPanelError(text);
    } finally {
      setLoading(false);
    }
  }, [diagramId, fetchWithAuth]);

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    void loadDiagram();
  }, [canRead, loadDiagram, user]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const saveDiagram = async () => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      message.warning("Mermaid 代码不能为空");
      return;
    }
    setSaving(true);
    try {
      const response = await fetchWithAuth(`/api/v1/mermaids/diagrams/${diagramId}/data`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagram_data: normalizedCode }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("保存成功");
      setPanelError("");
      await loadDiagram();
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const sendPrompt = async () => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt || streaming) {
      return;
    }

    const userTurn: MermaidChatTurn = { role: "user", content: normalizedPrompt };
    const nextHistory = [...messages, userTurn];
    setMessages([...nextHistory, { role: "assistant", content: "" }]);
    setPrompt("");
    setStreaming(true);

    try {
      const response = await fetchWithAuth("/api/v1/mermaids/diagrams/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory,
          diagram_data: code,
          model_name: modelName.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      if (!response.body) {
        throw new Error("流式响应不可用");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let assistantContent = "";
      let streamError: string | null = null;

      const handleChunk = (payload: string) => {
        if (!payload || payload === "connected") {
          return;
        }
        if (payload.startsWith("[ERROR]")) {
          streamError = payload.slice("[ERROR]".length) || "AI 生成失败";
          return;
        }

        assistantContent += payload;
        setMessages((previous) => {
          const next = [...previous];
          if (next.length === 0) {
            return [{ role: "assistant", content: assistantContent }];
          }
          next[next.length - 1] = { role: "assistant", content: assistantContent };
          return next;
        });
        setCode(assistantContent);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let separator = buffer.indexOf("\n\n");
        while (separator >= 0) {
          const rawEvent = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const payload = parseSsePayload(rawEvent);
          handleChunk(payload);
          separator = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        handleChunk(parseSsePayload(buffer));
      }

      if (streamError) {
        throw new Error(streamError);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "发送失败";
      setPanelError(text);
      message.error(text);
      setMessages((previous) => {
        if (previous.length === 0) {
          return previous;
        }
        const next = [...previous];
        next[next.length - 1] = {
          role: "assistant",
          content: `生成失败：${text}`,
        };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  const chatPanel = useMemo(() => {
    if (messages.length === 0) {
      return (
        <div className="h-full rounded-lg border border-dashed border-[var(--gray-6)] p-4">
          <Empty description="输入需求，AI 将生成或修改 Mermaid 代码" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      );
    }

    return (
      <div className="h-full overflow-y-auto rounded-lg border border-[var(--gray-6)] bg-white p-3">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {messages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}`}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-all ${
                  msg.role === "user"
                    ? "bg-[var(--accent-a3)] text-[var(--accent-12)]"
                    : "bg-[var(--gray-a3)] text-[var(--gray-12)]"
                }`}
              >
                {msg.role === "assistant" && !msg.content ? "生成中..." : msg.content}
              </div>
            </div>
          ))}
          <div ref={messageEndRef} />
        </Space>
      </div>
    );
  }, [messages]);

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading mermaid editor...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问流程图编辑页面。</p>
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
    return <p className="text-sm text-[var(--gray-11)]">缺少 `question_bank.read` 或 `question_bank.manage` 权限。</p>;
  }

  return (
    <main className="flex flex-col gap-4">
      <Card loading={loading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
              {diagramName || "流程图编辑"}
            </Typography.Title>
            <Typography.Text type="secondary">
              {description || "通过 AI 对话生成/修改 Mermaid 代码，保存后回写到 quiz 表结构。"}
            </Typography.Text>
          </div>
          <Space>
            <Button onClick={() => router.push("/admin/mermaid-mgr")}>返回列表</Button>
            <Button onClick={() => setDrawerVisible(true)}>源代码</Button>
            <Button type="primary" onClick={() => void saveDiagram()} loading={saving} disabled={!canManage || streaming}>
              保存
            </Button>
          </Space>
        </div>
      </Card>

      {panelError ? (
        <section className="rounded-xl border border-[var(--red-6)] bg-[var(--red-2)] p-3 text-sm text-[var(--red-11)]">
          {panelError}
        </section>
      ) : null}

      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card title="AI 助手" className="h-full">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Input.TextArea
                rows={3}
                value={prompt}
                disabled={streaming || !canManage}
                placeholder="例如：把流程改成从左到右，增加异常分支"
                onChange={(event) => setPrompt(event.target.value)}
                onPressEnter={(event) => {
                  if (!event.shiftKey) {
                    event.preventDefault();
                    void sendPrompt();
                  }
                }}
              />
              <Input
                value={modelName}
                disabled={streaming}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="可选：模型名称（不填则走默认路由）"
              />
              <Button type="primary" onClick={() => void sendPrompt()} loading={streaming} disabled={!canManage || !prompt.trim()}>
                发送
              </Button>
              <div className="h-[460px]">{chatPanel}</div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title="预览" className="h-full">
            <MermaidViewer code={code} />
          </Card>
        </Col>
      </Row>

      <Drawer
        title="源代码编辑"
        width={720}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>模板</Typography.Text>
            <Space style={{ marginTop: 8 }}>
              <Select
                style={{ width: 260 }}
                value={templateType}
                options={Object.keys(DEFAULT_EXAMPLES).map((type) => ({
                  label: type,
                  value: type,
                }))}
                onChange={(value) => setTemplateType(String(value))}
              />
              <Button
                onClick={() => {
                  setCode(DEFAULT_EXAMPLES[templateType] || "");
                }}
              >
                套用模板
              </Button>
            </Space>
          </div>

          <Input.TextArea
            value={code}
            rows={28}
            autoSize={{ minRows: 22, maxRows: 36 }}
            onChange={(event) => setCode(event.target.value)}
            disabled={!canManage || streaming}
            style={{ fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace" }}
          />
        </Space>
      </Drawer>
    </main>
  );
}
