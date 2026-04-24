"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Col,
  Drawer,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from "antd";

import { MermaidViewer } from "@/components/mermaid-viewer";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
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
      return <Empty description="输入需求，AI 将生成或修改 Mermaid 代码" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    return (
      <div
        style={{
          height: 460,
          overflowY: "auto",
          border: "1px solid var(--ant-color-border-secondary)",
          borderRadius: 8,
          padding: 12,
          background: "var(--ant-color-bg-container)",
        }}
      >
        <List<MermaidChatTurn>
          split={false}
          dataSource={messages}
          renderItem={(msg, index) => (
            <List.Item key={`${msg.role}-${index}`} style={{ padding: "6px 0" }}>
              <div style={{ width: "100%", display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "88%",
                    borderRadius: 8,
                    padding: "8px 12px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    background: msg.role === "user" ? "var(--ant-color-primary-bg)" : "var(--ant-color-fill-tertiary)",
                    color: "var(--ant-color-text)",
                  }}
                >
                  {msg.role === "assistant" && !msg.content ? (
                    <Space size={8}>
                      <Spin size="small" />
                      <span>生成中...</span>
                    </Space>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </List.Item>
          )}
        />
        <div ref={messageEndRef} />
      </div>
    );
  }, [messages]);

  if (initializing) {
    return <Card loading />;
  }

  if (!user) {
    return (
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          请先登录
        </Typography.Title>
        <Typography.Paragraph type="secondary">登录后可访问流程图编辑页面。</Typography.Paragraph>
        <Button type="primary" onClick={() => router.push("/")}>
          返回首页
        </Button>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          无访问权限
        </Typography.Title>
        <Typography.Paragraph type="secondary">缺少 `question_bank.read` 或 `question_bank.manage` 权限。</Typography.Paragraph>
      </Card>
    );
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
        <Alert
          type="error"
          showIcon
          closable
          message="流程图编辑发生错误"
          description={panelError}
          onClose={() => setPanelError("")}
        />
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
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
                onPressEnter={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (!event.shiftKey) {
                    event.preventDefault();
                    void sendPrompt();
                  }
                }}
              />
              <Input
                value={modelName}
                disabled={streaming}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setModelName(event.target.value)}
                placeholder="可选：模型名称（不填则走默认路由）"
              />
              <Button type="primary" onClick={() => void sendPrompt()} loading={streaming} disabled={!canManage || !prompt.trim()}>
                发送
              </Button>
              {chatPanel}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card title="预览" className="h-full">
            <MermaidViewer code={code} />
          </Card>
        </Col>
      </Row>

      <Drawer title="源代码编辑" width={720} open={drawerVisible} onClose={() => setDrawerVisible(false)}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="源码编辑说明"
            description="可先套用模板，再按需微调 Mermaid 代码；保存后将以当前编辑器内容为准。"
          />
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
                onChange={(value: string) => setTemplateType(String(value))}
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
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCode(event.target.value)}
            disabled={!canManage || streaming}
            style={{ fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace" }}
          />
        </Space>
      </Drawer>
    </main>
  );
}
