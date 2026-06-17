"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Space,
  Table,
  Tag,
  type CardProps,
  type TableColumnsType,
} from "antd";
import type { ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { SystemParamListResponse, SystemParamSummary } from "@/types/auth";

type StatusFilter = "all" | "enabled" | "disabled";

type FormState = {
  param_key: string;
  param_name: string;
  param_value: string;
  description: string;
  status: "enabled" | "disabled";
};

const EMPTY_FORM: FormState = {
  param_key: "",
  param_name: "",
  param_value: "",
  description: "",
  status: "enabled",
};

const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "已启用", value: "enabled" },
  { label: "已禁用", value: "disabled" },
] as const satisfies ReadonlyArray<{ label: string; value: StatusFilter }>;

const PARAM_STATUS_OPTIONS = [
  { label: "已启用", value: "enabled" },
  { label: "已禁用", value: "disabled" },
] as const satisfies ReadonlyArray<{ label: string; value: FormState["status"] }>;

const AntCard = Card as unknown as ComponentType<CardProps>;

const PARAM_TABLE_MIN_SCROLL_Y = 180;
const PARAM_TABLE_VIEWPORT_GAP = 40;
const PARAM_TABLE_FALLBACK_RESERVE = 220;

export default function AdminSystemParamsPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [formApi] = Form.useForm<FormState>();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [tableScrollY, setTableScrollY] = useState(PARAM_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasPermission("system_param.read") || hasPermission("system_param.manage");
  const canManage = hasPermission("system_param.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    const qs = params.toString();
    return `/api/v1/admin/system-params${qs ? `?${qs}` : ""}`;
  }, [keyword, statusFilter]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as SystemParamListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/system-params"),
    });
  }, [queryClient]);

  useTopicSubscription("admin.system-params", useCallback(() => {
    void refreshList();
  }, [refreshList]));

  const resetForm = useCallback(() => {
    setEditingId(null);
    formApi.setFieldsValue(EMPTY_FORM);
  }, [formApi]);

  const startCreate = useCallback(() => {
    setError("");
    setSuccess("");
    resetForm();
    setEditorOpen(true);
  }, [resetForm]);

  const startEdit = useCallback((item: SystemParamSummary) => {
    setError("");
    setSuccess("");
    setEditingId(item.id);
    formApi.setFieldsValue({
      param_key: item.param_key,
      param_name: item.param_name,
      param_value: item.param_value,
      description: item.description ?? "",
      status: item.status,
    });
    setEditorOpen(true);
  }, [formApi]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    resetForm();
  }, [resetForm]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 system_param.manage 权限");
      }

      const values = await formApi.validateFields();
      if (!values.param_name.trim() || !values.param_key.trim()) {
        throw new Error("参数键和参数名称不能为空");
      }

      if (editingId === null) {
        const response = await fetchWithAuth("/api/v1/admin/system-params", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            param_key: values.param_key.trim(),
            param_name: values.param_name.trim(),
            param_value: values.param_value,
            description: values.description,
            status: values.status,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created" as const;
      }

      const response = await fetchWithAuth(`/api/v1/admin/system-params/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          param_name: values.param_name.trim(),
          param_value: values.param_value,
          description: values.description,
          status: values.status,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "updated" as const;
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "系统参数已创建" : "系统参数已更新");
      setEditorOpen(false);
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: SystemParamSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/system-params/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return item.id;
    },
    onSuccess: async (deletedId) => {
      if (editingId === deletedId) {
        setEditorOpen(false);
        resetForm();
      }
      setError("");
      setSuccess("系统参数已删除");
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
  });

  const removeParam = useCallback(async (item: SystemParamSummary) => {
    setDeletingId(item.id);
    try {
      await deleteMutation.mutateAsync(item);
    } finally {
      setDeletingId(null);
    }
  }, [deleteMutation]);

  const items = listQuery.data?.items ?? [];
  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";

  useToastFeedback({
    errorMessage: error || listError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const columns = useMemo<TableColumnsType<SystemParamSummary>>(() => {
    const baseColumns: TableColumnsType<SystemParamSummary> = [
      {
        title: "ID",
        dataIndex: "id",
        key: "id",
        width: 110,
      },
      {
        title: "参数键",
        dataIndex: "param_key",
        key: "param_key",
        width: 240,
        render: (value: string) => <span className="font-mono text-xs">{value}</span>,
      },
      {
        title: "参数名称",
        dataIndex: "param_name",
        key: "param_name",
        width: 200,
      },
      {
        title: "参数值",
        dataIndex: "param_value",
        key: "param_value",
        ellipsis: true,
        width: 240,
        render: (value: string) => value || "-",
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (value: SystemParamSummary["status"]) => (
          <Tag color={value === "enabled" ? "success" : "default"}>
            {value === "enabled" ? "已启用" : "已禁用"}
          </Tag>
        ),
      },
      {
        title: "更新时间",
        dataIndex: "updated_at",
        key: "updated_at",
        width: 180,
        render: (value: string) => new Date(value).toLocaleString(),
      },
    ];

    if (canManage) {
      baseColumns.push({
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 150,
        render: (_, record) => (
          <Space size="small">
            <Button size="small" onClick={() => startEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title="删除系统参数"
              description={`确认删除系统参数 ${record.param_key} 吗？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deletingId === record.id }}
              onConfirm={() => void removeParam(record)}
            >
              <Button size="small" danger loading={deletingId === record.id}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      });
    }

    return baseColumns;
  }, [canManage, deletingId, removeParam, startEdit]);

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - PARAM_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? PARAM_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - PARAM_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(PARAM_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    updateTableScrollY();
  }, [items.length, listQuery.isFetching, listError, error, success, updateTableScrollY]);

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
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问参数管理页面。</p>
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `system_param.read`）。</p>
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
    <div className="flex flex-1 flex-col space-y-6">
      <AntCard
        title="参数列表"
        style={{ height: '100%' }}
        extra={(
          <Space>
            {listQuery.isFetching && <Spin size="small" />}
            {canManage ? (
              <Button type="primary" onClick={startCreate}>
                新建参数
              </Button>
            ) : null}
          </Space>
        )}
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[240px]">
            <Input
              value={keyword}
              allowClear
              onChange={(event) => setKeyword(event.currentTarget.value)}
              placeholder="按参数键/名称/值筛选"
            />
          </Form.Item>

          <Form.Item label="状态" className="min-w-[170px]">
            <Select<StatusFilter>
              value={statusFilter}
              options={[...STATUS_FILTER_OPTIONS]}
              onChange={(value) => setStatusFilter(value)}
            />
          </Form.Item>

          <Form.Item>
            <Button
              onClick={() => {
                setKeyword("");
                setStatusFilter("all");
              }}
            >
              重置筛选
            </Button>
          </Form.Item>
        </Form>

        <div
          ref={tableScrollAnchorRef}
          className="admin-system-params-table-anchor mt-4"
          style={{ "--admin-system-params-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<SystemParamSummary>
            rowKey="id"
            loading={listQuery.isFetching}
            dataSource={items}
            columns={columns}
            scroll={{ x: 1120, y: tableScrollY }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              hideOnSinglePage: false,
              style: { marginBottom: 0 },
            }}
            locale={{
              emptyText: <Empty description="未找到符合筛选条件的系统参数。" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </div>
      </AntCard>

      {canManage && (
        <Modal
          title={editingId === null ? "新建系统参数" : "编辑系统参数"}
          open={editorOpen}
          onCancel={closeEditor}
          width={760}
          destroyOnClose
          footer={(
            <Space>
              <Button type="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "提交中..." : editingId === null ? "创建" : "保存"}
              </Button>
              <Button onClick={resetForm}>重置</Button>
            </Space>
          )}
        >
          <Form<FormState> form={formApi} layout="vertical" initialValues={EMPTY_FORM}>
            <div className="grid gap-4 md:grid-cols-2">
              <Form.Item<FormState>
                label="参数键"
                name="param_key"
                rules={[{ required: true, message: "请输入参数键" }]}
              >
                <Input disabled={editingId !== null} placeholder="如 site.title" />
              </Form.Item>

              <Form.Item<FormState>
                label="参数名称"
                name="param_name"
                rules={[{ required: true, message: "请输入参数名称" }]}
              >
                <Input placeholder="如 站点标题" />
              </Form.Item>

              <Form.Item<FormState> className="md:col-span-2" label="参数值" name="param_value">
                <Input.TextArea rows={4} />
              </Form.Item>

              <Form.Item<FormState> className="md:col-span-2" label="说明" name="description">
                <Input.TextArea rows={3} />
              </Form.Item>

              <Form.Item<FormState> label="状态" name="status">
                <Select options={[...PARAM_STATUS_OPTIONS]} />
              </Form.Item>
            </div>
          </Form>
        </Modal>
      )}
    </div>
  );
}
