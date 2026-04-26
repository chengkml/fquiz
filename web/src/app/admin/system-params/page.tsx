"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps,
} from "antd";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
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

export default function AdminSystemParamsPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [formApi] = Form.useForm<FormState>();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
  }, [formApi]);

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

  const items = listQuery.data?.items ?? [];
  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";

  const columns = useMemo<TableProps<SystemParamSummary>["columns"]>(() => {
    const baseColumns: NonNullable<TableProps<SystemParamSummary>["columns"]> = [
      {
        title: "ID",
        dataIndex: "id",
        key: "id",
        width: 90,
      },
      {
        title: "参数键",
        dataIndex: "param_key",
        key: "param_key",
        width: 220,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "参数名称",
        dataIndex: "param_name",
        key: "param_name",
        width: 220,
      },
      {
        title: "参数值",
        dataIndex: "param_value",
        key: "param_value",
        ellipsis: true,
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
          <Space size={8}>
            <Button size="small" onClick={() => startEdit(record)}>
              编辑
            </Button>
            <Button
              size="small"
              danger
              loading={deleteMutation.isPending}
              onClick={() => {
                Modal.confirm({
                  title: "删除系统参数",
                  content: `确认删除系统参数 ${record.param_key} 吗？`,
                  okText: "删除",
                  okButtonProps: { danger: true },
                  cancelText: "取消",
                  onOk: async () => {
                    await deleteMutation.mutateAsync(record);
                  },
                });
              }}
            >
              删除
            </Button>
          </Space>
        ),
      });
    }

    return baseColumns;
  }, [canManage, deleteMutation.isPending, deleteMutation, startEdit]);

  if (initializing || listQuery.isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再访问系统参数页面。</Typography.Text>
          <Button>
            <Link href="/">返回首页</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            你没有访问该页面的权限（需要 `system_param.read`）。
          </Typography.Text>
          <Button>
            <Link href="/">返回首页</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} className="w-full">
      {(error || listError) && <Alert type="error" showIcon message="操作失败" description={error || listError} />}
      {success && <Alert type="success" showIcon message="操作成功" description={success} />}

      <Card
        title="系统参数列表"
        extra={canManage ? <Button type="primary" onClick={startCreate}>新建参数</Button> : undefined}
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">维护系统级参数键值、状态与说明。</Typography.Text>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={keyword}
              allowClear
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按参数键 / 名称 / 值筛选"
            />
            <Select<StatusFilter>
              value={statusFilter}
              options={[...STATUS_FILTER_OPTIONS]}
              onChange={(value) => setStatusFilter(value)}
            />
          </div>

          <Table<SystemParamSummary>
            rowKey="id"
            loading={listQuery.isFetching}
            dataSource={items}
            columns={columns}
            pagination={false}
            scroll={{ x: 980 }}
            locale={{ emptyText: "未找到系统参数。" }}
          />
        </Space>
      </Card>

      {canManage && (
        <Card title={editingId === null ? "新建系统参数" : "编辑系统参数"}>
          <Space direction="vertical" size={12} className="w-full">
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
                  <Select
                    options={[...PARAM_STATUS_OPTIONS]}
                  />
                </Form.Item>
              </div>
            </Form>

            <Space>
              <Button type="primary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? "提交中..." : editingId === null ? "创建" : "保存"}
              </Button>
              <Button onClick={resetForm}>重置</Button>
            </Space>
          </Space>
        </Card>
      )}
    </Space>
  );
}
