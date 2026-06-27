"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo } from "react";

import { AdminPageLoading } from "@/components/admin-page-loading";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import {
  getAtpAssetStatusDisplay,
  getAtpReleaseStatusDisplay,
  getAtpRunnerKindLabel,
} from "@/lib/atp-asset-display";
import type {
  AtpAssetFileEntry,
  AtpAssetFileListResponse,
  AtpAssetReleaseDetail,
  AtpAssetReleaseListResponse,
  AtpAssetSummary,
} from "@/types/auth";

export default function AtpAssetDetailPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const params = useParams<{ id: string }>();
  const assetId = typeof params?.id === "string" ? params.id : "";

  const canRead = hasPermission("atp.read") || hasPermission("atp.run") || hasPermission("atp.manage");

  const refreshAtpData = useCallback(() => {
    // This function is called by WebSocket updates - kept for compatibility
  }, []);

  useTopicSubscription(
    "admin.atp-assets",
    useCallback(() => {
      void refreshAtpData();
    }, [refreshAtpData]),
  );

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
  const selectedReleaseId = releases.find((item) => item.is_active)?.id ?? releases[0]?.id ?? "";
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
          <Link href="/admin/atp-models">
            <Button>返回列表</Button>
          </Link>
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
            <Descriptions.Item label="避雷器装设组合">{asset.arrester_config || "-"}</Descriptions.Item>
            <Descriptions.Item label="说明" span={2}>
              {asset.description || "-"}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card
        title={selectedRelease ? `当前版本：${selectedRelease.release_tag || `r${selectedRelease.release_no}`}` : "当前版本"}
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
    </Space>
  );
}
