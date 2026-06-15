"use client";

import Link from "next/link";
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
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AdminPageLoading } from "@/components/admin-page-loading";
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
  LightningPolarity,
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

export default function AdminLightningCurrentsPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [importForm] = Form.useForm<ImportFormValues>();
  const [keyword, setKeyword] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [polarityFilter, setPolarityFilter] = useState<(typeof POLARITY_OPTIONS)[number]["value"]>("all");
  const [syntheticFilter, setSyntheticFilter] = useState<(typeof SYNTHETIC_OPTIONS)[number]["value"]>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");

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
    enabled: !!user && canRead,
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
    enabled: !!user && canRead && !!activeSelectedEventId,
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

  const listError = eventsQuery.error instanceof Error ? eventsQuery.error.message : "";
  const sampleError = samplesQuery.error instanceof Error ? samplesQuery.error.message : "";
  const statsError = exceedanceQuery.error instanceof Error ? exceedanceQuery.error.message : "";

  useToastFeedback({
    errorMessage: error || listError || sampleError || statsError,
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
      setImportModalOpen(false);
      importForm.resetFields();
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "导入失败");
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

  if (initializing || eventsQuery.isLoading) {
    return (
      <AdminPageLoading
        tip="加载雷电流数据中..."
        minHeightClassName="min-h-[280px]"
      />
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            请先登录后再访问雷电幅值统计页面。
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
            将当前雷电数据筛选结果按线路回填为&quot;雷电流幅值&quot;准备项；创建防雷分析任务前会使用这里的就绪状态做校验。
          </Typography.Text>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            <Button
              type="primary"
              onClick={() => prepareCurrentMutation.mutate()}
              loading={prepareCurrentMutation.isPending}
              disabled={!canManage || !activeSelectedLineId}
              block
            >
              回填雷电流幅值
            </Button>
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
            <Button type="primary" onClick={() => setImportModalOpen(true)}>
              导入雷电流数据
            </Button>
          )}
        </Space>
      </Card>

      <Modal
        title="导入雷电流数据"
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
          <Form.Item name="is_synthetic" valuePropName="checked">
            <Checkbox>这是合成数据</Checkbox>
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
            <Typography.Text type="secondary">支持单列电流序列（每行一个值）或&quot;双列 time,current&quot;格式。</Typography.Text>
          </Space>
        </Form>
      </Modal>

      <Card title="峰值超越概率（P 曲线）">
        {exceedance.length === 0 ? (
          <Empty description="暂无统计数据" />
        ) : (
          <Table
            rowKey={(row) => `${row.threshold_ka}`}
            pagination={false}
            dataSource={exceedance}
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
    </Space>
  );
}
