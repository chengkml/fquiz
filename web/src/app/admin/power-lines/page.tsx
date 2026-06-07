"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { PowerLineCesiumMap } from "@/components/power-line-cesium-map";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  LineListResponse,
  LineSummary,
  LineTowerImportResponse,
  LineTowerListResponse,
  LineTowerSummary,
  TowerModelSummary,
  TowerProfileDetail,
} from "@/types/auth";

type LineFormValues = {
  code: string;
  name: string;
  voltage_level: string | null;
};

type TowerFormValues = {
  seq_no: number;
  tower_no: string;
  tower_model: string;
  tower_type: string;
  longitude: number | null;
  latitude: number | null;
  altitude_m: number | null;
  terrain: string;
  ground_resistance_ohm: number | null;
  lightning_density: number | null;
  span_small_m: number | null;
  span_large_m: number | null;
  slope_1: number | null;
  slope_2: number | null;
  risk_level: string;
};

type TowerProfileFormValues = {
  structure_kind: string;
  stroke_mode: string;
  phase_sequence_1: string;
  phase_sequence_2: string;
  phase_sequence_3: string;
  phase_sequence_4: string;
  arrester_a: string;
  arrester_b: string;
  arrester_c: string;
  geometry_layers_json: string;
};

const TOWER_TYPE_OPTIONS = [
  { value: "", label: "全部塔型" },
  { value: "直线", label: "直线" },
  { value: "耐张", label: "耐张" },
] as const;

const LINE_VOLTAGE_OPTIONS = [
  { value: "dc_500", label: "直流500kV", voltage_kv: 500 },
  { value: "dc_800", label: "直流800kV", voltage_kv: 800 },
  { value: "dc_1000", label: "直流1000kV", voltage_kv: 1000 },
  { value: "ac_35", label: "交流35kV", voltage_kv: 35 },
  { value: "ac_66", label: "交流66kV", voltage_kv: 66 },
  { value: "ac_110", label: "交流110kV", voltage_kv: 110 },
  { value: "ac_220", label: "交流220kV", voltage_kv: 220 },
  { value: "ac_330", label: "交流330kV", voltage_kv: 330 },
  { value: "ac_500", label: "交流500kV", voltage_kv: 500 },
  { value: "ac_750", label: "交流750kV", voltage_kv: 750 },
  { value: "ac_800", label: "交流800kV", voltage_kv: 800 },
  { value: "ac_1000", label: "交流1000kV", voltage_kv: 1000 },
  { value: "ac_110_x4", label: "交流110kV|交流110kV|交流110kV|交流110kV", voltage_kv: 110 },
  { value: "ac_220_x4", label: "交流220kV|交流220kV|交流220kV|交流220kV", voltage_kv: 220 },
] as const;

const LINE_VOLTAGE_VALUE_TO_KV: Record<(typeof LINE_VOLTAGE_OPTIONS)[number]["value"], number> = {
  dc_500: 500,
  dc_800: 800,
  dc_1000: 1000,
  ac_35: 35,
  ac_66: 66,
  ac_110: 110,
  ac_220: 220,
  ac_330: 330,
  ac_500: 500,
  ac_750: 750,
  ac_800: 800,
  ac_1000: 1000,
  ac_110_x4: 110,
  ac_220_x4: 220,
};

const LINE_VOLTAGE_KV_TO_DEFAULT_OPTION: Partial<Record<number, (typeof LINE_VOLTAGE_OPTIONS)[number]["value"]>> = {
  35: "ac_35",
  66: "ac_66",
  110: "ac_110",
  220: "ac_220",
  330: "ac_330",
  500: "dc_500",
  750: "ac_750",
  800: "dc_800",
  1000: "dc_1000",
};

const TOWER_TABLE_DEFAULT_PAGE_SIZE = 20;
const TOWER_MAP_QUERY_LIMIT = 500;
const POWER_LINES_PANEL_MIN_HEIGHT = 360;
const POWER_LINES_PANEL_FALLBACK_RESERVE = 220;
const POWER_LINES_PANEL_VIEWPORT_GAP = 10;
const POWER_LINES_PANEL_BODY_GAP = 16;
const POWER_LINES_FILTERS_ESTIMATE_HEIGHT = 86;
const POWER_LINES_STATUS_ESTIMATE_HEIGHT = 34;
const POWER_LINES_MAP_HEADER_ESTIMATE_HEIGHT = 112;
const POWER_LINES_MAP_MIN_HEIGHT = 240;
const POWER_LINES_TABLE_MIN_SCROLL_Y = 180;

const EMPTY_LINE_FORM: LineFormValues = {
  code: "",
  name: "",
  voltage_level: null,
};

const EMPTY_TOWER_FORM: TowerFormValues = {
  seq_no: 1,
  tower_no: "",
  tower_model: "",
  tower_type: "",
  longitude: null,
  latitude: null,
  altitude_m: null,
  terrain: "",
  ground_resistance_ohm: null,
  lightning_density: null,
  span_small_m: null,
  span_large_m: null,
  slope_1: null,
  slope_2: null,
  risk_level: "",
};

const EMPTY_TOWER_PROFILE_FORM: TowerProfileFormValues = {
  structure_kind: "",
  stroke_mode: "",
  phase_sequence_1: "",
  phase_sequence_2: "",
  phase_sequence_3: "",
  phase_sequence_4: "",
  arrester_a: "",
  arrester_b: "",
  arrester_c: "",
  geometry_layers_json: "{}",
};

function resolveVoltageOptionFromKv(voltageKv: number | null): LineFormValues["voltage_level"] {
  if (voltageKv === null) {
    return null;
  }
  return LINE_VOLTAGE_KV_TO_DEFAULT_OPTION[voltageKv] ?? null;
}

export default function AdminPowerLinesPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { message: messageApi } = App.useApp();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const panelScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const [lineForm] = Form.useForm<LineFormValues>();
  const [towerForm] = Form.useForm<TowerFormValues>();
  const [towerProfileForm] = Form.useForm<TowerProfileFormValues>();

  const [keyword, setKeyword] = useState("");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedLineTouched, setSelectedLineTouched] = useState(false);
  const [towerKeyword, setTowerKeyword] = useState("");
  const [towerTypeFilter, setTowerTypeFilter] = useState("");
  const [towerRiskFilter, setTowerRiskFilter] = useState("");
  const [towerPagination, setTowerPagination] = useState({ current: 1, pageSize: TOWER_TABLE_DEFAULT_PAGE_SIZE });
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [towerModalOpen, setTowerModalOpen] = useState(false);
  const [towerProfileModalOpen, setTowerProfileModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<LineSummary | null>(null);
  const [editingTower, setEditingTower] = useState<LineTowerSummary | null>(null);
  const [editingTowerProfileTower, setEditingTowerProfileTower] = useState<LineTowerSummary | null>(null);
  const [towerViewMode, setTowerViewMode] = useState<"table" | "map">("map");
  const [error, setError] = useState("");
  const [panelBodyHeight, setPanelBodyHeight] = useState(POWER_LINES_PANEL_MIN_HEIGHT);

  const canLineRead = hasPermission("line.read") || hasPermission("line.manage");
  const canLineManage = hasPermission("line.manage");
  const canTowerRead = hasPermission("tower.read") || hasPermission("tower.manage");
  const canTowerManage = hasPermission("tower.manage");
  const canRead = canLineRead || canTowerRead;

  const lineListPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    const query = params.toString();
    return `/api/v1/lines${query ? `?${query}` : ""}`;
  }, [keyword]);

  const towerListPath = useMemo(() => {
    if (!selectedLineId) {
      return "";
    }
    const params = new URLSearchParams();
    if (towerKeyword.trim()) {
      params.set("keyword", towerKeyword.trim());
    }
    if (towerTypeFilter) {
      params.set("tower_type", towerTypeFilter);
    }
    if (towerRiskFilter.trim()) {
      params.set("risk_level", towerRiskFilter.trim());
    }
    if (towerViewMode === "table") {
      params.set("limit", String(towerPagination.pageSize));
      params.set("offset", String((towerPagination.current - 1) * towerPagination.pageSize));
    } else {
      params.set("limit", String(TOWER_MAP_QUERY_LIMIT));
      params.set("offset", "0");
    }
    const query = params.toString();
    return `/api/v1/lines/${selectedLineId}/towers?${query}`;
  }, [
    selectedLineId,
    towerKeyword,
    towerTypeFilter,
    towerRiskFilter,
    towerViewMode,
    towerPagination.current,
    towerPagination.pageSize,
  ]);

  const linesQuery = useQuery({
    queryKey: [lineListPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(lineListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LineListResponse;
    },
  });

  const towersQuery = useQuery({
    queryKey: [towerListPath],
    enabled: !!user && !!selectedLineId && canRead,
    queryFn: async () => {
      if (!towerListPath) {
        return { items: [], total: 0 } satisfies LineTowerListResponse;
      }
      const response = await fetchWithAuth(towerListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LineTowerListResponse;
    },
  });

  const towerModelOptionsQuery = useQuery({
    queryKey: ["/api/v1/tower-models/selector"],
    enabled: !!user && canTowerRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/tower-models/selector");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TowerModelSummary[];
    },
  });

  const towerProfileQuery = useQuery({
    queryKey: ["tower-profile", editingTowerProfileTower?.id],
    enabled: !!user && !!editingTowerProfileTower && towerProfileModalOpen && canTowerRead,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/tower-profiles/${editingTowerProfileTower?.id}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TowerProfileDetail;
    },
  });

  const refreshLines = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/lines"),
    });
  }, [queryClient]);

  const refreshTowers = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].includes("/towers"),
    });
  }, [queryClient]);

  useEffect(() => {
    const profile = towerProfileQuery.data;
    if (!profile) {
      return;
    }
    towerProfileForm.setFieldsValue({
      structure_kind: profile.structure_kind ?? "",
      stroke_mode: profile.stroke_mode ?? "",
      phase_sequence_1: profile.phase_sequence_1 ?? "",
      phase_sequence_2: profile.phase_sequence_2 ?? "",
      phase_sequence_3: profile.phase_sequence_3 ?? "",
      phase_sequence_4: profile.phase_sequence_4 ?? "",
      arrester_a: profile.arrester_a ?? "",
      arrester_b: profile.arrester_b ?? "",
      arrester_c: profile.arrester_c ?? "",
      geometry_layers_json: JSON.stringify(profile.geometry_layers_json ?? {}, null, 2),
    });
  }, [towerProfileForm, towerProfileQuery.data]);

  useTopicSubscription("admin.power-lines", useCallback(() => {
    void refreshLines();
    void refreshTowers();
  }, [refreshLines, refreshTowers]));
  useTopicSubscription("admin.tower-models", useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["/api/v1/tower-models/selector"] });
  }, [queryClient]));

  const lines = linesQuery.data?.items ?? [];
  const towers = towersQuery.data?.items ?? [];

  const towerModels = towerModelOptionsQuery.data ?? [];
  const towerModelOptions = towerModels.map((item) => ({ value: item.code, label: `${item.code} - ${item.name}` }));
  const effectiveSelectedLineId = useMemo(() => {
    if (selectedLineTouched) {
      if (selectedLineId && lines.some((item) => item.id === selectedLineId)) {
        return selectedLineId;
      }
      return lines.length > 0 ? lines[0].id : null;
    }
    return selectedLineId ?? (lines.length > 0 ? lines[0].id : null);
  }, [lines, selectedLineId, selectedLineTouched]);
  const towerQueryCurrent = towerPagination.current;
  const shouldResetTowerPage = towerQueryCurrent !== 1 && (
    selectedLineId !== effectiveSelectedLineId
    || towerKeyword.trim().length > 0
    || towerTypeFilter.length > 0
    || towerRiskFilter.trim().length > 0
  );
  const effectiveTowerPageCurrent = shouldResetTowerPage ? 1 : towerQueryCurrent;
  const selectedLine = useMemo(
    () => lines.find((item) => item.id === effectiveSelectedLineId) ?? null,
    [lines, effectiveSelectedLineId],
  );
  useEffect(() => {
    if (selectedLineId !== effectiveSelectedLineId) {
      setSelectedLineId(effectiveSelectedLineId);
    }
  }, [selectedLineId, effectiveSelectedLineId]);

  const applyTowerModelDefaults = useCallback((modelCode: string | null | undefined) => {
    if (!modelCode) {
      return;
    }
    const matched = towerModels.find((item) => item.code === modelCode);
    if (!matched) {
      return;
    }
    towerForm.setFieldsValue({
      tower_type: matched.tower_type ?? "",
      altitude_m: matched.default_altitude_m ?? null,
      terrain: matched.default_terrain ?? "",
      ground_resistance_ohm: matched.default_ground_resistance_ohm ?? null,
      lightning_density: matched.default_lightning_density ?? null,
      span_small_m: matched.default_span_small_m ?? null,
      span_large_m: matched.default_span_large_m ?? null,
      slope_1: matched.default_slope_1 ?? null,
      slope_2: matched.default_slope_2 ?? null,
      risk_level: matched.default_risk_level ?? "",
    });
  }, [towerForm, towerModels]);

  const saveLineMutation = useMutation({
    mutationFn: async (values: LineFormValues) => {
      if (!canLineManage) {
        throw new Error("缺少 line.manage 权限");
      }
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        voltage_kv: values.voltage_level ? LINE_VOLTAGE_VALUE_TO_KV[values.voltage_level] : null,
      };

      if (editingLine) {
        const response = await fetchWithAuth(`/api/v1/lines/${editingLine.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            voltage_kv: payload.voltage_kv,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "updated" as const;
      }

      const response = await fetchWithAuth("/api/v1/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "created" as const;
    },
    onSuccess: async (mode) => {
      setError("");
      messageApi.success(mode === "created" ? "线路已创建" : "线路已更新");
      setLineModalOpen(false);
      setEditingLine(null);
      lineForm.resetFields();
      await refreshLines();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "保存线路失败");
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      const response = await fetchWithAuth(`/api/v1/lines/${lineId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return lineId;
    },
    onSuccess: async (lineId) => {
      if (effectiveSelectedLineId === lineId) {
        setSelectedLineTouched(false);
        setSelectedLineId(null);
      }
      setError("");
      messageApi.success("线路已删除");
      await refreshLines();
      await refreshTowers();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "删除线路失败");
    },
  });

  const saveTowerMutation = useMutation({
    mutationFn: async (values: TowerFormValues) => {
      if (!effectiveSelectedLineId) {
        throw new Error("请先选择线路");
      }
      if (!canTowerManage) {
        throw new Error("缺少 tower.manage 权限");
      }

      const payload = {
        seq_no: Number(values.seq_no),
        tower_no: values.tower_no.trim(),
        tower_model: values.tower_model.trim() || null,
        tower_type: values.tower_type.trim() || null,
        longitude: values.longitude ?? null,
        latitude: values.latitude ?? null,
        altitude_m: values.altitude_m ?? null,
        terrain: values.terrain.trim() || null,
        ground_resistance_ohm: values.ground_resistance_ohm ?? null,
        lightning_density: values.lightning_density ?? null,
        span_small_m: values.span_small_m ?? null,
        span_large_m: values.span_large_m ?? null,
        slope_1: values.slope_1 ?? null,
        slope_2: values.slope_2 ?? null,
        risk_level: values.risk_level.trim() || null,
      };

      if (editingTower) {
        const response = await fetchWithAuth(`/api/v1/lines/towers/${editingTower.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "updated" as const;
      }

      const response = await fetchWithAuth(`/api/v1/lines/${effectiveSelectedLineId}/towers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "created" as const;
    },
    onSuccess: async (mode) => {
      setError("");
      messageApi.success(mode === "created" ? "杆塔已创建" : "杆塔已更新");
      setTowerModalOpen(false);
      setEditingTower(null);
      towerForm.resetFields();
      await refreshTowers();
      await refreshLines();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "保存杆塔失败");
    },
  });

  const deleteTowerMutation = useMutation({
    mutationFn: async (towerId: string) => {
      const response = await fetchWithAuth(`/api/v1/lines/towers/${towerId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return towerId;
    },
    onSuccess: async () => {
      setError("");
      messageApi.success("杆塔已删除");
      await refreshTowers();
      await refreshLines();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "删除杆塔失败");
    },
  });

  const saveTowerProfileMutation = useMutation({
    mutationFn: async (values: TowerProfileFormValues) => {
      if (!editingTowerProfileTower) {
        throw new Error("未选择杆塔");
      }
      const geometryLayers = values.geometry_layers_json.trim()
        ? JSON.parse(values.geometry_layers_json)
        : {};
      const response = await fetchWithAuth(`/api/v1/tower-profiles/${editingTowerProfileTower.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structure_kind: values.structure_kind.trim() || null,
          stroke_mode: values.stroke_mode.trim() || null,
          phase_sequence_1: values.phase_sequence_1.trim() || null,
          phase_sequence_2: values.phase_sequence_2.trim() || null,
          phase_sequence_3: values.phase_sequence_3.trim() || null,
          phase_sequence_4: values.phase_sequence_4.trim() || null,
          arrester_a: values.arrester_a.trim() || null,
          arrester_b: values.arrester_b.trim() || null,
          arrester_c: values.arrester_c.trim() || null,
          geometry_layers_json: geometryLayers,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TowerProfileDetail;
    },
    onSuccess: async () => {
      setError("");
      messageApi.success("专业参数已保存");
      setTowerProfileModalOpen(false);
      setEditingTowerProfileTower(null);
      towerProfileForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["tower-profile"] });
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "保存专业参数失败");
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!effectiveSelectedLineId) {
        throw new Error("请先选择线路");
      }
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchWithAuth(`/api/v1/lines/${effectiveSelectedLineId}/towers/import`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LineTowerImportResponse;
    },
    onSuccess: async (result) => {
      setError("");
      messageApi.success(
        `导入完成：新增 ${result.imported_count} 条，更新 ${result.updated_count} 条，跳过 ${result.skipped_count} 条`,
      );
      await refreshLines();
      await refreshTowers();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "导入失败");
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedLineId) {
        throw new Error("请先选择线路");
      }
      const response = await fetchWithAuth(`/api/v1/lines/${effectiveSelectedLineId}/towers/export`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") || "";
      const matched = contentDisposition.match(/filename=\"([^\"]+)\"/i);
      const filename = matched?.[1] ?? "towers_export.csv";
      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setError("");
      messageApi.success("导出成功");
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "导出失败");
    },
  });

  const openCreateLineModal = () => {
    setEditingLine(null);
    lineForm.setFieldsValue(EMPTY_LINE_FORM);
    setLineModalOpen(true);
  };

  const openEditLineModal = (line: LineSummary) => {
    setEditingLine(line);
    lineForm.setFieldsValue({
      code: line.code,
      name: line.name,
      voltage_level: resolveVoltageOptionFromKv(line.voltage_kv),
    });
    setLineModalOpen(true);
  };

  const openCreateTowerModal = () => {
    setEditingTower(null);
    towerForm.setFieldsValue(EMPTY_TOWER_FORM);
    setTowerModalOpen(true);
    if (towerModels.length > 0) {
      const preferred = towerModels[0]?.code;
      if (preferred) {
        towerForm.setFieldsValue({ tower_model: preferred });
        applyTowerModelDefaults(preferred);
      }
    }
  };

  const openEditTowerModal = (item: LineTowerSummary) => {
    setEditingTower(item);
    towerForm.setFieldsValue({
      seq_no: item.seq_no,
      tower_no: item.tower_no,
      tower_model: item.tower_model ?? "",
      tower_type: item.tower_type ?? "",
      longitude: item.longitude,
      latitude: item.latitude,
      altitude_m: item.altitude_m,
      terrain: item.terrain ?? "",
      ground_resistance_ohm: item.ground_resistance_ohm,
      lightning_density: item.lightning_density,
      span_small_m: item.span_small_m,
      span_large_m: item.span_large_m,
      slope_1: item.slope_1,
      slope_2: item.slope_2,
      risk_level: item.risk_level ?? "",
    });
    setTowerModalOpen(true);
  };

  const openTowerProfileModal = (item: LineTowerSummary) => {
    setEditingTowerProfileTower(item);
    towerProfileForm.setFieldsValue(EMPTY_TOWER_PROFILE_FORM);
    setTowerProfileModalOpen(true);
  };

  const lineCards = lines.map((line) => {
    const selected = line.id === effectiveSelectedLineId;
    return (
      <Card
        key={line.id}
        size="small"
        hoverable
        onClick={() => {
          setSelectedLineTouched(true);
          setSelectedLineId(line.id);
        }}
        style={selected
          ? {
            borderColor: "var(--ant-color-primary)",
            background: "var(--ant-color-primary-bg)",
          }
          : undefined}
        title={(
          <Space size={8} wrap>
            <Typography.Text strong>{line.name}</Typography.Text>
          </Space>
        )}
        extra={canLineManage ? (
          <Space size={4}>
            <Button
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                openEditLineModal(line);
              }}
            >
              编辑
            </Button>
            <Popconfirm
              title="删除线路"
              description={`确认删除线路 ${line.code} 吗？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                await deleteLineMutation.mutateAsync(line.id);
              }}
            >
              <Button
                size="small"
                danger
                loading={deleteLineMutation.isPending}
                onClick={(event) => event.stopPropagation()}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : null}
      >
        <Space direction="vertical" size={4} className="w-full">
          <Typography.Text type="secondary">
            编码：<Typography.Text code>{line.code}</Typography.Text>
          </Typography.Text>
          <Typography.Text type="secondary">电压等级：{line.voltage_kv ?? "-"} kV</Typography.Text>
          <Typography.Text type="secondary">杆塔总数：{line.tower_count}</Typography.Text>
          <Typography.Text type="secondary">
            更新时间：{new Date(line.update_date).toLocaleString()}
          </Typography.Text>
        </Space>
      </Card>
    );
  });

  const towerColumns: ColumnsType<LineTowerSummary> = [
    { title: "序号", dataIndex: "seq_no", width: 80 },
    {
      title: "塔号",
      dataIndex: "tower_no",
      width: 120,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    { title: "模型", dataIndex: "tower_model", width: 180, render: (value: string | null) => value || "-" },
    { title: "塔型", dataIndex: "tower_type", width: 100, render: (value: string | null) => value || "-" },
    {
      title: "坐标",
      key: "geo",
      width: 200,
      render: (_: unknown, row) =>
        row.longitude !== null && row.latitude !== null
          ? `${row.longitude.toFixed(6)}, ${row.latitude.toFixed(6)}`
          : "-",
    },
    { title: "接地电阻", dataIndex: "ground_resistance_ohm", width: 100, render: (value: number | null) => value ?? "-" },
    { title: "地闪密度", dataIndex: "lightning_density", width: 100, render: (value: number | null) => value ?? "-" },
    { title: "风险等级", dataIndex: "risk_level", width: 100, render: (value: string | null) => value || "-" },
    {
      title: "更新时间",
      dataIndex: "update_date",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      fixed: "right",
      render: (_: unknown, row) => (
        <Space size={8}>
          {canTowerManage && (
            <Button size="small" onClick={() => openEditTowerModal(row)}>
              编辑
            </Button>
          )}
          {canTowerManage && (
            <Button size="small" onClick={() => openTowerProfileModal(row)}>
              专业参数
            </Button>
          )}
          {canTowerManage && (
            <Popconfirm
              title="删除杆塔"
              description={`确认删除杆塔 ${row.tower_no} 吗？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                await deleteTowerMutation.mutateAsync(row.id);
              }}
            >
              <Button size="small" danger loading={deleteTowerMutation.isPending}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const updatePanelBodyHeight = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const anchor = panelScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const anchorTop = anchor.getBoundingClientRect().top;
    let nextHeight = Math.floor(window.innerHeight - anchorTop - POWER_LINES_PANEL_FALLBACK_RESERVE);

    const rightCard = anchor.querySelector<HTMLElement>(".power-lines-right-card");
    if (rightCard) {
      const cardRect = rightCard.getBoundingClientRect();
      const body = rightCard.querySelector<HTMLElement>(".ant-card-body");
      const bodyHeight = body?.getBoundingClientRect().height ?? POWER_LINES_PANEL_MIN_HEIGHT;
      const nonBodyHeight = Math.max(0, cardRect.height - bodyHeight);
      const topGap = Math.max(0, cardRect.top - anchorTop);
      nextHeight = Math.floor(
        window.innerHeight - anchorTop - topGap - nonBodyHeight - POWER_LINES_PANEL_VIEWPORT_GAP,
      );
    }

    const clampedHeight = Math.max(POWER_LINES_PANEL_MIN_HEIGHT, nextHeight);
    setPanelBodyHeight((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    updatePanelBodyHeight();
  }, [
    lineCards.length,
    towerViewMode,
    towers.length,
    linesQuery.isFetching,
    towersQuery.isFetching,
    updatePanelBodyHeight,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updatePanelBodyHeight);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updatePanelBodyHeight]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    const anchor = panelScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updatePanelBodyHeight);
    });
    resizeObserver.observe(anchor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updatePanelBodyHeight]);

  const leftListHeight = Math.max(
    180,
    panelBodyHeight - POWER_LINES_FILTERS_ESTIMATE_HEIGHT - POWER_LINES_STATUS_ESTIMATE_HEIGHT - POWER_LINES_PANEL_BODY_GAP,
  );
  const rightContentHeight = Math.max(
    220,
    panelBodyHeight - POWER_LINES_MAP_HEADER_ESTIMATE_HEIGHT - POWER_LINES_PANEL_BODY_GAP,
  );
  const mapHeight = Math.max(POWER_LINES_MAP_MIN_HEIGHT, rightContentHeight - 32);
  const towerTableScrollY = Math.max(POWER_LINES_TABLE_MIN_SCROLL_Y, rightContentHeight - 54);

  if (initializing || linesQuery.isLoading) {
    return (
      <Card>
        <Typography.Text type="secondary">加载线路数据中...</Typography.Text>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再访问线路管理页面。</Typography.Text>
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
          <Typography.Text type="secondary">你没有访问该页面的权限（需要 `line.read` 或 `tower.read`）。</Typography.Text>
          <Button>
            <Link href="/">返回首页</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  const lineError = linesQuery.error instanceof Error ? linesQuery.error.message : "";
  const towerError = towersQuery.error instanceof Error ? towersQuery.error.message : "";

  return (
    <>
      <Space direction="vertical" size={16} className="w-full">
        {(error || lineError || towerError) && (
          <Alert type="error" showIcon message="操作失败" description={error || lineError || towerError} />
        )}

        <div
          ref={panelScrollAnchorRef}
          className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]"
          style={{ "--admin-power-lines-panel-body-height": `${panelBodyHeight}px` } as CSSProperties}
        >
          <Card
            title="线路管理"
            className="power-lines-left-card"
            styles={{ body: { height: panelBodyHeight, overflow: "hidden" } }}
            extra={canLineManage ? (
              <Button type="primary" onClick={openCreateLineModal}>
                新建线路
              </Button>
            ) : null}
          >
            <Space direction="vertical" size={12} className="w-full">
              <Typography.Text type="secondary">
                左侧选择线路，右侧查看线路分布图或塔杆列表。
              </Typography.Text>
              <Input
                value={keyword}
                allowClear
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按线路编码/名称筛选"
              />
              <Space direction="vertical" size={10} className="w-full overflow-y-auto pr-1" style={{ height: leftListHeight }}>
                {lines.length === 0 ? (
                  <Empty description="暂无线路数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  lineCards
                )}
              </Space>
            </Space>
          </Card>

          <Card
            className="power-lines-right-card"
            styles={{ body: { height: panelBodyHeight, overflow: "hidden" } }}
            title={selectedLine ? `${selectedLine.name} - 杆塔管理` : "杆塔管理"}
            extra={(
              <Space size={8} wrap>
                <Segmented
                  value={towerViewMode}
                  options={[
                    { label: "分布图", value: "map" },
                    { label: "塔杆列表", value: "table" },
                  ]}
                  onChange={(value) => setTowerViewMode(value as "table" | "map")}
                  disabled={!effectiveSelectedLineId}
                />
                {canTowerManage && (
                  <Button
                    onClick={() => importInputRef.current?.click()}
                    loading={importMutation.isPending}
                    disabled={!effectiveSelectedLineId}
                  >
                    导入 CSV
                  </Button>
                )}
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      importMutation.mutate(file);
                    }
                    event.target.value = "";
                  }}
                />
                <Button onClick={() => exportMutation.mutate()} loading={exportMutation.isPending} disabled={!effectiveSelectedLineId}>
                  导出 CSV
                </Button>
                {canTowerManage && (
                  <Button type="primary" onClick={openCreateTowerModal} disabled={!effectiveSelectedLineId}>
                    新建杆塔
                  </Button>
                )}
              </Space>
            )}
          >
            {!effectiveSelectedLineId || !selectedLine ? (
              <Empty description={effectiveSelectedLineId ? "所选线路不存在，请重新选择" : "请先选择一条线路"} />
            ) : (
              <Space direction="vertical" size={12} className="w-full">
                <Typography.Text type="secondary">
                  当前线路编码：{selectedLine.code}，杆塔总数：{selectedLine.tower_count ?? 0}，当前视图：{towerViewMode === "table" ? "塔杆列表" : "分布图"}
                </Typography.Text>
                <div className="grid gap-3 md:grid-cols-3">
                  <Input
                    value={towerKeyword}
                    allowClear
                    onChange={(event) => setTowerKeyword(event.target.value)}
                    placeholder="按塔号/模型筛选"
                  />
                  <Select
                    value={towerTypeFilter}
                    options={[...TOWER_TYPE_OPTIONS]}
                    onChange={(value) => setTowerTypeFilter(value)}
                  />
                  <Input
                    value={towerRiskFilter}
                    allowClear
                    onChange={(event) => setTowerRiskFilter(event.target.value)}
                    placeholder="按风险等级筛选"
                  />
                </div>
                <div className="relative overflow-y-auto" style={{ height: rightContentHeight }}>
                  <div
                    aria-hidden={towerViewMode !== "map"}
                    className={`transition-all duration-300 ease-out motion-reduce:transition-none ${
                      towerViewMode === "map"
                        ? "relative translate-y-0 opacity-100"
                        : "pointer-events-none absolute inset-0 translate-y-1 opacity-0"
                    }`}
                  >
                    <PowerLineCesiumMap
                      lineCode={selectedLine.code}
                      lineName={selectedLine.name}
                      towers={towers}
                      loading={towersQuery.isFetching}
                      height={mapHeight}
                    />
                  </div>

                  <div
                    aria-hidden={towerViewMode !== "table"}
                    className={`transition-all duration-300 ease-out motion-reduce:transition-none ${
                      towerViewMode === "table"
                        ? "relative translate-y-0 opacity-100"
                        : "pointer-events-none absolute inset-0 -translate-y-1 opacity-0"
                    }`}
                  >
                    <Table<LineTowerSummary>
                      rowKey={(row) => row.id}
                      columns={towerColumns}
                      dataSource={towers}
                      loading={towersQuery.isFetching}
                      pagination={{
                        current: effectiveTowerPageCurrent,
                        pageSize: towerPagination.pageSize,
                        total: towersQuery.data?.total ?? 0,
                        showSizeChanger: true,
                        showTotal: (total) => `共 ${total} 条`,
                        onChange: (page, pageSize) => {
                          setTowerPagination({ current: page, pageSize });
                        },
                      }}
                      scroll={{ x: 1520, y: towerTableScrollY }}
                    />
                  </div>
                </div>
              </Space>
            )}
          </Card>
        </div>
      </Space>

      <Modal
        title={editingLine ? "编辑线路" : "新建线路"}
        open={lineModalOpen}
        okText={editingLine ? "保存" : "创建"}
        confirmLoading={saveLineMutation.isPending}
        onCancel={() => {
          if (saveLineMutation.isPending) return;
          setLineModalOpen(false);
        }}
        onOk={async () => {
          const values = await lineForm.validateFields();
          saveLineMutation.mutate(values);
        }}
      >
        <Form<LineFormValues> form={lineForm} layout="vertical" initialValues={EMPTY_LINE_FORM}>
          <Form.Item
            name="code"
            label="线路编码"
            rules={[{ required: true, message: "请输入线路编码" }]}
          >
            <Input disabled={!!editingLine} />
          </Form.Item>
          <Form.Item
            name="name"
            label="线路名称"
            rules={[{ required: true, message: "请输入线路名称" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="voltage_level" label="电压等级">
            <Select
              allowClear
              placeholder="请选择电压等级"
              options={[...LINE_VOLTAGE_OPTIONS].map((item) => ({ value: item.value, label: item.label }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTower ? "编辑杆塔" : "新建杆塔"}
        open={towerModalOpen}
        width={860}
        okText={editingTower ? "保存" : "创建"}
        confirmLoading={saveTowerMutation.isPending}
        onCancel={() => {
          if (saveTowerMutation.isPending) return;
          setTowerModalOpen(false);
        }}
        onOk={async () => {
          const values = await towerForm.validateFields();
          saveTowerMutation.mutate(values);
        }}
      >
        <Form<TowerFormValues> form={towerForm} layout="vertical" initialValues={EMPTY_TOWER_FORM}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="seq_no" label="序号" rules={[{ required: true, message: "请输入序号" }]}>
              <InputNumber min={1} max={1000000} className="w-full" />
            </Form.Item>
            <Form.Item name="tower_no" label="塔号" rules={[{ required: true, message: "请输入塔号" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="tower_model" label="杆塔模型">
              <Select
                showSearch
                allowClear
                loading={towerModelOptionsQuery.isFetching}
                options={towerModelOptions}
                placeholder="请选择杆塔模型"
                onChange={(value) => {
                  applyTowerModelDefaults(value);
                }}
                filterOption={(input, option) =>
                  String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
            <Form.Item name="tower_type" label="塔型">
              <Select
                options={[
                  { value: "", label: "未设置" },
                  { value: "直线", label: "直线" },
                  { value: "耐张", label: "耐张" },
                ]}
              />
            </Form.Item>
            <Form.Item name="longitude" label="经度">
              <InputNumber className="w-full" precision={8} />
            </Form.Item>
            <Form.Item name="latitude" label="纬度">
              <InputNumber className="w-full" precision={8} />
            </Form.Item>
            <Form.Item name="altitude_m" label="海拔(m)">
              <InputNumber className="w-full" precision={4} />
            </Form.Item>
            <Form.Item name="terrain" label="地形">
              <Input />
            </Form.Item>
            <Form.Item name="ground_resistance_ohm" label="接地电阻(Ω)">
              <InputNumber className="w-full" precision={4} />
            </Form.Item>
            <Form.Item name="lightning_density" label="地闪密度">
              <InputNumber className="w-full" precision={8} />
            </Form.Item>
            <Form.Item name="span_small_m" label="小号侧档距(m)">
              <InputNumber className="w-full" precision={4} />
            </Form.Item>
            <Form.Item name="span_large_m" label="大号侧档距(m)">
              <InputNumber className="w-full" precision={4} />
            </Form.Item>
            <Form.Item name="slope_1" label="地面倾角1">
              <InputNumber className="w-full" precision={8} />
            </Form.Item>
            <Form.Item name="slope_2" label="地面倾角2">
              <InputNumber className="w-full" precision={8} />
            </Form.Item>
            <Form.Item name="risk_level" label="风险等级">
              <Input />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={editingTowerProfileTower ? `专业参数 - ${editingTowerProfileTower.tower_no}` : "专业参数"}
        open={towerProfileModalOpen}
        width={920}
        okText="保存"
        confirmLoading={saveTowerProfileMutation.isPending}
        onCancel={() => {
          if (saveTowerProfileMutation.isPending) return;
          setTowerProfileModalOpen(false);
          setEditingTowerProfileTower(null);
        }}
        onOk={async () => {
          const values = await towerProfileForm.validateFields();
          saveTowerProfileMutation.mutate(values);
        }}
      >
        <Form<TowerProfileFormValues> form={towerProfileForm} layout="vertical" initialValues={EMPTY_TOWER_PROFILE_FORM}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="structure_kind" label="直线/耐张">
              <Input />
            </Form.Item>
            <Form.Item name="stroke_mode" label="绕击/反击模式">
              <Input />
            </Form.Item>
            <Form.Item name="phase_sequence_1" label="I回相序">
              <Input />
            </Form.Item>
            <Form.Item name="phase_sequence_2" label="II回相序">
              <Input />
            </Form.Item>
            <Form.Item name="phase_sequence_3" label="III回相序">
              <Input />
            </Form.Item>
            <Form.Item name="phase_sequence_4" label="IV回相序">
              <Input />
            </Form.Item>
            <Form.Item name="arrester_a" label="A相避雷器">
              <Input />
            </Form.Item>
            <Form.Item name="arrester_b" label="B相避雷器">
              <Input />
            </Form.Item>
            <Form.Item name="arrester_c" label="C相避雷器">
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            name="geometry_layers_json"
            label="回路几何 JSON"
            rules={[{
              validator: async (_, value) => {
                if (!value || !String(value).trim()) {
                  return;
                }
                JSON.parse(String(value));
              },
              message: "请输入合法 JSON",
            }]}
          >
            <Input.TextArea rows={12} spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
