"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  RequirementListResponse,
  RequirementStatus,
  RequirementSummary,
  UserListResponse,
  UserPublic,
} from "@/types/auth";

import {
  ALL_ASSIGNEE_FILTER,
  ALL_PRIORITY_FILTER,
  ALL_STATUS_FILTER,
  buildRequirementQueryString,
  buildRequirementRowActions,
  buildRequirementTableColumns,
  DEFAULT_REQUIREMENT_LIST_FILTERS,
  type RequirementActionLabels,
  type RequirementListFilters,
  REQUIREMENT_PRIORITY_LABEL,
  REQUIREMENT_PRIORITY_OPTIONS,
  REQUIREMENT_STATUS_LABEL,
  REQUIREMENT_STATUS_OPTIONS,
  type RequirementTableLabels,
} from "../_lib/requirement-list-shared";

const DEFAULT_TABLE_LABELS: RequirementTableLabels = {
  code: "编号",
  title: "标题",
  status: "状态",
  priority: "优先级",
  project: "项目",
  assignee: "指派人",
  updatedAt: "更新时间",
  actions: "操作",
};

const DEFAULT_ACTION_LABELS: RequirementActionLabels = {
  claim: "领取",
  start: "开始处理",
  complete: "标记完成",
  delete: "删除",
  deleteConfirmTitle: "确认删除此任务？",
  deleteConfirmDescription: (item) => `删除后不可恢复：${item.code}（${item.title}）`,
};

export type RequirementListViewProps = {
  pageTitle: string;
  pageDescription: string;
  listTitle?: string;
  listDescription?: string;
  createLink?: string;
  createButtonLabel?: string;
  detailPathBuilder?: (item: RequirementSummary) => string;
  topicName?: string;
  emptyDescription?: string;
  initialFilters?: Partial<RequirementListFilters>;
  actionLabels?: Partial<RequirementActionLabels>;
  tableLabels?: Partial<RequirementTableLabels>;
};

function mergeFilters(partial?: Partial<RequirementListFilters>): RequirementListFilters {
  return {
    ...DEFAULT_REQUIREMENT_LIST_FILTERS,
    ...(partial ?? {}),
  };
}

function getRequirementPath(queryString: string): string {
  return queryString ? `/api/v1/requirements?${queryString}` : "/api/v1/requirements";
}

export function RequirementListView(props: RequirementListViewProps) {
  const {
    pageTitle,
    pageDescription,
    listTitle = "任务列表",
    listDescription = "按关键词、状态、优先级、指派人筛选当前任务。",
    createLink = "/admin/requirements/new",
    createButtonLabel = "新建任务",
    detailPathBuilder = (item) => `/admin/requirements/${item.id}`,
    topicName = "requirements",
    emptyDescription = "暂无符合条件的任务",
    initialFilters,
    actionLabels,
    tableLabels,
  } = props;

  const mergedActionLabels = {
    ...DEFAULT_ACTION_LABELS,
    ...(actionLabels ?? {}),
  };
  const mergedTableLabels = {
    ...DEFAULT_TABLE_LABELS,
    ...(tableLabels ?? {}),
  };

  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [filters, setFilters] = useState<RequirementListFilters>(() =>
    mergeFilters(initialFilters),
  );
  const [actionError, setActionError] = useState("");

  const [claimingRequirementId, setClaimingRequirementId] = useState<string | null>(null);
  const [transitioningRequirementId, setTransitioningRequirementId] = useState<string | null>(null);
  const [deletingRequirementId, setDeletingRequirementId] = useState<string | null>(null);

  const canRead = hasPermission("requirement.read");
  const canCreate = hasPermission("requirement.create") || hasPermission("requirement.manage");
  const canProcess = hasPermission("requirement.process") || hasPermission("requirement.manage");
  const canManageUsers = hasPermission("user.manage");

  const queryString = useMemo(() => buildRequirementQueryString(filters), [filters]);
  const requirementsPath = useMemo(() => getRequirementPath(queryString), [queryString]);

  const loadRequirements = useCallback(async () => {
    const response = await fetchWithAuth(requirementsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RequirementListResponse;
  }, [fetchWithAuth, requirementsPath]);

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const requirementsQuery = useQuery({
    queryKey: [requirementsPath],
    queryFn: loadRequirements,
    enabled: !!user && canRead,
  });

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManageUsers,
  });

  useTopicSubscription(
    topicName,
    useCallback(() => {
      if (!user || !canRead) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    }, [canRead, queryClient, requirementsPath, user]),
  );

  const claimMutation = useMutation({
    mutationFn: async (requirementId: string) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}/claim`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onMutate: (requirementId) => {
      setClaimingRequirementId(requirementId);
      setActionError("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "领取任务失败");
    },
    onSettled: () => {
      setClaimingRequirementId(null);
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ requirementId, status }: { requirementId: string; status: RequirementStatus }) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onMutate: ({ requirementId }) => {
      setTransitioningRequirementId(requirementId);
      setActionError("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "更新任务状态失败");
    },
    onSettled: () => {
      setTransitioningRequirementId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (requirementId: string) => {
      const response = await fetchWithAuth(`/api/v1/requirements/${requirementId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onMutate: (requirementId) => {
      setDeletingRequirementId(requirementId);
      setActionError("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [requirementsPath] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "删除任务失败");
    },
    onSettled: () => {
      setDeletingRequirementId(null);
    },
  });

  const users: UserPublic[] = usersQuery.data?.items ?? [];
  const items = requirementsQuery.data?.items ?? [];
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.keyword.trim()) count += 1;
    if (filters.status) count += 1;
    if (filters.priority) count += 1;
    if (filters.assignee_user_id) count += 1;
    return count;
  }, [filters]);

  const queryError = requirementsQuery.error instanceof Error ? requirementsQuery.error.message : "";
  const error = queryError || actionError;

  const columns = useMemo(
    () =>
      buildRequirementTableColumns({
        detailPathBuilder,
        labels: mergedTableLabels,
        renderActions: (item) => {
          const disabled =
            claimMutation.isPending ||
            transitionMutation.isPending ||
            deleteMutation.isPending;

          const actions = buildRequirementRowActions({
            item,
            canProcess,
            actionLabels: mergedActionLabels,
            claimLoading: claimMutation.isPending && claimingRequirementId === item.id,
            transitionLoading:
              transitionMutation.isPending && transitioningRequirementId === item.id,
            deleteLoading: deleteMutation.isPending && deletingRequirementId === item.id,
            disabled,
            onClaim: (requirementId) => claimMutation.mutate(requirementId),
            onTransition: (requirementId, status) =>
              transitionMutation.mutate({ requirementId, status }),
            onDelete: (requirementId) => deleteMutation.mutate(requirementId),
          });

          if (actions.length === 0) {
            return <Typography.Text type="secondary">-</Typography.Text>;
          }

          return (
            <Space wrap size={[8, 8]}>
              {actions.map((action) => {
                if (action.key === "delete") {
                  return (
                    <Popconfirm
                      key={action.key}
                      title={mergedActionLabels.deleteConfirmTitle}
                      description={mergedActionLabels.deleteConfirmDescription(item)}
                      okText="确认"
                      cancelText="取消"
                      disabled={action.disabled}
                      onConfirm={action.onClick}
                    >
                      <Button
                        size="small"
                        danger
                        loading={action.loading}
                        disabled={action.disabled}
                      >
                        {action.label}
                      </Button>
                    </Popconfirm>
                  );
                }

                return (
                  <Button
                    key={action.key}
                    size="small"
                    type={action.key === "complete" ? "primary" : "default"}
                    loading={action.loading}
                    disabled={action.disabled}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </Space>
          );
        },
      }),
    [
      canProcess,
      claimMutation,
      claimMutation.isPending,
      claimMutation.mutate,
      deletingRequirementId,
      deleteMutation,
      deleteMutation.isPending,
      detailPathBuilder,
      mergedActionLabels,
      mergedTableLabels,
      transitioningRequirementId,
      transitionMutation,
      transitionMutation.isPending,
    ],
  );

  if (initializing || requirementsQuery.isLoading) {
    return (
      <Space direction="vertical" size={16} className="w-full">
        <Skeleton active title paragraph={{ rows: 2 }} />
        <Card>
          <Spin tip="加载任务中..." />
        </Card>
      </Space>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再访问该页面。</Typography.Text>
          <Link href="/">
            <Button type="default">返回首页</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">
            你没有访问该页面的权限（需要 `requirement.read`）。
          </Typography.Text>
          <Link href="/">
            <Button type="default">返回首页</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  const handleResetFilters = () => {
    setFilters(mergeFilters(initialFilters));
  };

  return (
    <Space direction="vertical" size={16} className="w-full">
      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message="操作失败"
          description={error}
          onClose={() => setActionError("")}
        />
      )}

      <Card>
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} className="mb-0">
            {pageTitle}
          </Typography.Title>
          <Typography.Text type="secondary">{pageDescription}</Typography.Text>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={16} className="w-full">
          <Space className="w-full justify-between" wrap>
            <Space direction="vertical" size={4}>
              <Typography.Title level={5} className="mb-0">
                {listTitle}
              </Typography.Title>
              <Typography.Text type="secondary">{listDescription}</Typography.Text>
            </Space>
            {canCreate && (
              <Link href={createLink}>
                <Button type="primary">{createButtonLabel}</Button>
              </Link>
            )}
          </Space>

          <Form layout="vertical">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Form.Item label="关键词" className="mb-0 xl:col-span-2">
                <Input
                  allowClear
                  value={filters.keyword}
                  aria-label="关键词"
                  placeholder="关键词 / 编号"
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, keyword: event.target.value }))
                  }
                />
              </Form.Item>

              <Form.Item label="状态" className="mb-0">
                <Select
                  value={filters.status || ALL_STATUS_FILTER}
                  aria-label="状态"
                  options={[
                    { value: ALL_STATUS_FILTER, label: "全部状态" },
                    ...REQUIREMENT_STATUS_OPTIONS.map((item) => ({
                      value: item,
                      label: REQUIREMENT_STATUS_LABEL[item],
                    })),
                  ]}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      status: value === ALL_STATUS_FILTER ? "" : value,
                    }))
                  }
                />
              </Form.Item>

              <Form.Item label="优先级" className="mb-0">
                <Select
                  value={filters.priority || ALL_PRIORITY_FILTER}
                  aria-label="优先级"
                  options={[
                    { value: ALL_PRIORITY_FILTER, label: "全部优先级" },
                    ...REQUIREMENT_PRIORITY_OPTIONS.map((item) => ({
                      value: item,
                      label: REQUIREMENT_PRIORITY_LABEL[item],
                    })),
                  ]}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      priority: value === ALL_PRIORITY_FILTER ? "" : value,
                    }))
                  }
                />
              </Form.Item>

              <Form.Item label="指派人" className="mb-0">
                <Select
                  value={filters.assignee_user_id || ALL_ASSIGNEE_FILTER}
                  aria-label="指派人"
                  disabled={!canManageUsers}
                  options={[
                    { value: ALL_ASSIGNEE_FILTER, label: "全部指派人" },
                    ...users.map((item) => ({ value: item.id, label: item.username })),
                  ]}
                  onChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      assignee_user_id: value === ALL_ASSIGNEE_FILTER ? "" : value,
                    }))
                  }
                />
              </Form.Item>
            </div>
          </Form>

          <Space>
            <Button onClick={handleResetFilters}>重置筛选</Button>
          </Space>
        </Space>
      </Card>

      <Card>
        <Space className="w-full justify-between" wrap>
          <Space size={12}>
            <Typography.Text type="secondary">
              共 {requirementsQuery.data?.total ?? 0} 条
            </Typography.Text>
            {activeFilterCount > 0 && (
              <Typography.Text type="secondary">
                已筛选 {activeFilterCount} 项
              </Typography.Text>
            )}
          </Space>
          {requirementsQuery.isFetching && (
            <Space size={8}>
              <Spin size="small" />
              <Typography.Text type="secondary">刷新中...</Typography.Text>
            </Space>
          )}
        </Space>

        <div className="mt-4">
          <Table<RequirementSummary>
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={requirementsQuery.isFetching}
            scroll={{ x: 1300 }}
            pagination={false}
            locale={{
              emptyText: (
                <Empty
                  description={emptyDescription}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Space>
                    <Button onClick={handleResetFilters}>清空筛选条件</Button>
                    {canCreate && (
                      <Link href={createLink}>
                        <Button type="primary">{createButtonLabel}</Button>
                      </Link>
                    )}
                  </Space>
                </Empty>
              ),
            }}
          />
        </div>
      </Card>
    </Space>
  );
}
