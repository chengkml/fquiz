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
import type {
  FlAnalysisJobDetail,
  FlAnalysisJobListResponse,
  FlAnalysisJobSummary,
  FlAnalysisTowerResultListResponse,
  FlAnalysisTowerResultSummary,
  LineListResponse,
  LineSummary,
} from "@/types/auth";

type RiskJobFormValues = {
  job_name: string;
  line_id: string;
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
  if (jobType === "tongtiao") return "统跳计算";
  if (jobType === "report") return "报告";
  if (jobType === "scenario") return "场景分析";
  return jobType || "-";
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

function readReasonDetails(row: FlAnalysisTowerResultSummary | null): ReasonDetail[] {
  const value = row ? readObject(row.result_json).reason_details : null;
  return Array.isArray(value) ? (value as ReasonDetail[]) : [];
}

function readMitigationActions(row: FlAnalysisTowerResultSummary | null): MitigationAction[] {
  const value = row ? readObject(row.result_json).mitigation_actions : null;
  return Array.isArray(value) ? (value as MitigationAction[]) : [];
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
  const [riskJobForm] = Form.useForm<RiskJobFormValues>();
  const [mitigationForm] = Form.useForm<MitigationFormValues>();
  const [reportForm] = Form.useForm<ReportFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const selectedLineId = Form.useWatch("line_id", riskJobForm);

  const canRead = hasPermission("line.read") || hasPermission("line.manage");
  const canManage = hasPermission("line.manage") || hasPermission("tower.manage");

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

  useEffect(() => {
    const firstLine = linesQuery.data?.items[0];
    if (firstLine && !riskJobForm.getFieldValue("line_id")) {
      riskJobForm.setFieldsValue({ line_id: firstLine.id });
    }
  }, [linesQuery.data?.items, riskJobForm]);

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

  const createRiskJobMutation = useMutation({
    mutationFn: async (values: RiskJobFormValues) =>
      createAndStartJob({
        line_id: values.line_id,
        job_name: values.job_name.trim() || null,
        job_type: "risk",
        external_adapter: "placeholder",
      }),
    onSuccess: async (job) => {
      await invalidateFlAnalysisQueries();
      setSelectedJobId(job.id);
      messageApi.success("风险评估任务已创建并启动");
      riskJobForm.setFieldsValue({ job_name: "" });
    },
    onError: (error) => {
      messageApi.error(error instanceof Error ? error.message : "风险评估任务创建失败");
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
            查看原因
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

  const selectedLine = useMemo(() => {
    return linesQuery.data?.items.find((item) => item.id === selectedLineId) ?? null;
  }, [linesQuery.data?.items, selectedLineId]);

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
  const selectedJobExecutionOptions = readObject(selectedJobDetail?.execution_options_json);
  const selectedJobSummary = readObject(selectedJobDetail?.result_summary_json);
  const sourceJobId = readOptionalString(selectedJobExecutionOptions, "source_job_id");
  const canCreateMitigation = selectedJob?.job_type === "risk";
  const canCreateReport = selectedJob?.job_type === "risk" || selectedJob?.job_type === "mitigation";
  const reportSourceJobType = readOptionalString(selectedJobSummary, "source_job_type");
  const reportSourceJobName = readOptionalString(selectedJobSummary, "source_job_name");
  const reportMitigationJobName = readOptionalString(selectedJobSummary, "mitigation_job_name");
  const reportDocumentName = readOptionalString(selectedJobSummary, "document_filename");

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
                迁移源端“风险评估 + 措施推荐 + 报告生成”工作流：先生成风险结果，再按需派生措施任务或报告任务，并直接下载 Word 兼容报告。
              </Typography.Text>
            </div>

            {jobsQuery.error ? (
              <Alert type="error" showIcon message={jobsQuery.error instanceof Error ? jobsQuery.error.message : "任务列表加载失败"} />
            ) : null}

            {canManage ? (
              <Form<RiskJobFormValues>
                form={riskJobForm}
                layout="inline"
                onFinish={(values) => {
                  createRiskJobMutation.mutate(values);
                }}
              >
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
                    style={{ minWidth: 280 }}
                    options={(linesQuery.data?.items ?? []).map((item: LineSummary) => ({
                      value: item.id,
                      label: `${item.name || item.code} / ${item.code}`,
                    }))}
                  />
                </Form.Item>
                <Form.Item name="job_name" label="任务名">
                  <Input placeholder={selectedLine ? `${selectedLine.name || selectedLine.code}-风险评估` : "风险评估任务"} style={{ width: 260 }} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={createRiskJobMutation.isPending}>
                    创建并启动风险任务
                  </Button>
                </Form.Item>
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
        title={detailRow ? `高风险原因 - ${detailRow.tower_no}` : "高风险原因"}
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
              <Descriptions.Item label="预期风险/风险等级">
                <Tag color={riskColor(detailRow.risk_level)}>{formatRiskLevel(detailRow.risk_level)}</Tag>
              </Descriptions.Item>
              {selectedJob?.job_type === "mitigation" ? (
                <>
                  <Descriptions.Item label="当前风险">
                    <Tag color={riskColor(readCurrentRisk(detailRow))}>{formatRiskLevel(readCurrentRisk(detailRow))}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="改造结论">{readString(detailResultObject, "recommendation_result")}</Descriptions.Item>
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
