"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
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

const COMMENT_KIND_OPTIONS: RequirementCommentKind[] = ["comment", "analysis", "revision", "system"];
const PRIORITY_OPTIONS: RequirementPriority[] = ["low", "medium", "high", "urgent"];
const ALLOWED_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  PENDING_ANALYSIS: ["OPEN", "PENDING_REVISION", "CANCELLED"],
  PENDING_REVISION: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "PENDING_REVISION", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "PENDING_REVISION", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

type FetchWithAuth = ReturnType<typeof useAuth>["fetchWithAuth"];

function toDatetimeLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
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
    <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">编辑基础信息</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">支持更新标题、描述、优先级、项目、模块、来源和截止时间。</p>
      </div>

      {error && (
        <pre className="mb-4 overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{error}</pre>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm md:col-span-2">
          <span>标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2">
          <span>描述</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span>优先级</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as RequirementPriority)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          >
            {PRIORITY_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span>截止时间</span>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span>项目</span>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span>模块</span>
          <input
            value={moduleName}
            onChange={(event) => setModuleName(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2">
          <span>来源</span>
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
        </label>
      </div>

      <div className="mt-4">
        <button
          type="button"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending || !title.trim()}
        >
          {updateMutation.isPending ? "保存中..." : "保存基础信息"}
        </button>
      </div>
    </section>
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
  const [transitionStatus, setTransitionStatus] = useState<RequirementStatus>(ALLOWED_TRANSITIONS[detail.status][0] ?? detail.status);
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

  const error = [assignMutation.error, claimMutation.error, transitionMutation.error]
    .find((item) => item instanceof Error);

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">处理动作</h3>
        {error instanceof Error && (
          <pre className="mt-4 overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{error.message}</pre>
        )}
        <div className="mt-4 space-y-4">
          {canAssign && (
            <div className="space-y-2">
              <p className="text-sm font-medium">指派</p>
              <div className="flex gap-2">
                <select
                  value={assignUserId}
                  onChange={(event) => setAssignUserId(event.target.value)}
                  className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                >
                  <option value="">取消指派</option>
                  {users.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}
                </select>
                <button
                  type="button"
                  className="rounded-md border border-black/15 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  onClick={() => assignMutation.mutate()}
                  disabled={assignMutation.isPending}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">领取</p>
            <button
              type="button"
              className="rounded-md border border-black/15 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
            >
              我来领取
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">状态流转</p>
            {availableTransitions.length > 0 ? (
              <>
                <select
                  value={currentTransitionStatus}
                  onChange={(event) => setTransitionStatus(event.target.value as RequirementStatus)}
                  className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                >
                  {availableTransitions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <textarea
                  value={transitionNote}
                  onChange={(event) => setTransitionNote(event.target.value)}
                  rows={3}
                  placeholder="流转备注（可选）"
                  className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                />
                <button
                  type="button"
                  className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  onClick={() => transitionMutation.mutate()}
                  disabled={transitionMutation.isPending}
                >
                  提交流转
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">当前状态没有可继续流转的目标状态。</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold">当前处理说明</h3>
        <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          <p>当前状态：{detail.status}</p>
          <p>当前指派人：{detail.assignee?.username ?? "-"}</p>
          <p>当前评审人：{detail.reviewer?.username ?? "-"}</p>
        </div>
      </div>
    </section>
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
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <h3 className="text-lg font-semibold">新增评论</h3>
      {error && (
        <pre className="mt-4 overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{error}</pre>
      )}
      <div className="mt-4 space-y-3">
        <select
          value={commentKind}
          onChange={(event) => setCommentKind(event.target.value as RequirementCommentKind)}
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
        >
          {COMMENT_KIND_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <textarea
          value={commentContent}
          onChange={(event) => setCommentContent(event.target.value)}
          rows={6}
          placeholder="写点处理说明、分析结论或修订意见"
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
        />
        <button
          type="button"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          onClick={() => commentMutation.mutate()}
          disabled={commentMutation.isPending || !commentContent.trim()}
        >
          发表评论
        </button>
      </div>
    </div>
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
    return <p className="text-sm text-zinc-500">Loading requirement...</p>;
  }

  if (!requirementId) {
    return <p className="text-sm text-zinc-500">需求 ID 无效。</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">请先登录后再访问需求详情。</p>
        <Link href="/" className="text-sm underline">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">你没有访问该页面的权限（需要 `requirement.read`）。</p>
        <Link href="/admin/requirements" className="text-sm underline">返回需求列表</Link>
      </main>
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return <p className="text-sm text-zinc-500">需求不存在。</p>;
  }

  const comments = commentsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const users = usersQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      {anyError && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">{anyError}</pre>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-xs text-zinc-500">{detail.code}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{detail.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200">{detail.description || "暂无描述"}</p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Link href="/admin/requirements" className="underline">返回需求列表</Link>
            <span>状态：{detail.status}</span>
            <span>优先级：{detail.priority}</span>
            <span>创建人：{detail.creator?.username ?? "-"}</span>
            <span>指派人：{detail.assignee?.username ?? "-"}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">项目</p>
            <p className="mt-1">{detail.project_name ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">模块</p>
            <p className="mt-1">{detail.module_name ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">来源</p>
            <p className="mt-1">{detail.source ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">截止时间</p>
            <p className="mt-1">{detail.due_at ? new Date(detail.due_at).toLocaleString() : "-"}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">完成时间</p>
            <p className="mt-1">{detail.closed_at ? new Date(detail.closed_at).toLocaleString() : "-"}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <p className="text-xs text-zinc-500">更新时间</p>
            <p className="mt-1">{new Date(detail.updated_at).toLocaleString()}</p>
          </div>
        </div>
      </section>

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

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">评论区</h3>
          <div className="mt-4 space-y-3">
            {comments.length === 0 ? <p className="text-sm text-zinc-500">暂无评论</p> : comments.map((item) => (
              <div key={item.id} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                  <span>{item.author?.username ?? "系统"} · {item.kind}</span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold">操作日志</h3>
          <div className="mt-4 space-y-3">
            {events.length === 0 ? <p className="text-sm text-zinc-500">暂无日志</p> : events.map((item) => (
              <div key={item.id} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                  <span>{item.actor?.username ?? "系统"} · {item.event_type}</span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm">{item.from_status ?? "-"} → {item.to_status ?? "-"}</p>
                {item.payload_json && (
                  <pre className="mt-2 overflow-auto rounded-lg bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">{JSON.stringify(item.payload_json, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
