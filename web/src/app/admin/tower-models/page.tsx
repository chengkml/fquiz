"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { getApiBaseUrl, readApiError } from "@/lib/api";
import type {
  FileListResponse,
  FileStorageMount,
  TowerModelImageUploadResponse,
  TowerModelListResponse,
  TowerModelSeedResponse,
  TowerModelSummary,
} from "@/types/auth";

type TowerModelFormValues = {
  code: string;
  name: string;
  tower_type: string;
  description: string;
  is_enabled: boolean;
  sort_order: number;
  default_altitude_m: number | null;
  default_terrain: string;
  default_ground_resistance_ohm: number | null;
  default_lightning_density: number | null;
  default_span_small_m: number | null;
  default_span_large_m: number | null;
  default_slope_1: number | null;
  default_slope_2: number | null;
  default_risk_level: string;
};

const EMPTY_FORM: TowerModelFormValues = {
  code: "",
  name: "",
  tower_type: "",
  description: "",
  is_enabled: true,
  sort_order: 0,
  default_altitude_m: null,
  default_terrain: "",
  default_ground_resistance_ohm: null,
  default_lightning_density: null,
  default_span_small_m: null,
  default_span_large_m: null,
  default_slope_1: null,
  default_slope_2: null,
  default_risk_level: "",
};

function toEditValues(item: TowerModelSummary): TowerModelFormValues {
  return {
    code: item.code,
    name: item.name,
    tower_type: item.tower_type ?? "",
    description: item.description ?? "",
    is_enabled: item.is_enabled,
    sort_order: item.sort_order,
    default_altitude_m: item.default_altitude_m,
    default_terrain: item.default_terrain ?? "",
    default_ground_resistance_ohm: item.default_ground_resistance_ohm,
    default_lightning_density: item.default_lightning_density,
    default_span_small_m: item.default_span_small_m,
    default_span_large_m: item.default_span_large_m,
    default_slope_1: item.default_slope_1,
    default_slope_2: item.default_slope_2,
    default_risk_level: item.default_risk_level ?? "",
  };
}

function buildPayload(values: TowerModelFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    tower_type: values.tower_type.trim() || null,
    description: values.description.trim() || null,
    is_enabled: values.is_enabled,
    sort_order: values.sort_order ?? 0,
    default_altitude_m: values.default_altitude_m ?? null,
    default_terrain: values.default_terrain.trim() || null,
    default_ground_resistance_ohm: values.default_ground_resistance_ohm ?? null,
    default_lightning_density: values.default_lightning_density ?? null,
    default_span_small_m: values.default_span_small_m ?? null,
    default_span_large_m: values.default_span_large_m ?? null,
    default_slope_1: values.default_slope_1 ?? null,
    default_slope_2: values.default_slope_2 ?? null,
    default_risk_level: values.default_risk_level.trim() || null,
  };
}

export default function AdminTowerModelsPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm<TowerModelFormValues>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const seedSettingInputRef = useRef<HTMLInputElement | null>(null);
  const seedGantaInputRef = useRef<HTMLInputElement | null>(null);
  const seedImagesZipInputRef = useRef<HTMLInputElement | null>(null);
  const [keyword, setKeyword] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<TowerModelSummary | null>(null);
  const [uploadModel, setUploadModel] = useState<TowerModelSummary | null>(null);
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedUploadOpen, setSeedUploadOpen] = useState(false);
  const [seedOverwrite, setSeedOverwrite] = useState(false);

  const canRead = hasPermission("tower_model.read") || hasPermission("tower_model.manage") || hasPermission("tower.read") || hasPermission("tower.manage");
  const canManage = hasPermission("tower_model.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    if (enabledFilter !== "all") {
      params.set("enabled", enabledFilter === "enabled" ? "true" : "false");
    }
    const query = params.toString();
    return `/api/v1/tower-models${query ? `?${query}` : ""}`;
  }, [keyword, enabledFilter]);

  const mountsQuery = useQuery({
    queryKey: ["/api/v1/admin/files?path=/"],
    enabled: !!user && canManage,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/files?path=/");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileListResponse;
    },
  });

  const towerModelsQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TowerModelListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/tower-models"),
    });
  }, [queryClient]);

  useTopicSubscription("admin.tower-models", useCallback(() => {
    void refreshList();
  }, [refreshList]));

  const saveMutation = useMutation({
    mutationFn: async (values: TowerModelFormValues) => {
      const payload = buildPayload(values);
      if (editingModel) {
        const response = await fetchWithAuth(`/api/v1/tower-models/${editingModel.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "updated" as const;
      }

      const response = await fetchWithAuth("/api/v1/tower-models", {
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
      messageApi.success(mode === "created" ? "杆塔模型已创建" : "杆塔模型已更新");
      setDialogOpen(false);
      setEditingModel(null);
      form.resetFields();
      await refreshList();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "保存杆塔模型失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (modelId: string) => {
      const response = await fetchWithAuth(`/api/v1/tower-models/${modelId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: async () => {
      setError("");
      messageApi.success("杆塔模型已删除");
      await refreshList();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "删除杆塔模型失败");
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (payload: { modelId: string; mountCode: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      const params = new URLSearchParams({ mount_code: payload.mountCode });
      const response = await fetchWithAuth(`/api/v1/tower-models/${payload.modelId}/image?${params.toString()}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as TowerModelImageUploadResponse;
    },
    onSuccess: async () => {
      setError("");
      messageApi.success("模型图片上传成功");
      setUploadModel(null);
      await refreshList();
    },
    onError: (candidate) => {
      setError(candidate instanceof Error ? candidate.message : "图片上传失败");
    },
  });

  const openCreate = () => {
    setEditingModel(null);
    form.setFieldsValue(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = useCallback((item: TowerModelSummary) => {
    setEditingModel(item);
    form.setFieldsValue(toEditValues(item));
    setDialogOpen(true);
  }, [form]);

  const resetSeedUploadInputs = () => {
    if (seedSettingInputRef.current) {
      seedSettingInputRef.current.value = "";
    }
    if (seedGantaInputRef.current) {
      seedGantaInputRef.current.value = "";
    }
    if (seedImagesZipInputRef.current) {
      seedImagesZipInputRef.current.value = "";
    }
  };

  const triggerSeedUpload = async () => {
    const settingFile = seedSettingInputRef.current?.files?.[0];
    const gantaFile = seedGantaInputRef.current?.files?.[0];
    const imagesZipFile = seedImagesZipInputRef.current?.files?.[0];
    if (!settingFile) {
      setError("请先上传 LP_Setting 文件");
      return;
    }
    if (!gantaFile) {
      setError("请先上传 LP_GanTa 文件");
      return;
    }

    setSeedRunning(true);
    try {
      const params = new URLSearchParams({ overwrite_existing: seedOverwrite ? "true" : "false" });
      const formData = new FormData();
      formData.append("setting_file", settingFile);
      formData.append("ganta_file", gantaFile);
      if (imagesZipFile) {
        formData.append("images_zip", imagesZipFile);
      }
      const response = await fetchWithAuth(`/api/v1/tower-models/seed/upload?${params.toString()}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as TowerModelSeedResponse;
      messageApi.success(
        `初始化完成：新增 ${payload.imported_models}，更新 ${payload.updated_models}，跳过 ${payload.skipped_models}，图片 ${payload.copied_images}`,
      );
      if (payload.warnings.length > 0) {
        setError(payload.warnings.slice(0, 8).join("; "));
      } else {
        setError("");
      }
      setSeedUploadOpen(false);
      setSeedOverwrite(false);
      resetSeedUploadInputs();
      await refreshList();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "初始化失败");
    } finally {
      setSeedRunning(false);
    }
  };

  const tableColumns = useMemo<ColumnsType<TowerModelSummary>>(
    () => [
      {
        title: "模型编码",
        dataIndex: "code",
        width: 160,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "模型名称",
        dataIndex: "name",
        width: 200,
      },
      {
        title: "塔型",
        dataIndex: "tower_type",
        width: 100,
        render: (value: string | null) => value || "-",
      },
      {
        title: "默认参数",
        key: "defaults",
        width: 320,
        render: (_: unknown, row) => (
          <Space size={[8, 4]} wrap>
            <Tag>接地电阻 {row.default_ground_resistance_ohm ?? "-"}Ω</Tag>
            <Tag>地闪密度 {row.default_lightning_density ?? "-"}</Tag>
            <Tag>档距 {row.default_span_small_m ?? "-"} / {row.default_span_large_m ?? "-"}</Tag>
            <Tag>倾角 {row.default_slope_1 ?? "-"} / {row.default_slope_2 ?? "-"}</Tag>
          </Space>
        ),
      },
      {
        title: "图片",
        key: "image",
        width: 200,
        render: (_: unknown, row) => {
          if (!row.image_path) {
            return <Typography.Text type="secondary">未上传</Typography.Text>;
          }
          return (
            <Space size={8}>
              <Image
                src={`${getApiBaseUrl()}/api/v1/tower-models/${row.id}/image`}
                alt={row.name}
                width={56}
                height={56}
                style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #ddd" }}
              />
              <Button size="small" onClick={() => window.open(`${getApiBaseUrl()}/api/v1/tower-models/${row.id}/image`, "_blank")}>
                查看
              </Button>
            </Space>
          );
        },
      },
      {
        title: "状态",
        dataIndex: "is_enabled",
        width: 80,
        render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "启用" : "禁用"}</Tag>,
      },
      {
        title: "排序",
        dataIndex: "sort_order",
        width: 80,
      },
      {
        title: "操作",
        key: "actions",
        width: 240,
        fixed: "right",
        render: (_: unknown, row) => (
          <Space size={8}>
            {canManage && <Button size="small" onClick={() => openEdit(row)}>编辑</Button>}
            {canManage && (
              <Button size="small" onClick={() => setUploadModel(row)}>
                上传图片
              </Button>
            )}
            {canManage && (
              <Popconfirm
                title="删除杆塔模型"
                description={`确认删除模型 ${row.code} 吗？`}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={async () => {
                  await deleteMutation.mutateAsync(row.id);
                }}
              >
                <Button size="small" danger loading={deleteMutation.isPending}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [canManage, deleteMutation, openEdit],
  );

  const mounts = mountsQuery.data?.mounts ?? [];

  if (initializing || towerModelsQuery.isLoading) {
    return <Card><Typography.Text type="secondary">加载杆塔模型中...</Typography.Text></Card>;
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再访问杆塔模型管理页面。</Typography.Text>
          <Button><Link href="/">返回首页</Link></Button>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">你没有访问该页面的权限（需要 `tower_model.read`）。</Typography.Text>
          <Button><Link href="/">返回首页</Link></Button>
        </Space>
      </Card>
    );
  }

  const listError = towerModelsQuery.error instanceof Error ? towerModelsQuery.error.message : "";
  const listData = towerModelsQuery.data;

  return (
    <Space direction="vertical" size={16} className="w-full">
      {(error || listError) && (
        <Alert type="error" showIcon message="操作失败" description={error || listError} />
      )}

      <Card
        title="杆塔模型管理"
        extra={canManage ? (
          <Space size={8} wrap>
            <Button onClick={openCreate} type="primary">新建模型</Button>
            <Button
              onClick={() => {
                setSeedOverwrite(false);
                setSeedUploadOpen(true);
              }}
              loading={seedRunning}
            >
              上传文件初始化
            </Button>
          </Space>
        ) : null}
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            模型图片由文件服务挂载路径管理；新建线路添加杆塔时会按模型自动带出默认参数。
          </Typography.Text>
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <Input
              value={keyword}
              allowClear
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按模型编码/名称/塔型筛选"
            />
            <Select
              value={enabledFilter}
              options={[
                { value: "all", label: "全部状态" },
                { value: "enabled", label: "启用" },
                { value: "disabled", label: "禁用" },
              ]}
              onChange={(value) => setEnabledFilter(value)}
            />
          </div>
          {listData && listData.items.length === 0 ? (
            <Empty description="暂无杆塔模型数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table<TowerModelSummary>
              rowKey={(row) => row.id}
              columns={tableColumns}
              dataSource={listData?.items ?? []}
              pagination={{ pageSize: 20, showSizeChanger: true }}
              scroll={{ x: 1450 }}
            />
          )}
        </Space>
      </Card>

      <Modal
        title={editingModel ? "编辑杆塔模型" : "新建杆塔模型"}
        open={dialogOpen}
        width={960}
        okText={editingModel ? "保存" : "创建"}
        confirmLoading={saveMutation.isPending}
        onCancel={() => {
          if (saveMutation.isPending) return;
          setDialogOpen(false);
        }}
        onOk={async () => {
          const values = await form.validateFields();
          saveMutation.mutate(values);
        }}
      >
        <Form<TowerModelFormValues> form={form} layout="vertical" initialValues={EMPTY_FORM}>
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item name="code" label="模型编码" rules={[{ required: true, message: "请输入模型编码" }]}>
              <Input disabled={!!editingModel} />
            </Form.Item>
            <Form.Item name="name" label="模型名称" rules={[{ required: true, message: "请输入模型名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="tower_type" label="塔型">
              <Select
                allowClear
                options={[
                  { value: "直线", label: "直线" },
                  { value: "耐张", label: "耐张" },
                ]}
              />
            </Form.Item>
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={0} max={1_000_000} className="w-full" />
            </Form.Item>
            <Form.Item name="default_altitude_m" label="默认海拔(m)">
              <InputNumber precision={4} className="w-full" />
            </Form.Item>
            <Form.Item name="default_terrain" label="默认地形">
              <Input />
            </Form.Item>
            <Form.Item name="default_ground_resistance_ohm" label="默认接地电阻(Ω)">
              <InputNumber precision={4} className="w-full" />
            </Form.Item>
            <Form.Item name="default_lightning_density" label="默认地闪密度">
              <InputNumber precision={8} className="w-full" />
            </Form.Item>
            <Form.Item name="default_span_small_m" label="默认小号侧档距(m)">
              <InputNumber precision={4} className="w-full" />
            </Form.Item>
            <Form.Item name="default_span_large_m" label="默认大号侧档距(m)">
              <InputNumber precision={4} className="w-full" />
            </Form.Item>
            <Form.Item name="default_slope_1" label="默认地面倾角1">
              <InputNumber precision={8} className="w-full" />
            </Form.Item>
            <Form.Item name="default_slope_2" label="默认地面倾角2">
              <InputNumber precision={8} className="w-full" />
            </Form.Item>
            <Form.Item name="default_risk_level" label="默认风险等级">
              <Input />
            </Form.Item>
            <Form.Item name="is_enabled" label="启用状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="上传初始化文件"
        open={seedUploadOpen}
        okText="开始初始化"
        confirmLoading={seedRunning}
        onCancel={() => {
          if (seedRunning) {
            return;
          }
          setSeedUploadOpen(false);
          setSeedOverwrite(false);
          resetSeedUploadInputs();
        }}
        onOk={async () => {
          await triggerSeedUpload();
        }}
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            请上传老系统导出的 LP_Setting、LP_GanTa 文件；图片压缩包可选（zip，按“模型编码.扩展名”匹配）。
          </Typography.Text>
          <div>
            <Typography.Text>LP_Setting 文件（必选）</Typography.Text>
            <input
              ref={seedSettingInputRef}
              type="file"
              accept=".txt,.csv,text/plain"
              className="mt-1 block w-full"
            />
          </div>
          <div>
            <Typography.Text>LP_GanTa 文件（必选）</Typography.Text>
            <input
              ref={seedGantaInputRef}
              type="file"
              accept=".txt,.csv,text/plain"
              className="mt-1 block w-full"
            />
          </div>
          <div>
            <Typography.Text>模型图片压缩包（可选，zip）</Typography.Text>
            <input
              ref={seedImagesZipInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="mt-1 block w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={seedOverwrite} onChange={setSeedOverwrite} />
            <Typography.Text>覆盖已存在模型（关闭则仅新增）</Typography.Text>
          </div>
        </Space>
      </Modal>

      <Modal
        title="上传模型图片"
        open={!!uploadModel}
        okText="上传"
        confirmLoading={uploadImageMutation.isPending}
        onCancel={() => {
          if (uploadImageMutation.isPending) return;
          setUploadModel(null);
        }}
        onOk={() => {
          if (!uploadModel) return;
          const file = fileInputRef.current?.files?.[0];
          if (!file) {
            setError("请先选择图片文件");
            return;
          }
          const mount = mounts[0];
          if (!mount) {
            setError("未查询到可用文件挂载点");
            return;
          }
          uploadImageMutation.mutate({
            modelId: uploadModel.id,
            mountCode: mount.code,
            file,
          });
        }}
      >
        <Space direction="vertical" size={12} className="w-full">
          <Typography.Text type="secondary">
            当前模型：{uploadModel?.code} / {uploadModel?.name}
          </Typography.Text>
          <Typography.Text type="secondary">
            目标挂载：{(mounts[0] as FileStorageMount | undefined)?.code ?? "-"}（默认第一个可用挂载）
          </Typography.Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,image/*"
            className="block w-full"
          />
        </Space>
      </Modal>
    </Space>
  );
}
