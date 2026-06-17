"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  type MenuProps,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AdminPageLoading } from "@/components/admin-page-loading";
import { LightningDistributionMap } from "@/components/lightning-distribution-map";
import { Card } from "@/components/ui-antd";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  LightningDistributionImportResponse,
  LightningDistributionScatterPoint,
  LightningDistributionStatsResponse,
  LightningPolarity,
  LightningTowerBufferStatsResponse,
} from "@/types/auth";

type ImportFormValues = {
  event_year: number | null;
  region_id: string;
  location_tag: string;
  city: string;
  notes: string;
};

type DistributionFilterValues = {
  grid_size_km: number;
  years: number | null;
};

const INITIAL_IMPORT_VALUES: ImportFormValues = {
  event_year: null,
  region_id: "",
  location_tag: "",
  city: "",
  notes: "",
};

const INITIAL_DISTRIBUTION_FILTERS: DistributionFilterValues = {
  grid_size_km: 1,
  years: null,
};

function formatNullable(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatPolarity(polarity: LightningPolarity): string {
  if (polarity === "positive") return "正极性";
  if (polarity === "negative") return "负极性";
  if (polarity === "mixed") return "混合";
  return "未知";
}

export default function AdminLightningDistributionPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [importForm] = Form.useForm<ImportFormValues>();
  const [distributionForm] = Form.useForm<DistributionFilterValues>();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);

  const [distributionFilters, setDistributionFilters] = useState<DistributionFilterValues>(INITIAL_DISTRIBUTION_FILTERS);
  const [keyword, setKeyword] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [selectedEventForModal, setSelectedEventForModal] = useState<LightningDistributionScatterPoint | null>(null);

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");

  const distributionStatsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (keyword.trim()) params.set("location_tag", keyword.trim());
    if (distributionFilters.years !== null) params.set("years", String(distributionFilters.years));
    params.set("grid_size_km", String(distributionFilters.grid_size_km));
    params.set("grid_limit", "1000");
    params.set("scatter_limit", "2000");
    return `/api/v1/lightning-currents/stats/distribution?${params.toString()}`;
  }, [distributionFilters, keyword, regionFilter]);

  const distributionStatsQuery = useQuery({
    queryKey: [distributionStatsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(distributionStatsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDistributionStatsResponse;
    },
  });

  const distributionStats = distributionStatsQuery.data;
  const scatterPoints = useMemo(() => distributionStats?.scatter_points ?? [], [distributionStats?.scatter_points]);

  const distributionError = distributionStatsQuery.error instanceof Error ? distributionStatsQuery.error.message : "";

  useToastFeedback({
    errorMessage: error || distributionError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/lightning-currents"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.lightning-currents",
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!canManage) {
        throw new Error("缺少 lightning.manage 权限");
      }
      const values = importForm.getFieldsValue(true);
      const formData = new FormData();
      formData.append("file", file);
      if (values.event_year !== null && values.event_year !== undefined) {
        formData.append("event_year", String(values.event_year));
      }
      if (values.region_id?.trim()) formData.append("region_id", values.region_id.trim());
      if (values.location_tag?.trim()) formData.append("location_tag", values.location_tag.trim());
      if (values.city?.trim()) formData.append("city", values.city.trim());
      if (values.notes?.trim()) formData.append("notes", values.notes.trim());

      const response = await fetchWithAuth("/api/v1/lightning-currents/import-distribution", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDistributionImportResponse;
    },

    onSuccess: async (payload) => {
      setError("");
      setSuccess(
        payload.warning_count > 0
          ? `分布导入完成：成功 ${payload.imported_count} 条，跳过 ${payload.skipped_count} 条，告警 ${payload.warning_count} 条`
          : `分布导入完成：成功 ${payload.imported_count} 条`,
      );
      setImportModalOpen(false);
      importForm.resetFields();
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "分布导入失败");
    },
  });

  const openStatsModal = (event: LightningDistributionScatterPoint) => {
    setSelectedEventForModal(event);
    setStatsModalOpen(true);
  };

  const eventColumns = useMemo<ColumnsType<LightningDistributionScatterPoint>>(
    () => [
      {
        title: "事件编号",
        dataIndex: "event_id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "城市",
        dataIndex: "city",
        width: 120,
        render: (value: string | null) => value || "-",
      },
      {
        title: "地点标签",
        dataIndex: "location_tag",
        width: 150,
        render: (value: string | null) => value || "-",
      },
      {
        title: "经度",
        dataIndex: "longitude",
        width: 120,
        render: (value: number) => formatNumber(value, 5),
      },
      {
        title: "纬度",
        dataIndex: "latitude",
        width: 120,
        render: (value: number) => formatNumber(value, 5),
      },

      {
        title: "电流(kA)",
        dataIndex: "current_ka",
        width: 120,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "绝对值(kA)",
        dataIndex: "abs_current_ka",
        width: 120,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "极性",
        dataIndex: "polarity",
        width: 100,
        render: (value: LightningPolarity) => formatPolarity(value),
      },
      {
        title: "事件时间",
        dataIndex: "event_time",
        width: 180,
        render: (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-",
      },
      {
        title: "操作",
        key: "actions",
        width: 150,
        fixed: "right",
        render: (_: unknown, row) => (
          <Space wrap>
            <Button size="small" onClick={() => openStatsModal(row)}>
              统计详情
            </Button>
          </Space>
        ),
      },
    ],
    [],
  );

  if (initializing) {
    return (
      <AdminPageLoading
        tip="初始化中..."
        minHeightClassName="min-h-[280px]"
      />
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            请先登录后再访问雷电分布统计页面。
          </Typography.Text>
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
          <Typography.Text type="secondary">你没有访问该页面的权限（需要 `lightning.read`）。</Typography.Text>
          <Button>
            <Link href="/">返回首页</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} className="w-full">
      <Card
        title="地闪密度统计"
        extra={
          canManage && (
            <Button type="primary" onClick={() => setImportModalOpen(true)}>
              导入雷电分布数据
            </Button>
          )
        }
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            基于经纬度与电流幅值展示雷电空间分布，支持按地点、区域等条件筛选。
          </Typography.Text>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Input
              value={keyword}
              allowClear
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按地点/标签筛选"
            />
            <Input
              value={regionFilter}
              allowClear
              onChange={(event) => setRegionFilter(event.target.value)}
              placeholder="按 Region ID 筛选"
            />
          </div>

          <Form<DistributionFilterValues>
            form={distributionForm}
            layout="vertical"
            initialValues={INITIAL_DISTRIBUTION_FILTERS}
            onFinish={(values) => {
              setDistributionFilters(values);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Form.Item name="grid_size_km" label="网格尺寸(km)" rules={[{ required: true, message: "请输入网格尺寸" }]}>
                <InputNumber className="w-full" min={0.1} max={100} precision={2} />
              </Form.Item>
              <Form.Item name="years" label="统计年限(可选)">
                <InputNumber className="w-full" min={0.01} precision={2} />
              </Form.Item>
            </div>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={distributionStatsQuery.isFetching}>
                更新筛选条件
              </Button>
              <Button
                onClick={() => {
                  distributionForm.setFieldsValue(INITIAL_DISTRIBUTION_FILTERS);
                  setDistributionFilters(INITIAL_DISTRIBUTION_FILTERS);
                }}
              >
                重置筛选
              </Button>
            </Space>
          </Form>

          <Table<LightningDistributionScatterPoint>
            rowKey={(row) => row.id}
            columns={eventColumns}
            dataSource={scatterPoints}
            loading={distributionStatsQuery.isFetching}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            scroll={{ x: 1400 }}
          />
        </Space>
      </Card>

      <Modal
        title="导入雷电分布数据"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          importForm.resetFields();
        }}
        footer={null}
        width={800}
        destroyOnClose
      >
        <Form<ImportFormValues> form={importForm} layout="vertical" initialValues={INITIAL_IMPORT_VALUES}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="event_year" label="事件年份">
              <InputNumber className="w-full" min={1900} max={2100} />
            </Form.Item>
            <Form.Item name="region_id" label="区域ID">
              <Input placeholder="例如 region-001" />
            </Form.Item>
            <Form.Item name="location_tag" label="地点标签">
              <Input placeholder="例如 某变电站" />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input placeholder="例如 上海" />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可填写数据来源、采集说明等" />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={importMutation.isPending}>
              选择文件并导入
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"

              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  try {
                    await importForm.validateFields();
                    importMutation.mutate(file);
                  } catch {
                    // 表单校验失败时不触发导入。
                  }
                }
                event.target.value = "";
              }}
            />
            <Typography.Text type="secondary">
              支持包含经纬度和电流的CSV或TXT文件。
            </Typography.Text>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={selectedEventForModal ? `统计详情 - ${selectedEventForModal.event_id}` : "统计详情"}
        open={statsModalOpen}
        onCancel={() => {
          setStatsModalOpen(false);
          setSelectedEventForModal(null);
        }}
        footer={null}
        width={1200}
        destroyOnClose
      >
        {selectedEventForModal && distributionStats && (
          <Space direction="vertical" size={16} className="w-full">
            <div>
              <Typography.Title level={5}>区域统计摘要</Typography.Title>
              <Descriptions bordered size="small" column={4}>
                <Descriptions.Item label="记录总数">{distributionStats.summary.total_records}</Descriptions.Item>
                <Descriptions.Item label="统计面积(km²)">{formatNumber(distributionStats.summary.area_km2, 3)}</Descriptions.Item>
                <Descriptions.Item label="统计年限">{formatNumber(distributionStats.summary.data_years, 3)}</Descriptions.Item>
                <Descriptions.Item label="整体 Ng">{formatNumber(distributionStats.summary.overall_ng_per_km2_year, 4)}</Descriptions.Item>
                <Descriptions.Item label="Imax(kA)">{formatNumber(distributionStats.summary.max_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="Iavg(kA)">{formatNumber(distributionStats.summary.avg_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="正极占比">
                  {`${(distributionStats.polarity.positive_ratio * 100).toFixed(2)}%`}
                </Descriptions.Item>
                <Descriptions.Item label="负极占比">
                  {`${(distributionStats.polarity.negative_ratio * 100).toFixed(2)}%`}
                </Descriptions.Item>

                <Descriptions.Item label="实测条数">{distributionStats.sources.measured_count}</Descriptions.Item>
                <Descriptions.Item label="合成条数">{distributionStats.sources.synthetic_count}</Descriptions.Item>
                <Descriptions.Item label="网格数">{distributionStats.grid_cells.length}</Descriptions.Item>
                <Descriptions.Item label="散点数">{distributionStats.scatter_points.length}</Descriptions.Item>
              </Descriptions>
            </div>

            <div>
              <Typography.Title level={5}>空间分布地图</Typography.Title>
              <LightningDistributionMap
                points={distributionStats.scatter_points}
                grids={distributionStats.grid_cells}
                loading={distributionStatsQuery.isFetching}
              />
            </div>

            <div>
              <Typography.Title level={5}>当前事件信息</Typography.Title>
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="事件编号">{selectedEventForModal.event_id}</Descriptions.Item>
                <Descriptions.Item label="城市">{formatNullable(selectedEventForModal.city)}</Descriptions.Item>
                <Descriptions.Item label="地点标签">{formatNullable(selectedEventForModal.location_tag)}</Descriptions.Item>
                <Descriptions.Item label="区域ID">{formatNullable(selectedEventForModal.region_id)}</Descriptions.Item>
                <Descriptions.Item label="经度">{formatNumber(selectedEventForModal.longitude, 5)}</Descriptions.Item>
                <Descriptions.Item label="纬度">{formatNumber(selectedEventForModal.latitude, 5)}</Descriptions.Item>
                <Descriptions.Item label="电流(kA)">{formatNumber(selectedEventForModal.current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="绝对值(kA)">{formatNumber(selectedEventForModal.abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="极性">{formatPolarity(selectedEventForModal.polarity)}</Descriptions.Item>
                <Descriptions.Item label="事件时间">
                  {selectedEventForModal.event_time ? new Date(selectedEventForModal.event_time).toLocaleString("zh-CN", { hour12: false }) : "-"}
                </Descriptions.Item>
              </Descriptions>
            </div>
          </Space>
        )}
      </Modal>
    </Space>
  );
}

