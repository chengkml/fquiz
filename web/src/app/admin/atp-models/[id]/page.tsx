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
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { useMemo, useState } from "react";

import { AdminPageLoading } from "@/components/admin-page-loading";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import {
  getAtpAssetStatusDisplay,
  getAtpReleaseStatusDisplay,
  getAtpRunStatusDisplay,
  getAtpRunnerKindLabel,
} from "@/lib/atp-asset-display";
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
} from "@/types/auth";

type ReleaseFormValues = {
  release_tag: string;
  status: "draft" | "released" | "archived";
};

type RunFormValues = {
  dry_run: boolean;
  timeout_seconds: number | null;
  extra_args_text: string;
};

const EMPTY_RELEASE_FORM: ReleaseFormValues = {
  release_tag: "",
  status: "released",
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

function toReleaseFormValues(item: AtpAssetReleaseSummary): ReleaseFormValues {
  return {
    release_tag: item.release_tag ?? "",
    status: item.status,
  };
}

function buildReleasePatch(values: ReleaseFormValues) {
  return {
    release_tag: values.release_tag.trim() || null,
    status: values.status,
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
  const [selectedReleaseIdState, setSelectedReleaseIdState] = useState("");
  const [releaseArchiveFileList, setReleaseArchiveFileList] = useState<UploadFile[]>([]);

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
    queryKey: ["atp-release-runs", selectedReleaseId],
    enabled: Boolean(user && canRead && selectedReleaseId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/v1/atp/releases/${selectedReleaseId}/runs`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as AtpAssetRunListResponse;
    },
  });

  const saveReleaseMutation = useMutation({
    mutationFn: async (values: ReleaseFormValues) => {
      if (editingRelease) {
        const response = await fetchWithAuth(`/api/v1/atp/releases/${editingRelease.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildReleasePatch(values)),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return (await response.json()) as AtpAssetReleaseDetail;
      }

      const archiveFile = releaseArchiveFileList[0]?.originFileObj;
      if (!(archiveFile instanceof File)) {
        throw new Error("请上传版本 ZIP 包");
      }

      const formData = new FormData();
      formData.append("release_tag", values.release_tag.trim());
      formData.append("archive", archiveFile);
      const response = await fetchWithAuth(`/api/v1/atp/assets/${assetId}/releases/upload`, {
        method: "POST",
        body: formData,
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
      void queryClient.invalidateQueries({ queryKey: ["atp-release-files", result.id] });
      void queryClient.invalidateQueries({ queryKey: ["atp-release-runs", result.id] });
      setSelectedReleaseIdState(result.id);
      setReleaseModalOpen(false);
      setEditingRelease(null);
      setReleaseArchiveFileList([]);
      releaseForm.resetFields();
      message.success(editingRelease ? "版本已更新" : "版本已创建");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "保存版本失败");
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
      message.success("已切换当前激活版本");
    },
    onError: (candidate) => {
      message.error(candidate instanceof Error ? candidate.message : "激活版本失败");
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

  const releaseColumns = useMemo<ColumnsType<AtpAssetReleaseSummary>>(
    () => [
      {
        title: "版本",
        key: "release",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{item.release_tag || `r${item.release_no}`}</Typography.Text>
            <Typography.Text type="secondary">
              {getAtpRunnerKindLabel(item.runner_kind)} / {item.storage_mount_code}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "存储目录",
        dataIndex: "storage_root_path",
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "状态",
        key: "status",
        render: (_, item) => {
          const display = getAtpReleaseStatusDisplay(item.status);
          return (
            <Space wrap>
              <Tag color={display.color}>{display.label}</Tag>
              {item.is_active ? <Tag color="green">当前生效</Tag> : null}
              {item.scenario_code ? <Tag color="blue">{item.scenario_code}</Tag> : null}
            </Space>
          );
        },
      },
      {
        title: "更新时间",
        dataIndex: "update_date",
        render: (value: string) => formatDateTime(value),
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
                setReleaseArchiveFileList([]);
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
        render: (_, item) => {
          const display = getAtpRunStatusDisplay(item.status);
          return (
            <Space direction="vertical" size={0}>
              <Tag color={display.color}>{display.label}</Tag>
              <Typography.Text type="secondary">{formatDateTime(item.create_date)}</Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "执行信息",
        key: "execution",
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text>
              {getAtpRunnerKindLabel(item.runner_kind)} / {item.engine_mode}
            </Typography.Text>
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
    return <AdminPageLoading tip="加载 ATP 模型详情中..." minHeightClassName="min-h-[280px]" />;
  }

  if (!user || !canRead) {
    return (
      <Card title="ATP 模型详情">
        <Typography.Text type="secondary">
          {!user ? "请先登录后再查看 ATP 模型详情。" : "当前账号无 ATP 模块权限（需要 atp.read/atp.run/atp.manage）。"}
        </Typography.Text>
      </Card>
    );
  }

  if (assetQuery.isLoading) {
    return <AdminPageLoading tip="加载 ATP 模型详情中..." minHeightClassName="min-h-[280px]" />;
  }

  if (assetQuery.error instanceof Error) {
    return (
      <Card title="ATP 模型详情">
        <Alert type="error" showIcon message="模型详情加载失败" description={assetQuery.error.message} />
      </Card>
    );
  }

  const asset = assetQuery.data;
  if (!asset) {
    return (
      <Card title="ATP 模型详情">
        <Empty description="未找到对应模型" />
      </Card>
    );
  }

  const assetStatusDisplay = getAtpAssetStatusDisplay(asset.status);
  const releaseDetail = releaseDetailQuery.data ?? null;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={asset.name}
        extra={
          <Space wrap>
            <Link href="/admin/atp-models">
              <Button>返回列表</Button>
            </Link>
            <Button
              type="primary"
              disabled={!canManage}
              onClick={() => {
                setEditingRelease(null);
                setReleaseArchiveFileList([]);
                releaseForm.setFieldsValue(EMPTY_RELEASE_FORM);
                setReleaseModalOpen(true);
              }}
            >
              新建版本
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="编码">{asset.code}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={assetStatusDisplay.color}>{assetStatusDisplay.label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="电压等级">{asset.voltage_level || "-"}</Descriptions.Item>
            <Descriptions.Item label="塔型">{asset.tower_type || "-"}</Descriptions.Item>
            <Descriptions.Item label="场景">{asset.scene_type || "-"}</Descriptions.Item>
            <Descriptions.Item label="当前激活版本">
              {asset.active_release_tag || (asset.active_release_no ? `r${asset.active_release_no}` : "-")}
            </Descriptions.Item>
            <Descriptions.Item label="说明" span={2}>
              {asset.description || "-"}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card title="版本列表">
        {releasesQuery.error instanceof Error ? (
          <Alert type="error" showIcon message="版本列表加载失败" description={releasesQuery.error.message} />
        ) : (
          <Table<AtpAssetReleaseSummary>
            rowKey="id"
            loading={releasesQuery.isLoading}
            columns={releaseColumns}
            dataSource={releases}
            locale={{ emptyText: "暂无版本" }}
            pagination={false}
            scroll={{ x: 1080 }}
          />
        )}
      </Card>

      <Card
        title={selectedRelease ? `当前版本：${selectedRelease.release_tag || `r${selectedRelease.release_no}`}` : "当前版本"}
        extra={
          <Button
            disabled={!selectedReleaseId || !canRun}
            onClick={() => {
              runForm.setFieldsValue(EMPTY_RUN_FORM);
              setRunModalOpen(true);
            }}
          >
            运行 / Dry Run
          </Button>
        }
      >
        {!selectedRelease ? (
          <Empty description="请选择一个版本" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {releaseDetailQuery.error instanceof Error ? (
              <Alert type="error" showIcon message="版本详情加载失败" description={releaseDetailQuery.error.message} />
            ) : null}

            {releaseDetail ? (
              <>
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="状态">
                    <Tag color={getAtpReleaseStatusDisplay(releaseDetail.status).color}>
                      {getAtpReleaseStatusDisplay(releaseDetail.status).label}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="运行类型">{getAtpRunnerKindLabel(releaseDetail.runner_kind)}</Descriptions.Item>
                  <Descriptions.Item label="存储挂载">{releaseDetail.storage_mount_code}</Descriptions.Item>
                  <Descriptions.Item label="存储目录">
                    <Typography.Text code>{releaseDetail.storage_root_path}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="入口文件">{releaseDetail.entry_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="结果文件">{releaseDetail.result_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="EGM 目录">{releaseDetail.egm_subdir || "-"}</Descriptions.Item>
                  <Descriptions.Item label="EGM 结果">{releaseDetail.egm_result_file || "-"}</Descriptions.Item>
                  <Descriptions.Item label="预处理脚本">{releaseDetail.preprocess_script || "-"}</Descriptions.Item>
                  <Descriptions.Item label="后处理脚本">{releaseDetail.postprocess_script || "-"}</Descriptions.Item>
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
            locale={{ emptyText: selectedReleaseId ? "当前版本暂无文件" : "请先选择版本" }}
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
            locale={{ emptyText: selectedReleaseId ? "当前版本暂无运行记录" : "请先选择版本" }}
            pagination={false}
            scroll={{ x: 980 }}
          />
        )}
      </Card>

      <Modal
        title={editingRelease ? "编辑版本" : "新建版本"}
        open={releaseModalOpen}
        onCancel={() => {
          setReleaseModalOpen(false);
          setEditingRelease(null);
          setReleaseArchiveFileList([]);
          releaseForm.resetFields();
        }}
        onOk={() => void releaseForm.submit()}
        confirmLoading={saveReleaseMutation.isPending}
        destroyOnClose
        width={720}
      >
        <Form<ReleaseFormValues>
          form={releaseForm}
          layout="vertical"
          initialValues={EMPTY_RELEASE_FORM}
          onFinish={(values) => void saveReleaseMutation.mutateAsync(values)}
        >
          <Form.Item name="release_tag" label="版本标签" rules={[{ required: true, message: "请输入版本标签" }]}>
            <Input placeholder="如 220-raoji3-v1" />
          </Form.Item>

          {editingRelease ? (
            <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
              <Select
                options={[
                  { value: "draft", label: "草稿" },
                  { value: "released", label: "已发布" },
                  { value: "archived", label: "归档" },
                ]}
              />
            </Form.Item>
          ) : (
            <Form.Item label="版本 ZIP 包" required>
              <Upload
                accept=".zip,application/zip,application/x-zip-compressed"
                beforeUpload={() => false}
                fileList={releaseArchiveFileList}
                maxCount={1}
                onChange={(info) => setReleaseArchiveFileList(info.fileList.slice(-1))}
              >
                <Button>选择 ZIP 包</Button>
              </Upload>
              <Typography.Text type="secondary">仅支持 ZIP 文件。</Typography.Text>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title="运行版本"
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
