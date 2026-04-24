"use client";

import { EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type MenuProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { MermaidViewer } from "@/components/mermaid-viewer";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  MermaidDiagramPageResponse,
  MermaidDiagramSummary,
  MermaidGroupListResponse,
} from "@/types/auth";

type SearchValues = {
  key_word?: string;
  group?: string;
};

type EditValues = {
  diagram_name: string;
  group?: string;
  description?: string;
  diagram_data?: string;
};

type PaginationState = {
  current: number;
  pageSize: number;
  total: number;
};

const DEFAULT_PAGINATION: PaginationState = {
  current: 1,
  pageSize: 20,
  total: 0,
};

const DEFAULT_DIAGRAM_SNIPPET = `flowchart TD\n    A[开始] --> B[结束]`;

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function pickTagColor(text: string | null): string {
  const colors = ["magenta", "red", "orange", "gold", "green", "cyan", "blue", "purple"];
  const normalized = (text || "").trim();
  if (!normalized) {
    return "default";
  }
  let sum = 0;
  for (const char of normalized) {
    sum += char.charCodeAt(0);
  }
  return colors[sum % colors.length] || "default";
}

export default function AdminMermaidMgrPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [searchForm] = Form.useForm<SearchValues>();
  const [createForm] = Form.useForm<EditValues>();
  const [editForm] = Form.useForm<EditValues>();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [items, setItems] = useState<MermaidDiagramSummary[]>([]);
  const [groups, setGroups] = useState<Array<{ label: string; value: string }>>([]);

  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);
  const [searchState, setSearchState] = useState<SearchValues>({ key_word: "", group: "" });

  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [current, setCurrent] = useState<MermaidDiagramSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = canRead;

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetchWithAuth("/api/v1/mermaids/diagrams/groups");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as MermaidGroupListResponse;
      const options = (payload.items ?? []).map((group) => ({
        label: group.label || group.name,
        value: group.name,
      }));
      setGroups(options);
    } catch (error) {
      const text = error instanceof Error ? error.message : "加载分组失败";
      setPanelError(text);
    }
  }, [fetchWithAuth]);

  const fetchMermaids = useCallback(
    async (pageNum: number, pageSize: number, filters: SearchValues) => {
      setLoading(true);
      try {
        const response = await fetchWithAuth("/api/v1/mermaids/diagrams/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key_word: (filters.key_word || "").trim() || null,
            group: (filters.group || "").trim() || null,
            page_num: Math.max(0, pageNum - 1),
            page_size: pageSize,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as MermaidDiagramPageResponse;
        setItems(payload.items ?? []);
        setPagination({
          current: pageNum,
          pageSize,
          total: payload.total ?? 0,
        });
        setPanelError("");
      } catch (error) {
        const text = error instanceof Error ? error.message : "加载流程图失败";
        setPanelError(text);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    void fetchGroups();
    void fetchMermaids(1, DEFAULT_PAGINATION.pageSize, { key_word: "", group: "" });
  }, [canRead, fetchGroups, fetchMermaids, user]);

  const handleSearch = async (values: SearchValues) => {
    const nextFilters = {
      key_word: (values.key_word || "").trim(),
      group: values.group || "",
    };
    setSearchState(nextFilters);
    await fetchMermaids(1, pagination.pageSize, nextFilters);
  };

  const handleReset = async () => {
    searchForm.resetFields();
    const nextFilters = { key_word: "", group: "" };
    setSearchState(nextFilters);
    await fetchMermaids(1, pagination.pageSize, nextFilters);
  };

  const handleTableChange = async (pageNum: number, pageSize: number) => {
    await fetchMermaids(pageNum, pageSize, searchState);
  };

  const openCreate = () => {
    createForm.setFieldsValue({
      diagram_name: "",
      group: undefined,
      description: "",
      diagram_data: DEFAULT_DIAGRAM_SNIPPET,
    });
    setCreateVisible(true);
  };

  const openEdit = (record: MermaidDiagramSummary) => {
    setCurrent(record);
    editForm.setFieldsValue({
      diagram_name: record.diagram_name,
      group: record.group_name || undefined,
      description: record.description || "",
      diagram_data: record.diagram_data || "",
    });
    setEditVisible(true);
  };

  const openPreview = (record: MermaidDiagramSummary) => {
    setCurrent(record);
    setPreviewVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSaving(true);
      const response = await fetchWithAuth("/api/v1/mermaids/diagrams/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagram_name: values.diagram_name,
          group: values.group || null,
          description: values.description || "",
          diagram_data: values.diagram_data || DEFAULT_DIAGRAM_SNIPPET,
          tags: [],
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("流程图创建成功");
      setCreateVisible(false);
      await fetchGroups();
      await fetchMermaids(1, pagination.pageSize, searchState);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) {
        return;
      }
      const text = error instanceof Error ? error.message : "流程图创建失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!current) {
      return;
    }
    try {
      const values = await editForm.validateFields();
      setSaving(true);
      const response = await fetchWithAuth("/api/v1/mermaids/diagrams/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          diagram_name: values.diagram_name,
          group: values.group || null,
          description: values.description || "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("流程图信息已更新");
      setEditVisible(false);
      setCurrent(null);
      await fetchGroups();
      await fetchMermaids(pagination.current, pagination.pageSize, searchState);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) {
        return;
      }
      const text = error instanceof Error ? error.message : "流程图更新失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: MermaidDiagramSummary) => {
    try {
      setDeletingId(record.id);
      const response = await fetchWithAuth(`/api/v1/mermaids/diagrams/delete/${record.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("流程图删除成功");
      await fetchGroups();
      await fetchMermaids(pagination.current, pagination.pageSize, searchState);
    } catch (error) {
      const text = error instanceof Error ? error.message : "流程图删除失败";
      setPanelError(text);
      message.error(text);
    } finally {
      setDeletingId(null);
    }
  };

  const handleMoreAction = (record: MermaidDiagramSummary, key: string) => {
    if (key === "edit") {
      openEdit(record);
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "确认删除该流程图吗？",
        content: `流程图名称：${record.diagram_name}`,
        okText: "确认删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => handleDelete(record),
      });
    }
  };

  const columns = useMemo<ColumnsType<MermaidDiagramSummary>>(
    () => [
      {
        title: "名称",
        dataIndex: "diagram_name",
        ellipsis: true,
        render: (_value, record) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => openPreview(record)}>
            {record.diagram_name}
          </Button>
        ),
      },
      {
        title: "分组",
        dataIndex: "group_label",
        width: 140,
        align: "center",
        render: (value: string | null, record) => (
          <Tag color={pickTagColor(value || record.group_name)}>{value || record.group_name || "未分组"}</Tag>
        ),
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        width: 190,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "操作",
        width: 160,
        align: "center",
        render: (_value, record) => {
          const menuItems: MenuProps["items"] = [
            {
              key: "edit",
              label: "编辑信息",
              disabled: !canManage,
            },
            {
              key: "delete",
              danger: true,
              label: "删除流程图",
              disabled: !canManage || deletingId === record.id,
            },
          ];

          return (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => router.push(`/admin/mermaid-mgr/${record.id}`)}>
                绘图
              </Button>
              <Dropdown menu={{ items: menuItems, onClick: ({ key }) => handleMoreAction(record, String(key)) }} trigger={["click"]}>
                <Button size="small" icon={<EllipsisOutlined />} aria-label="更多操作" />
              </Dropdown>
            </Space>
          );
        },
      },
    ],
    [canManage, deletingId, router],
  );

  if (initializing) {
    return <Card loading />;
  }

  if (!user) {
    return (
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          请先登录
        </Typography.Title>
        <Typography.Paragraph type="secondary">登录后可访问流程图管理页面。</Typography.Paragraph>
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
      <Card>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Typography.Title level={4} style={{ marginBottom: 0 }}>
                流程图管理
              </Typography.Title>
              <Typography.Text type="secondary">对齐 quiz 的 Mermaid 管理逻辑：分组筛选、列表管理、编辑页绘图。</Typography.Text>
            </div>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!canManage}>
                新建流程图
              </Button>
              <Tag color="blue">总数 {pagination.total}</Tag>
            </Space>
          </div>

          <Form form={searchForm} layout="inline" onFinish={(values: SearchValues) => void handleSearch(values)}>
            <Form.Item name="key_word" label="关键字">
              <Input allowClear placeholder="按名称搜索" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="group" label="分组">
              <Select allowClear placeholder="全部分组" style={{ width: 220 }} options={groups} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button htmlType="submit" type="primary" loading={loading}>
                  查询
                </Button>
                <Button onClick={() => void handleReset()} disabled={loading}>
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Space>
      </Card>

      {panelError ? (
        <Alert
          type="error"
          showIcon
          closable
          message="流程图操作失败"
          description={panelError}
          onClose={() => setPanelError("")}
        />
      ) : null}

      <Card>
        <Table<MermaidDiagramSummary>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程图数据" />,
          }}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            onChange: (pageNum: number, pageSize: number) => {
              void handleTableChange(pageNum, pageSize);
            },
          }}
        />
      </Card>

      <Modal
        title="新建流程图"
        open={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="diagram_name" label="名称" rules={[{ required: true, message: "请输入流程图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="group" label="分组">
            <Select allowClear options={groups} placeholder="请选择分组" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
          <Form.Item name="diagram_data" label="初始 Mermaid 代码">
            <Input.TextArea rows={6} maxLength={200000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑流程图信息"
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setCurrent(null);
        }}
        onOk={() => void handleEdit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="diagram_name" label="名称" rules={[{ required: true, message: "请输入流程图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="group" label="分组">
            <Select allowClear options={groups} placeholder="请选择分组" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={current?.diagram_name || "流程图详情"}
        width={900}
        open={previewVisible}
        onClose={() => {
          setPreviewVisible(false);
          setCurrent(null);
        }}
      >
        {current ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div>
              <Typography.Text strong>描述：</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {current.description || "-"}
              </Typography.Text>
            </div>
            <div>
              <Typography.Text strong>分组：</Typography.Text>
              <Tag color={pickTagColor(current.group_label || current.group_name)} style={{ marginLeft: 8 }}>
                {current.group_label || current.group_name || "未分组"}
              </Tag>
            </div>
            <MermaidViewer code={current.diagram_data || ""} />
          </Space>
        ) : null}
      </Drawer>
    </main>
  );
}
