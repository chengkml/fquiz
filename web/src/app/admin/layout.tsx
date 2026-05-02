"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { usePathname } from "next/navigation";
import Icon, {
  CompressOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
  SyncOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout as AntLayout,
  Menu as AntMenu,
  Result,
  Space,
  Spin,
  Tooltip,
  Typography,
  type MenuProps,
  type ResultProps,
} from "antd";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuTreeItem } from "@/types/auth";
import { useThemeAppearance } from "@/components/ui-antd";

const { Header, Sider, Content } = AntLayout;
const AntResult = Result as unknown as ComponentType<ResultProps>;

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

function AdminCenteredState({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ant-color-bg-layout)] px-6 py-20">
      {children}
    </main>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  const isDesktop = screens.md === true;
  const { user, initializing, fetchWithAuth, logout } = useAuth();
  const {
    themePrimaryMode,
    setThemePrimaryMode,
    compactMode,
    setCompactMode,
  } = useThemeAppearance();
  const [menuTree, setMenuTree] = useState<MenuTreeItem[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>([]);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const menuItems = useMemo(() => buildMenuItems(menuTree), [menuTree]);
  const activeMenuState = useMemo(() => findActiveMenuState(menuTree, pathname), [menuTree, pathname]);

  useEffect(() => {
    queueMicrotask(() => {
      setMenuOpenKeys(activeMenuState.openKeys);
    });
  }, [activeMenuState.openKeys]);

  const themeBadge = useMemo(
    () => <Badge color="var(--fquiz-theme-primary, var(--ant-color-primary))" style={{ marginTop: -1 }} />,
    [],
  );
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
    ],
    [compactMode, themeBadge, themePrimaryMode],
  );

  const accountMenuItems = useMemo<NonNullable<MenuProps["items"]>>(
    () => [
      {
        key: "account",
        icon: <UserOutlined />,
        disabled: true,
        label: (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{user?.username}</Typography.Text>
            <Typography.Text type="secondary">角色：{user?.role_codes.join(", ") || "-"}</Typography.Text>
            <Typography.Text type="secondary">状态：{user?.status || "-"}</Typography.Text>
          </Space>
        ),
      },
      { type: "divider" },
      {
        key: "home",
        icon: <HomeOutlined />,
        label: <Link href="/dashboard">后台首页</Link>,
      },
      {
        key: "logout",
        danger: true,
        icon: <LogoutOutlined />,
        label: "退出登录",
      },
    ],
    [user?.role_codes, user?.status, user?.username],
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
    },
    [compactMode, setCompactMode, setThemePrimaryMode],
  );

  const onAccountMenuClick = useCallback(
    ({ key }: Parameters<NonNullable<MenuProps["onClick"]>>[0]) => {
      if (key === "logout") {
        void logout();
      }
    },
    [logout],
  );

  const navigationMenu = (
    <AntMenu
      mode="inline"
      items={menuItems}
      openKeys={siderCollapsed && isDesktop ? [] : menuOpenKeys}
      selectedKeys={activeMenuState.selectedKeys}
      style={{ borderInlineEnd: "none", background: "transparent" }}
      onClick={() => setMobileMenuOpen(false)}
      onOpenChange={(keys: string[]) => setMenuOpenKeys(keys)}
    />
  );

  if (initializing || loadingMenus) {
    return (
      <AdminCenteredState>
        <Space align="center" direction="vertical" size={12}>
          <Spin size="large" />
          <Typography.Text type="secondary">正在加载后台工作台...</Typography.Text>
        </Space>
      </AdminCenteredState>
    );
  }

  if (!user) {
    return (
      <AdminCenteredState>
        <AntResult
          status="403"
          title="请先登录"
          subTitle="登录后才能访问后台工作台。"
          extra={(
            <Button type="primary">
              <Link href="/">前往登录</Link>
            </Button>
          )}
        />
      </AdminCenteredState>
    );
  }

  return (
    <AntLayout className="admin-design-shell">
      <Header className="admin-design-header">
        {!isDesktop && (
          <Button
            aria-label="打开菜单"
            icon={<MenuOutlined />}
            type="text"
            onClick={() => setMobileMenuOpen(true)}
          />
        )}

        <Link
          href="/dashboard"
          className="ml-2 flex items-center gap-2 text-inherit no-underline md:ml-0"
        >
          <img
            src="/favicon.ico"
            alt="高压电塔图标"
            width={22}
            height={22}
            className="h-[22px] w-[22px]"
          />
          <Typography.Text strong style={{ marginBottom: 0 }}>
            防雷计算
          </Typography.Text>
        </Link>

        <Space style={{ marginLeft: "auto" }}>
          <Dropdown
            menu={{ items: themeMenuItems, onClick: onThemeMenuClick }}
            arrow={{ pointAtCenter: true }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <Tooltip title="主题">
              <Button icon={<ThemeIcon />} type="text" />
            </Tooltip>
          </Dropdown>

          <Dropdown
            menu={{ items: accountMenuItems, onClick: onAccountMenuClick }}
            arrow={{ pointAtCenter: true }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <Button aria-label="用户菜单" type="text">
              <Avatar size="small" style={{ backgroundColor: "var(--ant-color-primary)" }}>
                {user.username.trim().charAt(0).toUpperCase() || "U"}
              </Avatar>
            </Button>
          </Dropdown>
        </Space>
      </Header>

      <AntLayout>
        {isDesktop && (
          <Sider
            className="admin-design-sider"
            collapsed={siderCollapsed}
            collapsedWidth={72}
            theme="light"
            trigger={null}
            width={256}
          >
            <div className="admin-design-sider-inner">
              <div className="admin-design-sider-menu">
                {navigationMenu}
              </div>
              <div className="admin-design-sider-footer">
                <Button
                  aria-label={siderCollapsed ? "展开菜单" : "收起菜单"}
                  icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  type="text"
                  onClick={() => setSiderCollapsed((previous) => !previous)}
                />
              </div>
            </div>
          </Sider>
        )}

        <Drawer
          title={null}
          placement="left"
          open={!isDesktop && mobileMenuOpen}
          width={288}
          onClose={() => setMobileMenuOpen(false)}
        >
          {navigationMenu}
        </Drawer>

        <AntLayout className="admin-design-main">
          <Content className="admin-design-content">
            <div className="admin-design-page-body">
              {menuError && (
                <Alert
                  showIcon
                  type="error"
                  message="菜单加载失败"
                  description={menuError}
                  style={{ marginBottom: 24 }}
                />
              )}
              {children}
            </div>
          </Content>
        </AntLayout>
      </AntLayout>
    </AntLayout>
  );
}
