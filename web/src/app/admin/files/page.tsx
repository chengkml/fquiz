"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { useAuth } from "@/components/auth-provider";
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
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
    return <p className="text-sm text-zinc-500">Loading files...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">请先登录后再访问文件管理页面。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">你没有访问该页面的权限（需要 `file.read`）。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(listError || errorMessage) && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
          {listError || errorMessage}
        </pre>
      )}
      {feedbackMessage && (
        <pre className="overflow-auto rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
          {feedbackMessage}
        </pre>
      )}

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">挂载点</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">一期按挂载点浏览目录树，支持 VFS/S3。</p>
          <div className="mt-4 space-y-2">
            {mounts.map((mount) => {
              const selected = mount.code === (listData?.current_mount.code ?? mountCode);
              return (
                <button
                  key={mount.id}
                  type="button"
                  onClick={() => handleSelectMount(mount)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  }`}
                >
                  <p className="font-medium">{mount.name}</p>
                  <p className={`text-xs ${selected ? "text-white/80 dark:text-black/70" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {mount.backend.driver_type} · {mount.code}
                  </p>
                </button>
              );
            })}
            {mounts.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无可用挂载点。</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">文件列表</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                存储后端：{listData?.current_mount.backend.name ?? "-"}（{listData?.current_mount.backend.driver_type ?? "-"}）
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-black/15 px-3 py-2 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                onClick={() => void refreshCurrentPath()}
                disabled={filesQuery.isFetching}
              >
                {filesQuery.isFetching ? "刷新中..." : "刷新"}
              </button>
              {canManage && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleUploadChange}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-black px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                    onClick={handleUploadClick}
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending ? "上传中..." : "上传文件"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]">
            {(listData?.breadcrumbs ?? [{ name: "根目录", path: "/" }]).map((crumb, index, all) => (
              <div key={crumb.path} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPath(crumb.path);
                    resetActionPanels();
                  }}
                  className="rounded px-1 py-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                  {crumb.name}
                </button>
                {index < all.length - 1 && <span className="text-zinc-400">/</span>}
              </div>
            ))}
          </div>

          {canManage && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                value={newDirectoryName}
                onChange={(event) => setNewDirectoryName(event.target.value)}
                placeholder="新建目录名"
                className="w-full max-w-xs rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              />
              <button
                type="button"
                className="rounded-md bg-black px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
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
              </button>
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-black/10 text-left text-sm dark:divide-white/10">
              <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
                <tr>
                  <th className="px-4 py-3 font-medium">名称</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">大小</th>
                  <th className="px-4 py-3 font-medium">修改时间</th>
                  <th className="px-4 py-3 font-medium">索引同步时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-white/10">
                {items.map((item) => {
                  const isActive = activeItemPath === item.path;
                  return (
                    <tr key={`${item.path}-${item.id}`}>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className={`text-left ${item.is_dir ? "font-medium underline-offset-2 hover:underline" : ""}`}
                          onClick={() => handleOpenDirectory(item)}
                        >
                          {item.is_dir ? `[DIR] ${item.name}` : item.name}
                        </button>
                        {isActive && canManage && (
                          <div className="mt-2 space-y-2 rounded-md border border-black/10 bg-black/[0.03] p-2 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={renameName}
                                onChange={(event) => setRenameName(event.target.value)}
                                placeholder="新名称"
                                className="w-48 rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                              />
                              <button
                                type="button"
                                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                onClick={() => submitRename(item)}
                                disabled={renameMutation.isPending}
                              >
                                {renameMutation.isPending ? "重命名中..." : "确认重命名"}
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={moveTargetParentPath}
                                onChange={(event) => setMoveTargetParentPath(event.target.value)}
                                placeholder="目标目录（如 /a/b）"
                                className="w-48 rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                              />
                              <input
                                value={moveNewName}
                                onChange={(event) => setMoveNewName(event.target.value)}
                                placeholder="新名称（可选）"
                                className="w-40 rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                              />
                              <button
                                type="button"
                                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                onClick={() => submitMove(item)}
                                disabled={moveMutation.isPending}
                              >
                                {moveMutation.isPending ? "移动中..." : "确认移动"}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                onClick={resetActionPanels}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{item.is_dir ? "目录" : item.mime_type ?? "文件"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{item.is_dir ? "-" : formatFileSize(item.size)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">{formatDate(item.modified_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">{formatDate(item.synced_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {item.is_dir && (
                            <button
                              type="button"
                              className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                              onClick={() => handleOpenDirectory(item)}
                            >
                              进入
                            </button>
                          )}
                          {!item.is_dir && (
                            <button
                              type="button"
                              className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                              onClick={() => void handleDownload(item)}
                            >
                              下载
                            </button>
                          )}
                          {canManage && (
                            <>
                              <button
                                type="button"
                                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                onClick={() => startRename(item)}
                                disabled={operationBusy}
                              >
                                重命名
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                                onClick={() => startMove(item)}
                                disabled={operationBusy}
                              >
                                移动
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                onClick={() => handleDelete(item)}
                                disabled={deleteMutation.isPending}
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                      当前目录为空
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
