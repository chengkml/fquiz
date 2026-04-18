"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuTreeItem } from "@/types/auth";
import { Button, Callout, Card, Flex, Heading, Text } from "@radix-ui/themes";

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
          <Button asChild className="w-full justify-start" color={active ? "indigo" : "gray"} size="2" variant={active ? "soft" : "ghost"}>
            <Link href={item.path}>{item.name}</Link>
          </Button>
        ) : (
          <Text className="px-2 py-1" color="gray" size="2" weight="medium">{item.name}</Text>
        )}

        {item.children.length > 0 && (
          <div className="ml-3 space-y-1 border-l border-[var(--gray-6)] pl-3">
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
        <p className="text-sm text-[var(--gray-11)]">Loading admin workspace...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Text color="gray" size="2">请先登录后再访问后台。</Text>
        <Button asChild className="w-fit" color="gray" variant="soft">
          <Link href="/">返回首页</Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-[1760px] grid-cols-1 px-3 sm:px-4 xl:px-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-r border-[var(--gray-6)] p-4 md:sticky md:top-0 md:h-screen md:overflow-y-auto md:p-6">
        <Card size="2">
          <Flex direction="column" gap="4">
            <div>
              <Heading as="h1" size="5">fquiz admin</Heading>
              <Text className="mt-1" color="gray" size="2">系统菜单</Text>
            </div>

            <nav className="space-y-2">
              {renderMenuNodes(menuTree, pathname)}
            </nav>

            <div className="space-y-2 border-t border-[var(--gray-6)] pt-4">
              <Text color="gray" size="1">当前角色：{user.role_codes.join(", ") || "-"}</Text>
              <Text color="gray" size="1">账号状态：{user.status || "-"}</Text>
            </div>
          </Flex>
        </Card>
      </aside>

      <main className="p-4 md:p-6">
        <Card className="mb-6" size="3">
          <Flex align="start" gap="4" justify="between" wrap="wrap">
            <div>
              <Text color="gray" size="2">后台管理</Text>
              <Heading as="h2" size="6">{currentTitle}</Heading>
            </div>

            <Flex align="center" gap="2" justify="end" wrap="wrap">
              <div className="min-w-[160px] text-right">
                <Text size="2" weight="medium">{user.username}</Text>
                <Text color="gray" size="1">{user.email}</Text>
              </div>
              <Button color="gray" onClick={() => void logout()} size="1" type="button" variant="soft">
                退出登录
              </Button>
              <Button asChild color="gray" size="1" variant="soft">
                <Link href="/">返回首页</Link>
              </Button>
            </Flex>
          </Flex>
        </Card>

        {menuError && (
          <Callout.Root className="mb-6" color="red">
            <Callout.Text>{menuError}</Callout.Text>
          </Callout.Root>
        )}

        {children}
      </main>
    </div>
  );
}
