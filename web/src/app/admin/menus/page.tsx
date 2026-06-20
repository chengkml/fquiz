"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { MoreOutlined, EditOutlined } from "@ant-design/icons";
import type { CSSProperties, ComponentType, RefAttributes } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { useMobileDetection } from "@/hooks/use-mobile-detection";
import { readApiError } from "@/lib/api";
import { normalizeAppRoutePath } from "@/lib/app-route-path";
import type { MenuItem, MenuListResponse } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps & RefAttributes<HTMLDivElement>>;

type FilterStatus = "all" | "enabled" | "disabled";

type MenuFormValues = {
  code: string;
  name: string;
  path?: string;
  icon?: string;
  parent_id?: string;
  type: "directory" | "menu" | "button";
  sort_order: number;
  status: "enabled" | "disabled";
  visible: boolean;
  cacheable: boolean;
  component?: string;
};

type MenuMutationPayload = {
  code: string;
  name: string;
  path: string | null;
  icon: string | null;
  parent_id: string | null;
  type: MenuFormValues["type"];
  sort_order: number;
  status: MenuFormValues["status"];
  visible: boolean;
  cacheable: boolean;
  component: string | null;
};

const DEFAULT_FORM_VALUES: MenuFormValues = {
  code: "",
  name: "",
  path: "",
  icon: "",
  parent_id: undefined,
  type: "menu",
  sort_order: 0,
  status: "enabled",
  visible: true,
  cacheable: false,
  component: "",
};

const MENU_TABLE_MIN_SCROLL_Y = 180;
const MENU_TABLE_VIEWPORT_GAP = 40;
const MENU_TABLE_FALLBACK_RESERVE = 220;

function compareMenuIds(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum;
  }
  return a.localeCompare(b, "zh-CN");
}

function normalizeMenuItemPath(menu: MenuItem): MenuItem {
  return {
    ...menu,
    path: normalizeAppRoutePath(menu.path),
  };
}

export default function AdminMenusPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useMobileDetection();
  const [deletingMenuId, setDeletingMenuId] = useState<string | null>(null);
  const [updatingStatusMenuId, setUpdatingStatusMenuId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [tableScrollY, setTableScrollY] = useState(MENU_TABLE_MIN_SCROLL_Y);
  const viewMode: "table" | "card" = isMobile ? "card" : "table";
  const [cardViewPage, setCardViewPage] = useState(1);
  const [allLoadedMenus, setAllLoadedMenus] = useState<MenuItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [form] = Form.useForm<MenuFormValues>();
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const keywordDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pageCardRef = useRef<HTMLDivElement | null>(null);
  const paginationCurrent = pagination.current;
  const paginationPageSize = pagination.pageSize;

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");

  const trimmedKeyword = searchKeyword.trim();
  const menusQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(paginationPageSize));
    params.set("offset", String((paginationCurrent - 1) * paginationPageSize));
    if (trimmedKeyword) {
      params.set("keyword", trimmedKeyword);
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    return params.toString();
  }, [paginationCurrent, paginationPageSize, statusFilter, trimmedKeyword]);
  const menusPath = `/api/v1/admin/menus?${menusQueryParams}`;

  const loadMenus = useCallback(async () => {
    const response = await fetchWithAuth(menusPath);
    if (!response.ok) throw new Error(await readApiError(response));
    const payload = (await response.json()) as MenuListResponse;
    return {
      ...payload,
      items: payload.items.map(normalizeMenuItemPath),
    } satisfies MenuListResponse;
  }, [fetchWithAuth, menusPath]);

  const menusQuery = useQuery({
    queryKey: ["admin.menus", menusQueryParams],
    queryFn: loadMenus,
    enabled: !!user && canRead,
  });

  const menus = useMemo(() => menusQuery.data?.items ?? [], [menusQuery.data?.items]);
  const menuTotal = menusQuery.data?.total ?? 0;
  const queryError = menusQuery.error instanceof Error ? menusQuery.error.message : "";
  const anyError = error || queryError;

  useToastFeedback({
    errorMessage: anyError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const parentOptions = useMemo(
    () =>
      menus.map((menu) => ({
        value: menu.id,
        label: `${menu.name} (${menu.code})`,
      })),
    [menus],
  );

  const menuNameById = useMemo(() => {
    const map = new Map<string, string>();
    menus.forEach((menu) => {
      map.set(menu.id, `${menu.name} (${menu.code})`);
    });
    return map;
  }, [menus]);

  const filteredMenus = useMemo(() => {
    return [...menus].sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }
      return compareMenuIds(a.id, b.id);
    });
  }, [menus]);

  useTopicSubscription(
    "admin.menus",
    useCallback(() => {
      if (user && canRead) {
        void queryClient.invalidateQueries({ queryKey: ["admin.menus"] });
      }
    }, [canRead, queryClient, user]),
  );

  const refreshData = async () => {
    await queryClient.refetchQueries({ queryKey: ["admin.menus"] });
  };

  // Update allLoadedMenus when menus data changes in card view
  useEffect(() => {
    if (viewMode !== "card" || menusQuery.isLoading) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (cardViewPage === 1) {
        setAllLoadedMenus(() => menus);
      } else {
        setAllLoadedMenus((prev) => {
          if (menus.length === 0) {
            return prev;
          }
          const existingIds = new Set(prev.map(m => m.id));
          const newMenus = menus.filter(m => !existingIds.has(m.id));
          return [...prev, ...newMenus];
        });
      }
      setIsLoadingMore(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [menus, menusQuery.isLoading, viewMode, cardViewPage]);

  // Handle infinite scroll for card view
  useEffect(() => {
    if (viewMode !== "card") return;

    const pageCard = pageCardRef.current;
    if (!pageCard) return;

    const cardBody = pageCard.querySelector<HTMLElement>(".ant-card-body");
    if (!cardBody) return;

    const handleScroll = () => {
      if (isLoadingMore || menusQuery.isLoading) return;

      const scrollTop = cardBody.scrollTop;
      const scrollHeight = cardBody.scrollHeight;
      const clientHeight = cardBody.clientHeight;

      if (scrollTop + clientHeight >= scrollHeight - 100) {
        const loadedCount = allLoadedMenus.length;

        if (loadedCount < menuTotal) {
          setIsLoadingMore(true);
          setCardViewPage((prev) => prev + 1);
          setPagination((prev) => ({ ...prev, current: prev.current + 1 }));
        }
      }
    };

    cardBody.addEventListener("scroll", handleScroll);
    return () => cardBody.removeEventListener("scroll", handleScroll);
  }, [allLoadedMenus.length, menusQuery.isLoading, isLoadingMore, menuTotal, viewMode]);

  const handleKeywordChange = (value: string) => {
    setKeyword(value);

    if (keywordDebounceTimeoutRef.current) {
      clearTimeout(keywordDebounceTimeoutRef.current);
    }

    keywordDebounceTimeoutRef.current = setTimeout(() => {
      setSearchKeyword(value);
      setPagination((prev) => ({ ...prev, current: 1 }));
      setCardViewPage(1);
      setAllLoadedMenus([]);
    }, 500);
  };

  const handleStatusFilterChange = (value?: Exclude<FilterStatus, "all">) => {
    setStatusFilter(value ?? "all");
    setPagination((prev) => ({ ...prev, current: 1 }));
    setCardViewPage(1);
    setAllLoadedMenus([]);
  };

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingMenuId(null);
    form.resetFields();
  }, [form]);

  const startCreate = useCallback(() => {
    setEditingMenuId(null);
    form.setFieldsValue(DEFAULT_FORM_VALUES);
    setDialogOpen(true);
  }, [form]);

  const startEdit = useCallback((menu: MenuItem) => {
    setEditingMenuId(menu.id);
    form.setFieldsValue({
      code: menu.code,
      name: menu.name,
      path: menu.path ?? "",
      icon: menu.icon ?? "",
      parent_id: menu.parent_id ?? undefined,
      type: menu.type as MenuFormValues["type"],
      sort_order: menu.sort_order,
      status: menu.status as MenuFormValues["status"],
      visible: menu.visible,
      cacheable: menu.cacheable,
      component: menu.component ?? "",
    });
    setDialogOpen(true);
  }, [form]);

  const createMenuMutation = useMutation({
    mutationFn: async (payload: MenuMutationPayload) => {
      const response = await fetchWithAuth("/api/v1/admin/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<MenuItem>;
    },
    onMutate: () => {
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("菜单已创建");
      closeDialog();
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建菜单失败");
    },
  });

  const updateMenuMutation = useMutation({
    mutationFn: async ({ menuId, payload }: { menuId: string; payload: Partial<MenuMutationPayload> }) => {
      const response = await fetchWithAuth(`/api/v1/admin/menus/${menuId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<MenuItem>;
    },
    onMutate: ({ menuId, payload }) => {
      if (payload.status && Object.keys(payload).length === 1) {
        setUpdatingStatusMenuId(menuId);
      }
      setError("");
      setSuccess("");
    },
    onSuccess: async (_, variables) => {
      if (variables.payload.status && Object.keys(variables.payload).length === 1) {
        setSuccess(variables.payload.status === "enabled" ? "菜单已启用" : "菜单已禁用");
      } else {
        setSuccess("菜单已更新");
        closeDialog();
      }
      await refreshData();
    },
    onError: (candidate, variables) => {
      setSuccess("");
      const fallbackMessage = variables.payload.status && Object.keys(variables.payload).length === 1
        ? "菜单状态更新失败"
        : "更新菜单失败";
      setError(candidate instanceof Error ? candidate.message : fallbackMessage);
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.payload.status && Object.keys(variables.payload).length === 1) {
        setUpdatingStatusMenuId(null);
      }
    },
  });

  const deleteMenuMutation = useMutation({
    mutationFn: async (menuId: string) => {
      const response = await fetchWithAuth(`/api/v1/admin/menus/${menuId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<{ message: string }>;
    },
    onMutate: (menuId) => {
      setDeletingMenuId(menuId);
      setError("");
      setSuccess("");
    },
    onSuccess: async (_, menuId) => {
      setSuccess("菜单已删除");
      if (editingMenuId === menuId) {
        closeDialog();
      }
      setAllLoadedMenus((previous) => previous.filter((item) => item.id !== menuId));
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "菜单删除失败");
    },
    onSettled: () => setDeletingMenuId(null),
  });

  const submit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const payload: MenuMutationPayload = {
        code: values.code.trim(),
        name: values.name.trim(),
        path: normalizeAppRoutePath(values.path?.trim() ? values.path.trim() : null),
        icon: values.icon?.trim() ? values.icon.trim() : null,
        parent_id: values.parent_id?.trim() ? values.parent_id.trim() : null,
        type: values.type,
        sort_order: Number(values.sort_order || 0),
        status: values.status,
        visible: values.visible,
        cacheable: values.cacheable,
        component: values.component?.trim() ? values.component.trim() : null,
      };

      if (editingMenuId) {
        updateMenuMutation.mutate({ menuId: editingMenuId, payload });
      } else {
        createMenuMutation.mutate(payload);
      }
    } catch (candidate) {
      // Form 校验失败时不额外提示。
      if (
        candidate
        && typeof candidate === "object"
        && "errorFields" in candidate
        && Array.isArray((candidate as { errorFields?: unknown }).errorFields)
      ) {
        return;
      }

      const msg = candidate instanceof Error ? candidate.message : "提交失败，请稍后重试";
      setError(msg);
    }
  }, [createMenuMutation, editingMenuId, form, updateMenuMutation]);

  const confirmRemoveMenu = useCallback((menu: MenuItem) => {
    Modal.confirm({
      title: `确认删除菜单 ${menu.name}（${menu.code}）？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteMenuMutation.mutate(menu.id),
    });
  }, [deleteMenuMutation]);

  const updateMenuStatus = useCallback(async (menu: MenuItem) => {
    const nextStatus: "enabled" | "disabled" = menu.status === "enabled" ? "disabled" : "enabled";
    updateMenuMutation.mutate({ menuId: menu.id, payload: { status: nextStatus } });
  }, [updateMenuMutation]);

  const columns = useMemo<TableColumnsType<MenuItem>>(() => {
    const base: TableColumnsType<MenuItem> = [
      { title: "ID", dataIndex: "id", width: 110 },
      {
        title: "编码",
        dataIndex: "code",
        width: 220,
        render: (value: string) => <span className="font-mono text-xs">{value}</span>,
      },
      {
        title: "名称",
        dataIndex: "name",
        width: 180,
      },
      {
        title: "路径",
        dataIndex: "path",
        width: 220,
        render: (value: string | null) => value || "-",
      },
      {
        title: "父菜单",
        dataIndex: "parent_id",
        width: 220,
        render: (value: string | null) => (value ? menuNameById.get(value) ?? value : "-"),
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 110,
        render: (value: string) =>
          value === "enabled" ? <Tag color="success">已启用</Tag> : <Tag color="default">已禁用</Tag>,
      },
      {
        title: "排序",
        dataIndex: "sort_order",
        width: 90,
      },
    ];

    if (!canManage) {
      return base;
    }

    base.push({
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 180,
      render: (_, record) => {
        const updatingLoading = updatingStatusMenuId === record.id;
        const deleteLoading = deletingMenuId === record.id;
        const menuBusy = updatingLoading || deleteLoading;

        const moreMenuItems: MenuProps["items"] = [
          {
            key: "toggle-status",
            label: record.status === "enabled" ? "禁用" : "启用",
            disabled: menuBusy,
            onClick: () => void updateMenuStatus(record),
          },
        ];

        return (
          <Space wrap>
            <Button size="small" disabled={menuBusy} onClick={() => startEdit(record)}>
              编辑
            </Button>

            <Popconfirm
              title={`确认删除菜单 ${record.name}（${record.code}）？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleteLoading }}
              onConfirm={() => deleteMenuMutation.mutate(record.id)}
              disabled={menuBusy}
            >
              <Button danger size="small" loading={deleteLoading} disabled={menuBusy}>
                删除
              </Button>
            </Popconfirm>

            <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]}>
              <Button size="small" loading={updatingLoading} disabled={menuBusy} icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    });

    return base;
  }, [canManage, deleteMenuMutation, deletingMenuId, menuNameById, startEdit, updateMenuStatus, updatingStatusMenuId]);

  const renderMenuCard = (menuItem: MenuItem) => {
    const updatingLoading = updatingStatusMenuId === menuItem.id;
    const deleteLoading = deletingMenuId === menuItem.id;
    const menuBusy = updatingLoading || deleteLoading;

    const moreMenuItems: MenuProps["items"] = [
      {
        key: "delete",
        label: "删除",
        danger: true,
        disabled: menuBusy || !canManage,
        onClick: () => confirmRemoveMenu(menuItem),
      },
      {
        key: "toggle-status",
        label: menuItem.status === "enabled" ? "禁用" : "启用",
        disabled: menuBusy || !canManage,
        onClick: () => void updateMenuStatus(menuItem),
      },
    ];

    return (
      <AntCard
        key={menuItem.id}
        className="admin-menus-menu-card"
        size="small"
        title={
          <Space className="min-w-0" size={8}>
            <Typography.Text strong>{menuItem.name}</Typography.Text>
            <Tag color={menuItem.status === "enabled" ? "success" : "default"}>
              {menuItem.status === "enabled" ? "已启用" : "已禁用"}
            </Tag>
          </Space>
        }
        extra={
          canManage ? (
            <Space size={4}>
              <Button
                type="text"
                size="small"
                disabled={menuBusy}
                icon={<EditOutlined />}
                onClick={() => startEdit(menuItem)}
              />
              <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]}>
                <Button type="text" size="small" loading={updatingLoading} disabled={menuBusy} icon={<MoreOutlined />} />
              </Dropdown>
            </Space>
          ) : null
        }
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div className="admin-menus-menu-card-field">
            <Typography.Text type="secondary">菜单编码</Typography.Text>
            <Typography.Text className="font-mono text-xs">{menuItem.code}</Typography.Text>
          </div>
          <div className="admin-menus-menu-card-field">
            <Typography.Text type="secondary">路径</Typography.Text>
            <Typography.Text ellipsis={{ tooltip: menuItem.path || "-" }}>{menuItem.path || "-"}</Typography.Text>
          </div>
          <div className="admin-menus-menu-card-field">
            <Typography.Text type="secondary">父菜单</Typography.Text>
            <Typography.Text ellipsis>
              {menuItem.parent_id ? menuNameById.get(menuItem.parent_id) ?? menuItem.parent_id : "-"}
            </Typography.Text>
          </div>
          <div className="admin-menus-menu-card-field">
            <Typography.Text type="secondary">排序</Typography.Text>
            <Typography.Text>{menuItem.sort_order}</Typography.Text>
          </div>
        </Space>
      </AntCard>
    );
  };

  const updateTableScrollY = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const anchorTop = anchor.getBoundingClientRect().top;
    const tableWrapper = anchor.querySelector<HTMLElement>(".ant-table-wrapper");
    const tableBody = anchor.querySelector<HTMLElement>(".ant-table-body");

    let nextHeight = Math.floor(window.innerHeight - anchorTop - MENU_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? MENU_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - MENU_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(MENU_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [anyError, filteredMenus.length, menusQuery.isFetching, paginationCurrent, paginationPageSize, updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onViewportChange = () => {
      window.requestAnimationFrame(updateTableScrollY);
    };

    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [updateTableScrollY]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }

    const anchor = tableScrollAnchorRef.current;
    if (!anchor) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateTableScrollY);
    });
    resizeObserver.observe(anchor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateTableScrollY]);

  useEffect(() => {
    return () => {
      if (keywordDebounceTimeoutRef.current) {
        clearTimeout(keywordDebounceTimeoutRef.current);
      }
    };
  }, []);

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="初始化中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问菜单管理页面。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `menu.read`）。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AntCard
        ref={pageCardRef}
        className="admin-menus-page-card"
        title="菜单管理"
        extra={
          canManage ? (
            <Button type="primary" onClick={startCreate}>
              新建菜单
            </Button>
          ) : null
        }
      >
        {viewMode === "card" ? (
          <Form layout="vertical" style={{ marginBottom: 16 }}>
            <Form.Item style={{ marginBottom: 0 }}>
              <Input
                allowClear
                value={keyword}
                onChange={(event) => handleKeywordChange(event.currentTarget.value)}
                placeholder="按编码/名称/路径筛选"
              />
            </Form.Item>
          </Form>
        ) : (
          <Form layout="inline" style={{ rowGap: 12 }}>
            <Form.Item label="关键词" style={{ width: 240 }}>
              <Input
                allowClear
                value={keyword}
                onChange={(event) => handleKeywordChange(event.currentTarget.value)}
                placeholder="按编码/名称/路径筛选"
              />
            </Form.Item>

            <Form.Item label="状态" style={{ width: 170 }}>
              <Select<Exclude<FilterStatus, "all">>
                value={statusFilter === "all" ? undefined : statusFilter}
                allowClear
                placeholder="全部"
                onChange={handleStatusFilterChange}
                options={[
                  { value: "enabled", label: "已启用" },
                  { value: "disabled", label: "已禁用" },
                ]}
              />
            </Form.Item>
          </Form>
        )}

        {viewMode === "table" ? (
          <div
            ref={tableScrollAnchorRef}
            className="admin-menus-table-anchor mt-4"
            style={{ "--admin-menus-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
          >
            <Table<MenuItem>
              rowKey="id"
              dataSource={filteredMenus}
              columns={columns}
              loading={menusQuery.isLoading}
              tableLayout="fixed"
              scroll={{ y: tableScrollY }}
              pagination={{
                current: pagination.current,
                pageSize: pagination.pageSize,
                total: Math.max(menuTotal, 1),
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: () => `共 ${menuTotal} 条`,
                hideOnSinglePage: false,
                style: { marginBottom: 0 },
                onChange: (page, pageSize) => {
                  setPagination({ current: page, pageSize });
                },
              }}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到符合筛选条件的菜单项。"
                  />
                ),
              }}
            />
          </div>
        ) : (
          <div className="admin-menus-card-view mt-4">
            {menusQuery.isLoading && allLoadedMenus.length === 0 ? (
              <div className="admin-menus-card-view-state">
                <Spin tip="加载中..." />
              </div>
            ) : allLoadedMenus.length === 0 ? (
              <div className="admin-menus-card-view-state">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到符合筛选条件的菜单项。"
                />
              </div>
            ) : (
              <div className="admin-menus-card-view-content">
                <Row gutter={[12, 12]}>
                  {allLoadedMenus.map((menuItem) => (
                    <Col key={menuItem.id} xs={24} sm={24} md={12} lg={8} xl={6}>
                      {renderMenuCard(menuItem)}
                    </Col>
                  ))}
                </Row>
                {isLoadingMore && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin tip="加载更多..." />
                  </div>
                )}
                {allLoadedMenus.length >= menuTotal && allLoadedMenus.length > 0 && (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Typography.Text type="secondary">
                      已加载全部 {allLoadedMenus.length} 条数据
                    </Typography.Text>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </AntCard>

      <Modal
        title={editingMenuId ? "编辑菜单" : "新建菜单"}
        open={dialogOpen}
        onCancel={closeDialog}
        onOk={() => void submit()}
        confirmLoading={createMenuMutation.isPending || updateMenuMutation.isPending}
        okText={createMenuMutation.isPending || updateMenuMutation.isPending ? "提交中..." : editingMenuId ? "保存修改" : "创建菜单"}
        cancelText="取消"
        destroyOnClose
        width={760}
      >
        <Form<MenuFormValues>
          form={form}
          layout="vertical"
          initialValues={DEFAULT_FORM_VALUES}
          preserve={false}
        >
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                label="菜单编码"
                name="code"
                rules={[{ required: true, message: "请输入菜单编码" }]}
              >
                <Input placeholder="admin.example" disabled={editingMenuId !== null} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="菜单名称"
                name="name"
                rules={[{ required: true, message: "请输入菜单名称" }]}
              >
                <Input placeholder="示例菜单" />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item label="路由路径" name="path">
                <Input placeholder="/admin/example" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="图标名" name="icon">
                <Input placeholder="AppstoreOutlined" />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item label="父菜单" name="parent_id">
                <Select
                  allowClear
                  placeholder="无"
                  options={parentOptions.filter((item) => item.value !== editingMenuId)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="类型" name="type" rules={[{ required: true, message: "请选择类型" }]}>
                <Select
                  options={[
                    { value: "directory", label: "目录" },
                    { value: "menu", label: "菜单" },
                    { value: "button", label: "按钮" },
                  ]}
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item label="排序" name="sort_order" rules={[{ required: true, message: "请输入排序值" }]}>
                <InputNumber className="w-full" min={0} precision={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
                <Select
                  options={[
                    { value: "enabled", label: "已启用" },
                    { value: "disabled", label: "已禁用" },
                  ]}
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item label="组件标识" name="component">
                <Input placeholder="app/admin/users/page" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="visible" valuePropName="checked">
                <Checkbox>可见</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="cacheable" valuePropName="checked">
                <Checkbox>可缓存</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
