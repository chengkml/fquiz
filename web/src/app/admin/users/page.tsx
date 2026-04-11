"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { UserListResponse, UserPublic } from "@/types/auth";

export default function AdminUsersPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!user || !hasPermission("user.manage")) {
        setLoading(false);
        return;
      }

      const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
      if (!response.ok) {
        setError(await readApiError(response));
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as UserListResponse;
      setUsers(payload.items);
      setLoading(false);
    };
    void load();
  }, [fetchWithAuth, hasPermission, user]);

  if (initializing || loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-20">
        <p className="text-sm text-zinc-500">Loading users...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          请先登录后再访问用户管理页面。
        </p>
        <Link href="/" className="text-sm underline">
          返回首页
        </Link>
      </main>
    );
  }

  if (!hasPermission("user.manage")) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          你没有访问该页面的权限（需要 `user.manage`）。
        </p>
        <Link href="/" className="text-sm underline">
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
        <Link href="/" className="text-sm underline">
          返回首页
        </Link>
      </div>

      {error && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </pre>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="min-w-full divide-y divide-black/10 text-left text-sm dark:divide-white/15">
          <thead className="bg-black/[0.03] dark:bg-white/[0.06]">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium">Permissions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10 dark:divide-white/15">
            {users.map((item) => (
              <tr key={item.id}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  {item.id}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{item.email}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.username}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.status}</td>
                <td className="px-4 py-3">{item.role_codes.join(", ") || "-"}</td>
                <td className="px-4 py-3">
                  {item.permission_codes.join(", ") || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
