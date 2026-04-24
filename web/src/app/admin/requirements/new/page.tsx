"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Select, Skeleton, Space, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { readApiError } from "@/lib/api";
import type { RequirementPriority, RequirementStatus, UserListResponse } from "@/types/auth";

const { TextArea } = Input;

const STATUS_OPTIONS: RequirementStatus[] = [
  "PENDING_ANALYSIS",
  "PENDING_REVIEW",
  "PENDING_REVISION",
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
];
const PRIORITY_OPTIONS: RequirementPriority[] = ["low", "medium", "high", "urgent"];

const STATUS_LABEL: Record<RequirementStatus, string> = {
  PENDING_ANALYSIS: "待分析",
  PENDING_REVIEW: "待评审",
  PENDING_REVISION: "待修订",
  OPEN: "待处理",
  IN_PROGRESS: "处理中",
  COMPLETED: "已完成",
  CLOSED: "已关闭",
  CANCELLED: "已取消",
};

const PRIORITY_LABEL: Record<RequirementPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const UNASSIGNED_OPTION = "__unassigned__";

export default function RequirementCreatePage() {
  const router = useRouter();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<RequirementStatus>("PENDING_ANALYSIS");
  const [priority, setPriority] = useState<RequirementPriority>("medium");
  const [projectName, setProjectName] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [source, setSource] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [dueAt, setDueAt] = useState("");

  const canCreate = hasPermission("requirement.create") || hasPermission("requirement.manage");
  const canManageUsers = hasPermission("user.manage");

  const loadUsers = useCallback(async () => {
    const response = await fetchWithAuth("/api/v1/users?limit=200&offset=0");
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const usersQuery = useQuery({
    queryKey: ["/api/v1/users?limit=200&offset=0"],
    queryFn: loadUsers,
    enabled: !!user && canManageUsers,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          priority,
          project_name: projectName || null,
          module_name: moduleName || null,
          source: source || null,
          assignee_user_id: assigneeUserId || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json() as Promise<{ id: string }>;
    },
    onSuccess: async (data) => {
      router.push(`/admin/requirements/${data.id}`);
    },
  });

  const error = createMutation.error instanceof Error ? createMutation.error.message : "";
  const usersError = usersQuery.error instanceof Error ? usersQuery.error.message : "";
  const users = usersQuery.data?.items ?? [];

  const statusSelectOptions = useMemo(
    () => STATUS_OPTIONS.map((item) => ({ label: STATUS_LABEL[item], value: item })),
    [],
  );

  const prioritySelectOptions = useMemo(
    () => PRIORITY_OPTIONS.map((item) => ({ label: PRIORITY_LABEL[item], value: item })),
    [],
  );

  const assigneeOptions = useMemo(
    () => [
      { label: "暂不指派", value: UNASSIGNED_OPTION },
      ...users.map((item) => ({ label: item.username, value: item.id })),
    ],
    [users],
  );

  if (initializing) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再创建需求。</Typography.Text>
          <Button>
            <Link href="/">返回首页</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  if (!canCreate) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">你没有创建需求的权限（需要 `requirement.create`）。</Typography.Text>
          <Button>
            <Link href="/admin/requirements">返回需求列表</Link>
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} className="w-full">
      {error && <Alert type="error" showIcon message="创建失败" description={error} />}
      {usersError && canManageUsers && (
        <Alert
          type="warning"
          showIcon
          message="指派人列表加载失败"
          description={`${usersError}。你仍可创建需求并选择“暂不指派”。`}
        />
      )}

      <Card
        title="新建需求"
        extra={
          <Button>
            <Link href="/admin/requirements">返回列表</Link>
          </Button>
        }
      >
        <Space direction="vertical" size={16} className="w-full">
          <Typography.Text type="secondary">填写需求基本信息并指定初始处理人。</Typography.Text>

          <Form layout="vertical">
            <Form.Item label="标题" required>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Form.Item>

            <Form.Item label="描述">
              <TextArea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={8}
                placeholder="请输入需求背景、目标和约束"
              />
            </Form.Item>

            <div className="grid gap-4 md:grid-cols-2">
              <Form.Item label="状态" className="!mb-0">
                <Select<RequirementStatus>
                  value={status}
                  onChange={(value) => setStatus(value)}
                  options={statusSelectOptions}
                />
              </Form.Item>

              <Form.Item label="优先级" className="!mb-0">
                <Select<RequirementPriority>
                  value={priority}
                  onChange={(value) => setPriority(value)}
                  options={prioritySelectOptions}
                />
              </Form.Item>

              <Form.Item label="项目" className="!mb-0">
                <Input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="如：fquiz"
                />
              </Form.Item>

              <Form.Item label="模块" className="!mb-0">
                <Input
                  value={moduleName}
                  onChange={(event) => setModuleName(event.target.value)}
                  placeholder="如：admin/requirements"
                />
              </Form.Item>

              <Form.Item label="来源" className="!mb-0">
                <Input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="如：产品评审 / 用户反馈"
                />
              </Form.Item>

              <Form.Item label="指派人" className="!mb-0">
                <Select
                  value={assigneeUserId || UNASSIGNED_OPTION}
                  onChange={(value) => setAssigneeUserId(value === UNASSIGNED_OPTION ? "" : value)}
                  disabled={!canManageUsers}
                  loading={usersQuery.isFetching}
                  options={assigneeOptions}
                />
              </Form.Item>

              <Form.Item label="截止时间" className="!mb-0 md:col-span-2">
                <Input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </Form.Item>
            </div>
          </Form>

          <div>
            <Button
              type="primary"
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={!title.trim()}
            >
              创建需求
            </Button>
          </div>
        </Space>
      </Card>
    </Space>
  );
}
