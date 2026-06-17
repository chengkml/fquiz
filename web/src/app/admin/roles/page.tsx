"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Typography,
  type CardProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CSSProperties, ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuItem, RoleItem, RoleListResponse } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps>;

type MenuListResponse = { items: MenuItem[]; total: number };

type RoleFormValues = {
  code: string;
  name: string;
  menu_ids: string[];
};

const EMPTY_FORM: RoleFormValues = {
  code: "",
  name: "",
  menu_ids: [],
};

const ROLE_TABLE_MIN_SCROLL_Y = 180;
const ROLE_TABLE_VIEWPORT_GAP = 40;
const ROLE_TABLE_FALLBACK_RESERVE = 220;

export default function AdminRolesPage() {
  const { message, modal } = App.useApp();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [form] = Form.useForm<RoleFormValues>();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(ROLE_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const canRead = hasPermission("role.read") || hasPermission("role.manage");
  const canManage = hasPermission("role.manage");

  useToastFeedback({
    errorMessage: error,
    clearError: () => setError(""),
  });

  const menuOptions = useMemo(
    () => menus.map((menu) => ({ value: menu.id, label: `${menu.name} (${menu.code})` })),
    [menus],
  );

  const menuNameById = useMemo(() => {
    return new Map(menus.map((menu) => [menu.id, `${menu.name} (${menu.code})`]));
  }, [menus]);

  const filteredRoles = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return roles;
    }

    return roles.filter((role) => {
      const menuNames = role.menu_ids
        .map((menuId) => menuNameById.get(menuId) ?? String(menuId))
        .join(" ");
      const haystack = [role.code, role.name, menuNames].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [menuNameById, roles, searchKeyword]);

  const loadData = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [roleRes, menuRes] = await Promise.all([
        fetchWithAuth("/api/v1/admin/roles"),
        fetchWithAuth("/api/v1/admin/menus"),
      ]);

      if (!roleRes.ok) {
        throw new Error(await readApiError(roleRes));
      }
      if (!menuRes.ok) {
        throw new Error(await readApiError(menuRes));
      }

      const rolePayload = (await roleRes.json()) as RoleListResponse;
      const menuPayload = (await menuRes.json()) as MenuListResponse;

      setRoles(rolePayload.items);
      setMenus(menuPayload.items);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "角色数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [canRead, fetchWithAuth]);

  useEffect(() => {
    if (!user || !canRead) {
      return;
    }
    queueMicrotask(() => {
      void loadData();
    });
  }, [canRead, loadData, user]);

  useTopicSubscription("admin.roles", useCallback(() => {
    if (user && canRead) {
      void loadData();
    }
  }, [canRead, loadData, user]));

  useTopicSubscription("admin.menus", useCallback(() => {
    if (user && canRead) {
      void loadData();
    }
  }, [canRead, loadData, user]));

  const closeDialog = useCallback(() => {
    setEditingRoleId(null);
    setDialogOpen(false);
    form.resetFields();
  }, [form]);

  const startCreate = useCallback(() => {
    setEditingRoleId(null);
    form.setFieldsValue(EMPTY_FORM);
    setDialogOpen(true);
  }, [form]);

  const startEdit = useCallback((role: RoleItem) => {
    setEditingRoleId(role.id);
    form.setFieldsValue({
      code: role.code,
      name: role.name,
      menu_ids: role.menu_ids,
    });
    setDialogOpen(true);
  }, [form]);

  const submit = useCallback(async () => {
    setSaving(true);
    setError("");

    try {
      const values = await form.validateFields();
      const payload: RoleFormValues = {
        code: values.code.trim(),
        name: values.name.trim(),
        menu_ids: values.menu_ids ?? [],
      };

      const response = editingRoleId
        ? await fetchWithAuth(`/api/v1/admin/roles/${editingRoleId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: payload.name,
              menu_ids: payload.menu_ids,
            }),
          })
        : await fetchWithAuth("/api/v1/admin/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      message.success(editingRoleId ? "角色已更新" : "角色已创建");
      closeDialog();
      await loadData();
    } catch (candidate) {
      if (
        candidate
        && typeof candidate === "object"
        && "errorFields" in candidate
        && Array.isArray((candidate as { errorFields?: unknown }).errorFields)
      ) {
        return;
      }

      const nextError = candidate instanceof Error ? candidate.message : "提交失败，请稍后重试";
      setError(nextError);
      message.error(nextError);
    } finally {
      setSaving(false);
    }
  }, [closeDialog, editingRoleId, fetchWithAuth, form, loadData, message]);

  const removeRole = useCallback((role: RoleItem) => {
    modal.confirm({
      title: `确认删除角色 ${role.code} 吗？`,
      content: "删除后无法恢复，请谨慎操作。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setError("");
        const response = await fetchWithAuth(`/api/v1/admin/roles/${role.id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const nextError = await readApiError(response);
          setError(nextError);
          throw new Error(nextError);
        }
        message.success("角色已删除");
        if (editingRoleId === role.id) {
          closeDialog();
        }
        await loadData();
      },
    });
  }, [closeDialog, editingRoleId, fetchWithAuth, loadData, message, modal]);

  const columns = useMemo<ColumnsType<RoleItem>>(() => {
    const base: ColumnsType<RoleItem> = [
      {
        title: "角色编码",
        dataIndex: "code",
        width: 180,
        render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
      },
      {
        title: "角色名称",
        dataIndex: "name",
        width: 180,
      },
      {
        title: "菜单",
        dataIndex: "menu_ids",
        render: (value: string[]) => {
          if (value.length === 0) {
            return <Typography.Text type="secondary">未绑定菜单</Typography.Text>;
          }
          const menuLabels = value.map((menuId) => menuNameById.get(menuId) ?? String(menuId));
          const fullText = menuLabels.join("、");
          const compactText = menuLabels.length > 2
            ? `${menuLabels.slice(0, 2).join("、")}等${menuLabels.length}个...`
            : fullText;
          return (
            <Typography.Text
              title={fullText}
              style={{
                display: "inline-block",
                maxWidth: 420,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                verticalAlign: "bottom",
              }}
            >
              {compactText}
            </Typography.Text>
          );
        },
      },
    ];

    if (canManage) {
      base.push({
        title: "操作",
        key: "actions",
        fixed: "right",
        width: 160,
        render: (_, role) => (
          <Space size="small">
            <Button size="small" onClick={() => startEdit(role)}>
              编辑
            </Button>
            {!['admin', 'user'].includes(role.code) && (
              <Button danger size="small" onClick={() => removeRole(role)}>
                删除
              </Button>
            )}
          </Space>
        ),
      });
    }

    return base;
  }, [canManage, menuNameById, removeRole, startEdit]);

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - ROLE_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? ROLE_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(
        window.innerHeight - anchorTop - topGap - nonBodyHeight - ROLE_TABLE_VIEWPORT_GAP,
      );
    }

    const clampedHeight = Math.max(ROLE_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    updateTableScrollY();
  }, [error, filteredRoles.length, loading, updateTableScrollY]);

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
        <Spin tip="角色数据加载中..." />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问角色管理页面。</p>
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
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `role.read`）。</p>
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
    <div className="flex flex-1 flex-col space-y-6">
      <AntCard
        title="角色列表"
        extra={
          canManage ? (
            <Button type="primary" onClick={startCreate}>
              新建角色
            </Button>
          ) : null
        }
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[260px]">
            <Input
              allowClear
              placeholder="搜索角色编码、名称或菜单"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.currentTarget.value)}
            />
          </Form.Item>
          <Form.Item>
            <Button onClick={() => setSearchKeyword("")}>重置筛选</Button>
          </Form.Item>
        </Form>
        <div
          ref={tableScrollAnchorRef}
          className="admin-roles-table-anchor mt-4"
          style={{ "--admin-roles-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<RoleItem>
            rowKey="id"
            columns={columns}
            dataSource={filteredRoles}
            loading={loading}
            scroll={{ x: 1400, y: tableScrollY }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              style: { marginBottom: 0 },
            }}
            locale={{
              emptyText: <Empty description="未找到匹配角色，请调整搜索条件。" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </div>
      </AntCard>

      {canManage && (
        <Modal
          title={editingRoleId ? "编辑角色" : "新建角色"}
          open={dialogOpen}
          destroyOnClose
          width={760}
          okText={saving ? "提交中..." : editingRoleId ? "保存修改" : "创建角色"}
          cancelText="取消"
          confirmLoading={saving}
          onCancel={closeDialog}
          onOk={() => void submit()}
        >
          <Form<RoleFormValues>
            form={form}
            layout="vertical"
            initialValues={EMPTY_FORM}
            preserve={false}
          >
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item
                  label="角色编码"
                  name="code"
                  rules={[
                    { required: true, message: "请输入角色编码" },
                    { max: 80, message: "角色编码不能超过 80 位" },
                  ]}
                >
                  <Input disabled={editingRoleId !== null} placeholder="admin.operator" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  label="角色名称"
                  name="name"
                  rules={[
                    { required: true, message: "请输入角色名称" },
                    { max: 120, message: "角色名称不能超过 120 位" },
                  ]}
                >
                  <Input placeholder="运营管理员" />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label="可见菜单" name="menu_ids">
                  <Select
                    allowClear
                    mode="multiple"
                    optionFilterProp="label"
                    options={menuOptions}
                    placeholder="请选择可见菜单"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>
      )}
    </div>
  );
}
