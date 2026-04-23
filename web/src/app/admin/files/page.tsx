"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, Table, TextField } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  FileEntryItem,
  FileListResponse,
  FileOperationResponse,
  FileStorageMount,
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

function buildFilesApiPath(mountCode: string, path: string): string {
  const params = new URLSearchParams();
  if (mountCode) {
    params.set("mount_code", mountCode);
  }
  params.set("path", path || "/");
  return `/api/v1/admin/files?${params.toString()}`;
}

export default function AdminFilesPage() {
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [mountCode, setMountCode] = useState("");
  const [currentPath, setCurrentPath] = useState("/");
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [renameName, setRenameName] = useState("");
  const [moveTargetParentPath, setMoveTargetParentPath] = useState("/");
  const [moveNewName, setMoveNewName] = useState("");
  const [activeItemPath, setActiveItemPath] = useState<string | null>(null);

  const canRead = hasPermission("file.read") || hasPermission("file.manage");
  const canManage = hasPermission("file.manage");

  const filesPath = useMemo(() => buildFilesApiPath(mountCode, currentPath), [mountCode, currentPath]);

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

  const activeMountCode = filesQuery.data?.current_mount.code ?? mountCode;

  const refreshCurrentPath = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [filesPath] });
  }, [filesPath, queryClient]);

  const refreshAllFiles = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/v1/admin/files?"),
    });
  }, [queryClient]);

  const resetActionPanels = useCallback(() => {
    setActiveItemPath(null);
    setRenameName("");
    setMoveTargetParentPath(currentPath || "/");
    setMoveNewName("");
  }, [currentPath]);

  const applyMutationSuccess = useCallback(async (payload: FileOperationResponse, fallbackMessage: string) => {
    setFeedbackMessage(payload.action ? `操作成功：${payload.action}` : fallbackMessage);
    setErrorMessage("");
    resetActionPanels();
    await refreshAllFiles();
    await refreshCurrentPath();
  }, [refreshAllFiles, refreshCurrentPath, resetActionPanels]);

  useTopicSubscription("admin.files", useCallback(() => {
    void refreshCurrentPath();
  }, [refreshCurrentPath]));

  const createDirectoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeMountCode) {
        throw new Error("当前未选择可用挂载点");
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
      await applyMutationSuccess(payload, "目录已创建");
    },
    onError: (error) => {
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "目录创建失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前未选择可用挂载点");
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
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "删除失败");
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前未选择可用挂载点");
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
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "重命名失败");
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (item: FileEntryItem) => {
      if (!activeMountCode) {
        throw new Error("当前未选择可用挂载点");
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
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "移动失败");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!activeMountCode) {
        throw new Error("当前未选择可用挂载点");
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
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "上传失败");
    },
  });

  const handleSelectMount = (mount: FileStorageMount) => {
    setMountCode(mount.code);
    setCurrentPath("/");
    setFeedbackMessage("");
    setErrorMessage("");
    resetActionPanels();
  };

  const handleOpenDirectory = (item: FileEntryItem) => {
    if (!item.is_dir) {
      return;
    }
    setCurrentPath(item.path);
    setFeedbackMessage("");
    setErrorMessage("");
    resetActionPanels();
  };

  const handleDelete = (item: FileEntryItem) => {
    const tip = item.is_dir
      ? `确认删除目录 ${item.name} 吗？将递归删除目录内全部内容。`
      : `确认删除文件 ${item.name} 吗？`;
    if (!window.confirm(tip)) {
      return;
    }
    void deleteMutation.mutateAsync(item);
  };

  const startRename = (item: FileEntryItem) => {
    setActiveItemPath(item.path);
    setRenameName(item.name);
    setMoveTargetParentPath(item.parent_path || currentPath || "/");
    setMoveNewName("");
    setFeedbackMessage("");
    setErrorMessage("");
  };

  const startMove = (item: FileEntryItem) => {
    setActiveItemPath(item.path);
    setRenameName("");
    setMoveTargetParentPath(currentPath || "/");
    setMoveNewName(item.name);
    setFeedbackMessage("");
    setErrorMessage("");
  };

  const submitRename = (item: FileEntryItem) => {
    if (!renameName.trim()) {
      setErrorMessage("新名称不能为空");
      return;
    }
    void renameMutation.mutateAsync(item);
  };

  const submitMove = (item: FileEntryItem) => {
    if (!moveTargetParentPath.trim()) {
      setErrorMessage("目标目录不能为空");
      return;
    }
    void moveMutation.mutateAsync(item);
  };

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) {
      return;
    }
    setFeedbackMessage("");
    setErrorMessage("");
    void uploadMutation.mutateAsync(selected);
    event.target.value = "";
  };

  const handleDownload = async (item: FileEntryItem) => {
    if (!activeMountCode) {
      setErrorMessage("当前未选择可用挂载点");
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
      setFeedbackMessage(`下载已开始：${item.name}`);
      setErrorMessage("");
    } catch (error) {
      setFeedbackMessage("");
      setErrorMessage(error instanceof Error ? error.message : "下载失败");
    }
  };

  const listError = filesQuery.error instanceof Error ? filesQuery.error.message : "";
  const listData = filesQuery.data;
  const mounts = listData?.mounts ?? [];
  const items = listData?.items ?? [];
  const operationBusy =
    createDirectoryMutation.isPending ||
    deleteMutation.isPending ||
    renameMutation.isPending ||
    moveMutation.isPending ||
    uploadMutation.isPending;

  if (initializing || filesQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading files...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问文件管理页面。</p>
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
      {(listError || errorMessage) && (
        <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">
          {listError || errorMessage}
        </pre>
      )}
      {feedbackMessage && (
        <pre className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4 text-sm overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">
          {feedbackMessage}
        </pre>
      )}

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">挂载点</h2>
          <p className="mt-1 text-sm text-[var(--gray-11)]">一期按挂载点浏览目录树，支持 VFS/S3。</p>
          <div className="mt-4 space-y-2">
            {mounts.map((mount) => {
              const selected = mount.code === (listData?.current_mount.code ?? mountCode);
              return (
                <Button
                  key={mount.id}
                  type="button"
                  onClick={() => handleSelectMount(mount)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "border-[var(--accent-7)] bg-[var(--accent-9)] text-[var(--accent-contrast,#fff)]"
                      : "border-[var(--border)] bg-[var(--color-panel-solid,var(--gray-1))] text-[var(--gray-12)] hover:border-[var(--accent-6)] hover:bg-[var(--accent-a2)]"
                  }`}
                >
                  <p className="font-medium">{mount.name}</p>
                  <p className={`text-xs ${selected ? "text-[var(--accent-a2)]" : "text-[var(--gray-11)]"}`}>
                    {mount.backend.driver_type} · {mount.code}
                  </p>
                </Button>
              );
            })}
            {mounts.length === 0 && (
              <p className="text-sm text-[var(--gray-11)]">暂无可用挂载点。</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">文件列表</h2>
              <p className="mt-1 text-sm text-[var(--gray-11)]">
                存储后端：{listData?.current_mount.backend.name ?? "-"}（{listData?.current_mount.backend.driver_type ?? "-"}）
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                color="gray" size="1" variant="soft"
                onClick={() => void refreshCurrentPath()}
                disabled={filesQuery.isFetching}
              >
                {filesQuery.isFetching ? "刷新中..." : "刷新"}
              </Button>
              {canManage && (
                <>
                  <input
                    type="file"
                    aria-label="上传文件"
                    className="block w-72 cursor-pointer rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-3 py-2 text-sm text-[var(--gray-12)] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[var(--accent-9)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--accent-contrast,#fff)] hover:file:bg-[var(--accent-10)] disabled:cursor-not-allowed disabled:opacity-60"
                    onChange={handleUploadChange}
                    disabled={uploadMutation.isPending}
                  />
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--accent-a2)] px-3 py-2 text-sm">
            {(listData?.breadcrumbs ?? [{ name: "根目录", path: "/" }]).map((crumb, index, all) => (
              <div key={crumb.path} className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setCurrentPath(crumb.path);
                    resetActionPanels();
                  }}
                  className="rounded px-1 py-0.5 hover:bg-[var(--accent-a3)]"
                >
                  {crumb.name}
                </Button>
                {index < all.length - 1 && <span className="text-[var(--gray-10)]">/</span>}
              </div>
            ))}
          </div>

          {canManage && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TextField.Root
                value={newDirectoryName}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setNewDirectoryName(event.currentTarget.value)}
                placeholder="新建目录名"
                className="w-full max-w-xs"
              />
              <Button
                type="button"
               
                onClick={() => {
                  if (!newDirectoryName.trim()) {
                    setErrorMessage("目录名称不能为空");
                    return;
                  }
                  void createDirectoryMutation.mutateAsync();
                }}
                disabled={createDirectoryMutation.isPending}
              >
                {createDirectoryMutation.isPending ? "创建中..." : "新建目录"}
              </Button>
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header className="bg-[var(--gray-a3)]">
                <Table.Row>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">名称</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">类型</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">大小</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">修改时间</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">索引同步时间</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body className="divide-y divide-y">
                {items.map((item) => {
                  const isActive = activeItemPath === item.path;
                  return (
                    <Table.Row key={`${item.path}-${item.id}`}>
                      <Table.Cell className="px-4 py-3">
                        <Button
                          type="button"
                          className={`text-left ${item.is_dir ? "font-medium underline-offset-2 hover:underline" : ""}`}
                          onClick={() => handleOpenDirectory(item)}
                        >
                          {item.is_dir ? `[DIR] ${item.name}` : item.name}
                        </Button>
                        {isActive && canManage && (
                          <div className="mt-2 space-y-2 rounded-md border border-[var(--border)] bg-[var(--accent-a3)] p-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <TextField.Root
                                value={renameName}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setRenameName(event.currentTarget.value)}
                                placeholder="新名称"
                                className="w-48"
                              />
                              <Button
                                type="button"
                                color="gray" size="1" variant="soft"
                                onClick={() => submitRename(item)}
                                disabled={renameMutation.isPending}
                              >
                                {renameMutation.isPending ? "重命名中..." : "确认重命名"}
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <TextField.Root
                                value={moveTargetParentPath}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setMoveTargetParentPath(event.currentTarget.value)}
                                placeholder="目标目录（如 /a/b）"
                                className="w-48"
                              />
                              <TextField.Root
                                value={moveNewName}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setMoveNewName(event.currentTarget.value)}
                                placeholder="新名称（可选）"
                                className="w-40"
                              />
                              <Button
                                type="button"
                                color="gray" size="1" variant="soft"
                                onClick={() => submitMove(item)}
                                disabled={moveMutation.isPending}
                              >
                                {moveMutation.isPending ? "移动中..." : "确认移动"}
                              </Button>
                              <Button
                                type="button"
                                color="gray" size="1" variant="soft"
                                onClick={resetActionPanels}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap px-4 py-3">{item.is_dir ? "目录" : item.mime_type ?? "文件"}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap px-4 py-3">{item.is_dir ? "-" : formatFileSize(item.size)}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--gray-11)]">{formatDate(item.modified_at)}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap px-4 py-3 text-xs text-[var(--gray-11)]">{formatDate(item.synced_at)}</Table.Cell>
                      <Table.Cell className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {item.is_dir && (
                            <Button
                              type="button"
                              color="gray" size="1" variant="soft"
                              onClick={() => handleOpenDirectory(item)}
                            >
                              进入
                            </Button>
                          )}
                          {!item.is_dir && (
                            <Button
                              type="button"
                              color="gray" size="1" variant="soft"
                              onClick={() => void handleDownload(item)}
                            >
                              下载
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <Button
                                type="button"
                                color="gray" size="1" variant="soft"
                                onClick={() => startRename(item)}
                                disabled={operationBusy}
                              >
                                重命名
                              </Button>
                              <Button
                                type="button"
                                color="gray" size="1" variant="soft"
                                onClick={() => startMove(item)}
                                disabled={operationBusy}
                              >
                                移动
                              </Button>
                              <Button
                                type="button"
                                color="red" size="1" variant="soft"
                                onClick={() => handleDelete(item)}
                                disabled={deleteMutation.isPending}
                              >
                                删除
                              </Button>
                            </>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
                {items.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--gray-11)]">
                      当前目录为空
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </div>
        </section>
      </div>
    </div>
  );
}
