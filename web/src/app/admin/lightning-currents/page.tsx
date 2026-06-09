"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
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
import { readLinePreparation } from "@/lib/line-preparation";
import type {
  LineListResponse,
  LineSummary,
  LightningCurrentEventListResponse,
  LightningCurrentEventSummary,
  LightningCurrentExceedanceResponse,
  LightningCurrentImportResponse,
  LightningCurrentPreparationResponse,
  LightningCurrentSampleListResponse,
  LightningCurrentSampleItem,
  LightningDensityPreparationResponse,
  LightningDistributionImportResponse,
  LightningDistributionReportResponse,
  LightningDistributionStatsResponse,
  LightningPolarity,
  LightningSyntheticCompareResponse,
  LightningTowerBufferStatsResponse,
} from "@/types/auth";

type ImportFormValues = {
  event_id: string;
  sample_interval_us: number;
  region_id: string;
  location_tag: string;
  city: string;
  sensor_model: string;
  install_position: string;
  weather_level: string;
  is_synthetic: boolean;
  notes: string;
};

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

const INITIAL_IMPORT_VALUES: ImportFormValues = {
  event_id: "",
  sample_interval_us: 1,
  region_id: "",
  location_tag: "",
  city: "",
  sensor_model: "",
  install_position: "",
  weather_level: "",
  is_synthetic: false,
  notes: "",
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

export default function AdminLightningCurrentsPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const distributionUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [importForm] = Form.useForm<ImportFormValues>();
  const [distributionForm] = Form.useForm<DistributionFilterValues>();
  const [towerBufferForm] = Form.useForm<TowerBufferFormValues>();
  const [keyword, setKeyword] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [polarityFilter, setPolarityFilter] = useState<(typeof POLARITY_OPTIONS)[number]["value"]>("all");
  const [syntheticFilter, setSyntheticFilter] = useState<(typeof SYNTHETIC_OPTIONS)[number]["value"]>("all");
  const [distributionFilters, setDistributionFilters] = useState<DistributionFilterValues>(INITIAL_DISTRIBUTION_FILTERS);
  const [towerBufferValues, setTowerBufferValues] = useState<TowerBufferFormValues>(INITIAL_TOWER_BUFFER_VALUES);
  const [reportPeriod, setReportPeriod] = useState<"week" | "month">("week");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [prepareDensityRadiusKm, setPrepareDensityRadiusKm] = useState(3);
  const [prepareDensityYears, setPrepareDensityYears] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");
  const isDistributionOnly = pathname.startsWith("/admin/lightning-distribution");

  const eventListPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (regionFilter.trim()) {
      params.set("region_id", regionFilter.trim());
    }
    if (polarityFilter !== "all") {
      params.set("polarity", polarityFilter);
    }
    if (syntheticFilter !== "all") {
      params.set("is_synthetic", syntheticFilter);
    }
    params.set("limit", "200");
    params.set("offset", "0");
    return `/api/v1/lightning-currents?${params.toString()}`;
  }, [keyword, regionFilter, polarityFilter, syntheticFilter]);

  const exceedancePath = useMemo(() => {
    const params = new URLSearchParams();
    if (regionFilter.trim()) {
      params.set("region_id", regionFilter.trim());
    }
    if (polarityFilter !== "all") {
      params.set("polarity", polarityFilter);
    }
    if (syntheticFilter !== "all") {
      params.set("is_synthetic", syntheticFilter);
    }
    return `/api/v1/lightning-currents/stats/exceedance${params.toString() ? `?${params.toString()}` : ""}`;
  }, [regionFilter, polarityFilter, syntheticFilter]);

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
  const linesQuery = useQuery({
    queryKey: ["/api/v1/lines"],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/lines");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LineListResponse;
    },
  });
  const activeSelectedLineId = selectedLineId || linesQuery.data?.items[0]?.id || "";

  const eventsQuery = useQuery({
    queryKey: [eventListPath],
    enabled: !!user && canRead && !isDistributionOnly,
    queryFn: async () => {
      const response = await fetchWithAuth(eventListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentEventListResponse;
    },
  });
  const events = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data?.items]);
  const activeSelectedEventId = selectedEventId && events.some((item) => item.id === selectedEventId)
    ? selectedEventId
    : (events[0]?.id ?? null);
  const samplePath = useMemo(() => {
    if (!activeSelectedEventId) {
      return "";
    }
    return `/api/v1/lightning-currents/${activeSelectedEventId}/samples?limit=200&offset=0`;
  }, [activeSelectedEventId]);

  const samplesQuery = useQuery({
    queryKey: [samplePath],
    enabled: !!user && canRead && !isDistributionOnly && !!activeSelectedEventId,
    queryFn: async () => {
      if (!samplePath) {
        return { items: [], total: 0, limit: 0, offset: 0 } satisfies LightningCurrentSampleListResponse;
      }
      const response = await fetchWithAuth(samplePath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentSampleListResponse;
    },
  });

  const exceedanceQuery = useQuery({
    queryKey: [exceedancePath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(exceedancePath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentExceedanceResponse;
    },
  });

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

  const listError = eventsQuery.error instanceof Error ? eventsQuery.error.message : "";
  const sampleError = samplesQuery.error instanceof Error ? samplesQuery.error.message : "";
  const statsError = exceedanceQuery.error instanceof Error ? exceedanceQuery.error.message : "";
  const distributionError = distributionStatsQuery.error instanceof Error ? distributionStatsQuery.error.message : "";
  const towerBufferError = towerBufferQuery.error instanceof Error ? towerBufferQuery.error.message : "";
  const compareError = syntheticCompareQuery.error instanceof Error ? syntheticCompareQuery.error.message : "";
  const reportError = reportQuery.error instanceof Error ? reportQuery.error.message : "";

  useToastFeedback({
    errorMessage:
      error
      || listError
      || sampleError
      || statsError
      || distributionError
      || towerBufferError
      || compareError
      || reportError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && (
          query.queryKey[0].startsWith("/api/v1/lightning-currents")
          || query.queryKey[0].startsWith("/api/v1/lines")
        ),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.lightning-currents",
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const samples = samplesQuery.data?.items ?? [];
  const exceedance = exceedanceQuery.data?.thresholds ?? [];
  const distributionStats = distributionStatsQuery.data;
  const distributionGridCells = useMemo(() => distributionStats?.grid_cells ?? [], [distributionStats?.grid_cells]);
  const distributionScatterPoints = distributionStats?.scatter_points ?? [];
  const distributionPCurve = distributionStats?.p_curve ?? [];
  const towerBufferStats = towerBufferQuery.data;
  const towerTerrainMetrics = towerBufferStats?.terrain_metrics ?? null;
  const syntheticCompare = syntheticCompareQuery.data;
  const distributionReport = reportQuery.data;
  const selectedEvent = useMemo(
    () => events.find((item) => item.id === activeSelectedEventId) ?? null,
    [activeSelectedEventId, events],
  );
  const selectedLine = useMemo(
    () => linesQuery.data?.items.find((item) => item.id === activeSelectedLineId) ?? null,
    [activeSelectedLineId, linesQuery.data?.items],
  );
  const selectedLinePreparation = useMemo(() => readLinePreparation(selectedLine), [selectedLine]);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!canManage) {
        throw new Error("缺少 lightning.manage 权限");
      }
      const values = importForm.getFieldsValue(true);
      const formData = new FormData();
      formData.append("file", file);
      if (values.event_id?.trim()) formData.append("event_id", values.event_id.trim());
      if (values.sample_interval_us !== null && values.sample_interval_us !== undefined) {
        formData.append("sample_interval_us", String(values.sample_interval_us));
      }
      if (values.region_id?.trim()) formData.append("region_id", values.region_id.trim());
      if (values.location_tag?.trim()) formData.append("location_tag", values.location_tag.trim());
      if (values.city?.trim()) formData.append("city", values.city.trim());
      if (values.sensor_model?.trim()) formData.append("sensor_model", values.sensor_model.trim());
      if (values.install_position?.trim()) formData.append("install_position", values.install_position.trim());
      if (values.weather_level?.trim()) formData.append("weather_level", values.weather_level.trim());
      if (values.notes?.trim()) formData.append("notes", values.notes.trim());
      formData.append("is_synthetic", values.is_synthetic ? "true" : "false");

      const response = await fetchWithAuth("/api/v1/lightning-currents/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentImportResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setSuccess(
        payload.warning_count > 0
          ? `导入完成，存在 ${payload.warning_count} 条告警`
          : "导入完成并已提取防雷特征参数",
      );
      setSelectedEventId(payload.event.id);
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "导入失败");
    },
  });

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

  const deleteMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const response = await fetchWithAuth(`/api/v1/lightning-currents/${eventId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return eventId;
    },
    onSuccess: async (eventId) => {
      if (selectedEventId === eventId) {
        setSelectedEventId(null);
      }
      setError("");
      setSuccess("雷电流事件已删除");
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
  });

  const prepareCurrentMutation = useMutation({
    mutationFn: async () => {
      if (!activeSelectedLineId) {
        throw new Error("请选择线路");
      }
      const response = await fetchWithAuth("/api/v1/lightning-currents/prepare-current", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_id: activeSelectedLineId,
          region_id: regionFilter.trim() || null,
          is_synthetic: syntheticFilter === "all" ? null : syntheticFilter === "true",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentPreparationResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setSuccess(`已为 ${payload.line.name || payload.line.code} 回填雷电流幅值 a/b = ${payload.current_a} / ${payload.current_b}`);
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "线路雷电流回填失败");
    },
  });

  const prepareDensityMutation = useMutation({
    mutationFn: async () => {
      if (!activeSelectedLineId) {
        throw new Error("请选择线路");
      }
      const response = await fetchWithAuth("/api/v1/lightning-currents/prepare-density", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_id: activeSelectedLineId,
          region_id: regionFilter.trim() || null,
          is_synthetic: syntheticFilter === "all" ? null : syntheticFilter === "true",
          radius_km: prepareDensityRadiusKm,
          years: prepareDensityYears,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningDensityPreparationResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setSuccess(
        `已为 ${payload.line.name || payload.line.code} 回填地闪密度，平均值 ${formatNumber(payload.avg_density, 6)} Ng/km²·年`,
      );
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "线路地闪密度回填失败");
    },
  });

  const eventColumns = useMemo<ColumnsType<LightningCurrentEventSummary>>(
    () => [
      {
        title: "事件编号",
        dataIndex: "event_id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "峰值(kA)",
        dataIndex: "peak_abs_current_ka",
        width: 100,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "波形",
        dataIndex: "wave_shape",
        width: 90,
        render: (value: string | null) => value || "-",
      },
      {
        title: "T1/T2(us)",
        key: "t1t2",
        width: 140,
        render: (_: unknown, row) => `${formatNumber(row.wavefront_time_t1_us, 2)} / ${formatNumber(row.half_value_time_t2_us, 2)}`,
      },
      {
        title: "陡度(kA/us)",
        dataIndex: "steepness_ka_per_us",
        width: 130,
        render: (value: number | null) => formatNumber(value, 3),
      },
      {
        title: "I²t(J/Ω)",
        dataIndex: "action_integral_j_ohm",
        width: 140,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "极性",
        dataIndex: "polarity",
        width: 90,
        render: (value: LightningPolarity) => (
          <Tag color={value === "negative" ? "red" : value === "positive" ? "blue" : "default"}>{formatPolarity(value)}</Tag>
        ),
      },
      {
        title: "回击数",
        dataIndex: "stroke_count",
        width: 80,
      },
      {
        title: "区域",
        dataIndex: "location_tag",
        width: 160,
        render: (value: string | null) => value || "-",
      },
      {
        title: "采样点数",
        dataIndex: "sample_count",
        width: 100,
      },
      {
        title: "来源",
        dataIndex: "is_synthetic",
        width: 80,
        render: (value: boolean) => (value ? <Tag color="purple">合成</Tag> : <Tag color="green">实测</Tag>),
      },
      {
        title: "操作",
        key: "actions",
        width: 100,
        fixed: "right",
        render: (_: unknown, row) =>
          canManage ? (
            <Popconfirm
              title="删除事件"
              description={`确认删除事件 ${row.event_id} 吗？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                await deleteMutation.mutateAsync(row.id);
              }}
            >
              <Button size="small" danger loading={deleteMutation.isPending}>
                删除
              </Button>
            </Popconfirm>
          ) : null,
      },
    ],
    [canManage, deleteMutation],
  );

  const sampleColumns = useMemo<ColumnsType<LightningCurrentSampleItem>>(
    () => [
      { title: "序号", dataIndex: "seq_no", width: 90 },
      { title: "时间(us)", dataIndex: "time_us", width: 140, render: (value: number) => formatNumber(value, 6) },
      { title: "电流(kA)", dataIndex: "current_ka", width: 140, render: (value: number) => formatNumber(value, 6) },
    ],
    [],
  );

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

  if (initializing || (!isDistributionOnly && eventsQuery.isLoading) || (isDistributionOnly && distributionStatsQuery.isLoading)) {
    return (
      <AdminPageLoading
        tip={isDistributionOnly ? "加载雷电分布数据中..." : "加载雷电流数据中..."}
        minHeightClassName="min-h-[280px]"
      />
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            {isDistributionOnly ? "请先登录后再访问雷电分布统计页面。" : "请先登录后再访问雷电幅值统计页面。"}
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
      <Card title="线路参数准备">
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            将当前雷电数据筛选结果按线路回填为“雷电流幅值”和“地闪密度”准备项；创建防雷分析任务前会使用这里的就绪状态做校验。
          </Typography.Text>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Select
              showSearch
              optionFilterProp="label"
              value={activeSelectedLineId || undefined}
              onChange={setSelectedLineId}
              placeholder="选择线路"
              loading={linesQuery.isLoading}
              options={(linesQuery.data?.items ?? []).map((item: LineSummary) => ({
                value: item.id,
                label: `${item.name || item.code} / ${item.code}`,
              }))}
            />
            <InputNumber
              min={0.05}
              max={50}
              step={0.5}
              value={prepareDensityRadiusKm}
              onChange={(value) => setPrepareDensityRadiusKm(typeof value === "number" ? value : 3)}
              addonAfter="km"
              placeholder="密度半径"
              className="w-full"
            />
            <InputNumber
              min={0.1}
              max={100}
              step={0.5}
              value={prepareDensityYears}
              onChange={(value) => setPrepareDensityYears(typeof value === "number" ? value : null)}
              addonAfter="年"
              placeholder="数据年限(可选)"
              className="w-full"
            />
            <Space.Compact block>
              <Button
                type="primary"
                onClick={() => prepareCurrentMutation.mutate()}
                loading={prepareCurrentMutation.isPending}
                disabled={!canManage || !activeSelectedLineId}
              >
                回填雷电流幅值
              </Button>
              <Button
                onClick={() => prepareDensityMutation.mutate()}
                loading={prepareDensityMutation.isPending}
                disabled={!canManage || !activeSelectedLineId}
              >
                回填地闪密度
              </Button>
            </Space.Compact>
          </div>
          {selectedLine ? (
            <Alert
              type={selectedLinePreparation.all_ready ? "success" : "warning"}
              showIcon
              message={selectedLinePreparation.all_ready ? "当前线路准备已齐备" : `缺少：${selectedLinePreparation.missing_items.join("、")}`}
              description={
                <Space size={[8, 8]} wrap>
                  {[
                    selectedLinePreparation.lightning_current,
                    selectedLinePreparation.lightning_density,
                    selectedLinePreparation.ground_slope,
                  ].map((item) => {
                    const source = item.source;
                    const preparedAt = typeof source.prepared_at === "string" ? source.prepared_at : null;
                    const values = item.values;
                    const currentA = typeof values.current_a === "number" ? values.current_a : null;
                    const currentB = typeof values.current_b === "number" ? values.current_b : null;
                    return (
                      <Tag key={item.key} color={item.ready ? "green" : "red"}>
                        {`${item.label}${currentA !== null && currentB !== null ? ` (${formatNumber(currentA, 3)} / ${formatNumber(currentB, 3)})` : ""} ${item.tower_ready_count}/${item.tower_total_count}${preparedAt ? ` @ ${new Date(preparedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}`}
                      </Tag>
                    );
                  })}
                </Space>
              }
            />
          ) : null}
        </Space>
      </Card>

      {!isDistributionOnly && (
        <Card title="雷电幅值统计导入与事件管理">
          <Space direction="vertical" size={12} className="w-full">
            <Typography.Text type="secondary">
              上传原始雷电流序列后，系统将自动提取峰值、T1/T2、陡度、I²t、多回击等防雷计算参数。
            </Typography.Text>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                value={keyword}
                allowClear
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按事件编号/地点/城市筛选"
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

            {canManage && (
              <Form<ImportFormValues> form={importForm} layout="vertical" initialValues={INITIAL_IMPORT_VALUES}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Form.Item name="event_id" label="事件编号（可选）">
                    <Input placeholder="例如 LC-20260425-0001" />
                  </Form.Item>
                  <Form.Item name="sample_interval_us" label="采样间隔(us)" rules={[{ required: true, message: "请填写采样间隔" }]}>
                    <InputNumber className="w-full" min={0.000001} precision={6} />
                  </Form.Item>
                  <Form.Item name="region_id" label="Region ID">
                    <Input placeholder="例如 CN-SH-PD" />
                  </Form.Item>
                  <Form.Item name="location_tag" label="地域标签">
                    <Input placeholder="例如 上海-浦东" />
                  </Form.Item>
                  <Form.Item name="city" label="城市">
                    <Input placeholder="例如 上海" />
                  </Form.Item>
                  <Form.Item name="sensor_model" label="传感器型号">
                    <Input placeholder="例如 LCS-1000" />
                  </Form.Item>
                  <Form.Item name="install_position" label="安装位置">
                    <Input placeholder="例如 楼顶避雷针" />
                  </Form.Item>
                  <Form.Item name="weather_level" label="雷暴等级">
                    <Input placeholder="例如 强雷暴" />
                  </Form.Item>
                </div>
                <Form.Item name="notes" label="备注">
                  <Input.TextArea rows={2} placeholder="可填写天气背景、场景备注等" />
                </Form.Item>
                <Form.Item name="is_synthetic" valuePropName="checked" className="mb-0">
                  <Checkbox>这是合成数据</Checkbox>
                </Form.Item>
              </Form>
            )}

            {canManage && (
              <Space>
                <Button type="primary" onClick={() => uploadInputRef.current?.click()} loading={importMutation.isPending}>
                  上传并提取特征
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
                <Typography.Text type="secondary">支持单列电流序列（每行一个值）或“双列 time,current”格式。</Typography.Text>
              </Space>
            )}
          </Space>
        </Card>
      )}

      <Card title="雷电分布统计（空间维度）">
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            基于经纬度与电流幅值计算网格化地闪密度（Ng）、极值/平均值与极性占比，并以热力网格 + 散点图展示雷电空间分布。
          </Typography.Text>

          {isDistributionOnly && (
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
          )}

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

      {!isDistributionOnly && (
        <Card title="雷电流事件列表">
          <Table<LightningCurrentEventSummary>
            rowKey={(row) => row.id}
            columns={eventColumns}
            dataSource={events}
            loading={eventsQuery.isFetching}
            pagination={false}
            scroll={{ x: 1700 }}
            rowClassName={(row) => (row.id === activeSelectedEventId ? "fquiz-row-selected" : "")}
            onRow={(row) => ({
              onClick: () => setSelectedEventId(row.id),
            })}
          />
        </Card>
      )}

      <Card title="峰值超越概率（P 曲线）">
        {(distributionPCurve.length === 0 && exceedance.length === 0) ? (
          <Empty description="暂无统计数据" />
        ) : (
          <Table
            rowKey={(row) => `${row.threshold_ka}`}
            pagination={false}
            dataSource={distributionPCurve.length > 0 ? distributionPCurve : exceedance}
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

      {!isDistributionOnly && (
        <>
          <Card title={selectedEvent ? `事件详情 - ${selectedEvent.event_id}` : "事件详情"}>
            {!selectedEvent ? (
              <Empty description="请先选择一条事件" />
            ) : (
              <Space direction="vertical" size={12} className="w-full">
                <Descriptions bordered size="small" column={3}>
                  <Descriptions.Item label="峰值电流(kA)">{formatNumber(selectedEvent.peak_current_ka, 3)}</Descriptions.Item>
                  <Descriptions.Item label="绝对峰值(kA)">{formatNumber(selectedEvent.peak_abs_current_ka, 3)}</Descriptions.Item>
                  <Descriptions.Item label="波形分类">{formatNullable(selectedEvent.wave_shape)}</Descriptions.Item>
                  <Descriptions.Item label="T1(us)">{formatNumber(selectedEvent.wavefront_time_t1_us, 3)}</Descriptions.Item>
                  <Descriptions.Item label="T2(us)">{formatNumber(selectedEvent.half_value_time_t2_us, 3)}</Descriptions.Item>
                  <Descriptions.Item label="陡度(kA/us)">{formatNumber(selectedEvent.steepness_ka_per_us, 6)}</Descriptions.Item>
                  <Descriptions.Item label="I²t (J/Ω)">{formatNumber(selectedEvent.action_integral_j_ohm, 3)}</Descriptions.Item>
                  <Descriptions.Item label="采样间隔(us)">{formatNumber(selectedEvent.sample_interval_us, 6)}</Descriptions.Item>
                  <Descriptions.Item label="采样频率(Hz)">{formatNumber(selectedEvent.sampling_frequency_hz, 2)}</Descriptions.Item>
                  <Descriptions.Item label="极性">{formatPolarity(selectedEvent.polarity)}</Descriptions.Item>
                  <Descriptions.Item label="回击数">{selectedEvent.stroke_count}</Descriptions.Item>
                  <Descriptions.Item label="采样点数">{selectedEvent.sample_count}</Descriptions.Item>
                  <Descriptions.Item label="区域">{formatNullable(selectedEvent.region_id)}</Descriptions.Item>
                  <Descriptions.Item label="地域标签">{formatNullable(selectedEvent.location_tag)}</Descriptions.Item>
                  <Descriptions.Item label="城市">{formatNullable(selectedEvent.city)}</Descriptions.Item>
                  <Descriptions.Item label="经纬度">
                    {selectedEvent.longitude !== null && selectedEvent.latitude !== null
                      ? `${selectedEvent.longitude}, ${selectedEvent.latitude}`
                      : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="传感器">{formatNullable(selectedEvent.sensor_model)}</Descriptions.Item>
                  <Descriptions.Item label="安装位置">{formatNullable(selectedEvent.install_position)}</Descriptions.Item>
                </Descriptions>

                <Typography.Text type="secondary">
                  多回击峰值点：{JSON.stringify(selectedEvent.stroke_peaks_json)}
                </Typography.Text>
              </Space>
            )}
          </Card>

          <Card title={selectedEvent ? `采样预览（前 200 点） - ${selectedEvent.event_id}` : "采样预览"}>
            {!selectedEvent ? (
              <Empty description="请先选择一条事件" />
            ) : (
              <Table<LightningCurrentSampleItem>
                rowKey={(row) => row.id}
                columns={sampleColumns}
                dataSource={samples}
                loading={samplesQuery.isFetching}
                pagination={false}
                size="small"
                scroll={{ y: 420 }}
              />
            )}
          </Card>
        </>
      )}
    </Space>
  );
}
