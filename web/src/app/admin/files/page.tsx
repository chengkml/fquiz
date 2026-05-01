"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Breadcrumb,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Table as AntTable,
  Typography,
  Upload,
  Alert,
  Dropdown,
  message as antdMessage,
  type MenuProps,
  type TableProps,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FolderFilled,
  FolderOpenOutlined,
  ReloadOutlined,
  EditOutlined,
  DragOutlined,
  FileOutlined,
  PlusOutlined,
  UploadOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  FileEntryItem,
  FileListResponse,
  FileOperationResponse,
} from "@/types/auth";

function formatFileSize(size: number): string {
  if (size <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function buildFilesApiPath(path: string): string {
  const params = new URLSearchParams();
  params.set("path", path || "/");
  return `/api/v1/admin/files?${params.toString()}`;
}

export default function AdminFilesPage() {
  const queryClient = useQueryClient();
  const [messageApi, messageContextHolder] = antdMessage.useMessage();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [currentPath, setCurrentPath] = useState("/");
  const [createDirectoryModalOpen, setCreateDirectoryModalOpen] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const pageDisplayName = "文件管理";

  const [renameTarget, setRenameTarget] = useState<FileEntryItem | null>(null);
  const [renameName, setRenameName] = useState("");

  const [moveTarget, setMoveTarget] = useState<FileEntryItem | null>(null);
  const [moveTargetParentPath, setMoveTargetParentPath] = useState("/");
  const [moveNewName, setMoveNewName] = useState("");

  const canRead = hasPermission("file.read") || hasPermission("file.manage");
  const canManage = hasPermission("file.manage");

  const filesPath = useMemo(() => buildFilesApiPath(currentPath), [currentPath]);

  const filesQuery = useQuery({
    queryKey: [filesPath],
    queryFn: async () => {
      const response = await fetchWithAuth(filesPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileListResponse;
    },
    enabled: !!user && canRead,
  });

  const activeMountCode = filesQuery.data?.current_mount.code ?? "";

  const refreshCurrentPath = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [filesPath] });
  }, [filesPath, queryClient]);

  const refreshAllFiles = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/files?"),
    });
  }, [queryClient]);

  const closeCreateDirectoryModal = useCallback(() => {
    setCreateDirectoryModalOpen(false);
    setNewDirectoryName("");
  }, []);

  const closeRenameModal = useCallback(() => {
    setRenameTarget(null);
    setRenameName("");
  }, []);

  const closeMoveModal = useCallback(() => {
    setMoveTarget(null);
    setMoveTargetParentPath(currentPath || "/");
    setMoveNewName("");
  }, [currentPath]);

  const resetActionPanels = useCallback(() => {
    closeCreateDirectoryModal();
    closeRenameModal();
    closeMoveModal();
  }, [closeCreateDirectoryModal, closeMoveModal, closeRenameModal]);

  const applyMutationSuccess = useCallback(
    async (payload: FileOperationResponse, fallbackMessage: string) => {
      const nextMessage = payload.action ? `操作成功：${payload.action}` : fallbackMessage;
      setSuccessMessage(nextMessage);
      setErrorMessage("");
      messageApi.success(nextMessage);
      resetActionPanels();
      await refreshAllFiles();
      await refreshCurrentPath();
    },
    [messageApi, refreshAllFiles, refreshCurrentPath, resetActionPanels],
  );

  useTopicSubscription(
    "admin.files",
    useCallback(() => {
      void refreshCurrentPath();
    }, [refreshCurrentPath]),
  );

  const createDirectoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeMountCode) {
        throw new Error("当前无可用存储挂载");
      }
      const response = await fetchWithAuth("/api/v1/admin/files/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mount_code: activeMountCode,
          parent_path: filesQuery.data?.current_path ?? currentPath,
          name: newDirectoryName,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileOperationResponse;
    },
    onSuccess: async (payload) => {
      setNewDirectoryName("");
      setCreateDirectoryModalOpen(false);
      await applyMutationSuccess(payload, "目录已创建");
    },
    onError: (error) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "目录创建失败";
      setErrorMessage(message);
      messageApi.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前无可用存储挂载");
      }
      const response = await fetchWithAuth("/api/v1/admin/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mount_code: activeMountCode,
          path: item.path,
          is_dir: item.is_dir,
          recursive: item.is_dir,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileOperationResponse;
    },
    onSuccess: async (payload) => {
      await applyMutationSuccess(payload, "路径已删除");
    },
    onError: (error) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "删除失败";
      setErrorMessage(message);
      messageApi.error(message);
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前无可用存储挂载");
      }
      const response = await fetchWithAuth("/api/v1/admin/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mount_code: activeMountCode,
          path: item.path,
          is_dir: item.is_dir,
          new_name: renameName,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileOperationResponse;
    },
    onSuccess: async (payload) => {
      await applyMutationSuccess(payload, "重命名成功");
    },
    onError: (error) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "重命名失败";
      setErrorMessage(message);
      messageApi.error(message);
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前无可用存储挂载");
      }
      const response = await fetchWithAuth("/api/v1/admin/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mount_code: activeMountCode,
          path: item.path,
          is_dir: item.is_dir,
          target_parent_path: moveTargetParentPath,
          new_name: moveNewName.trim() ? moveNewName : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileOperationResponse;
    },
    onSuccess: async (payload) => {
      await applyMutationSuccess(payload, "移动成功");
    },
    onError: (error) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "移动失败";
      setErrorMessage(message);
      messageApi.error(message);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeMountCode) {
        throw new Error("当前无可用存储挂载");
      }
      const params = new URLSearchParams({
        mount_code: activeMountCode,
        parent_path: filesQuery.data?.current_path ?? currentPath,
      });

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchWithAuth(`/api/v1/admin/files/upload?${params.toString()}`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as FileOperationResponse;
    },
    onSuccess: async (payload) => {
      await applyMutationSuccess(payload, "上传成功");
    },
    onError: (error) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "上传失败";
      setErrorMessage(message);
      messageApi.error(message);
    },
  });

  const handleOpenDirectory = (item: FileEntryItem) => {
    if (!item.is_dir) {
      return;
    }
    setCurrentPath(item.path);
    setSuccessMessage("");
    setErrorMessage("");
    resetActionPanels();
  };

  const handleDelete = useCallback(
    (item: FileEntryItem) => {
      const content = item.is_dir
        ? `确认删除目录 ${item.name} 吗？将递归删除目录内全部内容。`
        : `确认删除文件 ${item.name} 吗？`;

      Modal.confirm({
        title: "删除确认",
        content,
        okText: "确认删除",
        cancelText: "取消",
        okType: "danger",
        onOk: () => deleteMutation.mutateAsync(item),
      });
    },
    [deleteMutation],
  );

  const startRename = (item: FileEntryItem) => {
    setRenameTarget(item);
    setRenameName(item.name);
    setSuccessMessage("");
    setErrorMessage("");
  };

  const startMove = (item: FileEntryItem) => {
    setMoveTarget(item);
    setMoveTargetParentPath(item.parent_path || currentPath || "/");
    setMoveNewName(item.name);
    setSuccessMessage("");
    setErrorMessage("");
  };

  const submitRename = () => {
    if (!renameTarget) {
      return;
    }
    if (!renameName.trim()) {
      setErrorMessage("新名称不能为空");
      return;
    }
    void renameMutation.mutateAsync(renameTarget);
  };

  const submitMove = () => {
    if (!moveTarget) {
      return;
    }
    if (!moveTargetParentPath.trim()) {
      setErrorMessage("目标目录不能为空");
      return;
    }
    void moveMutation.mutateAsync(moveTarget);
  };

  const submitCreateDirectory = () => {
    if (!newDirectoryName.trim()) {
      setErrorMessage("目录名称不能为空");
      return;
    }
    void createDirectoryMutation.mutateAsync();
  };

  const handleUploadFile = useCallback(
    (file: File) => {
      setSuccessMessage("");
      setErrorMessage("");
      void uploadMutation.mutateAsync(file);
    },
    [uploadMutation],
  );

  const handleDownloadFile = async (item: FileEntryItem) => {
    if (!activeMountCode) {
      setErrorMessage("当前无可用存储挂载");
      return;
    }

    try {
      const params = new URLSearchParams({
        mount_code: activeMountCode,
        path: item.path,
      });
      const response = await fetchWithAuth(`/api/v1/admin/files/download?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = item.name || "download";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setSuccessMessage(`下载已开始：${item.name}`);
      setErrorMessage("");
      messageApi.success(`下载已开始：${item.name}`);
    } catch (error) {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "下载失败";
      setErrorMessage(message);
      messageApi.error(message);
    }
  };

  const handleDownloadDirectory = async (item: FileEntryItem) => {
    if (!activeMountCode) {
      setErrorMessage("当前无可用存储挂载");
      return;
    }

    try {
      const params = new URLSearchParams({
        mount_code: activeMountCode,
        path: item.path,
      });
      const response = await fetchWithAuth(`/api/v1/admin/files/download-zip?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${item.name || "directory"}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setSuccessMessage(`目录下载已开始：${item.name}`);
      setErrorMessage("");
      messageApi.success(`目录下载已开始：${item.name}`);
    } catch (error) {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "目录下载失败";
      setErrorMessage(message);
      messageApi.error(message);
    }
  };

  const listError = filesQuery.error instanceof Error ? filesQuery.error.message : "";
  const listData = filesQuery.data;
  const items = listData?.items ?? [];
  const operationBusy =
    createDirectoryMutation.isPending
    || deleteMutation.isPending
    || renameMutation.isPending
    || moveMutation.isPending
    || uploadMutation.isPending;

  const breadcrumbItems = useMemo(
    () =>
      (listData?.breadcrumbs ?? [{ name: "根目录", path: "/" }]).map((crumb) => ({
        title: (
          <Button
            type="text"
            color="gray"
            size="1"
            onClick={() => {
              setCurrentPath(crumb.path);
              resetActionPanels();
            }}
            className="px-1 !text-[var(--gray-12)] hover:!text-[var(--accent-11)]"
          >
            {crumb.name}
          </Button>
        ),
      })),
    [listData?.breadcrumbs, resetActionPanels],
  );

  const columns: TableProps<FileEntryItem>["columns"] = [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        render: (_value, item) => (
          <Space size={8}>
            {item.is_dir ? <FolderFilled className="text-[var(--accent-11)]" /> : <FileOutlined className="text-[var(--gray-11)]" />}
            {item.is_dir ? (
              <Typography.Link onClick={() => handleOpenDirectory(item)}>{item.name}</Typography.Link>
            ) : (
              <Typography.Text>{item.name}</Typography.Text>
            )}
          </Space>
        ),
      },
      {
        title: "类型",
        key: "type",
        width: 180,
        render: (_value, item) => (item.is_dir ? "目录" : item.mime_type ?? "文件"),
      },
      {
        title: "大小",
        key: "size",
        width: 140,
        render: (_value, item) => (item.is_dir ? "-" : formatFileSize(item.size)),
      },
      {
        title: "修改时间",
        key: "modified_at",
        width: 220,
        render: (_value, item) => (
          <Typography.Text type="secondary" className="text-xs">
            {formatDate(item.modified_at)}
          </Typography.Text>
        ),
      },
      {
        title: "索引同步时间",
        key: "synced_at",
        width: 220,
        render: (_value, item) => (
          <Typography.Text type="secondary" className="text-xs">
            {formatDate(item.synced_at)}
          </Typography.Text>
        ),
      },
      {
        title: "操作",
        key: "actions",
        width: 320,
        render: (_value, item) => {
          const menuItems: MenuProps["items"] = [
            {
              key: "rename",
              label: "重命名",
              icon: <EditOutlined />,
              disabled: operationBusy,
            },
            {
              key: "move",
              label: "移动",
              icon: <DragOutlined />,
              disabled: operationBusy,
            },
            {
              type: "divider",
            },
            {
              key: "delete",
              label: "删除",
              icon: <DeleteOutlined />,
              danger: true,
              disabled: deleteMutation.isPending,
            },
          ];

          return (
            <Space wrap>
              {item.is_dir ? (
                <>
                  <Button
                    type="button"
                    color="gray"
                    size="1"
                    variant="soft"
                    onClick={() => handleOpenDirectory(item)}
                    icon={<FolderOpenOutlined />}
                  >
                    进入
                  </Button>
                  <Button
                    type="button"
                    color="gray"
                    size="1"
                    variant="soft"
                    onClick={() => void handleDownloadDirectory(item)}
                    icon={<DownloadOutlined />}
                  >
                    下载目录
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  color="gray"
                  size="1"
                  variant="soft"
                  onClick={() => void handleDownloadFile(item)}
                  icon={<DownloadOutlined />}
                >
                  下载
                </Button>
              )}

              {canManage && (
                <Dropdown
                  menu={{
                    items: menuItems,
                    onClick: ({ key }) => {
                      if (key === "rename") {
                        startRename(item);
                        return;
                      }
                      if (key === "move") {
                        startMove(item);
                        return;
                      }
                      if (key === "delete") {
                        handleDelete(item);
                      }
                    },
                  }}
                  trigger={["click"]}
                >
                  <Button
                    type="button"
                    color="gray"
                    size="1"
                    variant="soft"
                    icon={<MoreOutlined />}
                  >
                    更多
                  </Button>
                </Dropdown>
              )}
            </Space>
          );
        },
      },
  ];

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip={`正在加载${pageDisplayName}页面...`} />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问{pageDisplayName}页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `file.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {messageContextHolder}

      {(listError || errorMessage) && (
        <Alert
          type="error"
          showIcon
          closable
          message="操作失败"
          description={listError || errorMessage}
          onClose={() => setErrorMessage("")}
        />
      )}

      {successMessage && (
        <Alert
          type="success"
          showIcon
          closable
          message="操作成功"
          description={successMessage}
          onClose={() => setSuccessMessage("")}
        />
      )}

      <Card className="shadow-sm" size="small">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Typography.Title level={4} className="!mb-1">{pageDisplayName}列表</Typography.Title>
              {listData?.current_mount.backend.driver_type !== "VFS" && (
                <Typography.Text type="secondary">
                  存储后端：{listData?.current_mount.backend.name ?? "-"}（{listData?.current_mount.backend.driver_type ?? "-"}）
                </Typography.Text>
              )}
            </div>
            <Space wrap>
              <Button
                type="button"
                color="gray"
                size="1"
                variant="soft"
                onClick={() => void refreshCurrentPath()}
                disabled={filesQuery.isFetching}
                icon={<ReloadOutlined />}
              >
                {filesQuery.isFetching ? "刷新中..." : "刷新"}
              </Button>

              {canManage && (
                <Button
                  type="button"
                  color="gray"
                  size="1"
                  variant="soft"
                  onClick={() => {
                    setCreateDirectoryModalOpen(true);
                    setSuccessMessage("");
                    setErrorMessage("");
                  }}
                  disabled={createDirectoryMutation.isPending}
                  icon={<PlusOutlined />}
                >
                  新建目录
                </Button>
              )}

              {canManage && (
                <Upload
                  showUploadList={false}
                  maxCount={1}
                  beforeUpload={(file) => {
                    handleUploadFile(file as File);
                    return false;
                  }}
                  disabled={uploadMutation.isPending || !activeMountCode}
                >
                  <Button
                    type="button"
                    color="gray"
                    size="1"
                    variant="soft"
                    disabled={uploadMutation.isPending || !activeMountCode}
                    icon={<UploadOutlined />}
                  >
                    {uploadMutation.isPending ? "上传中..." : "上传文件"}
                  </Button>
                </Upload>
              )}
            </Space>
          </div>

          <div className="mt-4 rounded-lg border border-[var(--gray-5)] bg-[var(--gray-a2)] px-3 py-2 [&_.ant-breadcrumb-link]:!text-[var(--gray-12)] [&_.ant-breadcrumb-separator]:!text-[var(--gray-10)]">
            <Breadcrumb items={breadcrumbItems} />
          </div>

          <div className="mt-4">
            <AntTable<FileEntryItem>
              rowKey={(item) => `${item.path}-${item.id}`}
              columns={columns}
              dataSource={items}
              pagination={false}
              loading={filesQuery.isLoading || filesQuery.isFetching}
              size="middle"
              scroll={{ x: 1100 }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前目录为空"
                  />
                ),
              }}
            />
          </div>
      </Card>

      <Modal
        title="新建目录"
        open={createDirectoryModalOpen}
        onCancel={closeCreateDirectoryModal}
        onOk={submitCreateDirectory}
        okText="确认创建"
        cancelText="取消"
        confirmLoading={createDirectoryMutation.isPending}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label="目录名称"
            required
            validateStatus={newDirectoryName.trim() ? undefined : "error"}
            help={newDirectoryName.trim() ? undefined : "目录名称不能为空"}
          >
            <Input
              value={newDirectoryName}
              onChange={(event) => setNewDirectoryName(event.currentTarget.value)}
              placeholder="请输入目录名称"
              allowClear
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={renameTarget ? `重命名：${renameTarget.name}` : "重命名"}
        open={Boolean(renameTarget)}
        onCancel={closeRenameModal}
        onOk={submitRename}
        okText="确认重命名"
        cancelText="取消"
        confirmLoading={renameMutation.isPending}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label="新名称"
            required
            validateStatus={renameName.trim() ? undefined : "error"}
            help={renameName.trim() ? undefined : "新名称不能为空"}
          >
            <Input
              value={renameName}
              onChange={(event) => setRenameName(event.currentTarget.value)}
              placeholder="请输入新名称"
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={moveTarget ? `移动：${moveTarget.name}` : "移动"}
        open={Boolean(moveTarget)}
        onCancel={closeMoveModal}
        onOk={submitMove}
        okText="确认移动"
        cancelText="取消"
        confirmLoading={moveMutation.isPending}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item
            label="目标目录"
            required
            validateStatus={moveTargetParentPath.trim() ? undefined : "error"}
            help={moveTargetParentPath.trim() ? undefined : "目标目录不能为空"}
          >
            <Input
              value={moveTargetParentPath}
              onChange={(event) => setMoveTargetParentPath(event.currentTarget.value)}
              placeholder="目标目录（如 /a/b）"
              autoFocus
            />
          </Form.Item>
          <Form.Item label="新名称（可选）">
            <Input
              value={moveNewName}
              onChange={(event) => setMoveNewName(event.currentTarget.value)}
              placeholder="留空则使用当前名称"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
