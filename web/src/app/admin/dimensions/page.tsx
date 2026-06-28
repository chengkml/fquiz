"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type MenuProps,
} from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { DimensionItem, DimensionItemListResponse } from "@/types/dimension";

type CreateDimensionValues = {
  dimension_type: string;
  code: string;
  name: string;
  parent_id?: string;
  description?: string;
  is_enabled: boolean;
  sort_order: number;
};

type EditDimensionValues = {
  code: string;
  name: string;
  parent_id?: string;
  description?: string;
  is_enabled: boolean;
  sort_order: number;
};

const DIMENSION_TYPES = [
  { value: "voltage_level", label: "电压等级" },
  { value: "tower_type", label: "塔型" },
  { value: "scenario", label: "场景" },
  { value: "arrester_combination", label: "避雷器组合" },
];

function dimensionTypeLabel(type: string): string {
  const found = DIMENSION_TYPES.find((t) => t.value === type);
  return found ? found.label : type;
}

function statusLabel(enabled: boolean): string {
  return enabled ? "启用" : "禁用";
}

const DIMENSIONS_TABLE_MIN_SCROLL_Y = 180;

export default function AdminDimensionsPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [createForm] = Form.useForm<CreateDimensionValues>();
  const [editForm] = Form.useForm<EditDimensionValues>();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DimensionItem | null>(null);
  const [selectedDimensionType, setSelectedDimensionType] = useState<string | undefined>(undefined);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 50 });
  const [tableScrollY, setTableScrollY] = useState(DIMENSIONS_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("dimension.manage");
  const canRead = hasPermission("dimension.read") || canManage;
  const { current: paginationCurrent, pageSize: paginationPageSize } = pagination;

  const dimensionsQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(paginationPageSize));
    params.set("offset", String((paginationCurrent - 1) * paginationPageSize));
    if (selectedDimensionType) {
      params.set("dimension_type", selectedDimensionType);
    }
    return params.toString();
  }, [paginationCurrent, paginationPageSize, selectedDimensionType]);

  const dimensionsPath = `/api/v1/dimensions?${dimensionsQueryParams}`;

  const loadDimensions = useCallback(async () => {
    const response = await fetchWithAuth(dimensionsPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as DimensionItemListResponse;
  }, [fetchWithAuth, dimensionsPath]);

  const dimensionsQuery = useQuery({
    queryKey: ["admin.dimensions", dimensionsQueryParams],
    queryFn: loadDimensions,
    enabled: !!user && canRead,
  });

  useTopicSubscription(
    "admin.dimension-items",
    useCallback(() => {
      if (!user || !canRead) return;
      void queryClient.invalidateQueries({ queryKey: ["admin.dimensions"] });
    }, [canRead, queryClient, user]),
  );

  const dimensions = useMemo(() => dimensionsQuery.data?.items ?? [], [dimensionsQuery.data?.items]);

  const refreshData = async () => {
    await queryClient.refetchQueries({ queryKey: ["admin.dimensions"] });
  };

  const createDimensionMutation = useMutation({
    mutationFn: async (values: CreateDimensionValues) => {
      const response = await fetchWithAuth("/api/v1/dimensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DimensionItem>;
    },
    onSuccess: async () => {
      setSuccess("维度项已创建");
      setError("");
      createForm.resetFields();
      setCreateModalOpen(false);
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建维度项失败");
    },
  });

  const updateDimensionMutation = useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: string; payload: EditDimensionValues }) => {
      const response = await fetchWithAuth(`/api/v1/dimensions/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<DimensionItem>;
    },
    onSuccess: async () => {
      setSuccess("维度项已更新");
      setEditingItem(null);
      editForm.resetFields();
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "更新维度项失败");
    },
  });

  const deleteDimensionMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetchWithAuth(`/api/v1/dimensions/${itemId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<{ success: boolean }>;
    },
    onMutate: (itemId) => {
      setDeletingId(itemId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("维度项已删除");
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除维度项失败");
    },
    onSettled: () => setDeletingId(null),
  });

  const handleCreateDimension = async (values: CreateDimensionValues) => {
    setError("");
    setSuccess("");
    createDimensionMutation.mutate(values);
  };

  const openEditModal = (item: DimensionItem) => {
    setError("");
    setSuccess("");
    setEditingItem(item);
    editForm.setFieldsValue({
      code: item.code,
      name: item.name,
      parent_id: item.parent_id || undefined,
      description: item.description || undefined,
      is_enabled: item.is_enabled,
      sort_order: item.sort_order,
    });
  };

  const closeEditModal = () => {
    if (updateDimensionMutation.isPending) return;
    setEditingItem(null);
    editForm.resetFields();
  };

  const handleSubmitEdit = async (values: EditDimensionValues) => {
    if (!editingItem) return;
    updateDimensionMutation.mutate({ itemId: editingItem.id, payload: values });
  };

  const openCreateModal = () => {
    setError("");
    setSuccess("");
    createForm.resetFields();
    if (selectedDimensionType) {
      createForm.setFieldsValue({ dimension_type: selectedDimensionType });
    }
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (createDimensionMutation.isPending) return;
    setCreateModalOpen(false);
    createForm.resetFields();
  };

  const queryError = dimensionsQuery.error instanceof Error ? dimensionsQuery.error.message : "";
  const anyError = error || queryError;

  useToastFeedback({
    errorMessage: anyError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const columns: ColumnsType<DimensionItem> = [
    {
      title: "维度类型",
      dataIndex: "dimension_type",
      width: 120,
      render: (value: string) => dimensionTypeLabel(value),
    },
    {
      title: "编码",
      dataIndex: "code",
      width: 140,
    },
    {
      title: "名称",
      dataIndex: "name",
      width: 180,
    },
    {
      title: "父节点ID",
      dataIndex: "parent_id",
      width: 120,
      render: (value: string | null) => value || "-",
    },
    {
      title: "描述",
      dataIndex: "description",
      width: 200,
      render: (value: string | null) => value || "-",
    },
    {
      title: "状态",
      dataIndex: "is_enabled",
      width: 100,
      align: "center",
      render: (value: boolean) => (
        <Tag color={value ? "green" : "default"}>{statusLabel(value)}</Tag>
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
      width: 160,
      render: (_value, row) => {
        const deleteLoading = deletingId === row.id;
        const rowBusy = deleteLoading;

        const moreMenuItems: MenuProps["items"] = [
          {
            key: "toggle-status",
            label: row.is_enabled ? "禁用" : "启用",
            disabled: rowBusy,
            onClick: () => {
              updateDimensionMutation.mutate({
                itemId: row.id,
                payload: {
                  code: row.code,
                  name: row.name,
                  parent_id: row.parent_id || undefined,
                  description: row.description || undefined,
                  is_enabled: !row.is_enabled,
                  sort_order: row.sort_order,
                },
              });
            },
          },
        ];

        return (
          <Space wrap>
            <Button
              size="small"
              disabled={rowBusy || !canManage}
              onClick={() => openEditModal(row)}
            >
              编辑
            </Button>

            <Popconfirm
              title={`确认删除维度项 ${row.name}（${row.code}）？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleteLoading }}
              onConfirm={() => deleteDimensionMutation.mutate(row.id)}
              disabled={rowBusy || !canManage}
            >
              <Button danger size="small" loading={deleteLoading} disabled={rowBusy || !canManage}>
                删除
              </Button>
            </Popconfirm>

            <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]}>
              <Button size="small" disabled={rowBusy || !canManage} icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问维度管理页面。</p>
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
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `dimension.read` 或 `dimension.manage`）。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card
        title="维度管理"
        extra={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新增维度项
            </Button>
          )
        }
      >
        <Form layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item label="维度类型">
            <Select
              value={selectedDimensionType}
              allowClear
              placeholder="全部"
              options={DIMENSION_TYPES}
              onChange={(value) => {
                setSelectedDimensionType(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
              style={{ width: 180 }}
            />
          </Form.Item>
        </Form>

        <div ref={tableScrollAnchorRef}>
          <Table<DimensionItem>
            rowKey="id"
            dataSource={dimensions}
            columns={columns}
            loading={dimensionsQuery.isLoading}
            tableLayout="fixed"
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: Math.max(dimensionsQuery.data?.total ?? 0, 1),
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100, 200],
              showTotal: () => `共 ${dimensionsQuery.data?.total ?? 0} 条`,
              hideOnSinglePage: false,
              style: { marginBottom: 0 },
              onChange: (page, pageSize) => {
                setPagination({ current: page, pageSize });
              },
            }}
            scroll={{ y: tableScrollY }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到符合筛选条件的维度项。"
                />
              ),
            }}
          />
        </div>
      </Card>

      <Modal
        title="新增维度项"
        open={createModalOpen}
        destroyOnClose
        onCancel={closeCreateModal}
        onOk={() => createForm.submit()}
        okText="创建"
        cancelText="取消"
        confirmLoading={createDimensionMutation.isPending}
      >
        <Form<CreateDimensionValues>
          form={createForm}
          layout="vertical"
          onFinish={handleCreateDimension}
          autoComplete="off"
          initialValues={{ is_enabled: true, sort_order: 0 }}
        >
          <Form.Item
            label="维度类型"
            name="dimension_type"
            rules={[{ required: true, message: "请选择维度类型" }]}
          >
            <Select
              placeholder="请选择维度类型"
              options={DIMENSION_TYPES}
            />
          </Form.Item>

          <Form.Item
            label="编码"
            name="code"
            rules={[
              { required: true, message: "请输入编码" },
              { min: 1, message: "编码至少 1 位" },
              { max: 128, message: "编码不能超过 128 位" },
            ]}
          >
            <Input placeholder="例如 110kv" />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: "请输入名称" },
              { min: 1, message: "名称至少 1 位" },
              { max: 255, message: "名称不能超过 255 位" },
            ]}
          >
            <Input placeholder="例如 110千伏" />
          </Form.Item>

          <Form.Item label="父节点ID" name="parent_id">
            <Input placeholder="留空表示顶级节点" />
          </Form.Item>

          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="可选" maxLength={2000} />
          </Form.Item>

          <Form.Item label="启用状态" name="is_enabled" valuePropName="checked">
            <Select
              options={[
                { value: true, label: "启用" },
                { value: false, label: "禁用" },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="排序"
            name="sort_order"
            rules={[{ required: true, message: "请输入排序值" }]}
          >
            <Input type="number" placeholder="0" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingItem ? `编辑维度项：${editingItem.name}（${editingItem.code}）` : "编辑维度项"}
        open={!!editingItem}
        destroyOnClose
        onCancel={closeEditModal}
        onOk={() => editForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateDimensionMutation.isPending}
      >
        <Form<EditDimensionValues>
          form={editForm}
          layout="vertical"
          onFinish={handleSubmitEdit}
          autoComplete="off"
        >
          <Form.Item
            label="编码"
            name="code"
            rules={[
              { required: true, message: "请输入编码" },
              { min: 1, message: "编码至少 1 位" },
              { max: 128, message: "编码不能超过 128 位" },
            ]}
          >
            <Input placeholder="例如 110kv" />
          </Form.Item>

          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: "请输入名称" },
              { min: 1, message: "名称至少 1 位" },
              { max: 255, message: "名称不能超过 255 位" },
            ]}
          >
            <Input placeholder="例如 110千伏" />
          </Form.Item>

          <Form.Item label="父节点ID" name="parent_id">
            <Input placeholder="留空表示顶级节点" />
          </Form.Item>

          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="可选" maxLength={2000} />
          </Form.Item>

          <Form.Item label="启用状态" name="is_enabled" valuePropName="checked">
            <Select
              options={[
                { value: true, label: "启用" },
                { value: false, label: "禁用" },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="排序"
            name="sort_order"
            rules={[{ required: true, message: "请输入排序值" }]}
          >
            <Input type="number" placeholder="0" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
