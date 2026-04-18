"use client";

import Link from "next/link";
import { Button, Select, Table, TextField } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  ModelApiKeyListResponse,
  ModelApiKeyItem,
  ModelRegistryItem,
  PasswordModelListResponse,
} from "@/types/auth";

type StatusFilter = "all" | "DRAFT" | "ENABLED" | "DISABLED" | "DEPRECATED";

type RotateKeyForm = {
  api_key: string;
  note: string;
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "DRAFT", label: "草稿" },
  { value: "ENABLED", label: "已启用" },
  { value: "DISABLED", label: "已停用" },
  { value: "DEPRECATED", label: "已废弃" },
];

const MODEL_STATUS_LABELS: Record<Exclude<StatusFilter, "all">, string> = {
  DRAFT: "草稿",
  ENABLED: "已启用",
  DISABLED: "已停用",
  DEPRECATED: "已废弃",
};

const EMPTY_ROTATE_FORM: RotateKeyForm = {
  api_key: "",
  note: "",
};

function formatModelStatus(status: ModelRegistryItem["status"]): string {
  return `${MODEL_STATUS_LABELS[status]}（${status}）`;
}

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

export default function AdminPasswordPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [rotateForm, setRotateForm] = useState<RotateKeyForm>(EMPTY_ROTATE_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("model.read") || hasPermission("model.manage");
  const canManage = hasPermission("model.manage");

  const modelsPath = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (keyword.trim()) {
      params.set("keyword", keyword.trim());
    }
    const query = params.toString();
    return query ? `/api/v1/admin/password/models?${query}` : "/api/v1/admin/password/models";
  }, [keyword, statusFilter]);

  const modelsQuery = useQuery({
    queryKey: [modelsPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(modelsPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as PasswordModelListResponse;
    },
  });

  const models = modelsQuery.data?.items ?? [];

  const selectedModel = useMemo(
    () => models.find((item) => item.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const selectedModelKeysPath = useMemo(() => {
    if (selectedModelId === null) {
      return null;
    }
    return `/api/v1/admin/password/models/${selectedModelId}/keys`;
  }, [selectedModelId]);

  const keysQuery = useQuery({
    queryKey: [selectedModelKeysPath],
    enabled: !!selectedModelKeysPath && !!user && canRead,
    queryFn: async () => {
      if (!selectedModelKeysPath) {
        throw new Error("模型未选择");
      }
      const response = await fetchWithAuth(selectedModelKeysPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelApiKeyListResponse;
    },
  });

  const keys = keysQuery.data?.items ?? [];

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && (
          query.queryKey[0].startsWith("/api/v1/admin/password/models")
          || query.queryKey[0].startsWith("/api/v1/admin/models")
          || query.queryKey[0].startsWith("/api/v1/admin/models/summary")
        ),
    });
  }, [queryClient]);

  useTopicSubscription("admin.models", useCallback(() => {
    void refreshAll();
  }, [refreshAll]));

  const rotateKeyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedModelId) {
        throw new Error("请先选择模型");
      }
      const apiKey = rotateForm.api_key.trim();
      if (!apiKey) {
        throw new Error("密钥不能为空");
      }
      const response = await fetchWithAuth(`/api/v1/admin/password/models/${selectedModelId}/rotate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          note: rotateForm.note.trim() || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as ModelApiKeyItem;
    },
    onSuccess: async () => {
      setError("");
      setSuccess("密钥轮换成功");
      setRotateForm(EMPTY_ROTATE_FORM);
      await refreshAll();
      if (selectedModelKeysPath) {
        await queryClient.invalidateQueries({ queryKey: [selectedModelKeysPath] });
      }
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "密钥轮换失败");
    },
  });

  const listError = modelsQuery.error instanceof Error ? modelsQuery.error.message : "";
  const keysError = keysQuery.error instanceof Error ? keysQuery.error.message : "";

  if (initializing || modelsQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading password management...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问密钥管理页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `model.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || listError || keysError) && <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error || listError || keysError}</pre>}
      {success && <pre className="overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">模型密钥总览</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">查看各模型当前启用密钥脱敏信息，并进入版本明细与轮换。</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">关键词</span>
            <TextField.Root
              value={keyword}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyword(event.currentTarget.value)}
              placeholder="按模型编码 / 名称 / 厂商筛选"
              className="w-full"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">状态</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value: string) => setStatusFilter(value as StatusFilter)}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                {STATUS_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">模型</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">当前密钥</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">最近轮换</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {models.length === 0 && (
                <Table.Row>
                  <Table.Cell className="px-4 py-6 text-sm text-[var(--gray-11)]" colSpan={5}>
                    当前筛选条件下暂无模型。
                  </Table.Cell>
                </Table.Row>
              )}
              {models.map((item) => {
                const active = selectedModelId === item.id;
                return (
                  <Table.Row key={item.id}>
                    <Table.Cell className="px-4 py-3 align-top">
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-1 text-xs text-[var(--gray-11)]">{item.code}</p>
                      <p className="mt-1 text-xs text-[var(--gray-11)]">{item.provider} / {item.provider_model}</p>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-3 align-top">
                      <span className="inline-flex rounded-full bg-[var(--gray-a3)] px-2 py-1 text-xs font-medium text-[var(--gray-11)]">
                        {formatModelStatus(item.status)}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-3 align-top">
                      <p>{item.active_key_masked ?? "-"}</p>
                      <p className="mt-1 text-xs text-[var(--gray-11)]">v{item.active_key_version ?? "-"} / {item.active_key_fingerprint ?? "-"}</p>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-3 align-top">{formatDateTime(item.active_key_rotated_at)}</Table.Cell>
                    <Table.Cell className="px-4 py-3 align-top">
                      <Button
                        color={active ? "indigo" : "gray"}
                        size="1"
                        type="button"
                        variant={active ? "solid" : "soft"}
                        onClick={() => {
                          setSelectedModelId(item.id);
                          setError("");
                          setSuccess("");
                        }}
                      >
                        {active ? "当前模型" : "查看密钥"}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">密钥版本与轮换</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">
              {selectedModel ? `当前模型：${selectedModel.name}（${selectedModel.code}）` : "请先在上方选择一个模型"}
            </p>
          </div>
        </div>

        {selectedModelId === null ? (
          <p className="mt-4 text-sm text-[var(--gray-11)]">未选择模型，无法查看密钥版本与执行轮换。</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <Table.Root className="w-full min-w-full text-left text-sm">
                <Table.Header className="bg-[var(--gray-a3)]">
                  <Table.Row>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">版本</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">脱敏密钥</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">指纹</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">备注</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="px-4 py-3 font-medium">创建时间</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {keysQuery.isLoading && (
                    <Table.Row>
                      <Table.Cell className="px-4 py-6 text-sm text-[var(--gray-11)]" colSpan={6}>加载密钥版本中...</Table.Cell>
                    </Table.Row>
                  )}
                  {!keysQuery.isLoading && keys.length === 0 && (
                    <Table.Row>
                      <Table.Cell className="px-4 py-6 text-sm text-[var(--gray-11)]" colSpan={6}>该模型暂无密钥记录。</Table.Cell>
                    </Table.Row>
                  )}
                  {keys.map((key) => (
                    <Table.Row key={key.id}>
                      <Table.Cell className="px-4 py-3 align-top">v{key.version}</Table.Cell>
                      <Table.Cell className="px-4 py-3 align-top">{key.secret_masked}</Table.Cell>
                      <Table.Cell className="px-4 py-3 align-top">{key.secret_fingerprint}</Table.Cell>
                      <Table.Cell className="px-4 py-3 align-top">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${key.is_active ? "bg-[var(--green-a3)] text-[var(--green-11)]" : "bg-[var(--gray-a3)] text-[var(--gray-11)]"}`}>
                          {key.is_active ? "生效中" : "已失效"}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="px-4 py-3 align-top">{key.rotation_note ?? "-"}</Table.Cell>
                      <Table.Cell className="px-4 py-3 align-top">{formatDateTime(key.created_at)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>

            {canManage ? (
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="text-[var(--gray-11)]">新密钥</span>
                  <TextField.Root
                    type="password"
                    className="w-full"
                    value={rotateForm.api_key}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setRotateForm((prev) => ({ ...prev, api_key: event.currentTarget.value }))}
                    placeholder="输入新密钥（至少 8 位）"
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="text-[var(--gray-11)]">轮换备注（可选）</span>
                  <TextField.Root
                    className="w-full"
                    value={rotateForm.note}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setRotateForm((prev) => ({ ...prev, note: event.currentTarget.value }))}
                    placeholder="例如：季度轮换 / 紧急替换"
                  />
                </label>
                <div className="md:col-span-2">
                  <Button
                    type="button"
                   
                    disabled={rotateKeyMutation.isPending}
                    onClick={() => {
                      setError("");
                      setSuccess("");
                      rotateKeyMutation.mutate();
                    }}
                  >
                    {rotateKeyMutation.isPending ? "轮换中..." : "提交密钥轮换"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--gray-11)]">当前账号无 `model.manage` 权限，仅可查看密钥信息。</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
