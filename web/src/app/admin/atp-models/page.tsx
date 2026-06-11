"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import { AdminPageLoading } from "@/components/admin-page-loading";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type { AtpAssetListResponse, AtpAssetSummary, AtpEngineStatusResponse } from "@/types/auth";

type AssetFormValues = {
  code: string;
  name: string;
  description: string;
  status: "draft" | "enabled" | "disabled" | "archived";
  voltage_level: string;
  tower_type: string;
  scene_type: string;
  tags_text: string;
};

const EMPTY_FORM: AssetFormValues = {
  code: "",
  name: "",
  description: "",
  status: "enabled",
  voltage_level: "",
  tower_type: "",
  scene_type: "",
  tags_text: "",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusColor(value: string): string {
  if (value === "enabled" || value === "released") return "green";
  if (value === "draft") return "gold";
  if (value === "disabled") return "default";
  if (value === "archived") return "red";
  return "blue";
}

function toFormValues(item: AtpAssetSummary): AssetFormValues {
  return {
    code: item.code,
    name: item.name,
    description: item.description,
    status: item.status,
    voltage_level: item.voltage_level ?? "",
    tower_type: item.tower_type ?? "",
    scene_type: item.scene_type ?? "",
    tags_text: item.tags_json.join(", "),
  };
}

function buildPayload(values: AssetFormValues) {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    status: values.status,
    voltage_level: values.voltage_level.trim() || null,
    tower_type: values.tower_type.trim() || null,
    scene_type: values.scene_type.trim() || null,
    tags_json: values.tags_text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export default function AtpModelsPage() {
  const { message } = App.useApp();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AssetFormValues>();

  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [editingAsset, setEditingAsset] = useState<AtpAssetSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const canRead = hasPermission("atp.read") || hasPermission("atp.run") || hasPermission("atp.manage");
  const canManage = hasPermission("atp.manage");

  const assetsQuery = useQuery({
    queryKey: ["atp-assets", keyword, statusFilter],
    enabled: Boolean(user && canRead),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (keyword.trim()) {
        searchParams.set("keyword", keyword.trim());
      }
      if (statusFilter) {
        searchParams.set("status", statusFilter);
      }
      const suffix = searchParams.toString();
      const response = await fetchWithAuth(`/api/v1/atp/assets${suffix ? `?${suffix}` : ""}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetListResponse;
    },
  });

  const engineQuery = useQuery({
    queryKey: ["atp-asset-engine-status"],
    enabled: Boolean(user && canRead),
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/atp/engine/status");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpEngineStatusResponse;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: AssetFormValues) => {
      const payload = buildPayload(values);
      const response = editingAsset
        ? await fetchWithAuth(`/api/v1/atp/assets/${editingAsset.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchWithAuth("/api/v1/atp/assets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return await response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["atp-assets"] });
      message.success(editingAsset ? "资料包已更新" : "资料包已创建");
      setModalOpen(false);
      setEditingAsset(null);
      form.resetFields();
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "保存资料包失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const response = await fetchWithAuth(`/api/v1/atp/assets/${assetId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["atp-assets"] });
      message.success("资料包已删除");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "删除资料包失败");
    },
  });

  const assetItems = assetsQuery.data?.items ?? [];

  const columns = useMemo<ColumnsType<AtpAssetSummary>>(
    () => [
      {
        title: "资料包",
        key: "asset",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{item.name}</Typography.Text>
            <Typography.Text type="secondary" code>
              {item.code}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "业务维度",
        key: "dimensions",
        render: (_, item) => (
          <Space size={[4, 4]} wrap>
            <Tag>{item.voltage_level || "未标注电压"}</Tag>
            <Tag>{item.tower_type || "未标注塔型"}</Tag>
            <Tag>{item.scene_type || "未标注场景"}</Tag>
          </Space>
        ),
      },
      {
        title: "当前发布",
        key: "release",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text>{item.active_release_tag || (item.active_release_no ? `r${item.active_release_no}` : "-")}</Typography.Text>
            <Typography.Text type="secondary">
              {item.release_count} 个 release / {item.run_count} 次运行
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>,
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "操作",
        key: "actions",
        render: (_, item) => (
          <Space wrap>
            <Link href={`/admin/atp-models/${item.id}`}>
              <Button size="small" type="primary">
                详情
              </Button>
            </Link>
            <Button
              size="small"
              disabled={!canManage}
              onClick={() => {
                setEditingAsset(item);
                form.setFieldsValue(toFormValues(item));
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
            <Popconfirm
              title="删除资料包"
              description="这会同时删除其 release 与运行记录。"
              okText="删除"
              cancelText="取消"
              onConfirm={() => void deleteMutation.mutateAsync(item.id)}
              disabled={!canManage}
            >
              <Button size="small" danger disabled={!canManage}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [canManage, deleteMutation, form],
  );

  if (initializing) {
    return <AdminPageLoading tip="加载 ATP 资料包中..." minHeightClassName="min-h-[280px]" />;
  }

  if (!user || !canRead) {
    return (
      <Card title="ATP 资料包管理">
        <Typography.Text type="secondary">
          {!user ? "请先登录后再查看 ATP 资料包管理。" : "当前账号无 ATP 模块权限（需要 atp.read/atp.run/atp.manage）。"}
        </Typography.Text>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="ATP 资料包管理"
        extra={
          <Space wrap>
            <Link href="/admin/power-lines/atp-viewer">
              <Button>Legacy 文本工具</Button>
            </Link>
            <Button
              type="primary"
              disabled={!canManage}
              onClick={() => {
                setEditingAsset(null);
                form.setFieldsValue(EMPTY_FORM);
                setModalOpen(true);
              }}
            >
              新建资料包
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type={engineQuery.data?.available ? "success" : "warning"}
            showIcon
            message={engineQuery.data?.available ? "ATP/Wine 执行环境可用" : "ATP/Wine 执行环境待检查"}
            description={
              engineQuery.data
                ? `模式：${engineQuery.data.mode}，执行器：${engineQuery.data.resolved_executable || engineQuery.data.executable_path}。`
                : engineQuery.error instanceof Error
                  ? engineQuery.error.message
                  : "目录化 release 会在运行前物化到 wine 允许运行根目录。"
            }
          />
          <Space wrap>
            <Input.Search
              allowClear
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onSearch={(value) => setKeyword(value)}
              placeholder="按编码 / 名称 / 描述搜索"
              style={{ width: 280 }}
            />
            <Select
              allowClear
              value={statusFilter}
              placeholder="状态筛选"
              style={{ width: 180 }}
              onChange={(value) => setStatusFilter(value)}
              options={[
                { value: "draft", label: "draft" },
                { value: "enabled", label: "enabled" },
                { value: "disabled", label: "disabled" },
                { value: "archived", label: "archived" },
              ]}
            />
          </Space>

          {assetsQuery.error instanceof Error ? (
            <Alert type="error" showIcon message="ATP 资料包加载失败" description={assetsQuery.error.message} />
          ) : null}

          <Table<AtpAssetSummary>
            rowKey="id"
            loading={assetsQuery.isLoading}
            columns={columns}
            dataSource={assetItems}
            locale={{ emptyText: "暂无 ATP 资料包" }}
            pagination={false}
            scroll={{ x: 1080 }}
          />
        </Space>
      </Card>

      <Modal
        title={editingAsset ? "编辑 ATP 资料包" : "新建 ATP 资料包"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingAsset(null);
          form.resetFields();
        }}
        onOk={() => void form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnClose
      >
        <Form<AssetFormValues>
          form={form}
          layout="vertical"
          initialValues={EMPTY_FORM}
          onFinish={(values) => void saveMutation.mutateAsync(values)}
        >
          <Form.Item name="code" label="编码" rules={[{ required: true, message: "请输入资料包编码" }]}>
            <Input disabled={Boolean(editingAsset)} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入资料包名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
            <Select
              options={[
                { value: "draft", label: "draft" },
                { value: "enabled", label: "enabled" },
                { value: "disabled", label: "disabled" },
                { value: "archived", label: "archived" },
              ]}
            />
          </Form.Item>
          <Form.Item name="voltage_level" label="电压等级">
            <Input placeholder="如 220 / 500 / 1000" />
          </Form.Item>
          <Form.Item name="tower_type" label="塔型">
            <Input placeholder="如 sihuita / ganzi" />
          </Form.Item>
          <Form.Item name="scene_type" label="场景">
            <Input placeholder="如 fanji / raoji3" />
          </Form.Item>
          <Form.Item name="tags_text" label="标签">
            <Input placeholder="多个标签用逗号分隔" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
