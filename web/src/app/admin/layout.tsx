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

function isActivePath(pathname: string, menuPath: string | null): boolean {
  if (!menuPath) {
    return false;
  }
  return pathname === menuPath || pathname.startsWith(`${menuPath}/`);
}

function renderMenuNodes(items: MenuTreeItem[], pathname: string): React.ReactNode {
  return items.map((item) => {
    const active = isActivePath(pathname, item.path);

    return (
      <div key={item.id} className="space-y-1">
        {item.path ? (
          <Link
            href={item.path}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-indigo-500 text-white shadow-[0_10px_24px_rgba(79,70,229,0.28)]" : "text-slate-700 hover:bg-indigo-50"}`}
          >
            {item.name}
          </Link>
        ) : (
          <div className="px-3 py-2 text-sm font-medium text-muted">{item.name}</div>
        )}

        {item.children.length > 0 && (
          <div className="ml-3 space-y-1 border-l border-[var(--border)] pl-3">
            {renderMenuNodes(item.children, pathname)}
          </div>
        )}
      </div>
    );
  });
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

    setLoadingMenus(true);
    setMenuError("");

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
    const current = flatMenus.find((item) => isActivePath(pathname, item.path));
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
        <div className="absolute -left-24 top-[-5rem] h-72 w-72 rounded-full bg-indigo-300/30 blur-3xl" />
        <div className="absolute right-[-6rem] top-20 h-96 w-96 rounded-full bg-sky-300/30 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-screen w-full max-w-[1760px] grid-cols-1 gap-0 px-3 sm:px-4 xl:px-6 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-r border-[var(--border)] bg-white/70 p-6 backdrop-blur-xl md:sticky md:top-0 md:h-screen md:overflow-y-auto">
          <div className="mb-8">
            <Link href="/" className="text-xl font-bold tracking-tight text-slate-900">fquiz admin</Link>
            <p className="mt-2 text-sm text-muted">系统菜单</p>
          </div>

          <nav className="space-y-2">
            {renderMenuNodes(menuTree, pathname)}
          </nav>

          <div className="mt-8 space-y-2 border-t border-[var(--border)] pt-6">
            <p className="text-xs text-muted">当前角色：{user.role_codes.join(", ") || "-"}</p>
            <p className="text-xs text-muted">账号状态：{user.status || "-"}</p>
          </div>
        </aside>

        <main className="p-4 md:p-6">
          <header className="surface-card mb-6 flex flex-wrap items-start justify-between gap-4 bg-gradient-to-br from-white/95 via-indigo-50/65 to-sky-50/80">
            <div>
              <p className="text-sm text-muted">后台管理</p>
              <h1 className="text-2xl font-bold tracking-tight">{currentTitle}</h1>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <div className="min-w-[160px] text-right">
                <p className="text-sm font-semibold text-slate-900">{user.username}</p>
                <p className="text-xs text-muted">{user.email}</p>
              </div>
              <button
                className="btn-secondary btn-small"
                onClick={() => void logout()}
                type="button"
              >
                退出登录
              </button>
              <Link href="/" className="btn-secondary btn-small">返回首页</Link>
            </div>
          </header>

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
