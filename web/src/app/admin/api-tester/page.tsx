"use client";

import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  ModelHealthStatus,
  ModelListResponse,
  ModelRegistryItem,
  ModelStatus,
  ModelSummaryResponse,
  ModelTestChatResponse,
  ModelTestRunItem,
  ModelTestRunListResponse,
  ModelTestStatus,
} from "@/types/auth";

const { TextArea } = Input;

const MODEL_STATUS_ALL_FILTER = "__all_model_status__";
const MODEL_STATUS_OPTIONS: ModelStatus[] = ["DRAFT", "ENABLED", "DISABLED", "DEPRECATED"];
const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  DRAFT: "草稿",
  ENABLED: "已启用",
  DISABLED: "已停用",
  DEPRECATED: "已废弃",
};
const HEALTH_STATUS_LABELS: Record<ModelHealthStatus, string> = {
  HEALTHY: "健康",
  DEGRADED: "退化",
  UNHEALTHY: "不健康",
};
const TEST_STATUS_LABELS: Record<ModelTestStatus, string> = {
  PASSED: "通过",
  FAILED: "失败",
};

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatTestStatus(status: ModelTestStatus): string {
  return `${TEST_STATUS_LABELS[status]}（${status}）`;
}

function formatHealthStatus(status: ModelHealthStatus | null): string {
  if (!status) return "-";
  return `${HEALTH_STATUS_LABELS[status]}（${status}）`;
}

function testStatusTagColor(status: ModelTestStatus): string {
  return status === "PASSED" ? "success" : "error";
}

function healthStatusTagColor(status: ModelHealthStatus | null): string {
  if (status === "HEALTHY") return "success";
  if (status === "DEGRADED") return "warning";
  if (status === "UNHEALTHY") return "error";
  return "default";
}

export default function AdminApiTesterPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("model.read") || hasPermission("model.manage");
  const canManage = hasPermission("model.manage");

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(MODEL_STATUS_ALL_FILTER);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("smoke");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [smokeForm, setSmokeForm] = useState({
    kind: "SMOKE",
    inputTokens: 16,
    outputTokens: 32,
  });
  const [chatForm, setChatForm] = useState({
    message: "",
    systemPrompt: "",
  });
  const [chatResult, setChatResult] = useState<ModelTestChatResponse | null>(null);

  const modelsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== MODEL_STATUS_ALL_FILTER) {
      params.set("status", statusFilter);
    }
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    const query = params.toString();
    return query ? `/api/v1/admin/models?${query}` : "/api/v1/admin/models";
  }, [keyword, statusFilter]);

  const summaryPath = "/api/v1/admin/models/summary";

  const modelsQuery = useQuery({
    queryKey: [modelsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(modelsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelListResponse;
    },
  });

  const summaryQuery = useQuery({
    queryKey: [summaryPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(summaryPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelSummaryResponse;
    },
  });

  const testsQuery = useQuery({
    queryKey: ["/api/v1/admin/models/tests", selectedModelId],
    enabled: !!user && canRead && !!selectedModelId,
    queryFn: async () => {
      if (!selectedModelId) {
        return { items: [], total: 0 } as ModelTestRunListResponse;
      }
      const response = await fetchWithAuth(`/api/v1/admin/models/${selectedModelId}/tests?limit=50`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestRunListResponse;
    },
  });

  const models = modelsQuery.data?.items ?? [];
  const summary = summaryQuery.data;
  const selectedModel = useMemo(
    () => models.find((item) => item.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  useEffect(() => {
    if (models.length === 0) {
      setSelectedModelId(null);
      return;
    }
    const exists = selectedModelId !== null && models.some((item) => item.id === selectedModelId);
    if (!exists) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  const historyItems = useMemo(() => {
    const allItems = testsQuery.data?.items ?? [];
    if (!failedOnly) return allItems;
    return allItems.filter((item) => item.status === "FAILED");
  }, [failedOnly, testsQuery.data?.items]);

  const queryError = useMemo(() => {
    for (const candidate of [modelsQuery.error, summaryQuery.error, testsQuery.error]) {
      if (candidate instanceof Error) {
        return candidate.message;
      }
    }
    return "";
  }, [modelsQuery.error, summaryQuery.error, testsQuery.error]);

  const smokeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModel) {
        throw new Error("请先选择模型");
      }
      const payload = {
        kind: smokeForm.kind.trim().toUpperCase() || "SMOKE",
        input_tokens: Math.max(0, Number(smokeForm.inputTokens || 0)),
        output_tokens: Math.max(0, Number(smokeForm.outputTokens || 0)),
      };
      const response = await fetchWithAuth(`/api/v1/admin/models/${selectedModel.id}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestRunItem;
    },
    onSuccess: async (created) => {
      setError("");
      setSuccess(`冒烟测试已执行：${formatTestStatus(created.status)}`);
      setActiveTab("history");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [modelsPath] }),
        queryClient.invalidateQueries({ queryKey: [summaryPath] }),
        queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/models/tests", selectedModelId] }),
      ]);
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "执行冒烟测试失败");
    },
  });

  const chatMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModel) {
        throw new Error("请先选择模型");
      }
      const payload = {
        message: chatForm.message.trim(),
        system_prompt: chatForm.systemPrompt.trim() || null,
      };
      if (!payload.message) {
        throw new Error("请输入测试内容");
      }
      const response = await fetchWithAuth(`/api/v1/admin/models/${selectedModel.id}/test-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelTestChatResponse;
    },
    onSuccess: async (result) => {
      setError("");
      setSuccess(`对话测试已执行：${formatTestStatus(result.test_status)}`);
      setChatResult(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [modelsPath] }),
        queryClient.invalidateQueries({ queryKey: [summaryPath] }),
        queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/models/tests", selectedModelId] }),
      ]);
    },
    onError: (candidate) => {
      setSuccess("");
      setChatResult(null);
      setError(candidate instanceof Error ? candidate.message : "执行对话测试失败");
    },
  });

  if (initializing || modelsQuery.isLoading || summaryQuery.isLoading) {
    return (
      <Card>
        <Space align="center">
          <Spin size="small" />
          <Typography.Text type="secondary">加载 API 测试数据中...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size="middle">
          <Typography.Text type="secondary">请先登录后再访问 API 测试页面。</Typography.Text>
          <Link href="/">
            <Button type="primary">返回首页</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size="middle">
          <Typography.Text type="secondary">你没有访问该页面的权限（需要 `model.read`）。</Typography.Text>
          <Link href="/">
            <Button type="primary">返回首页</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 8 }}>
          API 测试
        </Typography.Title>
        <Typography.Text type="secondary">
          聚焦模型测试主流程：选模型 → 执行测试（冒烟/对话）→ 查看测试记录。
        </Typography.Text>
      </div>

      {(error || queryError) && (
        <Alert
          type="error"
          showIcon
          message="操作失败"
          description={<Typography.Text style={{ whiteSpace: "pre-wrap" }}>{error || queryError}</Typography.Text>}
        />
      )}
      {success && <Alert type="success" showIcon message={success} />}

      {!canManage && (
        <Alert
          type="info"
          showIcon
          message="当前账号仅可查看测试数据"
          description="执行冒烟测试和对话测试需要 model.manage 权限。"
        />
      )}

      <Space size={16} wrap>
        <Card>
          <Statistic title="可见模型" value={summary?.total_models ?? 0} />
        </Card>
        <Card>
          <Statistic title="近 7 天测试" value={summary?.tests_7d.total_runs ?? 0} />
        </Card>
        <Card>
          <Statistic title="近 7 天通过率" value={formatPercent(summary?.tests_7d.pass_rate ?? null)} />
        </Card>
        <Card>
          <Statistic title="健康风险模型" value={summary?.enabled_without_healthy_check ?? 0} />
        </Card>
      </Space>

      <Card title="模型选择">
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <Space wrap>
            <Input
              style={{ minWidth: 260 }}
              allowClear
              placeholder="搜索 code / name / provider"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              style={{ minWidth: 180 }}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              options={[
                { value: MODEL_STATUS_ALL_FILTER, label: "全部状态" },
                ...MODEL_STATUS_OPTIONS.map((item) => ({
                  value: item,
                  label: `${MODEL_STATUS_LABELS[item]}（${item}）`,
                })),
              ]}
            />
            <Select
              style={{ minWidth: 320 }}
              value={selectedModelId ?? undefined}
              placeholder="请选择要测试的模型"
              onChange={(value: number) => setSelectedModelId(value)}
              options={models.map((item) => ({
                value: item.id,
                label: `${item.code} / ${item.name}`,
              }))}
              notFoundContent="暂无可选模型"
              showSearch
              optionFilterProp="label"
            />
          </Space>

          {selectedModel ? (
            <Descriptions bordered size="small" column={{ xs: 1, md: 2, xl: 3 }}>
              <Descriptions.Item label="模型">{selectedModel.code}</Descriptions.Item>
              <Descriptions.Item label="供应商">
                {selectedModel.provider} / {selectedModel.provider_model}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag>{MODEL_STATUS_LABELS[selectedModel.status]}（{selectedModel.status}）</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="健康">
                <Tag color={healthStatusTagColor(selectedModel.latest_health_status)}>
                  {formatHealthStatus(selectedModel.latest_health_status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="7日测试">
                {selectedModel.tests_7d.total_runs}（通过率 {formatPercent(selectedModel.tests_7d.pass_rate)}）
              </Descriptions.Item>
              <Descriptions.Item label="7日调用">
                {selectedModel.usage_7d.request_count}（成功率 {formatPercent(selectedModel.usage_7d.success_rate)}）
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可测试模型" />
          )}
        </Space>
      </Card>

      <Card>
        {selectedModel ? (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "smoke",
                label: "冒烟测试",
                children: (
                  <Space direction="vertical" size="middle" style={{ display: "flex" }}>
                    <Space wrap>
                      <Input
                        style={{ width: 180 }}
                        placeholder="测试类型"
                        value={smokeForm.kind}
                        onChange={(event) => setSmokeForm((prev) => ({ ...prev, kind: event.target.value }))}
                      />
                      <InputNumber
                        min={0}
                        style={{ width: 180 }}
                        value={smokeForm.inputTokens}
                        addonBefore="输入 Token"
                        onChange={(value) =>
                          setSmokeForm((prev) => ({
                            ...prev,
                            inputTokens: Number(value ?? 0),
                          }))
                        }
                      />
                      <InputNumber
                        min={0}
                        style={{ width: 180 }}
                        value={smokeForm.outputTokens}
                        addonBefore="输出 Token"
                        onChange={(value) =>
                          setSmokeForm((prev) => ({
                            ...prev,
                            outputTokens: Number(value ?? 0),
                          }))
                        }
                      />
                    </Space>

                    <Space>
                      <Button
                        type="primary"
                        loading={smokeMutation.isPending}
                        disabled={!canManage || !selectedModel || !smokeForm.kind.trim()}
                        onClick={() => smokeMutation.mutate()}
                      >
                        执行冒烟测试
                      </Button>
                      <Button
                        onClick={() => {
                          setSmokeForm({ kind: "SMOKE", inputTokens: 16, outputTokens: 32 });
                        }}
                      >
                        重置参数
                      </Button>
                    </Space>
                  </Space>
                ),
              },
              {
                key: "chat",
                label: "对话测试",
                children: (
                  <Space direction="vertical" size="middle" style={{ display: "flex" }}>
                    <TextArea
                      rows={5}
                      placeholder="请输入要测试的用户消息"
                      value={chatForm.message}
                      onChange={(event) => setChatForm((prev) => ({ ...prev, message: event.target.value }))}
                    />
                    <TextArea
                      rows={4}
                      placeholder="可选：覆盖默认 system prompt"
                      value={chatForm.systemPrompt}
                      onChange={(event) =>
                        setChatForm((prev) => ({
                          ...prev,
                          systemPrompt: event.target.value,
                        }))
                      }
                    />
                    <Space>
                      <Button
                        type="primary"
                        loading={chatMutation.isPending}
                        disabled={!canManage || !selectedModel || !chatForm.message.trim()}
                        onClick={() => chatMutation.mutate()}
                      >
                        执行对话测试
                      </Button>
                      <Button
                        onClick={() => {
                          setChatForm({ message: "", systemPrompt: "" });
                          setChatResult(null);
                        }}
                      >
                        清空输入
                      </Button>
                    </Space>

                    {chatResult ? (
                      <Card size="small" title="对话测试结果">
                        <Space direction="vertical" size="small" style={{ display: "flex" }}>
                          <Space wrap>
                            <Tag color={testStatusTagColor(chatResult.test_status)}>
                              {formatTestStatus(chatResult.test_status)}
                            </Tag>
                            <Tag>耗时：{chatResult.latency_ms ?? "-"} ms</Tag>
                            <Tag>
                              Token：{chatResult.prompt_tokens ?? "-"} / {chatResult.completion_tokens ?? "-"} /
                              {" "}
                              {chatResult.total_tokens ?? "-"}
                            </Tag>
                          </Space>
                          <Typography.Text type="secondary">
                            模型：{chatResult.provider} / {chatResult.provider_model}
                          </Typography.Text>
                          {chatResult.error_message ? (
                            <Alert
                              type="error"
                              showIcon
                              message="对话测试失败"
                              description={
                                <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
                                  {chatResult.error_message}
                                </Typography.Text>
                              }
                            />
                          ) : (
                            <Typography.Paragraph
                              style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                              copyable={Boolean(chatResult.reply)}
                            >
                              {chatResult.reply ?? "(空回复)"}
                            </Typography.Paragraph>
                          )}
                        </Space>
                      </Card>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未执行对话测试" />
                    )}
                  </Space>
                ),
              },
              {
                key: "history",
                label: "测试记录",
                children: (
                  <Space direction="vertical" size="middle" style={{ display: "flex" }}>
                    <Space align="center">
                      <Switch checked={failedOnly} onChange={setFailedOnly} />
                      <Typography.Text type="secondary">仅看失败记录</Typography.Text>
                      <Button
                        onClick={() => {
                          void testsQuery.refetch();
                        }}
                      >
                        刷新
                      </Button>
                    </Space>

                    <Table<ModelTestRunItem>
                      rowKey="id"
                      loading={testsQuery.isFetching}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      locale={{
                        emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无测试记录" />,
                      }}
                      dataSource={historyItems}
                      columns={[
                        {
                          title: "时间",
                          dataIndex: "created_at",
                          width: 180,
                          render: (value: string) => new Date(value).toLocaleString(),
                        },
                        {
                          title: "类型",
                          dataIndex: "kind",
                          width: 120,
                        },
                        {
                          title: "状态",
                          dataIndex: "status",
                          width: 140,
                          render: (value: ModelTestStatus) => (
                            <Tag color={testStatusTagColor(value)}>{formatTestStatus(value)}</Tag>
                          ),
                        },
                        {
                          title: "Token",
                          width: 140,
                          render: (_: unknown, record: ModelTestRunItem) =>
                            `${record.input_tokens} / ${record.output_tokens}`,
                        },
                        {
                          title: "耗时",
                          dataIndex: "latency_ms",
                          width: 120,
                          render: (value: number | null) => `${value ?? "-"} ms`,
                        },
                        {
                          title: "错误信息",
                          dataIndex: "error_message",
                          ellipsis: true,
                          render: (value: string | null) => value || "-",
                        },
                      ]}
                    />
                  </Space>
                ),
              },
            ]}
          />
        ) : (
          <Empty description="请选择模型后开始测试" />
        )}
      </Card>
    </Space>
  );
}
