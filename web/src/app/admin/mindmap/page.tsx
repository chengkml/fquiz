"use client";

import { EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type MenuProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type { MindMapListResponse, MindMapSummary } from "@/types/auth";

type SearchValues = {
  map_name?: string;
};

type EditValues = {
  map_name: string;
  descr?: string;
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

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function AdminMindMapPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const router = useRouter();

  const [searchForm] = Form.useForm<SearchValues>();
  const [createForm] = Form.useForm<EditValues>();
  const [editForm] = Form.useForm<EditValues>();

  const [loading, setLoading] = useState(false);
  const [panelError, setPanelError] = useState("");

  const [items, setItems] = useState<MindMapSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [current, setCurrent] = useState<MindMapSummary | null>(null);

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const currentPage = pagination.current;
  const currentPageSize = pagination.pageSize;

  const fetchMindMaps = useCallback(
    async (pageNum: number, pageSize: number, mapName: string) => {
      setLoading(true);
      try {
        const response = await fetchWithAuth("/api/v1/mindmap/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            map_name: mapName || null,
            page_num: Math.max(0, pageNum - 1),
            page_size: pageSize,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const payload = (await response.json()) as MindMapListResponse;
        setItems(payload.items ?? []);
        setPagination({
          current: pageNum,
          pageSize,
          total: payload.total ?? 0,
        });
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
    void fetchMindMaps(currentPage, currentPageSize, searchKeyword);
  }, [canRead, currentPage, currentPageSize, fetchMindMaps, searchKeyword, user]);

  const handleSearch = (values: SearchValues) => {
    const keyword = (values.map_name ?? "").trim();
    setSearchKeyword(keyword);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setSearchKeyword("");
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handlePaginationChange = (currentValue: number, pageSizeValue: number) => {
    setPagination((prev) => ({
      ...prev,
      current: currentValue,
      pageSize: pageSizeValue,
    }));
  };

  const openCreate = () => {
    createForm.resetFields();
    setCreateVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateSaving(true);
      const response = await fetchWithAuth("/api/v1/mindmap/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_name: values.map_name,
          descr: values.descr ?? "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const created = (await response.json()) as MindMapSummary;
      message.success("思维导图创建成功");
      setCreateVisible(false);
      router.push(`/admin/mindmap/edit/${created.id}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "思维导图创建失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setCreateSaving(false);
    }
  };

  const openEditBasicInfo = (record: MindMapSummary) => {
    setCurrent(record);
    editForm.setFieldsValue({
      map_name: record.map_name,
      descr: record.descr ?? "",
    });
    setEditVisible(true);
  };

  const handleEditBasicInfo = async () => {
    if (!current) return;
    try {
      const values = await editForm.validateFields();
      setEditSaving(true);
      const response = await fetchWithAuth("/api/v1/mindmap/update-basic-info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          map_name: values.map_name,
          descr: values.descr ?? "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("思维导图信息已更新");
      setEditVisible(false);
      setCurrent(null);
      await fetchMindMaps(pagination.current, pagination.pageSize, searchKeyword);
    } catch (error) {
      if (error instanceof Error && error.message.includes("out of date")) return;
      const text = error instanceof Error ? error.message : "更新思维导图失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (record: MindMapSummary) => {
    try {
      setDeletingId(record.id);
      const response = await fetchWithAuth(`/api/v1/mindmap/delete/${record.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      message.success("思维导图删除成功");
      await fetchMindMaps(pagination.current, pagination.pageSize, searchKeyword);
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除思维导图失败";
      message.error(text);
      setPanelError(text);
    } finally {
      setDeletingId(null);
    }
  };

  const handleMoreAction = (record: MindMapSummary, key: string) => {
    if (key === "edit") {
      openEditBasicInfo(record);
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "确认删除该思维导图吗？",
        content: `导图名称：${record.map_name}`,
        okText: "确认删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => handleDelete(record),
      });
    }
  };

  const columns = useMemo<ColumnsType<MindMapSummary>>(
    () => [
      {
        title: "导图名称",
        dataIndex: "map_name",
        width: 280,
        ellipsis: true,
        render: (_, record) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => router.push(`/admin/mindmap/edit/${record.id}`)}>
            {record.map_name}
          </Button>
        ),
      },
      {
        title: "描述",
        dataIndex: "descr",
        width: 320,
        ellipsis: true,
        render: (value: string | null) => value || "-",
      },
      {
        title: "创建人",
        dataIndex: "create_user",
        width: 140,
        align: "center",
        render: (value: string | null) => value || "-",
      },
      {
        title: "创建时间",
        dataIndex: "create_date",
        width: 190,
        render: (value: string | null) => formatDateTime(value),
      },
      {
        title: "操作",
        width: 160,
        fixed: "right",
        align: "center",
        render: (_, record) => {
          const menuItems: MenuProps["items"] = [
            {
              key: "edit",
              label: "编辑信息",
              disabled: !canManage,
            },
            {
              key: "delete",
              danger: true,
              label: "删除导图",
              disabled: !canManage || deletingId === record.id,
            },
          ];

          return (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => router.push(`/admin/mindmap/edit/${record.id}`)}>
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
        <Typography.Title level={4} style={{ marginTop: 0 }}>请先登录</Typography.Title>
        <Typography.Paragraph type="secondary">登录后可访问思维导图管理页面。</Typography.Paragraph>
        <Button type="primary" onClick={() => router.push("/")}>返回首页</Button>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>无访问权限</Typography.Title>
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
                思维导图
              </Typography.Title>
              <Typography.Text type="secondary">
                使用老工程 `mind_map` 表结构与流程，管理导图并进入编辑页。
              </Typography.Text>
            </div>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!canManage}>
                新建思维导图
              </Button>
              <Tag color="blue">总数 {pagination.total}</Tag>
            </Space>
          </div>

          <Form form={searchForm} layout="inline" onFinish={handleSearch} initialValues={{ map_name: "" }}>
            <Form.Item name="map_name" label="导图名称">
              <Input allowClear placeholder="输入关键字" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button htmlType="submit" type="primary" loading={loading}>
                  查询
                </Button>
                <Button onClick={handleReset} disabled={loading}>
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
          message="操作失败"
          description={panelError}
          onClose={() => setPanelError("")}
        />
      ) : null}

      <Card>
        <Table<MindMapSummary>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无思维导图数据" />,
          }}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            onChange: handlePaginationChange,
          }}
        />
      </Card>

      <Modal
        title="新建思维导图"
        open={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={createSaving}
        okButtonProps={{ disabled: createSaving }}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="map_name" label="导图名称" rules={[{ required: true, message: "请输入导图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="descr" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑导图信息"
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setCurrent(null);
        }}
        onOk={() => void handleEditBasicInfo()}
        confirmLoading={editSaving}
        okButtonProps={{ disabled: editSaving }}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="map_name" label="导图名称" rules={[{ required: true, message: "请输入导图名称" }]}>
            <Input maxLength={255} />
          </Form.Item>
          <Form.Item name="descr" label="描述">
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
