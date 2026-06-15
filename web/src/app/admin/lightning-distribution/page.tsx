"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";

import { useAuth } from "@/components/auth-provider";
import { AdminPageLoading } from "@/components/admin-page-loading";
import { LightningDistributionMap } from "@/components/lightning-distribution-map";
import { Card } from "@/components/ui-antd";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  LightningDistributionImportResponse,
  LightningDistributionReportResponse,
  LightningDistributionStatsResponse,
  LightningPolarity,
  LightningSyntheticCompareResponse,
  LightningTowerBufferStatsResponse,
} from "@/types/auth";

type DistributionFilterValues = {
  min_lat: number | null;
  max_lat: number | null;
  min_lon: number | null;
  max_lon: number | null;
  grid_size_km: number;
  years: number | null;
  thresholds: string;
};

type TowerBufferFormValues = {
  tower_id: string;
  longitude: number | null;
  latitude: number | null;
  radius_km: number;
  design_current_ka: number;
};

const INITIAL_DISTRIBUTION_FILTERS: DistributionFilterValues = {
  min_lat: null,
  max_lat: null,
  min_lon: null,
  max_lon: null,
  grid_size_km: 1,
  years: null,
  thresholds: "",
};

const INITIAL_TOWER_BUFFER_VALUES: TowerBufferFormValues = {
  tower_id: "",
  longitude: null,
  latitude: null,
  radius_km: 3,
  design_current_ka: 100,
};

const POLARITY_OPTIONS = [
  { value: "all", label: "全部极性" },
  { value: "positive", label: "正极性" },
  { value: "negative", label: "负极性" },
  { value: "mixed", label: "混合" },
  { value: "unknown", label: "未知" },
] as const;

const SYNTHETIC_OPTIONS = [
  { value: "all", label: "全部来源" },
  { value: "false", label: "实测" },
  { value: "true", label: "合成" },
] as const;

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

function terrainQualityTagColor(level: string | null | undefined): string {
  if (level === "HIGH") return "green";
  if (level === "MEDIUM") return "orange";
  if (level === "LOW") return "red";
  return "default";
}

function heatCellStyle(count: number, maxCount: number): CSSProperties {
  if (maxCount <= 0 || count <= 0) {
    return {};
  }
  const ratio = Math.min(1, Math.max(0, count / maxCount));
  const alpha = Math.max(0.08, ratio * 0.46);
  return {
    background: `rgba(239, 68, 68, ${alpha.toFixed(3)})`,
  };
}

export default function AdminLightningDistributionPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const distributionUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [distributionForm] = Form.useForm<DistributionFilterValues>();
  const [towerBufferForm] = Form.useForm<TowerBufferFormValues>();
  const [keyword, setKeyword] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [polarityFilter, setPolarityFilter] = useState<(typeof POLARITY_OPTIONS)[number]["value"]>("all");
  const [syntheticFilter, setSyntheticFilter] = useState<(typeof SYNTHETIC_OPTIONS)[number]["value"]>("all");
  const [distributionFilters, setDistributionFilters] = useState<DistributionFilterValues>(INITIAL_DISTRIBUTION_FILTERS);
  const [towerBufferValues, setTowerBufferValues] = useState<TowerBufferFormValues>(INITIAL_TOWER_BUFFER_VALUES);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");

  const distributionStatsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (distributionFilters.min_lat !== null) params.set("min_lat", String(distributionFilters.min_lat));
    if (distributionFilters.max_lat !== null) params.set("max_lat", String(distributionFilters.max_lat));
    if (distributionFilters.min_lon !== null) params.set("min_lon", String(distributionFilters.min_lon));
    if (distributionFilters.max_lon !== null) params.set("max_lon", String(distributionFilters.max_lon));
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (keyword.trim()) params.set("location_tag", keyword.trim());
    if (syntheticFilter !== "all") params.set("is_synthetic", syntheticFilter);
    if (polarityFilter !== "all") params.set("polarity", polarityFilter);
    if (distributionFilters.years !== null) params.set("years", String(distributionFilters.years));
    params.set("grid_size_km", String(distributionFilters.grid_size_km));
    params.set("grid_limit", "1000");
    params.set("scatter_limit", "2000");
    if (distributionFilters.thresholds.trim()) params.set("thresholds", distributionFilters.thresholds.trim());
    return `/api/v1/lightning-currents/stats/distribution?${params.toString()}`;
  }, [distributionFilters, keyword, polarityFilter, regionFilter, syntheticFilter]);

  const towerBufferPath = useMemo(() => {
    const params = new URLSearchParams();
    if (towerBufferValues.tower_id.trim()) {
      params.set("tower_id", towerBufferValues.tower_id.trim());
    } else {
      if (towerBufferValues.longitude !== null) params.set("longitude", String(towerBufferValues.longitude));
      if (towerBufferValues.latitude !== null) params.set("latitude", String(towerBufferValues.latitude));
    }
    params.set("radius_km", String(towerBufferValues.radius_km));
    params.set("design_current_ka", String(towerBufferValues.design_current_ka));
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (syntheticFilter !== "all") params.set("is_synthetic", syntheticFilter);
    params.set("include_events_limit", "100");
    return `/api/v1/lightning-currents/stats/tower-buffer?${params.toString()}`;
  }, [towerBufferValues, regionFilter, syntheticFilter]);

  const syntheticComparePath = useMemo(() => {
    const params = new URLSearchParams();
    if (distributionFilters.min_lat !== null) params.set("min_lat", String(distributionFilters.min_lat));
    if (distributionFilters.max_lat !== null) params.set("max_lat", String(distributionFilters.max_lat));
    if (distributionFilters.min_lon !== null) params.set("min_lon", String(distributionFilters.min_lon));
    if (distributionFilters.max_lon !== null) params.set("max_lon", String(distributionFilters.max_lon));
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (keyword.trim()) params.set("location_tag", keyword.trim());
    params.set("grid_size_km", String(distributionFilters.grid_size_km));
    if (distributionFilters.years !== null) params.set("years", String(distributionFilters.years));
    return `/api/v1/lightning-currents/stats/compare-synthetic?${params.toString()}`;
  }, [distributionFilters, keyword, regionFilter]);

  const reportPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("period", reportPeriod);
    if (distributionFilters.min_lat !== null) params.set("min_lat", String(distributionFilters.min_lat));
    if (distributionFilters.max_lat !== null) params.set("max_lat", String(distributionFilters.max_lat));
    if (distributionFilters.min_lon !== null) params.set("min_lon", String(distributionFilters.min_lon));
    if (distributionFilters.max_lon !== null) params.set("max_lon", String(distributionFilters.max_lon));
    if (regionFilter.trim()) params.set("region_id", regionFilter.trim());
    if (keyword.trim()) params.set("location_tag", keyword.trim());
    if (syntheticFilter !== "all") params.set("is_synthetic", syntheticFilter);
    return `/api/v1/lightning-currents/reports/distribution?${params.toString()}`;
  }, [distributionFilters, keyword, regionFilter, reportPeriod, syntheticFilter]);

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

  const towerBufferReady = useMemo(() => {
    if (towerBufferValues.tower_id.trim()) return true;
    return towerBufferValues.longitude !== null && towerBufferValues.latitude !== null;
  }, [towerBufferValues]);

  const towerBufferQuery = useQuery({
    queryKey: [towerBufferPath],
    enabled: !!user && canRead && towerBufferReady,
    queryFn: async () => {
      const response = await fetchWithAuth(towerBufferPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningTowerBufferStatsResponse;
    },
  });

  const syntheticCompareQuery = useQuery({
    queryKey: [syntheticComparePath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(syntheticComparePath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningSyntheticCompareResponse;
    },
  });

  const reportQuery = useQuery({
    queryKey: [reportPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(reportPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDistributionReportResponse;
    },
  });

  const distributionError = distributionStatsQuery.error instanceof Error ? distributionStatsQuery.error.message : "";
  const towerBufferError = towerBufferQuery.error instanceof Error ? towerBufferQuery.error.message : "";
  const compareError = syntheticCompareQuery.error instanceof Error ? syntheticCompareQuery.error.message : "";
  const reportError = reportQuery.error instanceof Error ? reportQuery.error.message : "";

  useToastFeedback({
    errorMessage: error || distributionError || towerBufferError || compareError || reportError,
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

  const distributionStats = distributionStatsQuery.data;
  const distributionGridCells = useMemo(() => distributionStats?.grid_cells ?? [], [distributionStats?.grid_cells]);
  const distributionScatterPoints = distributionStats?.scatter_points ?? [];
  const distributionPCurve = distributionStats?.p_curve ?? [];
  const towerBufferStats = towerBufferQuery.data;
  const towerTerrainMetrics = towerBufferStats?.terrain_metrics ?? null;
  const syntheticCompare = syntheticCompareQuery.data;
  const distributionReport = reportQuery.data;

  const distributionImportMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!canManage) {
        throw new Error("缺少 lightning.manage 权限");
      }
      const formData = new FormData();
      formData.append("file", file);
      if (regionFilter.trim()) formData.append("region_id", regionFilter.trim());
      if (keyword.trim()) formData.append("location_tag", keyword.trim());
      if (syntheticFilter !== "all") formData.append("is_synthetic", syntheticFilter);
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
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "分布导入失败");
    },
  });

  const maxGridCount = useMemo(
    () => distributionGridCells.reduce((max, item) => Math.max(max, item.strike_count), 0),
    [distributionGridCells],
  );

  const distributionGridColumns = useMemo<ColumnsType<LightningDistributionStatsResponse["grid_cells"][number]>>(
    () => [
      { title: "网格", key: "grid", width: 120, render: (_: unknown, row) => `${row.grid_x},${row.grid_y}` },
      {
        title: "雷击次数",
        dataIndex: "strike_count",
        width: 120,
        render: (value: number) => (
          <div style={heatCellStyle(value, maxGridCount)} className="rounded px-2 py-1 text-center font-semibold">
            {value}
          </div>
        ),
      },
      { title: "Ng(次/km²·年)", dataIndex: "ng_per_km2_year", width: 140, render: (value: number) => formatNumber(value, 3) },
      { title: "Imax(kA)", dataIndex: "i_max_ka", width: 120, render: (value: number | null) => formatNumber(value, 2) },
      { title: "Iavg(kA)", dataIndex: "i_avg_ka", width: 120, render: (value: number | null) => formatNumber(value, 2) },
      {
        title: "正极占比",
        dataIndex: "positive_ratio",
        width: 120,
        render: (value: number) => `${(value * 100).toFixed(2)}%`,
      },
      {
        title: "中心坐标",
        key: "center",
        width: 220,
        render: (_: unknown, row) => `${row.center_lat.toFixed(5)}, ${row.center_lon.toFixed(5)}`,
      },
    ],
    [maxGridCount],
  );

  const towerBufferEventColumns = useMemo<ColumnsType<LightningTowerBufferStatsResponse["events"][number]>>(
    () => [
      { title: "事件", dataIndex: "event_id", width: 180, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
      { title: "距离(km)", dataIndex: "distance_km", width: 100, render: (value: number) => formatNumber(value, 3) },
      { title: "电流(kA)", dataIndex: "current_ka", width: 120, render: (value: number | null) => formatNumber(value, 2) },
      { title: "绝对值(kA)", dataIndex: "abs_current_ka", width: 120, render: (value: number | null) => formatNumber(value, 2) },
      { title: "极性", dataIndex: "polarity", width: 90, render: (value: LightningPolarity) => formatPolarity(value) },
      {
        title: "坐标",
        key: "coord",
        width: 220,
        render: (_: unknown, row) => `${formatNullable(row.latitude)}, ${formatNullable(row.longitude)}`,
      },
    ],
    [],
  );

  if (initializing || distributionStatsQuery.isLoading) {
    return (
      <AdminPageLoading
        tip="加载地闪密度数据中..."
        minHeightClassName="min-h-[280px]"
      />
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            请先登录后再访问地闪密度统计页面。
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
      <Card title="雷电分布统计（空间维度）">
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            基于经纬度与电流幅值计算网格化地闪密度（Ng）、极值/平均值与极性占比，并以热力网格 + 散点图展示雷电空间分布。
          </Typography.Text>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            <Select value={polarityFilter} options={[...POLARITY_OPTIONS]} onChange={(value) => setPolarityFilter(value)} />
            <Select value={syntheticFilter} options={[...SYNTHETIC_OPTIONS]} onChange={(value) => setSyntheticFilter(value)} />
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
              <Form.Item name="min_lat" label="最小纬度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="max_lat" label="最大纬度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="min_lon" label="最小经度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="max_lon" label="最大经度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="grid_size_km" label="网格尺寸(km)" rules={[{ required: true, message: "请输入网格尺寸" }]}>
                <InputNumber className="w-full" min={0.1} max={100} precision={2} />
              </Form.Item>
              <Form.Item name="years" label="统计年限(可选)">
                <InputNumber className="w-full" min={0.01} precision={2} />
              </Form.Item>
              <Form.Item name="thresholds" label="P 曲线阈值(kA)">
                <Input placeholder="例如 10,20,50,100" />
              </Form.Item>
            </div>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={distributionStatsQuery.isFetching}>
                更新分布统计
              </Button>
              <Button
                onClick={() => {
                  distributionForm.setFieldsValue(INITIAL_DISTRIBUTION_FILTERS);
                  setDistributionFilters(INITIAL_DISTRIBUTION_FILTERS);
                }}
              >
                重置范围
              </Button>
              {canManage && (
                <>
                  <Button onClick={() => distributionUploadInputRef.current?.click()} loading={distributionImportMutation.isPending}>
                    导入雷电分布文件
                  </Button>
                  <input
                    ref={distributionUploadInputRef}
                    type="file"
                    accept=".txt,.csv,text/plain,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        distributionImportMutation.mutate(file);
                      }
                      event.target.value = "";
                    }}
                  />
                </>
              )}
            </Space>
          </Form>

          <Descriptions bordered size="small" column={4}>
            <Descriptions.Item label="记录总数">{distributionStats?.summary.total_records ?? 0}</Descriptions.Item>
            <Descriptions.Item label="统计面积(km²)">{formatNumber(distributionStats?.summary.area_km2, 3)}</Descriptions.Item>
            <Descriptions.Item label="统计年限">{formatNumber(distributionStats?.summary.data_years, 3)}</Descriptions.Item>
            <Descriptions.Item label="整体 Ng">{formatNumber(distributionStats?.summary.overall_ng_per_km2_year, 4)}</Descriptions.Item>
            <Descriptions.Item label="Imax(kA)">{formatNumber(distributionStats?.summary.max_abs_current_ka, 2)}</Descriptions.Item>
            <Descriptions.Item label="Iavg(kA)">{formatNumber(distributionStats?.summary.avg_abs_current_ka, 2)}</Descriptions.Item>
            <Descriptions.Item label="正极占比">
              {distributionStats ? `${(distributionStats.polarity.positive_ratio * 100).toFixed(2)}%` : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="负极占比">
              {distributionStats ? `${(distributionStats.polarity.negative_ratio * 100).toFixed(2)}%` : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="实测条数">{distributionStats?.sources.measured_count ?? 0}</Descriptions.Item>
            <Descriptions.Item label="合成条数">{distributionStats?.sources.synthetic_count ?? 0}</Descriptions.Item>
            <Descriptions.Item label="网格数">{distributionGridCells.length}</Descriptions.Item>
            <Descriptions.Item label="散点数">{distributionScatterPoints.length}</Descriptions.Item>
          </Descriptions>

          <LightningDistributionMap
            points={distributionScatterPoints}
            grids={distributionGridCells}
            loading={distributionStatsQuery.isFetching}
          />

          <Table
            rowKey={(row) => `${row.grid_x}-${row.grid_y}`}
            size="small"
            columns={distributionGridColumns}
            dataSource={distributionGridCells}
            loading={distributionStatsQuery.isFetching}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 1100 }}
          />
        </Space>
      </Card>

      <Card title="资产关联分析（杆塔缓冲区）">
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            输入杆塔编号或中心坐标，分析 2-5km 缓冲区内雷击强度，输出 Ng、超设计阈值次数与风险等级。
          </Typography.Text>
          <Form<TowerBufferFormValues>
            form={towerBufferForm}
            layout="vertical"
            initialValues={INITIAL_TOWER_BUFFER_VALUES}
            onFinish={(values) => {
              setTowerBufferValues(values);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Form.Item name="tower_id" label="杆塔 ID（可选）">
                <Input placeholder="优先使用杆塔ID定位" />
              </Form.Item>
              <Form.Item name="longitude" label="中心经度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="latitude" label="中心纬度">
                <InputNumber className="w-full" />
              </Form.Item>
              <Form.Item name="radius_km" label="缓冲半径(km)" rules={[{ required: true, message: "请输入半径" }]}>
                <InputNumber className="w-full" min={0.2} max={20} precision={2} />
              </Form.Item>
              <Form.Item name="design_current_ka" label="设计耐雷阈值(kA)" rules={[{ required: true, message: "请输入阈值" }]}>
                <InputNumber className="w-full" min={1} max={1000} precision={1} />
              </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" loading={towerBufferQuery.isFetching}>
              执行缓冲区分析
            </Button>
          </Form>

          {!towerBufferReady ? (
            <Alert type="info" showIcon message="请先输入杆塔 ID，或输入经纬度后再执行分析。" />
          ) : !towerBufferStats ? (
            <Empty description="暂无缓冲区分析结果" />
          ) : (
            <Space direction="vertical" size={12} className="w-full">
              <Descriptions bordered size="small" column={4}>
                <Descriptions.Item label="杆塔">{towerBufferStats.tower_no || towerBufferStats.tower_id || "自定义坐标"}</Descriptions.Item>
                <Descriptions.Item label="半径(km)">{formatNumber(towerBufferStats.radius_km, 2)}</Descriptions.Item>
                <Descriptions.Item label="雷击次数">{towerBufferStats.strike_count}</Descriptions.Item>
                <Descriptions.Item label="超阈值次数">{towerBufferStats.exceed_design_count}</Descriptions.Item>
                <Descriptions.Item label="Ng">{formatNumber(towerBufferStats.ng_per_km2_year, 4)}</Descriptions.Item>
                <Descriptions.Item label="Imax(kA)">{formatNumber(towerBufferStats.max_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="Iavg(kA)">{formatNumber(towerBufferStats.avg_abs_current_ka, 2)}</Descriptions.Item>
                <Descriptions.Item label="正极占比">{(towerBufferStats.positive_ratio * 100).toFixed(2)}%</Descriptions.Item>
                <Descriptions.Item label="地面倾角(°)">{formatNumber(towerTerrainMetrics?.slope_deg, 2)}</Descriptions.Item>
                <Descriptions.Item label="坡向(°)">{formatNumber(towerTerrainMetrics?.aspect_deg, 1)}</Descriptions.Item>
                <Descriptions.Item label="地形暴露指数">{formatNumber(towerTerrainMetrics?.terrain_exposure_index, 3)}</Descriptions.Item>
                <Descriptions.Item label="DEM分辨率(m)">{formatNumber(towerTerrainMetrics?.dem_resolution_m, 2)}</Descriptions.Item>
                <Descriptions.Item label="纵坡/横坡(°)" span={2}>
                  {`${formatNumber(towerTerrainMetrics?.slope_along_line_deg, 2)} / ${formatNumber(towerTerrainMetrics?.slope_cross_line_deg, 2)}`}
                </Descriptions.Item>
                <Descriptions.Item label="地形质量">
                  {towerTerrainMetrics?.quality_level
                    ? <Tag color={terrainQualityTagColor(towerTerrainMetrics.quality_level)}>{towerTerrainMetrics.quality_level}</Tag>
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="质量评分">{formatNumber(towerTerrainMetrics?.quality_score, 1)}</Descriptions.Item>
                <Descriptions.Item label="DEM来源">{formatNullable(towerTerrainMetrics?.dem_source)}</Descriptions.Item>
                <Descriptions.Item label="风险等级">
                  <Tag color={towerBufferStats.risk_level === "HIGH" ? "red" : towerBufferStats.risk_level === "MEDIUM" ? "orange" : "green"}>
                    {towerBufferStats.risk_level}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="建议" span={3}>
                  {towerBufferStats.recommended_action}
                </Descriptions.Item>
              </Descriptions>

              <Table
                rowKey={(row) => row.id}
                size="small"
                columns={towerBufferEventColumns}
                dataSource={towerBufferStats.events}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                scroll={{ x: 980 }}
              />
            </Space>
          )}
        </Space>
      </Card>

      <Card title="实测/合成分布对比与自动报表">
        <Space direction="vertical" size={12} className="w-full">
          {!syntheticCompare ? (
            <Empty description="暂无实测/合成对比数据" />
          ) : (
            <Descriptions bordered size="small" column={4}>
              <Descriptions.Item label="网格尺寸(km)">{formatNumber(syntheticCompare.grid_size_km, 2)}</Descriptions.Item>
              <Descriptions.Item label="统计年限">{formatNumber(syntheticCompare.data_years, 2)}</Descriptions.Item>
              <Descriptions.Item label="网格相似度">
                {syntheticCompare.grid_cosine_similarity === null ? "-" : `${(syntheticCompare.grid_cosine_similarity * 100).toFixed(2)}%`}
              </Descriptions.Item>
              <Descriptions.Item label="说明">{syntheticCompare.note || "-"}</Descriptions.Item>
              <Descriptions.Item label="实测数量">{syntheticCompare.measured.count}</Descriptions.Item>
              <Descriptions.Item label="实测 Iavg(kA)">{formatNumber(syntheticCompare.measured.avg_abs_current_ka, 2)}</Descriptions.Item>
              <Descriptions.Item label="合成数量">{syntheticCompare.synthetic.count}</Descriptions.Item>
              <Descriptions.Item label="合成 Iavg(kA)">{formatNumber(syntheticCompare.synthetic.avg_abs_current_ka, 2)}</Descriptions.Item>
            </Descriptions>
          )}

          <Space align="center">
            <Typography.Text>自动报表周期：</Typography.Text>
            <Select
              value={reportPeriod}
              style={{ width: 160 }}
              options={[
                { label: "周报（近7天）", value: "week" },
                { label: "月报（近30天）", value: "month" },
              ]}
              onChange={(value: "week" | "month") => setReportPeriod(value)}
            />
            <Button onClick={() => void reportQuery.refetch()} loading={reportQuery.isFetching}>
              刷新报表
            </Button>
          </Space>

          {!distributionReport ? (
            <Empty description="暂无报表数据" />
          ) : (
            <Descriptions bordered size="small" column={4}>
              <Descriptions.Item label="周期">{distributionReport.period === "week" ? "近7天" : "近30天"}</Descriptions.Item>
              <Descriptions.Item label="雷击次数">{distributionReport.strike_count}</Descriptions.Item>
              <Descriptions.Item label="平均电流(kA)">{formatNumber(distributionReport.avg_abs_current_ka, 2)}</Descriptions.Item>
              <Descriptions.Item label="最大电流(kA)">{formatNumber(distributionReport.max_abs_current_ka, 2)}</Descriptions.Item>
              <Descriptions.Item label="正极占比">{(distributionReport.positive_ratio * 100).toFixed(2)}%</Descriptions.Item>
              <Descriptions.Item label="Ng">{formatNumber(distributionReport.ng_per_km2_year, 4)}</Descriptions.Item>
              <Descriptions.Item label="最严重事件" span={2}>
                {distributionReport.most_severe_event ? distributionReport.most_severe_event.event_id : "-"}
              </Descriptions.Item>
            </Descriptions>
          )}
        </Space>
      </Card>

      <Card title="峰值超越概率（P 曲线）">
        {distributionPCurve.length === 0 ? (
          <Empty description="暂无统计数据" />
        ) : (
          <Table
            rowKey={(row) => `${row.threshold_ka}`}
            pagination={false}
            dataSource={distributionPCurve}
            columns={[
              { title: "阈值(kA)", dataIndex: "threshold_ka", width: 140, render: (value: number) => formatNumber(value, 2) },
              {
                title: "超越概率",
                dataIndex: "exceedance_probability",
                width: 140,
                render: (value: number) => `${(value * 100).toFixed(2)}%`,
              },
              { title: "超越次数", dataIndex: "exceedance_count", width: 140 },
            ]}
            size="small"
          />
        )}
      </Card>
    </Space>
  );
}

