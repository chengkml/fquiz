"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import { AdminPageLoading } from "@/components/admin-page-loading";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type {
  AtpAssetFileEntry,
  AtpAssetFileListResponse,
  AtpAssetReleaseDetail,
  AtpAssetReleaseListResponse,
  AtpAssetReleaseSummary,
  AtpAssetRunDetail,
  AtpAssetRunListResponse,
  AtpAssetRunSummary,
  AtpAssetSummary,
  AtpEngineStatusResponse,
} from "@/types/auth";

type ReleaseFormValues = {
  release_tag: string;
  status: "draft" | "released" | "archived";
  voltage_level: string;
  tower_type: string;
  scene_type: string;
  scenario_code: string;
  runner_kind: "atp" | "egm" | "hybrid";
  storage_mount_code: string;
  storage_root_path: string;
  entry_file: string;
  result_file: string;
  egm_subdir: string;
  egm_result_file: string;
  preprocess_script: string;
  postprocess_script: string;
};

type RunFormValues = {
  dry_run: boolean;
  timeout_seconds: number | null;
  extra_args_text: string;
};

const EMPTY_RELEASE_FORM: ReleaseFormValues = {
  release_tag: "",
  status: "released",
  voltage_level: "",
  tower_type: "",
  scene_type: "",
  scenario_code: "",
  runner_kind: "atp",
  storage_mount_code: "main",
  storage_root_path: "",
  entry_file: "",
  result_file: "",
  egm_subdir: "",
  egm_result_file: "",
  preprocess_script: "",
  postprocess_script: "",
};

const EMPTY_RUN_FORM: RunFormValues = {
  dry_run: true,
  timeout_seconds: null,
  extra_args_text: "",
};

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

function statusColor(value: string): string {
  if (value === "enabled" || value === "released" || value === "success") return "green";
  if (value === "draft" || value === "running") return "gold";
  if (value === "pending") return "blue";
  if (value === "disabled") return "default";
  if (value === "failed" || value === "archived") return "red";
  return "blue";
}

function toReleaseFormValues(item: AtpAssetReleaseSummary): ReleaseFormValues {
  return {
    release_tag: item.release_tag ?? "",
    status: item.status,
    voltage_level: item.voltage_level,
    tower_type: item.tower_type,
    scene_type: item.scene_type,
    scenario_code: item.scenario_code ?? "",
    runner_kind: item.runner_kind,
    storage_mount_code: item.storage_mount_code,
    storage_root_path: item.storage_root_path,
    entry_file: item.entry_file ?? "",
    result_file: item.result_file ?? "",
    egm_subdir: item.egm_subdir ?? "",
    egm_result_file: item.egm_result_file ?? "",
    preprocess_script: item.preprocess_script ?? "",
    postprocess_script: item.postprocess_script ?? "",
  };
}

function buildReleasePayload(values: ReleaseFormValues) {
  return {
    release_tag: values.release_tag.trim() || null,
    status: values.status,
    voltage_level: values.voltage_level.trim(),
    tower_type: values.tower_type.trim(),
    scene_type: values.scene_type.trim(),
    scenario_code: values.scenario_code.trim() || null,
    runner_kind: values.runner_kind,
    storage_mount_code: values.storage_mount_code.trim(),
    storage_root_path: values.storage_root_path.trim(),
    entry_file: values.entry_file.trim() || null,
    result_file: values.result_file.trim() || null,
    egm_subdir: values.egm_subdir.trim() || null,
    egm_result_file: values.egm_result_file.trim() || null,
    preprocess_script: values.preprocess_script.trim() || null,
    postprocess_script: values.postprocess_script.trim() || null,
  };
}

function buildRunPayload(values: RunFormValues) {
  return {
    dry_run: values.dry_run,
    timeout_seconds: values.timeout_seconds || null,
    extra_args: values.extra_args_text
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export default function AtpAssetDetailPage() {
  const { message } = App.useApp();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const assetId = typeof params?.id === "string" ? params.id : "";
  const [releaseForm] = Form.useForm<ReleaseFormValues>();
  const [runForm] = Form.useForm<RunFormValues>();

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<AtpAssetReleaseSummary | null>(null);
  const [selectedReleaseIdState, setSelectedReleaseIdState] = useState<string>("");

  const canRead = hasPermission("atp.read") || hasPermission("atp.run") || hasPermission("atp.manage");
  const canRun = hasPermission("atp.run") || hasPermission("atp.manage");
  const canManage = hasPermission("atp.manage");

  const assetQuery = useQuery({
    queryKey: ["atp-asset-detail", assetId],
    enabled: Boolean(user && canRead && assetId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/assets/${assetId}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetSummary;
    },
  });

  const releasesQuery = useQuery({
    queryKey: ["atp-asset-releases", assetId],
    enabled: Boolean(user && canRead && assetId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/assets/${assetId}/releases`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetReleaseListResponse;
    },
  });

  const engineQuery = useQuery({
    queryKey: ["atp-asset-engine-status"],
    enabled: Boolean(user && canRead),
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/atp/engine/status");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpEngineStatusResponse;
    },
  });

  const releases = releasesQuery.data?.items ?? [];
  const selectedReleaseId =
    selectedReleaseIdState && releases.some((item) => item.id === selectedReleaseIdState)
      ? selectedReleaseIdState
      : (releases.find((item) => item.is_active)?.id ?? releases[0]?.id ?? "");
  const selectedRelease = releases.find((item) => item.id === selectedReleaseId) ?? null;

  const releaseDetailQuery = useQuery({
    queryKey: ["atp-release-detail", selectedReleaseId],
    enabled: Boolean(user && canRead && selectedReleaseId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${selectedReleaseId}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetReleaseDetail;
    },
  });

  const filesQuery = useQuery({
    queryKey: ["atp-release-files", selectedReleaseId],
    enabled: Boolean(user && canRead && selectedReleaseId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${selectedReleaseId}/files`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetFileListResponse;
    },
  });

  const runsQuery = useQuery({
    queryKey: ["atp-release-runs", selectedReleaseIdState],
    enabled: Boolean(user && canRead && selectedReleaseIdState),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${selectedReleaseIdState}/runs`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetRunListResponse;
    },
  });

  const saveReleaseMutation = useMutation({
    mutationFn: async (values: ReleaseFormValues) => {
      const payload = buildReleasePayload(values);
      const response = editingRelease
        ? await fetchWithAuth(`/api/v1/atp/releases/${editingRelease.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchWithAuth(`/api/v1/atp/assets/${assetId}/releases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetReleaseDetail;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["atp-asset-detail", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["atp-asset-releases", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["atp-release-detail", result.id] });
      setSelectedReleaseIdState(result.id);
      setReleaseModalOpen(false);
      setEditingRelease(null);
      releaseForm.resetFields();
      message.success(editingRelease ? "Release 已更新" : "Release 已创建");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "保存 release 失败");
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${releaseId}/activate`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["atp-asset-detail", assetId] });
      void queryClient.invalidateQueries({ queryKey: ["atp-asset-releases", assetId] });
      message.success("已切换当前激活 release");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "激活 release 失败");
    },
  });

  const runMutation = useMutation({
    mutationFn: async (values: RunFormValues) => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${selectedReleaseId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRunPayload(values)),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetRunDetail;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["atp-release-runs", selectedReleaseId] });
      setRunModalOpen(false);
      runForm.resetFields();
      message.success("运行任务已提交");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "提交运行任务失败");
    },
  });
  const releaseDetail = releaseDetailQuery.data ?? null;

  const releaseColumns = useMemo<ColumnsType<AtpAssetReleaseSummary>>(
    () => [
      {
        title: "Release",
        key: "release",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{item.release_tag || `r${item.release_no}`}</Typography.Text>
            <Typography.Text type="secondary">
              {item.runner_kind} / {item.storage_mount_code}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "维度",
        key: "dimensions",
        render: (_, item) => (
          <Space size={[4, 4]} wrap>
            <Tag>{item.voltage_level}</Tag>
            <Tag>{item.tower_type}</Tag>
            <Tag>{item.scene_type}</Tag>
            {item.scenario_code ? <Tag color="blue">{item.scenario_code}</Tag> : null}
          </Space>
        ),
      },
      {
        title: "存储根",
        dataIndex: "storage_root_path",
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "状态",
        key: "status",
        render: (_, item) => (
          <Space wrap>
            <Tag color={statusColor(item.status)}>{item.status}</Tag>
            {item.is_active ? <Tag color="green">active</Tag> : null}
          </Space>
        ),
      },
      {
        title: "操作",
        key: "actions",
        render: (_, item) => (
          <Space wrap>
            <Button size="small" type={item.id === selectedReleaseId ? "primary" : "default"} onClick={() => setSelectedReleaseIdState(item.id)}>
              查看
            </Button>
            <Button
              size="small"
              disabled={!canManage}
              onClick={() => {
                setEditingRelease(item);
                releaseForm.setFieldsValue(toReleaseFormValues(item));
                setReleaseModalOpen(true);
              }}
            >
              编辑
            </Button>
            <Button size="small" disabled={!canManage || item.is_active} onClick={() => void activateMutation.mutateAsync(item.id)}>
              激活
            </Button>
          </Space>
        ),
      },
    ],
    [activateMutation, canManage, releaseForm, selectedReleaseId],
  );

  const fileColumns = useMemo<ColumnsType<AtpAssetFileEntry>>(
    () => [
      {
        title: "路径",
        dataIndex: "relative_path",
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "角色",
        dataIndex: "file_role",
        render: (value: string | null) => (value ? <Tag>{value}</Tag> : "-"),
      },
      {
        title: "大小",
        dataIndex: "size",
        render: (value: number, item) => (item.is_dir ? "-" : `${value} B`),
      },
    ],
    [],
  );

  const runColumns = useMemo<ColumnsType<AtpAssetRunSummary>>(
    () => [
      {
        title: "状态",
        key: "status",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Tag color={statusColor(item.status)}>{item.status}</Tag>
            <Typography.Text type="secondary">{formatDateTime(item.create_date)}</Typography.Text>
          </Space>
        ),
      },
      {
        title: "执行信息",
        key: "execution",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text>{item.runner_kind} / {item.engine_mode}</Typography.Text>
            <Typography.Text type="secondary">
              {item.timeout_seconds}s / exit {item.exit_code ?? "-"}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "日志尺寸",
        key: "logs",
        render: (_, item) => `${item.stdout_size} / ${item.stderr_size} B`,
      },
      {
        title: "错误",
        dataIndex: "error_message",
        render: (value: string | null) => value || "-",
      },
    ],
    [],
  );

  if (initializing) {
    return <AdminPageLoading tip="加载 ATP 资料包详情中..." minHeightClassName="min-h-[280px]" />;
  }

  if (!user || !canRead) {
    return (
      <Card title="ATP 资料包详情">
        <Typography.Text type="secondary">
          {!user ? "请先登录后再查看 ATP 资料包详情。" : "当前账号无 ATP 模块权限（需要 atp.read/atp.run/atp.manage）。"}
        </Typography.Text>
      </Card>
    );
  }

  if (assetQuery.isLoading) {
    return <AdminPageLoading tip="加载 ATP 资料包详情中..." minHeightClassName="min-h-[280px]" />;
  }

  if (assetQuery.error instanceof Error) {
    return (
      <Card title="ATP 资料包详情">
        <Alert type="error" showIcon message="资料包详情加载失败" description={assetQuery.error.message} />
      </Card>
    );
  }

  const asset = assetQuery.data;
  if (!asset) {
    return (
      <Card title="ATP 资料包详情">
        <Empty description="未找到对应资料包" />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={asset.name}
        extra={
          <Space wrap>
            <Link href="/admin/atp-models">
              <Button>返回列表</Button>
            </Link>
            <Link href="/admin/power-lines/atp-viewer">
              <Button>Legacy 文本工具</Button>
            </Link>
            <Button
              type="primary"
              disabled={!canManage}
              onClick={() => {
                setEditingRelease(null);
                releaseForm.setFieldsValue({
                  ...EMPTY_RELEASE_FORM,
                  voltage_level: asset.voltage_level ?? "",
                  tower_type: asset.tower_type ?? "",
                  scene_type: asset.scene_type ?? "",
                });
                setReleaseModalOpen(true);
              }}
            >
              新建 Release
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type={engineQuery.data?.available ? "success" : "warning"}
            showIcon
            message={engineQuery.data?.available ? "运行环境可用" : "运行环境待检查"}
            description={
              engineQuery.data
                ? `模式：${engineQuery.data.mode}，执行器：${engineQuery.data.resolved_executable || engineQuery.data.executable_path}。`
                : engineQuery.error instanceof Error
                  ? engineQuery.error.message
                  : "目录化 release 会在运行前物化到本地 wine 允许运行根目录。"
            }
          />

          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="编码">{asset.code}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor(asset.status)}>{asset.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="电压等级">{asset.voltage_level || "-"}</Descriptions.Item>
            <Descriptions.Item label="塔型">{asset.tower_type || "-"}</Descriptions.Item>
            <Descriptions.Item label="场景">{asset.scene_type || "-"}</Descriptions.Item>
            <Descriptions.Item label="当前激活发布">
              {asset.active_release_tag || (asset.active_release_no ? `r${asset.active_release_no}` : "-")}
            </Descriptions.Item>
            <Descriptions.Item label="说明" span={2}>
              {asset.description || "-"}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card title="Release 列表">
        {releasesQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="Release 列表加载失败" description={releasesQuery.error.message} />
        ) : (
          <Table<AtpAssetReleaseSummary>
            rowKey="id"
            loading={releasesQuery.isLoading}
            columns={releaseColumns}
            dataSource={releases}
            locale={{ emptyText: "暂无 release" }}
            pagination={false}
            scroll={{ x: 1080 }}
          />
        )}
      </Card>

      <Card
        title={selectedRelease ? `当前 Release：${selectedRelease.release_tag || `r${selectedRelease.release_no}`}` : "当前 Release"}
        extra={
          <Space wrap>
            <Button disabled={!selectedReleaseId || !canRun} onClick={() => {
              runForm.setFieldsValue(EMPTY_RUN_FORM);
              setRunModalOpen(true);
            }}>
              运行 / Dry Run
            </Button>
          </Space>
        }
      >
        {!selectedRelease ? (
          <Empty description="请选择一个 release" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {releaseDetailQuery.error instanceof Error ? (
              <Alert type="error" showIcon message="Release 详情加载失败" description={releaseDetailQuery.error.message} />
            ) : null}

            {releaseDetail ? (
              <>
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="Runner">{releaseDetail.runner_kind}</Descriptions.Item>
                  <Descriptions.Item label="Storage Mount">{releaseDetail.storage_mount_code}</Descriptions.Item>
                  <Descriptions.Item label="Storage Root" span={2}>
                    <Typography.Text code>{releaseDetail.storage_root_path}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Entry File">{releaseDetail.entry_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Result File">{releaseDetail.result_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="EGM Subdir">{releaseDetail.egm_subdir || "-"}</Descriptions.Item>
                  <Descriptions.Item label="EGM Result">{releaseDetail.egm_result_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Preprocess">{releaseDetail.preprocess_script || "-"}</Descriptions.Item>
                  <Descriptions.Item label="Postprocess">{releaseDetail.postprocess_script || "-"}</Descriptions.Item>
                </Descriptions>

                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text strong>Manifest</Typography.Text>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify(releaseDetail.manifest_json, null, 2)}
                  </pre>
                  <Typography.Text strong>Validation</Typography.Text>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify(releaseDetail.validation_json, null, 2)}
                  </pre>
                </Space>
              </>
            ) : null}
          </Space>
        )}
      </Card>

      <Card title="目录文件清单">
        {filesQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="文件清单加载失败" description={filesQuery.error.message} />
        ) : (
          <Table<AtpAssetFileEntry>
            rowKey="relative_path"
            loading={filesQuery.isLoading}
            columns={fileColumns}
            dataSource={filesQuery.data?.items ?? []}
            locale={{ emptyText: selectedReleaseId ? "当前 release 暂无文件" : "请先选择 release" }}
            pagination={false}
            scroll={{ x: 980, y: 320 }}
          />
        )}
      </Card>

      <Card title="运行记录">
        {runsQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="运行记录加载失败" description={runsQuery.error.message} />
        ) : (
          <Table<AtpAssetRunSummary>
            rowKey="id"
            loading={runsQuery.isLoading}
            columns={runColumns}
            dataSource={runsQuery.data?.items ?? []}
            locale={{ emptyText: selectedReleaseId ? "当前 release 暂无运行记录" : "请先选择 release" }}
            pagination={false}
            scroll={{ x: 980 }}
          />
        )}
      </Card>

      <Modal
        title={editingRelease ? "编辑 Release" : "新建 Release"}
        open={releaseModalOpen}
        onCancel={() => {
          setReleaseModalOpen(false);
          setEditingRelease(null);
          releaseForm.resetFields();
        }}
        onOk={() => void releaseForm.submit()}
        confirmLoading={saveReleaseMutation.isPending}
        destroyOnClose
        width={760}
      >
        <Form<ReleaseFormValues>
          form={releaseForm}
          layout="vertical"
          initialValues={EMPTY_RELEASE_FORM}
          onFinish={(values) => void saveReleaseMutation.mutateAsync(values)}
        >
          <Form.Item name="release_tag" label="Release 标签">
            <Input placeholder="如 r1 / 220-raoji3" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
            <Select
              options={[
                { value: "draft", label: "draft" },
                { value: "released", label: "released" },
                { value: "archived", label: "archived" },
              ]}
            />
          </Form.Item>
          <Form.Item name="voltage_level" label="电压等级" rules={[{ required: true, message: "请输入电压等级" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="tower_type" label="塔型" rules={[{ required: true, message: "请输入塔型" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="scene_type" label="场景" rules={[{ required: true, message: "请输入场景" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="scenario_code" label="工况编码">
            <Input />
          </Form.Item>
          <Form.Item name="runner_kind" label="Runner" rules={[{ required: true, message: "请选择 runner" }]}>
            <Select
              options={[
                { value: "atp", label: "ATP" },
                { value: "egm", label: "EGM" },
                { value: "hybrid", label: "HYBRID" },
              ]}
            />
          </Form.Item>
          <Form.Item name="storage_mount_code" label="Storage Mount" rules={[{ required: true, message: "请输入 mount code" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="storage_root_path" label="Storage Root" rules={[{ required: true, message: "请输入目录根路径" }]}>
            <Input placeholder="/atp-library/releases/demo/r1" />
          </Form.Item>
          <Form.Item name="entry_file" label="入口文件">
            <Input placeholder="留空则自动探测 work.atp / 唯一 .atp" />
          </Form.Item>
          <Form.Item name="result_file" label="结果文件">
            <Input />
          </Form.Item>
          <Form.Item name="egm_subdir" label="EGM 子目录">
            <Input />
          </Form.Item>
          <Form.Item name="egm_result_file" label="EGM 结果文件">
            <Input />
          </Form.Item>
          <Form.Item name="preprocess_script" label="预处理脚本">
            <Input placeholder="仅支持 .py，相对 release 根目录" />
          </Form.Item>
          <Form.Item name="postprocess_script" label="后处理脚本">
            <Input placeholder="仅支持 .py，相对 release 根目录" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="运行 Release"
        open={runModalOpen}
        onCancel={() => {
          setRunModalOpen(false);
          runForm.resetFields();
        }}
        onOk={() => void runForm.submit()}
        confirmLoading={runMutation.isPending}
        destroyOnClose
      >
        <Form<RunFormValues>
          form={runForm}
          layout="vertical"
          initialValues={EMPTY_RUN_FORM}
          onFinish={(values) => void runMutation.mutateAsync(values)}
        >
          <Form.Item name="dry_run" label="Dry Run">
            <Select
              options={[
                { value: true, label: "是" },
                { value: false, label: "否" },
              ]}
            />
          </Form.Item>
          <Form.Item name="timeout_seconds" label="超时时间（秒）">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="extra_args_text" label="附加参数">
            <Input placeholder="多个参数用空格分隔" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
