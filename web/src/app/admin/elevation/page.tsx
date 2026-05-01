"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  ElevationApplyJobCreateResponse,
  ElevationApplyJobListResponse,
  ElevationApplyJobSummary,
  ElevationDatasetAnalyzeResponse,
  ElevationDatasetListResponse,
  ElevationDatasetSummary,
  LineListResponse,
  LineSummary,
} from "@/types/auth";

type DatasetFormValues = {
  code: string;
  name: string;
  source: string;
  mount_code: string;
  file_path: string;
  resolution_m: number | null;
  notes: string;
};

type ApplyFormValues = {
  line_id: string;
  dataset_id: string;
  mode: "fill_null_only" | "overwrite_all";
};

const DEFAULT_DATASET_FORM: DatasetFormValues = {
  code: "",
  name: "",
  source: "",
  mount_code: "main",
  file_path: "",
  resolution_m: null,
  notes: "",
};

const DEFAULT_APPLY_FORM: ApplyFormValues = {
  line_id: "",
  dataset_id: "",
  mode: "fill_null_only",
};

function statusTagColor(status: string): string {
  if (status === "success" || status === "active") return "green";
  if (status === "running") return "blue";
  if (status === "pending") return "orange";
  if (status === "failed" || status === "disabled") return "red";
  return "default";
}

function applyModeLabel(mode: string): string {
  if (mode === "fill_null_only") return "仅填空";
  if (mode === "overwrite_all") return "全部覆盖";
  return mode;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function AdminElevationPage() {
  const queryClient = useQueryClient();
  const { user, initializing, hasPermission, fetchWithAuth } = useAuth();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [analyzingDatasetId, setAnalyzingDatasetId] = useState<string | null>(null);
  const [datasetForm] = Form.useForm<DatasetFormValues>();
  const [applyForm] = Form.useForm<ApplyFormValues>();

  const canRead = hasPermission("elevation.read") || hasPermission("elevation.manage");
  const canManage = hasPermission("elevation.manage");

  const datasetListPath = "/api/v1/elevation/datasets";
  const jobListPath = "/api/v1/elevation/jobs?limit=100";
  const lineListPath = "/api/v1/lines";

  const datasetsQuery = useQuery({
    queryKey: [datasetListPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(datasetListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetListResponse;
    },
  });

  const jobsQuery = useQuery({
    queryKey: [jobListPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(jobListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationApplyJobListResponse;
    },
  });

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

  const refreshElevationData = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && (
          query.queryKey[0].startsWith("/api/v1/elevation/datasets")
          || query.queryKey[0].startsWith("/api/v1/elevation/jobs")
        ),
    });
  }, [queryClient]);

  const refreshPowerLines = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/lines"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.elevation",
    useCallback(() => {
      void refreshElevationData();
    }, [refreshElevationData]),
  );
  useTopicSubscription(
    "admin.power-lines",
    useCallback(() => {
      void refreshPowerLines();
    }, [refreshPowerLines]),
  );

  const datasetCreateMutation = useMutation({
    mutationFn: async (values: DatasetFormValues) => {
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        source: values.source.trim() || null,
        mount_code: values.mount_code.trim(),
        file_path: values.file_path.trim(),
        resolution_m: values.resolution_m,
        notes: values.notes.trim() || null,
      };
      const response = await fetchWithAuth("/api/v1/elevation/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetSummary;
    },
    onSuccess: async () => {
      setSuccess("高程数据集已创建");
      setError("");
      messageApi.success("高程数据集已创建");
      setDatasetModalOpen(false);
      datasetForm.resetFields();
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "创建高程数据集失败";
      setError(nextError);
      setSuccess("");
      messageApi.error(nextError);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (datasetId: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${datasetId}/analyze`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetAnalyzeResponse;
    },
    onMutate: (datasetId) => {
      setAnalyzingDatasetId(datasetId);
    },
    onSuccess: async (payload) => {
      const warnings = payload.warnings.length;
      const msg = warnings > 0 ? `分析完成（${warnings} 条告警）` : "分析完成";
      setSuccess(msg);
      setError("");
      messageApi.success(msg);
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "分析失败";
      setError(nextError);
      setSuccess("");
      messageApi.error(nextError);
    },
    onSettled: () => {
      setAnalyzingDatasetId(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (values: ApplyFormValues) => {
      const response = await fetchWithAuth("/api/v1/elevation/jobs/apply-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_id: values.line_id,
          dataset_id: values.dataset_id,
          mode: values.mode,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationApplyJobCreateResponse;
    },
    onSuccess: async () => {
      setSuccess("高程回填任务已提交");
      setError("");
      messageApi.success("高程回填任务已提交");
      setApplyModalOpen(false);
      applyForm.resetFields();
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "提交回填任务失败";
      setError(nextError);
      setSuccess("");
      messageApi.error(nextError);
    },
  });

  const datasets = datasetsQuery.data?.items ?? [];
  const jobs = jobsQuery.data?.items ?? [];
  const lines = linesQuery.data?.items ?? [];

  const lineOptions = useMemo(
    () =>
      lines.map((item: LineSummary) => ({
        value: item.id,
        label: `${item.code} - ${item.name}`,
      })),
    [lines],
  );
  const datasetOptions = useMemo(
    () =>
      datasets
        .filter((item) => item.status === "active")
        .map((item) => ({
          value: item.id,
          label: `${item.code} - ${item.name}`,
        })),
    [datasets],
  );

  const datasetColumns = useMemo<ColumnsType<ElevationDatasetSummary>>(
    () => [
      { title: "编码", dataIndex: "code", width: 140 },
      { title: "名称", dataIndex: "name", width: 220 },
      { title: "来源", dataIndex: "source", width: 140, render: (value: string | null) => value || "-" },
      { title: "挂载", dataIndex: "mount_code", width: 100 },
      { title: "文件路径", dataIndex: "file_path", width: 260 },
      { title: "分辨率(m)", dataIndex: "resolution_m", width: 110, render: (value: number | null) => value ?? "-" },
      { title: "样本数", dataIndex: "sample_count", width: 100 },
      {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: string) => <Tag color={statusTagColor(value)}>{value}</Tag>,
      },
      {
        title: "边界框",
        key: "bbox",
        width: 280,
        render: (_, row) => (
          <Typography.Text type="secondary">
            {row.bbox_min_lon ?? "-"}, {row.bbox_min_lat ?? "-"} ~ {row.bbox_max_lon ?? "-"}, {row.bbox_max_lat ?? "-"}
          </Typography.Text>
        ),
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        width: 170,
        render: (value: string) => formatDate(value),
      },
      {
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 120,
        render: (_, row) => (
          <Space size="small">
            <Typography.Link
              disabled={!canManage}
              onClick={() => {
                if (!canManage) return;
                analyzeMutation.mutate(row.id);
              }}
            >
              {analyzingDatasetId === row.id ? "分析中..." : "分析"}
            </Typography.Link>
          </Space>
        ),
      },
    ],
    [analyzeMutation, analyzingDatasetId, canManage],
  );

  const jobColumns = useMemo<ColumnsType<ElevationApplyJobSummary>>(
    () => [
      {
        title: "任务ID",
        dataIndex: "id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      { title: "线路", width: 220, render: (_, row) => `${row.line_code || "-"} ${row.line_name || ""}`.trim() || "-" },
      { title: "数据集", width: 220, render: (_, row) => `${row.dataset_code || "-"} ${row.dataset_name || ""}`.trim() || "-" },
      { title: "模式", dataIndex: "mode", width: 110, render: (value: string) => applyModeLabel(value) },
      { title: "状态", dataIndex: "status", width: 100, render: (value: string) => <Tag color={statusTagColor(value)}>{value}</Tag> },
      { title: "总杆塔", dataIndex: "total_tower_count", width: 90 },
      { title: "更新", dataIndex: "updated_tower_count", width: 80 },
      { title: "跳过", dataIndex: "skipped_tower_count", width: 80 },
      { title: "缺坐标", dataIndex: "missing_geo_count", width: 90 },
      { title: "未匹配", dataIndex: "unmatched_count", width: 90 },
      { title: "开始时间", dataIndex: "started_at", width: 170, render: (value: string | null) => formatDate(value) },
      { title: "结束时间", dataIndex: "finished_at", width: 170, render: (value: string | null) => formatDate(value) },
      {
        title: "错误",
        dataIndex: "error_message",
        width: 240,
        render: (value: string | null) => value || "-",
      },
    ],
    [],
  );

  if (initializing || datasetsQuery.isLoading || jobsQuery.isLoading || linesQuery.isLoading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <Spin tip="高程数据加载中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Typography.Text type="secondary">请先登录后再访问高程数据管理页面。</Typography.Text>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Typography.Text type="secondary">你没有访问该页面的权限（需要 `elevation.read`）。</Typography.Text>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {messageContextHolder}

      {(error || success || datasetsQuery.error || jobsQuery.error || linesQuery.error) && (
        <Alert
          type={error || datasetsQuery.error || jobsQuery.error || linesQuery.error ? "error" : "success"}
          showIcon
          message={error || (datasetsQuery.error instanceof Error ? datasetsQuery.error.message : jobsQuery.error instanceof Error ? jobsQuery.error.message : linesQuery.error instanceof Error ? linesQuery.error.message : success)}
        />
      )}

      <Card
        title="高程数据集"
        extra={(
          <Space>
            <Link href="/files">
              <Typography.Link>去文件管理上传</Typography.Link>
            </Link>
            {canManage && (
              <a
                onClick={(event) => {
                  event.preventDefault();
                  datasetForm.setFieldsValue(DEFAULT_DATASET_FORM);
                  setDatasetModalOpen(true);
                }}
              >
                新建数据集
              </a>
            )}
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          message="支持文件格式：CSV（点集）/ IMG / TIF / TIFF（栅格）"
          description="CSV 需包含经度、纬度、高程列；IMG/TIF 会按塔杆经纬度直接采样。"
          className="mb-4"
        />
        {datasets.length === 0 ? (
          <Empty description="暂无高程数据集，请先上传 CSV/IMG/TIF 并创建数据集。" />
        ) : (
          <Table<ElevationDatasetSummary>
            rowKey={(row) => row.id}
            columns={datasetColumns}
            dataSource={datasets}
            pagination={false}
            scroll={{ x: 1650 }}
          />
        )}
      </Card>

      <Card
        title="高程回填任务"
        extra={canManage ? (
          <a
            onClick={(event) => {
              event.preventDefault();
              applyForm.setFieldsValue(DEFAULT_APPLY_FORM);
              setApplyModalOpen(true);
            }}
          >
            新建回填任务
          </a>
        ) : null}
      >
        {jobs.length === 0 ? (
          <Empty description="暂无回填任务。" />
        ) : (
          <Table<ElevationApplyJobSummary>
            rowKey={(row) => row.id}
            columns={jobColumns}
            dataSource={jobs}
            pagination={false}
            scroll={{ x: 1900 }}
          />
        )}
      </Card>

      <Modal
        title="新建高程数据集"
        open={datasetModalOpen}
        onCancel={() => {
          if (datasetCreateMutation.isPending) return;
          setDatasetModalOpen(false);
        }}
        onOk={() => {
          void datasetForm.validateFields().then((values) => {
            datasetCreateMutation.mutate(values);
          });
        }}
        confirmLoading={datasetCreateMutation.isPending}
      >
        <Form<DatasetFormValues> form={datasetForm} layout="vertical" initialValues={DEFAULT_DATASET_FORM}>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: "请输入编码" }]}>
            <Input placeholder="dem_china_90m_v1" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="中国90米DEM（IMG）" />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Input placeholder="中科院地理空间数据云" />
          </Form.Item>
          <Form.Item name="mount_code" label="挂载编码" rules={[{ required: true, message: "请输入挂载编码" }]}>
            <Input placeholder="main" />
          </Form.Item>
          <Form.Item name="file_path" label="文件路径" rules={[{ required: true, message: "请输入文件路径" }]}>
            <Input placeholder="/elevation/datasets/china90m.img" />
          </Form.Item>
          <Form.Item name="resolution_m" label="分辨率（米）">
            <InputNumber className="w-full" min={1} max={10000} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="可选说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建线路高程回填任务"
        open={applyModalOpen}
        onCancel={() => {
          if (applyMutation.isPending) return;
          setApplyModalOpen(false);
        }}
        onOk={() => {
          void applyForm.validateFields().then((values) => {
            applyMutation.mutate(values);
          });
        }}
        confirmLoading={applyMutation.isPending}
      >
        <Form<ApplyFormValues> form={applyForm} layout="vertical" initialValues={DEFAULT_APPLY_FORM}>
          <Form.Item name="line_id" label="线路" rules={[{ required: true, message: "请选择线路" }]}>
            <Select showSearch options={lineOptions} optionFilterProp="label" placeholder="选择线路" />
          </Form.Item>
          <Form.Item name="dataset_id" label="高程数据集" rules={[{ required: true, message: "请选择高程数据集" }]}>
            <Select showSearch options={datasetOptions} optionFilterProp="label" placeholder="选择高程数据集" />
          </Form.Item>
          <Form.Item name="mode" label="回填模式" rules={[{ required: true, message: "请选择回填模式" }]}>
            <Select
              options={[
                { value: "fill_null_only", label: "仅填空（推荐）" },
                { value: "overwrite_all", label: "全部覆盖" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
