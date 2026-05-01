"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
  type ResultProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { MenuItem, RoleItem, RoleListResponse } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps>;
const AntResult = Result as unknown as ComponentType<ResultProps>;

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

  const canRead = hasPermission("role.read") || hasPermission("role.manage");
  const canManage = hasPermission("role.manage");

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
      const haystack = [
        role.code,
        role.name,
        menuNames,
      ]
        .join(" ")
        .toLowerCase();
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
          return (
            <Space wrap size={[4, 4]}>
              {value.map((menuId) => (
                <Tag color="blue" key={menuId}>
                  {menuNameById.get(menuId) ?? String(menuId)}
                </Tag>
              ))}
            </Space>
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
            {!["admin", "user"].includes(role.code) && (
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

  if (initializing || loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Space align="center" direction="vertical" size={12}>
          <Spin />
          <Typography.Text type="secondary">角色数据加载中...</Typography.Text>
        </Space>
      </div>
    );
  }

  if (!user) {
    return (
      <AntCard>
        <AntResult
          status="403"
          title="请先登录"
          subTitle="登录后才能访问角色管理页面。"
          extra={(
            <Button type="primary">
              <Link href="/">返回登录</Link>
            </Button>
          )}
        />
      </AntCard>
    );
  }

  if (!canRead) {
    return (
      <AntCard>
        <AntResult
          status="403"
          title="无访问权限"
          subTitle="你没有访问该页面的权限（需要 role.read）。"
          extra={(
            <Button>
              <Link href="/dashboard">返回工作台</Link>
            </Button>
          )}
        />
      </AntCard>
    );
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      {error && (
        <Alert
          closable
          showIcon
          type="error"
          message="操作失败"
          description={error}
          onClose={() => setError("")}
        />
      )}

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
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space align="center" wrap>
            <Input.Search
              allowClear
              placeholder="搜索角色编码、名称或菜单"
              style={{ width: 360, maxWidth: "100%" }}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.currentTarget.value)}
            />
            <Typography.Text type="secondary">
              共 {roles.length} 个角色{searchKeyword.trim() ? `，匹配 ${filteredRoles.length} 个` : ""}
            </Typography.Text>
          </Space>

          <Table<RoleItem>
            rowKey="id"
            columns={columns}
            dataSource={filteredRoles}
            scroll={{ x: 1200 }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
            }}
            locale={{
              emptyText: <Empty description="未找到匹配角色，请调整搜索条件。" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </Space>
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

            <Form.Item label="可见菜单" name="menu_ids">
              <Select
                allowClear
                mode="multiple"
                optionFilterProp="label"
                options={menuOptions}
                placeholder="请选择可见菜单"
              />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </Space>
  );
}
