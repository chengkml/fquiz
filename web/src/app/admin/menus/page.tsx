"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  type CardProps,
  type TableColumnsType,
} from "antd";
import type { CSSProperties, ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import { normalizeAppRoutePath } from "@/lib/app-route-path";
import type { MenuItem, MenuListResponse } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps>;

type SortKey = "sort_order" | "id" | "name";
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

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "sort_order", label: "按排序值" },
  { value: "id", label: "按 ID" },
  { value: "name", label: "按名称" },
];

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
  const { message: messageApi, modal } = App.useApp();
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingMenuId, setDeletingMenuId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");
  const [tableScrollY, setTableScrollY] = useState(MENU_TABLE_MIN_SCROLL_Y);
  const [form] = Form.useForm<MenuFormValues>();
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasPermission("menu.read") || hasPermission("menu.manage");
  const canManage = hasPermission("menu.manage");

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
    const query = keyword.trim().toLowerCase();

    return menus
      .filter((menu) => {
        if (statusFilter !== "all" && menu.status !== statusFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        const haystack = [menu.code, menu.name, menu.path ?? ""]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (sortKey === "name") {
          return a.name.localeCompare(b.name, "zh-CN");
        }
        if (sortKey === "id") {
          return compareMenuIds(a.id, b.id);
        }
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return compareMenuIds(a.id, b.id);
      });
  }, [keyword, menus, sortKey, statusFilter]);

  const loadMenus = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const response = await fetchWithAuth("/api/v1/admin/menus");
    if (!response.ok) {
      setError(await readApiError(response));
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as MenuListResponse;
    setMenus(payload.items.map(normalizeMenuItemPath));
    setLoading(false);
  }, [canRead, fetchWithAuth]);

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    queueMicrotask(() => {
      void loadMenus();
    });
  }, [canRead, loadMenus, user]);

  useTopicSubscription(
    "admin.menus",
    useCallback(() => {
      if (user && canRead) {
        void loadMenus();
      }
    }, [canRead, loadMenus, user]),
  );

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

  const submit = useCallback(async () => {
    try {
      setSaving(true);
      setError("");

      const values = await form.validateFields();
      const payload = {
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

      const response = editingMenuId
        ? await fetchWithAuth(`/api/v1/admin/menus/${editingMenuId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchWithAuth("/api/v1/admin/menus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!response.ok) {
        const msg = await readApiError(response);
        setError(msg);
        messageApi.error(msg);
        return;
      }

      messageApi.success(editingMenuId ? "菜单已更新" : "菜单已创建");
      closeDialog();
      await loadMenus();
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
      messageApi.error(msg);
    } finally {
      setSaving(false);
    }
  }, [closeDialog, editingMenuId, fetchWithAuth, form, loadMenus, messageApi]);

  const removeMenu = useCallback(async (menu: MenuItem) => {
    setDeletingMenuId(menu.id);
    setError("");

    try {
      const response = await fetchWithAuth(`/api/v1/admin/menus/${menu.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const msg = await readApiError(response);
        setError(msg);
        messageApi.error(msg);
        return;
      }

      messageApi.success("菜单已删除");
      if (editingMenuId === menu.id) {
        closeDialog();
      }
      await loadMenus();
    } finally {
      setDeletingMenuId(null);
    }
  }, [closeDialog, editingMenuId, fetchWithAuth, loadMenus, messageApi]);

  const requestDeleteMenu = useCallback((menu: MenuItem) => {
    modal.confirm({
      title: "删除菜单",
      content: `确认删除菜单 ${menu.name} (${menu.code}) 吗？`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => removeMenu(menu),
    });
  }, [modal, removeMenu]);

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
      render: (_, record) => (
        <Space size="small">
          <Button size="small" onClick={() => startEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            danger
            loading={deletingMenuId === record.id}
            disabled={Boolean(deletingMenuId && deletingMenuId !== record.id)}
            onClick={() => requestDeleteMenu(record)}
          >
            删除
          </Button>
        </Space>
      ),
    });

    return base;
  }, [canManage, deletingMenuId, menuNameById, requestDeleteMenu, startEdit]);

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
    updateTableScrollY();
  }, [error, filteredMenus.length, loading, updateTableScrollY]);

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

  if (initializing) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spin tip="菜单加载中..." />
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
    <div className="space-y-6">
      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message="操作失败"
          description={<pre className="mb-0 whitespace-pre-wrap break-words">{error}</pre>}
          onClose={() => setError("")}
        />
      )}

      <AntCard
        title="菜单列表"
        extra={
          canManage ? (
            <Button type="primary" onClick={startCreate}>
              新建菜单
            </Button>
          ) : null
        }
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[240px]">
            <Input
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.currentTarget.value)}
              placeholder="按编码/名称/路径筛选"
            />
          </Form.Item>

          <Form.Item label="状态" className="min-w-[170px]">
            <Select<FilterStatus>
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              options={[
                { value: "all", label: "全部" },
                { value: "enabled", label: "已启用" },
                { value: "disabled", label: "已禁用" },
              ]}
            />
          </Form.Item>

          <Form.Item label="排序方式" className="min-w-[180px]">
            <Select<SortKey>
              value={sortKey}
              onChange={(value) => setSortKey(value)}
              options={SORT_OPTIONS}
            />
          </Form.Item>

          <Form.Item>
            <Button
              onClick={() => {
                setKeyword("");
                setStatusFilter("all");
                setSortKey("sort_order");
              }}
            >
              重置筛选
            </Button>
          </Form.Item>
        </Form>
        <div
          ref={tableScrollAnchorRef}
          className="admin-menus-table-anchor mt-4"
          style={{ "--admin-menus-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<MenuItem>
            rowKey="id"
            dataSource={filteredMenus}
            columns={columns}
            loading={loading}
            scroll={{ x: 1200, y: tableScrollY }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              style: { marginBottom: 0 },
            }}
            locale={{
              emptyText: <Empty description="未找到符合筛选条件的菜单项。" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </div>
      </AntCard>

      <Modal
        title={editingMenuId ? "编辑菜单" : "新建菜单"}
        open={dialogOpen}
        onCancel={closeDialog}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText={saving ? "提交中..." : editingMenuId ? "保存修改" : "创建菜单"}
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
