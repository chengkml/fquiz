"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuTreeItem } from "@/types/auth";

function flattenMenuTree(tree: MenuTreeItem[]): MenuTreeItem[] {
  const result: MenuTreeItem[] = [];
  const walk = (items: MenuTreeItem[]) => {
    for (const item of items) {
      result.push(item);
      if (item.children.length > 0) {
        walk(item.children);
      }
    }
  };
  walk(tree);
  return result;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, initializing, fetchWithAuth, logout } = useAuth();
  const [menuTree, setMenuTree] = useState<MenuTreeItem[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [menuError, setMenuError] = useState("");

  const loadMenus = useCallback(async () => {
    if (!user) {
      setMenuTree([]);
      setLoadingMenus(false);
      return;
    }
    const response = await fetchWithAuth("/api/v1/admin/me/menus");
    if (!response.ok) {
      setMenuError(await readApiError(response));
      setLoadingMenus(false);
      return;
    }
    const payload = (await response.json()) as MenuTreeItem[];
    setMenuTree(payload);
    setLoadingMenus(false);
  }, [fetchWithAuth, user]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadMenus();
    });
  }, [loadMenus]);

  useTopicSubscription("admin.menus", useCallback(() => {
    void loadMenus();
  }, [loadMenus]));

  useTopicSubscription("auth", useCallback(() => {
    void loadMenus();
  }, [loadMenus]));

  const flatMenus = useMemo(() => flattenMenuTree(menuTree), [menuTree]);
  const currentTitle = useMemo(() => {
    const current = flatMenus.find((item) => item.path === pathname);
    return current?.name ?? "后台管理";
  }, [flatMenus, pathname]);

  if (initializing || loadingMenus) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-20">
        <p className="text-sm text-zinc-500">Loading admin workspace...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">请先登录后再访问后台。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-0 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r border-black/10 bg-white/90 p-6 dark:border-white/10 dark:bg-zinc-900/80">
          <div className="mb-8">
            <Link href="/" className="text-xl font-semibold tracking-tight">fquiz admin</Link>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{user.username} · {user.email}</p>
          </div>

          <nav className="space-y-2">
            {menuTree.map((item) => (
              <div key={item.id} className="space-y-1">
                {item.path ? (
                  <Link
                    href={item.path}
                    className={`block rounded-lg px-3 py-2 text-sm transition ${pathname === item.path ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
                  >
                    {item.name}
                  </Link>
                ) : (
                  <div className="px-3 py-2 text-sm font-medium text-zinc-500 dark:text-zinc-300">{item.name}</div>
                )}
                {item.children.length > 0 && (
                  <div className="ml-3 space-y-1 border-l border-black/10 pl-3 dark:border-white/10">
                    {item.children.map((child) => (
                      <Link
                        key={child.id}
                        href={child.path ?? "/admin"}
                        className={`block rounded-lg px-3 py-2 text-sm transition ${pathname === child.path ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="mt-8 space-y-3 border-t border-black/10 pt-6 dark:border-white/10">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">当前角色：{user.role_codes.join(", ") || "-"}</p>
            <button
              className="w-full rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              onClick={() => void logout()}
              type="button"
            >
              退出登录
            </button>
          </div>
        </aside>

        <main className="p-6 md:p-8">
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">后台管理</p>
              <h1 className="text-2xl font-semibold tracking-tight">{currentTitle}</h1>
            </div>
            <Link href="/" className="text-sm underline">返回首页</Link>
          </div>

          {menuError && (
            <pre className="mb-6 overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
              {menuError}
            </pre>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
