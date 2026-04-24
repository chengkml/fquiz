"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  RequirementComment,
  RequirementCommentKind,
  RequirementEvent,
  RequirementPriority,
  RequirementStatus,
  RequirementSummary,
  UserListResponse,
} from "@/types/auth";

const { TextArea } = Input;

const COMMENT_KIND_OPTIONS: RequirementCommentKind[] = ["comment", "analysis", "revision", "system"];
const PRIORITY_OPTIONS: RequirementPriority[] = ["low", "medium", "high", "urgent"];
const UNASSIGNED_ASSIGNEE = "__unassigned_assignee__";

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

const ALLOWED_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  PENDING_ANALYSIS: ["PENDING_REVIEW", "PENDING_REVISION", "OPEN", "CLOSED"],
  PENDING_REVIEW: ["PENDING_REVISION", "OPEN", "CLOSED"],
  PENDING_REVISION: ["OPEN", "CLOSED"],
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["COMPLETED", "PENDING_REVISION", "CLOSED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

type FetchWithAuth = ReturnType<typeof useAuth>["fetchWithAuth"];

function formatRequirementStatus(value: string | null | undefined): string {
  if (!value) return "-";
  return STATUS_LABEL[value as RequirementStatus] ?? value;
}

function formatRequirementPriority(value: string | null | undefined): string {
  if (!value) return "-";
  return PRIORITY_LABEL[value as RequirementPriority] ?? value;
}

function toDatetimeLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusTagColor(status: RequirementStatus): string {
  switch (status) {
    case "PENDING_ANALYSIS":
    case "PENDING_REVIEW":
    case "PENDING_REVISION":
      return "gold";
    case "OPEN":
      return "default";
    case "IN_PROGRESS":
      return "processing";
    case "COMPLETED":
      return "success";
    case "CLOSED":
      return "blue";
    case "CANCELLED":
      return "red";
    default:
      return "default";
  }
}

function priorityTagColor(priority: RequirementPriority): string {
  switch (priority) {
    case "urgent":
      return "red";
    case "high":
      return "orange";
    case "medium":
      return "gold";
    case "low":
      return "default";
    default:
      return "default";
  }
}

async function invalidateRequirementQueries(
  queryClient: QueryClient,
  detailPath: string,
  commentsPath: string,
  eventsPath: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [detailPath] });
  await queryClient.invalidateQueries({ queryKey: [commentsPath] });
  await queryClient.invalidateQueries({ queryKey: [eventsPath] });
  await queryClient.invalidateQueries({ queryKey: ["/api/v1/requirements"] });
}

function RequirementEditSection({
  detail,
  detailPath,
  commentsPath,
  eventsPath,
  fetchWithAuth,
  queryClient,
}: {
  detail: RequirementSummary;
  detailPath: string;
  commentsPath: string;
  eventsPath: string;
  fetchWithAuth: FetchWithAuth;
  queryClient: QueryClient;
}) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [priority, setPriority] = useState<RequirementPriority>(detail.priority);
  const [projectName, setProjectName] = useState(detail.project_name ?? "");
  const [moduleName, setModuleName] = useState(detail.module_name ?? "");
  const [source, setSource] = useState(detail.source ?? "");
  const [dueAt, setDueAt] = useState(toDatetimeLocalInput(detail.due_at));

  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(detailPath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          priority,
          project_name: projectName || null,
          module_name: moduleName || null,
          source: source || null,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      await invalidateRequirementQueries(queryClient, detailPath, commentsPath, eventsPath);
    },
  });

  const error = updateMutation.error instanceof Error ? updateMutation.error.message : "";

  return (
    <Card
      title="编辑基础信息"
      extra={<Typography.Text type="secondary">支持更新标题、描述、优先级、项目、模块、来源和截止时间</Typography.Text>}
    >
      <Space direction="vertical" size={16} className="w-full">
        {error && <Alert type="error" showIcon message="保存失败" description={error} />}

        <Form layout="vertical">
          <Form.Item label="标题" required>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Form.Item>

          <Form.Item label="描述">
            <TextArea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={8}
              placeholder="请输入需求描述"
            />
          </Form.Item>

          <div className="grid gap-4 md:grid-cols-2">
            <Form.Item label="优先级" className="mb-0">
              <Select
                value={priority}
                onChange={(value) => setPriority(value as RequirementPriority)}
                options={PRIORITY_OPTIONS.map((item) => ({
                  value: item,
                  label: formatRequirementPriority(item),
                }))}
              />
            </Form.Item>

            <Form.Item label="截止时间" className="mb-0">
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Form.Item>

            <Form.Item label="项目" className="mb-0">
              <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </Form.Item>

            <Form.Item label="模块" className="mb-0">
              <Input value={moduleName} onChange={(event) => setModuleName(event.target.value)} />
            </Form.Item>
          </div>

          <Form.Item label="来源" className="mb-0">
            <Input value={source} onChange={(event) => setSource(event.target.value)} />
          </Form.Item>
        </Form>

        <Button
          type="primary"
          onClick={() => updateMutation.mutate()}
          loading={updateMutation.isPending}
          disabled={!title.trim()}
        >
          保存基础信息
        </Button>
      </Space>
    </Card>
  );
}

function RequirementActionsSection({
  detail,
  users,
  canAssign,
  detailPath,
  commentsPath,
  eventsPath,
  fetchWithAuth,
  queryClient,
}: {
  detail: RequirementSummary;
  users: UserListResponse["items"];
  canAssign: boolean;
  detailPath: string;
  commentsPath: string;
  eventsPath: string;
  fetchWithAuth: FetchWithAuth;
  queryClient: QueryClient;
}) {
  const [assignUserId, setAssignUserId] = useState(detail.assignee_user_id ?? "");
  const [transitionStatus, setTransitionStatus] = useState<RequirementStatus>(
    ALLOWED_TRANSITIONS[detail.status][0] ?? detail.status,
  );
  const [transitionNote, setTransitionNote] = useState("");

  const availableTransitions = ALLOWED_TRANSITIONS[detail.status];
  const currentTransitionStatus = availableTransitions.includes(transitionStatus)
    ? transitionStatus
    : (availableTransitions[0] ?? detail.status);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(`${detailPath}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee_user_id: assignUserId || null }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      await invalidateRequirementQueries(queryClient, detailPath, commentsPath, eventsPath);
    },
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(`${detailPath}/claim`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      await invalidateRequirementQueries(queryClient, detailPath, commentsPath, eventsPath);
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(`${detailPath}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: currentTransitionStatus, note: transitionNote || null }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setTransitionNote("");
      await invalidateRequirementQueries(queryClient, detailPath, commentsPath, eventsPath);
    },
  });

  const error = [assignMutation.error, claimMutation.error, transitionMutation.error].find(
    (item) => item instanceof Error,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="处理动作">
        <Space direction="vertical" size={16} className="w-full">
          {error instanceof Error && (
            <Alert type="error" showIcon message="操作失败" description={error.message} />
          )}

          {canAssign && (
            <Form layout="vertical">
              <Form.Item label="指派" className="mb-0">
                <Space.Compact className="w-full">
                  <Select
                    className="w-full"
                    value={assignUserId || UNASSIGNED_ASSIGNEE}
                    onChange={(value) =>
                      setAssignUserId(value === UNASSIGNED_ASSIGNEE ? "" : (value as string))
                    }
                    options={[
                      { value: UNASSIGNED_ASSIGNEE, label: "取消指派" },
                      ...users.map((item) => ({ value: item.id, label: item.username })),
                    ]}
                  />
                  <Button
                    onClick={() => assignMutation.mutate()}
                    loading={assignMutation.isPending}
                  >
                    保存
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Form>
          )}

          <Form layout="vertical">
            <Form.Item label="领取" className="mb-0">
              <Button onClick={() => claimMutation.mutate()} loading={claimMutation.isPending}>
                我来领取
              </Button>
            </Form.Item>
          </Form>

          <Form layout="vertical">
            <Form.Item label="状态流转" className="mb-0">
              {availableTransitions.length > 0 ? (
                <Space direction="vertical" size={8} className="w-full">
                  <Select
                    value={currentTransitionStatus}
                    onChange={(value) => setTransitionStatus(value as RequirementStatus)}
                    options={availableTransitions.map((item) => ({
                      value: item,
                      label: formatRequirementStatus(item),
                    }))}
                  />
                  <TextArea
                    value={transitionNote}
                    onChange={(event) => setTransitionNote(event.target.value)}
                    rows={3}
                    placeholder="流转备注（可选）"
                  />
                  <Button
                    type="primary"
                    onClick={() => transitionMutation.mutate()}
                    loading={transitionMutation.isPending}
                  >
                    提交流转
                  </Button>
                </Space>
              ) : (
                <Typography.Text type="secondary">当前状态没有可继续流转的目标状态。</Typography.Text>
              )}
            </Form.Item>
          </Form>
        </Space>
      </Card>

      <Card title="当前处理说明">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="当前状态">{formatRequirementStatus(detail.status)}</Descriptions.Item>
          <Descriptions.Item label="当前指派人">{detail.assignee?.username ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="当前评审人">{detail.reviewer?.username ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="当前进度">{detail.progress_percent ?? 0}%</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}

function RequirementCommentSection({
  commentsPath,
  eventsPath,
  detailPath,
  fetchWithAuth,
  queryClient,
}: {
  commentsPath: string;
  eventsPath: string;
  detailPath: string;
  fetchWithAuth: FetchWithAuth;
  queryClient: QueryClient;
}) {
  const [commentContent, setCommentContent] = useState("");
  const [commentKind, setCommentKind] = useState<RequirementCommentKind>("comment");

  const commentMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(commentsPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentContent, kind: commentKind }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return response.json();
    },
    onSuccess: async () => {
      setCommentContent("");
      setCommentKind("comment");
      await invalidateRequirementQueries(queryClient, detailPath, commentsPath, eventsPath);
    },
  });

  const error = commentMutation.error instanceof Error ? commentMutation.error.message : "";

  return (
    <Card title="新增评论">
      <Space direction="vertical" size={16} className="w-full">
        {error && <Alert type="error" showIcon message="评论失败" description={error} />}

        <Form layout="vertical">
          <Form.Item label="评论类型" className="mb-0">
            <Select
              value={commentKind}
              onChange={(value) => setCommentKind(value as RequirementCommentKind)}
              options={COMMENT_KIND_OPTIONS.map((item) => ({ value: item, label: item }))}
            />
          </Form.Item>

          <Form.Item label="评论内容" className="mb-0">
            <TextArea
              value={commentContent}
              onChange={(event) => setCommentContent(event.target.value)}
              rows={6}
              placeholder="写点处理说明、分析结论或修订意见"
            />
          </Form.Item>
        </Form>

        <Button
          type="primary"
          onClick={() => commentMutation.mutate()}
          loading={commentMutation.isPending}
          disabled={!commentContent.trim()}
        >
          发表评论
        </Button>
      </Space>
    </Card>
  );
}

export default function RequirementDetailPage() {
  const params = useParams<{ id: string }>();
  const rawRequirementId = params.id;
  const requirementId = Array.isArray(rawRequirementId) ? rawRequirementId[0] : rawRequirementId;
  const queryClient = useQueryClient();
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("requirement.read");
  const canProcess = hasPermission("requirement.process") || hasPermission("requirement.manage");
  const canManageUsers = hasPermission("user.manage");
  const canAssign = canProcess && canManageUsers;
  const canEdit = canProcess;

  const detailPath = requirementId ? `/api/v1/requirements/${requirementId}` : "";
  const commentsPath = requirementId ? `/api/v1/requirements/${requirementId}/comments` : "";
  const eventsPath = requirementId ? `/api/v1/requirements/${requirementId}/events` : "";
  const usersPath = "/api/v1/users?limit=200&offset=0";

  const fetchDetail = useCallback(async () => {
    const response = await fetchWithAuth(detailPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RequirementSummary;
  }, [detailPath, fetchWithAuth]);

  const fetchComments = useCallback(async () => {
    const response = await fetchWithAuth(commentsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RequirementComment[];
  }, [commentsPath, fetchWithAuth]);

  const fetchEvents = useCallback(async () => {
    const response = await fetchWithAuth(eventsPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as RequirementEvent[];
  }, [eventsPath, fetchWithAuth]);

  const fetchUsers = useCallback(async () => {
    const response = await fetchWithAuth(usersPath);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    return (await response.json()) as UserListResponse;
  }, [fetchWithAuth]);

  const detailQuery = useQuery({
    queryKey: [detailPath],
    queryFn: fetchDetail,
    enabled: !!requirementId && !!user && canRead,
  });
  const commentsQuery = useQuery({
    queryKey: [commentsPath],
    queryFn: fetchComments,
    enabled: !!requirementId && !!user && canRead,
  });
  const eventsQuery = useQuery({
    queryKey: [eventsPath],
    queryFn: fetchEvents,
    enabled: !!requirementId && !!user && canRead,
  });
  const usersQuery = useQuery({
    queryKey: [usersPath],
    queryFn: fetchUsers,
    enabled: !!user && canAssign,
  });

  useTopicSubscription(
    "requirements",
    useCallback(() => {
      if (!detailPath || !commentsPath || !eventsPath) return;
      void queryClient.invalidateQueries({ queryKey: [detailPath] });
      void queryClient.invalidateQueries({ queryKey: [commentsPath] });
      void queryClient.invalidateQueries({ queryKey: [eventsPath] });
      void queryClient.invalidateQueries({ queryKey: ["/api/v1/requirements"] });
    }, [commentsPath, detailPath, eventsPath, queryClient]),
  );

  const anyError = useMemo(() => {
    for (const candidate of [detailQuery.error, commentsQuery.error, eventsQuery.error, usersQuery.error]) {
      if (candidate instanceof Error) {
        return candidate.message;
      }
    }
    return "";
  }, [commentsQuery.error, detailQuery.error, eventsQuery.error, usersQuery.error]);

  if (initializing || detailQuery.isLoading) {
    return (
      <Card>
        <Space>
          <Spin />
          <Typography.Text type="secondary">加载需求详情中...</Typography.Text>
        </Space>
      </Card>
    );
  }

  if (!requirementId) {
    return <Alert type="warning" showIcon message="需求 ID 无效" />;
  }

  if (!user) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">请先登录后再访问需求详情。</Typography.Text>
          <Link href="/">
            <Button>返回首页</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  if (!canRead) {
    return (
      <Card>
        <Space direction="vertical" size={12}>
          <Typography.Text type="secondary">你没有访问该页面的权限（需要 `requirement.read`）。</Typography.Text>
          <Link href="/admin/requirements">
            <Button>返回需求列表</Button>
          </Link>
        </Space>
      </Card>
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return <Alert type="info" showIcon message="需求不存在" />;
  }

  const comments = commentsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const users = usersQuery.data?.items ?? [];

  return (
    <Space direction="vertical" size={16} className="w-full">
      {anyError && <Alert type="error" showIcon message="加载或操作失败" description={anyError} />}

      <Card>
        <Space direction="vertical" size={12} className="w-full">
          <Space className="w-full justify-between" align="start" wrap>
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary" code>
                {detail.code}
              </Typography.Text>
              <Typography.Title level={3} className="mb-0">
                {detail.title}
              </Typography.Title>
            </Space>

            <Space direction="vertical" size={4} align="end">
              <Link href="/admin/requirements">
                <Button type="link" className="px-0">
                  返回需求列表
                </Button>
              </Link>
              <Space>
                <Tag color={statusTagColor(detail.status)}>{formatRequirementStatus(detail.status)}</Tag>
                <Tag color={priorityTagColor(detail.priority)}>{formatRequirementPriority(detail.priority)}</Tag>
              </Space>
            </Space>
          </Space>

          <Typography.Paragraph className="mb-0">
            {detail.description || "暂无描述"}
          </Typography.Paragraph>

          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, md: 3 }}
            items={[
              { label: "项目", children: detail.project_name ?? "-" },
              { label: "模块", children: detail.module_name ?? "-" },
              { label: "来源", children: detail.source ?? "-" },
              { label: "创建人", children: detail.creator?.username ?? "-" },
              { label: "指派人", children: detail.assignee?.username ?? "-" },
              { label: "评审人", children: detail.reviewer?.username ?? "-" },
              { label: "进度", children: `${detail.progress_percent ?? 0}%` },
              { label: "分支", children: detail.branch ?? "-" },
              { label: "Git 地址", children: detail.git_url ?? "-" },
              { label: "截止时间", children: formatDateTime(detail.due_at) },
              { label: "完成时间", children: formatDateTime(detail.closed_at) },
              { label: "更新时间", children: formatDateTime(detail.updated_at) },
              { label: "处理结论", children: detail.result_msg || "-", span: 3 },
            ]}
          />
        </Space>
      </Card>

      {canEdit && (
        <RequirementEditSection
          key={`edit:${detail.id}:${detail.updated_at}`}
          detail={detail}
          detailPath={detailPath}
          commentsPath={commentsPath}
          eventsPath={eventsPath}
          fetchWithAuth={fetchWithAuth}
          queryClient={queryClient}
        />
      )}

      {canProcess && (
        <RequirementActionsSection
          key={`actions:${detail.id}:${detail.updated_at}`}
          detail={detail}
          users={users}
          canAssign={canAssign}
          detailPath={detailPath}
          commentsPath={commentsPath}
          eventsPath={eventsPath}
          fetchWithAuth={fetchWithAuth}
          queryClient={queryClient}
        />
      )}

      {canProcess && (
        <RequirementCommentSection
          detailPath={detailPath}
          commentsPath={commentsPath}
          eventsPath={eventsPath}
          fetchWithAuth={fetchWithAuth}
          queryClient={queryClient}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="评论区">
          <List
            dataSource={comments}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无评论" />,
            }}
            renderItem={(item) => (
              <List.Item key={item.id}>
                <Space direction="vertical" size={4} className="w-full">
                  <Typography.Text type="secondary">
                    {item.author?.username ?? "系统"} · {item.kind} · {formatDateTime(item.created_at)}
                  </Typography.Text>
                  <Typography.Paragraph className="mb-0 whitespace-pre-wrap">
                    {item.content}
                  </Typography.Paragraph>
                </Space>
              </List.Item>
            )}
          />
        </Card>

        <Card title="操作日志">
          <List
            dataSource={events}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />,
            }}
            renderItem={(item) => (
              <List.Item key={item.id}>
                <Space direction="vertical" size={4} className="w-full">
                  <Typography.Text type="secondary">
                    {item.actor?.username ?? "系统"} · {item.event_type} · {formatDateTime(item.created_at)}
                  </Typography.Text>
                  <Typography.Text>
                    {formatRequirementStatus(item.from_status)} → {formatRequirementStatus(item.to_status)}
                  </Typography.Text>
                  {item.payload_json && (
                    <pre className="overflow-auto rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--accent-a3)] p-3 text-xs">
                      {JSON.stringify(item.payload_json, null, 2)}
                    </pre>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </div>
    </Space>
  );
}
