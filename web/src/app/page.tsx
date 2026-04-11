"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { API_BASE_URL, readApiError } from "@/lib/api";

type Mode = "login" | "register";
type PingResponse = { message: string };

export default function Home() {
  const { user, initializing, login, register, logout, hasPermission } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);

  const title = useMemo(
    () => (mode === "login" ? "登录账号" : "注册新账号"),
    [mode],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, username, password);
      }
      setPassword("");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unknown error";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handlePing = async () => {
    setError("");
    const response = await fetch(`${API_BASE_URL}/api/v1/ping`, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }
    setPingResult((await response.json()) as PingResponse);
  };

  if (initializing) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <p className="text-sm text-zinc-500">Initializing session...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-20 sm:px-10">
      <h1 className="text-3xl font-semibold tracking-tight">fquiz</h1>
      <p className="text-base text-zinc-600 dark:text-zinc-300">
        用户管理与登录认证已就绪（JWT + Refresh Session + RBAC）。
      </p>

      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">API Base URL</p>
        <p className="mt-1 font-mono text-sm">{API_BASE_URL}</p>
      </section>

      {user ? (
        <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-black">
          <p className="text-lg font-medium">欢迎，{user.username}</p>
          <p className="mt-1 text-sm text-zinc-500">{user.email}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Roles: {user.role_codes.join(", ") || "-"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Permissions: {user.permission_codes.join(", ") || "-"}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              onClick={handlePing}
              type="button"
            >
              Ping Backend
            </button>
            {hasPermission("user.manage") && (
              <Link
                href="/admin/users"
                className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                管理用户
              </Link>
            )}
            <button
              className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              onClick={() => void logout()}
              type="button"
            >
              退出登录
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-black">
          <div className="mb-4 flex gap-2">
            <button
              className={`rounded-md px-3 py-1 text-sm ${
                mode === "login"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "border border-black/15 dark:border-white/20"
              }`}
              onClick={() => setMode("login")}
              type="button"
            >
              登录
            </button>
            <button
              className={`rounded-md px-3 py-1 text-sm ${
                mode === "register"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "border border-black/15 dark:border-white/20"
              }`}
              onClick={() => setMode("register")}
              type="button"
            >
              注册
            </button>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <h2 className="text-base font-medium">{title}</h2>
            <input
              className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {mode === "register" && (
              <input
                className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                placeholder="Username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={64}
                required
              />
            )}
            <input
              className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
              placeholder="Password (>= 8 chars)"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
            <button
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              disabled={busy}
              type="submit"
            >
              {busy ? "Submitting..." : mode === "login" ? "登录" : "注册并登录"}
            </button>
          </form>
        </section>
      )}

      {pingResult && (
        <pre className="overflow-auto rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
          {JSON.stringify(pingResult, null, 2)}
        </pre>
      )}

      {error && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </pre>
      )}
    </main>
  );
}
