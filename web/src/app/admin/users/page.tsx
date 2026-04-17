"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button, TextField } from "@radix-ui/themes";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { RoleItem, RoleListResponse, UserListResponse, UserPublic } from "@/types/auth";

type UserRolePayload = {
  role_codes: string[];
};

export default function AdminUsersPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("user.manage");
  const canReadRoles = hasPermission("role.read") || hasPermission("role.manage");

  const usersPath = "/api/v1/users?limit=200&offset=0";
  const rolesPath = "/api/v1/admin/roles";

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth(usersPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const loadRoles = useCallback(async () => {
    const response = await fetchWithAuth(rolesPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as RoleListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: [usersPath],
    queryFn: loadUsers,
    enabled: !!user && canManage,
  });

  const rolesQuery = useQuery({
    queryKey: [rolesPath],
    queryFn: loadRoles,
    enabled: !!user && canManage && canReadRoles,
  });

  useTopicSubscription(
    "admin.users",
    useCallback(() => {
      if (!user || !canManage) return;
      void queryClient.invalidateQueries({ queryKey: [usersPath] });
      if (canReadRoles) {
        void queryClient.invalidateQueries({ queryKey: [rolesPath] });
      }
    }, [canManage, canReadRoles, queryClient, user]),
  );

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data?.items]);
  const roles = useMemo<RoleItem[]>(() => {
    if (canReadRoles) return rolesQuery.data?.items ?? [];
    return Array.from(new Set(users.flatMap((item) => item.role_codes))).map((code, index) => ({
      id: -(index + 1),
      code,
      name: code,
      permission_codes: [],
      menu_ids: [],
    } satisfies RoleItem));
  }, [canReadRoles, rolesQuery.data?.items, users]);

  const roleOptions = useMemo(() => roles.map((item) => item.code), [roles]);

  const refreshData = async () => {
    await queryClient.invalidateQueries({ queryKey: [usersPath] });
    if (canReadRoles) {
      await queryClient.invalidateQueries({ queryKey: [rolesPath] });
    }
  };

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newUserId.trim(),
          email: newEmail.trim(),
          username: newUsername.trim(),
          password: newPassword,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onSuccess: async () => {
      setSuccess("用户已创建");
      setError("");
      setNewUserId("");
      setNewEmail("");
      setNewUsername("");
      setNewPassword("");
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建用户失败");
    },
  });

  const updateRolesMutation = useMutation({
    mutationFn: async ({ userId, roleCodes }: { userId: string; roleCodes: string[] }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_codes: roleCodes } satisfies UserRolePayload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setSavingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("用户角色已更新");
      await refreshData();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "更新失败");
    },
    onSettled: () => setSavingUserId(null),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: password }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setResettingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: () => setSuccess("密码已重置"),
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "重置密码失败");
    },
    onSettled: () => setResettingUserId(null),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<{ message: string }>;
    },
    onMutate: (userId) => {
      setDeletingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("用户已删除");
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除用户失败");
    },
    onSettled: () => setDeletingUserId(null),
  });

  const handleCreateUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    createUserMutation.mutate();
  };

  const anyError =
    error
    || (usersQuery.error instanceof Error ? usersQuery.error.message : "")
    || (rolesQuery.error instanceof Error ? rolesQuery.error.message : "");

  if (initializing || usersQuery.isLoading || rolesQuery.isLoading) {
    return <p className="text-sm text-muted">Loading users...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问用户管理页面。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">你没有访问该页面的权限（需要 `user.manage`）。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {anyError && <pre className="notice notice-error">{anyError}</pre>}
      {success && <pre className="notice notice-success">{success}</pre>}

      <section className="surface-card">
        <h2 className="text-lg font-semibold">新增用户</h2>
        <p className="mt-1 text-sm text-muted">用户 ID 由管理员手动填写，系统会校验重复。</p>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleCreateUser}>
          <TextField.Root
            placeholder="用户 ID（例如 ck001）"
            value={newUserId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUserId(event.currentTarget.value)}
            minLength={3}
            maxLength={64}
            required
          />
          <TextField.Root
            placeholder="邮箱"
            type="email"
            value={newEmail}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNewEmail(event.currentTarget.value)}
            required
          />
          <TextField.Root
            placeholder="用户名"
            value={newUsername}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUsername(event.currentTarget.value)}
            minLength={3}
            maxLength={64}
            required
          />
          <TextField.Root
            placeholder="初始密码（至少8位）"
            type="password"
            value={newPassword}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNewPassword(event.currentTarget.value)}
            minLength={8}
            maxLength={128}
            required
          />
          <div className="md:col-span-2">
            <Button type="submit" disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? "创建中..." : "创建用户"}
            </Button>
          </div>
        </form>
      </section>

      <section className="surface-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">用户列表</h2>
            <p className="mt-1 text-sm text-muted">表头已中文化，支持改角色、重置密码、删除。</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-modern min-w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-medium">用户ID</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">用户名</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">权限</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="table-body divide-y">
              {users.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.id}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.email}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.username}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {roleOptions.map((roleCode) => {
                        const checked = item.role_codes.includes(roleCode);
                        return (
                          <label key={roleCode} className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-white/80 px-2 py-1 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={savingUserId === item.id}
                              className="accent-indigo-600"
                              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                const nextRoles = event.currentTarget.checked
                                  ? [...item.role_codes, roleCode]
                                  : item.role_codes.filter((code) => code !== roleCode);
                                updateRolesMutation.mutate({ userId: item.id, roleCodes: nextRoles });
                              }}
                            />
                            <span>{roleCode}</span>
                          </label>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3">{item.permission_codes.join(", ") || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        disabled={resettingUserId === item.id}
                        onClick={() => {
                          const pwd = window.prompt(`请输入用户 ${item.username} 的新密码（至少8位）`);
                          if (!pwd) return;
                          if (pwd.length < 8) {
                            setError("新密码长度至少 8 位");
                            return;
                          }
                          resetPasswordMutation.mutate({ userId: item.id, password: pwd });
                        }}
                      >
                        {resettingUserId === item.id ? "重置中..." : "改密码"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        disabled={deletingUserId === item.id}
                        onClick={() => {
                          const confirmed = window.confirm(`确认删除用户 ${item.username}（${item.id}）？`);
                          if (!confirmed) return;
                          deleteUserMutation.mutate(item.id);
                        }}
                      >
                        {deletingUserId === item.id ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
