"use client";

import { useEffect, useMemo, useState } from "react";
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
import { readApiError } from "@/lib/api";
import { readLinePreparation } from "@/lib/line-preparation";
import type {
  AtpEngineStatusResponse,
  AtpModelListResponse,
  AtpModelSummary,
  AtpModelVersionListResponse,
  AtpModelVersionSummary,
  FlAnalysisJobDetail,
  FlAnalysisJobListResponse,
  FlAnalysisJobSummary,
  FlAnalysisTowerResultListResponse,
  FlAnalysisTowerResultSummary,
  LineListResponse,
  LineSummary,
} from "@/types/auth";

type CreateJobFormValues = {
  job_name: string;
  line_id: string;
  job_type: "normal" | "tongtiao" | "risk";
  external_adapter: "placeholder" | "wine" | "atp";
  atp_model_id: string;
  atp_version_id: string;
  current_waveform: "heidler" | "double_slope" | "double_exponential";
  flashover_method: "guideline" | "intersection" | "leader_development";
  altitude_correction: "none" | "formula1" | "formula2";
  induced_voltage_formula: "formula1" | "formula2";
  head_time_min_us: number;
  head_time_max_us: number;
  head_time_step_us: number;
  tail_time_min_us: number;
  tail_time_max_us: number;
  tail_time_step_us: number;
};

type MitigationFormValues = {
  job_name: string;
  non_construction: boolean;
};

type ReportFormValues = {
  job_name: string;
};

type ReasonDetail = {
  code: string;
  label: string;
  value?: unknown;
  standard_value?: unknown;
  grade?: number | null;
  triggered?: boolean;
};

type MitigationAction = {
  code: string;
  label: string;
  summary: string;
  current_value?: unknown;
  target_value?: unknown;
  unit?: string;
  phases?: string[];
};

type WorkflowRange = {
  min?: number | null;
  max?: number | null;
  step?: number | null;
};

type WorkflowSummary = {
  current_waveform?: string;
  flashover_method?: string;
  altitude_correction?: string;
  induced_voltage_formula?: string;
  head_time_range_us?: WorkflowRange;
  tail_time_range_us?: WorkflowRange;
  scan_point_count?: number;
};

type ScanPoint = {
  head_time_us?: number | null;
  tail_time_us?: number | null;
  risk_level?: string | null;
  score?: number | null;
  counterstrike_withstand_ka?: number | null;
  counterstrike_trip_rate?: number | null;
  shielding_withstand_ka?: number | null;
  shielding_trip_rate?: number | null;
  flashover_phase?: string | null;
  dominant_phase_set?: string | null;
};

type SelectedCase = {
  head_time_us?: number | null;
  tail_time_us?: number | null;
  risk_level?: string | null;
  score?: number | null;
  flashover_phase?: string | null;
  dominant_phase_set?: string | null;
};

type PhaseResult = {
  phase: string;
  circuit?: string | null;
  shielding_withstand_ka?: number | null;
  shielding_trip_rate?: number | null;
  counterstrike_withstand_ka?: number | null;
  counterstrike_trip_rate?: number | null;
};

type MultiPhaseResult = {
  phase_count: number;
  label: string;
  flashover_phase?: string | null;
  counterstrike_withstand_ka?: number | null;
  trip_rate?: number | null;
};

const CREATE_JOB_DEFAULTS: CreateJobFormValues = {
  job_name: "",
  line_id: "",
  job_type: "normal",
  external_adapter: "placeholder",
  atp_model_id: "",
  atp_version_id: "",
  current_waveform: "heidler",
  flashover_method: "intersection",
  altitude_correction: "none",
  induced_voltage_formula: "formula1",
  head_time_min_us: 2.6,
  head_time_max_us: 2.6,
  head_time_step_us: 0.1,
  tail_time_min_us: 50,
  tail_time_max_us: 50,
  tail_time_step_us: 1,
};

function formatRiskLevel(value: string | null | undefined): string {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return value || "-";
}

function formatJobType(jobType: string, nonConstruction = false): string {
  if (jobType === "risk") return "风险评估";
  if (jobType === "mitigation") return nonConstruction ? "措施推荐(非建线)" : "措施推荐";
  if (jobType === "normal") return "普通计算";
  if (jobType === "tongtiao") return "同跳计算";
  if (jobType === "report") return "报告";
  if (jobType === "scenario") return "场景分析";
  return jobType || "-";
}

function formatCurrentWaveform(value: string | null | undefined): string {
  if (value === "heidler") return "Heidler";
  if (value === "double_slope") return "双斜角";
  if (value === "double_exponential") return "双指数";
  return value || "-";
}

function formatFlashoverMethod(value: string | null | undefined): string {
  if (value === "guideline") return "规程法";
  if (value === "intersection") return "相交法";
  if (value === "leader_development") return "先导发展法";
  return value || "-";
}

function formatAltitudeCorrection(value: string | null | undefined): string {
  if (value === "none") return "无";
  if (value === "formula1") return "推荐公式1";
  if (value === "formula2") return "推荐公式2";
  return value || "-";
}

function formatInducedVoltageFormula(value: string | null | undefined): string {
  if (value === "formula1") return "公式1";
  if (value === "formula2") return "公式2";
  return value || "-";
}

function formatExternalAdapter(value: string | null | undefined): string {
  if (value === "wine") return "Wine / ATP";
  if (value === "atp") return "原生 ATP";
  if (value === "placeholder") return "规则近似";
  if (value === "custom") return "自定义";
  return value || "-";
}

function riskColor(value: string | null | undefined): string {
  if (value === "high") return "red";
  if (value === "medium") return "orange";
  if (value === "low") return "green";
  return "default";
}

function statusColor(value: string | null | undefined): string {
  if (value === "success") return "green";
  if (value === "failed" || value === "blocked") return "red";
  if (value === "running") return "blue";
  if (value === "queued") return "cyan";
  return "default";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function readObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "-";
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function preparationColor(ready: boolean): string {
  return ready ? "green" : "red";
}

function readDownloadFilename(headerValue: string | null, fallback: string): string {
  if (!headerValue) {
    return fallback;
  }
  const utf8Matched = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Matched?.[1]) {
    try {
      return decodeURIComponent(utf8Matched[1]);
    } catch {
      return utf8Matched[1];
    }
  }
  const matched = /filename="?([^"]+)"?/i.exec(headerValue);
  return matched?.[1] ?? fallback;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readReasonDetails(row: FlAnalysisTowerResultSummary | null): ReasonDetail[] {
  const value = row ? readObject(row.result_json).reason_details : null;
  return readArray<ReasonDetail>(value);
}

function readMitigationActions(row: FlAnalysisTowerResultSummary | null): MitigationAction[] {
  const value = row ? readObject(row.result_json).mitigation_actions : null;
  return readArray<MitigationAction>(value);
}

function readWorkflow(row: FlAnalysisTowerResultSummary | null): WorkflowSummary {
  return readObject(row ? readObject(row.result_json).workflow : null) as WorkflowSummary;
}

function readSelectedCase(row: FlAnalysisTowerResultSummary | null): SelectedCase {
  return readObject(row ? readObject(row.result_json).selected_case : null) as SelectedCase;
}

function readScanPoints(row: FlAnalysisTowerResultSummary | null): ScanPoint[] {
  return readArray<ScanPoint>(row ? readObject(row.result_json).scan_points : null);
}

function readPhaseResults(row: FlAnalysisTowerResultSummary | null): PhaseResult[] {
  return readArray<PhaseResult>(row ? readObject(row.result_json).phase_results : null);
}

function readMultiPhaseResults(row: FlAnalysisTowerResultSummary | null): MultiPhaseResult[] {
  return readArray<MultiPhaseResult>(row ? readObject(row.result_json).multi_phase_results : null);
}

function readCurrentRisk(row: FlAnalysisTowerResultSummary): string | null {
  const value = readObject(row.result_json).current_risk_level;
  return typeof value === "string" ? value : null;
}

function readCurrentScore(row: FlAnalysisTowerResultSummary): number | null {
  const value = readObject(row.result_json).current_score;
  return typeof value === "number" ? value : null;
}

function mitigationMode(job: FlAnalysisJobDetail | FlAnalysisJobSummary | null): boolean {
  if (!job) {
    return false;
  }
  const options = readObject(job.execution_options_json);
  return Boolean(options.non_construction);
}

function selectedTowerCount(job: FlAnalysisJobDetail | null): number {
  if (!job) {
    return 0;
  }
  const value = readObject(job.execution_options_json).selected_tower_ids;
  return Array.isArray(value) ? value.length : 0;
}

function formatRangeSummary(range: WorkflowRange | undefined): string {
  if (!range) {
    return "-";
  }
  const min = typeof range.min === "number" ? range.min : null;
  const max = typeof range.max === "number" ? range.max : null;
  const step = typeof range.step === "number" ? range.step : null;
  if (min === null || max === null || step === null) {
    return "-";
  }
  return `${min} ~ ${max} / 步长 ${step}`;
}

export default function AdminFlAnalysisPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<FlAnalysisTowerResultSummary | null>(null);
  const [mitigationModalOpen, setMitigationModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedMitigationTowerIds, setSelectedMitigationTowerIds] = useState<string[]>([]);
  const [selectedReportTowerIds, setSelectedReportTowerIds] = useState<string[]>([]);
  const [createJobForm] = Form.useForm<CreateJobFormValues>();
  const [mitigationForm] = Form.useForm<MitigationFormValues>();
  const [reportForm] = Form.useForm<ReportFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const selectedLineId = Form.useWatch("line_id", createJobForm);
  const selectedCreateJobType = Form.useWatch("job_type", createJobForm) ?? CREATE_JOB_DEFAULTS.job_type;
  const selectedExternalAdapter = Form.useWatch("external_adapter", createJobForm) ?? CREATE_JOB_DEFAULTS.external_adapter;
  const selectedAtpModelId = Form.useWatch("atp_model_id", createJobForm) ?? "";

  const canRead = hasPermission("line.read") || hasPermission("line.manage");
  const canManage = hasPermission("line.manage") || hasPermission("tower.manage");
  const canReadAtp = hasPermission("atp.read") || hasPermission("atp.run") || hasPermission("atp.manage");

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

  const jobsQuery = useQuery({
    queryKey: ["/api/v1/fl-analysis/jobs"],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/fl-analysis/jobs?limit=100");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FlAnalysisJobListResponse;
    },
  });

  const engineQuery = useQuery({
    queryKey: ["/api/v1/atp/models/engine/status"],
    enabled: !!user && canReadAtp,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/atp/models/engine/status");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpEngineStatusResponse;
    },
    staleTime: 30_000,
  });

  const atpModelsQuery = useQuery({
    queryKey: ["/api/v1/atp/models", "enabled"],
    enabled: !!user && canReadAtp,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/atp/models?status=enabled");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpModelListResponse;
    },
  });

  const atpVersionsQuery = useQuery({
    queryKey: ["/api/v1/atp/models/versions", selectedAtpModelId],
    enabled: !!user && canReadAtp && !!selectedAtpModelId,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/models/${selectedAtpModelId}/versions?limit=200&offset=0`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpModelVersionListResponse;
    },
  });

  const selectedJob = useMemo(() => {
    if (!selectedJobId) {
      return jobsQuery.data?.items[0] ?? null;
    }
    return jobsQuery.data?.items.find((item) => item.id === selectedJobId) ?? null;
  }, [jobsQuery.data?.items, selectedJobId]);

  const selectedJobDetailQuery = useQuery({
    queryKey: ["/api/v1/fl-analysis/jobs/detail", selectedJob?.id ?? ""],
    enabled: !!user && canRead && !!selectedJob?.id,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${selectedJob?.id}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FlAnalysisJobDetail;
    },
  });

  const towerResultsQuery = useQuery({
    queryKey: ["/api/v1/fl-analysis/jobs/results", selectedJob?.id ?? ""],
    enabled: !!user && canRead && !!selectedJob?.id,
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${selectedJob?.id}/results`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FlAnalysisTowerResultListResponse;
    },
  });

  const candidateMitigationRows = useMemo(
    () => (towerResultsQuery.data?.items ?? []).filter((item) => item.risk_level !== "low"),
    [towerResultsQuery.data?.items],
  );

  const candidateReportRows = useMemo(() => {
    const rows = towerResultsQuery.data?.items ?? [];
    if (selectedJob?.job_type === "mitigation") {
      return rows;
    }
    return rows.filter((item) => item.risk_level !== "low");
  }, [selectedJob?.job_type, towerResultsQuery.data?.items]);

  const atpModels = useMemo(() => atpModelsQuery.data?.items ?? [], [atpModelsQuery.data]);
  const selectedAtpModel = useMemo(
    () => atpModels.find((item) => item.id === selectedAtpModelId) ?? null,
    [atpModels, selectedAtpModelId],
  );

  useEffect(() => {
    const firstLine = linesQuery.data?.items[0];
    if (firstLine && !createJobForm.getFieldValue("line_id")) {
      createJobForm.setFieldsValue({ line_id: firstLine.id });
    }
  }, [createJobForm, linesQuery.data?.items]);

  useEffect(() => {
    if (!["normal", "tongtiao"].includes(selectedCreateJobType)) {
      return;
    }
    if (!["atp", "wine"].includes(selectedExternalAdapter)) {
      return;
    }
    if (!atpModels.length || createJobForm.getFieldValue("atp_model_id")) {
      return;
    }
    createJobForm.setFieldValue("atp_model_id", atpModels[0].id);
  }, [atpModels, createJobForm, selectedCreateJobType, selectedExternalAdapter]);

  useEffect(() => {
    if (!["atp", "wine"].includes(selectedExternalAdapter)) {
      return;
    }
    const versions = atpVersionsQuery.data?.items ?? [];
    if (!versions.length) {
      return;
    }
    const currentVersionId = createJobForm.getFieldValue("atp_version_id");
    if (currentVersionId && versions.some((item) => item.id === currentVersionId)) {
      return;
    }
    const preferredVersion =
      versions.find((item) => item.version_no === selectedAtpModel?.active_version_no)
      ?? versions[0];
    createJobForm.setFieldValue("atp_version_id", preferredVersion.id);
  }, [atpVersionsQuery.data?.items, createJobForm, selectedAtpModel?.active_version_no, selectedExternalAdapter]);

  async function invalidateFlAnalysisQueries(): Promise<void> {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/fl-analysis"),
    });
  }

  async function createAndStartJob(payload: Record<string, unknown>): Promise<FlAnalysisJobDetail> {
    const createResponse = await fetchWithAuth("/api/v1/fl-analysis/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!createResponse.ok) {
      throw new Error(await readApiError(createResponse));
    }
    const created = (await createResponse.json()) as { job: FlAnalysisJobDetail };

    const startResponse = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${created.job.id}/start`, {
      method: "POST",
    });
    if (!startResponse.ok) {
      throw new Error(await readApiError(startResponse));
    }
    const started = (await startResponse.json()) as { job: FlAnalysisJobDetail };
    return started.job;
  }

  function openMitigationJobModal(): void {
    if (!selectedJob) {
      return;
    }
    const baseName = selectedJob.job_name || selectedJob.line_name || selectedJob.line_code || "防雷任务";
    setSelectedMitigationTowerIds(candidateMitigationRows.map((item) => item.tower_id));
    mitigationForm.setFieldsValue({
      job_name: `${baseName}-措施推荐`,
      non_construction: false,
    });
    setMitigationModalOpen(true);
  }

  function openReportJobModal(): void {
    if (!selectedJob) {
      return;
    }
    const baseName = selectedJob.job_name || selectedJob.line_name || selectedJob.line_code || "防雷任务";
    setSelectedReportTowerIds(candidateReportRows.map((item) => item.tower_id));
    reportForm.setFieldsValue({
      job_name: `${baseName}-报告`,
    });
    setReportModalOpen(true);
  }

  function buildCreateJobPayload(values: CreateJobFormValues): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      line_id: values.line_id,
      job_name: values.job_name.trim() || null,
      job_type: values.job_type,
      external_adapter: values.job_type === "normal" || values.job_type === "tongtiao"
        ? values.external_adapter
        : "placeholder",
    };
    if (values.job_type === "normal" || values.job_type === "tongtiao") {
      payload.execution_options_json = {
        current_waveform: values.current_waveform,
        flashover_method: values.flashover_method,
        altitude_correction: values.altitude_correction,
        induced_voltage_formula: values.induced_voltage_formula,
        head_time_min_us: values.head_time_min_us,
        head_time_max_us: values.head_time_max_us,
        head_time_step_us: values.head_time_step_us,
        tail_time_min_us: values.tail_time_min_us,
        tail_time_max_us: values.tail_time_max_us,
        tail_time_step_us: values.tail_time_step_us,
      };
      if (values.external_adapter !== "placeholder") {
        payload.adapter_config_json = {
          model_id: values.atp_model_id,
          version_id: values.atp_version_id || undefined,
        };
      }
    }
    return payload;
  }

  const createJobMutation = useMutation({
    mutationFn: async (values: CreateJobFormValues) => createAndStartJob(buildCreateJobPayload(values)),
    onSuccess: async (job) => {
      await invalidateFlAnalysisQueries();
      setSelectedJobId(job.id);
      messageApi.success(`${formatJobType(job.job_type, mitigationMode(job))}任务已创建并启动`);
      createJobForm.setFieldsValue({ job_name: "" });
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "分析任务创建失败");
    },
  });

  const startJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${jobId}/start`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as { job: FlAnalysisJobDetail };
    },
    onSuccess: async () => {
      await invalidateFlAnalysisQueries();
      messageApi.success("任务已启动");
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "任务启动失败");
    },
  });

  const createMitigationMutation = useMutation({
    mutationFn: async (values: MitigationFormValues) => {
      if (!selectedJob) {
        throw new Error("缺少前驱风险任务");
      }
      if (selectedJob.job_type !== "risk") {
        throw new Error("仅风险评估任务可生成措施推荐");
      }
      if (selectedMitigationTowerIds.length === 0) {
        throw new Error("请至少选择一座高风险杆塔");
      }
      return createAndStartJob({
        line_id: selectedJob.line_id,
        job_name: values.job_name.trim() || null,
        job_type: "mitigation",
        external_adapter: "placeholder",
        execution_options_json: {
          source_job_id: selectedJob.id,
          selected_tower_ids: selectedMitigationTowerIds,
          non_construction: values.non_construction,
        },
      });
    },
    onSuccess: async (job) => {
      await invalidateFlAnalysisQueries();
      setMitigationModalOpen(false);
      setSelectedJobId(job.id);
      messageApi.success("措施推荐任务已创建并启动");
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "措施推荐任务创建失败");
    },
  });

  const createReportMutation = useMutation({
    mutationFn: async (values: ReportFormValues) => {
      if (!selectedJob) {
        throw new Error("缺少报告来源任务");
      }
      if (!["risk", "mitigation"].includes(selectedJob.job_type)) {
        throw new Error("仅风险评估或措施推荐任务可生成报告");
      }
      if (selectedReportTowerIds.length === 0) {
        throw new Error("请至少选择一座纳入报告的杆塔");
      }
      return createAndStartJob({
        line_id: selectedJob.line_id,
        job_name: values.job_name.trim() || null,
        job_type: "report",
        external_adapter: "placeholder",
        execution_options_json: {
          source_job_id: selectedJob.id,
          selected_tower_ids: selectedReportTowerIds,
        },
      });
    },
    onSuccess: async (job) => {
      await invalidateFlAnalysisQueries();
      setReportModalOpen(false);
      setSelectedJobId(job.id);
      messageApi.success("报告任务已创建并启动");
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "报告任务创建失败");
    },
  });

  const downloadReportMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${jobId}/report/download`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const blob = await response.blob();
      const filename = readDownloadFilename(
        response.headers.get("content-disposition"),
        "防雷报告.doc",
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    },
    onSuccess: () => {
      messageApi.success("报告下载成功");
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "报告下载失败");
    },
  });

  const downloadResultsMutation = useMutation({
    mutationFn: async ({ jobId, runId, jobType }: { jobId: string; runId?: string | null; jobType: string }) => {
      const params = new URLSearchParams();
      if (runId) {
        params.set("run_id", runId);
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const response = await fetchWithAuth(`/api/v1/fl-analysis/jobs/${jobId}/results/download${suffix}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const blob = await response.blob();
      const filename = readDownloadFilename(
        response.headers.get("content-disposition"),
        `防雷分析-${jobType}-结果.csv`,
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    },
    onSuccess: () => {
      messageApi.success("结果导出成功");
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "结果导出失败");
    },
  });

  const resultColumns = useMemo<ColumnsType<FlAnalysisTowerResultSummary>>(() => {
    const columns: ColumnsType<FlAnalysisTowerResultSummary> = [
      {
        title: "序号",
        dataIndex: "seq_no",
        width: 80,
      },
      {
        title: "杆塔号",
        dataIndex: "tower_no",
        width: 120,
      },
      {
        title: "塔型",
        dataIndex: "tower_type",
        width: 100,
        render: (value: string | null) => value || "-",
      },
    ];

    if (selectedJob?.job_type === "mitigation") {
      columns.push(
        {
          title: "当前风险",
          key: "current_risk_level",
          width: 110,
          render: (_value, row) => <Tag color={riskColor(readCurrentRisk(row))}>{formatRiskLevel(readCurrentRisk(row))}</Tag>,
        },
        {
          title: "预期风险",
          dataIndex: "risk_level",
          width: 110,
          render: (value: string | null) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
        },
      );
    } else {
      columns.push({
        title: "风险等级",
        dataIndex: "risk_level",
        width: 120,
        render: (value: string | null) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
      });
    }

    if (selectedJob?.job_type === "normal" || selectedJob?.job_type === "tongtiao") {
      columns.push(
        {
          title: "最不利点(μs)",
          key: "selected_case",
          width: 160,
          render: (_value, row) => {
            const selectedCase = readSelectedCase(row);
            const head = selectedCase.head_time_us;
            const tail = selectedCase.tail_time_us;
            if (typeof head !== "number" || typeof tail !== "number") {
              return "-";
            }
            return `${head}/${tail}`;
          },
        },
      );
    }

    if (selectedJob?.job_type === "normal") {
      columns.push(
        {
          title: "反击耐雷水平(kA)",
          key: "counterstrike_withstand_ka",
          width: 140,
          render: (_value, row) => readOptionalNumber(readObject(row.result_json), "counterstrike_withstand_ka") ?? "-",
        },
        {
          title: "反击跳闸率",
          key: "counterstrike_trip_rate",
          width: 120,
          render: (_value, row) => readOptionalNumber(readObject(row.result_json), "counterstrike_trip_rate") ?? "-",
        },
        {
          title: "绕击耐雷水平(kA)",
          key: "shielding_withstand_ka",
          width: 140,
          render: (_value, row) => readOptionalNumber(readObject(row.result_json), "shielding_withstand_ka") ?? "-",
        },
        {
          title: "绕击跳闸率",
          key: "shielding_trip_rate",
          width: 120,
          render: (_value, row) => readOptionalNumber(readObject(row.result_json), "shielding_trip_rate") ?? "-",
        },
      );
    }

    if (selectedJob?.job_type === "tongtiao") {
      columns.push(
        {
          title: "主导相组",
          key: "dominant_phase_set",
          width: 120,
          render: (_value, row) => readOptionalString(readObject(row.result_json), "dominant_phase_set") ?? "-",
        },
        {
          title: "闪络相",
          key: "flashover_phase",
          width: 160,
          render: (_value, row) => readOptionalString(readObject(row.result_json), "flashover_phase") ?? "-",
        },
        {
          title: "同跳跳闸率",
          key: "counterstrike_trip_rate",
          width: 120,
          render: (_value, row) => readOptionalNumber(readObject(row.result_json), "counterstrike_trip_rate") ?? "-",
        },
      );
    }

    columns.push(
      {
        title: "综合结论",
        dataIndex: "summary_text",
        ellipsis: true,
      },
      {
        title: "高风险原因",
        key: "cause_analysis",
        ellipsis: true,
        render: (_value, row) => readString(readObject(row.result_json), "cause_analysis"),
      },
      {
        title: "措施建议",
        key: "mitigation_recommendation",
        ellipsis: true,
        render: (_value, row) => readString(readObject(row.result_json), "mitigation_recommendation"),
      },
    );

    if (selectedJob?.job_type === "mitigation") {
      columns.push(
        {
          title: "改造结论",
          key: "recommendation_result",
          width: 140,
          render: (_value, row) => readString(readObject(row.result_json), "recommendation_result"),
        },
        {
          title: "当前得分",
          key: "current_score",
          width: 100,
          render: (_value, row) => {
            const value = readCurrentScore(row);
            return value === null ? "-" : String(value);
          },
        },
      );
    }

    columns.push(
      {
        title: "得分",
        key: "score",
        width: 90,
        render: (_value, row) => {
          const value = readObject(row.result_json).score;
          return typeof value === "number" ? value : "-";
        },
      },
      {
        title: "详情",
        key: "actions",
        width: 110,
        render: (_value, row) => (
          <Button
            size="small"
            onClick={() => {
              setDetailRow(row);
              setDetailModalOpen(true);
            }}
          >
            查看详情
          </Button>
        ),
      },
    );

    return columns;
  }, [selectedJob?.job_type]);

  const reasonDetailColumns: ColumnsType<ReasonDetail> = [
    { title: "因子", dataIndex: "label", width: 180 },
    {
      title: "当前值",
      key: "value",
      render: (_value, row) => (row.value === undefined || row.value === null ? "-" : String(row.value)),
    },
    {
      title: "标准值",
      key: "standard_value",
      render: (_value, row) => (row.standard_value === undefined || row.standard_value === null ? "-" : String(row.standard_value)),
    },
    {
      title: "档次",
      dataIndex: "grade",
      width: 90,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "是否命中",
      dataIndex: "triggered",
      width: 100,
      render: (value: boolean | undefined) => (value ? <Tag color="red">是</Tag> : <Tag>否</Tag>),
    },
  ];

  const mitigationActionColumns: ColumnsType<MitigationAction> = [
    { title: "动作", dataIndex: "label", width: 160 },
    { title: "建议", dataIndex: "summary" },
    {
      title: "当前值",
      key: "current_value",
      render: (_value, row) => (row.current_value === undefined || row.current_value === null ? "-" : String(row.current_value)),
      width: 100,
    },
    {
      title: "目标值",
      key: "target_value",
      render: (_value, row) => (row.target_value === undefined || row.target_value === null ? "-" : String(row.target_value)),
      width: 100,
    },
  ];

  const scanPointColumns: ColumnsType<ScanPoint> = [
    { title: "波头(μs)", dataIndex: "head_time_us", width: 100, render: (value: number | null | undefined) => value ?? "-" },
    { title: "波尾(μs)", dataIndex: "tail_time_us", width: 100, render: (value: number | null | undefined) => value ?? "-" },
    {
      title: "风险",
      dataIndex: "risk_level",
      width: 100,
      render: (value: string | null | undefined) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
    },
    { title: "得分", dataIndex: "score", width: 90, render: (value: number | null | undefined) => value ?? "-" },
    {
      title: "反击跳闸率",
      dataIndex: "counterstrike_trip_rate",
      width: 120,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "绕击跳闸率",
      dataIndex: "shielding_trip_rate",
      width: 120,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "闪络相",
      dataIndex: "flashover_phase",
      width: 160,
      render: (value: string | null | undefined) => value || "-",
    },
  ];

  const phaseResultColumns: ColumnsType<PhaseResult> = [
    { title: "相别", dataIndex: "phase", width: 120 },
    { title: "回路", dataIndex: "circuit", width: 90, render: (value: string | null | undefined) => value || "-" },
    {
      title: "A/B/C绕击耐雷水平(kA)",
      dataIndex: "shielding_withstand_ka",
      width: 180,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "A/B/C绕击跳闸率",
      dataIndex: "shielding_trip_rate",
      width: 140,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "反击耐雷水平(kA)",
      dataIndex: "counterstrike_withstand_ka",
      width: 140,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "反击跳闸率",
      dataIndex: "counterstrike_trip_rate",
      width: 120,
      render: (value: number | null | undefined) => value ?? "-",
    },
  ];

  const multiPhaseColumns: ColumnsType<MultiPhaseResult> = [
    { title: "相数组合", dataIndex: "label", width: 100 },
    { title: "闪络相", dataIndex: "flashover_phase", render: (value: string | null | undefined) => value || "-" },
    {
      title: "反击耐雷水平(kA)",
      dataIndex: "counterstrike_withstand_ka",
      width: 140,
      render: (value: number | null | undefined) => value ?? "-",
    },
    {
      title: "跳闸率",
      dataIndex: "trip_rate",
      width: 120,
      render: (value: number | null | undefined) => value ?? "-",
    },
  ];

  const selectedLine = useMemo(() => {
    return linesQuery.data?.items.find((item) => item.id === selectedLineId) ?? null;
  }, [linesQuery.data?.items, selectedLineId]);
  const selectedLinePreparation = useMemo(() => readLinePreparation(selectedLine), [selectedLine]);
  const externalAdapterActive = selectedExternalAdapter === "atp" || selectedExternalAdapter === "wine";
  const engineMode = engineQuery.data?.mode;
  const adapterOptions = [
    {
      value: "placeholder",
      label: "规则近似(占位)",
      disabled: false,
    },
    {
      value: "atp",
      label: "原生 ATP",
      disabled: !canReadAtp || engineMode === "wine" || engineQuery.data?.available === false,
    },
    {
      value: "wine",
      label: "Wine / ATP",
      disabled: !canReadAtp || engineMode === "native" || engineQuery.data?.available === false,
    },
  ] as const;
  const workflowExecutionMessage = externalAdapterActive
    ? engineQuery.data?.available
      ? `当前将通过 ${formatExternalAdapter(selectedExternalAdapter)} 链路执行 ATP 模型，并把外部结果回填到任务明细。`
      : `当前已选择 ${formatExternalAdapter(selectedExternalAdapter)}，但 ATP 引擎不可用：${engineQuery.data?.error || "请先检查执行器配置" }`
    : `当前按 ${formatJobType(selectedCreateJobType)} 口径生成规则近似版结果；切换到 ATP/Wine 适配器后会走真实外部执行链路。`;

  if (!initializing && !user) {
    return <Alert type="warning" showIcon message="请先登录后查看防雷分析结果。" />;
  }

  if (!initializing && !canRead) {
    return <Alert type="error" showIcon message="当前账号缺少线路读取权限，无法查看防雷分析与改造任务。" />;
  }

  const selectedJobDetail = selectedJobDetailQuery.data ?? null;
  const detailResultObject = readObject(detailRow?.result_json);
  const reasonDetails = readReasonDetails(detailRow);
  const mitigationActions = readMitigationActions(detailRow);
  const scanPoints = readScanPoints(detailRow);
  const phaseResults = readPhaseResults(detailRow);
  const multiPhaseResults = readMultiPhaseResults(detailRow);
  const detailWorkflow = readWorkflow(detailRow);
  const detailSelectedCase = readSelectedCase(detailRow);
  const selectedJobExecutionOptions = readObject(selectedJobDetail?.execution_options_json);
  const selectedJobSummary = readObject(selectedJobDetail?.result_summary_json);
  const selectedJobWorkflow = readObject(selectedJobDetail?.result_summary_json).workflow as WorkflowSummary | undefined;
  const selectedJobExternalModelCode = readOptionalString(selectedJobSummary, "external_model_code");
  const selectedJobExternalModelName = readOptionalString(selectedJobSummary, "external_model_name");
  const selectedJobExternalVersionNo = readOptionalNumber(selectedJobSummary, "external_version_no");
  const detailExternalExecution = readObject(detailResultObject.external_execution);
  const sourceJobId = readOptionalString(selectedJobExecutionOptions, "source_job_id");
  const canCreateMitigation = selectedJob?.job_type === "risk";
  const canCreateReport = selectedJob?.job_type === "risk" || selectedJob?.job_type === "mitigation";
  const reportSourceJobType = readOptionalString(selectedJobSummary, "source_job_type");
  const reportSourceJobName = readOptionalString(selectedJobSummary, "source_job_name");
  const reportMitigationJobName = readOptionalString(selectedJobSummary, "mitigation_job_name");
  const reportDocumentName = readOptionalString(selectedJobSummary, "document_filename");
  const canDownloadResults = selectedJob?.job_type !== "report"
    && selectedJob?.status === "success"
    && (towerResultsQuery.data?.items.length ?? 0) > 0;

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} className="flex w-full">
        <Card>
          <Space direction="vertical" size={12} className="flex w-full">
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                防雷分析与改造
              </Typography.Title>
              <Typography.Text type="secondary">
                支持源端“普通计算 / 同跳计算 / 风险评估 / 措施推荐 / 报告生成”工作流。普通计算和同跳计算可按 ATP/Wine 外部链路执行，也可退回规则近似版；报告任务可基于风险或措施结果直接导出 Word 兼容文档。
              </Typography.Text>
            </div>

            {jobsQuery.error ? (
              <Alert type="error" showIcon message={jobsQuery.error instanceof Error ? jobsQuery.error.message : "任务列表加载失败"} />
            ) : null}

            {canManage ? (
              <Form<CreateJobFormValues>
                form={createJobForm}
                layout="vertical"
                initialValues={CREATE_JOB_DEFAULTS}
                onFinish={(values) => {
                  createJobMutation.mutate(values);
                }}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Form.Item
                    name="line_id"
                    label="线路"
                    rules={[{ required: true, message: "请选择线路" }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="选择线路"
                      loading={linesQuery.isLoading}
                      options={(linesQuery.data?.items ?? []).map((item: LineSummary) => ({
                        value: item.id,
                        label: `${item.name || item.code} / ${item.code}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="job_type" label="任务类型" rules={[{ required: true, message: "请选择任务类型" }]}>
                    <Select
                      options={[
                        { value: "normal", label: "普通计算" },
                        { value: "tongtiao", label: "同跳计算" },
                        { value: "risk", label: "风险评估" },
                      ]}
                    />
                  </Form.Item>
                  {selectedCreateJobType === "normal" || selectedCreateJobType === "tongtiao" ? (
                    <Form.Item
                      name="external_adapter"
                      label="执行适配器"
                      rules={[{ required: true, message: "请选择执行适配器" }]}
                    >
                      <Select options={adapterOptions.map((item) => ({ ...item }))} />
                    </Form.Item>
                  ) : null}
                  <Form.Item name="job_name" label="任务名">
                    <Input
                      placeholder={selectedLine
                        ? `${selectedLine.name || selectedLine.code}-${formatJobType(selectedCreateJobType)}`
                        : `${formatJobType(selectedCreateJobType)}任务`}
                    />
                  </Form.Item>
                  <Form.Item label=" ">
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={createJobMutation.isPending}
                      disabled={!selectedLine || !selectedLinePreparation.all_ready}
                      className="w-full"
                    >
                      创建并启动{formatJobType(selectedCreateJobType)}任务
                    </Button>
                  </Form.Item>
                </div>

                {selectedLine ? (
                  <Alert
                    type={selectedLinePreparation.all_ready ? "success" : "warning"}
                    showIcon
                    message={selectedLinePreparation.all_ready ? "参数准备已完成" : `当前线路缺少：${selectedLinePreparation.missing_items.join("、")}`}
                    description={
                      <Space size={[8, 8]} wrap>
                        {[
                          selectedLinePreparation.lightning_current,
                          selectedLinePreparation.lightning_density,
                          selectedLinePreparation.ground_slope,
                        ].map((item) => {
                          const source = readObject(item.source);
                          const preparedAt = readOptionalString(source, "prepared_at");
                          const currentA = readOptionalNumber(readObject(item.values), "current_a");
                          const currentB = readOptionalNumber(readObject(item.values), "current_b");
                          const suffix = item.key === "lightning_current" && currentA !== null && currentB !== null
                            ? ` (${currentA.toFixed(3)} / ${currentB.toFixed(3)})`
                            : "";
                          return (
                            <Tag key={item.key} color={preparationColor(item.ready)}>
                              {`${item.label}${suffix} ${item.tower_ready_count}/${item.tower_total_count}${preparedAt ? ` @ ${formatDateTime(preparedAt)}` : ""}`}
                            </Tag>
                          );
                        })}
                      </Space>
                    }
                  />
                ) : null}

                {selectedCreateJobType === "normal" || selectedCreateJobType === "tongtiao" ? (
                  <>
                    <Alert
                      type={externalAdapterActive && engineQuery.data?.available === false ? "warning" : "info"}
                      showIcon
                      message={workflowExecutionMessage}
                    />
                    {atpModelsQuery.error && externalAdapterActive ? (
                      <Alert
                        type="error"
                        showIcon
                        message={atpModelsQuery.error instanceof Error ? atpModelsQuery.error.message : "ATP 模型列表加载失败"}
                      />
                    ) : null}
                    {externalAdapterActive ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Form.Item
                          name="atp_model_id"
                          label="ATP模型"
                          rules={[{ required: true, message: "请选择 ATP 模型" }]}
                        >
                          <Select
                            showSearch
                            optionFilterProp="label"
                            loading={atpModelsQuery.isLoading}
                            placeholder="选择 ATP 模型"
                            options={atpModels.map((item: AtpModelSummary) => ({
                              value: item.id,
                              label: `${item.name} / ${item.code}`,
                            }))}
                          />
                        </Form.Item>
                        <Form.Item
                          name="atp_version_id"
                          label="模型版本"
                          rules={[{ required: true, message: "请选择模型版本" }]}
                        >
                          <Select
                            showSearch
                            optionFilterProp="label"
                            loading={atpVersionsQuery.isLoading}
                            placeholder="选择模型版本"
                            options={(atpVersionsQuery.data?.items ?? []).map((item: AtpModelVersionSummary) => ({
                              value: item.id,
                              label: `v${item.version_no}${item.version_tag ? ` / ${item.version_tag}` : ""}`,
                            }))}
                          />
                        </Form.Item>
                        <Alert
                          type="info"
                          showIcon
                          message={`执行模式：${engineQuery.data ? formatExternalAdapter(engineQuery.data.mode === "wine" ? "wine" : "atp") : "-"}`}
                          description={selectedAtpModel ? `当前模型：${selectedAtpModel.name} / ${selectedAtpModel.code}` : "从 ATP 模型管理中选择已发布模板版本。"}
                          className="md:col-span-2"
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-4">
                      <Form.Item name="current_waveform" label="雷电流波形">
                        <Select
                          options={[
                            { value: "heidler", label: "Heidler" },
                            { value: "double_slope", label: "双斜角" },
                            { value: "double_exponential", label: "双指数" },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="flashover_method" label="闪络判据">
                        <Select
                          options={[
                            { value: "guideline", label: "规程法" },
                            { value: "intersection", label: "相交法" },
                            { value: "leader_development", label: "先导发展法" },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="altitude_correction" label="海拔修正">
                        <Select
                          options={[
                            { value: "none", label: "无" },
                            { value: "formula1", label: "推荐公式1" },
                            { value: "formula2", label: "推荐公式2" },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="induced_voltage_formula" label="感应电压公式">
                        <Select
                          options={[
                            { value: "formula1", label: "公式1" },
                            { value: "formula2", label: "公式2" },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="head_time_min_us" label="波头时间最小(μs)">
                        <InputNumber min={0.1} step={0.1} precision={2} className="w-full" />
                      </Form.Item>
                      <Form.Item name="head_time_max_us" label="波头时间最大(μs)">
                        <InputNumber min={0.1} step={0.1} precision={2} className="w-full" />
                      </Form.Item>
                      <Form.Item name="head_time_step_us" label="波头步长(μs)">
                        <InputNumber min={0.05} step={0.05} precision={2} className="w-full" />
                      </Form.Item>
                      <Form.Item name="tail_time_min_us" label="波尾时间最小(μs)">
                        <InputNumber min={1} step={1} precision={2} className="w-full" />
                      </Form.Item>
                      <Form.Item name="tail_time_max_us" label="波尾时间最大(μs)">
                        <InputNumber min={1} step={1} precision={2} className="w-full" />
                      </Form.Item>
                      <Form.Item name="tail_time_step_us" label="波尾步长(μs)">
                        <InputNumber min={0.5} step={0.5} precision={2} className="w-full" />
                      </Form.Item>
                    </div>
                  </>
                ) : null}
              </Form>
            ) : null}

            <Select
              value={selectedJob?.id ?? undefined}
              placeholder="选择防雷分析任务"
              loading={jobsQuery.isLoading}
              options={(jobsQuery.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.line_name || item.line_code || item.id} / ${formatJobType(item.job_type, Boolean(readObject(item.execution_options_json).non_construction))} / ${item.status}`,
              }))}
              onChange={(value) => {
                setSelectedJobId(value);
              }}
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 420, maxWidth: 760 }}
            />
          </Space>
        </Card>

        {!selectedJob ? (
          <Card>
            {jobsQuery.isLoading ? <Spin /> : <Empty description="暂无防雷分析任务" />}
          </Card>
        ) : (
          <>
            <Card>
              <Space direction="vertical" size={16} className="flex w-full">
                {selectedJobDetailQuery.isLoading ? (
                  <Spin />
                ) : selectedJobDetailQuery.error ? (
                  <Alert
                    type="error"
                    showIcon
                    message={selectedJobDetailQuery.error instanceof Error ? selectedJobDetailQuery.error.message : "任务详情加载失败"}
                  />
                ) : selectedJobDetail ? (
                  <>
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label="任务名称">{selectedJobDetail.job_name || "-"}</Descriptions.Item>
                      <Descriptions.Item label="任务状态">
                        <Tag color={statusColor(selectedJobDetail.status)}>{selectedJobDetail.status}</Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="线路">{selectedJobDetail.line_name || selectedJobDetail.line_code || "-"}</Descriptions.Item>
                      <Descriptions.Item label="任务类型">{formatJobType(selectedJobDetail.job_type, mitigationMode(selectedJobDetail))}</Descriptions.Item>
                      <Descriptions.Item label="结果杆塔数">{selectedJobDetail.result_tower_count}</Descriptions.Item>
                      <Descriptions.Item label="完成时间">{formatDateTime(selectedJobDetail.finished_at)}</Descriptions.Item>
                      <Descriptions.Item label="风险计数" span={2}>
                        {stringifyJson(selectedJobDetail.result_summary_json?.risk_counts ?? {})}
                      </Descriptions.Item>
                      {selectedJobDetail.job_type === "mitigation" ? (
                        <>
                          <Descriptions.Item label="前驱风险任务">{sourceJobId || "-"}</Descriptions.Item>
                          <Descriptions.Item label="选塔数">{String(selectedTowerCount(selectedJobDetail) || "-")}</Descriptions.Item>
                          <Descriptions.Item label="模式">{mitigationMode(selectedJobDetail) ? "非建线" : "常规建线"}</Descriptions.Item>
                          <Descriptions.Item label="需装避雷器数">
                            {String(readObject(selectedJobDetail.result_summary_json).arrester_required_count ?? "-")}
                          </Descriptions.Item>
                        </>
                      ) : selectedJobDetail.job_type === "report" ? (
                        <>
                          <Descriptions.Item label="报告来源">
                            {reportSourceJobType ? formatJobType(reportSourceJobType) : "-"}
                            {reportSourceJobName ? ` / ${reportSourceJobName}` : ""}
                          </Descriptions.Item>
                          <Descriptions.Item label="选塔数">
                            {String(readObject(selectedJobDetail.result_summary_json).selected_tower_count ?? "-")}
                          </Descriptions.Item>
                          <Descriptions.Item label="关联措施任务">{reportMitigationJobName || "未关联"}</Descriptions.Item>
                          <Descriptions.Item label="文档名">{reportDocumentName || "-"}</Descriptions.Item>
                        </>
                      ) : selectedJobDetail.job_type === "normal" || selectedJobDetail.job_type === "tongtiao" ? (
                        <>
                          <Descriptions.Item label="适配器">{formatExternalAdapter(selectedJobDetail.external_adapter)}</Descriptions.Item>
                          <Descriptions.Item label="ATP模型">
                            {selectedJobExternalModelName || selectedJobExternalModelCode || "-"}
                            {selectedJobExternalModelName && selectedJobExternalModelCode ? ` / ${selectedJobExternalModelCode}` : ""}
                          </Descriptions.Item>
                          <Descriptions.Item label="模型版本">
                            {typeof selectedJobExternalVersionNo === "number" ? `v${selectedJobExternalVersionNo}` : "-"}
                          </Descriptions.Item>
                          <Descriptions.Item label="平均得分">{String(selectedJobDetail.result_summary_json?.score_average ?? "-")}</Descriptions.Item>
                          <Descriptions.Item label="平均扫描点">{String(readObject(selectedJobDetail.result_summary_json).scan_point_average ?? "-")}</Descriptions.Item>
                          <Descriptions.Item label="雷电流波形">{formatCurrentWaveform(selectedJobWorkflow?.current_waveform)}</Descriptions.Item>
                          <Descriptions.Item label="闪络判据">{formatFlashoverMethod(selectedJobWorkflow?.flashover_method)}</Descriptions.Item>
                          <Descriptions.Item label="海拔修正">{formatAltitudeCorrection(selectedJobWorkflow?.altitude_correction)}</Descriptions.Item>
                          <Descriptions.Item label="感应电压公式">{formatInducedVoltageFormula(selectedJobWorkflow?.induced_voltage_formula)}</Descriptions.Item>
                          <Descriptions.Item label="波头范围">{formatRangeSummary(selectedJobWorkflow?.head_time_range_us)}</Descriptions.Item>
                          <Descriptions.Item label="波尾范围">{formatRangeSummary(selectedJobWorkflow?.tail_time_range_us)}</Descriptions.Item>
                        </>
                      ) : (
                        <>
                          <Descriptions.Item label="平均得分">{String(selectedJobDetail.result_summary_json?.score_average ?? "-")}</Descriptions.Item>
                          <Descriptions.Item label="适配器">{String(selectedJobDetail.external_adapter || "-")}</Descriptions.Item>
                        </>
                      )}
                    </Descriptions>

                    {canManage || selectedJob.job_type === "report" ? (
                      <Space wrap>
                        {canManage ? (
                          <Button
                            onClick={() => {
                              if (selectedJob) {
                                startJobMutation.mutate(selectedJob.id);
                              }
                            }}
                            loading={startJobMutation.isPending}
                          >
                            {selectedJob.status === "success" ? "重新执行任务" : "启动任务"}
                          </Button>
                        ) : null}
                        {canManage && canCreateMitigation ? (
                          <Button
                            type="primary"
                            disabled={candidateMitigationRows.length === 0}
                            onClick={openMitigationJobModal}
                          >
                            生成措施推荐任务
                          </Button>
                        ) : null}
                        {canManage && canCreateReport ? (
                          <Button
                            disabled={candidateReportRows.length === 0}
                            onClick={openReportJobModal}
                          >
                            生成报告任务
                          </Button>
                        ) : null}
                        {selectedJob.job_type !== "report" ? (
                          <Button
                            onClick={() => {
                              downloadResultsMutation.mutate({
                                jobId: selectedJob.id,
                                runId: selectedJobDetail?.latest_run_id ?? selectedJob.latest_run_id,
                                jobType: selectedJob.job_type,
                              });
                            }}
                            loading={downloadResultsMutation.isPending}
                            disabled={!canDownloadResults}
                          >
                            导出当前结果
                          </Button>
                        ) : null}
                        {selectedJob.job_type === "report" ? (
                          <Button
                            type="primary"
                            onClick={() => {
                              downloadReportMutation.mutate(selectedJob.id);
                            }}
                            loading={downloadReportMutation.isPending}
                            disabled={selectedJob.status !== "success"}
                          >
                            下载报告
                          </Button>
                        ) : null}
                      </Space>
                    ) : null}
                  </>
                ) : (
                  <Empty description="暂无任务详情" />
                )}
              </Space>
            </Card>

            <Card>
              {towerResultsQuery.isLoading ? (
                <Spin />
              ) : towerResultsQuery.error ? (
                <Alert
                  type="error"
                  showIcon
                  message={towerResultsQuery.error instanceof Error ? towerResultsQuery.error.message : "结果表加载失败"}
                />
              ) : (towerResultsQuery.data?.items.length ?? 0) === 0 ? (
                <Empty description="当前任务暂无分级结果" />
              ) : (
                <Table<FlAnalysisTowerResultSummary>
                  rowKey="id"
                  columns={resultColumns}
                  dataSource={towerResultsQuery.data?.items ?? []}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 1400 }}
                />
              )}
            </Card>
          </>
        )}
      </Space>

      <Modal
        title={detailRow ? `${selectedJob?.job_type === "mitigation" ? "高风险原因" : "计算详情"} - ${detailRow.tower_no}` : "计算详情"}
        open={detailModalOpen}
        onCancel={() => {
          setDetailModalOpen(false);
          setDetailRow(null);
        }}
        footer={null}
        width={980}
      >
        {!detailRow ? (
          <Empty description="暂无杆塔详情" />
        ) : (
          <Space direction="vertical" size={16} className="flex w-full">
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="当前结论">{detailRow.summary_text || "-"}</Descriptions.Item>
              <Descriptions.Item label={selectedJob?.job_type === "mitigation" ? "预期风险/风险等级" : "风险等级"}>
                <Tag color={riskColor(detailRow.risk_level)}>{formatRiskLevel(detailRow.risk_level)}</Tag>
              </Descriptions.Item>
              {selectedJob?.job_type === "mitigation" ? (
                <>
                  <Descriptions.Item label="当前风险">
                    <Tag color={riskColor(readCurrentRisk(detailRow))}>{formatRiskLevel(readCurrentRisk(detailRow))}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="改造结论">{readString(detailResultObject, "recommendation_result")}</Descriptions.Item>
                </>
              ) : selectedJob?.job_type === "normal" || selectedJob?.job_type === "tongtiao" ? (
                <>
                  <Descriptions.Item label="最不利点(μs)">
                    {typeof detailSelectedCase.head_time_us === "number" && typeof detailSelectedCase.tail_time_us === "number"
                      ? `${detailSelectedCase.head_time_us}/${detailSelectedCase.tail_time_us}`
                      : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="扫描点数">{String(detailWorkflow.scan_point_count ?? "-")}</Descriptions.Item>
                  <Descriptions.Item label="雷电流波形">{formatCurrentWaveform(detailWorkflow.current_waveform)}</Descriptions.Item>
                  <Descriptions.Item label="闪络判据">{formatFlashoverMethod(detailWorkflow.flashover_method)}</Descriptions.Item>
                  <Descriptions.Item label="海拔修正">{formatAltitudeCorrection(detailWorkflow.altitude_correction)}</Descriptions.Item>
                  <Descriptions.Item label="感应电压公式">{formatInducedVoltageFormula(detailWorkflow.induced_voltage_formula)}</Descriptions.Item>
                  <Descriptions.Item label="波头范围">{formatRangeSummary(detailWorkflow.head_time_range_us)}</Descriptions.Item>
                  <Descriptions.Item label="波尾范围">{formatRangeSummary(detailWorkflow.tail_time_range_us)}</Descriptions.Item>
                  <Descriptions.Item label="执行适配器">
                    {formatExternalAdapter(readOptionalString(detailExternalExecution, "adapter"))}
                  </Descriptions.Item>
                  <Descriptions.Item label="ATP模型">
                    {readOptionalString(detailExternalExecution, "model_name") || readOptionalString(detailExternalExecution, "model_code") || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="模型版本">
                    {typeof readOptionalNumber(detailExternalExecution, "version_no") === "number"
                      ? `v${readOptionalNumber(detailExternalExecution, "version_no")}`
                      : "-"}
                  </Descriptions.Item>
                  {selectedJob?.job_type === "tongtiao" ? (
                    <>
                      <Descriptions.Item label="主导相组">{readOptionalString(detailResultObject, "dominant_phase_set") ?? "-"}</Descriptions.Item>
                      <Descriptions.Item label="闪络相">{readOptionalString(detailResultObject, "flashover_phase") ?? "-"}</Descriptions.Item>
                    </>
                  ) : null}
                </>
              ) : null}
              <Descriptions.Item label="原因分析" span={2}>
                {readString(detailResultObject, "cause_analysis")}
              </Descriptions.Item>
              <Descriptions.Item label="措施建议" span={2}>
                {readString(detailResultObject, "mitigation_recommendation")}
              </Descriptions.Item>
              <Descriptions.Item label="当前得分">
                {selectedJob?.job_type === "mitigation"
                  ? String(readCurrentScore(detailRow) ?? "-")
                  : String(readOptionalNumber(detailResultObject, "score") ?? "-")}
              </Descriptions.Item>
              <Descriptions.Item label="预期得分/得分">
                {selectedJob?.job_type === "mitigation"
                  ? String(readOptionalNumber(detailResultObject, "expected_score") ?? "-")
                  : String(readOptionalNumber(detailResultObject, "score") ?? "-")}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ margin: 0 }}>
              原因细项
            </Typography.Title>
            {(reasonDetails.length ?? 0) === 0 ? (
              <Empty description="暂无细项分级" />
            ) : (
              <Table<ReasonDetail>
                rowKey="code"
                columns={reasonDetailColumns}
                dataSource={reasonDetails}
                pagination={false}
                size="small"
              />
            )}

            {selectedJob?.job_type === "normal" || selectedJob?.job_type === "tongtiao" ? (
              <>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  波形扫描
                </Typography.Title>
                {scanPoints.length === 0 ? (
                  <Empty description="当前结果未生成扫描点" />
                ) : (
                  <Table<ScanPoint>
                    rowKey={(row) => `${row.head_time_us ?? "-"}-${row.tail_time_us ?? "-"}`}
                    columns={scanPointColumns}
                    dataSource={scanPoints}
                    pagination={false}
                    size="small"
                    scroll={{ x: 1000 }}
                  />
                )}
              </>
            ) : null}

            {selectedJob?.job_type === "tongtiao" ? (
              <>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  相别结果
                </Typography.Title>
                {phaseResults.length === 0 ? (
                  <Empty description="当前结果未生成相别结果" />
                ) : (
                  <Table<PhaseResult>
                    rowKey="phase"
                    columns={phaseResultColumns}
                    dataSource={phaseResults}
                    pagination={false}
                    size="small"
                    scroll={{ x: 1200 }}
                  />
                )}

                <Typography.Title level={5} style={{ margin: 0 }}>
                  多相结果
                </Typography.Title>
                {multiPhaseResults.length === 0 ? (
                  <Empty description="当前结果未生成多相结果" />
                ) : (
                  <Table<MultiPhaseResult>
                    rowKey="label"
                    columns={multiPhaseColumns}
                    dataSource={multiPhaseResults}
                    pagination={false}
                    size="small"
                    scroll={{ x: 900 }}
                  />
                )}
              </>
            ) : null}

            <Typography.Title level={5} style={{ margin: 0 }}>
              改造动作
            </Typography.Title>
            {mitigationActions.length === 0 ? (
              <Empty description="当前结果未生成改造动作" />
            ) : (
              <Table<MitigationAction>
                rowKey="code"
                columns={mitigationActionColumns}
                dataSource={mitigationActions}
                pagination={false}
                size="small"
              />
            )}
          </Space>
        )}
      </Modal>

      <Modal
        title={selectedJob ? `措施推荐 - ${selectedJob.job_name || selectedJob.line_name || selectedJob.line_code}` : "措施推荐"}
        open={mitigationModalOpen}
        width={1080}
        confirmLoading={createMitigationMutation.isPending}
        okText="创建并启动措施任务"
        onCancel={() => {
          if (createMitigationMutation.isPending) {
            return;
          }
          setMitigationModalOpen(false);
        }}
        onOk={() => {
          mitigationForm.submit();
        }}
      >
        <Space direction="vertical" size={16} className="flex w-full">
          <Alert
            type="info"
            showIcon
            message="源端迁移口径：仅允许从已有风险结果中选择高风险杆塔，生成措施推荐任务。"
          />
          <Form<MitigationFormValues>
            form={mitigationForm}
            layout="vertical"
            onFinish={(values) => {
              createMitigationMutation.mutate(values);
            }}
            initialValues={{ non_construction: false }}
          >
            <Form.Item
              name="job_name"
              label="任务名称"
              rules={[{ required: true, message: "请输入任务名称" }]}
            >
              <Input placeholder="措施推荐任务名称" />
            </Form.Item>
            <Form.Item name="non_construction" valuePropName="checked">
              <Checkbox>按“非建线”模式生成措施推荐</Checkbox>
            </Form.Item>
          </Form>

          {(candidateMitigationRows.length ?? 0) === 0 ? (
            <Empty description="当前风险任务没有中高风险杆塔，无法生成措施推荐任务" />
          ) : (
            <>
              <Typography.Text type="secondary">
                已命中 {candidateMitigationRows.length} 座中高风险杆塔。默认全选，可按需缩小推荐范围。
              </Typography.Text>
              <Table<FlAnalysisTowerResultSummary>
                rowKey="tower_id"
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                rowSelection={{
                  selectedRowKeys: selectedMitigationTowerIds,
                  onChange: (keys) => {
                    setSelectedMitigationTowerIds(keys.map((item) => String(item)));
                  },
                }}
                columns={[
                  { title: "杆塔号", dataIndex: "tower_no", width: 120 },
                  {
                    title: "风险等级",
                    dataIndex: "risk_level",
                    width: 120,
                    render: (value: string | null) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
                  },
                  {
                    title: "高风险原因",
                    key: "cause_analysis",
                    render: (_value, row) => readString(readObject(row.result_json), "cause_analysis"),
                  },
                  {
                    title: "当前建议",
                    key: "mitigation_recommendation",
                    render: (_value, row) => readString(readObject(row.result_json), "mitigation_recommendation"),
                  },
                ]}
                dataSource={candidateMitigationRows}
                scroll={{ x: 1000 }}
              />
            </>
          )}
        </Space>
      </Modal>

      <Modal
        title={selectedJob ? `报告生成 - ${selectedJob.job_name || selectedJob.line_name || selectedJob.line_code}` : "报告生成"}
        open={reportModalOpen}
        width={1080}
        confirmLoading={createReportMutation.isPending}
        okText="创建并启动报告任务"
        onCancel={() => {
          if (createReportMutation.isPending) {
            return;
          }
          setReportModalOpen(false);
        }}
        onOk={() => {
          reportForm.submit();
        }}
      >
        <Space direction="vertical" size={16} className="flex w-full">
          <Alert
            type="info"
            showIcon
            message="源端迁移口径：报告任务挂靠在已完成的风险评估或措施推荐结果上，并允许按杆塔缩小纳入报告的范围。"
          />
          <Form<ReportFormValues>
            form={reportForm}
            layout="vertical"
            onFinish={(values) => {
              createReportMutation.mutate(values);
            }}
          >
            <Form.Item
              name="job_name"
              label="任务名称"
              rules={[{ required: true, message: "请输入任务名称" }]}
            >
              <Input placeholder="报告任务名称" />
            </Form.Item>
          </Form>

          {(candidateReportRows.length ?? 0) === 0 ? (
            <Empty description="当前任务没有可纳入报告的杆塔结果" />
          ) : (
            <>
              <Typography.Text type="secondary">
                已命中 {candidateReportRows.length} 座可纳入报告的杆塔。默认全选，可按需缩小报告范围。
              </Typography.Text>
              <Table<FlAnalysisTowerResultSummary>
                rowKey="tower_id"
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                rowSelection={{
                  selectedRowKeys: selectedReportTowerIds,
                  onChange: (keys) => {
                    setSelectedReportTowerIds(keys.map((item) => String(item)));
                  },
                }}
                columns={[
                  { title: "杆塔号", dataIndex: "tower_no", width: 120 },
                  {
                    title: "风险等级",
                    dataIndex: "risk_level",
                    width: 120,
                    render: (value: string | null) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
                  },
                  {
                    title: "高风险原因",
                    key: "cause_analysis",
                    render: (_value, row) => readString(readObject(row.result_json), "cause_analysis"),
                  },
                  {
                    title: "措施建议",
                    key: "mitigation_recommendation",
                    render: (_value, row) => readString(readObject(row.result_json), "mitigation_recommendation"),
                  },
                ]}
                dataSource={candidateReportRows}
                scroll={{ x: 1000 }}
              />
            </>
          )}
        </Space>
      </Modal>
    </>
  );
}
