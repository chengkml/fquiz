"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Table, TextArea } from "@radix-ui/themes";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import type { MdResolveImportResponse, MdResolveParseResponse } from "@/types/auth";

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export default function AdminMdResolvePage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const [markdown, setMarkdown] = useState("");
  const [parseResult, setParseResult] = useState<MdResolveParseResponse | null>(null);
  const [importResult, setImportResult] = useState<MdResolveImportResponse | null>(null);
  const [error, setError] = useState("");

  const canRead = hasPermission("question_bank.read") || hasPermission("question_bank.manage");
  const canManage = hasPermission("question_bank.manage");

  const parseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/admin/mdresolve/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as MdResolveParseResponse;
    },
    onSuccess: (data) => {
      setError("");
      setImportResult(null);
      setParseResult(data);
    },
    onError: (candidate) => {
      setError(normalizeError(candidate));
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parseResult || parseResult.items.length === 0) {
        throw new Error("没有可导入的解析结果");
      }
      const response = await fetchWithAuth("/api/v1/admin/mdresolve/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parseResult.items }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      return (await response.json()) as MdResolveImportResponse;
    },
    onSuccess: (data) => {
      setError("");
      setImportResult(data);
    },
    onError: (candidate) => {
      setError(normalizeError(candidate));
    },
  });

  const previewRows = useMemo(() => parseResult?.items ?? [], [parseResult]);

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading mdresolve...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问 MD 解析页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `question_bank.read`）。</p>
        <Link href="/admin" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回后台首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">MD 解析</h2>
          <p className="mt-1 text-sm text-[var(--gray-11)]">粘贴 Markdown 题目内容，解析后可批量导入题库。</p>
        </div>

        <div className="space-y-3">
          <TextArea
            value={markdown}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMarkdown(event.currentTarget.value)}
            rows={14}
            className="w-full"
            placeholder={"示例：\n1. 题目：下列哪项是 HTTP 状态码？\nA. 200\nB. TCP\nC. SQL\nD. DNS\n答案：A\n解析：200 表示请求成功"}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => parseMutation.mutate()}
              disabled={parseMutation.isPending || !markdown.trim()}
            >
              {parseMutation.isPending ? "解析中..." : "解析 Markdown"}
            </Button>

            <Button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={!canManage || importMutation.isPending || previewRows.length === 0}
            >
              {importMutation.isPending ? "导入中..." : "导入题库"}
            </Button>

            <Link href="/admin/question-bank" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)]">
              查看题库
            </Link>
          </div>
        </div>
      </section>

      {parseResult && (
        <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">解析结果（{parseResult.total}）</h3>
            {parseResult.warnings.length > 0 && (
              <span className="text-xs text-[var(--orange-11)]">警告 {parseResult.warnings.length} 条</span>
            )}
          </div>

          {parseResult.warnings.length > 0 && (
            <ul className="mb-4 list-disc space-y-1 pl-6 text-sm text-[var(--orange-11)]">
              {parseResult.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto">
            <Table.Root className="w-full min-w-full text-left text-sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>题型</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>题干</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>答案</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>难度</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {previewRows.map((item, index) => (
                  <Table.Row key={`${index}-${item.stem.slice(0, 20)}`}>
                    <Table.Cell>{item.question_type}</Table.Cell>
                    <Table.Cell>
                      <p className="line-clamp-2">{item.stem}</p>
                    </Table.Cell>
                    <Table.Cell>{item.answer}</Table.Cell>
                    <Table.Cell>{item.difficulty}</Table.Cell>
                    <Table.Cell>{item.status}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </div>
        </section>
      )}

      {importResult && (
        <section className="rounded-xl border border-[var(--green-6)] bg-[var(--green-a2)] p-5 text-sm text-[var(--green-11)] shadow-sm">
          <p>导入成功：{importResult.created_count} 条。</p>
          {importResult.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {importResult.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
