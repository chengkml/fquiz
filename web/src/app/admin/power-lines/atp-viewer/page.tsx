"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { withBasePath } from "@/lib/base-path";
import { AtpX6Viewer } from "@/components/atp-x6-viewer";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import { parseAtpTextToGraphJson, stringifyAtpGraphJson } from "@/lib/atp/parse-atp-text";
import { ATP_SAMPLE_TEXT } from "@/lib/atp/sample";
import { readTextFile } from "@/lib/text-file";
import type { AtpGraphJson } from "@/lib/atp/types";
import type {
  AtpEngineStatusResponse,
  AtpModelListResponse,
  AtpModelSummary,
  AtpModelVersionDetail,
  AtpModelVersionListResponse,
  AtpSimulationRunDetail,
  AtpSimulationRunListResponse,
  AtpSimulationRunSummary,
} from "@/types/auth";

const { TextArea } = Input;

const MODEL_SOURCE_OPTIONS = [
  { value: "atpdraw", label: "ATPDraw" },
  { value: "atp", label: "ATP" },
  { value: "manual", label: "手工" },
] as const;

const MODEL_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
] as const;

const MODEL_ENABLE_STATUS_OPTIONS = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
] as const;

type ModelFormValues = {
  code: string;
  name: string;
  source_type: "atpdraw" | "atp" | "manual";
  status: "enabled" | "disabled";
  tags: string;
  description: string;
};

type VersionFormValues = {
  version_tag: string;
  entry_file: string;
  change_note: string;
  artifact_manifest_json: string;
  atp_text: string;
};

type RunFormValues = {
  timeout_seconds?: number;
  extra_args: string;
  dry_run: boolean;
};

const DEFAULT_MODEL_FORM: ModelFormValues = {
  code: "",
  name: "",
  source_type: "atpdraw",
  status: "enabled",
  tags: "",
  description: "",
};

const DEFAULT_VERSION_FORM: VersionFormValues = {
  version_tag: "",
  entry_file: "",
  change_note: "",
  artifact_manifest_json: "{}",
  atp_text: "",
};

const DEFAULT_RUN_FORM: RunFormValues = {
  timeout_seconds: undefined,
  extra_args: "",
  dry_run: false,
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function formatModelStatus(status: string): ReactNode {
  if (status === "enabled") {
    return <Tag color="green">启用</Tag>;
  }
  if (status === "disabled") {
    return <Tag>禁用</Tag>;
  }
  return <Tag>{status || "-"}</Tag>;
}

function formatRunStatus(status: string): ReactNode {
  if (status === "success") {
    return <Tag color="green">成功</Tag>;
  }
  if (status === "running") {
    return <Tag color="processing">运行中</Tag>;
  }
  if (status === "failed") {
    return <Tag color="red">失败</Tag>;
  }
  if (status === "pending") {
    return <Tag color="blue">排队中</Tag>;
  }
  return <Tag>{status || "-"}</Tag>;
}

function parseTagInput(value: string): string[] {
  return value
    .split(/[\n,，;；]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitExtraArgs(value: string): string[] {
  return value
    .split(/\s+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function buildDefaultManifest(sourceText: string): string {
  if (!sourceText.trim()) {
    return "{}";
  }
  return JSON.stringify(
    {
      files: [
        {
          name: "model.atp",
          type: "ATP",
          size: sourceText.length,
        },
      ],
    },
    null,
    2,
  );
}

export default function PowerLinesAtpViewerPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceText, setSourceText] = useState("");
  const [graphJson, setGraphJson] = useState<AtpGraphJson | null>(null);
  const [parseError, setParseError] = useState("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [modelKeyword, setModelKeyword] = useState("");
  const [modelStatusFilter, setModelStatusFilter] = useState<(typeof MODEL_STATUS_OPTIONS)[number]["value"]>("all");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AtpModelSummary | null>(null);
  const [currentVersionDetail, setCurrentVersionDetail] = useState<AtpModelVersionDetail | null>(null);

  const [modelForm] = Form.useForm<ModelFormValues>();
  const [versionForm] = Form.useForm<VersionFormValues>();
  const [runForm] = Form.useForm<RunFormValues>();

  const canRead = hasPermission("atp.read") || hasPermission("atp.manage") || hasPermission("atp.run");
  const canManage = hasPermission("atp.manage");
  const canRun = hasPermission("atp.run") || hasPermission("atp.manage");

  const modelListPath = useMemo(() => {
    const params = new URLSearchParams();
    if (modelKeyword.trim()) {
      params.set("keyword", modelKeyword.trim());
    }
    if (modelStatusFilter !== "all") {
      params.set("status", modelStatusFilter);
    }
    const query = params.toString();
    return `/api/v1/atp/models${query ? `?${query}` : ""}`;
  }, [modelKeyword, modelStatusFilter]);

  const versionListPath = useMemo(() => {
    if (!selectedModelId) {
      return "";
    }
    const params = new URLSearchParams();
    params.set("limit", "200");
    params.set("offset", "0");
    return `/api/v1/atp/models/${selectedModelId}/versions?${params.toString()}`;
  }, [selectedModelId]);

  const runListPath = useMemo(() => {
    if (!selectedModelId) {
      return "";
    }
    const params = new URLSearchParams();
    params.set("limit", "200");
    params.set("offset", "0");
    return `/api/v1/atp/models/${selectedModelId}/runs?${params.toString()}`;
  }, [selectedModelId]);

  const runDetailPath = useMemo(() => {
    if (!selectedModelId || !activeRunId) {
      return "";
    }
    return `/api/v1/atp/models/${selectedModelId}/runs/${activeRunId}`;
  }, [selectedModelId, activeRunId]);

  const modelsQuery = useQuery({
    queryKey: ["atp-models", modelListPath],
    enabled: Boolean(user) && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(modelListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpModelListResponse;
    },
  });

  const runsQuery = useQuery({
    queryKey: ["atp-model-runs", runListPath],
    enabled: Boolean(user) && canRead && Boolean(selectedModelId),
    queryFn: async () => {
      if (!runListPath) {
        return { items: [], total: 0 } satisfies AtpSimulationRunListResponse;
      }
      const response = await fetchWithAuth(runListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpSimulationRunListResponse;
    },
  });

  const models = useMemo(() => modelsQuery.data?.items ?? [], [modelsQuery.data]);
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data]);

  const selectedModel = useMemo(() => models.find((item) => item.id === selectedModelId) ?? null, [models, selectedModelId]);

  const currentVersionQuery = useQuery({
    queryKey: ["atp-model-current-version", selectedModelId, selectedModel?.active_version_no],
    enabled: Boolean(user) && canRead && Boolean(selectedModelId),
    queryFn: async () => {
      if (!versionListPath || !selectedModelId) {
        return null;
      }
      const response = await fetchWithAuth(versionListPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as AtpModelVersionListResponse;
      const preferred =
        payload.items.find((item) => item.version_no === selectedModel?.active_version_no)
        ?? payload.items[0]
        ?? null;
      if (!preferred) {
        return null;
      }

      const detailResponse = await fetchWithAuth(`/api/v1/atp/models/${selectedModelId}/versions/${preferred.id}`);
      if (!detailResponse.ok) {
        throw new Error(await readApiError(detailResponse));
      }
      return (await detailResponse.json()) as AtpModelVersionDetail;
    },
  });

  const runDetailQuery = useQuery({
    queryKey: ["atp-model-run-detail", runDetailPath],
    enabled: Boolean(user) && canRead && Boolean(runDetailOpen) && Boolean(runDetailPath),
    queryFn: async () => {
      if (!runDetailPath) {
        throw new Error("运行记录不存在");
      }
      const response = await fetchWithAuth(runDetailPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpSimulationRunDetail;
    },
  });

  const engineQuery = useQuery({
    queryKey: ["atp-engine-status"],
    enabled: Boolean(user) && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/atp/models/engine/status");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpEngineStatusResponse;
    },
    staleTime: 30_000,
  });

  const refreshModels = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0] === "atp-models",
    });
  }, [queryClient]);

  const refreshVersions = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && (query.queryKey[0] === "atp-model-versions" || query.queryKey[0] === "atp-model-current-version"),
    });
  }, [queryClient]);

  const refreshRuns = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0] === "atp-model-runs",
    });
  }, [queryClient]);

  useTopicSubscription("admin.atp-models", useCallback(() => {
    void refreshModels();
    void refreshVersions();
    void refreshRuns();
  }, [refreshModels, refreshRuns, refreshVersions]));

  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].id);
      return;
    }
    if (selectedModelId && !models.some((item) => item.id === selectedModelId)) {
      setSelectedModelId(models.length > 0 ? models[0].id : null);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    runForm.setFieldsValue(DEFAULT_RUN_FORM);
  }, [runForm]);

  useEffect(() => {
    const detail = currentVersionQuery.data ?? null;
    setCurrentVersionDetail(detail);
    if (!detail) {
      setSourceText("");
      setGraphJson(null);
      setParseWarnings([]);
      setParseError("");
      versionForm.setFieldsValue(DEFAULT_VERSION_FORM);
      return;
    }
    setSourceText(detail.atp_text);
    versionForm.setFieldsValue({
      version_tag: detail.version_tag ?? "",
      entry_file: detail.entry_file ?? "",
      change_note: detail.change_note,
      artifact_manifest_json: JSON.stringify(detail.artifact_manifest_json ?? {}, null, 2),
      atp_text: detail.atp_text,
    });
    const maybeGraph = detail.graph_json as AtpGraphJson;
    if (maybeGraph && typeof maybeGraph === "object" && maybeGraph.format === "atp-graph-json-v1") {
      setGraphJson(maybeGraph);
      setParseWarnings(Array.isArray(maybeGraph.warnings) ? maybeGraph.warnings : []);
      setParseError("");
    } else {
      setGraphJson(null);
      setParseWarnings([]);
    }
  }, [currentVersionQuery.data, versionForm]);

  const saveModelMutation = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        source_type: values.source_type,
        status: values.status,
        description: values.description.trim(),
        tags_json: parseTagInput(values.tags),
      };

      if (editingModel) {
        const response = await fetchWithAuth(`/api/v1/atp/models/${editingModel.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            source_type: payload.source_type,
            status: payload.status,
            description: payload.description,
            tags_json: payload.tags_json,
          }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "updated" as const;
      }

      const response = await fetchWithAuth("/api/v1/atp/models", {
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
      setSuccess(mode === "created" ? "模型已创建" : "模型已更新");
      setModelModalOpen(false);
      setEditingModel(null);
      modelForm.resetFields();
      await refreshModels();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存模型失败");
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (modelId: string) => {
      const response = await fetchWithAuth(`/api/v1/atp/models/${modelId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return modelId;
    },
    onSuccess: async (modelId) => {
      if (selectedModelId === modelId) {
        setSelectedModelId(null);
      }
      setError("");
      setSuccess("模型已删除");
      await refreshModels();
      await refreshVersions();
      await refreshRuns();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除模型失败");
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: async (values: VersionFormValues) => {
      if (!selectedModelId) {
        throw new Error("请先选择模型");
      }
      let manifest: Record<string, unknown> = {};
      const rawManifest = values.artifact_manifest_json.trim();
      if (rawManifest) {
        try {
          const parsed = JSON.parse(rawManifest) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            manifest = parsed as Record<string, unknown>;
          } else {
            throw new Error("artifact_manifest_json 必须是 JSON 对象");
          }
        } catch (candidate) {
          throw new Error(candidate instanceof Error ? candidate.message : "artifact_manifest_json 不是合法 JSON");
        }
      }

      const payload = {
        version_tag: values.version_tag.trim() || null,
        entry_file: values.entry_file.trim() || null,
        change_note: values.change_note.trim(),
        artifact_manifest_json: manifest,
        graph_json: graphJson ?? {},
        atp_text: values.atp_text,
      };

      const requestPath = currentVersionDetail
        ? `/api/v1/atp/models/${selectedModelId}/versions/${currentVersionDetail.id}`
        : `/api/v1/atp/models/${selectedModelId}/versions`;
      const response = await fetchWithAuth(requestPath, {
        method: currentVersionDetail ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentVersionDetail ? payload : { ...payload, status: "released" }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpModelVersionDetail;
    },
    onSuccess: async (result) => {
      setError("");
      setSuccess(currentVersionDetail ? "当前模板已保存" : `模板 v${result.version_no} 已创建`);
      setVersionModalOpen(false);
      versionForm.resetFields();
      await refreshModels();
      await refreshVersions();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建版本失败");
    },
  });

  const runMutation = useMutation({
    mutationFn: async (values: RunFormValues) => {
      if (!selectedModelId) {
        throw new Error("请先选择模型");
      }

      const payload = {
        timeout_seconds: values.timeout_seconds ?? null,
        extra_args: splitExtraArgs(values.extra_args),
        dry_run: values.dry_run,
      };

      const response = await fetchWithAuth(`/api/v1/atp/models/${selectedModelId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpSimulationRunDetail;
    },
    onSuccess: async (result) => {
      setError("");
      setSuccess(result.status === "success" ? "仿真任务执行成功" : "仿真任务执行完成");
      setActiveRunId(result.id);
      setRunDetailOpen(true);
      await refreshRuns();
      await refreshModels();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "执行仿真失败");
    },
  });

  const handleConvert = () => {
    if (!sourceText.trim()) {
      setParseError("请先输入或上传 ATP 文本。");
      setParseWarnings([]);
      setGraphJson(null);
      return;
    }

    try {
      const parsed = parseAtpTextToGraphJson(sourceText);
      setGraphJson(parsed.graph);
      setParseWarnings(parsed.warnings);
      setParseError("");
      versionForm.setFieldValue("atp_text", sourceText);
    } catch (candidate) {
      setGraphJson(null);
      setParseWarnings([]);
      setParseError(candidate instanceof Error ? candidate.message : "ATP 解析失败");
    }
  };

  const handleLoadSample = () => {
    setSourceText(ATP_SAMPLE_TEXT);
    versionForm.setFieldValue("atp_text", ATP_SAMPLE_TEXT);
    setParseError("");
    setParseWarnings([]);
    setGraphJson(null);
  };

  const handleFileSelected = async (file: File) => {
    try {
      const { text: content } = await readTextFile(file);
      setSourceText(content);
      versionForm.setFieldValue("atp_text", content);
      setParseError("");
      setParseWarnings([]);
      setGraphJson(null);
    } catch (candidate) {
      setParseError(candidate instanceof Error ? candidate.message : "文件读取失败");
    }
  };

  const handleExportJson = () => {
    if (!graphJson) {
      return;
    }

    const blob = new Blob([stringifyAtpGraphJson(graphJson)], {
      type: "application/json;charset=utf-8",
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "atp-graph.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
  };

  const openCreateModelModal = () => {
    setEditingModel(null);
    modelForm.setFieldsValue(DEFAULT_MODEL_FORM);
    setModelModalOpen(true);
  };

  const openEditModelModal = useCallback((item: AtpModelSummary) => {
    setEditingModel(item);
    modelForm.setFieldsValue({
      code: item.code,
      name: item.name,
      source_type: item.source_type,
      status: item.status,
      tags: item.tags_json.join(", "),
      description: item.description,
    });
    setModelModalOpen(true);
  }, [modelForm]);

  const openVersionEditorModal = () => {
    versionForm.setFieldsValue({
      ...DEFAULT_VERSION_FORM,
      atp_text: sourceText,
      artifact_manifest_json: currentVersionDetail
        ? JSON.stringify(currentVersionDetail.artifact_manifest_json ?? {}, null, 2)
        : buildDefaultManifest(sourceText),
      version_tag: currentVersionDetail?.version_tag ?? "",
      entry_file: currentVersionDetail?.entry_file ?? "",
      change_note: currentVersionDetail?.change_note ?? "",
    });
    setVersionModalOpen(true);
  };

  const modelColumns = useMemo<ColumnsType<AtpModelSummary>>(
    () => [
      {
        title: "编码",
        dataIndex: "code",
        width: 160,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "名称",
        dataIndex: "name",
        width: 220,
      },
      {
        title: "来源",
        dataIndex: "source_type",
        width: 110,
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: string) => formatModelStatus(value),
      },
      {
        title: "模板",
        key: "version_summary",
        width: 150,
        render: (_: unknown, row) => row.latest_version_no > 0 ? `当前模板 v${row.active_version_no ?? row.latest_version_no}` : "未配置",
      },
      {
        title: "运行",
        key: "run_summary",
        width: 180,
        render: (_: unknown, row) => (
          <Space size={6} wrap>
            <Typography.Text>{row.run_count}</Typography.Text>
            {row.last_run_status ? formatRunStatus(row.last_run_status) : <Tag>无记录</Tag>}
          </Space>
        ),
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        width: 180,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "操作",
        key: "actions",
        width: 170,
        fixed: "right",
        render: (_: unknown, row) => (
          <Space size={8}>
            {canManage && (
              <Button size="small" onClick={() => openEditModelModal(row)}>
                编辑
              </Button>
            )}
            {canManage && (
              <Popconfirm
                title="删除模型"
                description={`确认删除模型 ${row.code} 吗？`}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={async () => {
                  await deleteModelMutation.mutateAsync(row.id);
                }}
              >
                <Button size="small" danger loading={deleteModelMutation.isPending}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [canManage, deleteModelMutation, openEditModelModal],
  );

  const runColumns = useMemo<ColumnsType<AtpSimulationRunSummary>>(
    () => [
      {
        title: "任务ID",
        dataIndex: "id",
        width: 220,
        render: (value: string) => <Typography.Text copyable>{value.slice(0, 12)}</Typography.Text>,
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: string) => formatRunStatus(value),
      },
      {
        title: "版本",
        dataIndex: "version_no",
        width: 90,
        render: (value: number | null) => (value === null ? "-" : `v${value}`),
      },
      {
        title: "引擎",
        dataIndex: "engine_mode",
        width: 80,
      },
      {
        title: "退出码",
        dataIndex: "exit_code",
        width: 90,
        render: (value: number | null) => (value === null ? "-" : value),
      },
      {
        title: "耗时(ms)",
        dataIndex: "duration_ms",
        width: 100,
        render: (value: number | null) => (value === null ? "-" : value),
      },
      {
        title: "时间",
        dataIndex: "create_date",
        width: 180,
        render: (value: string) => formatDateTime(value),
      },
      {
        title: "错误摘要",
        dataIndex: "error_message",
        width: 260,
        render: (value: string | null) => (
          value
            ? (
              <Typography.Text type="danger" ellipsis={{ tooltip: value }}>
                {value}
              </Typography.Text>
            )
            : "-"
        ),
      },
      {
        title: "操作",
        key: "actions",
        width: 90,
        fixed: "right",
        render: (_: unknown, row) => (
          <Button
            size="small"
            onClick={() => {
              setActiveRunId(row.id);
              setRunDetailOpen(true);
            }}
          >
            日志
          </Button>
        ),
      },
    ],
    [],
  );

  const jsonPreview = useMemo(() => {
    if (!graphJson) {
      return "";
    }
    return stringifyAtpGraphJson(graphJson);
  }, [graphJson]);

  if (initializing) {
    return (
      <Card>
        <Typography.Text type="secondary">正在初始化权限上下文...</Typography.Text>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再使用 ATP 模型管理。</Typography.Text>
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
          <Typography.Text type="secondary">当前账号无 ATP 模块权限（需要 `atp.read/atp.run/atp.manage`）。</Typography.Text>
          <Button>
            <Link href="/power-lines">返回线路管理</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  const modelError = modelsQuery.error instanceof Error ? modelsQuery.error.message : "";
  const versionError = currentVersionQuery.error instanceof Error ? currentVersionQuery.error.message : "";
  const runError = runsQuery.error instanceof Error ? runsQuery.error.message : "";
  const engineError = engineQuery.error instanceof Error ? engineQuery.error.message : "";

  return (
    <Space direction="vertical" size={16} className="w-full">
      {(error || modelError || versionError || runError || engineError) && (
        <Alert type="error" showIcon message="操作失败" description={error || modelError || versionError || runError || engineError} />
      )}
      {success && <Alert type="success" showIcon message="操作成功" description={success} />}

      <Card
        title="ATP模型台账"
        extra={(
          <Space size={8} wrap>
            <Button href={withBasePath("/power-lines")}>返回线路管理</Button>
            {canManage && (
              <Button type="primary" onClick={openCreateModelModal}>
                新建模型
              </Button>
            )}
          </Space>
        )}
      >
        <Space direction="vertical" size={12} className="w-full">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={modelKeyword}
              allowClear
              onChange={(event) => setModelKeyword(event.target.value)}
              placeholder="按模型编码/名称筛选"
            />
            <Select
              value={modelStatusFilter}
              options={[...MODEL_STATUS_OPTIONS]}
              onChange={(value) => setModelStatusFilter(value)}
            />
          </div>

          <Table<AtpModelSummary>
            rowKey={(row) => row.id}
            columns={modelColumns}
            dataSource={models}
            loading={modelsQuery.isFetching}
            pagination={false}
            scroll={{ x: 1500 }}
            rowClassName={(row) => (row.id === selectedModelId ? "fquiz-row-selected" : "")}
            onRow={(row) => ({
              onClick: () => setSelectedModelId(row.id),
            })}
          />
        </Space>
      </Card>

      <Card
        title={selectedModel ? `模型模板 - ${selectedModel.name}` : "模型模板"}
        extra={(
          <Space size={8} wrap>
            {canManage && (
              <Button type="primary" onClick={openVersionEditorModal} disabled={!selectedModelId}>
                {currentVersionDetail ? "编辑当前模板" : "创建模板"}
              </Button>
            )}
          </Space>
        )}
      >
        {!selectedModelId ? (
          <Empty description="请先选择模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={12} className="w-full">
            {currentVersionDetail ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <Card><Statistic title="当前模板" value={`v${currentVersionDetail.version_no}`} /></Card>
                  <Card><Statistic title="入口文件" value={currentVersionDetail.entry_file || "-"} /></Card>
                  <Card><Statistic title="文本大小" value={`${currentVersionDetail.atp_text_size} B`} /></Card>
                  <Card><Statistic title="最近更新" value={formatDateTime(currentVersionDetail.update_date)} /></Card>
                </div>
                <Alert
                  type="info"
                  showIcon
                  message={`当前模板：v${currentVersionDetail.version_no}${currentVersionDetail.version_tag ? ` / ${currentVersionDetail.version_tag}` : ""}`}
                  description={currentVersionDetail.change_note || "当前模型模板已就绪，可直接执行仿真或进入编辑。"}
                />
                <TextArea value={currentVersionDetail.atp_text} readOnly autoSize={{ minRows: 10, maxRows: 18 }} />
              </>
            ) : (
              <Empty description="当前模型还没有模板，请先创建模板。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Space>
        )}
      </Card>

      <Card
        title={selectedModel ? `仿真运行 - ${selectedModel.name}` : "仿真运行"}
      >
        {!selectedModelId ? (
          <Empty description="请先选择模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={12} className="w-full">
            <div className="grid gap-3 md:grid-cols-4">
              <Card>
                <Statistic title="引擎模式" value={engineQuery.data?.mode ?? "-"} />
              </Card>
              <Card>
                <Statistic title="引擎可用" value={engineQuery.data?.available ? "可用" : "不可用"} />
              </Card>
              <Card>
                <Statistic title="运行记录" value={runs.length} />
              </Card>
              <Card>
                <Statistic title="当前模板" value={currentVersionDetail ? `v${currentVersionDetail.version_no}` : "-"} />
              </Card>
            </div>

            <Form<RunFormValues>
              form={runForm}
              layout="inline"
              initialValues={DEFAULT_RUN_FORM}
              onFinish={(values) => {
                runMutation.mutate(values);
              }}
            >
              <Form.Item name="timeout_seconds" label="超时(秒)">
                <InputNumber min={1} max={3600} style={{ width: 120 }} placeholder="默认" />
              </Form.Item>
              <Form.Item name="extra_args" label="附加参数">
                <Input placeholder="例如: -o result.lis" style={{ width: 220 }} />
              </Form.Item>
              <Form.Item name="dry_run" label="Dry Run" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={runMutation.isPending} disabled={!canRun || !currentVersionDetail}>
                  执行仿真
                </Button>
              </Form.Item>
            </Form>

            {!canRun && <Typography.Text type="secondary">当前账号无仿真执行权限（需要 `atp.run` 或 `atp.manage`）。</Typography.Text>}
            {canRun && !currentVersionDetail && <Typography.Text type="secondary">当前模型还没有模板，无法执行仿真。</Typography.Text>}

            <Table<AtpSimulationRunSummary>
              rowKey={(row) => row.id}
              columns={runColumns}
              dataSource={runs}
              loading={runsQuery.isFetching}
              pagination={false}
              scroll={{ x: 1640 }}
            />
          </Space>
        )}
      </Card>

      <Card
        title="ATP文本转换与预览"
        extra={(
          <Space size={8} wrap>
            <Button onClick={() => fileInputRef.current?.click()}>上传 ATP 文本</Button>
            <Button onClick={handleLoadSample}>载入示例</Button>
            <Button type="primary" onClick={handleConvert}>转换并渲染</Button>
            <Button onClick={handleExportJson} disabled={!graphJson}>导出 JSON</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} className="w-full">
          <input
            ref={fileInputRef}
            type="file"
            accept=".atp,.txt,.lis,.dat,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFileSelected(file);
              }
              event.target.value = "";
            }}
          />

          {parseError && <Alert type="error" showIcon message="转换失败" description={parseError} />}

          {parseWarnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`解析告警 (${parseWarnings.length})`}
              description={(
                <Space direction="vertical" size={4}>
                  {parseWarnings.slice(0, 5).map((warning) => (
                    <Typography.Text key={warning} type="secondary">{warning}</Typography.Text>
                  ))}
                  {parseWarnings.length > 5 && (
                    <Typography.Text type="secondary">其余 {parseWarnings.length - 5} 条请查看 JSON 的 warnings 字段。</Typography.Text>
                  )}
                </Space>
              )}
            />
          )}

          <TextArea
            value={sourceText}
            onChange={(event) => {
              const next = event.target.value;
              setSourceText(next);
              versionForm.setFieldValue("atp_text", next);
            }}
            placeholder="粘贴 ATP 文本后点击“转换并渲染”"
            autoSize={{ minRows: 12, maxRows: 18 }}
          />

          <div className="grid gap-3 md:grid-cols-4">
            <Card>
              <Statistic title="总行数" value={graphJson?.stats.total_lines ?? 0} />
            </Card>
            <Card>
              <Statistic title="解析行数" value={graphJson?.stats.parsed_lines ?? 0} />
            </Card>
            <Card>
              <Statistic title="节点数" value={graphJson?.stats.node_count ?? 0} />
            </Card>
            <Card>
              <Space direction="vertical" size={6}>
                <Statistic title="元件数" value={graphJson?.stats.element_count ?? 0} />
                {graphJson && (
                  <Tag color={graphJson.stats.warning_count > 0 ? "orange" : "green"}>告警 {graphJson.stats.warning_count}</Tag>
                )}
              </Space>
            </Card>
          </div>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Card title="转换 JSON 预览">
              {graphJson ? (
                <TextArea value={jsonPreview} readOnly autoSize={{ minRows: 22, maxRows: 36 }} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成 JSON" />
              )}
            </Card>

            <Card title="X6 渲染结果">
              <AtpX6Viewer graph={graphJson} />
            </Card>
          </div>
        </Space>
      </Card>

      <Modal
        title={editingModel ? "编辑模型" : "新建模型"}
        open={modelModalOpen}
        okText={editingModel ? "保存" : "创建"}
        confirmLoading={saveModelMutation.isPending}
        onCancel={() => {
          if (saveModelMutation.isPending) {
            return;
          }
          setModelModalOpen(false);
          setEditingModel(null);
        }}
        onOk={async () => {
          const values = await modelForm.validateFields();
          saveModelMutation.mutate(values);
        }}
      >
        <Form<ModelFormValues> form={modelForm} layout="vertical" initialValues={DEFAULT_MODEL_FORM}>
          <Form.Item name="code" label="模型编码" rules={[{ required: true, message: "请输入模型编码" }]}>
            <Input disabled={Boolean(editingModel)} />
          </Form.Item>
          <Form.Item name="name" label="模型名称" rules={[{ required: true, message: "请输入模型名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="source_type" label="来源类型">
            <Select options={[...MODEL_SOURCE_OPTIONS]} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[...MODEL_ENABLE_STATUS_OPTIONS]} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="逗号分隔，例如：输电线路, 雷击" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={currentVersionDetail ? "编辑当前模板" : "创建模板"}
        open={versionModalOpen}
        width={900}
        okText={currentVersionDetail ? "保存模板" : "创建模板"}
        confirmLoading={createVersionMutation.isPending}
        onCancel={() => {
          if (createVersionMutation.isPending) {
            return;
          }
          setVersionModalOpen(false);
        }}
        onOk={async () => {
          const values = await versionForm.validateFields();
          createVersionMutation.mutate(values);
        }}
      >
        <Form<VersionFormValues>
          form={versionForm}
          layout="vertical"
          initialValues={DEFAULT_VERSION_FORM}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="version_tag" label="模板标签">
              <Input placeholder="例如：220kV-输电线路模板" />
            </Form.Item>
            <Form.Item name="entry_file" label="入口文件名">
              <Input placeholder="例如：line_model.atp" />
            </Form.Item>
          </div>
          <Form.Item name="change_note" label="变更说明">
            <TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
          <Form.Item name="artifact_manifest_json" label="产物清单(JSON对象)">
            <TextArea autoSize={{ minRows: 4, maxRows: 8 }} />
          </Form.Item>
          <Form.Item
            name="atp_text"
            label="ATP文本"
            rules={[{ required: true, message: "请填写 ATP 文本" }]}
          >
            <TextArea autoSize={{ minRows: 10, maxRows: 18 }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`运行日志${runDetailQuery.data?.id ? ` - ${runDetailQuery.data.id}` : ""}`}
        open={runDetailOpen}
        width={960}
        footer={(
          <Space>
            <Button
              onClick={() => {
                void runDetailQuery.refetch();
              }}
              loading={runDetailQuery.isFetching}
            >
              刷新
            </Button>
            <Button onClick={() => setRunDetailOpen(false)}>关闭</Button>
          </Space>
        )}
        onCancel={() => setRunDetailOpen(false)}
      >
        {runDetailQuery.isLoading ? (
          <Typography.Text type="secondary">正在加载日志...</Typography.Text>
        ) : runDetailQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="日志加载失败" description={runDetailQuery.error.message} />
        ) : runDetailQuery.data ? (
          <Space direction="vertical" size={12} className="w-full">
            <div className="grid gap-3 md:grid-cols-3">
              <Card><Statistic title="状态" value={runDetailQuery.data.status} /></Card>
              <Card><Statistic title="版本" value={runDetailQuery.data.version_no ? `v${runDetailQuery.data.version_no}` : "-"} /></Card>
              <Card><Statistic title="退出码" value={runDetailQuery.data.exit_code ?? "-"} /></Card>
            </div>
            <Card title="标准输出">
              <TextArea value={runDetailQuery.data.stdout_text ?? ""} readOnly autoSize={{ minRows: 10, maxRows: 18 }} />
            </Card>
            <Card title="标准错误">
              <TextArea value={runDetailQuery.data.stderr_text ?? ""} readOnly autoSize={{ minRows: 6, maxRows: 14 }} />
            </Card>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志数据" />
        )}
      </Modal>
    </Space>
  );
}
