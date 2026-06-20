"use client";

import type { ComponentType } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card as AntdCard,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
  type CardProps,
  type UploadFile,
} from "antd";
import { MoreOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { useAuth } from "@/components/auth-provider";
import { ElevationPreviewCesiumMap } from "@/components/elevation-preview-cesium-map";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { ElevationDatasetTerrainStatus } from "@/types/auth";

type ElevationFileRecordSummary = {
  id: string;
  file_name: string;
  file_path: string;
  file_format: string;
  file_size: number;
  source: string | null;
  mount_code: string;
  resolution_m: number | null;
  status: string;
  bbox_min_lon: number | null;
  bbox_max_lon: number | null;
  bbox_min_lat: number | null;
  bbox_max_lat: number | null;
  sample_count: number;
  analysis_status: string;
  analysis_task_id: string | null;
  terrain_status: ElevationDatasetTerrainStatus;
  terrain_task_id: string | null;
  terrain_error_message: string | null;
  terrain_url_template: string | null;
  terrain_min_zoom: number | null;
  terrain_max_zoom: number | null;
  terrain_bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
  terrain_metadata: Record<string, unknown> | null;
  notes: string | null;
  create_date: string;
  create_user: string | null;
  update_date: string;
  update_user: string | null;
};

type FileRecordListResponse = {
  items: ElevationFileRecordSummary[];
  total: number;
};

type LineSummary = {
  id: string;
  code: string | null;
  name: string | null;
};

type LineListResponse = {
  items?: LineSummary[];
};

type ElevationPreviewPoint = {
  longitude: number;
  latitude: number;
  altitude_m: number;
};

type ElevationPreviewCell = {
  min_longitude: number;
  max_longitude: number;
  min_latitude: number;
  max_latitude: number;
  altitude_m: number;
};

type ElevationPreviewDiagnostics = {
  source_crs: string | null;
  source_bounds_min_x: number | null;
  source_bounds_max_x: number | null;
  source_bounds_min_y: number | null;
  source_bounds_max_y: number | null;
  wgs84_bounds_min_lon: number | null;
  wgs84_bounds_max_lon: number | null;
  wgs84_bounds_min_lat: number | null;
  wgs84_bounds_max_lat: number | null;
  raster_width: number | null;
  raster_height: number | null;
  target_samples: number | null;
  sampling_step: number | null;
  scanned_candidates: number | null;
  valid_preview_count: number | null;
  skip_read_error: number;
  skip_masked: number;
  skip_nodata: number;
  skip_nonfinite: number;
  skip_sample_transform_error: number;
  sample_tx_first_error: string | null;
  skip_sample_out_of_range: number;
  skip_cell_transform_error: number;
  skip_cell_out_of_range: number;
};

type ElevationFileRecordPreviewResponse = {
  record: ElevationFileRecordSummary;
  preview_mode: "point_cloud" | "terrain_grid";
  total_points: number;
  sampled_points: number;
  points: ElevationPreviewPoint[];
  cells: ElevationPreviewCell[];
  diagnostics: ElevationPreviewDiagnostics | null;
  warnings: string[];
};

type ElevationFileRecordTaskResponse = {
  record: ElevationFileRecordSummary;
  task_id: string | null;
  queued: boolean;
  detail: string | null;
  warnings: string[];
};

type ElevationFileRecordUploadResponse = {
  record: ElevationFileRecordSummary;
  queued: boolean;
  detail: string | null;
  warnings: string[];
};

type UploadFormValues = {
  source?: string;
  resolution_m?: number;
  notes?: string;
};

type ApplyFormValues = {
  line_id: string;
  file_record_id: string;
  mode: "fill_null_only" | "overwrite_all";
};

const DEFAULT_APPLY_FORM: ApplyFormValues = {
  line_id: "",
  file_record_id: "",
  mode: "fill_null_only",
};

const Card = AntdCard as unknown as ComponentType<CardProps>;

function statusTagColor(status: string): string {
  if (status === "success" || status === "active" || status === "ready") return "green";
  if (status === "running" || status === "processing") return "blue";
  if (status === "pending" || status === "queued") return "orange";
  if (status === "failed" || status === "disabled") return "red";
  return "default";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as T;
}

async function ensureOkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

function readMutationError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ElevationRecordsPage() {
  const { fetchWithAuth, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyForm] = Form.useForm<ApplyFormValues>();
  const [selectedRecord, setSelectedRecord] = useState<ElevationFileRecordSummary | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ElevationFileRecordPreviewResponse | null>(null);

  // Fetch file records
  const { data: recordsData, isLoading } = useQuery<FileRecordListResponse>({
    queryKey: ["elevation-records", keyword, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (keyword) params.append("keyword", keyword);
      if (statusFilter) params.append("status", statusFilter);
      const query = params.toString();
      const response = await fetchWithAuth(`/api/v1/elevation/records${query ? `?${query}` : ""}`);
      return readJsonResponse<FileRecordListResponse>(response);
    },
  });

  // Fetch lines for apply dialog
  const { data: linesData } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/lines?limit=1000");
      return readJsonResponse<LineListResponse>(response);
    },
  });

  // Subscribe to real-time updates
  useTopicSubscription("admin.elevation", () => {
    queryClient.invalidateQueries({ queryKey: ["elevation-records"] });
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (values: UploadFormValues) => {
      const formData = new FormData();
      if (fileList.length === 0) {
        throw new Error("请选择文件");
      }
      formData.append("file", fileList[0].originFileObj as Blob);
      if (values.source) formData.append("source", values.source);
      if (values.resolution_m) formData.append("resolution_m", values.resolution_m.toString());
      if (values.notes) formData.append("notes", values.notes);
      formData.append("trigger_analysis", "true");

      const response = await fetchWithAuth("/api/v1/elevation/records", {
        method: "POST",
        body: formData,
      });
      return readJsonResponse<ElevationFileRecordUploadResponse>(response);
    },
    onSuccess: () => {
      message.success("文件上传成功");
      setUploadModalOpen(false);
      uploadForm.resetFields();
      setFileList([]);
      queryClient.invalidateQueries({ queryKey: ["elevation-records"] });
    },
    onError: (error) => {
      message.error(readMutationError(error, "上传失败"));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/records/${id}`, {
        method: "DELETE",
      });
      await ensureOkResponse(response);
    },
    onSuccess: () => {
      message.success("删除成功");
      queryClient.invalidateQueries({ queryKey: ["elevation-records"] });
    },
    onError: (error) => {
      message.error(readMutationError(error, "删除失败"));
    },
  });

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/records/${id}/analyze`, {
        method: "POST",
      });
      return readJsonResponse<ElevationFileRecordTaskResponse>(response);
    },
    onSuccess: () => {
      message.success("分析任务已提交");
      queryClient.invalidateQueries({ queryKey: ["elevation-records"] });
    },
    onError: (error) => {
      message.error(readMutationError(error, "分析失败"));
    },
  });

  // Terrain build mutation
  const terrainMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/records/${id}/terrain/build`, {
        method: "POST",
      });
      return readJsonResponse<ElevationFileRecordTaskResponse>(response);
    },
    onSuccess: () => {
      message.success("地形瓦片任务已提交");
      queryClient.invalidateQueries({ queryKey: ["elevation-records"] });
    },
    onError: (error) => {
      message.error(readMutationError(error, "地形生成失败"));
    },
  });

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: async (values: ApplyFormValues) => {
      const response = await fetchWithAuth("/api/v1/elevation/jobs/apply-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      return readJsonResponse(response);
    },
    onSuccess: () => {
      message.success("回填任务已创建");
      setApplyModalOpen(false);
      applyForm.resetFields();
    },
    onError: (error) => {
      message.error(readMutationError(error, "创建任务失败"));
    },
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/v1/elevation/records/${id}/preview?max_points=1500`);
      return readJsonResponse<ElevationFileRecordPreviewResponse>(response);
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewModalOpen(true);
    },
    onError: (error) => {
      message.error(readMutationError(error, "预览失败"));
    },
  });

  const columns: ColumnsType<ElevationFileRecordSummary> = [
    {
      title: "文件名",
      dataIndex: "file_name",
      key: "file_name",
      width: 250,
      ellipsis: true,
    },
    {
      title: "格式",
      dataIndex: "file_format",
      key: "file_format",
      width: 80,
      render: (text) => <Tag>{text.toUpperCase()}</Tag>,
    },
    {
      title: "大小",
      dataIndex: "file_size",
      key: "file_size",
      width: 100,
      render: (size) => formatFileSize(size),
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 150,
      ellipsis: true,
    },
    {
      title: "分辨率(m)",
      dataIndex: "resolution_m",
      key: "resolution_m",
      width: 100,
      render: (val) => (val ? val.toFixed(1) : "-"),
    },
    {
      title: "样本数",
      dataIndex: "sample_count",
      key: "sample_count",
      width: 100,
      render: (val) => val.toLocaleString(),
    },
    {
      title: "分析状态",
      dataIndex: "analysis_status",
      key: "analysis_status",
      width: 120,
      render: (status) => <Tag color={statusTagColor(status)}>{status}</Tag>,
    },
    {
      title: "地形状态",
      dataIndex: "terrain_status",
      key: "terrain_status",
      width: 120,
      render: (status) => <Tag color={statusTagColor(status)}>{status}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (status) => <Tag color={statusTagColor(status)}>{status}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              {
                key: "analyze",
                label: "分析",
                disabled: record.analysis_status === "running" || record.analysis_status === "queued",
                onClick: () => analyzeMutation.mutate(record.id),
              },
              {
                key: "preview",
                label: "预览",
                onClick: () => previewMutation.mutate(record.id),
              },
              {
                key: "terrain",
                label: "生成地形",
                disabled:
                  record.file_format === "csv" ||
                  record.terrain_status === "processing" ||
                  (record.terrain_status === "pending" && !!record.terrain_task_id),
                onClick: () => terrainMutation.mutate(record.id),
              },
              {
                key: "apply",
                label: "回填线路",
                onClick: () => {
                  setSelectedRecord(record);
                  applyForm.setFieldsValue({ ...DEFAULT_APPLY_FORM, file_record_id: record.id });
                  setApplyModalOpen(true);
                },
              },
              { type: "divider" },
              {
                key: "delete",
                label: "删除",
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: "确认删除",
                    content: `确定要删除文件 "${record.file_name}" 吗？`,
                    onOk: () => deleteMutation.mutate(record.id),
                  });
                },
              },
            ],
          }}
        >
          <Button type="text" icon={<MoreOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="高程文件管理"
        extra={
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalOpen(true)}>
            上传文件
          </Button>
        }
      >
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <Space>
            <Input.Search
              placeholder="搜索文件名或来源"
              allowClear
              style={{ width: 300 }}
              onSearch={setKeyword}
            />
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ width: 150 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: "启用", value: "active" },
                { label: "禁用", value: "disabled" },
              ]}
            />
          </Space>
        </Space>

        <Table
          columns={columns}
          dataSource={recordsData?.items || []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 1400 }}
          pagination={{
            total: recordsData?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>

      {/* Upload Modal */}
      <Modal
        title="上传高程文件"
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false);
          uploadForm.resetFields();
          setFileList([]);
        }}
        onOk={() => uploadForm.submit()}
        confirmLoading={uploadMutation.isPending}
        width={600}
      >
        <Alert
          message="上传即创建"
          description="选择文件后立即上传并创建记录，自动触发分析任务。支持 CSV、IMG、TIF、TIFF 格式。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Form
          form={uploadForm}
          layout="vertical"
          onFinish={(values) => uploadMutation.mutate(values)}
        >
          <Form.Item
            label="文件"
            required
            help="支持 .csv, .img, .tif, .tiff 格式"
          >
            <Upload
              fileList={fileList}
              beforeUpload={(file) => {
                setFileList([file]);
                return false;
              }}
              onRemove={() => setFileList([])}
              maxCount={1}
              accept=".csv,.img,.tif,.tiff"
            >
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>

          <Form.Item label="来源" name="source">
            <Input placeholder="例如：SRTM、DEM 数据" />
          </Form.Item>

          <Form.Item label="分辨率(米)" name="resolution_m">
            <InputNumber min={0.1} step={0.1} style={{ width: "100%" }} placeholder="例如：30" />
          </Form.Item>

          <Form.Item label="备注" name="notes">
            <Input.TextArea rows={3} placeholder="文件说明..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Apply Modal */}
      <Modal
        title="回填线路高程"
        open={applyModalOpen}
        onCancel={() => {
          setApplyModalOpen(false);
          applyForm.resetFields();
        }}
        onOk={() => applyForm.submit()}
        confirmLoading={applyMutation.isPending}
        width={600}
      >
        {selectedRecord && (
          <Alert
            message={`将使用文件: ${selectedRecord.file_name}`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Form form={applyForm} layout="vertical" onFinish={(values) => applyMutation.mutate(values)}>
          <Form.Item name="file_record_id" hidden>
            <Input />
          </Form.Item>

          <Form.Item label="选择线路" name="line_id" rules={[{ required: true, message: "请选择线路" }]}>
            <Select
              placeholder="选择线路"
              showSearch
              optionFilterProp="label"
              options={linesData?.items?.map((line) => ({
                label: `${line.code ?? "-"} - ${line.name ?? "-"}`,
                value: line.id,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="回填模式"
            name="mode"
            rules={[{ required: true }]}
            initialValue="fill_null_only"
          >
            <Select
              options={[
                { label: "仅填空（只更新空值）", value: "fill_null_only" },
                { label: "全部覆盖（覆盖所有数据）", value: "overwrite_all" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Preview Modal */}
      <Modal
        title="高程数据预览"
        open={previewModalOpen}
        onCancel={() => {
          setPreviewModalOpen(false);
          setPreviewData(null);
        }}
        footer={null}
        width="80%"
        style={{ top: 20 }}
      >
        {previewData && (
          <div>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="文件名">{previewData.record?.file_name}</Descriptions.Item>
              <Descriptions.Item label="格式">{previewData.record?.file_format}</Descriptions.Item>
              <Descriptions.Item label="总点数">{previewData.total_points?.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="采样点数">{previewData.sampled_points?.toLocaleString()}</Descriptions.Item>
            </Descriptions>
            <div style={{ height: 600 }}>
              <ElevationPreviewCesiumMap
                dataset={{
                  id: previewData.record.id,
                  name: previewData.record.file_name,
                  terrain_status: previewData.record.terrain_status,
                  terrain_url_template: previewData.record.terrain_url_template,
                  terrain_bounds: previewData.record.terrain_bounds,
                  terrain_metadata: previewData.record.terrain_metadata,
                }}
                accessToken={getAccessToken()}
                points={previewData.points}
                cells={previewData.cells}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
