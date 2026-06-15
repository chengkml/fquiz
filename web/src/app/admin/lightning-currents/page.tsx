"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  type MenuProps,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

import { useAuth } from "@/components/auth-provider";
import { AdminPageLoading } from "@/components/admin-page-loading";
import { Card } from "@/components/ui-antd";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  LightningCurrentEventListResponse,
  LightningCurrentEventSummary,
  LightningCurrentExceedanceResponse,
  LightningCurrentImportResponse,
  LightningCurrentSampleListResponse,
  LightningCurrentSampleItem,
  LightningPolarity,
} from "@/types/auth";
import type { CSSProperties } from "react";

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

const LIGHTNING_TABLE_MIN_SCROLL_Y = 180;
const LIGHTNING_TABLE_VIEWPORT_GAP = 40;
const LIGHTNING_TABLE_FALLBACK_RESERVE = 220;

export default function AdminLightningCurrentsPage() {
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [importForm] = Form.useForm<ImportFormValues>();
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exceedanceModalOpen, setExceedanceModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [selectedEventForModal, setSelectedEventForModal] = useState<LightningCurrentEventSummary | null>(null);
  const [tableScrollY, setTableScrollY] = useState(LIGHTNING_TABLE_MIN_SCROLL_Y);

  const canRead = hasPermission("lightning.read") || hasPermission("lightning.manage");
  const canManage = hasPermission("lightning.manage");

  const eventListPath = "/api/v1/lightning-currents?limit=200&offset=0";

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

  const exceedancePath = useMemo(() => {
    if (!selectedEventForModal?.id) return "";
    return `/api/v1/lightning-currents/stats/exceedance`;
  }, [selectedEventForModal?.id]);

  const exceedanceQuery = useQuery({
    queryKey: [exceedancePath, selectedEventForModal?.id],
    enabled: !!user && canRead && exceedanceModalOpen && !!selectedEventForModal,
    queryFn: async () => {
      const response = await fetchWithAuth(exceedancePath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as LightningCurrentExceedanceResponse;
    },
  });

  const samplePath = useMemo(() => {
    if (!selectedEventForModal?.id) return "";
    return `/api/v1/lightning-currents/${selectedEventForModal.id}/samples?limit=200&offset=0`;
  }, [selectedEventForModal?.id]);

  const samplesQuery = useQuery({
    queryKey: [samplePath],
    enabled: !!user && canRead && sampleModalOpen && !!selectedEventForModal,
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
        && query.queryKey[0].startsWith("/api/v1/lightning-currents"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.lightning-currents",
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - LIGHTNING_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? LIGHTNING_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - LIGHTNING_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(LIGHTNING_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [error, listError, sampleError, statsError, events.length, eventsQuery.isFetching, updateTableScrollY]);

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
    onSuccess: async () => {
      setError("");
      setSuccess("雷电流事件已删除");
      await refreshAll();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
  });

  const openExceedanceModal = (event: LightningCurrentEventSummary) => {
    setSelectedEventForModal(event);
    setExceedanceModalOpen(true);
  };

  const openDetailModal = (event: LightningCurrentEventSummary) => {
    setSelectedEventForModal(event);
    setDetailModalOpen(true);
  };

  const openSampleModal = (event: LightningCurrentEventSummary) => {
    setSelectedEventForModal(event);
    setSampleModalOpen(true);
  };

  const eventColumns = useMemo<ColumnsType<LightningCurrentEventSummary>>(
    () => [
      {
        title: "事件编号",
        dataIndex: "event_id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "文件名称",
        dataIndex: "source_file_name",
        width: 200,
        render: (value: string | null) => value || "-",
      },
      {
        title: "导入时间",
        dataIndex: "create_date",
        width: 180,
        render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }),
      },
      {
        title: "峰值电流(kA)",
        dataIndex: "peak_abs_current_ka",
        width: 120,
        render: (value: number | null) => formatNumber(value, 2),
      },
      {
        title: "波形分类",
        dataIndex: "wave_shape",
        width: 100,
        render: (value: string | null) => value || "-",
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
        dataIndex: "region_id",
        width: 120,
        render: (value: string | null) => value || "-",
      },
      {
        title: "地域标签",
        dataIndex: "location_tag",
        width: 150,
        render: (value: string | null) => value || "-",
      },
      {
        title: "来源",
        dataIndex: "is_synthetic",
        width: 80,
        render: (value: boolean) => (value ? <Tag color="purple">合成</Tag> : <Tag color="green">实测</Tag>),
      },
      {
        title: "采样点数",
        dataIndex: "sample_count",
        width: 100,
      },
      {
        title: "操作",
        key: "actions",
        width: 200,
        fixed: "right",
        render: (_: unknown, row) => {
          const moreMenuItems: MenuProps["items"] = [
            {
              key: "sample",
              label: "采样预览",
              onClick: () => openSampleModal(row),
            },
            {
              type: "divider",
            },
            {
              key: "delete",
              label: "删除",
              danger: true,
              disabled: !canManage,
            },
          ];

          return (
            <Space wrap>
              <Button
                size="small"
                onClick={() => openExceedanceModal(row)}
              >
                峰值超越概率
              </Button>
              <Button
                size="small"
                onClick={() => openDetailModal(row)}
              >
                事件详情
              </Button>
              <Dropdown
                menu={{
                  items: moreMenuItems,
                  onClick: ({ key }) => {
                    if (key === "delete") {
                      Modal.confirm({
                        title: "删除事件",
                        content: `确认删除事件 ${row.event_id} 吗？`,
                        okText: "删除",
                        cancelText: "取消",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await deleteMutation.mutateAsync(row.id);
                        },
                      });
                    }
                  },
                }}
                trigger={["click"]}
              >
                <Button size="small" icon={<MoreOutlined />} />
              </Dropdown>
            </Space>
          );
        },
      },
    ],
    [canManage, deleteMutation],
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

  const samples = samplesQuery.data?.items ?? [];
  const exceedance = exceedanceQuery.data?.thresholds ?? [];

  const chartData = samples.map((item) => ({
    time_us: item.time_us,
    current_ka: item.current_ka,
  }));

  return (
    <Space direction="vertical" size={16} className="w-full">
      <Card
        title="雷电幅值统计"
        extra={
          canManage && (
            <Button type="primary" onClick={() => setImportModalOpen(true)}>
              导入雷电流数据
            </Button>
          )
        }
      >
        <div
          ref={tableScrollAnchorRef}
          className="lightning-table-anchor"
          style={{ "--lightning-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<LightningCurrentEventSummary>
            rowKey={(row) => row.id}
            columns={eventColumns}
            dataSource={events}
            loading={eventsQuery.isFetching}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
            scroll={{ x: 1800, y: tableScrollY }}
          />
        </div>
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

      <Modal
        title={selectedEventForModal ? `峰值超越概率（P 曲线） - ${selectedEventForModal.event_id}` : "峰值超越概率（P 曲线）"}
        open={exceedanceModalOpen}
        onCancel={() => {
          setExceedanceModalOpen(false);
          setSelectedEventForModal(null);
        }}
        footer={null}
        width={800}
        destroyOnClose
      >
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
            loading={exceedanceQuery.isFetching}
          />
        )}
      </Modal>

      <Modal
        title={selectedEventForModal ? `事件详情 - ${selectedEventForModal.event_id}` : "事件详情"}
        open={detailModalOpen}
        onCancel={() => {
          setDetailModalOpen(false);
          setSelectedEventForModal(null);
        }}
        footer={null}
        width={900}
        destroyOnClose
      >
        {selectedEventForModal && (
          <Space direction="vertical" size={12} className="w-full">
            <Descriptions bordered size="small" column={3}>
              <Descriptions.Item label="峰值电流(kA)">{formatNumber(selectedEventForModal.peak_current_ka, 3)}</Descriptions.Item>
              <Descriptions.Item label="绝对峰值(kA)">{formatNumber(selectedEventForModal.peak_abs_current_ka, 3)}</Descriptions.Item>
              <Descriptions.Item label="波形分类">{formatNullable(selectedEventForModal.wave_shape)}</Descriptions.Item>
              <Descriptions.Item label="T1(us)">{formatNumber(selectedEventForModal.wavefront_time_t1_us, 3)}</Descriptions.Item>
              <Descriptions.Item label="T2(us)">{formatNumber(selectedEventForModal.half_value_time_t2_us, 3)}</Descriptions.Item>
              <Descriptions.Item label="陡度(kA/us)">{formatNumber(selectedEventForModal.steepness_ka_per_us, 6)}</Descriptions.Item>
              <Descriptions.Item label="I²t (J/Ω)">{formatNumber(selectedEventForModal.action_integral_j_ohm, 3)}</Descriptions.Item>
              <Descriptions.Item label="采样间隔(us)">{formatNumber(selectedEventForModal.sample_interval_us, 6)}</Descriptions.Item>
              <Descriptions.Item label="采样频率(Hz)">{formatNumber(selectedEventForModal.sampling_frequency_hz, 2)}</Descriptions.Item>
              <Descriptions.Item label="极性">{formatPolarity(selectedEventForModal.polarity)}</Descriptions.Item>
              <Descriptions.Item label="回击数">{selectedEventForModal.stroke_count}</Descriptions.Item>
              <Descriptions.Item label="采样点数">{selectedEventForModal.sample_count}</Descriptions.Item>
              <Descriptions.Item label="区域">{formatNullable(selectedEventForModal.region_id)}</Descriptions.Item>
              <Descriptions.Item label="地域标签">{formatNullable(selectedEventForModal.location_tag)}</Descriptions.Item>
              <Descriptions.Item label="城市">{formatNullable(selectedEventForModal.city)}</Descriptions.Item>
              <Descriptions.Item label="经纬度">
                {selectedEventForModal.longitude !== null && selectedEventForModal.latitude !== null
                  ? `${selectedEventForModal.longitude}, ${selectedEventForModal.latitude}`
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="传感器">{formatNullable(selectedEventForModal.sensor_model)}</Descriptions.Item>
              <Descriptions.Item label="安装位置">{formatNullable(selectedEventForModal.install_position)}</Descriptions.Item>
            </Descriptions>

            <Typography.Text type="secondary">
              多回击峰值点：{JSON.stringify(selectedEventForModal.stroke_peaks_json)}
            </Typography.Text>
          </Space>
        )}
      </Modal>

      <Modal
        title={selectedEventForModal ? `采样预览 - ${selectedEventForModal.event_id}` : "采样预览"}
        open={sampleModalOpen}
        onCancel={() => {
          setSampleModalOpen(false);
          setSelectedEventForModal(null);
        }}
        footer={null}
        width={1000}
        destroyOnClose
      >
        {samples.length === 0 ? (
          <Empty description="暂无采样数据" />
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_us" label={{ value: "时间 (μs)", position: "insideBottom", offset: -5 }} />
              <YAxis label={{ value: "电流 (kA)", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="current_ka" stroke="#8884d8" name="电流 (kA)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {samplesQuery.isFetching && <Typography.Text type="secondary">加载中...</Typography.Text>}
      </Modal>
    </Space>
  );
}
