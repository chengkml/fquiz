"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, Select, TextArea, TextField } from "@radix-ui/themes";
import { readApiError } from "@/lib/api";
import type { RequirementPriority, RequirementStatus, UserListResponse } from "@/types/auth";

const STATUS_OPTIONS: RequirementStatus[] = [
  "PENDING_ANALYSIS",
  "PENDING_REVISION",
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];
const PRIORITY_OPTIONS: RequirementPriority[] = ["low", "medium", "high", "urgent"];
const UNASSIGNED_OPTION = "__unassigned__";

export default function RequirementCreatePage() {
  const router = useRouter();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<RequirementStatus>("PENDING_ANALYSIS");
  const [priority, setPriority] = useState<RequirementPriority>("medium");
  const [projectName, setProjectName] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [source, setSource] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [dueAt, setDueAt] = useState("");

  const canCreate = hasPermission("requirement.create") || hasPermission("requirement.manage");
  const canManageUsers = hasPermission("user.manage");

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManageUsers,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          priority,
          project_name: projectName || null,
          module_name: moduleName || null,
          source: source || null,
          assignee_user_id: assigneeUserId || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json() as Promise<{ id: string }>;
    },
    onSuccess: async (data) => {
      router.push(`/admin/requirements/${data.id}`);
    },
  });

  if (initializing) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再创建需求。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canCreate) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有创建需求的权限（需要 `requirement.create`）。</p>
        <Link href="/admin/requirements" className="btn-secondary w-fit">返回需求列表</Link>
      </main>
    );
  }

  const error = createMutation.error instanceof Error ? createMutation.error.message : "";
  const users = usersQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {error && (
        <pre className="notice notice-error">{error}</pre>
      )}

      <section className="surface-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">新建需求</h2>
            <p className="mt-1 text-sm text-muted">填写需求基本信息并指定初始处理人。</p>
          </div>
          <Link href="/admin/requirements" className="btn-secondary w-fit">返回列表</Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm md:col-span-2">
            <span>标题</span>
            <TextField.Root
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full"
            />
          </label>

          <label className="space-y-2 text-sm md:col-span-2">
            <span>描述</span>
            <TextArea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={8}
              className="w-full"
            />
          </label>

          <label className="space-y-2 text-sm">
            <span>状态</span>
            <Select.Root value={status} onValueChange={(value: string) => setStatus(value as RequirementStatus)}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {STATUS_OPTIONS.map((item) => (
                  <Select.Item key={item} value={item}>
                    {item}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label className="space-y-2 text-sm">
            <span>优先级</span>
            <Select.Root value={priority} onValueChange={(value: string) => setPriority(value as RequirementPriority)}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {PRIORITY_OPTIONS.map((item) => (
                  <Select.Item key={item} value={item}>
                    {item}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label className="space-y-2 text-sm">
            <span>项目</span>
            <TextField.Root value={projectName} onChange={(event) => setProjectName(event.target.value)} className="w-full" />
          </label>

          <label className="space-y-2 text-sm">
            <span>模块</span>
            <TextField.Root value={moduleName} onChange={(event) => setModuleName(event.target.value)} className="w-full" />
          </label>

          <label className="space-y-2 text-sm">
            <span>来源</span>
            <TextField.Root value={source} onChange={(event) => setSource(event.target.value)} className="w-full" />
          </label>

          <label className="space-y-2 text-sm">
            <span>指派人</span>
            <Select.Root
              value={assigneeUserId || UNASSIGNED_OPTION}
              onValueChange={(value: string) => setAssigneeUserId(value === UNASSIGNED_OPTION ? "" : value)}
              disabled={!canManageUsers}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value={UNASSIGNED_OPTION}>暂不指派</Select.Item>
                {users.map((item) => (
                  <Select.Item key={item.id} value={item.id}>
                    {item.username}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label className="space-y-2 text-sm">
            <span>截止时间</span>
            <TextField.Root type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="w-full" />
          </label>
        </div>

        <div className="mt-4">
          <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !title.trim()}>
            {createMutation.isPending ? "创建中..." : "创建需求"}
          </Button>
        </div>
      </section>
    </div>
  );
}
