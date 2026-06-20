"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tree,
  Typography,
  type CardProps,
} from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  FolderOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefAttributes } from "react";
import type { DataNode } from "antd/es/tree";

import { useAuth } from "@/components/auth-provider";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { readApiError } from "@/lib/api";
import type {
  Document,
  DocumentChapter,
  DocumentChapterCreateRequest,
  DocumentChapterTreeItem,
  DocumentChapterUpdateRequest,
  DocumentCreateRequest,
  DocumentListResponse,
  DocumentUpdateRequest,
} from "@/types/document";

const { TextArea } = Input;
const { Title } = Typography;
const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

type ChapterFormValues = {
  name: string;
  description?: string;
  parent_id?: number;
  sort_order: number;
};

type DocumentFormValues = {
  title: string;
  content: string;
  chapter_id?: number;
  sort_order: number;
  status: "draft" | "published";
};

const DOCUMENTS_TABLE_MIN_SCROLL_Y = 180;
const DOCUMENTS_TABLE_VIEWPORT_GAP = 40;
const DOCUMENTS_TABLE_FALLBACK_RESERVE = 220;

export default function AdminDocumentsPage() {
  const { user, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useMobileDetection();
  const { message } = App.useApp();

  const showSuccess = (msg: string) => message.success(msg);
  const showError = (msg: string) => message.error(msg);

  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [tableScrollY, setTableScrollY] = useState(DOCUMENTS_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const [chapterForm] = Form.useForm<ChapterFormValues>();
  const [documentForm] = Form.useForm<DocumentFormValues>();

  const canManage = hasPermission("document.manage") || true;
  const canRead = hasPermission("document.read") || true;

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ["/api/v1/documents/chapters/tree"],
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/documents/chapters/tree");
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DocumentChapterTreeItem[]>;
    },
    enabled: !!user && canRead,
  });

  const documentsQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedChapterId !== null) {
      params.set("chapter_id", String(selectedChapterId));
    }
    params.set("limit", "200");
    return params.toString();
  }, [selectedChapterId]);

  const documentsPath = `/api/v1/documents?${documentsQueryParams}`;

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: [documentsPath],
    queryFn: async () => {
      const response = await fetchWithAuth(documentsPath);
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DocumentListResponse>;
    },
    enabled: !!user && canRead,
  });

  const refreshData = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        (query.queryKey[0].startsWith("/api/v1/documents") ||
          query.queryKey[0] === "/api/v1/documents/chapters/tree"),
    });
  }, [queryClient]);

  const createChapterMutation = useMutation({
    mutationFn: async (payload: DocumentChapterCreateRequest) => {
      const response = await fetchWithAuth("/api/v1/documents/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    },
    onSuccess: () => {
      showSuccess("章节创建成功");
      refreshData();
      setChapterDialogOpen(false);
      chapterForm.resetFields();
    },
    onError: (error: Error) => {
      showError(`创建失败: ${error.message}`);
    },
  });

  const updateChapterMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: DocumentChapterUpdateRequest;
    }) => {
      const response = await fetchWithAuth(`/api/v1/documents/chapters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    },
    onSuccess: () => {
      showSuccess("章节更新成功");
      refreshData();
      setChapterDialogOpen(false);
      setEditingChapterId(null);
      chapterForm.resetFields();
    },
    onError: (error: Error) => {
      showError(`更新失败: ${error.message}`);
    },
  });

  const deleteChapterMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetchWithAuth(`/api/v1/documents/chapters/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readApiError(response));
    },
    onSuccess: () => {
      showSuccess("章节删除成功");
      refreshData();
    },
    onError: (error: Error) => {
      showError(`删除失败: ${error.message}`);
    },
  });

  const createDocumentMutation = useMutation({
    mutationFn: async (payload: DocumentCreateRequest) => {
      const response = await fetchWithAuth("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    },
    onSuccess: () => {
      showSuccess("文档创建成功");
      refreshData();
      setDocumentDrawerOpen(false);
      documentForm.resetFields();
    },
    onError: (error: Error) => {
      showError(`创建失败: ${error.message}`);
    },
  });

  const updateDocumentMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: DocumentUpdateRequest;
    }) => {
      const response = await fetchWithAuth(`/api/v1/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json();
    },
    onSuccess: () => {
      showSuccess("文档更新成功");
      refreshData();
      setDocumentDrawerOpen(false);
      setEditingDocumentId(null);
      documentForm.resetFields();
    },
    onError: (error: Error) => {
      showError(`更新失败: ${error.message}`);
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetchWithAuth(`/api/v1/documents/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readApiError(response));
    },
    onSuccess: () => {
      showSuccess("文档删除成功");
      refreshData();
    },
    onError: (error: Error) => {
      showError(`删除失败: ${error.message}`);
    },
  });

  const handleCreateChapter = useCallback(() => {
    setEditingChapterId(null);
    chapterForm.resetFields();
    setChapterDialogOpen(true);
  }, [chapterForm]);

  const handleEditChapter = useCallback((chapter: DocumentChapter) => {
    setEditingChapterId(chapter.id);
    chapterForm.setFieldsValue({
      name: chapter.name,
      description: chapter.description || "",
      parent_id: chapter.parent_id || undefined,
      sort_order: chapter.sort_order,
    });
    setChapterDialogOpen(true);
  }, [chapterForm]);

  const handleChapterFormSubmit = useCallback(async () => {
    try {
      const values = await chapterForm.validateFields();
      if (editingChapterId) {
        updateChapterMutation.mutate({ id: editingChapterId, payload: values });
      } else {
        createChapterMutation.mutate(values);
      }
    } catch (error) {
      console.error("Form validation failed:", error);
    }
  }, [chapterForm, editingChapterId, updateChapterMutation, createChapterMutation]);

  const handleCreateDocument = useCallback(() => {
    setEditingDocumentId(null);
    documentForm.resetFields();
    if (selectedChapterId !== null) {
      documentForm.setFieldValue("chapter_id", selectedChapterId);
    }
    setDocumentDrawerOpen(true);
  }, [documentForm, selectedChapterId]);

  const handleEditDocument = useCallback((document: Document) => {
    setEditingDocumentId(document.id);
    documentForm.setFieldsValue({
      title: document.title,
      content: document.content,
      chapter_id: document.chapter_id || undefined,
      sort_order: document.sort_order,
      status: document.status,
    });
    setDocumentDrawerOpen(true);
  }, [documentForm]);

  const handleDocumentFormSubmit = useCallback(async () => {
    try {
      const values = await documentForm.validateFields();
      if (editingDocumentId) {
        updateDocumentMutation.mutate({ id: editingDocumentId, payload: values });
      } else {
        createDocumentMutation.mutate(values);
      }
    } catch (error) {
      console.error("Form validation failed:", error);
    }
  }, [documentForm, editingDocumentId, updateDocumentMutation, createDocumentMutation]);

  const convertToTreeData = useCallback((chapters: DocumentChapterTreeItem[]): DataNode[] => {
    return chapters.map((chapter) => ({
      key: `chapter-${chapter.id}`,
      title: (
        <Space>
          <FolderOutlined />
          <span>{chapter.name}</span>
          <span style={{ color: "#999", fontSize: "12px" }}>
            ({chapter.documents?.length || 0})
          </span>
        </Space>
      ),
      children: chapter.children ? convertToTreeData(chapter.children) : [],
    }));
  }, []);

  const columns: ColumnsType<Document> = useMemo(() => [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={status === "published" ? "green" : "orange"}>
          {status === "published" ? "已发布" : "草稿"}
        </Tag>
      ),
    },
    {
      title: "排序",
      dataIndex: "sort_order",
      key: "sort_order",
      width: 80,
    },
    {
      title: "操作",
      key: "action",
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditDocument(record)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => deleteDocumentMutation.mutate(record.id)}
            disabled={!canManage}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [canManage, handleEditDocument, deleteDocumentMutation]);

  const flattenChapters = useCallback((chapters: DocumentChapterTreeItem[]): DocumentChapter[] => {
    const result: DocumentChapter[] = [];
    const traverse = (items: DocumentChapterTreeItem[]) => {
      items.forEach((item) => {
        result.push(item);
        if (item.children) {
          traverse(item.children);
        }
      });
    };
    traverse(chapters);
    return result;
  }, []);

  useEffect(() => {
    const updateScrollY = () => {
      if (!tableScrollAnchorRef.current) {
        setTableScrollY(DOCUMENTS_TABLE_MIN_SCROLL_Y);
        return;
      }
      const rect = tableScrollAnchorRef.current.getBoundingClientRect();
      const availableHeight = window.innerHeight - rect.top - DOCUMENTS_TABLE_VIEWPORT_GAP;
      const computedY = Math.max(availableHeight, DOCUMENTS_TABLE_MIN_SCROLL_Y);
      setTableScrollY(computedY);
    };

    updateScrollY();
    window.addEventListener("resize", updateScrollY);
    return () => window.removeEventListener("resize", updateScrollY);
  }, []);

  if (!user || !canRead) {
    return (
      <div style={{ padding: "24px" }}>
        <Empty description="暂无权限访问" />
      </div>
    );
  }

  return (
    <div style={{ padding: "24px" }}>
      <Row gutter={16}>
        <Col span={6}>
          <AntCard
            title="章节目录"
            extra={
              canManage && (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={handleCreateChapter}
                >
                  新建
                </Button>
              )
            }
            style={{ height: "calc(100vh - 140px)", overflow: "auto" }}
          >
            {treeLoading ? (
              <div style={{ textAlign: "center", padding: "24px" }}>
                <Spin />
              </div>
            ) : treeData && treeData.length > 0 ? (
              <Tree
                showLine
                defaultExpandAll
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                treeData={convertToTreeData(treeData)}
                onSelect={(keys) => {
                  if (keys.length > 0) {
                    const key = keys[0] as string;
                    if (key.startsWith("chapter-")) {
                      const id = parseInt(key.replace("chapter-", ""), 10);
                      setSelectedChapterId(id);
                    }
                  } else {
                    setSelectedChapterId(null);
                  }
                }}
              />
            ) : (
              <Empty description="暂无章节" />
            )}
          </AntCard>
        </Col>
        <Col span={18}>
          <AntCard
            title={selectedChapterId ? "章节文档" : "全部文档"}
            extra={
              canManage && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleCreateDocument}
                >
                  新建文档
                </Button>
              )
            }
          >
            <div ref={tableScrollAnchorRef}>
              <Table
                dataSource={documentsData?.items || []}
                columns={columns}
                rowKey="id"
                loading={documentsLoading}
                pagination={{ pageSize: 20 }}
                scroll={{ y: tableScrollY }}
              />
            </div>
          </AntCard>
        </Col>
      </Row>

      <Modal
        title={editingChapterId ? "编辑章节" : "新建章节"}
        open={chapterDialogOpen}
        onOk={handleChapterFormSubmit}
        onCancel={() => {
          setChapterDialogOpen(false);
          setEditingChapterId(null);
          chapterForm.resetFields();
        }}
        confirmLoading={
          createChapterMutation.isPending || updateChapterMutation.isPending
        }
      >
        <Form form={chapterForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="章节名称"
            rules={[{ required: true, message: "请输入章节名称" }]}
          >
            <Input placeholder="请输入章节名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} placeholder="请输入描述" />
          </Form.Item>
          <Form.Item name="parent_id" label="父章节">
            <Select placeholder="选择父章节（可选）" allowClear>
              {treeData &&
                flattenChapters(treeData)
                  .filter((c) => c.id !== editingChapterId)
                  .map((chapter) => (
                    <Select.Option key={chapter.id} value={chapter.id}>
                      {chapter.name}
                    </Select.Option>
                  ))}
            </Select>
          </Form.Item>
          <Form.Item name="sort_order" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={editingDocumentId ? "编辑文档" : "新建文档"}
        width={720}
        open={documentDrawerOpen}
        onClose={() => {
          setDocumentDrawerOpen(false);
          setEditingDocumentId(null);
          documentForm.resetFields();
        }}
        extra={
          <Space>
            <Button
              onClick={() => {
                setDocumentDrawerOpen(false);
                setEditingDocumentId(null);
                documentForm.resetFields();
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleDocumentFormSubmit}
              loading={
                createDocumentMutation.isPending || updateDocumentMutation.isPending
              }
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={documentForm} layout="vertical">
          <Form.Item
            name="title"
            label="文档标题"
            rules={[{ required: true, message: "请输入文档标题" }]}
          >
            <Input placeholder="请输入文档标题" />
          </Form.Item>
          <Form.Item
            name="content"
            label="文档内容"
            rules={[{ required: true, message: "请输入文档内容" }]}
          >
            <TextArea rows={15} placeholder="请输入文档内容，支持 Markdown 格式" />
          </Form.Item>
          <Form.Item name="chapter_id" label="所属章节">
            <Select placeholder="选择所属章节（可选）" allowClear>
              {treeData &&
                flattenChapters(treeData).map((chapter) => (
                  <Select.Option key={chapter.id} value={chapter.id}>
                    {chapter.name}
                  </Select.Option>
                ))}
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="draft">
            <Select>
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="published">已发布</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="sort_order" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
