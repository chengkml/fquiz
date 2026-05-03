"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { ElevationPreviewCesiumMap } from "@/components/elevation-preview-cesium-map";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { getApiBaseUrl, readApiError } from "@/lib/api";
import type {
  ElevationApplyJobCreateResponse,
  ElevationApplyJobListResponse,
  ElevationApplyJobSummary,
  ElevationDatasetAnalysisTaskStatusResponse,
  ElevationDatasetDataImportResponse,
  ElevationDatasetFileItem,
  ElevationDatasetFileListResponse,
  ElevationDatasetListResponse,
  ElevationDatasetPreviewResponse,
  ElevationDatasetSummary,
  LineListResponse,
  LineSummary,
} from "@/types/auth";

type DatasetFormValues = {
  code: string;
  name: string;
  source: string;
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatNumber(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function readXhrError(xhr: XMLHttpRequest): string {
  const fallback = `HTTP ${xhr.status}`;
  const raw = xhr.responseText?.trim();
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: string };
    return parsed.detail?.trim() ? parsed.detail : fallback;
  } catch {
    return raw.length > 200 ? fallback : raw;
  }
}

export default function AdminElevationPage() {
  const queryClient = useQueryClient();
  const {
    user,
    initializing,
    hasPermission,
    fetchWithAuth,
    getAccessToken,
    refreshAccessToken,
  } = useAuth();
  const [messageApi, messageContextHolder] = message.useMessage();

  const [error, setError] = useState("");
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewDataset, setPreviewDataset] = useState<ElevationDatasetSummary | null>(null);
  const [previewData, setPreviewData] = useState<ElevationDatasetPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importDataset, setImportDataset] = useState<ElevationDatasetSummary | null>(null);
  const [importFileList, setImportFileList] = useState<UploadFile[]>([]);
  const [datasetDataUploadProgress, setDatasetDataUploadProgress] = useState(0);
  const [datasetDataUploadFileName, setDatasetDataUploadFileName] = useState("");
  const [lastImportedFiles, setLastImportedFiles] = useState<string[]>([]);
  const [lastAnalysisTaskId, setLastAnalysisTaskId] = useState<string | null>(null);

  const [datasetFilesModalOpen, setDatasetFilesModalOpen] = useState(false);
  const [datasetFilesDataset, setDatasetFilesDataset] = useState<ElevationDatasetSummary | null>(null);
  const [datasetFiles, setDatasetFiles] = useState<ElevationDatasetFileItem[]>([]);
  const [datasetFilesLoading, setDatasetFilesLoading] = useState(false);

  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisDataset, setAnalysisDataset] = useState<ElevationDatasetSummary | null>(null);

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
        mount_code: null,
        file_name: null,
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
      setError("");
      messageApi.success("高程数据集已创建");
      setDatasetModalOpen(false);
      datasetForm.resetFields();
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "创建高程数据集失败";
      setError(nextError);
      messageApi.error(nextError);
    },
  });

  const datasetDataImportMutation = useMutation({
    mutationFn: async (payload: { datasetId: string; files: File[] }) => {
      setDatasetDataUploadProgress(0);
      setDatasetDataUploadFileName(
        payload.files.length === 1 ? payload.files[0].name : `共 ${payload.files.length} 个文件`,
      );

      const uploadWithXhr = (token: string | null) =>
        new Promise<ElevationDatasetDataImportResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${getApiBaseUrl()}/api/v1/elevation/datasets/${payload.datasetId}/data/import`);
          xhr.withCredentials = true;
          if (token) {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          }

          xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
            if (!event.lengthComputable || event.total <= 0) {
              return;
            }
            const percent = Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100)));
            setDatasetDataUploadProgress(percent);
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setDatasetDataUploadProgress(100);
              try {
                resolve(JSON.parse(xhr.responseText) as ElevationDatasetDataImportResponse);
              } catch {
                reject(new Error("上传成功但响应解析失败"));
              }
              return;
            }
            reject(new Error(readXhrError(xhr)));
          };

          xhr.onerror = () => reject(new Error("网络异常，导入失败"));
          xhr.onabort = () => reject(new Error("导入已取消"));

          const formData = new FormData();
          for (const file of payload.files) {
            formData.append("files", file);
          }
          xhr.send(formData);
        });

      let result: ElevationDatasetDataImportResponse;
      try {
        result = await uploadWithXhr(getAccessToken());
      } catch (error) {
        const message = error instanceof Error ? error.message : "导入失败";
        const isUnauthorized = message.includes("401") || message.includes("未授权");
        if (!isUnauthorized) {
          throw error;
        }
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          throw error;
        }
        result = await uploadWithXhr(getAccessToken());
      }
      return result;
    },
    onSuccess: async (payload) => {
      const monitorHint = payload.analysis_task_id ? `，分析任务ID：${payload.analysis_task_id}` : "";
      const msg = payload.warning_count > 0
        ? `数据导入完成：上传 ${payload.uploaded_file_count} 个、解压 ${payload.extracted_file_count} 个、可用 ${payload.imported_file_count} 个，告警 ${payload.warning_count} 条${monitorHint}`
        : `数据导入完成：上传 ${payload.uploaded_file_count} 个、解压 ${payload.extracted_file_count} 个、可用 ${payload.imported_file_count} 个${monitorHint}`;
      setError("");
      messageApi.success(msg);
      setLastImportedFiles(payload.imported_files);
      setLastAnalysisTaskId(payload.analysis_task_id);
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "导入高程数据失败";
      setError(nextError);
      messageApi.error(nextError);
      setDatasetDataUploadProgress(0);
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
      setError("");
      messageApi.success("高程回填任务已提交");
      setApplyModalOpen(false);
      applyForm.resetFields();
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "提交回填任务失败";
      setError(nextError);
      messageApi.error(nextError);
    },
  });

  const datasetDeleteMutation = useMutation({
    mutationFn: async (datasetId: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${datasetId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: async () => {
      setError("");
      messageApi.success("高程数据集已删除");
      setPreviewModalOpen(false);
      setPreviewDataset(null);
      setPreviewData(null);
      setPreviewLoading(false);
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "删除高程数据集失败";
      setError(nextError);
      messageApi.error(nextError);
    },
  });

  const datasetFilesMutation = useMutation({
    mutationFn: async (datasetId: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${datasetId}/files`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetFileListResponse;
    },
    onSuccess: (payload) => {
      setDatasetFiles(payload.items);
      setDatasetFilesLoading(false);
      setError("");
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "加载文件明细失败";
      setError(nextError);
      messageApi.error(nextError);
      setDatasetFiles([]);
      setDatasetFilesLoading(false);
    },
  });

  const analysisStatusQuery = useQuery({
    queryKey: ["/api/v1/elevation/datasets/analysis-task", analysisDataset?.id],
    enabled: !!analysisDataset,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${analysisDataset?.id}/analysis-task`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetAnalysisTaskStatusResponse;
    },
    refetchInterval: analysisModalOpen ? 3000 : false,
    staleTime: 0,
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

  const fileColumns = useMemo<ColumnsType<ElevationDatasetFileItem>>(
    () => [
      { title: "文件名", dataIndex: "name", width: 260 },
      { title: "路径", dataIndex: "path", width: 420 },
      {
        title: "大小",
        dataIndex: "size",
        width: 120,
        render: (value: number) => formatFileSize(value),
      },
      {
        title: "修改时间",
        dataIndex: "modified_at",
        width: 180,
        render: (value: string | null) => formatDate(value),
      },
      {
        title: "类型",
        dataIndex: "mime_type",
        width: 160,
        render: (value: string | null) => value || "-",
      },
    ],
    [],
  );

  const datasetColumns = useMemo<ColumnsType<ElevationDatasetSummary>>(
    () => [
      { title: "编码", dataIndex: "code", width: 140 },
      { title: "名称", dataIndex: "name", width: 220 },
      { title: "来源", dataIndex: "source", width: 140, render: (value: string | null) => value || "-" },
      { title: "挂载", dataIndex: "mount_code", width: 100 },
      { title: "数据集目录", dataIndex: "dataset_dir", width: 220 },
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
        title: "分析状态",
        dataIndex: "analysis_status",
        width: 120,
        render: (value: string) => {
          const colorMap: Record<string, string> = {
            queued: "orange",
            running: "processing",
            success: "green",
            failed: "red",
            not_started: "default",
          };
          return <Tag color={colorMap[value] || "default"}>{value}</Tag>;
        },
      },
      {
        title: "使用状态",
        dataIndex: "usage_status",
        width: 100,
        render: (value: string) => <Tag color={value === "in_use" ? "processing" : "default"}>{value}</Tag>,
      },
      {
        title: "边界框",
        key: "bbox",
        width: 320,
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
        width: 280,
        render: (_, row) => (
          <Space size="small" wrap>
            <Typography.Link
              onClick={() => {
                setPreviewDataset(row);
                setPreviewData(null);
                setPreviewModalOpen(true);
                setPreviewLoading(true);
                void fetchWithAuth(`/api/v1/elevation/datasets/${row.id}/preview?max_points=1500`)
                  .then(async (response) => {
                    if (!response.ok) {
                      throw new Error(await readApiError(response));
                    }
                    return (await response.json()) as ElevationDatasetPreviewResponse;
                  })
                  .then((payload) => {
                    setPreviewData(payload);
                    setError("");
                  })
                  .catch((candidate) => {
                    const nextError = candidate instanceof Error ? candidate.message : "加载预览失败";
                    setError(nextError);
                    messageApi.error(nextError);
                  })
                  .finally(() => {
                    setPreviewLoading(false);
                  });
              }}
            >
              预览
            </Typography.Link>
            <Typography.Link
              onClick={() => {
                setDatasetFilesDataset(row);
                setDatasetFiles([]);
                setDatasetFilesModalOpen(true);
                setDatasetFilesLoading(true);
                datasetFilesMutation.mutate(row.id);
              }}
            >
              文件明细
            </Typography.Link>
            <Typography.Link
              onClick={() => {
                setAnalysisDataset(row);
                setAnalysisModalOpen(true);
              }}
            >
              分析进度
            </Typography.Link>
            <Typography.Link
              disabled={!canManage || datasetDataImportMutation.isPending}
              onClick={() => {
                if (!canManage || datasetDataImportMutation.isPending) return;
                setImportDataset(row);
                setImportFileList([]);
                setDatasetDataUploadProgress(0);
                setDatasetDataUploadFileName("");
                setLastImportedFiles([]);
                setLastAnalysisTaskId(null);
                setImportModalOpen(true);
              }}
            >
              导入数据
            </Typography.Link>
            <Typography.Link
              disabled={!canManage || datasetDeleteMutation.isPending}
              onClick={() => {
                if (!canManage || datasetDeleteMutation.isPending) return;
                Modal.confirm({
                  title: "删除高程数据集",
                  content: `确认删除数据集「${row.code} - ${row.name}」？该操作会同时删除关联的回填任务记录，且不可恢复。`,
                  okText: "确认删除",
                  okButtonProps: { danger: true, loading: datasetDeleteMutation.isPending },
                  cancelText: "取消",
                  onOk: async () => {
                    await datasetDeleteMutation.mutateAsync(row.id);
                  },
                });
              }}
            >
              删除
            </Typography.Link>
          </Space>
        ),
      },
    ],
    [
      canManage,
      datasetDataImportMutation,
      datasetDeleteMutation,
      datasetFilesMutation,
      fetchWithAuth,
      messageApi,
    ],
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

  const datasetTableScrollX = 2200;

  return (
    <div className="space-y-6">
      {messageContextHolder}

      {(error || datasetsQuery.error || jobsQuery.error || linesQuery.error) && (
        <Alert
          type="error"
          showIcon
          message={error || (datasetsQuery.error instanceof Error
            ? datasetsQuery.error.message
            : jobsQuery.error instanceof Error
              ? jobsQuery.error.message
              : linesQuery.error instanceof Error
                ? linesQuery.error.message
                : "加载失败")}
        />
      )}

      <Card
        title="高程数据集"
        extra={(
          <Space>
            {canManage && (
              <>
                <a
                  onClick={(event) => {
                    event.preventDefault();
                    datasetForm.setFieldsValue(DEFAULT_DATASET_FORM);
                    setDatasetModalOpen(true);
                  }}
                >
                  新建数据集
                </a>
              </>
            )}
          </Space>
        )}
      >
        {datasets.length === 0 ? (
          <Empty description="暂无高程数据集，请先上传 CSV/IMG/TIF 并创建数据集。" />
        ) : (
          <Table<ElevationDatasetSummary>
            rowKey={(row) => row.id}
            columns={datasetColumns}
            dataSource={datasets}
            pagination={false}
            scroll={{ x: datasetTableScrollX }}
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
        title={previewDataset ? `高程预览：${previewDataset.code}` : "高程预览"}
        open={previewModalOpen}
        width={1040}
        footer={null}
        onCancel={() => {
          setPreviewModalOpen(false);
          setPreviewDataset(null);
          setPreviewData(null);
          setPreviewLoading(false);
        }}
      >
        {previewDataset && (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message={`数据集：${previewDataset.name}（${previewDataset.file_format.toUpperCase()}）`}
              description={previewData
                ? `预览模式：${previewData.preview_mode === "terrain_grid" ? "地形网格" : "点云"}；总样本 ${previewData.total_points}，当前展示 ${previewData.sampled_points}。`
                : "正在加载预览数据..."}
            />
            {previewData && previewData.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`预览告警（${previewData.warnings.length}）`}
                description={previewData.warnings.slice(0, 3).join("；")}
              />
            )}
            {previewData?.diagnostics && (
              <Card size="2" title="诊断信息">
                <Descriptions bordered size="small" column={1} styles={{ label: { width: 230 } }}>
                  <Descriptions.Item label="源数据 CRS">{previewData.diagnostics.source_crs || "-"}</Descriptions.Item>
                  <Descriptions.Item label="源范围 (minX,maxX,minY,maxY)">
                    {formatNumber(previewData.diagnostics.source_bounds_min_x, 3)}
                    {", "}
                    {formatNumber(previewData.diagnostics.source_bounds_max_x, 3)}
                    {", "}
                    {formatNumber(previewData.diagnostics.source_bounds_min_y, 3)}
                    {", "}
                    {formatNumber(previewData.diagnostics.source_bounds_max_y, 3)}
                  </Descriptions.Item>
                  <Descriptions.Item label="WGS84范围 (minLon,maxLon,minLat,maxLat)">
                    {formatNumber(previewData.diagnostics.wgs84_bounds_min_lon, 6)}
                    {", "}
                    {formatNumber(previewData.diagnostics.wgs84_bounds_max_lon, 6)}
                    {", "}
                    {formatNumber(previewData.diagnostics.wgs84_bounds_min_lat, 6)}
                    {", "}
                    {formatNumber(previewData.diagnostics.wgs84_bounds_max_lat, 6)}
                  </Descriptions.Item>
                  <Descriptions.Item label="栅格尺寸 (宽 x 高)">
                    {previewData.diagnostics.raster_width ?? "-"}
                    {" x "}
                    {previewData.diagnostics.raster_height ?? "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="目标采样数 / 步长">
                    {previewData.diagnostics.target_samples ?? "-"}
                    {" / "}
                    {previewData.diagnostics.sampling_step ?? "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="扫描候选点 / 有效网格">
                    {previewData.diagnostics.scanned_candidates ?? "-"}
                    {" / "}
                    {previewData.diagnostics.valid_preview_count ?? "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="跳过统计 (read_err/masked/nodata/nonfinite)">
                    {previewData.diagnostics.skip_read_error}
                    {" / "}
                    {previewData.diagnostics.skip_masked}
                    {" / "}
                    {previewData.diagnostics.skip_nodata}
                    {" / "}
                    {previewData.diagnostics.skip_nonfinite}
                  </Descriptions.Item>
                  <Descriptions.Item label="跳过统计 (sample_tx_err/sample_range)">
                    {previewData.diagnostics.skip_sample_transform_error}
                    {" / "}
                    {previewData.diagnostics.skip_sample_out_of_range}
                  </Descriptions.Item>
                  <Descriptions.Item label="sample_tx_err 首条异常">
                    {previewData.diagnostics.sample_tx_first_error || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="跳过统计 (cell_tx_err/cell_range)">
                    {previewData.diagnostics.skip_cell_transform_error}
                    {" / "}
                    {previewData.diagnostics.skip_cell_out_of_range}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            )}
            <ElevationPreviewCesiumMap
              points={previewData?.points ?? []}
              cells={previewData?.cells ?? []}
              loading={previewLoading}
            />
          </div>
        )}
      </Modal>

      <Modal
        title="导入高程数据"
        open={importModalOpen}
        onCancel={() => {
          if (datasetDataImportMutation.isPending) return;
          setImportModalOpen(false);
          setImportDataset(null);
          setImportFileList([]);
          setDatasetDataUploadProgress(0);
          setDatasetDataUploadFileName("");
          setLastImportedFiles([]);
          setLastAnalysisTaskId(null);
        }}
        onOk={() => {
          if (!importDataset || datasetDataImportMutation.isPending) return;
          const files = importFileList
            .map((item) => item.originFileObj)
            .filter((item): item is NonNullable<typeof item> => !!item);
          if (files.length === 0) {
            messageApi.warning("请先选择至少一个文件");
            return;
          }
          datasetDataImportMutation.mutate({ datasetId: importDataset.id, files });
        }}
        confirmLoading={datasetDataImportMutation.isPending}
        okText={datasetDataImportMutation.isPending ? "导入中" : "开始导入"}
        cancelText="取消"
      >
        <div className="space-y-3">
          <Alert
            type="info"
            showIcon
            message="支持文件格式：CSV（点集）/ IMG / TIF / TIFF（栅格）/ ZIP（解压后 csv/img/tif）"
            description="先新建数据集，再使用“导入数据”上传多个高程文件。数据集目录自动固定为 /elevation/datasets/{数据集编码}，导入完成后自动触发分析。"
          />
          {importDataset && (
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="数据集">{`${importDataset.code} - ${importDataset.name}`}</Descriptions.Item>
              <Descriptions.Item label="目录">{importDataset.dataset_dir}</Descriptions.Item>
            </Descriptions>
          )}
          <Upload
            multiple
            fileList={importFileList}
            beforeUpload={() => false}
            onChange={({ fileList: nextFileList }) => {
              setImportFileList(nextFileList);
            }}
            accept=".csv,.img,.tif,.tiff,.zip"
            disabled={datasetDataImportMutation.isPending}
          >
            <Typography.Link>选择文件（支持多选）</Typography.Link>
          </Upload>

          {(datasetDataImportMutation.isPending || datasetDataUploadProgress > 0) && (
            <div className="space-y-2">
              <Typography.Text type="secondary">
                {datasetDataUploadFileName || "正在上传文件..."}
              </Typography.Text>
              <Progress
                percent={datasetDataUploadProgress}
                status={datasetDataUploadProgress >= 100 ? "active" : "normal"}
              />
            </div>
          )}

          {lastImportedFiles.length > 0 && (
            <Alert
              type="success"
              showIcon
              message={`已导入文件（${lastImportedFiles.length}）`}
              description={lastImportedFiles.slice(0, 5).join("；")}
            />
          )}

          {lastAnalysisTaskId && (
            <Alert
              type="info"
              showIcon
              message="分析任务已触发"
              description={`Task ID: ${lastAnalysisTaskId}，可点击数据集行「分析进度」查看实时状态。`}
            />
          )}
        </div>
      </Modal>

      <Modal
        title={datasetFilesDataset ? `文件明细：${datasetFilesDataset.code}` : "文件明细"}
        open={datasetFilesModalOpen}
        footer={null}
        width={1040}
        onCancel={() => {
          setDatasetFilesModalOpen(false);
          setDatasetFilesDataset(null);
          setDatasetFiles([]);
          setDatasetFilesLoading(false);
        }}
      >
        {datasetFilesDataset && (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message={`目录：${datasetFilesDataset.dataset_dir}`}
              description={`挂载：${datasetFilesDataset.mount_code}`}
            />
            {datasetFilesLoading ? (
              <div className="flex min-h-[180px] items-center justify-center">
                <Spin tip="文件明细加载中..." />
              </div>
            ) : datasetFiles.length === 0 ? (
              <Empty description="当前目录暂无文件。" />
            ) : (
              <Table<ElevationDatasetFileItem>
                rowKey={(row) => row.path}
                columns={fileColumns}
                dataSource={datasetFiles}
                pagination={false}
                scroll={{ x: 1000 }}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={analysisDataset ? `分析进度：${analysisDataset.code}` : "分析进度"}
        open={analysisModalOpen}
        footer={null}
        onCancel={() => {
          setAnalysisModalOpen(false);
          setAnalysisDataset(null);
        }}
      >
        {analysisDataset && (
          <div className="space-y-3">
            {analysisStatusQuery.isLoading ? (
              <div className="flex min-h-[180px] items-center justify-center">
                <Spin tip="分析状态加载中..." />
              </div>
            ) : analysisStatusQuery.error ? (
              <Alert
                type="error"
                showIcon
                message={analysisStatusQuery.error instanceof Error ? analysisStatusQuery.error.message : "分析状态加载失败"}
              />
            ) : (
              <>
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="任务状态">
                    <Tag color={statusTagColor(analysisStatusQuery.data?.status || "default")}>
                      {analysisStatusQuery.data?.status || "-"}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Task ID">{analysisStatusQuery.data?.task_id || "-"}</Descriptions.Item>
                  <Descriptions.Item label="开始时间">{formatDate(analysisStatusQuery.data?.started_at)}</Descriptions.Item>
                  <Descriptions.Item label="结束时间">{formatDate(analysisStatusQuery.data?.finished_at)}</Descriptions.Item>
                  <Descriptions.Item label="更新时间">{formatDate(analysisStatusQuery.data?.update_date)}</Descriptions.Item>
                </Descriptions>
                {analysisStatusQuery.data?.detail && (
                  <Alert
                    type={analysisStatusQuery.data.status === "failed" ? "error" : "info"}
                    showIcon
                    message={analysisStatusQuery.data.detail}
                  />
                )}
              </>
            )}
          </div>
        )}
      </Modal>

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
          <Alert
            type="info"
            showIcon
            className="mb-4"
            message="数据目录自动生成"
            description="创建后目录自动固定为 /elevation/datasets/{编码}。请在列表里使用“导入数据”上传 csv/img/tif/tiff/zip。"
          />
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
