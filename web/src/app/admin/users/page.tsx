"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("user.manage");
  const canReadRoles = hasPermission("role.read") || hasPermission("role.manage");

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const loadRoles = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/admin/roles");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RoleListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManage,
  });

  const rolesQuery = useQuery({
    queryKey: ["/api/v1/admin/roles"],
    queryFn: loadRoles,
    enabled: !!user && canManage && canReadRoles,
  });

  useTopicSubscription(
    "admin.users",
    useCallback(() => {
      if (!user || !canManage) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/v1/users?limit=200&offset=0"] });
      if (canReadRoles) {
        void queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/roles"] });
      }
    }, [canManage, canReadRoles, queryClient, user]),
  );

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data?.items]);
  const roles = useMemo<RoleItem[]>(() => {
    if (canReadRoles) {
      return rolesQuery.data?.items ?? [];
    }
    return Array.from(new Set(users.flatMap((item) => item.role_codes))).map((code, index) => ({
      id: -(index + 1),
      code,
      name: code,
      permission_codes: [],
      menu_ids: [],
    } satisfies RoleItem));
  }, [canReadRoles, rolesQuery.data?.items, users]);

  const roleOptions = useMemo(() => roles.map((item) => item.code), [roles]);

  const updateRolesMutation = useMutation({
    mutationFn: async ({ userId, roleCodes }: { userId: string; roleCodes: string[] }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_codes: roleCodes } satisfies UserRolePayload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setSavingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("用户角色已更新");
      await queryClient.invalidateQueries({ queryKey: ["/api/v1/users?limit=200&offset=0"] });
      if (canReadRoles) {
        await queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/roles"] });
      }
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "更新失败");
    },
    onSettled: () => {
      setSavingUserId(null);
    },
  });

  const anyError = error
    || (usersQuery.error instanceof Error ? usersQuery.error.message : "")
    || (rolesQuery.error instanceof Error ? rolesQuery.error.message : "");

  if (initializing || usersQuery.isLoading || rolesQuery.isLoading) {
    return <p className="text-sm text-zinc-500">Loading users...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">请先登录后再访问用户管理页面。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">你没有访问该页面的权限（需要 `user.manage`）。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {anyError && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{anyError}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">{success}</pre>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">用户列表</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">查看所有用户，并直接调整角色。</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-black/10 text-left text-sm dark:divide-white/15">
            <thead className="bg-black/[0.03] dark:bg-white/[0.06]">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Roles</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 dark:divide-white/15">
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
                          <label key={roleCode} className="flex items-center gap-1 rounded-full border border-black/10 px-2 py-1 text-xs dark:border-white/10">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={savingUserId === item.id}
                              onChange={(event) => {
                                const nextRoles = event.target.checked
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
                  <td className="px-4 py-3 text-xs text-zinc-500">{savingUserId === item.id ? "保存中..." : "自动保存"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
