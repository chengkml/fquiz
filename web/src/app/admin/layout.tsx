"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import { usePathname } from "next/navigation";
import Icon, {
  BgColorsOutlined,
  CompressOutlined,
  LinkOutlined,
  MoonOutlined,
  ShopOutlined,
  SmileOutlined,
  SunOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Avatar, Badge, Button as AntButton, Dropdown, Menu as AntMenu, Tooltip, type MenuProps } from "antd";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuTreeItem } from "@/types/auth";
import {
  Button,
  Callout,
  DropdownMenu,
  Flex,
  Heading,
  Text,
  useThemeAppearance,
} from "@/components/ui-antd";

const ThemeSvgIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" {...props}>
    <title>Theme icon</title>
    <g fillRule="evenodd">
      <g fillRule="nonzero">
        <path d="M7.02 3.635l12.518 12.518a1.863 1.863 0 010 2.635l-1.317 1.318a1.863 1.863 0 01-2.635 0L3.068 7.588A2.795 2.795 0 117.02 3.635zm2.09 14.428a.932.932 0 110 1.864.932.932 0 010-1.864zm-.043-9.747L7.75 9.635l9.154 9.153 1.318-1.317-9.154-9.155zM3.52 12.473c.514 0 .931.417.931.931v.932h.932a.932.932 0 110 1.864h-.932v.931a.932.932 0 01-1.863 0l-.001-.931h-.93a.932.932 0 010-1.864h.93v-.932c0-.514.418-.931.933-.931zm15.374-3.727a1.398 1.398 0 110 2.795 1.398 1.398 0 010-2.795zM4.385 4.953a.932.932 0 000 1.317l2.046 2.047L7.75 7 5.703 4.953a.932.932 0 00-1.318 0zM14.701.36a.932.932 0 01.931.932v.931h.932a.932.932 0 010 1.864h-.933l.001.932a.932.932 0 11-1.863 0l-.001-.932h-.93a.932.932 0 110-1.864h.93v-.931a.932.932 0 01.933-.932z" />
      </g>
    </g>
  </svg>
);

function ThemeIcon() {
  return <Icon component={ThemeSvgIcon} />;
}

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

function normalizeAdminPath(path: string | null): string | null {
  if (!path) {
    return path;
  }
  if (path === "/admin" || path === "/admin/") {
    return "/dashboard";
  }
  if (path.startsWith("/admin/")) {
    return path.slice("/admin".length);
  }
  return path;
}

function normalizeMenuTreePaths(items: MenuTreeItem[]): MenuTreeItem[] {
  return items.map((item) => ({
    ...item,
    path: normalizeAdminPath(item.path),
    children: normalizeMenuTreePaths(item.children),
  }));
}

function isActivePath(pathname: string, menuPath: string | null): boolean {
  if (!menuPath) {
    return false;
  }
  return pathname === menuPath || pathname.startsWith(`${menuPath}/`);
}

type AntdMenuItems = NonNullable<MenuProps["items"]>;

function buildMenuItems(items: MenuTreeItem[]): AntdMenuItems {
  return items.map((item) => {
    const children = buildMenuItems(item.children);
    const label = item.path ? <Link href={item.path}>{item.name}</Link> : item.name;

    if (children.length > 0) {
      return {
        key: item.id,
        label,
        children,
      };
    }

    return {
      key: item.id,
      label,
      disabled: !item.path,
    };
  });
}

type ActiveMenuState = {
  selectedKeys: string[];
  openKeys: string[];
};

function findActiveMenuState(
  items: MenuTreeItem[],
  pathname: string,
  parentKeys: string[] = [],
): ActiveMenuState {
  for (const item of items) {
    const nextParents = [...parentKeys, item.id];
    if (isActivePath(pathname, item.path)) {
      return {
        selectedKeys: [item.id],
        openKeys: parentKeys,
      };
    }

    if (item.children.length > 0) {
      const childMatch = findActiveMenuState(item.children, pathname, nextParents);
      if (childMatch.selectedKeys.length > 0) {
        return childMatch;
      }
    }
  }

  return {
    selectedKeys: [],
    openKeys: [],
  };
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, initializing, fetchWithAuth, logout } = useAuth();
  const {
    themePrimaryMode,
    setThemePrimaryMode,
    compactMode,
    setCompactMode,
    happyWorkMode,
    setHappyWorkMode,
  } = useThemeAppearance();
  const [menuTree, setMenuTree] = useState<MenuTreeItem[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>([]);
  const [aiThemeEnabled, setAiThemeEnabled] = useState(false);

  const loadMenus = useCallback(async () => {
    if (!user) {
      setMenuTree([]);
      setMenuError("");
      setLoadingMenus(false);
      return;
    }

    setLoadingMenus(true);
    setMenuError("");
    try {
      const response = await fetchWithAuth("/api/v1/admin/me/menus");
      if (!response.ok) {
        setMenuTree([]);
        setMenuError(await readApiError(response));
        return;
      }

      const payload = (await response.json()) as MenuTreeItem[];
      setMenuTree(normalizeMenuTreePaths(payload));
    } catch (error) {
      setMenuTree([]);
      setMenuError(error instanceof Error ? error.message : "菜单加载失败，请检查网络连接或后端服务。");
    } finally {
      setLoadingMenus(false);
    }
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
  const menuItems = useMemo(() => buildMenuItems(menuTree), [menuTree]);
  const activeMenuState = useMemo(() => findActiveMenuState(menuTree, pathname), [menuTree, pathname]);
  const currentTitle = useMemo(() => {
    const current = flatMenus.find((item) => isActivePath(pathname, item.path));
    return current?.name ?? "后台管理";
  }, [flatMenus, pathname]);

  useEffect(() => {
    setMenuOpenKeys(activeMenuState.openKeys);
  }, [activeMenuState.openKeys]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const persisted = window.localStorage.getItem("fquiz:theme:ai-market");
    setAiThemeEnabled(persisted === "1");
  }, []);

  const themeBadge = <Badge color="blue" style={{ marginTop: -1 }} />;
  const themeMenuItems = useMemo<NonNullable<MenuProps["items"]>>(
    () => [
      {
        key: "auto",
        icon: <SyncOutlined />,
        label: "跟随系统",
        extra: themePrimaryMode === "auto" ? themeBadge : null,
      },
      {
        key: "light",
        icon: <SunOutlined />,
        label: "浅色主题",
        extra: themePrimaryMode === "light" ? themeBadge : null,
      },
      {
        key: "dark",
        icon: <MoonOutlined />,
        label: "暗黑主题",
        extra: themePrimaryMode === "dark" ? themeBadge : null,
      },
      { type: "divider" },
      {
        key: "compact",
        icon: <CompressOutlined />,
        label: "紧凑主题",
        extra: compactMode ? themeBadge : null,
      },
      { type: "divider" },
      {
        key: "happy-work",
        icon: <SmileOutlined />,
        label: "快乐工作特效",
        extra: happyWorkMode ? themeBadge : null,
      },
      { type: "divider" },
      {
        key: "market",
        icon: <ShopOutlined />,
        label: "AI 生成主题",
        extra: aiThemeEnabled ? themeBadge : null,
      },
      {
        key: "theme-editor",
        icon: <BgColorsOutlined />,
        label: (
          <a href="https://ant.design/theme-editor-cn" rel="noreferrer" target="_blank">
            主题编辑器
          </a>
        ),
        extra: <LinkOutlined />,
      },
    ],
    [aiThemeEnabled, compactMode, happyWorkMode, themePrimaryMode],
  );

  const onThemeMenuClick = useCallback(
    ({ key }: Parameters<NonNullable<MenuProps["onClick"]>>[0]) => {
      if (key === "auto" || key === "light" || key === "dark") {
        setThemePrimaryMode(key);
        return;
      }
      if (key === "compact") {
        setCompactMode(!compactMode);
        return;
      }
      if (key === "happy-work") {
        setHappyWorkMode(!happyWorkMode);
        return;
      }
      if (key === "market") {
        setAiThemeEnabled((prev) => {
          const next = !prev;
          if (typeof window !== "undefined") {
            window.localStorage.setItem("fquiz:theme:ai-market", next ? "1" : "0");
            if (next) {
              window.open("https://ant.design/theme-editor-cn", "_blank", "noopener,noreferrer");
            }
          }
          return next;
        });
      }
    },
    [compactMode, happyWorkMode, setCompactMode, setHappyWorkMode, setThemePrimaryMode],
  );

  if (initializing || loadingMenus) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-20">
        <p className="text-sm text-[var(--ant-color-text-secondary)]">Loading admin workspace...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Text color="gray" size="2">请先登录后再访问后台。</Text>
        <Button asChild className="w-fit" color="gray" variant="soft">
          <Link href="/">前往登录</Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ant-color-bg-layout)]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--ant-color-border-secondary)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1760px] items-center gap-3 px-3 sm:px-4 xl:px-6">
          <Link className="flex shrink-0 items-center gap-2" href="/dashboard">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--ant-color-primary)] text-sm font-semibold text-white">
              Q
            </span>
            <div className="hidden sm:block">
              <Text size="2" weight="bold">fquiz</Text>
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Dropdown
              menu={{ items: themeMenuItems, onClick: onThemeMenuClick }}
              arrow={{ pointAtCenter: true }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Tooltip title="主题">
                <AntButton icon={<ThemeIcon />} style={{ fontSize: 16 }} type="text" />
              </Tooltip>
            </Dropdown>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Avatar
                  size="small"
                  style={{ backgroundColor: "var(--ant-color-primary)", verticalAlign: "middle" }}
                >
                  {user.username.trim().charAt(0).toUpperCase() || "U"}
                </Avatar>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" size="2" variant="soft">
                <DropdownMenu.Label>{user.username}</DropdownMenu.Label>
                <DropdownMenu.Label>角色：{user.role_codes.join(", ") || "-"}</DropdownMenu.Label>
                <DropdownMenu.Label>状态：{user.status || "-"}</DropdownMenu.Label>
                <DropdownMenu.Separator />
                <DropdownMenu.Item asChild>
                  <Link href="/dashboard">后台首页</Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item color="red" onSelect={() => void logout()}>
                  退出登录
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>

      <div
        className="mx-auto grid w-full max-w-[1760px] grid-cols-1 gap-0 px-3 pb-6 pt-[64px] sm:px-4 xl:px-6 md:grid-cols-[256px_minmax(0,1fr)]"
      >
        <aside className="hidden md:block">
          <div className="sticky top-[64px] h-[calc(100vh-64px)] overflow-y-auto border-r border-[var(--ant-color-border-secondary)] bg-white px-3 py-4">
            <Text color="gray" size="2">系统菜单</Text>
            <AntMenu
              mode="inline"
              items={menuItems}
              openKeys={menuOpenKeys}
              selectedKeys={activeMenuState.selectedKeys}
              style={{ marginTop: 8, borderInlineEnd: "none", background: "transparent" }}
              onOpenChange={(keys: string[]) => setMenuOpenKeys(keys)}
            />

            <div className="mt-3 space-y-2 border-t border-[var(--ant-color-border-secondary)] pt-3">
              <Text color="gray" size="1">当前角色：{user.role_codes.join(", ") || "-"}</Text>
              <Text color="gray" size="1">账号状态：{user.status || "-"}</Text>
            </div>
          </div>
        </aside>

        <main className="min-w-0 px-0 py-4 md:px-6">
          <Flex className="mb-4 gap-2" align="center" justify="between" wrap="wrap">
            <div className="min-w-0">
              <Text color="gray" size="2">后台管理</Text>
              <Heading as="h2" className="truncate" size="6">{currentTitle}</Heading>
            </div>
            <div className="max-w-[320px] text-right">
              <Text size="2" weight="medium">{user.username}</Text>
              <Text className="block truncate" color="gray" size="1">{user.email}</Text>
            </div>
          </Flex>

          {menuError && (
            <Callout.Root className="mb-6" color="red">
              <Callout.Text>{menuError}</Callout.Text>
            </Callout.Root>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
