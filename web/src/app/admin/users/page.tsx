"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useCallback, useMemo, useState, type ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type { RoleItem, RoleListResponse, UserListResponse, UserPublic } from "@/types/auth";

const AntCard = Card as unknown as ComponentType<CardProps>;

type UserRolePayload = {
  role_codes: string[];
};

type CreateUserValues = {
  user_id: string;
  email: string;
  username: string;
  password: string;
};

type ResetPasswordValues = {
  password: string;
};

function statusLabel(status: string): string {
  if (status === "active") return "启用";
  if (status === "disabled") return "禁用";
  return status || "-";
}

export default function AdminUsersPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [createForm] = Form.useForm<CreateUserValues>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordValues>();

  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [updatingStatusUserId, setUpdatingStatusUserId] = useState<string | null>(null);
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserPublic | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("user.manage");
  const canReadRoles = hasPermission("role.read") || hasPermission("role.manage");

  const usersPath = "/api/v1/users?limit=200&offset=0";
  const rolesPath = "/api/v1/admin/roles";

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth(usersPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const loadRoles = useCallback(async () => {
    const response = await fetchWithAuth(rolesPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as RoleListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: [usersPath],
    queryFn: loadUsers,
    enabled: !!user && canManage,
  });

  const rolesQuery = useQuery({
    queryKey: [rolesPath],
    queryFn: loadRoles,
    enabled: !!user && canManage && canReadRoles,
  });

  useTopicSubscription(
    "admin.users",
    useCallback(() => {
      if (!user || !canManage) return;
      void queryClient.invalidateQueries({ queryKey: [usersPath] });
      if (canReadRoles) {
        void queryClient.invalidateQueries({ queryKey: [rolesPath] });
      }
    }, [canManage, canReadRoles, queryClient, user]),
  );

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data?.items]);
  const roles = useMemo<RoleItem[]>(() => {
    if (canReadRoles) return rolesQuery.data?.items ?? [];
    return Array.from(new Set(users.flatMap((item) => item.role_codes))).map((code, index) => ({
      id: `fallback-${index + 1}`,
      code,
      name: code,
      permission_codes: [],
      menu_ids: [],
    } satisfies RoleItem));
  }, [canReadRoles, rolesQuery.data?.items, users]);

  const roleOptions = useMemo(() => roles.map((item) => item.code), [roles]);

  const existingUserIds = useMemo(
    () => new Set(users.map((item) => item.id.trim().toLowerCase())),
    [users],
  );
  const existingEmails = useMemo(
    () => new Set(users.map((item) => item.email.trim().toLowerCase())),
    [users],
  );
  const existingUsernames = useMemo(
    () => new Set(users.map((item) => item.username.trim().toLowerCase())),
    [users],
  );

  const refreshData = async () => {
    await queryClient.invalidateQueries({ queryKey: [usersPath] });
    if (canReadRoles) {
      await queryClient.invalidateQueries({ queryKey: [rolesPath] });
    }
  };

  const createUserMutation = useMutation({
    mutationFn: async (values: CreateUserValues) => {
      const response = await fetchWithAuth("/api/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onSuccess: async () => {
      setSuccess("用户已创建");
      setError("");
      createForm.resetFields();
      setCreateUserModalOpen(false);
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "创建用户失败");
    },
  });

  const updateRolesMutation = useMutation({
    mutationFn: async ({ userId, roleCodes }: { userId: string; roleCodes: string[] }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_codes: roleCodes } satisfies UserRolePayload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setSavingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("用户角色已更新");
      await refreshData();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "更新失败");
    },
    onSettled: () => setSavingUserId(null),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: password }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setResettingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: () => {
      setSuccess("密码已重置");
      setResetPasswordTarget(null);
      resetPasswordForm.resetFields();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "重置密码失败");
    },
    onSettled: () => setResettingUserId(null),
  });

  const updateUserProfileMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: "active" | "disabled" }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<UserPublic>;
    },
    onMutate: ({ userId }) => {
      setUpdatingStatusUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async (_, variables) => {
      setSuccess(variables.status === "active" ? "用户已启用" : "用户已禁用");
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "更新用户状态失败");
    },
    onSettled: () => setUpdatingStatusUserId(null),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiError(response));
      return response.json() as Promise<{ message: string }>;
    },
    onMutate: (userId) => {
      setDeletingUserId(userId);
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("用户已删除");
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除用户失败");
    },
    onSettled: () => setDeletingUserId(null),
  });

  const handleCreateUser = (values: CreateUserValues) => {
    setError("");
    setSuccess("");

    const payload: CreateUserValues = {
      user_id: values.user_id.trim(),
      email: values.email.trim(),
      username: values.username.trim(),
      password: values.password,
    };

    const candidateUserId = payload.user_id.toLowerCase();
    const candidateEmail = payload.email.toLowerCase();
    const candidateUsername = payload.username.toLowerCase();

    if (existingUserIds.has(candidateUserId)) {
      setError("用户 ID 已存在，请更换后重试");
      return;
    }
    if (existingEmails.has(candidateEmail)) {
      setError("邮箱已存在，请更换后重试");
      return;
    }
    if (existingUsernames.has(candidateUsername)) {
      setError("用户名已存在，请更换后重试");
      return;
    }

    createUserMutation.mutate(payload);
  };

  const openResetPasswordModal = (target: UserPublic) => {
    setError("");
    setSuccess("");
    setResetPasswordTarget(target);
    resetPasswordForm.resetFields();
  };

  const closeResetPasswordModal = () => {
    if (resetPasswordMutation.isPending) return;
    setResetPasswordTarget(null);
    resetPasswordForm.resetFields();
  };

  const handleSubmitResetPassword = (values: ResetPasswordValues) => {
    if (!resetPasswordTarget) return;
    resetPasswordMutation.mutate({ userId: resetPasswordTarget.id, password: values.password });
  };

  const openCreateUserModal = () => {
    setError("");
    setSuccess("");
    createForm.resetFields();
    setCreateUserModalOpen(true);
  };

  const closeCreateUserModal = () => {
    if (createUserMutation.isPending) return;
    setCreateUserModalOpen(false);
    createForm.resetFields();
  };

  const queryError =
    (usersQuery.error instanceof Error ? usersQuery.error.message : "")
    || (rolesQuery.error instanceof Error ? rolesQuery.error.message : "");
  const anyError = error || queryError;

  const columns: ColumnsType<UserPublic> = [
    {
      title: "用户 ID",
      dataIndex: "id",
      width: 180,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "邮箱",
      dataIndex: "email",
      width: 240,
    },
    {
      title: "用户名",
      dataIndex: "username",
      width: 180,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value: string) => (
        <Tag color={value === "active" ? "green" : "default"}>{statusLabel(value)}</Tag>
      ),
    },
    {
      title: "角色",
      dataIndex: "role_codes",
      width: 340,
      render: (_roleCodes: string[], row) => {
        if (roleOptions.length === 0) {
          return <Typography.Text type="secondary">暂无可分配角色</Typography.Text>;
        }

        return (
          <Space wrap size={[8, 8]}>
            {roleOptions.map((roleCode) => {
              const checked = row.role_codes.includes(roleCode);
              return (
                <Checkbox
                  key={`${row.id}-${roleCode}`}
                  checked={checked}
                  disabled={savingUserId === row.id}
                  onChange={(event) => {
                    const nextRoles = event.target.checked
                      ? Array.from(new Set([...row.role_codes, roleCode]))
                      : row.role_codes.filter((code) => code !== roleCode);
                    updateRolesMutation.mutate({ userId: row.id, roleCodes: nextRoles });
                  }}
                >
                  {roleCode}
                </Checkbox>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: "权限",
      dataIndex: "permission_codes",
      width: 280,
      render: (value: string[]) => value.join(", ") || "-",
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 260,
      render: (_value, row) => {
        const statusLoading = updatingStatusUserId === row.id;
        const resetLoading = resettingUserId === row.id;
        const deleteLoading = deletingUserId === row.id;
        const rowBusy = statusLoading || resetLoading || deleteLoading;

        return (
          <Space wrap>
            <Button
              size="small"
              loading={statusLoading}
              disabled={rowBusy || row.id === user?.id}
              onClick={() => {
                if (row.id === user?.id) {
                  setError("不能修改当前登录账号的状态");
                  return;
                }
                const nextStatus: "active" | "disabled" = row.status === "active" ? "disabled" : "active";
                updateUserProfileMutation.mutate({ userId: row.id, status: nextStatus });
              }}
            >
              {row.status === "active" ? "禁用" : "启用"}
            </Button>

            <Button
              size="small"
              loading={resetLoading}
              disabled={rowBusy}
              onClick={() => openResetPasswordModal(row)}
            >
              重置密码
            </Button>

            <Popconfirm
              title={`确认删除用户 ${row.username}（${row.id}）？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deleteLoading }}
              onConfirm={() => deleteUserMutation.mutate(row.id)}
              disabled={rowBusy}
            >
              <Button danger size="small" loading={deleteLoading} disabled={rowBusy}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  if (initializing || usersQuery.isLoading || rolesQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Space direction="vertical" align="center" size={12}>
          <Spin />
          <Typography.Text type="secondary">正在加载用户数据...</Typography.Text>
        </Space>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Typography.Text type="secondary">请先登录后再访问用户管理页面。</Typography.Text>
        <Button type="default" className="w-fit">
          <Link href="/">返回首页</Link>
        </Button>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <Typography.Text type="secondary">你没有访问该页面的权限（需要 `user.manage`）。</Typography.Text>
        <Button type="default" className="w-fit">
          <Link href="/">返回首页</Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {anyError && <Alert type="error" message="操作失败" description={anyError} showIcon />}
      {success && <Alert type="success" message={success} showIcon />}

      <AntCard
        title="用户列表"
        extra={(
          <Space>
            {usersQuery.isFetching && <Spin size="small" />}
            <Typography.Text type="secondary">共 {usersQuery.data?.total ?? 0} 条</Typography.Text>
            <Button type="primary" onClick={openCreateUserModal}>
              新增用户
            </Button>
          </Space>
        )}
      >
        <Table<UserPublic>
          rowKey="id"
          dataSource={users}
          columns={columns}
          pagination={false}
          size="middle"
          scroll={{ x: 1500 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无用户数据"
              />
            ),
          }}
        />
      </AntCard>

      <Modal
        title="新增用户"
        open={createUserModalOpen}
        destroyOnClose
        onCancel={closeCreateUserModal}
        onOk={() => createForm.submit()}
        okText="创建用户"
        cancelText="取消"
        confirmLoading={createUserMutation.isPending}
      >
        <Form<CreateUserValues>
          form={createForm}
          layout="vertical"
          onFinish={handleCreateUser}
          autoComplete="off"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Form.Item
              label="用户 ID"
              name="user_id"
              rules={[
                { required: true, message: "请输入用户 ID" },
                { min: 3, message: "用户 ID 至少 3 位" },
                { max: 64, message: "用户 ID 不能超过 64 位" },
              ]}
            >
              <Input placeholder="例如 ck001" />
            </Form.Item>

            <Form.Item
              label="邮箱"
              name="email"
              rules={[
                { required: true, message: "请输入邮箱" },
                { type: "email", message: "邮箱格式不正确" },
              ]}
            >
              <Input placeholder="请输入邮箱" />
            </Form.Item>

            <Form.Item
              label="用户名"
              name="username"
              rules={[
                { required: true, message: "请输入用户名" },
                { min: 3, message: "用户名至少 3 位" },
                { max: 64, message: "用户名不能超过 64 位" },
              ]}
            >
              <Input placeholder="请输入用户名" />
            </Form.Item>

            <Form.Item
              label="初始密码"
              name="password"
              rules={[
                { required: true, message: "请输入初始密码" },
                { min: 8, message: "密码至少 8 位" },
                { max: 128, message: "密码不能超过 128 位" },
              ]}
            >
              <Input.Password placeholder="至少 8 位" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={resetPasswordTarget ? `重置密码：${resetPasswordTarget.username}（${resetPasswordTarget.id}）` : "重置密码"}
        open={!!resetPasswordTarget}
        destroyOnClose
        onCancel={closeResetPasswordModal}
        onOk={() => resetPasswordForm.submit()}
        okText="确认重置"
        cancelText="取消"
        confirmLoading={
          !!resetPasswordTarget
          && resettingUserId === resetPasswordTarget.id
          && resetPasswordMutation.isPending
        }
      >
        <Form<ResetPasswordValues>
          form={resetPasswordForm}
          layout="vertical"
          onFinish={handleSubmitResetPassword}
          autoComplete="off"
        >
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, message: "新密码至少 8 位" },
              { max: 128, message: "新密码不能超过 128 位" },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
