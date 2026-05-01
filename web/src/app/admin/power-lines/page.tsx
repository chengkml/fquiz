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
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { PowerLineCesiumMap } from "@/components/power-line-cesium-map";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  LineListResponse,
  LineStatus,
  LineSummary,
  LineTowerImportResponse,
  LineTowerListResponse,
  LineTowerSummary,
} from "@/types/auth";

type LineFormValues = {
  code: string;
  name: string;
  voltage_kv: number | null;
  tower_shape: string;
  status: LineStatus;
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

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
] as const;

const LINE_STATUS_OPTIONS = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
] as const;

const TOWER_TYPE_OPTIONS = [
  { value: "", label: "全部塔型" },
  { value: "直线", label: "直线" },
  { value: "耐张", label: "耐张" },
] as const;

const EMPTY_LINE_FORM: LineFormValues = {
  code: "",
  name: "",
  voltage_kv: null,
  tower_shape: "",
  status: "enabled",
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

function formatStatus(status: string): string {
  if (status === "enabled") return "启用";
  if (status === "disabled") return "禁用";
  return status || "-";
}

export default function AdminPowerLinesPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { message: messageApi } = App.useApp();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [lineForm] = Form.useForm<LineFormValues>();
  const [towerForm] = Form.useForm<TowerFormValues>();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("all");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [towerKeyword, setTowerKeyword] = useState("");
  const [towerTypeFilter, setTowerTypeFilter] = useState("");
  const [towerRiskFilter, setTowerRiskFilter] = useState("");
  const [lineModalOpen, setLineModalOpen] = useState(false);
  const [towerModalOpen, setTowerModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<LineSummary | null>(null);
  const [editingTower, setEditingTower] = useState<LineTowerSummary | null>(null);
  const [towerViewMode, setTowerViewMode] = useState<"table" | "map">("map");
  const [error, setError] = useState("");

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
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    const query = params.toString();
    return `/api/v1/lines${query ? `?${query}` : ""}`;
  }, [keyword, statusFilter]);

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
    params.set("limit", "500");
    params.set("offset", "0");
    const query = params.toString();
    return `/api/v1/lines/${selectedLineId}/towers?${query}`;
  }, [selectedLineId, towerKeyword, towerTypeFilter, towerRiskFilter]);

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

  useTopicSubscription("admin.power-lines", useCallback(() => {
    void refreshLines();
    void refreshTowers();
  }, [refreshLines, refreshTowers]));

  const lines = linesQuery.data?.items ?? [];
  const towers = towersQuery.data?.items ?? [];
  const selectedLine = useMemo(
    () => lines.find((item) => item.id === selectedLineId) ?? null,
    [lines, selectedLineId],
  );

  useEffect(() => {
    if (!selectedLineId && lines.length > 0) {
      setSelectedLineId(lines[0].id);
      return;
    }
    if (selectedLineId && !lines.some((item) => item.id === selectedLineId)) {
      setSelectedLineId(lines.length > 0 ? lines[0].id : null);
    }
  }, [lines, selectedLineId]);

  const saveLineMutation = useMutation({
    mutationFn: async (values: LineFormValues) => {
      if (!canLineManage) {
        throw new Error("缺少 line.manage 权限");
      }
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        voltage_kv: values.voltage_kv ?? null,
        tower_shape: values.tower_shape.trim() || null,
        status: values.status,
      };

      if (editingLine) {
        const response = await fetchWithAuth(`/api/v1/lines/${editingLine.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            voltage_kv: payload.voltage_kv,
            tower_shape: payload.tower_shape,
            status: payload.status,
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
      if (selectedLineId === lineId) {
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
      if (!selectedLineId) {
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

      const response = await fetchWithAuth(`/api/v1/lines/${selectedLineId}/towers`, {
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

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedLineId) {
        throw new Error("请先选择线路");
      }
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchWithAuth(`/api/v1/lines/${selectedLineId}/towers/import`, {
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
      if (!selectedLineId) {
        throw new Error("请先选择线路");
      }
      const response = await fetchWithAuth(`/api/v1/lines/${selectedLineId}/towers/export`);
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
      voltage_kv: line.voltage_kv,
      tower_shape: line.tower_shape ?? "",
      status: line.status,
    });
    setLineModalOpen(true);
  };

  const openCreateTowerModal = () => {
    setEditingTower(null);
    towerForm.setFieldsValue(EMPTY_TOWER_FORM);
    setTowerModalOpen(true);
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

  const lineCards = useMemo(
    () =>
      lines.map((line) => {
        const selected = line.id === selectedLineId;
        return (
          <Card
            key={line.id}
            size="small"
            hoverable
            onClick={() => setSelectedLineId(line.id)}
            style={selected
              ? {
                borderColor: "var(--ant-color-primary)",
                background: "var(--ant-color-primary-bg)",
              }
              : undefined}
            title={(
              <Space size={8} wrap>
                <Typography.Text strong>{line.name}</Typography.Text>
                <Tag color={line.status === "enabled" ? "success" : "default"}>{formatStatus(line.status)}</Tag>
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
              <Typography.Text type="secondary">塔形：{line.tower_shape || "-"}</Typography.Text>
              <Typography.Text type="secondary">杆塔总数：{line.tower_count}</Typography.Text>
              <Typography.Text type="secondary">
                更新时间：{new Date(line.update_date).toLocaleString()}
              </Typography.Text>
            </Space>
          </Card>
        );
      }),
    [canLineManage, deleteLineMutation, lines, selectedLineId],
  );

  const towerColumns = useMemo<ColumnsType<LineTowerSummary>>(
    () => [
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
    ],
    [canTowerManage, deleteTowerMutation],
  );

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
    <Space direction="vertical" size={16} className="w-full">
      {(error || lineError || towerError) && (
        <Alert type="error" showIcon message="操作失败" description={error || lineError || towerError} />
      )}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card
          title="线路管理"
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
            <Select
              value={statusFilter}
              options={[...STATUS_OPTIONS]}
              onChange={(value) => setStatusFilter(value)}
            />
            <Space direction="vertical" size={10} className="w-full max-h-[70vh] overflow-y-auto pr-1">
              {lines.length === 0 ? (
                <Empty description="暂无线路数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                lineCards
              )}
            </Space>
          </Space>
        </Card>

        <Card
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
                disabled={!selectedLineId}
              />
              {canTowerManage && (
                <Button
                  onClick={() => importInputRef.current?.click()}
                  loading={importMutation.isPending}
                  disabled={!selectedLineId}
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
              <Button onClick={() => exportMutation.mutate()} loading={exportMutation.isPending} disabled={!selectedLineId}>
                导出 CSV
              </Button>
              {canTowerManage && (
                <Button type="primary" onClick={openCreateTowerModal} disabled={!selectedLineId}>
                  新建杆塔
                </Button>
              )}
            </Space>
          )}
        >
          {!selectedLineId || !selectedLine ? (
            <Empty description={selectedLineId ? "所选线路不存在，请重新选择" : "请先选择一条线路"} />
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
              {towerViewMode === "table" ? (
                <Table<LineTowerSummary>
                  rowKey={(row) => row.id}
                  columns={towerColumns}
                  dataSource={towers}
                  loading={towersQuery.isFetching}
                  pagination={false}
                  scroll={{ x: 1520 }}
                />
              ) : (
                <PowerLineCesiumMap
                  lineCode={selectedLine.code}
                  lineName={selectedLine.name}
                  towers={towers}
                  loading={towersQuery.isFetching}
                />
              )}
            </Space>
          )}
        </Card>
      </div>

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
          <Form.Item name="voltage_kv" label="电压等级(kV)">
            <InputNumber min={1} max={2000} className="w-full" />
          </Form.Item>
          <Form.Item name="tower_shape" label="塔形">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
            <Select options={[...LINE_STATUS_OPTIONS]} />
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
              <Input />
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
    </Space>
  );
}
