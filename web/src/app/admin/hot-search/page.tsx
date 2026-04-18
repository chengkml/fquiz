"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Select, Table, TextArea, TextField } from "@radix-ui/themes";

import { useAuth } from "@/components/auth-provider";
import { useTopicSubscription } from "@/hooks/use-topic-subscription";
import { readApiError } from "@/lib/api";
import type {
  HotSearchFollowTopicListResponse,
  HotSearchFollowTopicSummary,
  HotSearchListResponse,
  HotSearchRecordSummary,
} from "@/types/auth";

const SOURCE_OPTIONS = [
  { label: "头条", value: "TOUTIAO" },
];

type TopicFormState = {
  topic_name: string;
  keywords: string;
  enabled: "true" | "false";
  seq: string;
};

const EMPTY_TOPIC_FORM: TopicFormState = {
  topic_name: "",
  keywords: "",
  enabled: "true",
  seq: "0",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderTopicTags(topics: string[]) {
  if (topics.length === 0) {
    return <span className="text-xs text-[var(--gray-10)]">未命中</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {topics.map((topic) => (
        <span key={topic} className="rounded bg-[var(--orange-a3)] px-2 py-0.5 text-xs text-[var(--orange-11)]">
          {topic}
        </span>
      ))}
    </span>
  );
}

export default function AdminHotSearchPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [source, setSource] = useState("TOUTIAO");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [followedOnly, setFollowedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null);
  const [topicForm, setTopicForm] = useState<TopicFormState>(EMPTY_TOPIC_FORM);

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const listQuery = useQuery({
    queryKey: ["/api/v1/admin/hot-search/search", source, keyword, followedOnly],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/hot-search/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          title_keyword: keyword.trim() || null,
          followed_only: followedOnly,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as HotSearchListResponse;
    },
  });

  const followTopicsQuery = useQuery({
    queryKey: ["/api/v1/admin/hot-search/follow-topics"],
    enabled: !!user && canRead,
    queryFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/hot-search/follow-topics");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as HotSearchFollowTopicListResponse;
    },
  });

  const refreshRecords = useCallback(async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/v1/admin/hot-search/search");
      },
    });
  }, [queryClient]);

  const refreshTopics = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/hot-search/follow-topics"] });
  }, [queryClient]);

  useTopicSubscription("admin.hot_search", useCallback(() => {
    void refreshRecords();
  }, [refreshRecords]));

  useTopicSubscription("admin.hot_search.follow_topics", useCallback(() => {
    void refreshTopics();
    void refreshRecords();
  }, [refreshRecords, refreshTopics]));

  const records = listQuery.data?.items ?? [];
  const topics = followTopicsQuery.data?.items ?? [];

  useEffect(() => {
    if (records.length === 0) {
      setSelectedId(null);
      return;
    }
    const exists = selectedId !== null && records.some((item) => item.id === selectedId);
    if (!exists) {
      setSelectedId(records[0].id);
    }
  }, [records, selectedId]);

  const selectedRecord = useMemo<HotSearchRecordSummary | null>(() => {
    if (records.length === 0) {
      return null;
    }
    if (selectedId === null) {
      return records[0];
    }
    return records.find((item) => item.id === selectedId) ?? records[0];
  }, [records, selectedId]);

  const topicStats = useMemo(() => {
    const enabled = topics.filter((item) => item.enabled).length;
    return {
      total: topics.length,
      enabled,
      disabled: Math.max(0, topics.length - enabled),
    };
  }, [topics]);

  const saveTopicMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) {
        throw new Error("缺少 question_bank.manage 权限");
      }

      const topic_name = topicForm.topic_name.trim();
      if (!topic_name) {
        throw new Error("主题名称不能为空");
      }

      const seqNumber = Number(topicForm.seq || "0");
      if (Number.isNaN(seqNumber) || seqNumber < 0) {
        throw new Error("排序值必须是大于等于 0 的数字");
      }

      const payload = {
        topic_name,
        keywords: topicForm.keywords.trim() || null,
        enabled: topicForm.enabled === "true",
        seq: seqNumber,
      };

      if (editingTopicId === null) {
        const response = await fetchWithAuth("/api/v1/admin/hot-search/follow-topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        return "created";
      }

      const response = await fetchWithAuth(`/api/v1/admin/hot-search/follow-topics/${editingTopicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return "updated";
    },
    onSuccess: async (mode) => {
      setError("");
      setSuccess(mode === "created" ? "关注主题已创建" : "关注主题已更新");
      setTopicDialogOpen(false);
      setEditingTopicId(null);
      setTopicForm(EMPTY_TOPIC_FORM);
      await refreshTopics();
      await refreshRecords();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "保存关注主题失败");
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: async (topicId: number) => {
      if (!canManage) {
        throw new Error("缺少 question_bank.manage 权限");
      }
      const response = await fetchWithAuth(`/api/v1/admin/hot-search/follow-topics/${topicId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
    },
    onSuccess: async () => {
      setError("");
      setSuccess("关注主题已删除");
      await refreshTopics();
      await refreshRecords();
    },
    onError: (candidate) => {
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "删除关注主题失败");
    },
  });

  const openCreateTopic = () => {
    setError("");
    setSuccess("");
    setEditingTopicId(null);
    setTopicForm({ ...EMPTY_TOPIC_FORM, seq: String(topics.length) });
    setTopicDialogOpen(true);
  };

  const openEditTopic = (item: HotSearchFollowTopicSummary) => {
    setError("");
    setSuccess("");
    setEditingTopicId(item.id);
    setTopicForm({
      topic_name: item.topic_name,
      keywords: item.keywords ?? "",
      enabled: item.enabled ? "true" : "false",
      seq: String(item.seq),
    });
    setTopicDialogOpen(true);
  };

  const submitSearch = () => {
    setKeyword(keywordInput.trim());
  };

  const onKeywordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
    }
  };

  const listError = listQuery.error instanceof Error ? listQuery.error.message : "";
  const topicError = followTopicsQuery.error instanceof Error ? followTopicsQuery.error.message : "";
  const totalError = error || listError || topicError;

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading hot search workspace...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问热搜页面。</p>
        <Link href="/" className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `question_bank.read`）。</p>
        <Link href="/" className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {totalError && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{totalError}</pre>
      )}
      {success && (
        <pre className="overflow-auto rounded-lg border border-[var(--green-6)] bg-[var(--green-a2)] p-4 text-sm text-[var(--green-11)]">{success}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">热搜列表</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">支持来源筛选、关键词检索与关注主题命中识别。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-[var(--gray-a3)] px-2 py-1 text-[var(--gray-11)]">共 {records.length} 条</span>
            <span className="rounded bg-[var(--green-a3)] px-2 py-1 text-[var(--green-11)]">启用主题 {topicStats.enabled}</span>
            <span className="rounded bg-[var(--gray-a3)] px-2 py-1 text-[var(--gray-11)]">全部主题 {topicStats.total}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">来源</span>
            <Select.Root value={source} onValueChange={setSource}>
              <Select.Trigger className="w-full" />
              <Select.Content>
                {SOURCE_OPTIONS.map((item) => (
                  <Select.Item key={item.value} value={item.value}>{item.label}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-[var(--gray-11)]">标题关键词</span>
            <TextField.Root
              value={keywordInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeywordInput(event.currentTarget.value)}
              onKeyDown={onKeywordKeyDown}
              placeholder="输入关键词后回车或点查询"
              className="w-full"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">结果范围</span>
            <Select.Root
              value={followedOnly ? "followed" : "all"}
              onValueChange={(value: string) => setFollowedOnly(value === "followed")}
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="all">全部热搜</Select.Item>
                <Select.Item value="followed">只看命中关注主题</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={submitSearch}>查询</Button>
          <Button
            color="gray"
            variant="soft"
            type="button"
            onClick={() => {
              setKeywordInput("");
              setKeyword("");
              setFollowedOnly(false);
              setSource("TOUTIAO");
            }}
          >
            重置
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-lg border border-[var(--gray-6)]">
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header className="bg-[var(--gray-a3)]">
                <Table.Row>
                  <Table.ColumnHeaderCell className="px-3 py-2">序号</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-3 py-2">标题</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-3 py-2">来源</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-3 py-2">热度</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-3 py-2">命中主题</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="px-3 py-2">抓取时间</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {listQuery.isLoading && (
                  <Table.Row>
                    <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={6}>
                      正在加载热搜数据...
                    </Table.Cell>
                  </Table.Row>
                )}

                {!listQuery.isLoading && records.map((item) => {
                  const active = selectedRecord?.id === item.id;
                  return (
                    <Table.Row
                      key={item.id}
                      className={active ? "bg-[var(--indigo-a2)]" : ""}
                    >
                      <Table.Cell
                        className="cursor-pointer px-3 py-2"
                        onClick={() => setSelectedId(item.id)}
                      >
                        {item.rank_index ?? "-"}
                      </Table.Cell>
                      <Table.Cell
                        className="max-w-[420px] cursor-pointer px-3 py-2"
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="line-clamp-2 font-medium text-[var(--gray-12)]">{item.title}</div>
                      </Table.Cell>
                      <Table.Cell className="px-3 py-2">{item.source || "-"}</Table.Cell>
                      <Table.Cell className="px-3 py-2">{item.hot_value || "-"}</Table.Cell>
                      <Table.Cell className="px-3 py-2">{renderTopicTags(item.matched_topics)}</Table.Cell>
                      <Table.Cell className="px-3 py-2">{formatDateTime(item.crawl_time)}</Table.Cell>
                    </Table.Row>
                  );
                })}

                {!listQuery.isLoading && records.length === 0 && (
                  <Table.Row>
                    <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={6}>
                      暂无热搜数据。
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </div>

          <section className="rounded-lg border border-[var(--gray-6)] bg-[var(--gray-a2)] p-4">
            <h3 className="text-base font-semibold">详情</h3>
            {!selectedRecord && (
              <p className="mt-3 text-sm text-[var(--gray-11)]">请选择一条热搜查看详情。</p>
            )}
            {selectedRecord && (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="text-xs text-[var(--gray-10)]">标题</div>
                  <div className="mt-1 font-medium text-[var(--gray-12)]">{selectedRecord.title}</div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-[var(--gray-10)]">来源</div>
                    <div className="mt-1 text-[var(--gray-12)]">{selectedRecord.source || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--gray-10)]">热度</div>
                    <div className="mt-1 text-[var(--gray-12)]">{selectedRecord.hot_value || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--gray-10)]">序号</div>
                    <div className="mt-1 text-[var(--gray-12)]">{selectedRecord.rank_index ?? "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--gray-10)]">抓取时间</div>
                    <div className="mt-1 text-[var(--gray-12)]">{formatDateTime(selectedRecord.crawl_time)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-[var(--gray-10)]">命中关注主题</div>
                  <div className="mt-1">{renderTopicTags(selectedRecord.matched_topics)}</div>
                </div>

                <div>
                  <div className="text-xs text-[var(--gray-10)]">原文链接</div>
                  {selectedRecord.url ? (
                    <a
                      href={selectedRecord.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block break-all text-[var(--indigo-11)] underline"
                    >
                      {selectedRecord.url}
                    </a>
                  ) : (
                    <div className="mt-1 text-[var(--gray-11)]">-</div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-[var(--gray-10)]">详情内容</div>
                  <pre className="mt-1 max-h-[280px] overflow-auto whitespace-pre-wrap rounded border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-3 text-xs text-[var(--gray-12)]">
                    {selectedRecord.detail_markdown || "暂无详情"}
                  </pre>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">关注主题</h2>
            <p className="mt-1 text-sm text-[var(--gray-11)]">用于识别热搜命中主题，支持启停、排序与关键词配置。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-[var(--green-a3)] px-2 py-1 text-xs text-[var(--green-11)]">启用 {topicStats.enabled}</span>
            <span className="rounded bg-[var(--gray-a3)] px-2 py-1 text-xs text-[var(--gray-11)]">停用 {topicStats.disabled}</span>
            {canManage && (
              <Button type="button" onClick={openCreateTopic}>新建主题</Button>
            )}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--gray-6)]">
          <Table.Root className="w-full min-w-full text-left text-sm">
            <Table.Header className="bg-[var(--gray-a3)]">
              <Table.Row>
                <Table.ColumnHeaderCell className="px-3 py-2">主题名称</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-3 py-2">关键词</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-3 py-2">状态</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-3 py-2">排序</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="px-3 py-2">更新时间</Table.ColumnHeaderCell>
                {canManage && <Table.ColumnHeaderCell className="px-3 py-2">操作</Table.ColumnHeaderCell>}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {followTopicsQuery.isLoading && (
                <Table.Row>
                  <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 6 : 5}>
                    正在加载关注主题...
                  </Table.Cell>
                </Table.Row>
              )}

              {!followTopicsQuery.isLoading && topics.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="px-3 py-2 font-medium">{item.topic_name}</Table.Cell>
                  <Table.Cell className="px-3 py-2">
                    <div className="max-w-[420px] whitespace-pre-wrap break-words text-xs text-[var(--gray-11)]">{item.keywords || "-"}</div>
                  </Table.Cell>
                  <Table.Cell className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${item.enabled ? "bg-[var(--green-a3)] text-[var(--green-11)]" : "bg-[var(--gray-a3)] text-[var(--gray-11)]"}`}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="px-3 py-2">{item.seq}</Table.Cell>
                  <Table.Cell className="px-3 py-2">{formatDateTime(item.updated_at)}</Table.Cell>
                  {canManage && (
                    <Table.Cell className="px-3 py-2">
                      <div className="flex gap-2">
                        <Button size="1" type="button" onClick={() => openEditTopic(item)}>编辑</Button>
                        <Button
                          size="1"
                          color="red"
                          variant="soft"
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`确认删除主题「${item.topic_name}」吗？`)) {
                              return;
                            }
                            deleteTopicMutation.mutate(item.id);
                          }}
                          disabled={deleteTopicMutation.isPending}
                        >
                          删除
                        </Button>
                      </div>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}

              {!followTopicsQuery.isLoading && topics.length === 0 && (
                <Table.Row>
                  <Table.Cell className="px-4 py-8 text-center text-sm text-[var(--gray-11)]" colSpan={canManage ? 6 : 5}>
                    暂无关注主题。
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
      </section>

      <Dialog.Root open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <Dialog.Content maxWidth="640px">
          <Dialog.Title>{editingTopicId === null ? "新建关注主题" : `编辑关注主题 #${editingTopicId}`}</Dialog.Title>
          <Dialog.Description size="2" className="text-[var(--gray-11)]">
            主题关键词支持逗号或换行分隔；系统将基于关键词自动匹配热搜内容。
          </Dialog.Description>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span>主题名称</span>
              <TextField.Root
                value={topicForm.topic_name}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setTopicForm((prev) => ({ ...prev, topic_name: event.currentTarget.value }))
                }
                placeholder="例如：AI模型"
                className="w-full"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>关键词（逗号或换行分隔）</span>
              <TextArea
                value={topicForm.keywords}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setTopicForm((prev) => ({ ...prev, keywords: event.currentTarget.value }))
                }
                rows={4}
                placeholder={"ai,模型,推理\n大模型"}
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>状态</span>
              <Select.Root
                value={topicForm.enabled}
                onValueChange={(value: string) =>
                  setTopicForm((prev) => ({ ...prev, enabled: value as "true" | "false" }))
                }
              >
                <Select.Trigger className="w-full" />
                <Select.Content>
                  <Select.Item value="true">启用</Select.Item>
                  <Select.Item value="false">停用</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>

            <label className="space-y-1 text-sm">
              <span>排序值</span>
              <TextField.Root
                value={topicForm.seq}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setTopicForm((prev) => ({ ...prev, seq: event.currentTarget.value }))
                }
                placeholder="0"
                className="w-full"
              />
            </label>
          </div>

          <div className="mt-6 flex gap-2">
            <Button
              type="button"
              onClick={() => saveTopicMutation.mutate()}
              disabled={saveTopicMutation.isPending}
            >
              {saveTopicMutation.isPending ? "提交中..." : editingTopicId === null ? "创建" : "保存"}
            </Button>
            <Button
              color="gray"
              variant="soft"
              type="button"
              onClick={() => {
                setTopicDialogOpen(false);
                setEditingTopicId(null);
                setTopicForm(EMPTY_TOPIC_FORM);
              }}
            >
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
