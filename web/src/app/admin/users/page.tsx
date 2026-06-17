"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  type CardProps,
  type MenuProps,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
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

type EditUserValues = {
  user_id: string;
  username: string;
  email: string;
  status: "active" | "disabled";
};

type ResetPasswordValues = {
  password: string;
};

function statusLabel(status: string): string {
  if (status === "active") return "启用";
  if (status === "disabled") return "禁用";
  return status || "-";
}

const USERS_TABLE_MIN_SCROLL_Y = 180;
const USERS_TABLE_VIEWPORT_GAP = 40;
const USERS_TABLE_FALLBACK_RESERVE = 220;

export default function AdminUsersPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [createForm] = Form.useForm<CreateUserValues>();
  const [editUserForm] = Form.useForm<EditUserValues>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordValues>();

  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [updatingStatusUserId, setUpdatingStatusUserId] = useState<string | null>(null);
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserPublic | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserPublic | null>(null);
  const [assigningRolesUser, setAssigningRolesUser] = useState<UserPublic | null>(null);
  const [roleForm] = Form.useForm<{ role_codes: string[] }>();
  const [keywordInput, setKeywordInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "disabled" | undefined>(undefined);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [tableScrollY, setTableScrollY] = useState(USERS_TABLE_MIN_SCROLL_Y);
  const tableScrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canManage = hasPermission("user.manage");
  const canReadRoles = hasPermission("role.read") || hasPermission("role.manage");

  const trimmedKeyword = searchKeyword.trim();
  const usersQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(pagination.pageSize));
    params.set("offset", String((pagination.current - 1) * pagination.pageSize));
    if (trimmedKeyword) {
      params.set("keyword", trimmedKeyword);
    }
    if (statusFilter) {
      params.set("status", statusFilter);
    }
    return params.toString();
  }, [pagination.current, pagination.pageSize, statusFilter, trimmedKeyword]);
  const usersPath = `/api/v1/users?${usersQueryParams}`;
  const rolesPath = "/api/v1/admin/roles";

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth(usersPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth, usersPath]);

  const loadRoles = useCallback(async () => {
    const response = await fetchWithAuth(rolesPath);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as RoleListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: ["admin.users", usersQueryParams],
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
      void queryClient.invalidateQueries({ queryKey: ["admin.users"] });
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
    await queryClient.invalidateQueries({ queryKey: ["admin.users"] });
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
    mutationFn: async ({ userId, payload }: {
      userId: string;
      payload: {
        new_user_id?: string;
        username?: string;
        email?: string;
        status?: "active" | "disabled";
      };
    }) => {
      const response = await fetchWithAuth(`/api/v1/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      if (variables.payload.status) {
        setSuccess(variables.payload.status === "active" ? "用户已启用" : "用户已禁用");
      } else {
        setSuccess("用户信息已更新");
      }
      setEditingUser(null);
      editUserForm.resetFields();
      await refreshData();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "更新用户信息失败");
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

  const openAssignRolesModal = (target: UserPublic) => {
    setError("");
    setSuccess("");
    setAssigningRolesUser(target);
    roleForm.setFieldsValue({ role_codes: target.role_codes });
  };

  const closeAssignRolesModal = () => {
    if (updateRolesMutation.isPending) return;
    setAssigningRolesUser(null);
    roleForm.resetFields();
  };

  const handleSubmitAssignRoles = (values: { role_codes: string[] }) => {
    if (!assigningRolesUser) return;
    updateRolesMutation.mutate(
      { userId: assigningRolesUser.id, roleCodes: values.role_codes },
      {
        onSuccess: () => {
          closeAssignRolesModal();
        },
      },
    );
  };

  const openEditUserModal = (target: UserPublic) => {
    setError("");
    setSuccess("");
    setEditingUser(target);
    editUserForm.setFieldsValue({
      user_id: target.id,
      username: target.username,
      email: target.email,
      status: target.status === "disabled" ? "disabled" : "active",
    });
  };

  const closeEditUserModal = () => {
    if (updateUserProfileMutation.isPending) return;
    setEditingUser(null);
    editUserForm.resetFields();
  };

  const handleSubmitEditUser = (values: EditUserValues) => {
    if (!editingUser) return;
    const nextUserId = values.user_id.trim();
    const nextUsername = values.username.trim();
    const nextEmail = values.email ? values.email.trim().toLowerCase() : "";
    const nextStatus = values.status;

    const payload: { new_user_id?: string; username?: string; email?: string; status?: "active" | "disabled" } = {};

    if (nextUserId !== editingUser.id) {
      const lowerUserId = nextUserId.toLowerCase();
      if (existingUserIds.has(lowerUserId) && lowerUserId !== editingUser.id.toLowerCase()) {
        setError("用户 ID 已存在，请更换后重试");
        return;
      }
      payload.new_user_id = nextUserId;
    }
    if (nextUsername !== editingUser.username) {
      payload.username = nextUsername;
    }
    if (nextEmail && nextEmail !== editingUser.email.toLowerCase()) {
      payload.email = nextEmail;
    }
    if (nextStatus !== editingUser.status) {
      payload.status = nextStatus;
    }

    if (Object.keys(payload).length === 0) {
      setSuccess("未检测到变更");
      closeEditUserModal();
      return;
    }

    updateUserProfileMutation.mutate({
      userId: editingUser.id,
      payload,
    });
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

  const handleSearch = () => {
    setSearchKeyword(keywordInput);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const handleResetSearch = () => {
    setKeywordInput("");
    setSearchKeyword("");
    setStatusFilter(undefined);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  const queryError =
    (usersQuery.error instanceof Error ? usersQuery.error.message : "")
    || (rolesQuery.error instanceof Error ? rolesQuery.error.message : "");
  const anyError = error || queryError;

  useToastFeedback({
    errorMessage: anyError,
    successMessage: success,
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

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

    let nextHeight = Math.floor(window.innerHeight - anchorTop - USERS_TABLE_FALLBACK_RESERVE);
    if (tableWrapper) {
      const wrapperRect = tableWrapper.getBoundingClientRect();
      const bodyHeight = tableBody?.getBoundingClientRect().height ?? USERS_TABLE_MIN_SCROLL_Y;
      const nonBodyHeight = Math.max(0, wrapperRect.height - bodyHeight);
      const topGap = Math.max(0, wrapperRect.top - anchorTop);
      nextHeight = Math.floor(window.innerHeight - anchorTop - topGap - nonBodyHeight - USERS_TABLE_VIEWPORT_GAP);
    }

    const clampedHeight = Math.max(USERS_TABLE_MIN_SCROLL_Y, nextHeight);
    setTableScrollY((previous) => (Math.abs(previous - clampedHeight) <= 1 ? previous : clampedHeight));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(updateTableScrollY);
  }, [anyError, pagination.current, pagination.pageSize, users.length, usersQuery.isFetching, updateTableScrollY]);

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

  const columns: ColumnsType<UserPublic> = [
    {
      title: "用户 ID",
      dataIndex: "id",
      width: 180,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "用户名",
      dataIndex: "username",
      width: 180,
    },
    {
      title: "邮箱",
      dataIndex: "email",
      width: 220,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      align: "center",
      render: (value: string) => (
        <Tag color={value === "active" ? "green" : "default"}>{statusLabel(value)}</Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 180,
      render: (_value, row) => {
        const updatingLoading = updatingStatusUserId === row.id;
        const resetLoading = resettingUserId === row.id;
        const deleteLoading = deletingUserId === row.id;
        const savingLoading = savingUserId === row.id;
        const rowBusy = updatingLoading || resetLoading || deleteLoading || savingLoading;

        const moreMenuItems: MenuProps["items"] = [
          {
            key: "assign-roles",
            label: "分配角色",
            disabled: rowBusy,
            onClick: () => openAssignRolesModal(row),
          },
          {
            key: "toggle-status",
            label: row.status === "active" ? "禁用" : "启用",
            disabled: rowBusy || row.id === user?.id,
            onClick: () => {
              if (row.id === user?.id) {
                setError("不能修改当前登录账号的状态");
                return;
              }
              const nextStatus: "active" | "disabled" = row.status === "active" ? "disabled" : "active";
              updateUserProfileMutation.mutate({ userId: row.id, payload: { status: nextStatus } });
            },
          },
          {
            key: "reset-password",
            label: "重置密码",
            disabled: rowBusy,
            onClick: () => openResetPasswordModal(row),
          },
        ];

        return (
          <Space wrap>
            <Button
              size="small"
              disabled={rowBusy}
              onClick={() => openEditUserModal(row)}
            >
              编辑
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

            <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]}>
              <Button size="small" disabled={rowBusy} icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

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
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问用户管理页面。</p>
        <Link
          href="/"
          className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]"
        >
          返回首页
        </Link>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `user.manage`）。</p>
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
        title="用户列表"
        style={{ height: '100%' }}
        extra={(
          <Space>
            {usersQuery.isFetching && <Spin size="small" />}
            <Button type="primary" onClick={openCreateUserModal}>
              新增用户
            </Button>
          </Space>
        )}
      >
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label="关键词" className="min-w-[240px]">
            <Input
              allowClear
              placeholder="按用户 ID/邮箱/用户名搜索"
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={handleSearch}
            />
          </Form.Item>

          <Form.Item label="状态" className="min-w-[170px]">
            <Select<"active" | "disabled">
              value={statusFilter}
              allowClear
              placeholder="全部"
              options={[
                { value: "active", label: "已启用" },
                { value: "disabled", label: "已禁用" },
              ]}
              onChange={(value) => {
                setStatusFilter(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" onClick={handleSearch}>
              搜索
            </Button>
          </Form.Item>
        </Form>

        <div
          ref={tableScrollAnchorRef}
          className="admin-users-table-anchor mt-4"
          style={{ "--admin-users-table-body-min-height": `${tableScrollY}px` } as CSSProperties}
        >
          <Table<UserPublic>
            rowKey="id"
            dataSource={users}
            columns={columns}
            loading={usersQuery.isLoading || rolesQuery.isLoading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total: usersQuery.data?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              hideOnSinglePage: false,
              style: { marginBottom: 0 },
              onChange: (page, pageSize) => {
                setPagination({ current: page, pageSize });
              },
            }}
            scroll={{ x: 1500, y: tableScrollY }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未找到符合筛选条件的用户。"
                />
              ),
            }}
          />
        </div>
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
        title={editingUser ? `编辑用户：${editingUser.username}（${editingUser.id}）` : "编辑用户"}
        open={!!editingUser}
        destroyOnClose
        onCancel={closeEditUserModal}
        onOk={() => editUserForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateUserProfileMutation.isPending}
      >
        <Form<EditUserValues>
          form={editUserForm}
          layout="vertical"
          onFinish={handleSubmitEditUser}
          autoComplete="off"
        >
          <Form.Item
            label="用户 ID"
            name="user_id"
            rules={[
              { required: true, message: "请输入用户 ID" },
              { min: 3, message: "用户 ID 至少 3 位" },
              { max: 64, message: "用户 ID 不能超过 64 位" },
            ]}
          >
            <Input placeholder="请输入用户 ID" />
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
            label="邮箱"
            name="email"
            rules={[
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            rules={[{ required: true, message: "请选择状态" }]}
          >
            <Select
              options={[
                { label: "启用", value: "active" },
                { label: "禁用", value: "disabled" },
              ]}
            />
          </Form.Item>
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

      <Modal
        title={assigningRolesUser ? `分配角色：${assigningRolesUser.username}（${assigningRolesUser.id}）` : "分配角色"}
        open={!!assigningRolesUser}
        destroyOnClose
        onCancel={closeAssignRolesModal}
        onOk={() => roleForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateRolesMutation.isPending && savingUserId === assigningRolesUser?.id}
      >
        <Form<{ role_codes: string[] }>
          form={roleForm}
          layout="vertical"
          onFinish={handleSubmitAssignRoles}
          autoComplete="off"
        >
          <Form.Item
            label="角色"
            name="role_codes"
            rules={[{ required: false }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择角色"
              options={roleOptions.map((code) => ({ label: code, value: code }))}
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
