"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { readApiError } from "@/lib/api";
import { Button, TextField } from "@/components/ui-antd";

type JwtGenerateResponse = {
  token_type: string;
  access_token: string;
  expires_in: number;
  user_id: string;
};

export default function AdminJwtGeneratorPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();

  const canRead = hasPermission("jwt_generator.read") || hasPermission("jwt_generator.manage");

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<JwtGenerateResponse | null>(null);

  const handleGenerate = useCallback(async () => {
    const normalized = userId.trim();
    if (!normalized) {
      setError("请输入 user_id");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    const response = await fetchWithAuth("/api/v1/admin/jwt-generator/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: normalized }),
    });

    if (!response.ok) {
      setError(await readApiError(response));
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as JwtGenerateResponse;
    setResult(payload);
    setLoading(false);
  }, [fetchWithAuth, userId]);

  const handleCopy = useCallback(async () => {
    if (!result?.access_token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.access_token);
    } catch {
      setError("复制失败，请手动复制");
    }
  }, [result?.access_token]);

  if (initializing) {
    return <p className="text-sm text-[var(--gray-11)]">Loading jwt generator...</p>;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">请先登录后再访问 Jwt 生成器页面。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  if (!canRead) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center gap-4 px-6 py-20">
        <p className="text-sm text-[var(--gray-11)]">你没有访问该页面的权限（需要 `jwt_generator.read`）。</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md border border-[var(--gray-6)] bg-[var(--gray-a2)] px-4 py-2 text-sm font-medium text-[var(--gray-12)] transition hover:bg-[var(--gray-a3)] disabled:cursor-not-allowed disabled:opacity-60 w-fit">返回首页</Link>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <pre className="overflow-auto rounded-lg border border-[var(--red-6)] bg-[var(--red-a2)] p-4 text-sm text-[var(--red-11)]">{error}</pre>
      )}

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Jwt生成器</h2>
          <p className="mt-1 text-sm text-[var(--gray-11)]">输入用户 ID，生成该用户的 Bearer Token（含角色与权限声明）。</p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--gray-11)]">用户 ID</span>
            <TextField.Root
              placeholder="例如：openclaw"
              value={userId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setUserId(event.currentTarget.value)}
            />
          </label>
          <Button type="button" onClick={() => void handleGenerate()} disabled={loading}>
            {loading ? "生成中..." : "生成 Token"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid,var(--gray-1))] p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">生成结果</h3>
          <Button type="button" size="1" variant="soft" onClick={() => void handleCopy()} disabled={!result?.access_token}>
            复制 Token
          </Button>
        </div>

        {!result ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-[var(--gray-11)]">
            暂无生成结果。
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm md:grid-cols-3">
              <div>
                <dt className="text-[var(--gray-11)]">user_id</dt>
                <dd className="mt-1 font-medium">{result.user_id}</dd>
              </div>
              <div>
                <dt className="text-[var(--gray-11)]">token_type</dt>
                <dd className="mt-1 font-medium">{result.token_type}</dd>
              </div>
              <div>
                <dt className="text-[var(--gray-11)]">expires_in</dt>
                <dd className="mt-1 font-medium">{result.expires_in}s</dd>
              </div>
            </dl>

            <div className="rounded-lg border border-border bg-[var(--gray-a2)] p-3">
              <p className="mb-2 text-xs text-[var(--gray-11)]">access_token</p>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all text-xs leading-5">
                {result.access_token}
              </pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
