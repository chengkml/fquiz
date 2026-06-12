"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
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
import { CreatableSingleSelect } from "@/components/creatable-single-select";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import { getAtpAssetStatusDisplay } from "@/lib/atp-asset-display";
import type { AtpAssetListResponse, AtpAssetSummary } from "@/types/auth";

type AssetFormValues = {
  code: string;
  name: string;
  description: string;
  status: "draft" | "enabled" | "disabled" | "archived";
  voltage_level: string;
  tower_type: string;
  scene_type: string;
  arrester_config: string;
};

const EMPTY_FORM: AssetFormValues = {
  code: "",
  name: "",
  description: "",
  status: "enabled",
  voltage_level: "",
  tower_type: "",
  scene_type: "",
  arrester_config: "",
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

function toFormValues(item: AtpAssetSummary): AssetFormValues {
  return {
    code: item.code,
    name: item.name,
    description: item.description,
    status: item.status,
    voltage_level: item.voltage_level ?? "",
    tower_type: item.tower_type ?? "",
    scene_type: item.scene_type ?? "",
    arrester_config: item.arrester_config ?? "",
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
    arrester_config: values.arrester_config.trim() || null,
  };
}

function buildDimensionOptions(items: AtpAssetSummary[], picker: (item: AtpAssetSummary) => string | null): Array<{ label: string; value: string }> {
  const values = new Set<string>();
  for (const item of items) {
    const value = picker(item)?.trim();
    if (!value) {
      continue;
    }
    values.add(value);
  }
  return Array.from(values)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((value) => ({ label: value, value }));
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
      message.success(editingAsset ? "模型已更新" : "模型已创建");
      setModalOpen(false);
      setEditingAsset(null);
      form.resetFields();
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "保存模型失败");
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
      message.success("模型已删除");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "删除模型失败");
    },
  });

  const assetItems = assetsQuery.data?.items ?? [];
  const voltageLevelOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.voltage_level), [assetItems]);
  const towerTypeOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.tower_type), [assetItems]);
  const sceneTypeOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.scene_type), [assetItems]);
  const arresterConfigOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.arrester_config), [assetItems]);

  const columns = useMemo<ColumnsType<AtpAssetSummary>>(
    () => [
      {
        title: "模型",
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
            <Tag>{item.voltage_level || "未设置电压等级"}</Tag>
            <Tag>{item.tower_type || "未设置塔型"}</Tag>
            <Tag>{item.scene_type || "未设置场景"}</Tag>
          </Space>
        ),
      },
      {
        title: "当前版本",
        key: "release",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text>{item.active_release_tag || (item.active_release_no ? `r${item.active_release_no}` : "-")}</Typography.Text>
            <Typography.Text type="secondary">
              {item.release_count} 个版本 / {item.run_count} 次运行
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        render: (value: string) => {
          const display = getAtpAssetStatusDisplay(value);
          return <Tag color={display.color}>{display.label}</Tag>;
        },
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
              title="删除模型"
              description="这会同时删除其版本与运行记录。"
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
    return <AdminPageLoading tip="加载 ATP 模型中..." minHeightClassName="min-h-[280px]" />;
  }

  if (!user || !canRead) {
    return (
      <Card title="ATP 模型管理">
        <Typography.Text type="secondary">
          {!user ? "请先登录后再查看 ATP 模型管理。" : "当前账号无 ATP 模块权限（需要 atp.read/atp.run/atp.manage）。"}
        </Typography.Text>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="ATP 模型管理"
        extra={
          <Button
            type="primary"
            disabled={!canManage}
            onClick={() => {
              setEditingAsset(null);
              form.setFieldsValue(EMPTY_FORM);
              setModalOpen(true);
            }}
          >
            新建模型
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
                { value: "draft", label: "草稿" },
                { value: "enabled", label: "启用" },
                { value: "disabled", label: "停用" },
                { value: "archived", label: "归档" },
              ]}
            />
          </Space>

          {assetsQuery.error instanceof Error ? (
            <Alert type="error" showIcon message="ATP 模型加载失败" description={assetsQuery.error.message} />
          ) : null}

          <Table<AtpAssetSummary>
            rowKey="id"
            loading={assetsQuery.isLoading}
            columns={columns}
            dataSource={assetItems}
            locale={{ emptyText: "暂无 ATP 模型" }}
            pagination={false}
            scroll={{ x: 1080 }}
          />
        </Space>
      </Card>

      <Modal
        title={editingAsset ? "编辑 ATP 模型" : "新建 ATP 模型"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingAsset(null);
          form.resetFields();
        }}
        onOk={() => void form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnClose
        width={760}
      >
        <Form<AssetFormValues>
          form={form}
          layout="vertical"
          initialValues={EMPTY_FORM}
          onFinish={(values) => void saveMutation.mutateAsync(values)}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="code" label="编码" rules={[{ required: true, message: "请输入模型编码" }]}>
                <Input disabled={Boolean(editingAsset)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入模型名称" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
                <Select
                  options={[
                    { value: "draft", label: "草稿" },
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "停用" },
                    { value: "archived", label: "归档" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="voltage_level" label="电压等级" rules={[{ required: true, message: "请选择或新建电压等级" }]}>
                <CreatableSingleSelect options={voltageLevelOptions} placeholder="请选择或新建电压等级" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="tower_type" label="塔型" rules={[{ required: true, message: "请选择或新建塔型" }]}>
                <CreatableSingleSelect options={towerTypeOptions} placeholder="请选择或新建塔型" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="scene_type" label="场景" rules={[{ required: true, message: "请选择或新建场景" }]}>
                <CreatableSingleSelect options={sceneTypeOptions} placeholder="请选择或新建场景" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="arrester_config" label="避雷器装设组合">
                <CreatableSingleSelect options={arresterConfigOptions} placeholder="请选择或新建避雷器装设组合" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
