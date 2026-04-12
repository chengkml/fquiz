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
        <p className="text-sm text-muted">Loading admin workspace...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-muted">请先登录后再访问后台。</p>
        <Link href="/" className="btn-secondary w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="relative min-h-screen text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-[-5rem] h-72 w-72 rounded-full bg-cyan-300/30 blur-3xl" />
        <div className="absolute right-[-6rem] top-20 h-96 w-96 rounded-full bg-sky-300/30 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-[1360px] grid-cols-1 gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-r border-[var(--border)] bg-white/70 p-6 backdrop-blur-xl md:sticky md:top-0 md:h-screen md:overflow-y-auto">
          <div className="mb-8">
            <Link href="/" className="text-xl font-bold tracking-tight text-slate-900">fquiz admin</Link>
            <p className="mt-2 text-sm text-muted">{user.username} · {user.email}</p>
          </div>

          <nav className="space-y-2">
            {menuTree.map((item) => (
              <div key={item.id} className="space-y-1">
                {item.path ? (
                  <Link
                    href={item.path}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === item.path ? "bg-cyan-500 text-white shadow-[0_10px_24px_rgba(8,145,178,0.28)]" : "text-slate-700 hover:bg-cyan-50"}`}
                  >
                    {item.name}
                  </Link>
                ) : (
                  <div className="px-3 py-2 text-sm font-medium text-muted">{item.name}</div>
                )}
                {item.children.length > 0 && (
                  <div className="ml-3 space-y-1 border-l border-[var(--border)] pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.id}
                        href={child.path ?? "/admin"}
                        className={`block rounded-lg px-3 py-2 text-sm transition ${pathname === child.path ? "bg-cyan-500 text-white shadow-[0_8px_20px_rgba(8,145,178,0.28)]" : "text-slate-700 hover:bg-cyan-50"}`}
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <div className="mt-8 space-y-3 border-t border-[var(--border)] pt-6">
            <p className="text-xs text-muted">当前角色：{user.role_codes.join(", ") || "-"}</p>
            <button
              className="btn-secondary w-full"
              onClick={() => void logout()}
              type="button"
            >
              退出登录
            </button>
          </div>
        </aside>

        <main className="p-6 md:p-8">
          <div className="surface-card mb-6 flex items-center justify-between gap-4 bg-gradient-to-br from-white/95 via-cyan-50/65 to-sky-50/80">
            <div>
              <p className="text-sm text-muted">后台管理</p>
              <h1 className="text-2xl font-bold tracking-tight">{currentTitle}</h1>
            </div>
            <Link href="/" className="btn-secondary">返回首页</Link>
          </div>

          {menuError && (
            <pre className="notice notice-error mb-6">
              {menuError}
            </pre>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
