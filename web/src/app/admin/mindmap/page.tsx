"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { Button, Dialog, Select, Table, TextArea, TextField } from "@radix-ui/themes";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  QuestionBankListResponse,
  QuestionBankSummary,
  QuestionDifficulty,
  QuestionStatus,
  QuestionType,
} from "@/types/auth";

type FormState = {
  question_type: QuestionType;
  stem: string;
  options_text: string;
  answer: string;
  analysis: string;
  difficulty: QuestionDifficulty;
  status: QuestionStatus;
  tags_text: string;
};

type Filters = {
  keyword: string;
  status: "all" | QuestionStatus;
  difficulty: "all" | QuestionDifficulty;
  question_type: "all" | QuestionType;
  tag: string;
};

const DEFAULT_FILTERS: Filters = {
  keyword: "",
  status: "all",
  difficulty: "all",
  question_type: "all",
  tag: "",
};

const EMPTY_FORM: FormState = {
  question_type: "single_choice",
  stem: "",
  options_text: "",
  answer: "",
  analysis: "",
  difficulty: "medium",
  status: "draft",
  tags_text: "",
};

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  true_false: "判断题",
  short_answer: "简答题",
};

const DIFFICULTY_LABEL: Record<QuestionDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
};

function parseOptions(text: string): Array<Record<string, string>> | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  return lines.map((line, index) => {
    const [maybeKey, ...rest] = line.split(":");
    if (rest.length === 0) {
      const key = String.fromCharCode(65 + index);
      return { key, content: maybeKey.trim() };
    }
    return { key: maybeKey.trim(), content: rest.join(":").trim() };
  });
}

function serializeOptions(options: Array<Record<string, unknown>> | null): string {
  if (!options || options.length === 0) {
    return "";
  }
  return options
    .map((item, index) => {
      const key = typeof item.key === "string" ? item.key : String.fromCharCode(65 + index);
      const content = typeof item.content === "string" ? item.content : "";
      return `${key}: ${content}`;
    })
    .join("\n");
}

function normalizeTags(tagsText: string): string[] {
  return Array.from(
    new Set(
      tagsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export default function AdminMindmapPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.difficulty !== "all") params.set("difficulty", filters.difficulty);
    if (filters.question_type !== "all") params.set("question_type", filters.question_type);
    if (filters.tag.trim()) params.set("tag", filters.tag.trim());

    const query = params.toString();
    return `/api/v1/admin/question-bank${query ? `?${query}` : ""}`;
  }, [filters]);

  const listQuery = useQuery({
    queryKey: [listPath],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth(listPath);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as QuestionBankListResponse;
    },
  });

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey)
        && typeof query.queryKey[0] === "string"
        && query.queryKey[0].startsWith("/api/v1/admin/question-bank"),
    });
  }, [queryClient]);

  useTopicSubscription(
    "admin.question_bank",
    useCallback(() => {
      void refreshList();
    }, [refreshList]),
  );

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(false);
  }, []);

  const startCreate = () => {
    setError("");
    setSuccess("");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const startEdit = (item: QuestionBankSummary) => {
    setError("");
    setSuccess("");
    setEditingId(item.id);
    setForm({
      question_type: item.question_type,
      stem: item.stem,
      options_text: serializeOptions(item.options_json),
      answer: item.answer,
      analysis: item.analysis ?? "",
      difficulty: item.difficulty,
      status: item.status,
      tags_text: (item.tags_json ?? []).join(", "),
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 question_bank.manage 权限");
      }

      if (!form.stem.trim() || !form.answer.trim()) {
        throw new Error("题干和答案不能为空");
      }

      const payload = {
        question_type: form.question_type,
        stem: form.stem.trim(),
        options_json: parseOptions(form.options_text),
        answer: form.answer.trim(),
        analysis: form.analysis.trim() || null,
        difficulty: form.difficulty,
        status: form.status,
        tags_json: normalizeTags(form.tags_text),
      };

      const url = editingId === null
        ? "/api/v1/admin/question-bank"
        : `/api/v1/admin/question-bank/${editingId}`;

      const method = editingId === null ? "POST" : "PATCH";

      const response = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      return editingId === null ? "created" : "updated";
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "题目已创建" : "题目已更新");
      resetForm();
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: QuestionBankSummary) => {
      const response = await fetchWithAuth(`/api/v1/admin/question-bank/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return item.id;
    },
    onSuccess: async (deletedId) => {
      if (editingId === deletedId) {
        resetForm();
      }
      setError("");
      setSuccess("题目已删除");
      await refreshList();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除失败");
    },
  });

  const items = listQuery.data?.items ?? [];
  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";

  if (initializing || listQuery.isLoading) {
    return <p className="text-sm text-[var(--gray-11)]">Loading question bank...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问试题管理页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `question_bank.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {(error || listError) && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error || listError}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">试题管理</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">迁移 quiz exam_mgr 菜单能力：题目列表、筛选、编辑与状态管理。</p>
          </div>
          {canManage && (
            <Button
             
              type="button"
              onClick={startCreate}
            >
              新建题目
            </Button>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <TextField.Root
            value={filters.keyword}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilters((prev) => ({ ...prev, keyword: event.currentTarget.value }))
            }
            placeholder="按题干/答案筛选"
            className="w-full md:col-span-2"
          />

          <Select.Root
            value={filters.status}
            onValueChange={(value: string) =>
              setFilters((prev) => ({ ...prev, status: value as Filters["status"] }))
            }
          >
            <Select.Trigger className="w-full" />
            <Select.Content>
              <Select.Item value="all">全部状态</Select.Item>
              <Select.Item value="draft">草稿</Select.Item>
              <Select.Item value="published">已发布</Select.Item>
              <Select.Item value="archived">已归档</Select.Item>
            </Select.Content>
          </Select.Root>

          <Select.Root
            value={filters.difficulty}
            onValueChange={(value: string) =>
              setFilters((prev) => ({ ...prev, difficulty: value as Filters["difficulty"] }))
            }
          >
            <Select.Trigger className="w-full" />
            <Select.Content>
              <Select.Item value="all">全部难度</Select.Item>
              <Select.Item value="easy">简单</Select.Item>
              <Select.Item value="medium">中等</Select.Item>
              <Select.Item value="hard">困难</Select.Item>
            </Select.Content>
          </Select.Root>

          <TextField.Root
            value={filters.tag}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFilters((prev) => ({ ...prev, tag: event.currentTarget.value }))
            }
            placeholder="标签筛选"
            className="w-full"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">题型</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">题干</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">难度</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">标签</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-4 py-3 font-medium">更新时间</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-4 py-3 font-medium">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body className="divide-y divide-y">
              {items.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-4 py-3">{item.id}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{QUESTION_TYPE_LABEL[item.question_type]}</Table.Cell>
                  <Table.Cell className="px-4 py-3">
                    <div className="max-w-[460px]">
                      <p className="line-clamp-2">{item.stem}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-[var(--gray-11)]">答案：{item.answer}</p>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="px-4 py-3">{DIFFICULTY_LABEL[item.difficulty]}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{STATUS_LABEL[item.status]}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{(item.tags_json ?? []).join(", ") || "-"}</Table.Cell>
                  <Table.Cell className="px-4 py-3">{new Date(item.updated_at).toLocaleString()}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          color="gray" size="1" variant="soft"
                          type="button"
                          onClick={() => startEdit(item)}
                        >
                          编辑
                        </Button>
                        <Button
                          color="red" size="1" variant="soft"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`确认删除题目 #${item.id} 吗？`)) {
                              return;
                            }
                            deleteMutation.mutate(item);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
              {items.length === 0 && (
                <Table.Row>
                  <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 8 : 7}>
                    暂无题目数据。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Content maxWidth="760px">
          <Dialog.Title>{editingId === null ? "新建题目" : `编辑题目 #${editingId}`}</Dialog.Title>
          <Dialog.Description size="2" className="text-[var(--gray-11)]">
            支持题型、选项、答案、解析、难度、状态与标签管理。
          </Dialog.Description>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-1">
              <span>题型</span>
              <Select.Root
                value={form.question_type}
                onValueChange={(value: string) =>
                  setForm((prev) => ({ ...prev, question_type: value as QuestionType }))
                }
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="single_choice">单选题</Select.Item>
                  <Select.Item value="multiple_choice">多选题</Select.Item>
                  <Select.Item value="true_false">判断题</Select.Item>
                  <Select.Item value="short_answer">简答题</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>

            <label className="space-y-1 text-sm md:col-span-1">
              <span>难度</span>
              <Select.Root
                value={form.difficulty}
                onValueChange={(value: string) =>
                  setForm((prev) => ({ ...prev, difficulty: value as QuestionDifficulty }))
                }
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="easy">简单</Select.Item>
                  <Select.Item value="medium">中等</Select.Item>
                  <Select.Item value="hard">困难</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>题干</span>
              <TextArea
                value={form.stem}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((prev) => ({ ...prev, stem: event.currentTarget.value }))
                }
                rows={4}
                placeholder="请输入题干"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>选项（每行一项，格式：A: 选项内容；简答题可留空）</span>
              <TextArea
                value={form.options_text}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((prev) => ({ ...prev, options_text: event.currentTarget.value }))
                }
                rows={4}
                placeholder={"A: 选项一\nB: 选项二"}
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>答案</span>
              <TextArea
                value={form.answer}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((prev) => ({ ...prev, answer: event.currentTarget.value }))
                }
                rows={2}
                placeholder="例如：A；或简答答案"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>解析</span>
              <TextArea
                value={form.analysis}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((prev) => ({ ...prev, analysis: event.currentTarget.value }))
                }
                rows={3}
                placeholder="可选"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-1">
              <span>状态</span>
              <Select.Root
                value={form.status}
                onValueChange={(value: string) =>
                  setForm((prev) => ({ ...prev, status: value as QuestionStatus }))
                }
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="draft">草稿</Select.Item>
                  <Select.Item value="published">已发布</Select.Item>
                  <Select.Item value="archived">已归档</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>

            <label className="space-y-1 text-sm md:col-span-1">
              <span>标签（逗号分隔）</span>
              <TextField.Root
                value={form.tags_text}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setForm((prev) => ({ ...prev, tags_text: event.currentTarget.value }))
                }
                placeholder="例如：数学, 函数"
                className="w-full"
              />
            </label>
          </div>

          <div className="mt-6 flex gap-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "提交中..." : editingId === null ? "创建" : "保存"}
            </Button>
            <Button color="gray" onClick={resetForm} variant="soft">
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
