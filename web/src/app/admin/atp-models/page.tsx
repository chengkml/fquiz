"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType } from "react";

import { AdminPageLoading } from "@/components/admin-page-loading";
import { useAuth } from "@/components/auth-provider";
import { CreatableSingleSelect } from "@/components/creatable-single-select";
import { readApiError } from "@/lib/api";
import { getAtpAssetStatusDisplay } from "@/lib/atp-asset-display";
import type { AtpAssetListResponse, AtpAssetSummary } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps>;

type AssetFormValues = {
  description: string;
  voltage_level: string;
  tower_type: string;
  scene_type: string;
  arrester_config: string;
};

const EMPTY_FORM: AssetFormValues = {
  description: "",
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
    description: item.description,
    voltage_level: item.voltage_level ?? "",
    tower_type: item.tower_type ?? "",
    scene_type: item.scene_type ?? "",
    arrester_config: item.arrester_config ?? "",
  };
}

function generateName(values: AssetFormValues): string {
  const parts = [
    values.voltage_level,
    values.tower_type,
    values.scene_type,
    values.arrester_config,
  ].filter(Boolean);
  return parts.join("-");
}

function generateCode(): string {
  return `atp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function buildPayload(values: AssetFormValues) {
  return {
    code: generateCode(),
    name: generateName(values),
    description: values.description.trim(),
    voltage_level: values.voltage_level.trim() || null,
    tower_type: values.tower_type.trim() || null,
    scene_type: values.scene_type.trim() || null,
    arrester_config: values.arrester_config.trim() || null,
  };
}

const DEFAULT_VOLTAGE_LEVELS = [
  { label: "35kV", value: "35" },
  { label: "66kV", value: "66" },
  { label: "110kV", value: "110" },
  { label: "220kV", value: "220" },
  { label: "330kV", value: "330" },
  { label: "500kV", value: "500" },
  { label: "750kV", value: "750" },
  { label: "800kV", value: "800" },
  { label: "1000kV", value: "1000" },
];

const DEFAULT_TOWER_TYPES = [
  { label: "干字塔", value: "ganzi" },
  { label: "鼓型塔", value: "guxing" },
  { label: "鼓型双回路塔", value: "guxingd" },
  { label: "酒杯塔", value: "jiubei" },
  { label: "猫头塔", value: "maotou" },
  { label: "上字塔", value: "shangzi" },
  { label: "四回路塔", value: "sihuita" },
  { label: "直流V型塔", value: "vzhiliu" },
  { label: "直流塔", value: "zhiliu" },
];

const DEFAULT_SCENE_TYPES = [
  { label: "反击", value: "fanji" },
  { label: "绕击1", value: "raoji1" },
  { label: "绕击2", value: "raoji2" },
  { label: "绕击3", value: "raoji3" },
];

const DEFAULT_ARRESTER_CONFIGS = [
  { label: "M1", value: "M1" },
  { label: "M2", value: "M2" },
  { label: "M3", value: "M3" },
  { label: "M12", value: "M12" },
  { label: "M13", value: "M13" },
  { label: "M23", value: "M23" },
  { label: "M123", value: "M123" },
  { label: "noM", value: "noM" },
];

function buildDimensionOptions(items: AtpAssetSummary[], picker: (item: AtpAssetSummary) => string | null, defaults: Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  const values = new Set<string>();
  const optionsMap = new Map<string, string>();

  for (const defaultOption of defaults) {
    values.add(defaultOption.value);
    optionsMap.set(defaultOption.value, defaultOption.label);
  }

  for (const item of items) {
    const value = picker(item)?.trim();
    if (!value) {
      continue;
    }
    values.add(value);
    if (!optionsMap.has(value)) {
      optionsMap.set(value, value);
    }
  }

  return Array.from(values)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((value) => ({ label: optionsMap.get(value) || value, value }));
}

const ATP_TABLE_MIN_SCROLL_Y = 180;
const ATP_TABLE_VIEWPORT_GAP = 40;
const ATP_TABLE_FALLBACK_RESERVE = 220;

export default function AtpModelsPage() {
  const { message } = App.useApp();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AssetFormValues>();

  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [editingAsset, setEditingAsset] = useState<AtpAssetSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(ATP_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasPermission("atp.read") || hasPermission("atp.run") || hasPermission("atp.manage");
  const canManage = hasPermission("atp.manage");

  const assetsQuery = useQuery({
    queryKey: ["atp-assets", keyword],
    enabled: Boolean(user && canRead),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (keyword.trim()) {
        searchParams.set("keyword", keyword.trim());
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
  const voltageLevelOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.voltage_level, DEFAULT_VOLTAGE_LEVELS), [assetItems]);
  const towerTypeOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.tower_type, DEFAULT_TOWER_TYPES), [assetItems]);
  const sceneTypeOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.scene_type, DEFAULT_SCENE_TYPES), [assetItems]);
  const arresterConfigOptions = useMemo(() => buildDimensionOptions(assetItems, (item) => item.arrester_config, DEFAULT_ARRESTER_CONFIGS), [assetItems]);

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - ATP_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? ATP_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - ATP_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(ATP_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [assetsQuery.error, keyword, assetItems.length, assetsQuery.isFetching, updateTableScrollY]);

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
            <Tag>{item.arrester_config || "未设置避雷器"}</Tag>
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
      <AntCard title="ATP 模型管理">
        <Typography.Text type="secondary">
          {!user ? "请先登录后再查看 ATP 模型管理。" : "当前账号无 ATP 模块权限（需要 atp.read/atp.run/atp.manage）。"}
        </Typography.Text>
      </AntCard>
    );
  }

  const handleSearch = () => {
    setKeyword(keywordInput);
  };

  const handleResetSearch = () => {
    setKeywordInput("");
    setKeyword("");
  };

  return (
    <div className="space-y-6">
      <AntCard
        title="ATP 模型管理"
        extra={(
          <Space>
            {assetsQuery.isFetching && <Spin size="small" />}
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
          </Space>
        )}
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[240px]">
            <Input
              allowClear
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={handleSearch}
              placeholder="按编码 / 名称 / 描述搜索"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" onClick={handleSearch}>
              搜索
            </Button>
          </Form.Item>

          <Form.Item>
            <Button onClick={handleResetSearch}>重置筛选</Button>
          </Form.Item>
        </Form>

        {assetsQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="ATP 模型加载失败" description={assetsQuery.error.message} className="mt-4" />
        ) : null}

        <div
          ref={tableScrollAnchorRef}
          className="admin-atp-models-table-anchor mt-4"
          style={{ "--admin-atp-models-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<AtpAssetSummary>
            rowKey="id"
            loading={assetsQuery.isLoading}
            columns={columns}
            dataSource={assetItems}
            locale={{ emptyText: "暂无 ATP 模型" }}
            pagination={false}
            scroll={{ x: 1080, y: tableScrollY }}
          />
        </div>
      </AntCard>

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
              <Form.Item name="arrester_config" label="避雷器装设组合" rules={[{ required: true, message: "请选择或新建避雷器装设组合" }]}>
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
    </div>
  );
}
