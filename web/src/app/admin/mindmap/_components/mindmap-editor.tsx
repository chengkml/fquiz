"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Space,
  Tree,
  Typography,
  message,
} from "antd";
import type { DataNode } from "antd/es/tree";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { MindMapSummary } from "@/types/auth";

type MindMapEditorProps = {
  initialId?: string | null;
};

type MindNodeData = {
  id?: string;
  topic?: string;
  root?: boolean;
};

type MindNode = {
  nodeData?: MindNodeData;
  nodeChild?: MindNode[];
};

type RootShapeNode = {
  id?: string;
  topic?: string;
  data?: {
    text?: string;
  };
  children?: RootShapeNode[];
};

type RootShapeData = {
  root?: RootShapeNode;
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  const normalized = text.trim();
  if (!normalized) return null;
  try {
    const parsed: unknown = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildInitialMapData(mapName: string): string {
  const payload: MindNode = {
    nodeData: {
      id: "root",
      topic: mapName.trim() || "新思维导图",
      root: true,
    },
    nodeChild: [],
  };
  return JSON.stringify(payload, null, 2);
}

function normalizeMapDataForSave(raw: string, mapName: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return JSON.stringify(JSON.parse(buildInitialMapData(mapName)));
  }

  const parsed = parseJsonObject(trimmed);
  if (!parsed) {
    throw new Error("导图 JSON 格式不合法");
  }
  return JSON.stringify(parsed);
}

function toTreeDataFromMindNode(node: MindNode): DataNode {
  const title = node.nodeData?.topic?.trim() || "未命名主题";
  const key = node.nodeData?.id?.trim() || `${title}-${Math.random().toString(16).slice(2)}`;
  const children = Array.isArray(node.nodeChild)
    ? node.nodeChild.map((child) => toTreeDataFromMindNode(child))
    : undefined;

  return {
    key,
    title,
    children: children && children.length > 0 ? children : undefined,
  };
}

function toTreeDataFromRootNode(node: RootShapeNode): DataNode {
  const title = node.data?.text?.trim() || node.topic?.trim() || "未命名主题";
  const key = node.id?.trim() || `${title}-${Math.random().toString(16).slice(2)}`;
  const children = Array.isArray(node.children)
    ? node.children.map((child) => toTreeDataFromRootNode(child))
    : undefined;

  return {
    key,
    title,
    children: children && children.length > 0 ? children : undefined,
  };
}

function mapDataToTreeData(mapDataText: string): DataNode[] {
  const parsed = parseJsonObject(mapDataText);
  if (!parsed) return [];

  const nodeData = parsed.nodeData;
  if (nodeData && typeof nodeData === "object" && !Array.isArray(nodeData)) {
    return [toTreeDataFromMindNode(parsed as unknown as MindNode)];
  }

  const root = (parsed as RootShapeData).root;
  if (root && typeof root === "object") {
    return [toTreeDataFromRootNode(root)];
  }

  return [];
}

function nodeToMarkdown(node: MindNode, level: number): string {
  const topic = node.nodeData?.topic?.trim() || "未命名主题";
  const heading = `${"#".repeat(Math.max(1, Math.min(6, level)))} ${topic}`;
  const children = Array.isArray(node.nodeChild) ? node.nodeChild : [];
  const childrenMarkdown = children.map((child) => nodeToMarkdown(child, level + 1)).join("\n\n");
  return childrenMarkdown ? `${heading}\n\n${childrenMarkdown}` : heading;
}

function rootNodeToMarkdown(node: RootShapeNode, level: number): string {
  const topic = node.data?.text?.trim() || node.topic?.trim() || "未命名主题";
  const heading = `${"#".repeat(Math.max(1, Math.min(6, level)))} ${topic}`;
  const children = Array.isArray(node.children) ? node.children : [];
  const childrenMarkdown = children.map((child) => rootNodeToMarkdown(child, level + 1)).join("\n\n");
  return childrenMarkdown ? `${heading}\n\n${childrenMarkdown}` : heading;
}

function mapDataToMarkdown(mapDataText: string): string {
  const parsed = parseJsonObject(mapDataText);
  if (!parsed) {
    throw new Error("导图 JSON 格式不合法");
  }

  const nodeData = parsed.nodeData;
  if (nodeData && typeof nodeData === "object" && !Array.isArray(nodeData)) {
    return nodeToMarkdown(parsed as unknown as MindNode, 1);
  }

  const root = (parsed as RootShapeData).root;
  if (root && typeof root === "object") {
    return rootNodeToMarkdown(root, 1);
  }

  throw new Error("导图结构不支持导出 Markdown");
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MindMapEditor({ initialId = null }: MindMapEditorProps) {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [mindMapId, setMindMapId] = useState<string | null>(initialId);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [mapName, setMapName] = useState("新思维导图");
  const [descr, setDescr] = useState("");
  const [mapData, setMapData] = useState(buildInitialMapData("新思维导图"));

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiOutput, setAiOutput] = useState("");

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  useEffect(() => {
    setMindMapId(initialId ?? null);
  }, [initialId]);

  const loadMindMap = useCallback(
    async (targetId: string) => {
      setLoading(true);
      try {
        const response = await fetchWithAuth(`/api/v1/mindmap/get/${targetId}`);
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        const payload = (await response.json()) as MindMapSummary;
        setMapName(payload.map_name || "新思维导图");
        setDescr(payload.descr || "");

        const parsed = parseJsonObject(payload.map_data || "");
        if (parsed) {
          setMapData(JSON.stringify(parsed, null, 2));
        } else {
          setMapData(buildInitialMapData(payload.map_name || "新思维导图"));
        }
        setPanelError("");
      } catch (error) {
        const text = error instanceof Error ? error.message : "加载思维导图失败";
        setPanelError(text);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user || !canRead) return;
    if (!mindMapId) {
      setMapName("新思维导图");
      setDescr("");
      setMapData(buildInitialMapData("新思维导图"));
      return;
    }
    void loadMindMap(mindMapId);
  }, [canRead, loadMindMap, mindMapId, user]);

  const treeData = useMemo(() => mapDataToTreeData(mapData), [mapData]);

  const saveMindMap = async () => {
    if (!mapName.trim()) {
      message.warning("请先填写导图名称");
      return;
    }

    let normalizedMapData: string;
    try {
      normalizedMapData = normalizeMapDataForSave(mapData, mapName);
    } catch (error) {
      const text = error instanceof Error ? error.message : "导图 JSON 格式错误";
      setPanelError(text);
      message.error(text);
      return;
    }

    setSaving(true);
    try {
      if (mindMapId) {
        const basicResponse = await fetchWithAuth("/api/v1/mindmap/update-basic-info", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: mindMapId,
            map_name: mapName.trim(),
            descr: descr,
          }),
        });
        if (!basicResponse.ok) {
          throw new Error(await readApiError(basicResponse));
        }

        const dataResponse = await fetchWithAuth("/api/v1/mindmap/update-data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: mindMapId,
            map_data: normalizedMapData,
          }),
        });
        if (!dataResponse.ok) {
          throw new Error(await readApiError(dataResponse));
        }

        message.success("思维导图已保存");
      } else {
        const createResponse = await fetchWithAuth("/api/v1/mindmap/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            map_name: mapName.trim(),
            descr: descr,
            map_data: normalizedMapData,
          }),
        });
        if (!createResponse.ok) {
          throw new Error(await readApiError(createResponse));
        }

        const created = (await createResponse.json()) as MindMapSummary;
        setMindMapId(created.id);
        router.replace(`/admin/mindmap/edit/${created.id}`);
        message.success("思维导图创建成功");
      }

      setMapData(JSON.stringify(JSON.parse(normalizedMapData), null, 2));
      setPanelError("");
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存思维导图失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const exportJson = () => {
    try {
      const normalized = normalizeMapDataForSave(mapData, mapName);
      downloadTextFile(`${mapName || "mindmap"}.json`, JSON.stringify(JSON.parse(normalized), null, 2), "application/json");
      message.success("已导出 JSON");
    } catch (error) {
      const text = error instanceof Error ? error.message : "导出 JSON 失败";
      message.error(text);
    }
  };

  const exportMarkdown = () => {
    try {
      const markdown = mapDataToMarkdown(mapData);
      downloadTextFile(`${mapName || "mindmap"}.md`, markdown, "text/markdown");
      message.success("已导出 Markdown");
    } catch (error) {
      const text = error instanceof Error ? error.message : "导出 Markdown 失败";
      message.error(text);
    }
  };

  const startAiGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      message.warning("请输入导图描述");
      return;
    }

    setAiStreaming(true);
    setAiOutput("");
    try {
      const response = await fetchWithAuth(`/api/v1/mindmap/generate/stream?descr=${encodeURIComponent(prompt)}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      if (!response.body) {
        throw new Error("流式响应不可用");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let streamError: string | null = null;
      let parsedMindMap = false;

      const handleDataEvent = (data: string) => {
        if (!data || data === "connected" || data === "[PARSE_RESULT]") {
          return;
        }
        if (data.startsWith("[ERROR]")) {
          streamError = data.slice("[ERROR]".length) || "AI 生成失败";
          return;
        }
        if (data.startsWith("[MINDMAP]")) {
          const payload = data.slice("[MINDMAP]".length);
          const parsed = parseJsonObject(payload);
          if (!parsed) {
            streamError = "AI 返回导图 JSON 无法解析";
            return;
          }
          setMapData(JSON.stringify(parsed, null, 2));
          if (!mapName.trim()) {
            const candidateTitle = typeof parsed.nodeData === "object" && parsed.nodeData && !Array.isArray(parsed.nodeData)
              ? String((parsed.nodeData as Record<string, unknown>).topic || "").trim()
              : "";
            if (candidateTitle) {
              setMapName(candidateTitle);
            }
          }
          parsedMindMap = true;
          return;
        }
        setAiOutput((prev) => prev + data);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex = buffer.indexOf("\n\n");
        while (boundaryIndex >= 0) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          const lines = rawEvent
            .split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => line.startsWith("data:"));
          const data = lines.map((line) => line.slice(5).trimStart()).join("\n");
          handleDataEvent(data);

          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        const lines = buffer
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.startsWith("data:"));
        const data = lines.map((line) => line.slice(5).trimStart()).join("\n");
        handleDataEvent(data);
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (parsedMindMap) {
        message.success("AI 已生成导图数据");
        setAiModalOpen(false);
      } else {
        message.warning("AI 返回完成，但未识别到导图 JSON");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "AI 生成失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setAiStreaming(false);
    }
  };

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading mind map editor...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问思维导图编辑页面。</p>
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
              {mindMapId ? "编辑思维导图" : "新建思维导图"}
            </Typography.Title>
            <Typography.Text type="secondary">
              老工程逻辑：基础信息与导图数据分离保存，支持 AI 生成流式回填。
            </Typography.Text>
          </div>
          <Space>
            <Button onClick={() => router.push("/admin/mindmap")}>返回列表</Button>
            <Button onClick={() => setAiModalOpen(true)} disabled={!canManage}>
              AI 生成
            </Button>
            <Button onClick={exportJson}>导出 JSON</Button>
            <Button onClick={exportMarkdown}>导出 Markdown</Button>
            <Button type="primary" loading={saving} onClick={() => void saveMindMap()} disabled={!canManage}>
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
        <Col xs={24} lg={14}>
          <Card title="导图数据" className="h-full">
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              <div>
                <Typography.Text strong>导图名称</Typography.Text>
                <Input
                  value={mapName}
                  maxLength={255}
                  onChange={(event) => setMapName(event.target.value)}
                  disabled={!canManage}
                  placeholder="请输入导图名称"
                />
              </div>

              <div>
                <Typography.Text strong>描述</Typography.Text>
                <Input.TextArea
                  value={descr}
                  maxLength={20000}
                  onChange={(event) => setDescr(event.target.value)}
                  disabled={!canManage}
                  rows={3}
                  placeholder="请输入导图描述（可选）"
                />
              </div>

              <div>
                <Typography.Text strong>JSON 代码</Typography.Text>
                <Input.TextArea
                  value={mapData}
                  onChange={(event) => setMapData(event.target.value)}
                  autoSize={{ minRows: 18, maxRows: 26 }}
                  disabled={!canManage}
                  style={{ fontFamily: "JetBrains Mono, Menlo, Monaco, Consolas, monospace" }}
                />
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="导图预览" className="h-full">
            {treeData.length > 0 ? (
              <Tree treeData={treeData} defaultExpandAll selectable={false} />
            ) : (
              <Typography.Text type="secondary">当前 JSON 无法解析为导图树，请检查结构。</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="AI 生成思维导图"
        open={aiModalOpen}
        onCancel={() => {
          if (!aiStreaming) {
            setAiModalOpen(false);
          }
        }}
        onOk={() => void startAiGenerate()}
        confirmLoading={aiStreaming}
        okText={aiStreaming ? "生成中..." : "开始生成"}
        cancelText="关闭"
        maskClosable={!aiStreaming}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Input.TextArea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            rows={5}
            disabled={aiStreaming}
            placeholder="输入描述，例如：帮我生成一份 FastAPI 项目改造计划思维导图"
          />

          {(aiStreaming || aiOutput) && (
            <Card size="small" title="流式输出" style={{ maxHeight: 220, overflow: "auto" }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "JetBrains Mono, monospace" }}>
                {aiOutput || "正在生成..."}
              </pre>
            </Card>
          )}
        </Space>
      </Modal>
    </main>
  );
}
