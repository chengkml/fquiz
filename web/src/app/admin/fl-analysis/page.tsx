"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Descriptions, Empty, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  FlAnalysisJobDetail,
  FlAnalysisJobListResponse,
  FlAnalysisTowerResultListResponse,
  FlAnalysisTowerResultSummary,
} from "@/types/auth";

function formatRiskLevel(value: string | null | undefined): string {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return value || "-";
}

function riskColor(value: string | null | undefined): string {
  if (value === "high") return "red";
  if (value === "medium") return "orange";
  if (value === "low") return "green";
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

export default function AdminFlAnalysisPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const canRead = hasPermission("line.read") || hasPermission("line.manage");

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

  const resultColumns = useMemo<ColumnsType<FlAnalysisTowerResultSummary>>(
    () => [
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
      {
        title: "风险等级",
        dataIndex: "risk_level",
        width: 120,
        render: (value: string | null) => <Tag color={riskColor(value)}>{formatRiskLevel(value)}</Tag>,
      },
      {
        title: "综合结论",
        dataIndex: "summary_text",
        ellipsis: true,
      },
      {
        title: "原因分析",
        key: "cause_analysis",
        ellipsis: true,
        render: (_value, row) => String(row.result_json?.cause_analysis ?? "-"),
      },
      {
        title: "措施建议",
        key: "mitigation_recommendation",
        ellipsis: true,
        render: (_value, row) => String(row.result_json?.mitigation_recommendation ?? "-"),
      },
      {
        title: "得分",
        key: "score",
        width: 90,
        render: (_value, row) => row.result_json?.score ?? "-",
      },
    ],
    [],
  );

  if (!initializing && !user) {
    return <Alert type="warning" showIcon message="请先登录后查看防雷分析结果。" />;
  }

  if (!initializing && !canRead) {
    return <Alert type="error" showIcon message="当前账号缺少线路读取权限，无法查看防雷分析结果。" />;
  }

  return (
    <Space direction="vertical" size={16} className="flex w-full">
      <Card>
        <Space direction="vertical" size={12} className="flex w-full">
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              防雷分析结果
            </Typography.Title>
            <Typography.Text type="secondary">
              最小结果页：查看任务汇总、风险分级和每塔原因/措施。
            </Typography.Text>
          </div>

          {jobsQuery.error ? (
            <Alert type="error" showIcon message={jobsQuery.error instanceof Error ? jobsQuery.error.message : "任务列表加载失败"} />
          ) : null}

          <Select
            value={selectedJob?.id ?? undefined}
            placeholder="选择防雷分析任务"
            loading={jobsQuery.isLoading}
            options={(jobsQuery.data?.items ?? []).map((item) => ({
              value: item.id,
              label: `${item.line_name || item.line_code || item.id} / ${item.job_name || item.job_type} / ${item.status}`,
            }))}
            onChange={(value) => {
              setSelectedJobId(value);
            }}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 420, maxWidth: 720 }}
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
            {selectedJobDetailQuery.isLoading ? (
              <Spin />
            ) : selectedJobDetailQuery.error ? (
              <Alert
                type="error"
                showIcon
                message={selectedJobDetailQuery.error instanceof Error ? selectedJobDetailQuery.error.message : "任务详情加载失败"}
              />
            ) : selectedJobDetailQuery.data ? (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="任务名称">{selectedJobDetailQuery.data.job_name || "-"}</Descriptions.Item>
                <Descriptions.Item label="任务状态">
                  <Tag color={selectedJobDetailQuery.data.status === "success" ? "green" : "blue"}>
                    {selectedJobDetailQuery.data.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="线路">{selectedJobDetailQuery.data.line_name || selectedJobDetailQuery.data.line_code || "-"}</Descriptions.Item>
                <Descriptions.Item label="任务类型">{selectedJobDetailQuery.data.job_type}</Descriptions.Item>
                <Descriptions.Item label="结果杆塔数">{selectedJobDetailQuery.data.result_tower_count}</Descriptions.Item>
                <Descriptions.Item label="完成时间">{formatDateTime(selectedJobDetailQuery.data.finished_at)}</Descriptions.Item>
                <Descriptions.Item label="风险计数" span={2}>
                  {stringifyJson(selectedJobDetailQuery.data.result_summary_json?.risk_counts ?? {})}
                </Descriptions.Item>
                <Descriptions.Item label="平均得分">{String(selectedJobDetailQuery.data.result_summary_json?.score_average ?? "-")}</Descriptions.Item>
                <Descriptions.Item label="适配器">{String(selectedJobDetailQuery.data.result_summary_json?.external_adapter ?? "-")}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Empty description="暂无任务详情" />
            )}
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
                scroll={{ x: 1200 }}
              />
            )}
          </Card>
        </>
      )}
    </Space>
  );
}
