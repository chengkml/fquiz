"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  type CardProps,
} from "antd";
import {
  PlusOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type RefAttributes } from "react";
import type { DataNode } from "antd/es/tree";

import { useAuth } from "@/components/auth-provider";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
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

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [tableScrollY, setTableScrollY] = useState(DOCUMENTS_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const pageCardRef = useRef<HTMLDivElement | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);

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

  const documents = useMemo(() => documentsData?.items ?? [], [documentsData?.items]);

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
      setSuccess("章节创建成功");
      setError("");
      refreshData();
      setChapterDialogOpen(false);
      chapterForm.resetFields();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "创建章节失败");
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
      setSuccess("章节更新成功");
      setError("");
      refreshData();
      setChapterDialogOpen(false);
      setEditingChapterId(null);
      chapterForm.resetFields();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "更新章节失败");
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
      setSuccess("章节删除成功");
      setError("");
      refreshData();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "删除章节失败");
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
      setSuccess("文档创建成功");
      setError("");
      refreshData();
      setDocumentDrawerOpen(false);
      documentForm.resetFields();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "创建文档失败");
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
      setSuccess("文档更新成功");
      setError("");
      refreshData();
      setDocumentDrawerOpen(false);
      setEditingDocumentId(null);
      documentForm.resetFields();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "更新文档失败");
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetchWithAuth(`/api/v1/documents/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readApiError(response));
    },
    onMutate: (id) => {
      setDeletingDocumentId(id);
      setError("");
      setSuccess("");
    },
    onSuccess: () => {
      setSuccess("文档删除成功");
      refreshData();
    },
    onError: (candidate: Error) => {
      setSuccess("");
      setError(candidate.message || "删除文档失败");
    },
    onSettled: () => setDeletingDocumentId(null),
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
      // Form validation errors are already shown
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
      // Form validation errors are already shown
    }
  }, [documentForm, editingDocumentId, updateDocumentMutation, createDocumentMutation]);

  const convertToTreeData = (chapters: DocumentChapterTreeItem[]): DataNode[] => {
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
  };

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

  const queryError =
    (documentsData && "error" in documentsData ? String(documentsData) : "");
  const anyError = error || queryError;

  useToastFeedback({
    errorMessage: anyError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const updateTableScrollY = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const anchorTop = anchor.getBoundingClientRect().top;
    const tableWrapper = anchor.querySelector<HTMLElement>(".ant-table-wrapper");
    const tableBody = anchor.querySelector<HTMLElement>(".ant-table-body");

    let nextHeight = Math.floor(window.innerHeight - anchorTop - DOCUMENTS_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? DOCUMENTS_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - DOCUMENTS_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(DOCUMENTS_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [anyError, documents.length, documentsLoading, updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updateTableScrollY);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateTableScrollY);
    });
    resizeObserver.observe(anchor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateTableScrollY]);

  const columns: ColumnsType<Document> = useMemo(() => [
    {
      title: "标题",
      dataIndex: "title",
      width: 200,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      align: "center",
      render: (status: string) => (
        <Tag color={status === "published" ? "green" : "orange"}>
          {status === "published" ? "已发布" : "草稿"}
        </Tag>
      ),
    },
    {
      title: "排序",
      dataIndex: "sort_order",
      width: 80,
      align: "center",
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_value, record) => {
        const deleteLoading = deletingDocumentId === record.id;
        const rowBusy = deleteLoading;

        return (
          <Space wrap>
            <Button
              size="small"
              disabled={rowBusy || !canManage}
              onClick={() => handleEditDocument(record)}
            >
              编辑
            </Button>

            <Popconfirm
              title={`确认删除文档 ${record.title}？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleteLoading }}
              onConfirm={() => deleteDocumentMutation.mutate(record.id)}
              disabled={rowBusy || !canManage}
            >
              <Button danger size="small" loading={deleteLoading} disabled={rowBusy || !canManage}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ], [canManage, handleEditDocument, deleteDocumentMutation, deletingDocumentId]);

  if (!user || !canRead) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未找到符合筛选条件的文档。"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Row gutter={16} style={{ flex: 1, minHeight: 0 }}>
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
            style={{ height: "100%", display: "flex", flexDirection: "column" }}
            bodyStyle={{ flex: 1, overflow: "auto" }}
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
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="未找到符合筛选条件的章节。"
              />
            )}
          </AntCard>
        </Col>
        <Col span={18}>
          <AntCard
            ref={pageCardRef}
            className="admin-documents-page-card"
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
            <div
              ref={tableScrollAnchorRef}
              className="admin-documents-table-anchor"
              style={{ "--admin-documents-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
            >
              <Table<Document>
                rowKey="id"
                dataSource={documents}
                columns={columns}
                loading={documentsLoading}
                tableLayout="fixed"
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (total) => `共 ${total} 条`,
                  hideOnSinglePage: false,
                  style: { marginBottom: 0 },
                }}
                scroll={{ y: tableScrollY }}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="未找到符合筛选条件的文档。"
                    />
                  ),
                }}
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
        okText="保存"
        cancelText="取消"
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
