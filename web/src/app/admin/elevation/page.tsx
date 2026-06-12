"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App,
  Alert,
  Button,
  Descriptions,
  Dropdown,
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
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import { readLinePreparation } from "@/lib/line-preparation";
import type {
  ElevationApplyJobCreateResponse,
  ElevationApplyJobListResponse,
  ElevationApplyJobSummary,
  ElevationDataImportJobListResponse,
  ElevationDataImportJobSummary,
  ElevationDatasetAnalysisTaskStatusResponse,
  ElevationDatasetDataImportResponse,
  ElevationDatasetFileItem,
  ElevationDatasetFileListResponse,
  ElevationDatasetListResponse,
  ElevationDatasetPreviewResponse,
  ElevationDatasetSummary,
  ElevationDatasetTerrainBuildResponse,
  ElevationDatasetTerrainTaskStatusResponse,
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

function terrainStatusTagColor(status: string): string {
  if (status === "ready") return "green";
  if (status === "processing") return "blue";
  if (status === "pending") return "orange";
  if (status === "failed") return "red";
  return "default";
}

function terrainStatusLabel(status: string): string {
  if (status === "ready") return "已就绪";
  if (status === "processing") return "生成中";
  if (status === "pending") return "待生成";
  if (status === "failed") return "生成失败";
  if (status === "not_supported") return "格式不支持";
  return status || "-";
}

function terrainBuildActionLabel(status: string): string {
  if (status === "ready") return "重建地形";
  if (status === "failed") return "重试地形";
  return "生成地形";
}

function importJobStatusLabel(status: string): string {
  if (status === "pending") return "待执行";
  if (status === "running") return "执行中";
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return status || "-";
}

function importJobStageLabel(stage: string | null | undefined): string {
  if (!stage) return "-";
  if (stage === "pending") return "等待执行";
  if (stage === "staging") return "暂存文件";
  if (stage === "queued") return "等待执行";
  if (stage === "running") return "开始执行";
  if (stage === "importing") return "导入文件";
  if (stage === "finalizing") return "刷新元信息";
  if (stage === "analyzing") return "派发分析";
  if (stage === "completed") return "已完成";
  if (stage === "failed") return "失败";
  return stage;
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

function formatImportJobCounts(job: Pick<ElevationDataImportJobSummary, "uploaded_file_count" | "extracted_file_count" | "imported_file_count">): string {
  return `上传 ${job.uploaded_file_count} / 解压 ${job.extracted_file_count} / 可用 ${job.imported_file_count}`;
}

const DATASETS_TABLE_MIN_SCROLL_Y = 180;
const DATASETS_TABLE_VIEWPORT_GAP = 40;
const DATASETS_TABLE_FALLBACK_RESERVE = 220;

export default function AdminElevationPage() {
  const queryClient = useQueryClient();
  const {
    user,
    initializing,
    hasPermission,
    fetchWithAuth,
    getAccessToken,
  } = useAuth();
  const { modal } = App.useApp();
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
  const [importJobModalOpen, setImportJobModalOpen] = useState(false);
  const [importJob, setImportJob] = useState<ElevationDataImportJobSummary | null>(null);

  const [datasetFilesModalOpen, setDatasetFilesModalOpen] = useState(false);
  const [datasetFilesDataset, setDatasetFilesDataset] = useState<ElevationDatasetSummary | null>(null);
  const [datasetFiles, setDatasetFiles] = useState<ElevationDatasetFileItem[]>([]);
  const [datasetFilesLoading, setDatasetFilesLoading] = useState(false);

  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analysisDataset, setAnalysisDataset] = useState<ElevationDatasetSummary | null>(null);
  const [terrainModalOpen, setTerrainModalOpen] = useState(false);
  const [terrainDataset, setTerrainDataset] = useState<ElevationDatasetSummary | null>(null);

  const [jobsModalOpen, setJobsModalOpen] = useState(false);
  const [importJobsModalOpen, setImportJobsModalOpen] = useState(false);

  const [keywordInput, setKeywordInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [tableScrollY, setTableScrollY] = useState(DATASETS_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const [datasetForm] = Form.useForm<DatasetFormValues>();
  const [applyForm] = Form.useForm<ApplyFormValues>();
  const selectedApplyLineId = Form.useWatch("line_id", applyForm);

  const canRead = hasPermission("elevation.read") || hasPermission("elevation.manage");
  const canManage = hasPermission("elevation.manage");

  const datasetListPath = "/api/v1/elevation/datasets";
  const jobListPath = "/api/v1/elevation/jobs?limit=100";
  const importJobListPath = "/api/v1/elevation/import-jobs?limit=100";
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

  const importJobsQuery = useQuery({
    queryKey: [importJobListPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(importJobListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDataImportJobListResponse;
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
          || query.queryKey[0].startsWith("/api/v1/elevation/import-jobs")
        ),
    });
  }, [queryClient]);

  useToastFeedback({
    errorMessage:
      error
      || (datasetsQuery.error instanceof Error ? datasetsQuery.error.message : "")
      || (jobsQuery.error instanceof Error ? jobsQuery.error.message : "")
      || (importJobsQuery.error instanceof Error ? importJobsQuery.error.message : "")
      || (linesQuery.error instanceof Error ? linesQuery.error.message : ""),
    clearError: () => setError(""),
  });

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
      const formData = new FormData();
      formData.append("trigger_analysis", "true");
      for (const file of payload.files) {
        formData.append("files", file);
      }
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${payload.datasetId}/data/import`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetDataImportResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setImportJob(payload.job);
      setImportJobModalOpen(true);
      messageApi.success(payload.detail || (payload.queued ? "导入任务已提交" : "导入任务已存在"));
      setImportModalOpen(false);
      setImportFileList([]);
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "导入高程数据失败";
      setError(nextError);
      messageApi.error(nextError);
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
      messageApi.success("高程与地面倾角回填任务已提交");
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

  const terrainBuildMutation = useMutation({
    mutationFn: async (datasetId: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${datasetId}/terrain/build`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetTerrainBuildResponse;
    },
    onSuccess: async (payload) => {
      setError("");
      setTerrainDataset(payload.dataset);
      setPreviewDataset((current) => (current?.id === payload.dataset.id ? payload.dataset : current));
      messageApi.success(payload.detail || (payload.queued ? "地形瓦片任务已提交" : "地形瓦片状态已刷新"));
      await refreshElevationData();
    },
    onError: (candidate) => {
      const nextError = candidate instanceof Error ? candidate.message : "提交地形瓦片任务失败";
      setError(nextError);
      messageApi.error(nextError);
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

  const terrainStatusQuery = useQuery({
    queryKey: ["/api/v1/elevation/datasets/terrain-status", terrainDataset?.id],
    enabled: !!terrainDataset && terrainModalOpen,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/elevation/datasets/${terrainDataset?.id}/terrain/status`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ElevationDatasetTerrainTaskStatusResponse;
    },
    refetchInterval: terrainModalOpen ? 3000 : false,
    staleTime: 0,
  });

  const datasets = useMemo(() => datasetsQuery.data?.items ?? [], [datasetsQuery.data?.items]);
  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data?.items]);
  const importJobs = useMemo(() => importJobsQuery.data?.items ?? [], [importJobsQuery.data?.items]);
  const lines = useMemo(() => linesQuery.data?.items ?? [], [linesQuery.data?.items]);

  const trimmedKeyword = searchKeyword.trim().toLowerCase();
  const filteredDatasets = useMemo(() => {
    let result = datasets;

    if (trimmedKeyword) {
      result = result.filter((item) =>
        item.code.toLowerCase().includes(trimmedKeyword) ||
        item.name.toLowerCase().includes(trimmedKeyword) ||
        (item.source && item.source.toLowerCase().includes(trimmedKeyword))
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((item) => item.status === statusFilter);
    }

    return result;
  }, [datasets, trimmedKeyword, statusFilter]);

  const paginatedDatasets = useMemo(() => {
    const start = (pagination.current - 1) * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredDatasets.slice(start, end);
  }, [filteredDatasets, pagination.current, pagination.pageSize]);

  const latestImportJobByDataset = useMemo(() => {
    const mapping = new Map<string, ElevationDataImportJobSummary>();
    for (const item of importJobs) {
      if (!mapping.has(item.dataset_id)) {
        mapping.set(item.dataset_id, item);
      }
    }
    return mapping;
  }, [importJobs]);
  const currentPreviewDataset = useMemo(
    () => (previewDataset ? datasets.find((item) => item.id === previewDataset.id) ?? previewDataset : null),
    [datasets, previewDataset],
  );
  const currentAnalysisDataset = useMemo(
    () => (analysisDataset ? datasets.find((item) => item.id === analysisDataset.id) ?? analysisDataset : null),
    [analysisDataset, datasets],
  );
  const currentTerrainDataset = useMemo(
    () => (terrainDataset ? datasets.find((item) => item.id === terrainDataset.id) ?? terrainDataset : null),
    [datasets, terrainDataset],
  );
  const currentImportJob = useMemo(
    () => (importJob ? importJobs.find((item) => item.id === importJob.id) ?? importJob : null),
    [importJob, importJobs],
  );

  const lineOptions = useMemo(
    () =>
      lines.map((item: LineSummary) => ({
        value: item.id,
        label: `${item.code} - ${item.name}`,
      })),
    [lines],
  );
  const selectedApplyLine = useMemo(
    () => lines.find((item) => item.id === selectedApplyLineId) ?? null,
    [lines, selectedApplyLineId],
  );
  const selectedApplyPreparation = useMemo(() => readLinePreparation(selectedApplyLine), [selectedApplyLine]);
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
        render: (value: string, row) => {
          const colorMap: Record<string, string> = {
            queued: "orange",
            running: "processing",
            success: "green",
            failed: "red",
            not_started: "default",
          };
          return (
            <Tag
              color={colorMap[value] || "default"}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setAnalysisDataset(row);
                setAnalysisModalOpen(true);
              }}
            >
              {value}
            </Tag>
          );
        },
      },
      {
        title: "地形状态",
        dataIndex: "terrain_status",
        width: 120,
        render: (value: string, row) => (
          <Tag
            color={terrainStatusTagColor(value)}
            style={{ cursor: "pointer" }}
            onClick={() => {
              setTerrainDataset(row);
              setTerrainModalOpen(true);
            }}
          >
            {terrainStatusLabel(value)}
          </Tag>
        ),
      },
      {
        title: "地形层级",
        key: "terrainZoom",
        width: 120,
        render: (_, row) =>
          row.terrain_min_zoom !== null && row.terrain_max_zoom !== null
            ? `${row.terrain_min_zoom} - ${row.terrain_max_zoom}`
            : "-",
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
        title: "最近导入",
        key: "latestImportJob",
        width: 220,
        render: (_, row) => {
          const latestJob = latestImportJobByDataset.get(row.id);
          if (!latestJob) {
            return <Typography.Text type="secondary">-</Typography.Text>;
          }
          return (
            <Space
              direction="vertical"
              size={0}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setImportJob(latestJob);
                setImportJobModalOpen(true);
              }}
            >
              <Tag color={statusTagColor(latestJob.status)}>{importJobStatusLabel(latestJob.status)}</Tag>
              <Typography.Text type="secondary">{importJobStageLabel(latestJob.current_stage)}</Typography.Text>
              <Typography.Text type="secondary">{`${latestJob.progress_percent}%`}</Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 240,
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
              disabled={!canManage || datasetDataImportMutation.isPending}
              onClick={() => {
                if (!canManage || datasetDataImportMutation.isPending) return;
                setImportDataset(row);
                setImportFileList([]);
                setImportModalOpen(true);
              }}
            >
              导入数据
            </Typography.Link>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "files",
                    label: "文件明细",
                    onClick: () => {
                      setDatasetFilesDataset(row);
                      setDatasetFiles([]);
                      setDatasetFilesModalOpen(true);
                      setDatasetFilesLoading(true);
                      datasetFilesMutation.mutate(row.id);
                    },
                  },
                  {
                    key: "terrain",
                    label: terrainBuildActionLabel(row.terrain_status),
                    disabled:
                      !canManage
                      || terrainBuildMutation.isPending
                      || row.terrain_status === "not_supported"
                      || row.status !== "active",
                    onClick: () => {
                      if (
                        !canManage
                        || terrainBuildMutation.isPending
                        || row.terrain_status === "not_supported"
                        || row.status !== "active"
                      ) {
                        return;
                      }
                      setTerrainDataset(row);
                      setTerrainModalOpen(true);
                      terrainBuildMutation.mutate(row.id);
                    },
                  },
                ],
              }}
            >
              <Typography.Link>更多</Typography.Link>
            </Dropdown>
            <Typography.Link
              disabled={!canManage || datasetDeleteMutation.isPending}
              onClick={() => {
                if (!canManage || datasetDeleteMutation.isPending) return;
                modal.confirm({
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
      latestImportJobByDataset,
      messageApi,
      modal,
      terrainBuildMutation,
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

  const importJobColumns = useMemo<ColumnsType<ElevationDataImportJobSummary>>(
    () => [
      {
        title: "任务ID",
        dataIndex: "id",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "数据集",
        width: 220,
        render: (_, row) => `${row.dataset_code || "-"} ${row.dataset_name || ""}`.trim() || "-",
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 100,
        render: (value: string) => <Tag color={statusTagColor(value)}>{importJobStatusLabel(value)}</Tag>,
      },
      {
        title: "阶段",
        dataIndex: "current_stage",
        width: 120,
        render: (value: string | null) => importJobStageLabel(value),
      },
      {
        title: "进度",
        dataIndex: "progress_percent",
        width: 180,
        render: (value: number) => <Progress percent={value} size="small" />,
      },
      {
        title: "计数",
        width: 180,
        render: (_, row) => formatImportJobCounts(row),
      },
      {
        title: "分析任务",
        width: 180,
        render: (_, row) => row.analysis_task_id || "-",
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        width: 170,
        render: (value: string) => formatDate(value),
      },
      {
        title: "说明",
        dataIndex: "detail_message",
        width: 260,
        render: (value: string | null) => value || "-",
      },
      {
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 90,
        render: (_, row) => (
          <Typography.Link
            onClick={() => {
              setImportJob(row);
              setImportJobModalOpen(true);
            }}
          >
            查看
          </Typography.Link>
        ),
      },
    ],
    [],
  );

  const handleSearch = () => {
    setSearchKeyword(keywordInput);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleResetSearch = () => {
    setKeywordInput("");
    setSearchKeyword("");
    setStatusFilter("all");
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - DATASETS_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? DATASETS_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - DATASETS_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(DATASETS_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [error, pagination.current, pagination.pageSize, paginatedDatasets.length, datasetsQuery.isFetching, updateTableScrollY]);

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

  if (initializing || datasetsQuery.isLoading || jobsQuery.isLoading || importJobsQuery.isLoading || linesQuery.isLoading) {
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

  const datasetTableScrollX = 2520;

  return (
    <div className="space-y-6">
      {messageContextHolder}

      <Card
        title="高程数据集"
        extra={(
          <Space>
            {datasetsQuery.isFetching && <Spin size="small" />}
            <Button
              onClick={() => setJobsModalOpen(true)}
            >
              高程回填任务
            </Button>
            <Button
              onClick={() => setImportJobsModalOpen(true)}
            >
              高程导入任务
            </Button>
            {canManage && (
              <Button
                type="primary"
                onClick={(event) => {
                  event.preventDefault();
                  datasetForm.setFieldsValue(DEFAULT_DATASET_FORM);
                  setDatasetModalOpen(true);
                }}
              >
                新建数据集
              </Button>
            )}
          </Space>
        )}
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[240px]">
            <Input
              allowClear
              placeholder="按编码/名称/来源搜索"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={handleSearch}
            />
          </Form.Item>

          <Form.Item label="状态" className="min-w-[170px]">
            <Select<"all" | "active" | "disabled">
              value={statusFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "active", label: "启用" },
                { value: "disabled", label: "禁用" },
              ]}
              onChange={(value) => {
                setStatusFilter(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
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

        <div
          ref={tableScrollAnchorRef}
          className="admin-datasets-table-anchor mt-4"
          style={{ "--admin-datasets-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<ElevationDatasetSummary>
            rowKey={(row) => row.id}
            columns={datasetColumns}
            dataSource={paginatedDatasets}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: filteredDatasets.length,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              style: { marginBottom: 0 },
              onChange: (page, pageSize) => {
                setPagination({ current: page, pageSize });
              },
            }}
            scroll={{ x: 2520, y: tableScrollY }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到符合筛选条件的数据集。"
                />
              ),
            }}
          />
        </div>
      </Card>

      <Modal
        title="高程回填任务"
        open={jobsModalOpen}
        width={1200}
        footer={null}
        onCancel={() => setJobsModalOpen(false)}
      >
        <div className="space-y-3">
          {canManage && (
            <div className="mb-4">
              <Button
                type="primary"
                onClick={() => {
                  applyForm.setFieldsValue(DEFAULT_APPLY_FORM);
                  setApplyModalOpen(true);
                }}
              >
                新建回填任务
              </Button>
            </div>
          )}
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
        </div>
      </Modal>

      <Modal
        title="高程导入任务"
        open={importJobsModalOpen}
        width={1200}
        footer={null}
        onCancel={() => setImportJobsModalOpen(false)}
      >
        <div className="space-y-3">
          {importJobs.length === 0 ? (
            <Empty description="暂无导入任务。" />
          ) : (
            <Table<ElevationDataImportJobSummary>
              rowKey={(row) => row.id}
              columns={importJobColumns}
              dataSource={importJobs}
              pagination={false}
              scroll={{ x: 1600 }}
            />
          )}
        </div>
      </Modal>

      <Modal
        title={currentPreviewDataset ? `高程预览：${currentPreviewDataset.code}` : "高程预览"}
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
        {currentPreviewDataset && (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message={`数据集：${currentPreviewDataset.name}（${currentPreviewDataset.file_format.toUpperCase()}）`}
              description={previewData
                ? `预览模式：${previewData.preview_mode === "terrain_grid" ? "地形网格" : "点云"}；总样本 ${previewData.total_points}，当前展示 ${previewData.sampled_points}；地形状态 ${terrainStatusLabel(currentPreviewDataset.terrain_status)}。`
                : `正在加载预览数据... 当前地形状态：${terrainStatusLabel(currentPreviewDataset.terrain_status)}。`}
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
              dataset={currentPreviewDataset}
              accessToken={getAccessToken()}
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
          <Alert
            type="info"
            showIcon
            message="导入任务会在后台异步执行"
            description="提交后可在“高程导入任务”列表或数据集行的“导入进度”里回看处理进度、告警和分析任务状态。"
          />
        </div>
      </Modal>

      <Modal
        title={currentImportJob ? `导入进度：${currentImportJob.dataset_code || currentImportJob.id}` : "导入进度"}
        open={importJobModalOpen}
        footer={null}
        onCancel={() => {
          setImportJobModalOpen(false);
          setImportJob(null);
        }}
      >
        {currentImportJob && (
          <div className="space-y-3">
            <Alert
              type={
                currentImportJob.status === "failed"
                  ? "error"
                  : currentImportJob.status === "success"
                    ? "success"
                    : "info"
              }
              showIcon
              message={`${currentImportJob.dataset_code || "-"} ${currentImportJob.dataset_name || ""}`.trim()}
              description={currentImportJob.detail_message || "导入任务已创建。"}
            />
            <Progress percent={currentImportJob.progress_percent} />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="任务状态">
                <Tag color={statusTagColor(currentImportJob.status)}>{importJobStatusLabel(currentImportJob.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="当前阶段">{importJobStageLabel(currentImportJob.current_stage)}</Descriptions.Item>
              <Descriptions.Item label="Task ID">{currentImportJob.task_id || "-"}</Descriptions.Item>
              <Descriptions.Item label="文件计数">{formatImportJobCounts(currentImportJob)}</Descriptions.Item>
              <Descriptions.Item label="分析任务">{currentImportJob.analysis_task_id || "-"}</Descriptions.Item>
              <Descriptions.Item label="开始时间">{formatDate(currentImportJob.started_at)}</Descriptions.Item>
              <Descriptions.Item label="结束时间">{formatDate(currentImportJob.finished_at)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDate(currentImportJob.update_date)}</Descriptions.Item>
            </Descriptions>
            {currentImportJob.warning_count > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`导入告警（${currentImportJob.warning_count}）`}
                description={currentImportJob.warnings.slice(0, 5).join("；")}
              />
            )}
            {currentImportJob.imported_files.length > 0 && (
              <Alert
                type="success"
                showIcon
                message={`已导入文件（${currentImportJob.imported_files.length}）`}
                description={currentImportJob.imported_files.slice(0, 5).join("；")}
              />
            )}
          </div>
        )}
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
        title={currentAnalysisDataset ? `分析进度：${currentAnalysisDataset.code}` : "分析进度"}
        open={analysisModalOpen}
        footer={null}
        onCancel={() => {
          setAnalysisModalOpen(false);
          setAnalysisDataset(null);
        }}
      >
        {currentAnalysisDataset && (
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
        title={currentTerrainDataset ? `地形状态：${currentTerrainDataset.code}` : "地形状态"}
        open={terrainModalOpen}
        footer={null}
        onCancel={() => {
          setTerrainModalOpen(false);
          setTerrainDataset(null);
        }}
      >
        {currentTerrainDataset && (
          <div className="space-y-3">
            <Alert
              type={
                currentTerrainDataset.terrain_status === "failed"
                  ? "error"
                  : currentTerrainDataset.terrain_status === "ready"
                    ? "success"
                    : "info"
              }
              showIcon
              message={`数据集：${currentTerrainDataset.name}`}
              description={currentTerrainDataset.terrain_error_message || `当前地形状态：${terrainStatusLabel(currentTerrainDataset.terrain_status)}`}
            />
            <Space wrap>
              <Button
                type="primary"
                disabled={
                  !canManage
                  || terrainBuildMutation.isPending
                  || currentTerrainDataset.terrain_status === "not_supported"
                  || currentTerrainDataset.status !== "active"
                }
                loading={terrainBuildMutation.isPending}
                onClick={() => {
                  terrainBuildMutation.mutate(currentTerrainDataset.id);
                }}
              >
                {terrainBuildActionLabel(currentTerrainDataset.terrain_status)}
              </Button>
              <Button
                onClick={() => {
                  void terrainStatusQuery.refetch();
                }}
              >
                刷新状态
              </Button>
            </Space>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="地形状态">
                <Tag color={terrainStatusTagColor(currentTerrainDataset.terrain_status)}>
                  {terrainStatusLabel(currentTerrainDataset.terrain_status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="任务状态">
                <Tag color={statusTagColor(terrainStatusQuery.data?.status || "default")}>
                  {terrainStatusQuery.data?.status || "-"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Task ID">{terrainStatusQuery.data?.task_id || currentTerrainDataset.terrain_task_id || "-"}</Descriptions.Item>
              <Descriptions.Item label="地形层级">
                {terrainStatusQuery.data?.terrain_min_zoom ?? currentTerrainDataset.terrain_min_zoom ?? "-"}
                {" ~ "}
                {terrainStatusQuery.data?.terrain_max_zoom ?? currentTerrainDataset.terrain_max_zoom ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label="地形模板">
                {terrainStatusQuery.data?.terrain_url_template || currentTerrainDataset.terrain_url_template || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {formatDate(terrainStatusQuery.data?.update_date || currentTerrainDataset.update_date)}
              </Descriptions.Item>
            </Descriptions>
            {terrainStatusQuery.isLoading ? (
              <div className="flex min-h-[120px] items-center justify-center">
                <Spin tip="地形状态加载中..." />
              </div>
            ) : terrainStatusQuery.error ? (
              <Alert
                type="error"
                showIcon
                message={terrainStatusQuery.error instanceof Error ? terrainStatusQuery.error.message : "地形状态加载失败"}
              />
            ) : terrainStatusQuery.data?.detail ? (
              <Alert
                type={terrainStatusQuery.data.status === "failed" ? "error" : "info"}
                showIcon
                message={terrainStatusQuery.data.detail}
              />
            ) : null}
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
          {selectedApplyLine ? (
            <Alert
              type={selectedApplyPreparation.ground_slope.ready ? "success" : "info"}
              showIcon
              className="mb-4"
              message={selectedApplyPreparation.ground_slope.ready ? "该线路已具备地面倾角准备记录" : "本次任务会同时补高程与地面倾角"}
              description={
                <Space size={[8, 8]} wrap>
                  {[
                    selectedApplyPreparation.lightning_current,
                    selectedApplyPreparation.lightning_density,
                    selectedApplyPreparation.ground_slope,
                  ].map((item) => (
                    <Tag key={item.key} color={item.ready ? "green" : "red"}>
                      {`${item.label} ${item.tower_ready_count}/${item.tower_total_count}`}
                    </Tag>
                  ))}
                </Space>
              }
            />
          ) : null}
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
